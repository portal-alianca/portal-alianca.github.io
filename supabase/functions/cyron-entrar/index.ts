/* Login com Discord para a área do cliente do CYRON.

   Por que uma função no Supabase e não a página sozinha: trocar o `code` do
   OAuth por um token exige o CLIENT SECRET do aplicativo, e segredo em página
   estática não é segredo -- qualquer pessoa abre o "ver código-fonte" e leva.
   Então a página só carrega o code até aqui, e o secret nunca sai daqui.

   O que esta função devolve é deliberadamente pequeno: os servidores que a
   PESSOA administra, e de cada um só o que ela precisa ver -- nome, plano,
   até quando está pago. Nada de chave de tradutor, nada de token, nada de
   outro cliente.

   E ela não guarda sessão. Nenhum token nosso nasce, então nenhum token nosso
   vaza; recarregar a página faz login de novo, e como o Discord lembra a
   autorização, isso é um clique que a pessoa mal vê. A alternativa seria
   emitir um cookie de sessão e passar a ter que protegê-lo -- trabalho e risco
   novos para resolver um problema que não existe. */

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/* O id do aplicativo e o client_id do OAuth sao o MESMO numero, com dois
   nomes -- e neste projeto ele ja aparece nos dois: como DISCORD_CLIENT_ID
   aqui e como DISCORD_APP_ID na funcao de interacoes. Aceitar os dois, e cair
   no numero escrito, evita a unica pergunta que essa duplicidade poderia
   gerar: "o que ja esta guardado ali e' do mesmo aplicativo?".

   O numero nao e' segredo: ele viaja em todo convite do bot e ja esta escrito
   na pagina do site. Segredo e' so' o CLIENT_SECRET, logo abaixo, e esse nao
   tem valor de reserva nenhum -- sem ele a funcao recusa o login em vez de
   tentar com um vazio. */
const CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID")
  || Deno.env.get("DISCORD_APP_ID")
  || "1498142929041096856";
const CLIENT_SECRET = Deno.env.get("DISCORD_CLIENT_SECRET") ?? "";

/* De onde a página pode chamar.

   Lista fechada, e não "*": com `*` qualquer site do mundo poderia montar uma
   cópia da nossa tela de login, receber o code de um cliente nosso e ler os
   servidores dele daqui. A lista aceita mais de uma origem porque o site tem
   um endereço no GitHub Pages e pode ganhar um domínio próprio depois. */
const ORIGENS = new Set([
  "https://portal-alianca.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function cabecalhos(origem: string | null) {
  const liberada = origem && ORIGENS.has(origem) ? origem : "";
  return {
    "Access-Control-Allow-Origin": liberada,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    /* A resposta é sobre UMA pessoa. Um cache no meio do caminho que a
       guardasse entregaria os servidores dela para o próximo que perguntasse. */
    "Cache-Control": "no-store",
  };
}

/* "Gerenciar servidor" é a permissão que define quem manda ali.

   Não uso "dono" porque em servidor grande quem cuida do bot quase nunca é a
   conta dona -- é um administrador. Exigir a conta dona faria a área do
   cliente não servir justamente para os servidores que mais interessam. */
const GERENCIAR_SERVIDOR = 1n << 5n;

function podeMandar(g: any): boolean {
  if (g?.owner === true) return true;
  try {
    return (BigInt(g?.permissions ?? "0") & GERENCIAR_SERVIDOR) !== 0n;
  } catch {
    return false;
  }
}

async function sb(caminho: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

/* O plano, calculado do mesmo jeito que o bot calcula.

   Isto é uma repetição de `planoDe` do index.js, e é proposital: importar de
   lá não dá (outro runtime, outra máquina), e a alternativa -- confiar só na
   coluna `plano` -- mostraria "grátis" para quem está em teste de 7 dias ou
   pagou pelo Stripe, que são exatamente as duas horas em que a pessoa vai
   olhar esta tela. */
function futuro(quando: string | null | undefined): number {
  const t = quando ? Date.parse(quando) : 0;
  return t && t > Date.now() ? t : 0;
}

function planoDe(s: any): { plano: string; ate: string | null; motivo: string } {
  if (s?.plano === "pago") return { plano: "pago", ate: null, motivo: "liberado" };
  const teste = futuro(s?.teste_ate);
  if (teste) return { plano: "pago", ate: new Date(teste).toISOString(), motivo: "teste" };
  const pago = futuro(s?.pago_ate);
  if (pago) return { plano: "pago", ate: new Date(pago).toISOString(), motivo: "assinatura" };
  return { plano: "gratis", ate: null, motivo: "" };
}

/* Devolve o token ao Discord assim que termino de usá-lo.

   Ele vale por uma semana e dá acesso à lista de servidores da pessoa. Eu
   precisei dele por dois segundos; deixá-lo vivo mais que isso é guardar uma
   chave que não é minha, numa gaveta que eu não vou vigiar. Falhar aqui não
   quebra nada -- o token expira sozinho de qualquer forma. */
async function devolverToken(token: string) {
  try {
    await fetch("https://discord.com/api/oauth2/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        token, token_type_hint: "access_token",
      }),
    });
  } catch { /* expira sozinho */ }
}

