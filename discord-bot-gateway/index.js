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

import { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, WebhookClient, ChannelType } from "discord.js";
import { createHash } from "node:crypto";

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

async function sbPatch(caminho, corpo) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
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
    v = await sb(`discord_chat_espelho?alianca_id=eq.${aliancaId}&select=canal_id,idioma,webhook,categoria_id`) || [];
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheEspelho.set(aliancaId, { v, t: Date.now() });
  return v;
}

/* Google barra o endpoint classico quando a chamada sai do Supabase, mas o
   Fly passa nos dois. Mesmo assim vale ter o clients5 primeiro: e' o que
   sobreviveu ao bloqueio, e um dia o bloqueio pode chegar aqui tambem. */
/* Acima disso nao vale guardar: mensagem longa e' quase sempre unica, e
   encheria a tabela com frase que nunca mais sera lida. */
const MAX_CACHE = 400;

async function doCache(chave) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/traducao_do_cache`, {
      method: "POST",
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_chave: chave }),
    });
    if (!r.ok) return null;
    return (await r.json()) || null;
  } catch {
    return null; // cache fora do ar nao pode impedir a traducao
  }
}

/* Guarda o que ja foi traduzido, por hash do texto + idioma.

   Conversa de alianca repete muito: "ok", "rally saindo", "quem vai no urso".
   Com sete salas cada uma dessas custava seis chamadas ao tradutor pra
   devolver o que ele ja tinha devolvido antes.

   O hash tambem serve pra tabela nao virar um arquivo do que a alianca
   conversa: o que fica guardado e' a traducao, nao o original. */
async function traduzirComCache(texto, alvo) {
  if (texto.length > MAX_CACHE) return await traduzir(texto, alvo);

  const chave = createHash("sha256").update(`${alvo} ${texto}`).digest("hex").slice(0, 40);
  const guardado = await doCache(chave);
  if (guardado) return guardado;

  const novo = await traduzir(texto, alvo);
  if (novo) {
    /* Sem await: a conversa nao espera o banco pra seguir. */
    sbPost("discord_traducao_cache", { chave, idioma: alvo, traduzido: novo })
      .catch(() => { /* ja traduzido; guardar e' bonus */ });
  }
  return novo;
}

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

/* Um cliente por webhook, reaproveitado: ele sabe mandar arquivo de verdade
   (multipart), que o fetch cru nao fazia. */
const clientesWebhook = new Map();
function clienteDoWebhook(url) {
  let c = clientesWebhook.get(url);
  if (!c) { c = new WebhookClient({ url }); clientesWebhook.set(url, c); }
  return c;
}

/* O limite do Discord pra quem nao tem Nitro. Acima disso nao adianta tentar
   reenviar; vai o link mesmo, com a validade curta que ele tem. */
const MAX_ANEXO = 8 * 1024 * 1024;

/* Baixa uma vez e reenvia pra todas as salas.

   Repassar a URL do anexo parecia resolver e resolve por um dia: link de
   anexo do Discord vem assinado e caduca. A foto aparecia hoje e virava
   quadrado quebrado amanha, so nas copias -- a original continuava inteira,
   o que deixaria o defeito ainda mais confuso de entender.

   Reenviando os bytes, cada sala ganha um anexo proprio, hospedado pelo
   Discord, sem validade. */
async function baixarAnexos(msg) {
  const arquivos = [];
  const links = [];
  for (const a of msg.attachments.values()) {
    if (a.size > MAX_ANEXO) { links.push(a.url); continue; }
    try {
      const r = await fetch(a.url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      arquivos.push({ attachment: Buffer.from(await r.arrayBuffer()), name: a.name || "arquivo" });
    } catch (e) {
      console.error("espelho: nao consegui baixar o anexo:", e?.message || e);
      links.push(a.url); // melhor um link que caduca do que foto nenhuma
    }
  }
  return { arquivos, links };
}

async function espelharMensagem(msg, lista, origem, texto) {
  /* Apelido do servidor antes do nome global: e' assim que a pessoa aparece
     pros outros aqui dentro. */
  const nome = (msg.member?.displayName || msg.author.username || "alguem").slice(0, 80);
  const foto = msg.author.displayAvatarURL({ extension: "png", size: 128 });
  const { arquivos, links: anexos } = msg.attachments.size
    ? await baixarAnexos(msg)
    : { arquivos: [], links: [] };

  for (const destino of lista) {
    if (destino.canal_id === origem.canal_id) continue;

    let corpo = texto;
    if (texto && destino.idioma !== origem.idioma && vantajosoTraduzir(texto, 1200)) {
      /* Tradutor fora do ar nao pode calar a conversa: manda o original e
         deixa a pessoa se virar, que e' melhor do que a mensagem sumir.

         O vantajosoTraduzir la em cima e' economia, nao filtro: "ok", "kkkk",
         um link solto e um emoji atravessam iguais em qualquer idioma. Traduzir
         isso seria gastar seis chamadas pra devolver a mesma palavra. */
      corpo = (await traduzirComCache(texto, destino.idioma)) || texto;
    }

    /* A mencao vai junto pra dar de volta o que o webhook tira: identidade
       clicavel. Nome e foto o webhook copia, mas sao pintura -- tocar neles
       nao abre nada, e a mensagem fica com jeito de perfil fantasma. Com
       <@id> o Discord desenha a pilha de verdade: toca e abre o perfil, da
       pra mandar mensagem, ver cargo, tudo.

       Nao notifica ninguem: allowed_mentions vazio faz a mencao aparecer sem
       tocar sino. Seria barulho puro -- avisaria a propria pessoa, seis vezes,
       em salas que ela nem enxerga. */
    const conteudo = [`<@${msg.author.id}> ${corpo}`.trim(), ...anexos]
      .filter(Boolean).join("\n").slice(0, 1900);
    if (!conteudo && !arquivos.length) continue;

    await clienteDoWebhook(destino.webhook).send({
      content: conteudo || undefined,
      username: nome,
      avatarURL: foto,
      files: arquivos,
      /* Texto de terceiro nao pode virar @everyone do outro lado. */
      allowedMentions: { parse: [] },
    }).catch((e) => console.error("espelho: nao consegui postar em", destino.idioma, e?.message || e));
  }
}

/* ---------------- as salas se montam sozinhas ----------------

   Uma sala por idioma, privada, e o cargo daquele idioma e' a chave. Quem fala
   arabe ve uma sala; as outras nem aparecem pra ele.

   A regra que faz isso caber num servidor de verdade: sala so nasce quando
   existe alguem falando aquele idioma. Sao vinte idiomas no seletor -- criar
   os vinte deixaria dezoito salas mortas.

   Roda de tempos em tempos em vez de reagir ao clique porque o idioma e'
   escolhido no outro bot (o de comandos, no Supabase), que nao tem como mexer
   em cargo aqui. Passar por cima disso exigiria um caminho entre os dois; uma
   varredura periodica faz o mesmo e ainda conserta o que sair do lugar
   sozinho -- cargo removido na mao, gente que entrou depois. */

const PREFIXO_SALA = "chat-";
const INTERVALO_SINCRONIA = 10 * 60 * 1000;

/* Modo lento do proprio Discord, cinco segundos entre falas da mesma pessoa.

   Nao e' pra conter briga: e' pra proteger o que uma rajada custa. Cada linha
   vira seis traducoes e seis postagens, e o Discord aceita cinco mensagens a
   cada cinco segundos por canal. Dez linhas seguidas de uma pessoa viravam
   sessenta chamadas e perda de mensagem por rajada.

   Cinco segundos quase nao se sente escrevendo -- da tempo de digitar a
   proxima frase -- e corta a rajada pela raiz, do lado do Discord, antes de
   qualquer codigo nosso rodar. */
const SEGUNDOS_ENTRE_FALAS = 5;

function nomeDoIdioma(cod) {
  const achado = LINGUAS_MENU.find(([c]) => c === cod);
  return achado ? `${achado[2]} ${achado[1]}` : cod;
}

async function garantirSala(guild, aliancaId, idioma) {
  const cargo = await guild.roles.create({
    name: nomeDoIdioma(idioma),
    mentionable: false,
    reason: "sala de idioma do chat espelhado",
  });

  const canal = await guild.channels.create({
    name: `${PREFIXO_SALA}${idioma.toLowerCase()}`,
    type: 0,
    rateLimitPerUser: SEGUNDOS_ENTRE_FALAS,
    topic: `Chat espelhado — ${nomeDoIdioma(idioma)}. O que for dito aqui aparece nas outras salas traduzido.`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: cargo.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks] },
    ],
    reason: "sala de idioma do chat espelhado",
  });

  const webhook = await canal.createWebhook({ name: "CYRON espelho" });

  await sbPost("discord_chat_espelho", {
    alianca_id: aliancaId, canal_id: canal.id, idioma,
    webhook: webhook.url, role_id: cargo.id,
  });
  console.log(`espelho: sala criada para ${idioma} (#${canal.name})`);
  return { canal_id: canal.id, idioma, webhook: webhook.url, role_id: cargo.id };
}

