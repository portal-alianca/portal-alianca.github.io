/* Bot de conexao permanente da alianca [TOP] Best.
 *
 * Diferente do "top-discord" (Supabase Edge Function, que so responde a
 * /comandos via HTTP), este processo fica conectado o tempo todo no gateway
 * do Discord porque precisa LER as mensagens do chat pra:
 *   1) traduzir automaticamente o que os jogadores escrevem em outro idioma
 *   2) reagir com o GIF de rosas quando alguem menciona a Lady ou a Maelle
 *
 * Roda em qualquer host que mantenha um processo Node vivo (Fly.io, Railway,
 * uma VPS, etc). Nao guarda nenhum segredo no codigo: tudo vem de variavel
 * de ambiente (ver .env.example).
 */

import { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [nome, valor] of Object.entries({ DISCORD_BOT_TOKEN: TOKEN, SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY })) {
  if (!valor) {
    console.error(`Faltou a variavel de ambiente ${nome}. Confira o .env / os secrets do host.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

/* ---------------- Supabase (mesmo padrao do top-discord) ---------------- */

async function sb(caminho) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return await r.json();
}

async function sbPost(caminho, corpo) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return await r.json();
}

const cacheAlianca = new Map(); // guildId -> { v, t }
async function aliancaDoGuild(guildId) {
  const achado = cacheAlianca.get(guildId);
  if (achado && Date.now() - achado.t < 5 * 60 * 1000) return achado.v;
  let v = null;
  try {
    const r = await sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guildId)}&select=alianca_id`);
    v = r?.[0]?.alianca_id ?? null;
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheAlianca.set(guildId, { v, t: Date.now() });
  return v;
}

let cacheGifRosas = { v: null, t: 0 };
async function gifRosas() {
  if (cacheGifRosas.v && Date.now() - cacheGifRosas.t < 10 * 60 * 1000) return cacheGifRosas.v;
  let v = null;
  try {
    const r = await sb(`discord_gifs?uso=eq.rosas&ativo=eq.true&select=url&limit=1`);
    v = r?.[0]?.url ?? null;
  } catch { /* sem gif por enquanto, sem problema */ }
  cacheGifRosas = { v, t: Date.now() };
  return v;
}

async function gifBoasVindas() {
  try {
    const r = await sb(`discord_gifs?uso=eq.boas_vindas&ativo=eq.true&select=url`);
    const opcoes = (r || []).map((x) => x.url).filter(Boolean);
    return opcoes.length ? opcoes[Math.floor(Math.random() * opcoes.length)] : null;
  } catch {
    return null;
  }
}

async function tagDaAlianca(aliancaId) {
  try {
    const r = await sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=aliancas(tag,nome)`);
    const a = r?.[0]?.aliancas;
    return a ? `${a.tag ?? ""} ${a.nome ?? ""}`.trim() : "aliança";
  } catch {
    return "aliança";
  }
}

/* ---------------- seletor de idioma nas boas-vindas ---------------- */

/* Mesma lista (e mesmos codigos) do /meuidioma no bot de comandos -- clicar
   aqui ou digitar o comando salvam na mesma tabela. */
const LINGUAS_MENU = [
  ["pt", "Português", "🇧🇷"], ["en", "Inglês", "🇬🇧"], ["es", "Espanhol", "🇪🇸"], ["ko", "Coreano", "🇰🇷"],
  ["ja", "Japonês", "🇯🇵"], ["zh-CN", "Chinês", "🇨🇳"], ["de", "Alemão", "🇩🇪"], ["fr", "Francês", "🇫🇷"],
  ["it", "Italiano", "🇮🇹"], ["ru", "Russo", "🇷🇺"], ["ar", "Árabe", "🇸🇦"], ["tr", "Turco", "🇹🇷"],
  ["id", "Indonésio", "🇮🇩"], ["th", "Tailandês", "🇹🇭"], ["vi", "Vietnamita", "🇻🇳"], ["pl", "Polonês", "🇵🇱"],
  ["nl", "Holandês", "🇳🇱"], ["tl", "Filipino", "🇵🇭"], ["hi", "Hindi", "🇮🇳"], ["uk", "Ucraniano", "🇺🇦"],
];

function menuIdioma() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("escolher-idioma")
    .setPlaceholder("Selecione seu idioma / Select your language")
    .addOptions(LINGUAS_MENU.map(([value, label, emoji]) => ({ label, value, emoji })));
  return [new ActionRowBuilder().addComponents(select)];
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
      const r = await sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=webhook,webhook_boas_vindas`);
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
      components: menuIdioma(),
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
    const cfg = await sb(`alianca_discord?alianca_id=eq.${aliancaId}&select=webhook,webhook_boas_vindas`);
    const url = cfg?.[0]?.webhook_boas_vindas || cfg?.[0]?.webhook;
    if (url) {
      const r = await fetch(url);
      if (r.ok) v = (await r.json())?.channel_id ?? null;
    }
  } catch { /* tenta de novo na proxima */ }
  cacheCanalBv.set(aliancaId, { v, t: Date.now() });
  return v;
}

