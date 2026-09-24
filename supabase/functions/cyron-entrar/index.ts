/* Login com Discord para a area do cliente do CYRON.

   Trocar o `code` do OAuth por um token exige o CLIENT SECRET, e segredo em
   pagina estatica nao e segredo -- qualquer um abre o "ver codigo-fonte" e
   leva. Entao a pagina so carrega o code ate aqui, e o secret nunca sai daqui.

   Nao guarda sessao: nenhum token nosso nasce, entao nenhum token nosso vaza.
   Recarregar refaz o login, e como o Discord lembra a autorizacao isso e um
   clique que a pessoa mal ve. */

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/* O id do aplicativo e o client_id do OAuth sao o MESMO numero, com dois
   nomes. Aceitar os dois, e cair no numero escrito, tira a duvida do caminho.
   Ele nao e segredo: viaja em todo convite do bot. */
const CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID")
  || Deno.env.get("DISCORD_APP_ID")
  || "1498142929041096856";
const CLIENT_SECRET = Deno.env.get("DISCORD_CLIENT_SECRET") ?? "";

/* Lista fechada, e nao "*": com "*" qualquer site do mundo poderia montar uma
   copia da nossa tela de login, receber o code de um cliente nosso e ler os
   servidores dele daqui. */
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
    /* A resposta e sobre UMA pessoa: um cache no meio do caminho entregaria os
       servidores dela para o proximo que perguntasse. */
    "Cache-Control": "no-store",
  };
}

/* "Gerenciar servidor", e nao "dono": em servidor grande quem cuida do bot
   quase nunca e a conta dona -- e um administrador. */
const GERENCIAR_SERVIDOR = 1n << 5n;
/* Administrator entra explicitamente, e nao por consequencia.

   No Discord, Administrator VALE por todas as permissoes, mas o numero que a
   API devolve nem sempre traz os outros bits acesos junto. Olhando so o bit de
   "Gerenciar servidor", um administrador que nao tivesse esse bit marcado a
   mao ficava de fora -- e some da lista o servidor que ele mais administra,
   sem erro nenhum aparecer. Foi assim que tres servidores apareceram onde
   deviam aparecer mais. */
const ADMINISTRADOR = 1n << 3n;