/* Passada curta: so quem mexeu no idioma agorinha.

   A varredura completa lista todos os membros do servidor e conserta canal,
   cargo e modo lento -- e' cara demais pra rodar de minuto em minuto. Mas o
   hall de entrada precisa ser rapido: quem escolhe o idioma e fica dez
   minutos sem ver sala nenhuma acha que nao funcionou e vai embora.

   Entao a cada minuto olha so as escolhas dos ultimos quinze minutos e mexe
   nessas pessoas. A janela e' maior que o intervalo de proposito: se uma
   passada falhar, a proxima ainda pega. */
const JANELA_RECENTE = 15 * 60 * 1000;

async function sincronizarRecentes() {
  const desde = new Date(Date.now() - JANELA_RECENTE).toISOString();
  for (const [, guild] of client.guilds.cache) {
    try {
      const aliancaId = await aliancaDoGuild(guild.id);
      if (!aliancaId) continue;

      const salas = await sb(`discord_chat_espelho?alianca_id=eq.${aliancaId}&select=idioma,role_id`);
      if (!salas?.length) continue;

      const recentes = await sb(
        `discord_idioma_jogador?atualizado_em=gte.${encodeURIComponent(desde)}&select=discord_user_id,idioma`);
      if (!recentes?.length) continue;

      const porIdioma = new Map(salas.map((s) => [s.idioma, s.role_id]).filter(([, r]) => r));
      const cargosDeSala = new Set(porIdioma.values());

      for (const escolha of recentes) {
        const querido = porIdioma.get(escolha.idioma) || null;
        /* Idioma sem sala ainda: quem cria e' a varredura completa, que sabe
           montar canal e webhook. Aqui so distribuo cargo. */
        if (!querido) continue;
        const membro = await guild.members.fetch(String(escolha.discord_user_id)).catch(() => null);
        if (!membro || membro.user.bot) continue;
        for (const cargo of cargosDeSala) {
          const tem = membro.roles.cache.has(cargo);
          if (cargo === querido && !tem) await membro.roles.add(cargo, "idioma escolhido").catch(() => {});
          else if (cargo !== querido && tem) await membro.roles.remove(cargo, "trocou de idioma").catch(() => {});
        }
      }
    } catch (e) {
      console.error("espelho: passada curta falhou em", guild.id, e?.message || e);
    }
  }
}