/* Quem entra direto pelo Discord (sem passar pelo cadastro do portal) nao
   dispara o gatilho do banco -- esse listener cobre esse caso, mandando o
   mesmo aviso com GIF + seletor de idioma direto pelo bot. */
client.on("guildMemberAdd", async (member) => {
  try {
    /* Cada desistencia daqui pra baixo fala por que. Antes tudo era silencioso
       (`.catch(() => {})`), e quando as boas-vindas pararam nao havia uma linha
       de log dizendo se foi o canal, a permissao ou o vinculo -- so o canal
       vazio. Quem entra no Discord entra uma vez: nao da pra reproduzir depois. */
    const quem = member.displayName || member.user.username;

    const aliancaId = await aliancaDoGuild(member.guild.id);
    if (!aliancaId) {
      return console.error(`boas-vindas ${quem}: servidor ${member.guild.id} nao esta ligado a nenhuma alianca`);
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

    const [gif, tag] = await Promise.all([gifBoasVindas(), tagDaAlianca(aliancaId)]);
    await canal.send({
      embeds: [{
        title: `🎉 Boas-vindas, ${quem}!`,
        description: `Entrou na **${tag}**. Bem-vindo(a) ao time!`,
        color: 6208835,
        ...(gif ? { image: { url: gif } } : {}),
        footer: { text: "🌐 Escolha seu idioma abaixo / Pick your language below" },
      }],
      components: menuIdioma(),
    }).then(
      () => console.log(`boas-vindas: ${quem} recebido em #${canal.name}`),
      (e) => console.error(`boas-vindas ${quem}: o Discord recusou o envio em #${canal.name} (falta permissao no canal?):`, e?.message || e),
    );
  } catch (e) {
    console.error("erro ao dar boas-vindas:", e?.message || e);
  }
});

/* ---------------- traducao ----------------

   O gateway nao traduz nada: ele so decide se a mensagem merece tradutor,
   guarda o texto e pendura o seletor. Quem traduz e' o top-discord (funcao
   do Supabase), quando alguem escolhe um idioma no menu. */

/* Evita gasto/ruido com mensagens que nao valem a pena traduzir: comandos,
   so link, so emoji/numeros, ou muito curtas pra dar pro detector de idioma
   confiar no resultado.

   O teto e' parametro porque depende do destino: traducao que vai pro canal
   para em 800 (acima disso vira parede de texto), mas a que fica atras do
   seletor nao ocupa tela nenhuma, entao pode ir bem mais longe. */
function vantajosoTraduzir(texto, teto = 800) {
  /* O minimo subiu de 2 pra 12 porque agora TODA mensagem ganharia seletor,
     nao so as de outro idioma. "ok", "kkkk", "sim", "boa" nao precisam de
     tradutor -- e uma caixa embaixo de cada uma dessas encheria o canal de
     coisa inutil. Doze caracteres e mais ou menos onde comeca a frase. */
  if (texto.length < 12 || texto.length > teto) return false;
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(texto)) return false;
  if (/^https?:\/\/\S+$/i.test(texto)) return false;
  if (/^[\d\s.,:!?-]+$/.test(texto)) return false;
  if (/^[/!.][a-z]/i.test(texto)) return false; // parece comando
  /* So risadas e interjeicoes: "kkkkkk", "hahaha", "rsrsrs", "hehe". */
  if (/^[kkhaeirs\s!?.]+$/i.test(texto)) return false;
  return true;
}

