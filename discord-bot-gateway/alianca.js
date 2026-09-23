/* A alianca [TOP] Best: o que o CYRON faz SO' no servidor da alianca do dono.

   O CYRON nasceu como o bot desta alianca e virou produto. O que era da
   alianca continuou dentro do index.js, misturado com o que todo cliente
   recebe -- e quem lia o arquivo nao sabia o que era produto e o que era
   coisa de casa. Agora mora aqui, separado:

     - o cartao de boas-vindas com GIF (quem entra no servidor)
     - o seletor de idioma embaixo do aviso de boas-vindas do portal
     - o GIF de rosas quando alguem fala da Lady ou da Maelle
     - os comandos /portal, /player, /settings, /events e /ranking

   Tudo aqui desiste sozinho em servidor sem alianca ligada (tabela
   alianca_discord): cliente do CYRON nunca ve nada disto. Nada daqui mudou
   de comportamento na mudanca -- so' de endereco.

   O index.js chama `ligarAlianca` uma vez, entregando o que este arquivo usa
   de la' (banco, resposta traduzida, menu de idioma). Assim nao ha' import
   circular, e este arquivo nao sabe nada do resto do bot. */

let d = null;
export function ligarAlianca(dependencias) { d = dependencias; }

export const COMANDOS_DA_ALIANCA = new Set(["portal", "player", "settings", "events", "ranking"]);

const PORTAL = "https://portal-alianca.github.io/";
const FONTE_JOGO = "https://kingshotstats.com";

const cacheAlianca = new Map(); // guildId -> { v, t }
async function aliancaDoGuild(guildId) {
  const achado = cacheAlianca.get(guildId);
  if (achado && Date.now() - achado.t < 5 * 60 * 1000) return achado.v;
  let v = null;
  try {
    const r = await d.sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guildId)}&select=alianca_id`);
    v = r?.[0]?.alianca_id ?? null;
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheAlianca.set(guildId, { v, t: Date.now() });
  return v;
}

/* GIF e' de quem o cadastrou.

   A tabela era lida sem filtro, entao as duas aliancas dividiam os mesmos
   quatro GIFs. Hoje nao doi -- so' a [TOP] tem servidor ligado --, mas doeria
   na primeira vez que a outra ligasse, e do jeito mais estranho possivel:
   piada interna de uma aparecendo no servidor da outra.

   Sem alianca na mao, nao devolvo GIF nenhum. Nao ter GIF e' um recurso a
   menos; ter o GIF errado e' um constrangimento. */
const cacheGifRosas = new Map(); // aliancaId -> { v, t }
async function gifRosas(aliancaId) {
  if (!aliancaId) return null;
  const guardado = cacheGifRosas.get(aliancaId);
  if (guardado && Date.now() - guardado.t < 10 * 60 * 1000) return guardado.v;
  let v = null;
  try {
    const r = await d.sb(
      `discord_gifs?alianca_id=eq.${encodeURIComponent(aliancaId)}&uso=eq.rosas&ativo=eq.true&select=url&limit=1`);
    v = r?.[0]?.url ?? null;
  } catch { /* sem gif por enquanto, sem problema */ }
  cacheGifRosas.set(aliancaId, { v, t: Date.now() });
  return v;
}

async function gifBoasVindas(aliancaId) {
  if (!aliancaId) return null;
  try {
    const r = await d.sb(
      `discord_gifs?alianca_id=eq.${encodeURIComponent(aliancaId)}&uso=eq.boas_vindas&ativo=eq.true&select=url`);
    const opcoes = (r || []).map((x) => x.url).filter(Boolean);
    return opcoes.length ? opcoes[Math.floor(Math.random() * opcoes.length)] : null;
  } catch {
    return null;
  }
}

async function tagDaAlianca(aliancaId) {
  try {
    const r = await d.sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=aliancas(tag,nome)`);
    const a = r?.[0]?.aliancas;
    return a ? `${a.tag ?? ""} ${a.nome ?? ""}`.trim() : "aliança";
  } catch {
    return "aliança";
  }
}