/* Aviso de evento e' longo: a organizacao do urso tem umas mil letras. E a
   traducao vai por URL, com o texto inteiro dentro dela -- passando de uns
   1500 caracteres o Google devolve erro e o aviso chegaria no idioma errado
   justamente onde a traducao era o motivo do canal existir.

   Entao parte por LINHA, nunca no meio de uma. Aviso e' lista: "ativar ataque
   antes da armadilha", "primeiro slot: Amane". Cortar por contagem de letras
   partiria uma frase no meio e as duas metades chegariam sem sentido. */
const PEDACO_TRADUCAO = 1500;

async function traduzirLongo(texto, alvo) {
  if (texto.length <= PEDACO_TRADUCAO) return await traduzirComCache(texto, alvo);

  const pedacos = [];
  let atual = "";
  for (const linha of texto.split("\n")) {
    /* Linha sozinha maior que o pedaco: nao ha o que fazer de bonito, vai
       inteira e o tradutor que decida. */
    if (atual && atual.length + linha.length + 1 > PEDACO_TRADUCAO) {
      pedacos.push(atual);
      atual = linha;
    } else {
      atual = atual ? `${atual}\n${linha}` : linha;
    }
  }
  if (atual) pedacos.push(atual);

  const saiu = [];
  for (const pedaco of pedacos) {
    const t = await traduzirComCache(pedaco, alvo);
    if (!t) return null; // meia traducao e' pior que nenhuma
    saiu.push(t);
  }
  return saiu.join("\n");
}

/* ---------------- replica dos canais, um jogo por idioma ----------------

   O chat resolveu a conversa, mas nao o resto: aviso de evento, dica do dia e
   recado de jogo continuavam so no canal publico, em ingles. Quem escolheu
   arabe ganhou uma sala de conversa e seguiu sem entender o aviso do urso.

   Entao cada idioma ganha o jogo inteiro dentro de uma CATEGORIA propria --
   evento, dica, game e o chat. A categoria e' o que faz isso caber na barra
   lateral: sem ela seriam quatro canais soltos por idioma, vinte e oito no
   topo, e ninguem acharia nada. Com ela a pessoa ve UMA linha, "🇧🇷 Português",
   e o que esta dentro e' o servidor inteiro na lingua dela.

   Os tres novos sao so-leitura: quem escreve neles e' o bot. Conversa tem
   lugar, e o lugar e' o chat.

   O conteudo vem de fora, nao daqui: o canal publico continua sendo a fonte.
   O oficial (ou o aviso automatico do portal) posta uma vez la, e o bot leva
   traduzido pra replica de cada idioma, mantendo o heroi que assinou. Ninguem
   escreve cinco vezes, e o canal publico segue servindo quem nao escolheu
   idioma nenhum. */

const REPLICAS = [
  { tipo: "evento", prefixo: "evento-", assunto: "Avisos de evento" },
  { tipo: "dica",   prefixo: "dica-",   assunto: "Dicas e alertas" },
  { tipo: "game",   prefixo: "game-",   assunto: "Recados do jogo" },
];

/* A replica se chama como o canal que ela copia, mais o codigo do idioma:
   "🎯-event-guide📢" vira "🎯-event-guide📢-pt". Nome inventado ("evento-pt")
   obriga cada pessoa a aprender um vocabulario novo pra achar o mesmo canal de
   sempre; copiando o original ela reconhece de primeira.

   O nome vem do Discord, nao de uma constante daqui: se o oficial renomear o
   canal original, as sete replicas seguem atras sozinhas.

   Se a fonte sumir, o prefixo simples serve de rede -- e' feio, mas e' melhor
   do que nao criar o canal. */
function nomeDaReplica(modelo, def, idioma) {
  const base = modelo || def.prefixo.replace(/-$/, "");
  return `${base}-${idioma}`.toLowerCase().slice(0, 100);
}