/* ---------------- seletor: o plano B da traducao ----------------

   Usado so quando nao da pra criar o topico (ver traduzirEResponder). O
   Discord atende o clique pelo top-discord (Supabase), ramo "traduzir-msg:",
   e responde com a traducao numa mensagem efemera.

   O texto vai pro banco porque o custom_id do Discord so cabe 100 caracteres,
   e um aviso de evento passa disso facil. */

const TEXTO_MAXIMO = 3500;  // teto do que o bot se propoe a traduzir


async function guardarPraTraduzir(texto, link) {
  const r = await sbPost("discord_msg_traducao", {
    texto: texto.slice(0, 4000),
    /* O link e o que permite a traducao oferecer o caminho de volta: a resposta
       efemera nasce no fim do canal, e sem ele quem toca num recado antigo tem
       que rolar de volta na mao. */
    link: link || null,
  });
  return r?.[0]?.id ?? null;
}

/* Mesma lista do menuIdioma, com outro custom_id: aqui a escolha nao salva o
   idioma da pessoa por si so -- ela pede a traducao desta mensagem. (O
   top-discord aproveita e salva junto, entao clicar aqui tambem ensina ao bot
   mais um idioma da alianca.) */
function menuTraduzir(id) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`traduzir-msg:${id}`)
    .setPlaceholder("🌐 Ler no seu idioma / Read in your language")
    .addOptions(LINGUAS_MENU.map(([value, label, emoji]) => ({ label, value, emoji })));
  return [new ActionRowBuilder().addComponents(select)];
}

/* ---------------- limite simples por pessoa, pra ninguem floodar o tradutor ---------------- */

const janelaPorAutor = new Map(); // authorId -> [timestamps]
function podeTraduzirAgora(authorId) {
  const agora = Date.now();
  const lista = (janelaPorAutor.get(authorId) || []).filter((t) => agora - t < 60_000);
  if (lista.length >= 6) { janelaPorAutor.set(authorId, lista); return false; }
  lista.push(agora);
  janelaPorAutor.set(authorId, lista);
  return true;
}

/* ---------------- mencao a Lady / Maelle ---------------- */