Deno.serve(async (req) => {
  const origem = req.headers.get("origin");
  const cab = cabecalhos(origem);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cab });
  if (req.method !== "POST") return new Response("só POST", { status: 405, headers: cab });

  /* Origem desconhecida sai aqui, antes de qualquer trabalho: sem o cabeçalho
     de liberação o navegador já recusaria a resposta, mas eu não quero nem
     ter gasto uma troca de token com o Discord por causa dela. */
  if (!cab["Access-Control-Allow-Origin"]) {
    return new Response(JSON.stringify({ erro: "origem não liberada" }), { status: 403, headers: cab });
  }
  if (!CLIENT_SECRET) {
    console.error("entrar: falta DISCORD_CLIENT_SECRET nos segredos da função");
    return new Response(JSON.stringify({ erro: "login ainda não configurado" }), { status: 500, headers: cab });
  }

  let code = "", redirect_uri = "";
  try {
    const corpo = await req.json();
    code = String(corpo?.code ?? "");
    redirect_uri = String(corpo?.redirect_uri ?? "");
  } catch { /* cai na validação abaixo */ }

  if (!code || !redirect_uri) {
    return new Response(JSON.stringify({ erro: "faltou o code" }), { status: 400, headers: cab });
  }
  /* O redirect_uri volta da página, e o Discord confere se ele bate com o que
     está cadastrado no aplicativo. Mas eu confiro ANTES: sem isto, alguém
     poderia mandar aqui um code obtido para outro destino.

     O try existe porque `new URL` ESTOURA com texto que não é endereço, e um
     estouro aqui viraria 500 -- ou seja, um campo inválido de fora derrubando
     a função em vez de ser recusado por ela. */
  let destino = "";
  try { destino = new URL(redirect_uri).origin; } catch { /* fica vazio */ }
  if (!ORIGENS.has(destino)) {
    return new Response(JSON.stringify({ erro: "destino não liberado" }), { status: 400, headers: cab });
  }

  let token = "";
  try {
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        grant_type: "authorization_code", code, redirect_uri,
      }),
    });
    if (!r.ok) {
      /* Code já usado ou expirado é o caso comum (a pessoa recarregou a
         página). Não é erro de servidor, e não deve virar alarme. */
      console.log(`entrar: o Discord recusou o code (${r.status})`);
      return new Response(JSON.stringify({ erro: "login expirou, tente de novo" }), { status: 401, headers: cab });
    }
    token = (await r.json())?.access_token ?? "";
  } catch (e) {
    console.error("entrar: falhei ao falar com o Discord:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ erro: "o Discord não respondeu" }), { status: 502, headers: cab });
  }
  if (!token) return new Response(JSON.stringify({ erro: "login expirou, tente de novo" }), { status: 401, headers: cab });

  try {
    const como = { headers: { Authorization: `Bearer ${token}` } };
    const [rUser, rGuilds] = await Promise.all([
      fetch("https://discord.com/api/users/@me", como),
      fetch("https://discord.com/api/users/@me/guilds", como),
    ]);
    if (!rUser.ok || !rGuilds.ok) {
      return new Response(JSON.stringify({ erro: "o Discord não deixou ler seus servidores" }),
        { status: 502, headers: cab });
    }
    const user = await rUser.json();
    const guilds: any[] = await rGuilds.json();

    /* Daqui pra baixo só existem servidores que ESTA pessoa administra. É a
       única checagem de autorização da função, e ela vem do próprio Discord:
       a lista já chega filtrada para a conta que autorizou. */
    const meus = (Array.isArray(guilds) ? guilds : []).filter(podeMandar);

    let instalados: any[] = [];
    if (meus.length) {
      const ids = meus.map((g) => `"${String(g.id).replace(/[^0-9]/g, "")}"`).join(",");
      /* Colunas escolhidas a dedo, e nunca `select=*`: a linha do servidor
         carrega a CHAVE DE TRADUTOR cifrada do cliente, e um `*` aqui a
         mandaria para o navegador junto com o resto. */
      instalados = await sb(
        `cyron_servidor?guild_id=in.(${ids})&select=id,guild_id,nome,plano,pago_ate,teste_ate,stripe_assinatura`,
      );
    }
    const porGuild = new Map(instalados.map((s: any) => [String(s.guild_id), s]));

    /* O link de pagamento é o mesmo que o bot usa: um Payment Link do Stripe
       guardado nos ajustes. Nenhuma credencial do Stripe passa por aqui. */
    let linkBase = "";
    try {
      linkBase = (await sb("cyron_ajuste?chave=eq.stripe_link&select=valor"))?.[0]?.valor ?? "";
    } catch { /* sem link, a tela mostra "fale comigo" */ }

    const servidores = meus.map((g) => {
      const s = porGuild.get(String(g.id));
      const p = s ? planoDe(s) : null;
      return {
        guild_id: String(g.id),
        nome: s?.nome || g.name || "",
        icone: g.icon
          ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
          : null,
        instalado: !!s,
        plano: p?.plano ?? null,
        ate: p?.ate ?? null,
        motivo: p?.motivo ?? "",
        assinado: !!s?.stripe_assinatura,
        /* O id do servidor só viaja pendurado no link de pagamento, que é
           onde ele precisa estar: é ele que a função do Stripe usa depois
           para saber quem pagou. */
        pagar: s && linkBase && !s.stripe_assinatura
          ? `${linkBase}${linkBase.includes("?") ? "&" : "?"}client_reference_id=${encodeURIComponent(s.id)}`
          : null,
      };
    }).sort((a, b) => Number(b.instalado) - Number(a.instalado) || a.nome.localeCompare(b.nome));

    return new Response(JSON.stringify({
      usuario: {
        nome: user?.global_name || user?.username || "",
        avatar: user?.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
          : null,
      },
      servidores,
    }), { status: 200, headers: cab });
  } catch (e) {
    console.error("entrar: falhei ao montar a lista:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ erro: "não consegui montar sua lista agora" }),
      { status: 500, headers: cab });
  } finally {
    /* No finally: mesmo que a montagem da lista estoure, o token da pessoa
       volta para o Discord. */
    await devolverToken(token);
  }
});