const cacheFontes = new Map(); // aliancaId -> { v: Map(canal_id -> tipo), t }
async function fontesReplica(aliancaId) {
  const achado = cacheFontes.get(aliancaId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = new Map();
  try {
    const r = await sb(`discord_fonte_replica?alianca_id=eq.${aliancaId}&select=canal_id,tipo&order=criado_em.asc`) || [];
    v = new Map(r.map((f) => [f.canal_id, f.tipo]));
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheFontes.set(aliancaId, { v, t: Date.now() });
  return v;
}

const cacheReplicas = new Map(); // aliancaId -> { v, t }
async function replicasDoIdioma(aliancaId) {
  const achado = cacheReplicas.get(aliancaId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = [];
  try {
    v = await sb(`discord_canal_idioma?alianca_id=eq.${aliancaId}&select=canal_id,idioma,tipo,webhook`) || [];
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheReplicas.set(aliancaId, { v, t: Date.now() });
  return v;
}

/* Quem enxerga a categoria enxerga tudo que esta dentro: o cargo do idioma e'
   a chave, e as portas de dentro herdam esta. */
function portasDaCategoria(guild, cargoId) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: cargoId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks],
    },
  ];
}

async function garantirCategoria(guild, sala) {
  if (sala.categoria_id) {
    const achada = await guild.channels.fetch(sala.categoria_id).catch(() => null);
    if (achada) return achada;
  }
  if (!sala.role_id) return null; // sem cargo nao ha como fechar a porta

  const categoria = await guild.channels.create({
    name: nomeDoIdioma(sala.idioma),
    type: ChannelType.GuildCategory,
    permissionOverwrites: portasDaCategoria(guild, sala.role_id),
    reason: "categoria do idioma",
  });
  await sbPatch(`discord_chat_espelho?canal_id=eq.${encodeURIComponent(sala.canal_id)}`,
    { categoria_id: categoria.id });
  sala.categoria_id = categoria.id;
  console.log(`idioma: categoria criada para ${sala.idioma} (${categoria.name})`);
  return categoria;
}

async function garantirReplica(guild, aliancaId, sala, categoria, def, posicao, nome) {
  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    parent: categoria.id,
    position: posicao,
    topic: `${def.assunto} — ${nomeDoIdioma(sala.idioma)}. Só leitura: quem escreve aqui é o bot.`,
    /* So-leitura de proposito: o cargo do idioma ve e le, mas nao fala.
       Conversa tem lugar, e o lugar e' o chat da mesma categoria.

       Tudo do cargo numa entrada so: dois overwrites com o mesmo id fazem o
       Discord ficar com um deles, e qual dos dois vira sorte. */
    permissionOverwrites: portasDaCategoria(guild, sala.role_id).map((p) =>
      p.id === sala.role_id
        ? { ...p, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] }
        : p),
    reason: "replica do canal no idioma",
  });

  const webhook = await canal.createWebhook({ name: "CYRON" });
  await sbPost("discord_canal_idioma", {
    alianca_id: aliancaId, idioma: sala.idioma, tipo: def.tipo,
    canal_id: canal.id, webhook: webhook.url,
  });
  console.log(`idioma: #${canal.name} criado`);
}

/* Arrumar posicao e nome sao as duas coisas aqui que podem virar briga sem
   fim, e as duas pelo mesmo motivo: eu peco um estado que o Discord pode nao
   me devolver igual.

   Posicao: so UMA categoria cabe na posicao zero. Pedir zero pras sete a cada
   passada faria seis delas continuarem "erradas" pra sempre -- seis chamadas
   de dez em dez minutos, embaralhando a barra lateral de quem estivesse
   olhando. O que se quer nao e' "todas na zero", e' "todas acima do resto", e
   isso se consegue empurrando cada uma pro topo UMA vez.

   Nome: o Discord normaliza o que recebe. Se ele devolver o nome diferente do
   que pedi -- e com emoji e sequencia ZWJ no meio isso e' bem possivel -- a
   comparacao nunca casa e eu renomearia pra sempre, ate estourar o limite de
   duas trocas de nome a cada dez minutos.

   Nos dois casos a saida e' a mesma: tentar uma vez por partida do bot. Se
   deu certo, nao precisa de novo; se nao deu, nao adianta insistir a cada dez
   minutos -- adianta aparecer no log e alguem olhar. */
const jaTentado = new Set();
function umaVezPorProcesso(chave) {
  if (jaTentado.has(chave)) return false;
  jaTentado.add(chave);
  return true;
}

/* Qual canal original empresta o nome pra cada tipo de replica. Dois canais
   podem alimentar o mesmo tipo (evento vem do event-guide E do hunting-trap):
   quem empresta e' o primeiro cadastrado, por isso a consulta vem ordenada. */
async function modelosDeNome(guild, aliancaId) {
  const modelos = new Map();
  for (const [canalId, tipo] of await fontesReplica(aliancaId)) {
    if (modelos.has(tipo)) continue;
    const canal = await guild.channels.fetch(canalId).catch(() => null);
    if (canal) modelos.set(tipo, canal.name);
  }
  return modelos;
}