function normalizar(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function mencionaLadyOuMaelle(texto) {
  return /\b(lady|maelle)\b/.test(normalizar(texto));
}

/* ---------------- evento principal ---------------- */

/* A traducao mora num topico pendurado na mensagem, atras de um seletor.

   Historico curto, porque cada tentativa morreu por um motivo diferente:
   despejar oito idiomas no canal virava parede de texto; o seletor solto no
   canal resolvia o espaco mas a resposta efemera nasce sempre no fim do
   canal, entao quem clicava num recado antigo era jogado la pra baixo;
   traduzir tudo de uma vez dentro do topico resolvia a descida mas gastava
   ate oito traducoes por mensagem e so cobria idioma que alguem ja tivesse
   escolhido no /meuidioma -- quem nunca configurou ficava sem nada.

   O seletor dentro do topico junta o que cada uma tinha de bom. O topico tem
   uma mensagem so, entao a efemera nao tem pra onde descer. A traducao
   acontece no clique, uma por pessoa que realmente quis ler, em vez de oito
   por mensagem que talvez ninguem leia. E o menu lista vinte idiomas: quem
   nunca usou /meuidioma escolhe o dele na hora.

   O topico nasce arquivado e sem o autor da mensagem dentro. Os dois juntos,
   porque um sozinho nao resolve: arquivar tira da lista, e remover o autor e'
   o que impede ele de voltar -- a barra mostra topico do qual voce e' MEMBRO,
   e abrir topico na mensagem de alguem inscreve essa pessoa automaticamente.

   Nao tranca. Trancar era a ideia obvia (topico so de leitura nao reabre) e
   quebrava o proprio seletor: topico arquivado precisa reabrir pra receber o
   clique, e trancado nem o Discord reabre -- dava "Esta interacao falhou".

   Como reabrir voltou a ser possivel, o ouvinte de threadUpdate la embaixo fecha
   de novo. Os tres dependem de o bot ter "Gerenciar Topicos" no canal.

   Se nao der pra criar topico (permissao faltando, canal que nao aceita, a
   mensagem ja tem um), cai no seletor solto no canal -- o comportamento
   antigo, que funciona em qualquer lugar. */

const NOME_TOPICO = "🌐 Tradução / Translation";

/* Fecha o topico e esvazia a lista de membros. Serve tanto pra hora em que
   ele nasce quanto pra quando alguem consegue reabrir. */
async function fecharTopico(topico, autorId) {
  /* Ordem importa: remover membro precisa vir depois da mensagem que o bot
     postou, senao a notificacao dessa mensagem reinscreve todo mundo. */
  const paraTirar = new Set();
  if (autorId) paraTirar.add(autorId);
  try {
    const membros = await topico.members.fetch();
    for (const m of membros.values()) if (m.id !== client.user.id) paraTirar.add(m.id);
  } catch (e) {
    /* Listar membro de topico pode ser barrado por intent; nesse caso ainda
       da pra tirar o autor, que e' o caso que mais aparece na barra. */
    console.error("traducao: nao consegui listar os membros do topico:", e?.message || e);
  }
  for (const id of paraTirar) {
    await topico.members.remove(id)
      .catch((e) => console.error("traducao: nao consegui tirar", id, "do topico:", e?.message || e));
  }
  /* Arquiva, mas NAO tranca.

     Trancar parecia a solucao perfeita -- topico so de leitura nao reabre --
     e quebrou justamente o que ele deveria proteger: o clique no seletor
     morria com "Esta interacao falhou". Topico arquivado precisa reabrir pra
     receber a interacao, e trancado ninguem reabre, nem o Discord.

     Entao volta a poder reabrir, e quem fecha de novo e' o threadUpdate la
     embaixo -- meio minuto depois, pra nao atropelar a traducao a caminho. */
  await topico.setArchived(true)
    .catch((e) => console.error("traducao: nao consegui arquivar o topico:", e?.message || e));
}

async function traduzirEResponder(msg, texto) {
  if (!vantajosoTraduzir(texto, TEXTO_MAXIMO)) return;

  /* O seletor vale pra qualquer idioma, inclusive portugues: metade da
     alianca nao le portugues, e pular significaria que os recados da casa
     eram justamente os que ninguem de fora conseguia ler. */
  const id = await guardarPraTraduzir(texto, msg.url).catch(() => null);
  if (!id) return;

  const corpo = {
    content: "-# 🌐 Ler no seu idioma / Read in your language",
    components: menuTraduzir(id),
  };

  const podeTopico = typeof msg.startThread === "function" && !msg.hasThread && !msg.channel?.isThread?.();
  if (podeTopico) {
    const topico = await msg.startThread({ name: NOME_TOPICO, autoArchiveDuration: 60 })
      .catch((e) => { console.error("traducao: nao consegui criar o topico:", e?.message || e); return null; });

    if (topico) {
      const postou = await topico.send({ ...corpo, allowedMentions: { parse: [] } })
        .then(() => true)
        .catch((e) => { console.error("traducao: nao consegui postar no topico:", e?.message || e); return false; });

      /* Em aviso automatico o "autor" e' o webhook, que nao e' gente e nao
         entra no topico -- tentar remover so gera "Unknown User" no log. */
      if (postou) return fecharTopico(topico, msg.webhookId ? null : msg.author?.id);
      /* Topico vazio e' pior que topico nenhum: ocupa a barra e nao serve
         pra nada. Apaga antes de cair no plano B. */
      await topico.delete().catch(() => {});
    }
  }

  await msg.reply({ ...corpo, allowedMentions: { parse: [], repliedUser: false } })
    .catch((e) => console.error("traducao: nao consegui mandar o seletor:", e?.message || e));
}

/* Rede de seguranca da barra lateral: topico de traducao que voltar a abrir
   -- por um clique, por alguem que escreveu dentro, pelo que for -- e' fechado
   de novo, e quem entrou sai junto.

   Agora que nao ha mais tranca, e' isto que segura a barra limpa. */
const ESPERA_REFECHAR = 30 * 1000;

client.on("threadUpdate", async (antes, depois) => {
  try {
    if (depois.name !== NOME_TOPICO) return;
    if (!antes.archived || depois.archived) return; // so interessa a reabertura

    /* Nao fecha na hora: quase sempre quem reabriu foi um clique no seletor,
       e a resposta da traducao ainda esta a caminho. Arquivar no meio disso
       derrubaria a entrega -- que e' exatamente o erro que a tranca causava.
       Meio minuto e' bem mais do que a traducao precisa. */
    await new Promise((ok) => setTimeout(ok, ESPERA_REFECHAR));

    /* Nesse meio tempo alguem pode ter fechado, ou o topico pode ter sumido. */
    const agora = await depois.fetch().catch(() => null);
    if (!agora || agora.archived) return;

    await fecharTopico(agora, null);
  } catch (e) {
    console.error("erro ao refechar topico de traducao:", e?.message || e);
  }
});

/* ---------------- chat espelhado por idioma ----------------

   A mesma conversa acontecendo em vários canais, cada um num idioma. Quem
   escreve em #chat-en aparece em #chat-pt já em português, com o nome e a
   foto de quem falou -- webhook deixa trocar isso por mensagem, então lá
   parece que a pessoa escreveu em português.

   A trava contra eco é estrutural, não uma lista de exceções: só mensagem de
   GENTE é espelhada, e o espelho sai por webhook. Espelho de espelho não
   existe porque webhook nunca entra aqui. */

const cacheEspelho = new Map(); // aliancaId -> { v, t }
async function canaisEspelho(aliancaId) {
  const achado = cacheEspelho.get(aliancaId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = [];
  try {
    v = await sb(`discord_chat_espelho?alianca_id=eq.${aliancaId}&select=canal_id,idioma,webhook`) || [];
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheEspelho.set(aliancaId, { v, t: Date.now() });
  return v;
}

/* Google barra o endpoint classico quando a chamada sai do Supabase, mas o
   Fly passa nos dois. Mesmo assim vale ter o clients5 primeiro: e' o que
   sobreviveu ao bloqueio, e um dia o bloqueio pode chegar aqui tambem. */
async function traduzir(texto, alvo) {
  const tentativas = [
    {
      url: `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${alvo}&q=${encodeURIComponent(texto)}`,
      ler: (j) => (Array.isArray(j) ? j.map((p) => (Array.isArray(p) ? p[0] : p)).join("") : ""),
    },
    {
      url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${alvo}&dt=t&q=${encodeURIComponent(texto)}`,
      ler: (j) => (j?.[0] || []).map((p) => p?.[0] || "").join(""),
    },
  ];
  for (const t of tentativas) {
    try {
      const r = await fetch(t.url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) { console.error("espelho: tradutor devolveu HTTP", r.status); continue; }
      const saiu = t.ler(await r.json());
      if (saiu) return saiu;
    } catch (e) {
      console.error("espelho: tradutor falhou:", String(e).slice(0, 100));
    }
  }
  return null;
}

async function espelharMensagem(msg, lista, origem, texto) {
  /* Apelido do servidor antes do nome global: e' assim que a pessoa aparece
     pros outros aqui dentro. */
  const nome = (msg.member?.displayName || msg.author.username || "alguem").slice(0, 80);
  const foto = msg.author.displayAvatarURL({ extension: "png", size: 128 });
  const anexos = [...msg.attachments.values()].map((a) => a.url);

  for (const destino of lista) {
    if (destino.canal_id === origem.canal_id) continue;

    let corpo = texto;
    if (texto && destino.idioma !== origem.idioma) {
      /* Tradutor fora do ar nao pode calar a conversa: manda o original e
         deixa a pessoa se virar, que e' melhor do que a mensagem sumir. */
      corpo = (await traduzir(texto, destino.idioma)) || texto;
    }

    const conteudo = [corpo, ...anexos].filter(Boolean).join("\n").slice(0, 1900);
    if (!conteudo) continue;

    await fetch(destino.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: conteudo,
        username: nome,
        avatar_url: foto,
        /* Texto de terceiro nao pode virar @everyone do outro lado. */
        allowed_mentions: { parse: [] },
      }),
    }).catch((e) => console.error("espelho: nao consegui postar em", destino.idioma, e?.message || e));
  }
}

client.on("messageCreate", async (msg) => {
  try {
    if (!msg.guild) return;

    if (msg.webhookId) {
      const aliancaId = await aliancaDoGuild(msg.guild.id);
      if (!aliancaId) return;

      /* Canal de chat espelhado nao leva tradutor: o que chega ali por webhook
         E' a traducao, e pendurar um seletor embaixo dela seria oferecer
         traduzir o que acabou de ser traduzido. No teste isso encheu o canal
         de "Tradução / Translation" embaixo de cada fala. */
      if ((await canaisEspelho(aliancaId)).some((c) => c.canal_id === msg.channel.id)) return;

      /* Boas-vindas ganham as duas coisas: o convite pra escolher idioma e o
         tradutor. Antes parava no seletor, com a ideia de que a mensagem era
         so o convite -- mas ela tem texto de verdade ("entrou na alianca,
         bem-vindo ao time"), e quem acabou de chegar sem falar a lingua da
         casa e' exatamente quem mais precisa de traducao. */
      if (await webhookEhBoasVindas(aliancaId, msg.webhookId)) await talvezMandarSeletorIdioma(msg);

      /* Avisos automaticos (evento, dica do dia, arena) vem como embed -- o
         texto que importa esta la, nao em msg.content (que as vezes so tem
         "@everyone"). */
      const emb = msg.embeds?.[0];
      const texto = String(emb ? [emb.title, emb.description].filter(Boolean).join("\n") : (msg.content || "")).trim();
      if (podeTraduzirAgora(msg.webhookId)) await traduzirEResponder(msg, texto);
      return;
    }
    if (msg.author.bot) return;

    const aliancaId = await aliancaDoGuild(msg.guild.id);
    if (!aliancaId) return; // servidor ainda nao ligado ao portal (/configurar servidor)

    const texto = String(msg.content || "").trim();

    /* Canal de chat espelhado tem regra propria e sai por aqui: nada de
       seletor de traducao nem topico, porque a traducao ja vai acontecer nos
       outros canais. Vem antes do corte de texto vazio de proposito -- foto
       sem legenda tambem tem que atravessar. */
    const espelho = await canaisEspelho(aliancaId);
    const origem = espelho.find((c) => c.canal_id === msg.channel.id);
    if (origem) {
      if (podeTraduzirAgora(msg.author.id)) await espelharMensagem(msg, espelho, origem, texto);
      return;
    }

    if (!texto) return;

    if (mencionaLadyOuMaelle(texto)) {
      const url = await gifRosas();
      if (url) msg.reply({ files: [url], allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    if (podeTraduzirAgora(msg.author.id)) await traduzirEResponder(msg, texto);
  } catch (e) {
    console.error("erro ao processar mensagem:", e?.message || e);
  }
});

client.once("clientReady", () => {
  console.log(`Conectado como ${client.user.tag}, em ${client.guilds.cache.size} servidor(es).`);
});

client.on("error", (e) => console.error("erro do client:", e?.message || e));
process.on("unhandledRejection", (e) => console.error("rejeicao nao tratada:", e));

/* Nao conseguir entrar tem que doer.

   Ja aconteceu: o token foi trocado no Discord e nao aqui. O login falhou, a
   rejeicao caiu no console, o event loop ficou vazio e o Node saiu com codigo
   ZERO -- saida limpa. O Fly leu isso como "terminou o que tinha pra fazer" e
   nao reiniciou. O bot ficou quatro horas fora do ar e nada gritou: o canal
   simplesmente parou de ter tradutor, e a gente foi caçar bug no lugar errado.

   Saindo com codigo 1, o Fly reinicia (ver a politica no fly.toml). Se o
   token continuar errado, vira ciclo de reinicio -- que e' barulhento e
   aparece no status, exatamente o oposto de sumir em silencio. E como o
   token e' lido a cada partida, arrumar o segredo ja e' o suficiente pra
   voltar sozinho, sem ninguem precisar mandar subir. */
client.login(TOKEN).catch((e) => {
  console.error("FATAL: nao consegui entrar no Discord:", e?.message || e);
  console.error("Confira o segredo DISCORD_BOT_TOKEN. Saindo com erro pra forcar reinicio.");
  process.exit(1);
});