function idDoWebhook(url) {
  const m = String(url || "").match(/\/webhooks\/(\d+)\//);
  return m ? m[1] : null;
}

const cacheWebhooks = new Map(); // aliancaId -> { v: {webhook, webhook_boas_vindas}, t }
async function webhookEhBoasVindas(aliancaId, webhookId) {
  let achado = cacheWebhooks.get(aliancaId);
  if (!achado || Date.now() - achado.t > 5 * 60 * 1000) {
    let cfg = {};
    try {
      const r = await d.sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=webhook,webhook_boas_vindas`);
      cfg = r?.[0] || {};
    } catch { /* tenta de novo na proxima */ }
    achado = { v: cfg, t: Date.now() };
    cacheWebhooks.set(aliancaId, achado);
  }
  const alvo = idDoWebhook(achado.v.webhook_boas_vindas) || idDoWebhook(achado.v.webhook);
  return !!alvo && alvo === String(webhookId);
}

/* O aviso de boas-vindas sai por um webhook (nao pelo bot), entao a gente
   detecta esse post e responde por baixo com o seletor -- assim quem acabou
   de entrar ja recebe o convite pra escolher o idioma na hora. */
async function talvezMandarSeletorIdioma(msg) {
  try {
    const aliancaId = await aliancaDoGuild(msg.guild.id);
    if (!aliancaId) return;
    if (!(await webhookEhBoasVindas(aliancaId, msg.webhookId))) return;
    await msg.reply({
      content: "🌐 Select your language / Escolha seu idioma:",
      components: d.menuIdioma(),
      allowedMentions: { repliedUser: false },
    });
  } catch (e) {
    console.error("erro ao mandar seletor de idioma:", e?.message || e);
  }
}

/* Descobre o canal de boas-vindas a partir do webhook salvo -- so a URL fica
   guardada, entao pergunta pro proprio Discord qual canal ela aponta. */
const cacheCanalBv = new Map(); // aliancaId -> { v: channelId|null, t }
async function canalBoasVindas(aliancaId) {
  const achado = cacheCanalBv.get(aliancaId);
  if (achado && Date.now() - achado.t < 30 * 60 * 1000) return achado.v;
  let v = null;
  try {
    const cfg = await d.sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=webhook,webhook_boas_vindas`);
    const url = cfg?.[0]?.webhook_boas_vindas || cfg?.[0]?.webhook;
    if (url) {
      const r = await fetch(url);
      if (r.ok) v = (await r.json())?.channel_id ?? null;
    }
  } catch { /* tenta de novo na proxima */ }
  cacheCanalBv.set(aliancaId, { v, t: Date.now() });
  return v;
}


/* ---------------- mencao a Lady / Maelle ---------------- */

function normalizar(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function mencionaLadyOuMaelle(texto) {
  return /\b(lady|maelle)\b/.test(normalizar(texto));
}




function fmtPoder(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}

function proximaOcorrencia(horaUtc, diaSemana) {
  const [h, m] = String(horaUtc).split(":").map(Number);
  const agora = new Date();
  for (let d = 0; d < 8; d++) {
    const t = new Date(Date.UTC(
      agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + d, h, m || 0, 0));
    if (t.getTime() <= agora.getTime()) continue;
    if (diaSemana === null || diaSemana === undefined || t.getUTCDay() === diaSemana) return t;
  }
  return null;
}

async function aliancaCompleta(guildId) {
  if (!guildId) return null;
  const r = await d.sb(
    `alianca_discord?guild_id=eq.${encodeURIComponent(guildId)}&select=alianca_id,aliancas(id,tag,nome,servidor)`);
  return r?.[0] || null;
}

function tagBonita(a) {
  if (!a?.tag) return "Aliança";
  return /^\[.*\]$/.test(a.tag) ? a.tag : `[${a.tag}]`;
}

/* ---------------- os comandos do portal do Kingshot ------------------------

   Mesma logica que estava na funcao HTTP, com uma diferenca boa: aqui nao
   preciso montar PATCH pra webhook de resposta nem contar os tres segundos na
   mao -- deferReply e editReply do discord.js fazem isso. */

async function embedEventos(aliancaId, tag) {
  /* Dois modelos de agenda convivem: proxima_em guarda a data exata da proxima
     vez (o Urso recarrega em ~47h30 e o dia anda pelo calendario), e
     hora_utc/dia_semana cobrem o que e' mesmo semanal. Tendo as duas, a data
     exata manda. */
  const evs = await d.sb(
    `top_eventos?alianca_id=eq.${aliancaId}&ativa=eq.true&select=titulo,hora_utc,dia_semana,proxima_em&order=ordem`);
  const agora = Date.now();
  const proximos = (evs || [])
    .map((e) => ({
      titulo: e.titulo,
      quando: e.proxima_em ? new Date(e.proxima_em)
        : (e.hora_utc ? proximaOcorrencia(e.hora_utc, e.dia_semana) : null),
    }))
    /* Data marcada que ja passou some em vez de aparecer como se fosse futura:
       ate o oficial remarcar, nao ha o que prometer. */
    .filter((e) => e.quando && e.quando.getTime() > agora)
    .sort((a, b) => a.quando - b.quando)
    .slice(0, 8);

  if (!proximos.length) {
    return { title: "📅 Agenda da aliança",
      description: `Nenhum evento com horário marcado ainda.\nOs oficiais marcam no [portal](${PORTAL}).` };
  }
  return {
    title: `📅 Próximos eventos — ${tag}`,
    description: proximos.map((e) => {
      const s = Math.floor(e.quando.getTime() / 1000);
      return `**${e.titulo}**\n<t:${s}:R> · <t:${s}:t>`;
    }).join("\n\n"),
    footer: { text: "O horário aparece no seu fuso automaticamente" },
  };
}

async function rankingDoJogo(reino, sigla, quantos, tag) {
  const slug = String(sigla || "").replace(/[^a-zA-Z0-9]/g, "");
  const kid = parseInt(String(reino || ""), 10);
  if (!kid || !slug) return null;
  const r = await fetch(`${FONTE_JOGO}/api/alliances/lookup?kid=${kid}&slug=${encodeURIComponent(slug)}`,
    { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const d = await r.json();
  const membros = d?.members || [];
  if (!membros.length) return null;

  const ord = membros.slice().sort((a, b) => (b.power || 0) - (a.power || 0));
  const medalha = ["🥇", "🥈", "🥉"];
  const mostra = ord.slice(0, quantos);
  const total = ord.reduce((soma, m) => soma + (Number(m.power) || 0), 0);
  return {
    title: `⚡ Ranking da aliança — ${tag}`,
    description: mostra.map((m, i) =>
      `${medalha[i] || `**${i + 1}**`} ${m.nick_name} — \`${fmtPoder(m.power)}\``).join("\n"),
    footer: { text: `Mostrando ${mostra.length} de ${ord.length} membros · Poder total ${fmtPoder(total)}` +
      (ord.length > mostra.length ? ` · use /ranking amount:${Math.min(ord.length, 100)} pra ver todos` : "") },
  };
}

async function rankingDoPortal(aliancaId, tag) {
  const ms = await d.sb(
    `top_membros?alianca_id=eq.${aliancaId}&poder=gt.0&status=neq.saiu&select=nome,poder,castelo&order=poder.desc&limit=25`);
  if (!ms?.length) {
    return { title: "⚡ Ranking de poder",
      description: `Não consegui a lista agora, e ninguém tem poder registrado no [portal](${PORTAL}) ainda.` };
  }
  const medalha = ["🥇", "🥈", "🥉"];
  return {
    title: `⚡ Ranking de poder — ${tag}`,
    description: ms.map((m, i) =>
      `${medalha[i] || `**${i + 1}**`} ${m.nome} — \`${fmtPoder(m.poder)}\`${m.castelo ? ` · CV${m.castelo}` : ""}`).join("\n"),
    footer: { text: "Lista do portal (a do jogo não respondeu agora)" },
  };
}

async function embedJogador(fid) {
  try {
    const r = await fetch(`${FONTE_JOGO}/api/search?q=${encodeURIComponent(fid)}&limit=5&live=1`,
      { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const m = (d?.results || []).find((x) => String(x.fid) === fid);
    if (!m) {
      return { title: "🤔 Não achei esse ID",
        description: `Nada encontrado para \`${fid}\`. Confira o número no perfil do jogo.` };
    }
    return {
      title: `👤 ${m.nick_name}`,
      thumbnail: m.avatar_url ? { url: m.avatar_url } : undefined,
      fields: [
        { name: "Poder", value: fmtPoder(m.power), inline: true },
        { name: "Castelo", value: String(m.stove_lv ?? m.town_center_level ?? "—"), inline: true },
        { name: "Reino", value: String(m.kid ?? "—"), inline: true },
        { name: "Aliança", value: m.alliance_abbr ? `[${m.alliance_abbr}] ${m.alliance_name ?? ""}` : "—", inline: true },
      ],
    };
  } catch {
    return { title: "❌ Deu ruim na consulta",
      description: "Não consegui buscar esse jogador agora. Tente de novo em instantes." };
  }
}

/* Toda imagem vira arquivo nosso, venha de anexo ou de link.

   Dois motivos ja vistos na pratica: o Discord nao carrega imagem do Tenor
   dentro de embed (testado lado a lado, so a do nosso dominio apareceu), e a
   URL de anexo do Discord vem assinada e caduca em poucas horas -- guardar o
   link faria a imagem sumir sozinha depois. */
const BALDE = "top-midia";
const MAX_MIDIA = 20 * 1024 * 1024;

async function reHospedar(url, prefixo) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("baixar");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_MIDIA) throw new Error("grande");
  const base = decodeURIComponent(url.split("?")[0].split("/").pop() || "midia")
    .replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60);
  const caminho = `${prefixo}-${Date.now()}-${base}`;
  const up = await fetch(`${d.SB_URL}/storage/v1/object/${BALDE}/${caminho}`, {
    method: "POST",
    headers: {
      apikey: d.SB_KEY, Authorization: `Bearer ${d.SB_KEY}`,
      "Content-Type": r.headers.get("content-type") || "application/octet-stream",
    },
    body: buf,
  });
  if (!up.ok) throw new Error("subir");
  return `${d.SB_URL}/storage/v1/object/public/${BALDE}/${caminho}`;
}

async function midiaDaOpcao(inter, prefixo) {
  const anexo = inter.options.getAttachment("file");
  if (anexo) {
    if (Number(anexo.size) > MAX_MIDIA) throw new Error("grande");
    return await reHospedar(anexo.url, prefixo);
  }
  const link = String(inter.options.getString("link") || "").trim();
  if (!link) return null;
  if (!/^https:\/\/\S+$/i.test(link)) throw new Error("link");
  if (link.startsWith(`${d.SB_URL}/storage/`)) return link;  // ja e' nosso
  return await reHospedar(link, prefixo);
}


async function comandoSettings(inter) {
  const guild = inter.guildId;
  const sub = inter.options.getSubcommand();

  if (sub === "server") {
    const r = await d.rpc("discord_ligar_servidor", { p_guild: guild, p_codigo: String(inter.options.getString("code") || "") });
    return r?.ok
      ? { color: d.COR_OK, title: "🔗 Servidor ligado!",
          description: `Este Discord agora responde pela **${r.tag ?? ""} ${r.nome ?? ""}**.\nJá pode usar \`/ranking\` e \`/events\`.` }
      : { title: "❌ Não deu", description: {
            codigo: "Esse código de oficial não confere com nenhuma aliança.",
            guild: "Não consegui identificar este servidor.",
            guild_usado: "Este servidor já está ligado a outra aliança.",
          }[r?.erro] ?? "Tente de novo em instantes." };
  }

  if (sub === "event-gif") {
    const titulo = String(inter.options.getString("event") || "").trim();
    const url = await midiaDaOpcao(inter, "evento");
    const r = await d.rpc("discord_gif_evento", { p_guild: guild, p_titulo: titulo, p_url: url });
    return r?.ok
      ? { color: d.COR_OK, title: url ? "🖼️ GIF definido!" : "🧹 GIF removido",
          description: `**${titulo}**` + (url ? "\nVai aparecer no aviso deste evento." : "\nO aviso volta a ser só texto."),
          ...(url ? { image: { url } } : {}) }
      : { title: "❌ Não deu", description: {
            sem_vinculo: "Este servidor ainda não está ligado a uma aliança. Use `/settings server` primeiro.",
            evento: `Não achei um evento chamado **${titulo}** nesta aliança.`,
          }[r?.erro] ?? "Tente de novo em instantes." };
  }

  if (sub === "welcome-gif") {
    const limpar = inter.options.getBoolean("clear") === true;
    const url = limpar ? null : await midiaDaOpcao(inter, "boasvindas");
    if (!limpar && !url) {
      return { title: "🤔 Faltou a imagem",
        description: "Mande um **arquivo** ou um **link**. Ou use `clear: true` pra apagar os atuais." };
    }
    const r = await d.rpc("discord_gif_boas_vindas", { p_guild: guild, p_url: url, p_limpar: limpar });
    if (!r?.ok) {
      return { title: "❌ Não deu", description: r?.erro === "sem_vinculo"
        ? "Este servidor ainda não está ligado a uma aliança. Use `/settings server` primeiro."
        : "Tente de novo em instantes." };
    }
    return limpar
      ? { color: d.COR_OK, title: "🧹 GIFs de boas-vindas apagados", description: "As boas-vindas passam a ser só texto." }
      : { color: d.COR_OK, title: "🎉 GIF de boas-vindas somado!",
          description: `Agora são **${r.total}** no sorteio.`, image: { url } };
  }

  /* view */
  const v = await aliancaCompleta(guild);
  if (!v) {
    return { title: "🔗 Servidor não ligado",
      description: "Use `/settings server code:<código de oficial>` pra começar." };
  }
  const a = v.aliancas || {};
  const evs = await d.sb(`top_eventos?alianca_id=eq.${v.alianca_id}&ativa=eq.true&select=titulo,gif_url&order=ordem`);
  const gifs = await d.sb(`discord_gifs?alianca_id=eq.${encodeURIComponent(v.alianca_id)}&uso=eq.boas_vindas&ativo=eq.true&select=id`);
  const cfg = await d.sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guild)}&select=webhook,webhook_boas_vindas`);
  const comGif = (evs || []).filter((e) => e.gif_url);
  return {
    title: `⚙️ Configuração — ${a.tag ?? ""} ${a.nome ?? ""}`,
    fields: [
      { name: "Canal de avisos", value: cfg?.[0]?.webhook ? "✅ ligado" : "❌ sem webhook", inline: true },
      { name: "Canal de boas-vindas", value: cfg?.[0]?.webhook_boas_vindas ? "✅ ligado" : "— usa o de avisos", inline: true },
      { name: "GIFs de boas-vindas", value: String((gifs || []).length), inline: true },
      { name: "Eventos com GIF", value: `${comGif.length} de ${(evs || []).length}` },
      { name: "Quais têm GIF", value: comGif.length ? comGif.map((e) => `• ${e.titulo}`).join("\n").slice(0, 1000) : "—" },
    ],
  };
}


/* ---------------- quem entra no servidor ---------------- */

/* O cartao de boas-vindas do Kingshot. Vem DEPOIS do convite de idioma, que
   e' do CYRON e vale em qualquer servidor. */
export async function boasVindasDaAlianca(member, quem) {
  const aliancaId = await aliancaDoGuild(member.guild.id);
  if (!aliancaId) {
    /* Nao e' erro: e' o estado NORMAL de quem instalou o CYRON so' pelo
       tradutor e nunca ligou alianca nenhuma. Como erro, ele enchia o canal
       do dono toda vez que alguem entrava num servidor desses -- e erro que
       aparece sem nada pra consertar ensina a ignorar o canal. */
    return console.log(`boas-vindas ${quem}: ${member.guild.name} não tem aliança ligada, sem cartão de entrada`);
  }
  const canalId = await canalBoasVindas(aliancaId);
  if (!canalId) {
    return console.error(`boas-vindas ${quem}: nao achei o canal (webhook de boas-vindas caiu ou nao esta configurado)`);
  }
  const canal = await member.guild.channels.fetch(canalId).catch((e) => {
    console.error(`boas-vindas ${quem}: nao consegui abrir o canal ${canalId}:`, e?.message || e);
    return null;
  });
  if (!canal) return;
  if (!canal.isTextBased?.()) {
    return console.error(`boas-vindas ${quem}: o canal ${canalId} nao aceita mensagem`);
  }

  const [gif, tag] = await Promise.all([gifBoasVindas(aliancaId), tagDaAlianca(aliancaId)]);
  await canal.send({
    embeds: [{
      title: `🎉 Boas-vindas, ${quem}!`,
      description: `Entrou na **${tag}**. Bem-vindo(a) ao time!`,
      color: 6208835,
      ...(gif ? { image: { url: gif } } : {}),
      footer: { text: "🌐 Escolha seu idioma abaixo / Pick your language below" },
    }],
    components: d.menuIdioma(),
  }).then(
    () => console.log(`boas-vindas: ${quem} recebido em #${canal.name}`),
    (e) => console.error(`boas-vindas ${quem}: o Discord recusou o envio em #${canal.name} (falta permissao no canal?):`, e?.message || e),
  );
}