/* Some com o canal original pra quem ja escolheu idioma.

   E' o passo que faz a mudanca valer: sem ele a pessoa fica com o dobro de
   canais -- o antigo em ingles e a replica na lingua dela -- e o aviso do urso
   aparece duas vezes, uma que ela entende e outra que nao. Escolher um idioma
   tem que SIMPLIFICAR a barra lateral, nao dobrar.

   Esconde so onde existe substituto: a regra e' "some com o original apenas
   se a replica daquele idioma existir pra receber o conteudo". Canal sem
   replica (photos-art, welcome) fica visivel pra todo mundo.

   Quem ainda nao escolheu continua vendo tudo como antes -- o cargo do idioma
   e' a chave, e quem nao tem cargo nao e' afetado. E quem perder o cargo volta
   a enxergar sozinho, sem ninguem precisar desfazer nada. */
async function esconderOriginais(guild, aliancaId, cargosComReplica) {
  if (!cargosComReplica.size) return;

  const fontes = [...(await fontesReplica(aliancaId)).keys()];
  let portoes = [];
  try {
    portoes = ((await sb(
      `discord_convite_idioma?alianca_id=eq.${aliancaId}&tipo=eq.portao&select=canal_id`)) || [])
      .map((p) => p.canal_id);
  } catch { /* sem portao a lista so fica menor */ }

  for (const canalId of new Set([...fontes, ...portoes])) {
    const canal = await guild.channels.fetch(canalId).catch(() => null);
    if (!canal) continue;
    for (const cargo of cargosComReplica) {
      try {
        const atual = canal.permissionOverwrites.cache.get(cargo);
        if (atual?.deny.has(PermissionFlagsBits.ViewChannel)) continue;
        await canal.permissionOverwrites.edit(cargo, { ViewChannel: false },
          { reason: "quem escolheu idioma le a replica, nao o original" });
        console.log(`idioma: #${canal.name} escondido de quem tem o cargo ${cargo}`);
      } catch (e) {
        console.error("idioma: nao consegui esconder", canal.name, e?.message || e);
      }
    }
  }
}

/* Monta a categoria e o que falta dentro dela, pra cada idioma que ja tem
   sala. Roda junto da sincronia das salas. */
async function montarCategorias(guild, aliancaId, porIdioma) {
  const existentes = (await sb(
    `discord_canal_idioma?alianca_id=eq.${aliancaId}&select=idioma,tipo,canal_id`)) || [];
  const porChave = new Map(existentes.map((r) => [`${r.idioma}|${r.tipo}`, r.canal_id]));
  const modelos = await modelosDeNome(guild, aliancaId);
  const prontos = new Set();

  for (const sala of porIdioma.values()) {
    try {
      const categoria = await garantirCategoria(guild, sala);
      if (!categoria) continue;

      /* Categoria do idioma no topo da barra lateral. Cada pessoa enxerga
         so a sua, entao pra ela isso e' "o meu servidor primeiro, o resto
         depois" -- que e' o ponto. */
      if (categoria.position !== 0 && umaVezPorProcesso(`topo:${categoria.id}`)) {
        await categoria.setPosition(0)
          .then(() => console.log(`idioma: categoria de ${sala.idioma} subiu pro topo`))
          .catch((e) => console.error("idioma: nao consegui subir a categoria de", sala.idioma, e?.message || e));
      }

      for (let i = 0; i < REPLICAS.length; i++) {
        const def = REPLICAS[i];
        const nome = nomeDaReplica(modelos.get(def.tipo), def, sala.idioma);
        const jaExiste = porChave.get(`${sala.idioma}|${def.tipo}`);

        if (!jaExiste) {
          await garantirReplica(guild, aliancaId, sala, categoria, def, i, nome);
          continue;
        }
        /* Ja existe: so acerta o nome se o original mudou de nome (ou se a
           replica nasceu com o nome antigo, inventado). */
        const canal = await guild.channels.fetch(jaExiste).catch(() => null);
        if (canal && canal.name !== nome && umaVezPorProcesso(`nome:${canal.id}:${nome}`)) {
          console.log(`idioma: #${canal.name} vira #${nome}`);
          await canal.setName(nome, "replica segue o nome do canal original");
        }
      }

      /* O chat entra por ultimo na lista: ler o aviso vem antes de responder
         a ele. Ele ja existia solto no topo, entao aqui e' mudanca de lugar,
         nao criacao -- as permissoes dele sao proprias e ficam como estao. */
      const chat = await guild.channels.fetch(sala.canal_id).catch(() => null);
      if (chat) {
        const nomeChat = nomeDaReplica(modelos.get("chat"), { prefixo: PREFIXO_SALA }, sala.idioma);
        if (chat.name !== nomeChat && umaVezPorProcesso(`nome:${chat.id}:${nomeChat}`)) {
          console.log(`idioma: chat de ${sala.idioma} vira #${nomeChat}`);
          await chat.setName(nomeChat, "chat segue o nome do canal original");
        }
        if (chat.parentId !== categoria.id) {
          await chat.setParent(categoria.id, { lockPermissions: false, reason: "chat vai pra categoria do idioma" });
          await chat.setPosition(REPLICAS.length).catch(() => { /* posicao e' capricho */ });
          console.log(`idioma: chat de ${sala.idioma} movido pra ${categoria.name}`);
        }
      }

      if (sala.role_id) prontos.add(sala.role_id);
    } catch (e) {
      console.error("idioma: nao consegui montar a categoria de", sala.idioma, e?.message || e);
    }
  }

  cacheReplicas.delete(aliancaId);

  /* So depois de tudo montado: esconder o original de quem ainda nao tem pra
     onde ir deixaria a pessoa sem canal nenhum. */
  await esconderOriginais(guild, aliancaId, prontos);
}

