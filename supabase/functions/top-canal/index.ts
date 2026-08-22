/* Cria canal no Discord e liga ele no portal, num clique.

   Antes o oficial fazia tudo na mão: criava o canal no Discord, entrava em
   Editar canal → Integrações → Webhooks → Novo webhook, copiava a URL e
   colava no painel. Cinco telas pra uma coisa que o bot faz sozinho.

   Por que uma função separada e não o top-discord: criar canal é ação do bot
   (precisa do token dele), e o top-discord é grande e atende as interações do
   Discord. Mexer nele pra isso seria arriscar o que já funciona. Aqui a
   superfície é pequena e o painel chama direto.

   Autenticação: o mesmo código de oficial que o top-admin já exige. Sem ele
   nada acontece -- por isso verify_jwt fica desligado, igual ao top-admin. */

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const APP_ID = Deno.env.get("DISCORD_APP_ID") ?? "1498142929041096856";

/* A credencial do bot vem do ambiente ou da tabela discord_segredo.

   O ambiente ganha quando existe -- é o lugar canônico. A tabela existe
   porque cadastrar segredo no dashboard do Supabase exige abrir o painel num
   navegador e colar setenta caracteres, e quem administra a aliança faz tudo
   pelo celular. A tabela não tem grant pra anon nem authenticated.

   Guardado em memória porque a mesma instância atende várias chamadas, e ir
   ao banco a cada clique não muda nada além da latência. */
let tokenGuardado: string | null = null;
async function pegarToken(supa: any): Promise<string> {
  if (tokenGuardado !== null) return tokenGuardado;
  const doAmbiente = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
  if (doAmbiente) { tokenGuardado = doAmbiente; return tokenGuardado; }
  const { data } = await supa.from("discord_segredo").select("valor")
    .eq("chave", "discord_bot_token").maybeSingle();
  /* So guarda o que veio preenchido: cachear vazio faria a instancia insistir
     em "nao tem" mesmo depois de alguem cadastrar. */
  const v: string = data?.valor ?? "";
  if (v) tokenGuardado = v;
  return v;
}

async function discordApi(token: string, caminho: string, init?: RequestInit) {
  const r = await fetch(`https://discord.com/api/v10${caminho}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, dados: txt ? JSON.parse(txt) : null };
}

/* O Discord troca espaço por hífen e derruba maiúscula ao criar o canal. Se
   eu guardasse o nome como a pessoa digitou, o canal no Discord e o nome no
   portal ficariam diferentes e ninguém entenderia por quê.

   O NFD antes de limpar é o que salva os acentos: sem ele "Arena Diária"
   viraria "arena-diria", porque o "á" cairia inteiro em vez de virar "a". */
function nomeDeCanal(bruto: string) {
  return String(bruto || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 30);
}

/* Reaproveita canal que já existe em vez de recusar: depois da primeira vez,
   o caso comum é ligar ao portal um canal que a aliança já tinha. */
async function acharOuCriarCanal(token: string, guild: string, nome: string) {
  const lista = await discordApi(token, `/guilds/${guild}/channels`);
  if (!lista.ok) return { erro: lista.status === 403 ? "permissao" : "discord" };

  const achado = (lista.dados || []).find((c: any) => c.type === 0 && c.name === nome);
  if (achado) return { canal: achado, jaExistia: true };

  const novo = await discordApi(token, `/guilds/${guild}/channels`, {
    method: "POST",
    body: JSON.stringify({ name: nome, type: 0 }),
  });
  if (!novo.ok) return { erro: novo.status === 403 ? "permissao" : "discord" };
  return { canal: novo.dados, jaExistia: false };
}

/* Um webhook por canal, sempre o mesmo: criar outro a cada clique encheria o
   canal de webhooks órfãos que ninguém limpa. */
async function acharOuCriarWebhook(token: string, canalId: string) {
  const lista = await discordApi(token, `/channels/${canalId}/webhooks`);
  if (lista.ok) {
    const meu = (lista.dados || []).find((w: any) => w.application_id === APP_ID && w.token);
    if (meu) return { url: `https://discord.com/api/webhooks/${meu.id}/${meu.token}` };
  }
  const novo = await discordApi(token, `/channels/${canalId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ name: "CYRON" }),
  });
  if (!novo.ok) return { erro: novo.status === 403 ? "permissao" : "discord" };
  return { url: `https://discord.com/api/webhooks/${novo.dados.id}/${novo.dados.token}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: cfg } = await supa.from("top_config").select("valor").eq("chave", "codigo_oficial").maybeSingle();
    const code = cfg?.valor;
    if (!code || String(body.codigo ?? "").trim() !== String(code)) return json({ erro: "codigo" }, 403);

    const token = await pegarToken(supa);
    if (!token) return json({ erro: "sem_token" }, 400);

    const nome = nomeDeCanal(body.nome);
    if (nome.length < 2) return json({ erro: "nome" }, 400);

    const { data: liga } = await supa.from("alianca_discord")
      .select("guild_id").eq("alianca_id", body.alianca_id).maybeSingle();
    const guild = liga?.guild_id;
    if (!guild) return json({ erro: "sem_vinculo" }, 400);

    const r1 = await acharOuCriarCanal(token, String(guild), nome);
    if (r1.erro) return json({ erro: r1.erro }, 400);

    const r2 = await acharOuCriarWebhook(token, r1.canal.id);
    /* Canal criado mas sem webhook não serve pra nada e ainda deixa lixo no
       Discord. Devolvo o id pra mensagem poder dizer qual canal ficou pela
       metade, em vez de um erro solto. */
    if (r2.erro) return json({ erro: r2.erro, etapa: "webhook", canal_id: r1.canal.id }, 400);

    const { data: salvo } = await supa.rpc("discord_canal_do_guild", {
      p_guild: guild, p_nome: nome, p_webhook: r2.url,
    });
    if (!salvo?.ok) return json({ erro: salvo?.erro ?? "salvar" }, 400);

    return json({ ok: true, nome, canal_id: r1.canal.id, ja_existia: r1.jaExistia });
  } catch (e) {
    return json({ erro: String(e) }, 400);
  }
});