/* O aviso de boas-vindas do portal sai por webhook; embaixo dele, o seletor. */
export async function seletorNasBoasVindas(msg) {
  const aliancaId = await aliancaDoGuild(msg.guild.id);
  if (aliancaId && await webhookEhBoasVindas(aliancaId, msg.webhookId)) await talvezMandarSeletorIdioma(msg);
}

/* A piada das rosas. */
export async function rosasDaAlianca(msg, texto) {
  const aliancaId = await aliancaDoGuild(msg.guild.id);
  if (aliancaId && mencionaLadyOuMaelle(texto)) {
    const url = await gifRosas(aliancaId);
    if (url) msg.reply({ files: [url], allowedMentions: { repliedUser: false } }).catch(() => {});
  }
}

/* ---------------- os comandos ---------------- */

export async function comandoDaAlianca(inter, lingua) {
  const nome = inter.commandName;

  if (nome === "portal") {
    return d.responder(inter, { title: "🏰 Portal da Aliança",
      description: `Agenda no seu fuso, tutoriais dos eventos e ranking.\n\n${PORTAL}` },
      { efemera: false, idioma: await lingua() });
  }

  if (nome === "player") {
    const fid = String(inter.options.getString("id") || "").trim();
    if (!/^\d{5,15}$/.test(fid)) {
      return d.responder(inter, { title: "🤔 ID estranho",
        description: "O ID do jogo é só números. Veja no seu perfil dentro do jogo." }, { idioma: await lingua() });
    }
    await inter.deferReply();
    return d.responder(inter, await embedJogador(fid), { idioma: await lingua() });
  }

  if (nome === "settings") {
    await inter.deferReply({ flags: 64 });   // so quem mandou ve
    let embed;
    try {
      embed = await comandoSettings(inter);
    } catch (e) {
      const m = String(e?.message || "");
      embed = { title: "❌ Não deu", description:
        m === "grande" ? "Esse arquivo passa de 20 MB. Mande um menor ou use um link."
        : m === "link" ? "O link precisa começar com `https://`."
        : m === "baixar" ? "Não consegui baixar essa imagem. Confira se o link abre direto no arquivo."
        : m === "subir" ? "Baixei o arquivo mas não consegui guardar. Tente de novo."
        : "Algo falhou. Tente de novo em instantes." };
    }
    return d.responder(inter, embed, { idioma: await lingua() });
  }

  /* Daqui pra baixo precisa de alianca ligada. */
  const vinculo = await aliancaCompleta(inter.guildId);
  if (!vinculo) {
    return d.responder(inter, {
      title: "🔗 Falta ligar este servidor à aliança",
      description: "Um oficial resolve aqui mesmo:\n\n`/settings server code:<código de oficial>`\n\n" +
        `O código está no [portal](${PORTAL}), em **Painel do oficial → Minha aliança**.`,
    }, { idioma: await lingua() });
  }
  const tag = tagBonita(vinculo.aliancas || {});

  if (nome === "events") {
    await inter.deferReply();
    return d.responder(inter, await embedEventos(vinculo.alianca_id, tag), { idioma: await lingua() });
  }

  if (nome === "ranking") {
    let quantos = inter.options.getInteger("amount") ?? 15;
    quantos = Math.max(1, Math.min(100, quantos));
    await inter.deferReply();
    const a = vinculo.aliancas || {};
    let embed = null;
    try { embed = await rankingDoJogo(a.servidor, a.tag, quantos, tag); } catch { /* reserva abaixo */ }
    if (!embed) {
      try { embed = await rankingDoPortal(vinculo.alianca_id, tag); }
      catch { embed = { title: "❌ Algo falhou", description: "Não consegui montar o ranking agora." }; }
    }
    return d.responder(inter, embed, { idioma: await lingua() });
  }

  return d.responder(inter, { title: "🤷 Não conheço esse comando" }, { idioma: await lingua() });
}