/* Leva o aviso do canal publico pra replica de cada idioma.

   Mantem o heroi que assinou (nome e foto do webhook de origem) e a forma da
   mensagem: se veio embed, sai embed com titulo e texto traduzidos e a imagem
   intacta. Traduzir so o texto e jogar fora a moldura faria o aviso do urso
   chegar sem o urso. */
async function replicarPorIdioma(msg, aliancaId, tipo) {
  const destinos = (await replicasDoIdioma(aliancaId)).filter((r) => r.tipo === tipo);
  if (!destinos.length) return;

  const emb = msg.embeds?.[0];
  const titulo = String(emb?.title || "").trim();
  const corpo = String(emb?.description || msg.content || "").trim();
  if (!titulo && !corpo && !msg.attachments.size) return;

  const nome = (msg.author?.username || "CYRON").slice(0, 80);
  const foto = msg.author?.displayAvatarURL({ extension: "png", size: 128 });
  const { arquivos, links } = msg.attachments.size ? await baixarAnexos(msg) : { arquivos: [], links: [] };

  for (const destino of destinos) {
    try {
      /* Teto alto de proposito: aqui o texto longo e' o que MAIS precisa de
         traducao. O vantajosoTraduzir continua servindo pra nao pagar por
         emoji, link solto e "ok". */
      const t = titulo && vantajosoTraduzir(titulo, TEXTO_MAXIMO)
        ? (await traduzirLongo(titulo, destino.idioma)) || titulo : titulo;
      const c = corpo && vantajosoTraduzir(corpo, TEXTO_MAXIMO)
        ? (await traduzirLongo(corpo, destino.idioma)) || corpo : corpo;

      const carga = { username: nome, avatarURL: foto, files: arquivos, allowedMentions: { parse: [] } };
      if (emb) {
        const cru = emb.toJSON();
        /* Campo tambem e' texto que alguem vai ler. Deixar de fora faria o
           aviso chegar meio traduzido, que e' pior que nao traduzir: da a
           impressao de que aquela parte nao valia a pena. */
        const campos = [];
        for (const campo of cru.fields || []) {
          campos.push({
            ...campo,
            name: vantajosoTraduzir(campo.name, TEXTO_MAXIMO)
              ? (await traduzirLongo(campo.name, destino.idioma)) || campo.name : campo.name,
            value: vantajosoTraduzir(campo.value, TEXTO_MAXIMO)
              ? (await traduzirLongo(campo.value, destino.idioma)) || campo.value : campo.value,
          });
        }
        carga.embeds = [{
          ...cru,
          title: t || undefined,
          description: [c, ...links].filter(Boolean).join("\n") || undefined,
          fields: campos.length ? campos : undefined,
        }];
      } else {
        carga.content = [c, ...links].filter(Boolean).join("\n").slice(0, 1900) || undefined;
      }
      if (!carga.content && !carga.embeds && !arquivos.length) continue;

      await clienteDoWebhook(destino.webhook).send(carga);
    } catch (e) {
      console.error("idioma: nao consegui replicar em", destino.idioma, e?.message || e);
    }
  }
}