function podeMandar(g: any): boolean {
  if (g?.owner === true) return true;
  try {
    const p = BigInt(g?.permissions ?? "0");
    return (p & GERENCIAR_SERVIDOR) !== 0n || (p & ADMINISTRADOR) !== 0n;
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

/* Mesma conta que o bot faz em planoDe. Confiar so na coluna `plano` mostraria
   "gratis" para quem esta em teste ou acabou de pagar -- que sao exatamente as
   duas horas em que a pessoa olha esta tela. */
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

/* Devolve o token ao Discord assim que termino de usa-lo. Ele vale uma semana
   e da acesso a lista de servidores da pessoa; eu precisei dele por dois
   segundos. Falhar aqui nao quebra nada -- ele expira sozinho. */
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
  if (req.method !== "POST") return new Response("so POST", { status: 405, headers: cab });

  /* Origem desconhecida sai aqui, antes de qualquer trabalho: o navegador ja
     recusaria a resposta sem o cabecalho, mas eu nao quero nem ter gasto uma
     troca de token com o Discord por causa dela. */
  if (!cab["Access-Control-Allow-Origin"]) {
    return new Response(JSON.stringify({ erro: "origem nao liberada" }), { status: 403, headers: cab });
  }
  if (!CLIENT_SECRET) {
    console.error("entrar: falta DISCORD_CLIENT_SECRET nos segredos da funcao");
    return new Response(JSON.stringify({ erro: "login ainda nao configurado" }), { status: 500, headers: cab });
  }

  let code = "", redirect_uri = "";
  try {
    const corpo = await req.json();
    code = String(corpo?.code ?? "");
    redirect_uri = String(corpo?.redirect_uri ?? "");
  } catch { /* cai na validacao abaixo */ }

  if (!code || !redirect_uri) {
    return new Response(JSON.stringify({ erro: "faltou o code" }), { status: 400, headers: cab });
  }
  /* new URL ESTOURA com texto que nao e endereco, e um estouro aqui viraria
     500 -- um campo invalido vindo de fora derrubando a funcao em vez de ser
     recusado por ela. */
  let destino = "";
  try { destino = new URL(redirect_uri).origin; } catch { /* fica vazio */ }
  if (!ORIGENS.has(destino)) {
    return new Response(JSON.stringify({ erro: "destino nao liberado" }), { status: 400, headers: cab });
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
      /* Code ja usado ou expirado e o caso comum (a pessoa recarregou). Nao e
         erro de servidor, e nao deve virar alarme. */
      console.log(`entrar: o Discord recusou o code (${r.status})`);
      return new Response(JSON.stringify({ erro: "login expirou, tente de novo" }), { status: 401, headers: cab });
    }
    token = (await r.json())?.access_token ?? "";
  } catch (e) {
    console.error("entrar: falhei ao falar com o Discord:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ erro: "o Discord nao respondeu" }), { status: 502, headers: cab });
  }
  if (!token) return new Response(JSON.stringify({ erro: "login expirou, tente de novo" }), { status: 401, headers: cab });

  try {
    const como = { headers: { Authorization: `Bearer ${token}` } };
    const [rUser, rGuilds] = await Promise.all([
      fetch("https://discord.com/api/users/@me", como),
      fetch("https://discord.com/api/users/@me/guilds", como),
    ]);
    if (!rUser.ok || !rGuilds.ok) {
      return new Response(JSON.stringify({ erro: "o Discord nao deixou ler seus servidores" }),
        { status: 502, headers: cab });
    }
    const user = await rUser.json();
    const guilds: any[] = await rGuilds.json();

    /* A unica checagem de autorizacao da funcao, e ela vem do proprio Discord:
       a lista ja chega filtrada para a conta que autorizou. */
    const meus = (Array.isArray(guilds) ? guilds : []).filter(podeMandar);

    let instalados: any[] = [];
    if (meus.length) {
      const ids = meus.map((g) => `"${String(g.id).replace(/[^0-9]/g, "")}"`).join(",");
      /* Colunas a dedo, nunca select=*: a linha do servidor carrega a chave de
         tradutor cifrada do cliente, e um * a mandaria para o navegador. */
      instalados = await sb(
        `cyron_servidor?guild_id=in.(${ids})&select=id,guild_id,nome,plano,pago_ate,teste_ate,stripe_assinatura,nivel`,
      );
    }
    const porGuild = new Map(instalados.map((s: any) => [String(s.guild_id), s]));

    /* O mesmo Payment Link que o bot usa, guardado nos ajustes. Nenhuma
       credencial do Stripe passa por aqui. Vazio quer dizer que ninguem
       cadastrou ainda -- e a pagina precisa DIZER isso, nao mandar a pessoa
       para uma tabela de precos que a traz de volta. */
    /* Dois links, um por linha, como o bot le: 1a Alianca, 2a Pro. Juntar as
       duas linhas num endereco so' daria um link quebrado. */
    let linkBase = "", linkPro = "";
    try {
      const v = (await sb("cyron_ajuste?chave=eq.stripe_link&select=valor"))?.[0]?.valor ?? "";
      [linkBase = "", linkPro = ""] = String(v).split(/\s*\n\s*/).map((l: string) => l.trim());
    } catch { /* sem link, a tela diz que a assinatura nao esta disponivel */ }
    const comServidor = (link: string, s: any) =>
      `${link}${link.includes("?") ? "&" : "?"}client_reference_id=${encodeURIComponent(s.id)}`;

    const servidores = meus.map((g) => {
      const s = porGuild.get(String(g.id));
      const p = s ? planoDe(s) : null;
      return {
        guild_id: String(g.id),
        nome: s?.nome || g.name || "",
        icone: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        instalado: !!s,
        plano: p?.plano ?? null,
        ate: p?.ate ?? null,
        motivo: p?.motivo ?? "",
        assinado: !!s?.stripe_assinatura,
        /* O id do servidor so viaja pendurado no link de pagamento, que e onde
           ele precisa estar: e ele que a funcao do Stripe usa depois para
           saber quem pagou. */
        nivel: s?.nivel === "pro" ? "pro" : "alianca",
        pagar: s && linkBase && !s.stripe_assinatura ? comServidor(linkBase, s) : null,
        pagarPro: s && linkPro && !s.stripe_assinatura ? comServidor(linkPro, s) : null,
      };
    }).sort((a, b) => Number(b.instalado) - Number(a.instalado) || a.nome.localeCompare(b.nome));

    return new Response(JSON.stringify({
      usuario: {
        nome: user?.global_name || user?.username || "",
        avatar: user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
      },
      servidores,
    }), { status: 200, headers: cab });
  } catch (e) {
    console.error("entrar: falhei ao montar a lista:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ erro: "nao consegui montar sua lista agora" }),
      { status: 500, headers: cab });
  } finally {
    /* No finally: mesmo que a montagem estoure, o token da pessoa volta. */
    await devolverToken(token);
  }
});