async function sincronizarSalas() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const aliancaId = await aliancaDoGuild(guild.id);
      if (!aliancaId) continue;

      const salas = await sb(`discord_chat_espelho?alianca_id=eq.${aliancaId}&select=canal_id,idioma,webhook,role_id,categoria_id`);
      if (!salas?.length) continue; // ninguem ligou o espelho nesta alianca

      /* So idioma que esta no seletor vira sala. Um valor estranho no banco
         nao pode virar canal no servidor de ninguem. */
      const validos = new Set(LINGUAS_MENU.map(([c]) => c));
      const escolhas = await sb(`discord_idioma_jogador?select=discord_user_id,idioma`);
      const porPessoa = new Map();
      for (const e of escolhas || []) {
        if (validos.has(e.idioma)) porPessoa.set(String(e.discord_user_id), e.idioma);
      }

      const porIdioma = new Map(salas.map((s) => [s.idioma, s]));

      /* Sala sem cargo e' sala aberta: ou nasceu antes desta ideia, ou alguem
         apagou o cargo. Nos dois casos ela esta visivel pra todo mundo agora,
         entao o conserto e' o mesmo -- cria o cargo e fecha a porta. */
      for (const sala of porIdioma.values()) {
        if (sala.role_id && guild.roles.cache.has(sala.role_id)) continue;
        try {
          const canal = await guild.channels.fetch(sala.canal_id);
          if (!canal) continue;
          const cargo = await guild.roles.create({
            name: nomeDoIdioma(sala.idioma), mentionable: false,
            reason: "sala de idioma do chat espelhado",
          });
          await canal.permissionOverwrites.set([
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: cargo.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks] },
          ], "fechando a sala de idioma");
          await sbPatch(`discord_chat_espelho?canal_id=eq.${encodeURIComponent(sala.canal_id)}`, { role_id: cargo.id });
          sala.role_id = cargo.id;
          console.log(`espelho: sala de ${sala.idioma} fechada, cargo criado`);
        } catch (e) {
          console.error("espelho: nao consegui fechar a sala de", sala.idioma, e?.message || e);
        }
      }

      /* Idioma com gente e sem sala ganha sala agora. */
      for (const idioma of new Set(porPessoa.values())) {
        if (porIdioma.has(idioma)) continue;
        try {
          porIdioma.set(idioma, await garantirSala(guild, aliancaId, idioma));
        } catch (e) {
          console.error("espelho: nao consegui criar a sala de", idioma, e?.message || e);
        }
      }

      /* Modo lento nas salas que nasceram antes dele.

         O NOME da sala nao se decide mais aqui: quem manda nele e' o canal
         original que a replica copia (ver montarCategorias). Duas partes do
         codigo querendo nomes diferentes renomeariam o canal de dez em dez
         minutos, cada uma desfazendo a outra, ate estourar o limite de duas
         trocas de nome a cada dez minutos que o Discord impoe. */
      for (const sala of porIdioma.values()) {
        try {
          const canal = await guild.channels.fetch(sala.canal_id);
          if (!canal) continue;

          if (canal.rateLimitPerUser !== SEGUNDOS_ENTRE_FALAS) {
            await canal.setRateLimitPerUser(SEGUNDOS_ENTRE_FALAS, "modo lento do chat espelhado");
            console.log(`espelho: modo lento de ${SEGUNDOS_ENTRE_FALAS}s na sala de ${sala.idioma}`);
          }
        } catch (e) {
          console.error("espelho: nao consegui acertar a sala de", sala.idioma, e?.message || e);
        }
      }

      /* Cargo de sala e' exclusivo: entrar numa e' sair das outras, senao a
         pessoa passaria a ver a mesma conversa repetida em dois idiomas. */
      const cargosDeSala = new Set([...porIdioma.values()].map((s) => s.role_id).filter(Boolean));
      const membros = await guild.members.fetch();
      for (const [, membro] of membros) {
        if (membro.user.bot) continue;
        const querido = porIdioma.get(porPessoa.get(membro.id))?.role_id || null;
        for (const cargo of cargosDeSala) {
          const tem = membro.roles.cache.has(cargo);
          if (cargo === querido && !tem) {
            await membro.roles.add(cargo, "idioma escolhido no bot").catch((e) =>
              console.error("espelho: nao consegui dar o cargo a", membro.id, e?.message || e));
          } else if (cargo !== querido && tem) {
            await membro.roles.remove(cargo, "trocou de idioma").catch((e) =>
              console.error("espelho: nao consegui tirar o cargo de", membro.id, e?.message || e));
          }
        }
      }
      /* Depois dos cargos: a categoria e' fechada com o cargo do idioma, e
         sem ele nao ha como fechar porta nenhuma. */
      await montarCategorias(guild, aliancaId, porIdioma);

      cacheEspelho.delete(aliancaId); // a proxima mensagem le a lista nova
    } catch (e) {
      console.error("espelho: sincronia falhou em", guild.id, e?.message || e);
    }
  }
}

/* ---------------- portaria: o convite pro idioma nos canais publicos ----------

   O hall de entrada so pega quem CHEGA agora. Quem ja estava no servidor
   antes do seletor existir nunca passou por ele -- e e' justamente a maioria.
   Entao o convite tem que ir aonde essas pessoas ja estao: nos canais que elas
   abrem todo dia.

   Sao dois papeis, na mesma tabela:

   - "portao": o canal fecha pra escrita e ganha a mensagem de escolha. E' o
     caso do chat geral. A ideia nao e' calar ninguem: e' que quem for falar
     de de cara com o seletor, escolha, e caia na sala do proprio idioma --
     onde a fala dele chega traduzida pros outros. Ler continua liberado, e a
     conversa antiga continua ali.

   - "convite": o canal segue publico e igual, so ganha a mensagem fixada
     dizendo que agora da' pra receber o conteudo ja traduzido.

   Em qualquer um dos dois a mensagem tem que sair PELO BOT, nao por webhook:
   webhook comum nao carrega componente, e sem componente nao ha seletor.

   O id da mensagem fica guardado. Se ela ainda existe, nao se posta de novo --
   e' isso que deixa esta funcao rodar de dez em dez minutos sem entulhar o
   canal. Se alguem apagar, a proxima passada repoe. */

const CONVITE = {
  portao: [
    "🌐 **Selecione seu idioma / Select your language**",
    "",
    "🇧🇷 Este chat agora é traduzido. Escolha seu idioma abaixo e você entra na sala da aliança no seu próprio idioma.",
    "🇬🇧 This chat is now translated. Pick your language below and you'll join the alliance room in your own language.",
    "🇸🇦 أصبحت هذه الدردشة مترجمة. اختر لغتك أدناه وستنضم إلى غرفة التحالف بلغتك.",
    "🇪🇸 Este chat ahora está traducido. Elige tu idioma abajo y entrarás en la sala de la alianza en tu idioma.",
    "🇨🇳 此聊天现已支持翻译。在下方选择你的语言，即可进入你所用语言的联盟聊天室。",
    "",
    "👉 O que você escrever lá chega traduzido para todo mundo — e o que os outros escreverem chega traduzido para você.",
    "👉 What you write there reaches everyone translated — and what they write reaches you translated.",
  ].join("\n"),
  convite: [
    "🌐 **Agora dá para ler tudo no seu idioma / Now you can read this in your language**",
    "",
    "🇧🇷 Escolha seu idioma abaixo e a aliança passa a falar com você no seu idioma.",
    "🇬🇧 Pick your language below and the alliance starts speaking to you in your own language.",
    "🇸🇦 اختر لغتك أدناه وسيبدأ التحالف بالتحدث معك بلغتك.",
    "🇪🇸 Elige tu idioma abajo y la alianza empezará a hablarte en tu idioma.",
    "🇨🇳 在下方选择你的语言，联盟将用你的语言与你交流。",
  ].join("\n"),
};

/* Fechar o portao e' tirar SO o direito de falar, e tirar os tres jeitos de
   falar -- mensagem, topico novo e resposta dentro de topico. Deixar qualquer
   um deles aberto seria fechar a porta da frente e esquecer a janela. */
async function fecharPortao(canal) {
  const todos = canal.guild.roles.everyone.id;
  const atual = canal.permissionOverwrites.cache.get(todos);
  if (atual?.deny.has(PermissionFlagsBits.SendMessages)) return;
  await canal.permissionOverwrites.edit(todos, {
    SendMessages: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
  }, { reason: "chat geral virou hall de escolha de idioma" });
  console.log(`portaria: #${canal.name} fechado pra escrita`);
}

async function garantirConvites() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const aliancaId = await aliancaDoGuild(guild.id);
      if (!aliancaId) continue;

      const portas = await sb(
        `discord_convite_idioma?alianca_id=eq.${aliancaId}&select=canal_id,tipo,mensagem_id`);
      if (!portas?.length) continue;

      for (const porta of portas) {
        try {
          const canal = await guild.channels.fetch(porta.canal_id).catch(() => null);
          if (!canal) {
            console.error("portaria: canal", porta.canal_id, "nao existe mais");
            continue;
          }

          if (porta.tipo === "portao") await fecharPortao(canal);

          if (porta.mensagem_id) {
            const viva = await canal.messages.fetch(porta.mensagem_id).catch(() => null);
            if (viva) continue; // ja esta la, nao posta de novo
          }

          const posta = await canal.send({
            content: CONVITE[porta.tipo] || CONVITE.convite,
            components: menuIdioma(),
            allowedMentions: { parse: [] },
          });
          await posta.pin("convite de idioma").catch((e) =>
            console.error("portaria: nao consegui fixar em", canal.name, e?.message || e));

          await sbPatch(
            `discord_convite_idioma?alianca_id=eq.${aliancaId}&canal_id=eq.${encodeURIComponent(porta.canal_id)}`,
            { mensagem_id: posta.id });
          console.log(`portaria: convite posto em #${canal.name} (${porta.tipo})`);
        } catch (e) {
          console.error("portaria: falhei no canal", porta.canal_id, e?.message || e);
        }
      }
    } catch (e) {
      console.error("portaria: falhei no servidor", guild.id, e?.message || e);
    }
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

      /* Nem a replica: o que chega nela JA e' a traducao. */
      if ((await replicasDoIdioma(aliancaId)).some((c) => c.canal_id === msg.channel.id)) return;

      /* Canal publico que abastece as replicas: o aviso sai daqui traduzido
         pra cada idioma. Nao e' um "return" -- o canal publico continua
         servindo quem nunca escolheu idioma, com o tradutor de sempre. */
      const fonte = (await fontesReplica(aliancaId)).get(msg.channel.id);
      if (fonte) await replicarPorIdioma(msg, aliancaId, fonte);

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
      /* Sem trava de quantidade aqui, de proposito.

         O limite de seis por minuto existe pro seletor de traducao: sem ele,
         quem escrevesse dez linhas seguidas encheria o canal de caixinhas. Mas
         no espelho a mensagem descartada nao e' uma caixinha a menos -- e' uma
         FALA que some. A pessoa do outro lado ve a conversa com buraco e nao
         tem como saber. Vale mais deixar passar. */
      await espelharMensagem(msg, espelho, origem, texto);
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
  /* Uma vez ao subir, pra quem trocou de idioma com o bot fora do ar nao
     ficar esperando dez minutos, e depois de tempos em tempos. */
  sincronizarSalas().catch((e) => console.error("espelho: sincronia inicial falhou:", e?.message || e));
  garantirConvites().catch((e) => console.error("portaria: passada inicial falhou:", e?.message || e));
  setInterval(() => {
    sincronizarSalas().catch((e) => console.error("espelho: sincronia falhou:", e?.message || e));
    garantirConvites().catch((e) => console.error("portaria: passada falhou:", e?.message || e));
  }, INTERVALO_SINCRONIA);
  setInterval(() => {
    sincronizarRecentes().catch((e) => console.error("espelho: passada curta falhou:", e?.message || e));
  }, 60 * 1000);
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
