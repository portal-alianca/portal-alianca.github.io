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
  /* Com o motivo junto. "supabase 400" sozinho me custou meia hora caçando
     uma instalacao que parava no meio: a resposta dizia exatamente qual
     coluna estava reclamando, e eu estava jogando isso fora. */
  if (!r.ok) throw new Error(`supabase ${r.status} em ${caminho}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

/* Canal apagado na mao tem que se curar sozinho.

   Alguem vai arrumar a barra lateral e apagar um canal do CYRON -- e' certo que
   vai acontecer. Ate agora o bot lia a linha no banco, tentava buscar o canal,
   nao achava, e seguia em frente: a linha ficava apontando pra um fantasma e o
   canal nunca voltava. O servidor emperrava sem ninguem entender por que.

   A regra passou a ser: o Discord manda. Se o canal nao esta la, a linha vai
   embora, e o caminho normal de criacao repoe na mesma passada.

   A lista de vivos vem de UMA busca por servidor, nao de um fetch por canal.
   Buscar um por um confunde "canal apagado" com "a rede falhou agora", e
   apagar linha por causa de falha de rede criaria canal duplicado ao lado do
   que ainda existe. A lista inteira nao tem esse meio-termo: ou ela veio, ou a
   passada nem comeca. */
async function idsVivos(guild) {
  const todos = await guild.channels.fetch();
  return new Set([...todos.filter(Boolean).keys()]);
}

async function sbDel(caminho) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    method: "DELETE",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`supabase ${r.status} ao apagar ${caminho}: ${(await r.text()).slice(0, 200)}`);
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
  if (!r.ok) throw new Error(`supabase ${r.status} em ${caminho}: ${(await r.text()).slice(0, 300)}`);
}

/* ---------------- quem e' o dono deste servidor ----------------

   Sao duas perguntas diferentes, e por muito tempo elas foram a mesma.

   "Que ALIANCA e' esta?" e' pergunta do Kingshot: serve pra achar o herói que
   assina o aviso, o GIF de boas-vindas, o ranking. Quem nao joga Kingshot nao
   tem alianca e nao precisa de nenhuma dessas coisas.

   "Que SERVIDOR e' este?" e' a pergunta do CYRON: portao de idioma, salas,
   replicas, plano. Um servidor de trading, de anime ou de uma empresa responde
   essa e nao responde a outra.

   Enquanto as duas eram uma so, o motor de traducao so existia pra quem
   tivesse alianca -- que e' o oposto de um produto. A [TOP] agora e' o
   primeiro cliente, nao o dono. */

const cacheServidor = new Map(); // guildId -> { v, t }
async function servidorDoGuild(guildId) {
  const achado = cacheServidor.get(guildId);
  if (achado && Date.now() - achado.t < 5 * 60 * 1000) return achado.v;
  let v = null;
  try {
    const r = await sb(`cyron_servidor?guild_id=eq.${encodeURIComponent(guildId)}&select=id,plano,teste_ate,canal_config,msg_config,limite_idiomas,limite_canais,tradutor,tradutor_chave,tradutor_regiao`);
    v = r?.[0] ?? null;
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheServidor.set(guildId, { v, t: Date.now() });
  return v;
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
/* Palavras que atravessam qualquer idioma sem ajuda. Traduzir "ok" pra seis
   linguas devolve "ok" seis vezes. */
const UNIVERSAIS = new Set([
  "ok", "okay", "okey", "k", "kk", "gg", "glhf", "wp", "lol", "lmao", "xd",
  "wow", "hmm", "hm", "zzz", "brb", "afk", "gm", "gn",
]);

/* O piso MUDA conforme quem pergunta, e essa distincao custou uma mensagem
   chegando em portugues na sala arabe.

   Pro seletor de traducao, o piso alto e' economia visual: sem ele, cada "ok"
   ganhava uma caixinha embaixo e o canal virava uma coluna de "Tradução /
   Translation". Doze caracteres e' mais ou menos onde comeca a frase.

   Pro espelho e pra replica, o piso alto e' um defeito: "obrigado", "bom dia"
   e "sim" sao exatamente o que a pessoa do outro lado precisa ler, e nenhum
   deles chega a doze letras. Ali o minimo e' dois, e quem segura o custo e' o
   cache -- vocabulario curto se repete o tempo todo, entao "obrigado" se paga
   uma vez e nunca mais. */
function vantajosoTraduzir(texto, teto = 800, minimo = 12) {
  const t = String(texto || "").trim();
  if (t.length < minimo || t.length > teto) return false;

  /* Sem a pontuacao do fim: "ok!" e "ok" sao a mesma coisa. */
  if (UNIVERSAIS.has(t.toLowerCase().replace(/[!?.…\s]+$/u, ""))) return false;

  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t)) return false;
  if (/^https?:\/\/\S+$/i.test(t)) return false;
  if (/^[\d\s.,:!?-]+$/.test(t)) return false;
  if (/^[/!.][a-z]/i.test(t)) return false; // parece comando

  /* So risadas e interjeicoes: "kkkkkk", "hahaha", "rsrsrs", "hehe".

     Exige quatro letras porque com o piso de dois esta regra passou a ser
     perigosa: "se", "as", "ei", "ir" e "ha" sao palavras de verdade e caem
     todas neste conjunto de letras. Risada de verdade nao tem duas letras. */
  if (t.length >= 4 && /^[kkhaeirs\s!?.]+$/i.test(t)) return false;

  return true;
}

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

const cacheEspelho = new Map(); // servidorId -> { v, t }
async function canaisEspelho(servidorId) {
  const achado = cacheEspelho.get(servidorId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = [];
  try {
    /* So idioma que TEM sala de conversa entra aqui. Depois que a linha passou
       a significar "este idioma existe" em vez de "esta sala existe", uma
       linha sem canal virou possivel -- e ela chegaria no espelharMensagem
       como um destino de webhook nulo. */
    v = await sb(`discord_chat_espelho?servidor_id=eq.${servidorId}&canal_id=not.is.null&select=canal_id,idioma,webhook,categoria_id`) || [];
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheEspelho.set(servidorId, { v, t: Date.now() });
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
    if (texto && destino.idioma !== origem.idioma && vantajosoTraduzir(texto, 1200, 2)) {
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

/* Teto por plano.

   Limitar CANAL seria olhar pro sintoma. O numero que manda em tudo aqui e' o
   de IDIOMAS: cada idioma novo e' uma categoria, mais um canal por tipo de
   aviso, mais uma copia de cada anuncio no tradutor. Segurando um numero,
   seguro os tres.

   O teto de canais existe por outro motivo, e vale pra todo mundo: e' valvula
   de seguranca. Um defeito meu num laco nao pode encher o servidor de alguem
   com trezentos canais -- e ja quase aconteceu duas vezes nesta semana, com a
   posicao e com o nome. */
const PLANOS = {
  gratis: { idiomas: 3,  canais: 20,  fontes: 2 },
  pago:   { idiomas: 20, canais: 200, fontes: 10 },
};

/* O plano que VALE agora, que nem sempre e' o que esta gravado.

   Um teste de sete dias nao pode ser gravado como plano = 'pago': alguem
   teria que lembrar de desfazer quando vencesse, e ninguem lembra. Fica numa
   data, e o vencimento acontece sozinho -- na varredura seguinte o servidor ja
   e' tratado como gratis, sem ninguem rodar nada.

   Uma funcao so' pra isso porque "este servidor e' pago?" aparece em varios
   lugares. Espalhar a regra seria garantir que um deles ficasse pra tras no
   dia em que ela mudasse. */
function planoDe(servidor) {
  if (servidor?.plano === "pago") return "pago";
  const ate = servidor?.teste_ate ? Date.parse(servidor.teste_ate) : 0;
  if (ate && ate > Date.now()) return "pago";
  return "gratis";
}

/* Idiomas que alguem escolheu e que nao couberam no plano.

   Mora em memoria de proposito: e' um retrato do momento, recalculado a cada
   varredura. Guardar no banco criaria uma segunda verdade pra manter em dia --
   e a primeira coisa que ficaria velha seria justamente esta. */
const esperando = new Map(); // servidorId -> [{ idioma, quantos }]

/* Avisa a administracao que alguem ficou de fora.

   O aviso vai pra sala de comando, nao pra pessoa que escolheu: quem pode
   resolver e' quem manda no servidor. Dizer pra ela "seu idioma nao cabe"
   seria dar um problema que ela nao tem como resolver.

   Uma vez por partida do bot, por idioma. Repetir de dez em dez minutos
   transformaria o aviso em barulho, e barulho a gente aprende a ignorar --
   inclusive quando ele passa a ser importante. */
async function avisarDoTeto(guild, servidor, naoCoube, limite) {
  if (!servidor.canal_config) return;
  const novos = naoCoube.filter(([idioma]) => umaVezPorProcesso(`teto:${servidor.id}:${idioma}`));
  if (!novos.length) return;

  const canal = await guild.channels.fetch(servidor.canal_config).catch(() => null);
  if (!canal) return;

  const quem = novos
    .map(([idioma, quantos]) => `• ${nomeDoIdioma(idioma)} — ${quantos} ${quantos === 1 ? "pessoa" : "pessoas"}`)
    .join("\n");

  await canal.send({
    content: [
      `⚠️ **Alguém escolheu um idioma que não cabe no plano ${planoDe(servidor)}.**`,
      "",
      quem,
      "",
      `Você está usando **${limite.idiomas} de ${limite.idiomas}** idiomas. Essas pessoas escolheram o idioma delas ` +
      "e não receberam canal nenhum — para elas parece que o bot não funcionou.",
      "",
      "Para resolver: suba de plano, ou peça a elas que escolham um dos idiomas que já existem aqui.",
    ].join("\n"),
    allowedMentions: { parse: [] },
  }).catch((e) => console.error("limite: nao consegui avisar:", e?.message || e));
}

/* Um pedido de canal. Devolve false quando o orcamento acabou, e avisa uma
   vez so' -- repetir a mesma linha a cada canal recusado encheria o log e
   esconderia o resto. */
function podeCriarCanal(orcamento, guild, limite) {
  if (orcamento.resta > 0) { orcamento.resta -= 1; return true; }
  if (!orcamento.avisou) {
    orcamento.avisou = true;
    console.log(`limite: ${guild.name} bateu o teto de ${limite.canais} canais; não crio mais nada nesta passada`);
  }
  return false;
}

function limitesDo(servidor) {
  const base = PLANOS[planoDe(servidor)] || PLANOS.gratis;
  return {
    idiomas: servidor?.limite_idiomas ?? base.idiomas,
    canais: servidor?.limite_canais ?? base.canais,
    fontes: base.fontes,
  };
}

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

/* Um idioma passa a EXISTIR num servidor quando alguem o escolhe. Existir
   quer dizer: ter um cargo (a chave que abre as portas dele) e uma linha no
   banco. A sala de conversa e' um bem desse idioma, nao a definicao dele --
   por isso ela nasce numa funcao separada, e so no plano pago. */
async function garantirIdioma(guild, servidorId, idioma) {
  const cargo = await guild.roles.create({
    name: nomeDoIdioma(idioma),
    mentionable: false,
    reason: "cargo do idioma",
  });

  const linha = { servidor_id: servidorId, idioma, role_id: cargo.id };
  /* Devolve a linha COM o id que o banco deu.

     Montando o objeto na mao eu perdia o id, e quem recebe esse idioma na
     mesma passada (a categoria, a sala de conversa) grava filtrando por ele.
     Sem id, o filtro nao casa com nada, o categoria_id nunca fica gravado, e
     a passada seguinte cria tudo de novo achando que nao existia. */
  const gravada = await sbPost("discord_chat_espelho", linha);
  const id = Array.isArray(gravada) ? gravada[0]?.id : gravada?.id;
  if (!id) throw new Error(`gravei o idioma ${idioma} mas nao recebi o id de volta`);

  console.log(`idioma: ${idioma} agora existe neste servidor`);
  return { ...linha, id, canal_id: null, webhook: null, categoria_id: null };
}

/* A sala de conversa: privada, com modo lento, e o webhook por onde a fala
   dos outros idiomas chega traduzida. So no plano pago -- e' o unico recurso
   daqui que custa por mensagem. */
async function garantirCanalDeChat(guild, sala, categoriaId) {
  const canal = await guild.channels.create({
    name: `${PREFIXO_SALA}${sala.idioma.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: categoriaId || undefined,
    rateLimitPerUser: SEGUNDOS_ENTRE_FALAS,
    topic: `Chat espelhado — ${nomeDoIdioma(sala.idioma)}. O que for dito aqui aparece nas outras salas traduzido.`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: sala.role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks] },
    ],
    reason: "sala de conversa do idioma",
  });

  /* Mesma regra da replica: se nao ficou gravado, nao pode ficar de pe. */
  let webhook;
  try {
    webhook = await canal.createWebhook({ name: "CYRON espelho" });
    await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(sala.id)}`,
      { canal_id: canal.id, webhook: webhook.url });
  } catch (e) {
    await canal.delete("não consegui registrar a sala; desfazendo").catch(() => {});
    throw new Error(`sala de ${sala.idioma} desfeita: ${e?.message || e}`);
  }

  sala.canal_id = canal.id;
  sala.webhook = webhook.url;
  console.log(`espelho: sala de conversa criada para ${sala.idioma} (#${canal.name})`);
  return sala;
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

/* Quanto a passada curta espera antes de remontar o mesmo servidor de novo.

   Dois minutos e' mais que o suficiente pra parecer instantaneo pra quem
   acabou de escolher, e curto o bastante pra nao virar espera de verdade se a
   primeira tentativa falhar. */
const ESPERA_REMONTAR = 2 * 60 * 1000;
const ultimaMontagem = new Map(); // guildId -> quando

async function sincronizarRecentes() {
  const desde = new Date(Date.now() - JANELA_RECENTE).toISOString();
  for (const [, guild] of client.guilds.cache) {
    try {
      const servidor = await servidorDoGuild(guild.id);
      if (!servidor) continue;
      const servidorId = servidor.id;

      /* Sem "salas vazias, sai fora" aqui: o servidor recem-instalado tem ZERO
         idiomas, e e' justamente a primeira pessoa a escolher que nao pode
         esperar. */
      const salas = await sb(`discord_chat_espelho?servidor_id=eq.${servidorId}&select=idioma,role_id`) || [];

      const recentes = await sb(
        `discord_idioma_jogador?atualizado_em=gte.${encodeURIComponent(desde)}&select=discord_user_id,idioma`);
      if (!recentes?.length) continue;

      /* Idioma escolhido agora e que ainda nao existe aqui: nao da' pra so
         distribuir cargo, porque nao ha cargo. Chama a varredura completa
         DESTE servidor -- e' cara (lista os membros todos), mas so roda quando
         alguem de fato trouxe uma lingua nova, o que e' raro.

         Sem isso a pessoa clicava, nao acontecia nada por ate dez minutos, e
         concluia que o bot nao funciona. Foi o que aconteceu no primeiro teste
         com gente de verdade. */
      const jaTem = new Set(salas.map((s) => s.idioma));
      const candidatos = recentes.filter((e) => !jaTem.has(e.idioma));

      /* Pergunta por UMA pessoa de cada vez, nao pela lista inteira.

         Pedir a lista completa de membros e' opcode 8 no gateway, e o Discord
         limita isso com força. Como esta passada roda de minuto em minuto e o
         candidato continua candidato enquanto a sala nao existir, cada falha
         garantia uma nova tentativa no minuto seguinte -- um laco que se
         alimenta do proprio fracasso, e que travou os tres servidores ao mesmo
         tempo com "rate limited, retry after 28s".

         Buscar um membro pelo id vai por REST, que tem outro limite e e'
         barato. Sao um ou dois candidatos por vez, quase sempre. */
      let novidade = false;
      for (const escolha of candidatos) {
        const membro = await guild.members.fetch(String(escolha.discord_user_id)).catch(() => null);
        if (membro && !membro.user.bot) { novidade = true; break; }
      }

      /* E mesmo havendo novidade, nao remonta o servidor inteiro toda hora.

         A varredura completa lista os membros todos -- se ela falhar (e falhou,
         por limite), o idioma continua faltando e o minuto seguinte tentaria de
         novo. A espera transforma insistencia em tentativa espaçada. */
      const agora = Date.now();
      if (novidade && agora - (ultimaMontagem.get(guild.id) || 0) < ESPERA_REMONTAR) novidade = false;

      if (novidade) {
        ultimaMontagem.set(guild.id, agora);
        console.log(`idioma: ${guild.name} tem idioma novo escolhido agora; montando sem esperar`);
        await sincronizarAgora(guild);
        return;
      }

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

/* Nao ha mais lista de replicas no codigo, e nao deve haver.

   Ela era fixa: evento, urso, dica, game. Vocabulario de Kingshot aplicado a
   todo servidor -- um servidor de comida italiana ganhava um canal "urso-pt"
   que nao quer dizer nada pra ninguem ali.

   A regra que vale em qualquer servidor e' esta: REPLICA EXISTE PORQUE EXISTE
   UM CANAL-FONTE. Quem tem um #receitas ganha receitas-pt e receitas-en; quem
   tem um #urso ganha urso-pt. O motor nao precisa saber o que e' urso nem o
   que e' receita -- e e' justamente por nao saber que ele serve pros dois. */

/* A replica se chama como o canal que ela copia, mais o codigo do idioma:
   "🎯-event-guide📢" vira "🎯-event-guide📢-pt". Nome inventado ("evento-pt")
   obriga cada pessoa a aprender um vocabulario novo pra achar o mesmo canal de
   sempre; copiando o original ela reconhece de primeira.

   O nome vem do Discord, nao de uma constante daqui: se o oficial renomear o
   canal original, as sete replicas seguem atras sozinhas.

   Se a fonte sumir, o prefixo simples serve de rede -- e' feio, mas e' melhor
   do que nao criar o canal. */
function nomeDaReplica(modelo, rotulo, idioma) {
  return `${modelo || rotulo}-${idioma}`.toLowerCase().slice(0, 100);
}

const cacheFontes = new Map(); // servidorId -> { v: Map(canal_id -> tipo), t }
async function fontesReplica(servidorId) {
  const achado = cacheFontes.get(servidorId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = new Map();
  try {
    const r = await sb(`discord_fonte_replica?servidor_id=eq.${servidorId}&select=canal_id,tipo,gera_replica&order=criado_em.asc`) || [];
    v = new Map(r.map((f) => [f.canal_id, f.tipo]));
    /* Quais fontes viram canal. A do chat entra na lista so pra emprestar o
       nome do canal original pra sala de conversa -- o espelho ja leva a fala
       de sala em sala, entao ela nao pode gerar replica tambem. */
    v.geraReplica = new Set(r.filter((f) => f.gera_replica).map((f) => f.canal_id));
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheFontes.set(servidorId, { v, t: Date.now() });
  return v;
}

const cacheReplicas = new Map(); // servidorId -> { v, t }
async function replicasDoIdioma(servidorId) {
  const achado = cacheReplicas.get(servidorId);
  if (achado && Date.now() - achado.t < 60 * 1000) return achado.v;
  let v = [];
  try {
    v = await sb(`discord_canal_idioma?servidor_id=eq.${servidorId}&select=canal_id,idioma,tipo,webhook`) || [];
  } catch { /* tenta de novo na proxima mensagem */ }
  cacheReplicas.set(servidorId, { v, t: Date.now() });
  return v;
}

/* Negar "mandar mensagem" nao basta pra fazer um canal de so-leitura.

   Faltando as tres portas de tópico, o Discord entende o canal como "canal de
   tópicos apenas" e troca a caixa de escrever por um botao "Criar tópico" --
   ou seja, a pessoa continua podendo falar, so que por outro caminho, e cada
   fala dessas viraria um tópico solto num canal que existe pra ler aviso.

   Sao as mesmas tres portas do portao do chat geral: mensagem, tópico novo e
   resposta dentro de tópico. Fechar uma e esquecer as outras e' trancar a
   porta da frente e deixar a janela aberta. */
const SO_LEITURA = {
  SendMessages: false,
  AddReactions: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  SendMessagesInThreads: false,
};

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

async function garantirCategoria(guild, sala, pistaCanal) {
  if (sala.categoria_id) {
    const achada = await guild.channels.fetch(sala.categoria_id).catch(() => null);
    if (achada) return achada;
  }

  /* Sem categoria gravada, mas com canal deste idioma ja de pe: a categoria e'
     onde esse canal mora. Adota em vez de criar outra.

     Isto conserta a deriva que o filtro errado deixou -- categoria existindo no
     Discord e nao no banco --, e vale como regra geral: se o canal esta dentro
     de alguma categoria, aquela E' a categoria do idioma, tenha o banco
     acompanhado ou nao. Criar uma nova ao lado seria acreditar mais no meu
     registro do que no servidor de verdade. */
  if (pistaCanal) {
    const canal = await guild.channels.fetch(pistaCanal).catch(() => null);
    if (canal?.parentId) {
      await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(sala.id)}`,
        { categoria_id: canal.parentId });
      sala.categoria_id = canal.parentId;
      console.log(`idioma: categoria de ${sala.idioma} readotada (${canal.parent?.name ?? canal.parentId})`);
      return canal.parent ?? await guild.channels.fetch(canal.parentId);
    }
  }

  if (!sala.role_id) return null; // sem cargo nao ha como fechar a porta

  const categoria = await guild.channels.create({
    name: nomeDoIdioma(sala.idioma),
    type: ChannelType.GuildCategory,
    permissionOverwrites: portasDaCategoria(guild, sala.role_id),
    reason: "categoria do idioma",
  });
  /* Filtra pelo id da LINHA, nao pelo canal.

     Filtrar por canal_id funcionava quando toda linha tinha um canal. Depois
     que a linha passou a significar "este idioma existe" -- e no plano gratis
     nao ha sala de conversa --, canal_id virou nulo, o filtro deixou de casar
     com nada, e categoria_id nunca era gravado.

     O estrago nao era uma coluna vazia: era a varredura achando, a cada dez
     minutos, que a categoria nao existia, e criando OUTRA. Categoria nova de
     dez em dez minutos, para sempre, ate o teto de canais segurar. */
  await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(sala.id)}`,
    { categoria_id: categoria.id });
  sala.categoria_id = categoria.id;
  console.log(`idioma: categoria criada para ${sala.idioma} (${categoria.name})`);
  return categoria;
}

async function garantirReplica(guild, servidorId, sala, categoria, def, posicao, nome) {
  /* Ja existe um canal com este nome nesta categoria? Adota.

     Mesma regra da categoria: o Discord manda, nao o meu registro. Um canal
     com o nome exato, dentro da categoria daquele idioma, E' a replica --
     tenha o banco acompanhado ou nao.

     Sem isto, todo canal que ficou orfao (criado e nao gravado) vira um
     duplicado permanente ao lado do bom, e quem olha a barra lateral ve quatro
     canais iguais sem saber qual funciona. */
  const antigo = categoria.children?.cache?.find(
    (c) => c.type === ChannelType.GuildText && c.name === nome);
  if (antigo) {
    const webhooks = await antigo.fetchWebhooks().catch(() => null);
    const webhook = webhooks?.find((w) => w.token) || await antigo.createWebhook({ name: "CYRON" });
    await sbPost("discord_canal_idioma", {
      servidor_id: servidorId, idioma: sala.idioma, tipo: def.tipo,
      canal_id: antigo.id, webhook: webhook.url,
    });
    console.log(`idioma: #${antigo.name} adotado (já existia)`);
    return;
  }

  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    parent: categoria.id,
    position: posicao,
    topic: `${def.tipo} — ${nomeDoIdioma(sala.idioma)}. Só leitura: quem escreve aqui é o bot.`,
    /* So-leitura de proposito: o cargo do idioma ve e le, mas nao fala.
       Conversa tem lugar, e o lugar e' o chat da mesma categoria.

       Tudo do cargo numa entrada so: dois overwrites com o mesmo id fazem o
       Discord ficar com um deles, e qual dos dois vira sorte. */
    permissionOverwrites: portasDaCategoria(guild, sala.role_id).map((p) =>
      p.id === sala.role_id ? { ...p, deny: Object.keys(SO_LEITURA).map((k) => PermissionFlagsBits[k]) } : p),
    reason: "replica do canal no idioma",
  });

  /* Se a linha nao gravar, o canal VOLTA.

     Sem isto, uma falha ao gravar deixa um canal que o bot nao conhece. A
     varredura seguinte olha o banco, nao acha a replica, e cria outra -- e
     outra, e outra, uma por passada, ate o teto de canais segurar. Foi
     exatamente o que aconteceu: quatro canais iguais lado a lado porque um
     CHECK no banco recusava o tipo depois de o canal ja existir.

     Criar no Discord e gravar no banco nao podem ser feitos numa transacao so.
     Como nao da' pra garantir que os dois aconteçam, garanto que nenhum
     sobreviva sozinho. */
  let webhook;
  try {
    webhook = await canal.createWebhook({ name: "CYRON" });
    await sbPost("discord_canal_idioma", {
      servidor_id: servidorId, idioma: sala.idioma, tipo: def.tipo,
      canal_id: canal.id, webhook: webhook.url,
    });
  } catch (e) {
    await canal.delete("não consegui registrar a réplica; desfazendo").catch(() => {});
    throw new Error(`replica ${def.tipo}/${sala.idioma} desfeita: ${e?.message || e}`);
  }
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
async function modelosDeNome(guild, servidorId) {
  const modelos = new Map();
  for (const [canalId, tipo] of await fontesReplica(servidorId)) {
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
async function esconderOriginais(guild, servidorId, cargosComReplica) {
  if (!cargosComReplica.size) return;

  const fontes = [...(await fontesReplica(servidorId)).keys()];
  let portoes = [];
  try {
    portoes = ((await sb(
      `discord_convite_idioma?servidor_id=eq.${servidorId}&tipo=eq.portao&select=canal_id`)) || [])
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
async function montarCategorias(guild, servidorId, porIdioma, pago, orcamento, limite, vivos) {
  const existentes = (await sb(
    `discord_canal_idioma?servidor_id=eq.${servidorId}&select=idioma,tipo,canal_id`)) || [];

  /* Replica apagada na mao e' o caso mais provavel de todos: alguem arruma a
     barra lateral e leva um canal junto. A linha sai daqui e do mapa, entao o
     laco logo abaixo trata como "nunca existiu" e cria de novo. */
  const vistos = [];
  for (const r of existentes) {
    if (vivos.has(r.canal_id)) { vistos.push(r); continue; }
    await sbDel(`discord_canal_idioma?canal_id=eq.${encodeURIComponent(r.canal_id)}`)
      .catch((e) => console.error("idioma: nao consegui limpar replica sumida", e?.message || e));
    console.log(`idioma: replica ${r.tipo} de ${r.idioma} sumiu, vai ser refeita`);
  }
  const porChave = new Map(vistos.map((r) => [`${r.idioma}|${r.tipo}`, r.canal_id]));
  const modelos = await modelosDeNome(guild, servidorId);
  const prontos = new Set();

  /* A lista de replicas DESTE servidor: uma por canal-fonte que gera replica.
     Ordem estavel pela ordem de cadastro, porque ela vira a ordem na barra
     lateral. */
  const fontes = await fontesReplica(servidorId);
  const tipos = [];
  for (const [canalId, tipo] of fontes) {
    if (!fontes.geraReplica?.has(canalId)) continue;
    if (tipos.some((t) => t.tipo === tipo)) continue; // duas fontes, um destino
    tipos.push({ tipo, nomeBase: modelos.get(tipo) || tipo });
  }
  if (!tipos.length) {
    console.log(`idioma: ${guild.name} não tem canal-fonte que gere réplica; só a categoria`);
  }

  for (const sala of porIdioma.values()) {
    try {
      /* Pista de onde a categoria deste idioma esta: qualquer canal dele que
         ja exista -- uma replica, ou a sala de conversa. */
      const pistaCanal = tipos.map((t) => porChave.get(`${sala.idioma}|${t.tipo}`))
        .find(Boolean) || sala.canal_id || null;

      if (!sala.categoria_id && !pistaCanal && !podeCriarCanal(orcamento, guild, limite)) continue;
      const categoria = await garantirCategoria(guild, sala, pistaCanal);
      if (!categoria) continue;

      /* Categoria do idioma no topo da barra lateral. Cada pessoa enxerga
         so a sua, entao pra ela isso e' "o meu servidor primeiro, o resto
         depois" -- que e' o ponto. */
      if (categoria.position !== 0 && umaVezPorProcesso(`topo:${categoria.id}`)) {
        await categoria.setPosition(0)
          .then(() => console.log(`idioma: categoria de ${sala.idioma} subiu pro topo`))
          .catch((e) => console.error("idioma: nao consegui subir a categoria de", sala.idioma, e?.message || e));
      }

      for (let i = 0; i < tipos.length; i++) {
        const def = tipos[i];
        const nome = nomeDaReplica(def.nomeBase, def.tipo, sala.idioma);
        const jaExiste = porChave.get(`${sala.idioma}|${def.tipo}`);

        if (!jaExiste) {
          if (!podeCriarCanal(orcamento, guild, limite)) continue;
          await garantirReplica(guild, servidorId, sala, categoria, def, i, nome);
          continue;
        }
        /* Ja existe: so acerta o nome se o original mudou de nome (ou se a
           replica nasceu com o nome antigo, inventado). */
        const canal = await guild.channels.fetch(jaExiste).catch(() => null);
        if (!canal) continue;
        if (canal.name !== nome && umaVezPorProcesso(`nome:${canal.id}:${nome}`)) {
          console.log(`idioma: #${canal.name} vira #${nome}`);
          await canal.setName(nome, "replica segue o nome do canal original");
        }
        /* Canal novo no meio da lista empurra os de baixo. Mesma guarda do
           nome: uma tentativa por partida, porque a posicao que o Discord
           devolve pode nao ser a que eu pedi e eu ficaria reordenando pra
           sempre. */
        /* Replica que nasceu antes de eu perceber a janela do tópico. */
        const doCargo = canal.permissionOverwrites.cache.get(sala.role_id);
        if (sala.role_id && !doCargo?.deny.has(PermissionFlagsBits.CreatePublicThreads)) {
          await canal.permissionOverwrites.edit(sala.role_id, SO_LEITURA,
            { reason: "replica e' so leitura, tópico tambem nao" });
          console.log(`idioma: #${canal.name} fechado pra tópico`);
        }

        if (canal.position !== i && umaVezPorProcesso(`pos:${canal.id}:${i}`)) {
          await canal.setPosition(i).catch((e) =>
            console.error("idioma: nao consegui ordenar", canal.name, e?.message || e));
        }
      }

      /* A sala de conversa e' o recurso pago. Ela nasce aqui, e nao junto do
         cargo, porque assim ja nasce dentro da categoria certa -- criar solta
         e mover depois deixaria o canal aparecendo no topo do servidor por
         alguns segundos, na frente de todo mundo. */
      if (pago && !sala.canal_id && podeCriarCanal(orcamento, guild, limite)) {
        try {
          await garantirCanalDeChat(guild, sala, categoria.id);
        } catch (e) {
          console.error("espelho: nao consegui criar a sala de conversa de", sala.idioma, e?.message || e);
        }
      }

      /* O chat entra por ultimo na lista: ler o aviso vem antes de responder
         a ele. */
      const chat = sala.canal_id ? await guild.channels.fetch(sala.canal_id).catch(() => null) : null;
      if (chat) {
        const nomeChat = nomeDaReplica(modelos.get("chat"), PREFIXO_SALA.replace(/-$/, ""), sala.idioma);
        if (chat.name !== nomeChat && umaVezPorProcesso(`nome:${chat.id}:${nomeChat}`)) {
          console.log(`idioma: chat de ${sala.idioma} vira #${nomeChat}`);
          await chat.setName(nomeChat, "chat segue o nome do canal original");
        }
        if (chat.parentId !== categoria.id) {
          await chat.setParent(categoria.id, { lockPermissions: false, reason: "chat vai pra categoria do idioma" });
          console.log(`idioma: chat de ${sala.idioma} movido pra ${categoria.name}`);
        }
        /* O chat fecha a categoria: ler o aviso vem antes de responder a ele. */
        if (chat.position !== tipos.length && umaVezPorProcesso(`pos:${chat.id}:${tipos.length}`)) {
          await chat.setPosition(tipos.length).catch(() => { /* posicao e' capricho */ });
        }
      }

      if (sala.role_id) prontos.add(sala.role_id);
    } catch (e) {
      console.error("idioma: nao consegui montar a categoria de", sala.idioma, e?.message || e);
    }
  }

  cacheReplicas.delete(servidorId);

  /* So depois de tudo montado: esconder o original de quem ainda nao tem pra
     onde ir deixaria a pessoa sem canal nenhum. */
  await esconderOriginais(guild, servidorId, prontos);
}

/* Leva o aviso do canal publico pra replica de cada idioma.

   Mantem o heroi que assinou (nome e foto do webhook de origem) e a forma da
   mensagem: se veio embed, sai embed com titulo e texto traduzidos e a imagem
   intacta. Traduzir so o texto e jogar fora a moldura faria o aviso do urso
   chegar sem o urso. */
async function replicarPorIdioma(msg, servidorId, tipo) {
  const destinos = (await replicasDoIdioma(servidorId)).filter((r) => r.tipo === tipo);
  if (!destinos.length) return;

  const emb = msg.embeds?.[0];
  const titulo = String(emb?.title || "").trim();
  const corpo = String(emb?.description || msg.content || "").trim();
  if (!titulo && !corpo && !msg.attachments.size) return;

  /* Apelido do servidor antes do nome global: e' assim que a pessoa aparece
     pros outros aqui dentro. Pra aviso automatico (webhook) nao ha membro, e
     o username ja e' o nome do heroi que assinou. */
  const nome = (msg.member?.displayName || msg.author?.username || "CYRON").slice(0, 80);
  const foto = msg.author?.displayAvatarURL({ extension: "png", size: 128 });
  const { arquivos, links } = msg.attachments.size ? await baixarAnexos(msg) : { arquivos: [], links: [] };

  for (const destino of destinos) {
    try {
      /* Teto alto de proposito: aqui o texto longo e' o que MAIS precisa de
         traducao. O vantajosoTraduzir continua servindo pra nao pagar por
         emoji, link solto e "ok". */
      const t = titulo && vantajosoTraduzir(titulo, TEXTO_MAXIMO, 2)
        ? (await traduzirLongo(titulo, destino.idioma)) || titulo : titulo;
      const c = corpo && vantajosoTraduzir(corpo, TEXTO_MAXIMO, 2)
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
            name: vantajosoTraduzir(campo.name, TEXTO_MAXIMO, 2)
              ? (await traduzirLongo(campo.name, destino.idioma)) || campo.name : campo.name,
            value: vantajosoTraduzir(campo.value, TEXTO_MAXIMO, 2)
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

/* A lista de membros, sem pedir de novo o que ja se sabe.

   Pedir a lista completa e' opcode 8 no gateway, com limite curto -- foi o que
   travou os tres servidores hoje. Mas com a intencao GuildMembers ligada, o
   discord.js recebe cada entrada e saida por evento e mantem a memoria em dia.
   Se ela ja tem todo mundo, perguntar de novo e' pagar caro pela mesma
   resposta.

   E' isto que deixa a montagem virar acao imediata em vez de tarefa de dez em
   dez minutos: sem o pedido caro no meio, sincronizar um servidor fica barato
   o bastante pra rodar quando a pessoa clica. */
async function membrosDo(guild) {
  if (guild.members.cache.size >= (guild.memberCount ?? Infinity)) return guild.members.cache;
  return await guild.members.fetch();
}

/* Montar agora, sem esperar o relogio -- e sem atropelar.

   Duas montagens do mesmo servidor ao mesmo tempo brigariam pelas mesmas
   linhas e criariam canal repetido. Entao: se ja tem uma rodando, a segunda
   nao comeca, so deixa um bilhete. Quem esta rodando ve o bilhete no fim e
   roda mais uma vez -- assim o ultimo pedido sempre e' atendido, e nunca ha
   dois ao mesmo tempo. */
const montando = new Set();
const montarDeNovo = new Set();

async function sincronizarAgora(guild) {
  if (montando.has(guild.id)) { montarDeNovo.add(guild.id); return; }
  montando.add(guild.id);
  try {
    do {
      montarDeNovo.delete(guild.id);
      await sincronizarUmGuild(guild);
    } while (montarDeNovo.has(guild.id));
  } catch (e) {
    console.error("espelho: montagem imediata falhou em", guild.name, e?.message || e);
  } finally {
    montando.delete(guild.id);
  }
}

async function sincronizarSalas() {
  for (const [, guild] of client.guilds.cache) {
    try {
      await sincronizarUmGuild(guild);
    } catch (e) {
      console.error("espelho: sincronia falhou em", guild.id, e?.message || e);
    }
  }
}

/* A varredura de um servidor so'.

   Existe separada porque a passada curta precisa chamar ela: quem acabou de
   escolher um idioma que ainda nao existe aqui nao pode esperar dez minutos
   olhando pra uma barra lateral que nao mudou. Ele clica, nao acontece nada, e
   conclui que o bot nao funciona -- que foi exatamente o que aconteceu no
   primeiro teste com gente de verdade. */
async function sincronizarUmGuild(guild) {
      const servidor = await servidorDoGuild(guild.id);
      if (!servidor) return;
      const servidorId = servidor.id;

      const pago = planoDe(servidor) === "pago";
      const limite = limitesDo(servidor);

      /* Orcamento de canais desta passada.

         Conta o que o bot ja criou (replica + sala de conversa + categoria) e
         desconta do teto. Cada criacao gasta um; chegando a zero, ninguem cria
         mais nada nesta passada e o motivo aparece no log.

         Isto e' cinto de seguranca, nao regra de negocio: mesmo o plano pago
         tem teto, porque o que eu preciso impedir e' um erro meu -- um laco
         que se repete, um nome que nunca casa -- transformar o servidor de um
         cliente em trezentos canais. */
      const orcamento = { resta: limite.canais, avisou: false };

      const vivos = await idsVivos(guild);

      /* Fonte apagada na mao: sem ela nao ha o que replicar, entao a linha sai
         e o reparo da instalacao recria o canal. */
      for (const fonte of (await sb(`discord_fonte_replica?servidor_id=eq.${servidorId}&select=canal_id`)) || []) {
        if (vivos.has(fonte.canal_id)) continue;
        await sbDel(`discord_fonte_replica?canal_id=eq.${encodeURIComponent(fonte.canal_id)}`);
        console.log(`idioma: canal-fonte ${fonte.canal_id} sumiu, linha removida pra ser refeita`);
      }

      const salas = await sb(`discord_chat_espelho?servidor_id=eq.${servidorId}&select=id,canal_id,idioma,webhook,role_id,categoria_id`) || [];

      /* Sala de conversa e categoria apagadas: esvazia a coluna em vez de
         apagar a linha -- o IDIOMA continua existindo, com o cargo e as
         pessoas dentro dele. So o canal precisa voltar. */
      for (const sala of salas) {
        const limpa = {};
        if (sala.canal_id && !vivos.has(sala.canal_id)) { limpa.canal_id = null; limpa.webhook = null; }
        if (sala.categoria_id && !vivos.has(sala.categoria_id)) limpa.categoria_id = null;
        if (!Object.keys(limpa).length) continue;
        await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(sala.id)}`, limpa);
        Object.assign(sala, limpa);
        console.log(`idioma: ${sala.idioma} perdeu ${Object.keys(limpa).join(" e ")}, vai ser refeito`);
      }

      /* So idioma que esta no seletor vira sala. Um valor estranho no banco
         nao pode virar canal no servidor de ninguem. */
      const validos = new Set(LINGUAS_MENU.map(([c]) => c));
      const escolhas = await sb(`discord_idioma_jogador?select=discord_user_id,idioma`);
      const escolhaDe = new Map();
      for (const e of escolhas || []) {
        if (validos.has(e.idioma)) escolhaDe.set(String(e.discord_user_id), e.idioma);
      }

      /* A escolha de idioma e' da PESSOA e vale em qualquer servidor -- e' o
         certo, a lingua dela nao muda de porta em porta. Mas a lista inteira
         de escolhas nao pode virar canal aqui dentro: so conta quem e' membro
         DESTE servidor.

         Sem isso, um servidor recem-instalado nascia com uma categoria pra
         cada idioma que qualquer pessoa ja tivesse escolhido em qualquer
         outro lugar -- sete categorias de linguas que ninguem ali fala, no
         primeiro minuto de uso. Passava despercebido enquanto havia um
         servidor so, porque ali todo mundo era membro. */
      const membros = await membrosDo(guild);
      const porPessoa = new Map();
      const falantes = new Map(); // idioma -> quantos, aqui dentro
      for (const [id, membro] of membros) {
        if (membro.user.bot) continue;
        const idioma = escolhaDe.get(id);
        if (!idioma) continue;
        porPessoa.set(id, idioma);
        falantes.set(idioma, (falantes.get(idioma) || 0) + 1);
      }

      const porIdioma = new Map(salas.map((s) => [s.idioma, s]));

      /* Desconta o que ja esta de pe: categoria, sala de conversa e replica. */
      const replicasFeitas = await sb(
        `discord_canal_idioma?servidor_id=eq.${servidorId}&select=canal_id`) || [];
      orcamento.resta -= replicasFeitas.length;
      for (const sala of porIdioma.values()) {
        if (sala.canal_id) orcamento.resta -= 1;
        if (sala.categoria_id) orcamento.resta -= 1;
      }

      /* Idioma sem cargo e' porta sem chave: ou nasceu antes desta ideia, ou
         alguem apagou o cargo na mao. Cria de novo e refecha o que estiver
         aberto. */
      for (const sala of porIdioma.values()) {
        if (sala.role_id && guild.roles.cache.has(sala.role_id)) continue;
        try {
          const canal = sala.canal_id ? await guild.channels.fetch(sala.canal_id).catch(() => null) : null;
          const cargo = await guild.roles.create({
            name: nomeDoIdioma(sala.idioma), mentionable: false,
            reason: "sala de idioma do chat espelhado",
          });
          if (canal) {
            await canal.permissionOverwrites.set([
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              { id: cargo.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
              { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks] },
            ], "fechando a sala de idioma");
          }
          await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(sala.id)}`, { role_id: cargo.id });
          sala.role_id = cargo.id;
          console.log(`idioma: cargo de ${sala.idioma} recriado`);
        } catch (e) {
          console.error("espelho: nao consegui fechar a sala de", sala.idioma, e?.message || e);
        }
      }

      /* Idioma com gente de verdade passa a existir, do mais falado pro menos
         -- e ate o teto do plano.

         A ordem importa por causa do teto: se o gratis leva tres, tem que
         levar OS TRES MAIORES, nao os tres primeiros que aparecerem numa
         consulta. Ordem de banco nao e' criterio, e o dono do servidor
         perceberia na hora que a lingua da maioria ficou de fora.

         Quem ja tem categoria nunca perde: idioma que caiu no ranking
         continua com a dele. Tirar seria apagar canal com conversa dentro por
         causa de uma flutuacao de contagem, e ninguem perdoa isso. */
      const restam = limite.idiomas - porIdioma.size;
      const querem = [...falantes.entries()]
        .filter(([idioma]) => !porIdioma.has(idioma))
        .sort((a, b) => b[1] - a[1]);

      /* Quem escolheu e nao coube. Guardado pra aparecer no cartao e pra virar
         aviso -- ate agora isto so ia pro log, e a pessoa que escolhia o quarto
         idioma via exatamente o mesmo que veria se o bot estivesse quebrado:
         nada. */
      const naoCoube = querem.slice(Math.max(0, restam));
      if (naoCoube.length) {
        esperando.set(servidorId, naoCoube.map(([idioma, quantos]) => ({ idioma, quantos })));
        console.log(`limite: ${guild.name} está no teto de ${limite.idiomas} idiomas (plano ${planoDe(servidor)}); ` +
          `${naoCoube.length} esperando: ${naoCoube.map(([i, n]) => `${i}(${n})`).join(", ")}`);
        await avisarDoTeto(guild, servidor, naoCoube, limite);
      } else {
        esperando.delete(servidorId);
      }

      for (const [idioma] of querem.slice(0, Math.max(0, restam))) {
        try {
          porIdioma.set(idioma, await garantirIdioma(guild, servidorId, idioma));
        } catch (e) {
          console.error("idioma: nao consegui criar", idioma, e?.message || e);
        }
      }

      /* Modo lento nas salas que nasceram antes dele.

         O NOME da sala nao se decide mais aqui: quem manda nele e' o canal
         original que a replica copia (ver montarCategorias). Duas partes do
         codigo querendo nomes diferentes renomeariam o canal de dez em dez
         minutos, cada uma desfazendo a outra, ate estourar o limite de duas
         trocas de nome a cada dez minutos que o Discord impoe. */
      for (const sala of porIdioma.values()) {
        if (!sala.canal_id) continue; // idioma sem sala de conversa (plano gratis)
        try {
          const canal = await guild.channels.fetch(sala.canal_id).catch(() => null);
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
      await montarCategorias(guild, servidorId, porIdioma, pago, orcamento, limite, vivos);

      cacheEspelho.delete(servidorId); // a proxima mensagem le a lista nova
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
      const servidor = await servidorDoGuild(guild.id);
      if (!servidor) continue;
      const servidorId = servidor.id;

      const vivos = await idsVivos(guild);
      const portas = await sb(
        `discord_convite_idioma?servidor_id=eq.${servidorId}&select=canal_id,tipo,mensagem_id`);
      if (!portas?.length) continue;

      for (const porta of portas) {
        try {
          if (!vivos.has(porta.canal_id)) {
            /* Apagado na mao. Tira a linha; quem repoe e' o reparo da
               instalacao, na proxima volta do relogio. */
            await sbDel(`discord_convite_idioma?canal_id=eq.${encodeURIComponent(porta.canal_id)}`);
            console.log(`portaria: canal ${porta.canal_id} sumiu, linha removida pra ser refeita`);
            continue;
          }
          const canal = await guild.channels.fetch(porta.canal_id).catch(() => null);
          if (!canal) continue;

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
            `discord_convite_idioma?servidor_id=eq.${servidorId}&canal_id=eq.${encodeURIComponent(porta.canal_id)}`,
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

/* ---------------- o CYRON se instala sozinho ao entrar ---------------------

   Ate aqui, ligar um servidor era eu abrindo o banco e inserindo linha com id
   de canal na mao. Serve pra um servidor; nao serve pra um produto.

   A instalacao acontece no guildCreate -- o evento que o Discord manda quando
   o bot entra num servidor. Ou seja: ADICIONAR o bot ja e' instalar. Nao ha
   comando pra digitar, nem link pra clicar depois, nem passo que alguem possa
   esquecer no meio.

   Comando de instalacao teria que morar na edge function, porque aplicativo
   com endereco de interacoes configurado nao recebe mais comando pelo gateway
   -- este bot aqui nunca veria um /instalar. O guildCreate ele ve.

   Dois canais e' tudo de que um servidor novo precisa:

   - a PORTA: publica, so-leitura, com o seletor de idioma fixado. E' por ela
     que a pessoa escolhe e abre a propria categoria.
   - a FONTE: onde o dono escreve UMA vez e o bot leva traduzido pra replica de
     cada idioma.

   Servidor recem-criado e' o caso mais facil justamente por estar vazio: nao
   ha canal antigo pra adivinhar. */

const CANAL_CONFIG = "⚙️-cyron";
const CANAL_PORTA = "🌐-idioma-language";
const CANAL_FONTE = "📢-anuncios";

const TEXTO_PORTA = [
  "🌐 **Selecione seu idioma / Select your language**",
  "",
  "🇧🇷 Escolha seu idioma abaixo e este servidor passa a falar com você no seu idioma.",
  "🇬🇧 Pick your language below and this server starts speaking to you in your own language.",
  "🇸🇦 اختر لغتك أدناه وسيبدأ هذا الخادم بالتحدث معك بلغتك.",
  "🇪🇸 Elige tu idioma abajo y este servidor empezará a hablarte en tu idioma.",
  "🇨🇳 在下方选择你的语言，本服务器将用你的语言与你交流。",
].join("\n");

/* Acha o canal pelo nome antes de criar. Entrar, sair e entrar de novo no
   mesmo servidor nao pode dobrar os canais dele. */
async function canalPorNomeOuCria(guild, nome, topico) {
  const achado = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === nome);
  if (achado) return achado;

  return await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    topic: topico,
    /* So-leitura pelas quatro portas. Fechar so' "mandar mensagem" faria o
       Discord tratar o canal como "somente tópicos" e trocar a caixa de texto
       por um botao de criar tópico -- a pessoa continuaria falando por outro
       caminho. */
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: Object.keys(SO_LEITURA).map((k) => PermissionFlagsBits[k]) },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks] },
    ],
    reason: "instalação do CYRON",
  });
}

/* Quem pode mandar no bot: o proprio bot, e todo cargo que ja manda no
   servidor. Ninguem mais enxerga.

   Nao da' pra escrever "quem tem Gerenciar Servidor" numa permissao de canal
   -- o Discord so aceita cargo ou pessoa. Entao eu procuro os cargos que TEM
   essa permissao e abro pra cada um. Sem isso, so quem fosse Administrador
   entraria (Administrador passa por cima de tudo), e um oficial com permissoes
   picadas ficaria de fora justamente do canal que existe pra ele. */
function portasDaAdministracao(guild) {
  const portas = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    },
  ];
  for (const [, cargo] of guild.roles.cache) {
    if (cargo.id === guild.roles.everyone.id) continue;
    if (!cargo.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !cargo.permissions.has(PermissionFlagsBits.Administrator)) continue;
    portas.push({
      id: cargo.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory],
    });
  }
  return portas;
}

async function garantirCanalDeConfig(guild, servidor) {
  let canal = servidor.canal_config
    ? await guild.channels.fetch(servidor.canal_config).catch(() => null)
    : null;

  if (!canal) {
    canal = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === CANAL_CONFIG) || null;
  }

  if (!canal) {
    canal = await guild.channels.create({
      name: CANAL_CONFIG,
      type: ChannelType.GuildText,
      topic: "Só a administração vê este canal. É aqui que você diz ao CYRON o que fazer.",
      permissionOverwrites: portasDaAdministracao(guild),
      reason: "sala de comando do CYRON",
    });
    console.log(`instalar: sala de comando em #${canal.name}`);
  } else {
    /* Conserta o canal que nasceu aberto. Eu tinha negado so a escrita, nao a
       visibilidade -- o servidor inteiro enxergava a configuracao do bot.

       So mexe quando esta errado, e a condicao e' exatamente o defeito: se o
       @everyone ja nao ve, nao ha o que fazer, e reescrever as permissoes a
       cada passada apagaria qualquer ajuste que o dono tenha feito na mao. */
    const doTodos = canal.permissionOverwrites.cache.get(guild.roles.everyone.id);
    if (!doTodos?.deny.has(PermissionFlagsBits.ViewChannel)) {
      await canal.permissionOverwrites.set(portasDaAdministracao(guild), "sala de comando é só da administração");
      console.log(`instalar: #${canal.name} fechado — só a administração vê`);
    }
  }

  if (servidor.canal_config !== canal.id) {
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { canal_config: canal.id });
    servidor.canal_config = canal.id;
  }
  return canal;
}

async function instalarServidor(guild) {
  /* Ja instalado: sair no comeco. Isto roda tambem na varredura, pra consertar
     instalacao que parou no meio -- e uma instalacao completa nao pode ser
     refeita toda vez. */
  const jaTem = await sb(`cyron_servidor?guild_id=eq.${encodeURIComponent(guild.id)}&select=id,plano`);
  let servidor = jaTem?.[0];

  if (!servidor) {
    const criado = await sbPost("cyron_servidor", { guild_id: guild.id, nome: guild.name });
    servidor = Array.isArray(criado) ? criado[0] : criado;
    if (!servidor?.id) {
      /* sbPost pode nao devolver a linha; le de volta em vez de adivinhar. */
      servidor = (await sb(`cyron_servidor?guild_id=eq.${encodeURIComponent(guild.id)}&select=id,plano`))?.[0];
    }
    if (!servidor?.id) throw new Error("nao consegui registrar o servidor");
    console.log(`instalar: ${guild.name} registrado (plano ${servidor.plano})`);
  }

  /* A porta. O convite e' gravado sem mensagem_id de proposito: quem posta e
     fixa e' a garantirConvites, que ja sabe fazer isso e ja cuida de repor se
     alguem apagar. Duplicar aqui seria ter duas partes do codigo mandando na
     mesma mensagem. */
  const jaPorta = await sb(
    `discord_convite_idioma?servidor_id=eq.${servidor.id}&tipo=eq.convite&select=canal_id`);
  if (!jaPorta?.length) {
    const porta = await canalPorNomeOuCria(guild, CANAL_PORTA, "Escolha seu idioma aqui / Pick your language here.");
    await sbPost("discord_convite_idioma", {
      servidor_id: servidor.id, canal_id: porta.id, tipo: "convite",
    });
    console.log(`instalar: porta de entrada em #${porta.name}`);
  }

  /* A sala de comando: quem manda no servidor manda no bot. */
  await garantirCanalDeConfig(guild, servidor);

  /* A fonte. */
  const jaFonte = await sb(`discord_fonte_replica?servidor_id=eq.${servidor.id}&select=canal_id`);
  if (!jaFonte?.length) {
    const fonte = await canalPorNomeOuCria(guild, CANAL_FONTE,
      "Escreva aqui. O CYRON leva traduzido para a réplica de cada idioma.");
    await sbPost("discord_fonte_replica", {
      servidor_id: servidor.id, canal_id: fonte.id, tipo: "evento",
    });
    console.log(`instalar: canal-fonte em #${fonte.name}`);
  }

  cacheServidor.delete(guild.id); // a proxima mensagem ja enxerga o servidor novo
  return servidor;
}

/* Instalacao que parou no meio se conserta sozinha.

   O guildCreate dispara UMA vez. Se algo falhar ali -- e falhou: uma coluna
   obrigatoria que eu esqueci de soltar --, o servidor fica com a linha criada
   e nada montado, e nao ha segundo evento pra tentar de novo. A pessoa ve um
   canal solto e conclui que o bot nao funciona.

   Entao a varredura tenta de novo, mas SO onde a instalacao ja comecou. Rodar
   em qualquer servidor onde o bot esteja criaria canal na casa de quem nunca
   pediu -- inclusive nos que ja usavam o bot pra outra coisa antes disto
   existir. */
async function repararInstalacoes() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const ja = await sb(`cyron_servidor?guild_id=eq.${encodeURIComponent(guild.id)}&select=id`);
      if (!ja?.length) continue;
      await instalarServidor(guild);
    } catch (e) {
      console.error("instalar: reparo falhou em", guild.name, e?.message || e);
    }
  }
}

/* ---------------- a sala de comando do dono -------------------------------

   O dono precisa dizer QUAIS canais o bot traduz, e precisa dizer de dentro do
   Discord -- ninguem vai abrir um painel pra isso, e ate agora quem apontava
   os canais era eu, na mao, no banco.

   Escolhi mensagem com mencao de canal em vez de menu suspenso por um motivo
   pratico: menu suspenso e' componente, componente vira interacao, e interacao
   nao chega neste bot (o endereco de interacoes desliga a entrega pelo
   gateway). Faria falta uma peca a mais na outra ponta.

   E a mencao nao e' o pior dos mundos -- e' o mesmo seletor. Digitando "#" o
   Discord abre a lista de canais do servidor e a pessoa escolhe clicando,
   exatamente como num menu, so que na caixa de texto.

   A lista mandada SUBSTITUI a anterior, nao soma. "Estes sao os meus canais"
   e' uma frase que a pessoa consegue conferir olhando; "adicionei estes aos
   que ja tinha" obriga a lembrar do que havia antes. */

/* O nome do canal vira o rotulo da replica: "#🐻urso🐼" vira "urso". Sem
   emoji, sem acento, sem pontuacao -- o rotulo entra no nome de outro canal
   e o Discord tem opiniao sobre isso. */
function rotuloDoCanal(nome) {
  const limpo = String(nome)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return limpo.slice(0, 40) || "canal";
}

async function cartaoDeConfig(guild, servidor) {
  const fontes = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id,tipo&order=criado_em.asc`) || [];
  const idiomas = await sb(
    `discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma`) || [];
  const limite = limitesDo(servidor);
  const teste = servidor.teste_ate ? Date.parse(servidor.teste_ate) : 0;
  const emTeste = teste > Date.now()
    ? new Date(teste).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : null;

  /* Canal apagado nao entra no cartao. O Discord desenha "#desconhecido" pra
     id que nao existe mais, e isso no cartao de configuracao parece defeito --
     e' so' uma linha esperando a proxima varredura limpar. */
  const vivas = fontes.filter((f) => guild.channels.cache.has(f.canal_id));
  const fila = esperando.get(servidor.id) || [];

  /* Um sinal antes do numero, pra dar pra ler sem contar: cheio grita, quase
     cheio avisa, com folga nao chama atencao. */
  const marca = (usado, teto) => (usado >= teto ? "🔴" : usado >= teto - 1 ? "🟡" : "🟢");

  const lista = vivas.length
    ? vivas.map((f) => `• <#${f.canal_id}>`).join("\n")
    : "_nenhum ainda — mande os canais aqui embaixo_";

  const linhas = [
    "## ⚙️ CYRON — configuração",
    "",
    "**Canais que eu traduzo**",
    lista,
    "",
    "O que for postado neles sai traduzido numa cópia por idioma, dentro da categoria de quem escolheu aquele idioma.",
    "",
    "**Para adicionar**, mande os canais aqui neste canal:",
    "```",
    "#canal1 #canal2",
    "```",
    "**Para tirar:** `remover #canal`",
    "",
    "Digite `#` e o Discord abre a lista de canais do servidor — é só clicar nos que você quer.",
    "",
    "---",
    `**Plano ${planoDe(servidor).toUpperCase()}**${emTeste ? ` — teste até ${emTeste}` : ""}`,
    "",
    `${marca(vivas.length, limite.fontes)} **Canais traduzidos:** ${vivas.length} de ${limite.fontes}`,
    `${marca(idiomas.length, limite.idiomas)} **Idiomas:** ${idiomas.length} de ${limite.idiomas}` +
      (idiomas.length ? ` — ${idiomas.map((i) => nomeDoIdioma(i.idioma)).join(", ")}` : ""),
    ...(fila.length
      ? ["",
         "⚠️ **Escolheram e não couberam:**",
         ...fila.map((f) => `• ${nomeDoIdioma(f.idioma)} — ${f.quantos} ${f.quantos === 1 ? "pessoa" : "pessoas"}`),
         "_Para essas pessoas o bot parece não ter funcionado: elas escolheram o idioma e não receberam canal nenhum._"]
      : []),
  ].join("\n");

  const canal = await guild.channels.fetch(servidor.canal_config).catch(() => null);
  if (!canal) return;

  /* Edita o cartao em vez de postar outro: assim o canal nao vira um historico
     de estados velhos, onde o de cima e' o unico verdadeiro e os de baixo
     mentem. */
  if (servidor.msg_config) {
    const antiga = await canal.messages.fetch(servidor.msg_config).catch(() => null);
    if (antiga) { await antiga.edit({ content: linhas }); return; }
  }
  const nova = await canal.send({ content: linhas, allowedMentions: { parse: [] } });
  await nova.pin("cartão de configuração").catch(() => {});
  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { msg_config: nova.id });
  servidor.msg_config = nova.id;
}

/* Mandar canais na sala de comando E' o comando.

   Eu tinha exigido a palavra "fonte" na frente. Na primeira vez que alguem
   usou, a pessoa fez o obvio -- digitou "#", escolheu os canais na lista que o
   Discord abre, e mandou -- e o bot ficou calado. Duas vezes errado: exigir uma
   palavra magica que nao protege de nada, e nao dizer nada quando ela falta.

   Nesta sala nao ha outra coisa a fazer. Mensagem com canal dentro so pode
   significar "sao estes". A palavra continua aceita, pra quem leu o cartao,
   mas nao e' mais obrigatoria. */
async function comandoDeConfig(msg, servidor) {
  const escolhidos = [...msg.mentions.channels.values()]
    .filter((c) => c.type === ChannelType.GuildText);
  const texto = String(msg.content || "").trim().toLowerCase();

  if (!escolhidos.length) {
    /* Sem canal nenhum: so responde se parecia uma tentativa. A sala e' da
       administracao, e duas pessoas conversando ali nao querem um bot
       corrigindo cada frase. */
    if (/^(fonte|canais?|remover|remove|tirar|tira)\b/.test(texto)) {
      await msg.reply("Não vi canal nenhum na mensagem. Digite `#` e escolha na lista que o Discord abre.");
      return true;
    }
    return false;
  }

  if (!msg.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await msg.reply("🔒 Só quem tem **Gerenciar Servidor** pode mudar isto.");
    return true;
  }

  /* SOMA, nao substitui.

     Eu tinha feito o contrario, com um argumento que parecia bom: "estes sao
     os meus canais" e' uma frase que da' pra conferir olhando. Na pratica a
     primeira pessoa a usar mandou tres canais em TRES mensagens, uma de cada
     vez -- que e' o jeito natural de fazer -- e cada uma apagou a anterior. Ela
     terminou achando que tinha tres e tendo um.

     Somar e' o padrao que perdoa: o pior caso e' um canal a mais, que se tira
     com "remover #canal". Substituir sem querer apaga trabalho em silencio. */
  const removendo = /^(remover|remove|tirar|tira)\b/.test(texto);

  /* Canal do proprio bot nao pode virar fonte.

     Uma replica como fonte e' um laco: o bot escreve nela, ela alimenta a
     replica dela, que ele escreve, que alimenta... Aqui o laco nao chega a
     rodar solto -- o destino repete o de origem e a coisa para --, mas ele
     enche o servidor de canal e traduz a mesma frase varias vezes. O mesmo
     vale pro chat de idioma, pra sala de comando e pra porta de entrada:
     nenhum deles e' lugar de conteudo original.

     A checagem vem antes de qualquer gravacao, porque o estrago aqui e' criar
     canal -- e canal criado por engano alguem tem que apagar na mao. */
  if (!removendo) {
    const proprios = new Set();
    for (const r of (await sb(`discord_canal_idioma?servidor_id=eq.${servidor.id}&select=canal_id`)) || []) proprios.add(r.canal_id);
    for (const r of (await sb(`discord_chat_espelho?servidor_id=eq.${servidor.id}&canal_id=not.is.null&select=canal_id`)) || []) proprios.add(r.canal_id);
    for (const r of (await sb(`discord_convite_idioma?servidor_id=eq.${servidor.id}&select=canal_id`)) || []) proprios.add(r.canal_id);
    if (servidor.canal_config) proprios.add(servidor.canal_config);

    const meus = escolhidos.filter((c) => proprios.has(c.id));
    if (meus.length) {
      await msg.reply(
        `🔁 ${meus.map((c) => `<#${c.id}>`).join(", ")} ${meus.length === 1 ? "é um canal meu" : "são canais meus"} — ` +
        "eu já escrevo neles.\n" +
        "Apontar um canal meu como fonte faria eu traduzir a minha própria tradução, e o servidor encheria de cópias. " +
        "Escolha os canais onde **vocês** escrevem.");
      return true;
    }
  }

  const antigas = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id`) || [];
  const atuais = new Set(antigas.map((a) => a.canal_id));

  if (removendo) {
    for (const canal of escolhidos) {
      if (!atuais.has(canal.id)) continue;
      await sbDel(`discord_fonte_replica?canal_id=eq.${encodeURIComponent(canal.id)}`);
      atuais.delete(canal.id);
    }
  } else {
    const limite = limitesDo(servidor);
    const novos = escolhidos.filter((c) => !atuais.has(c.id));
    if (atuais.size + novos.length > limite.fontes) {
      await msg.reply(
        `📦 No plano **${planoDe(servidor)}** eu traduzo até **${limite.fontes}** ` +
        `${limite.fontes === 1 ? "canal" : "canais"}, e você já tem ${atuais.size}.\n` +
        "Tire um com `remover #canal`, ou suba de plano para liberar mais.");
      return true;
    }
    for (const canal of novos) {
      await sbPost("discord_fonte_replica", {
        servidor_id: servidor.id, canal_id: canal.id, tipo: rotuloDoCanal(canal.name),
      });
      atuais.add(canal.id);
    }
  }

  /* A resposta mostra a lista INTEIRA, nao so o que mudou. Confirmar apenas o
     ultimo canal foi o que deixou a pessoa achar que tinha tres: ela lia
     "agora eu traduzo #recursos" como "somei o #recursos". */
  const lista = [...atuais].map((id) => `<#${id}>`).join(", ") || "_nenhum_";
  await msg.reply(
    `✅ Agora eu traduzo: ${lista}\n` +
    (removendo
      ? "As cópias do que saiu eu deixo onde estão — apague na mão se não quiser mais."
      : "Montando as cópias por idioma agora…"));

  /* Monta na hora, com a pessoa olhando. Esperar a volta do relogio era o que
     matava a primeira impressao: quem acabou de apontar os canais fica dez
     minutos sem ver nada acontecer e conclui que nao funcionou. */
  cacheFontes.delete(servidor.id);
  await sincronizarAgora(msg.guild);

  /* O cartao por ultimo: ele mostra o que a montagem acabou de fazer. */
  await cartaoDeConfig(msg.guild, servidor);
  return true;
}

/* O cartao e' desenhado por ULTIMO na volta do relogio.

   Ele mostra o que a varredura acabou de decidir -- quantos idiomas couberam,
   quem ficou de fora, quantos canais existem. Desenhando antes, ele mostraria
   sempre o retrato da passada anterior, e um painel atrasado e' pior que
   nenhum: a pessoa confia nele. */
async function atualizarCartoes() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const servidor = await servidorDoGuild(guild.id);
      if (!servidor?.canal_config) continue;
      await cartaoDeConfig(guild, servidor);
    } catch (e) {
      console.error("config: nao consegui atualizar o cartão de", guild.name, e?.message || e);
    }
  }
}

client.on("guildCreate", async (guild) => {
  try {
    console.log(`instalar: entrei em ${guild.name} (${guild.id})`);
    const servidor = await instalarServidor(guild);
    /* Monta o que der na hora: quem adiciona o bot quer ver acontecer, nao
       quer esperar a proxima varredura. */
    await garantirConvites();
    await sincronizarAgora(guild);
    await cartaoDeConfig(guild, servidor).catch((e) =>
      console.error("config: nao consegui pôr o cartão:", e?.message || e));
  } catch (e) {
    console.error("instalar: falhei em", guild.name, e?.message || e);
  }
});

const jaOrientado = new Map(); // `${canal}:${pessoa}` -> quando
const ESPERA_ORIENTAR = 10 * 60 * 1000;

async function orientarNaReplica(msg, servidor, replica) {
  const chave = `${msg.channel.id}:${msg.author.id}`;
  const ultima = jaOrientado.get(chave) || 0;
  if (Date.now() - ultima < ESPERA_ORIENTAR) return;
  jaOrientado.set(chave, Date.now());

  const linhas = ["📖 Este canal é uma **cópia traduzida** — o que você escrever aqui não vai para ninguém."];

  /* Onde ele deveria escrever depende do que o servidor tem. */
  const sala = (await sb(
    `discord_chat_espelho?servidor_id=eq.${servidor.id}&idioma=eq.${encodeURIComponent(replica.idioma)}` +
    `&canal_id=not.is.null&select=canal_id`))?.[0];
  if (sala) {
    linhas.push(`💬 Para conversar e ser lido em todos os idiomas: <#${sala.canal_id}>`);
  }

  const fonte = [...(await fontesReplica(servidor.id))]
    .find(([, tipo]) => tipo === replica.tipo);
  if (fonte) {
    linhas.push(`✍️ Para publicar algo que apareça traduzido aqui: <#${fonte[0]}>`);
  }

  await msg.reply({ content: linhas.join("\n"), allowedMentions: { repliedUser: false } }).catch(() => {});
}

client.on("messageCreate", async (msg) => {
  try {
    if (!msg.guild) return;

    if (msg.webhookId) {
      const servidor = await servidorDoGuild(msg.guild.id);
      if (!servidor) return; // servidor sem /instalar: o motor nao mexe nele
      const servidorId = servidor.id;

      /* Canal de chat espelhado nao leva tradutor: o que chega ali por webhook
         E' a traducao, e pendurar um seletor embaixo dela seria oferecer
         traduzir o que acabou de ser traduzido. No teste isso encheu o canal
         de "Tradução / Translation" embaixo de cada fala. */
      if ((await canaisEspelho(servidorId)).some((c) => c.canal_id === msg.channel.id)) return;

      /* Nem a replica: o que chega nela JA e' a traducao. */
      if ((await replicasDoIdioma(servidorId)).some((c) => c.canal_id === msg.channel.id)) return;

      /* Canal publico que abastece as replicas: o aviso sai daqui traduzido
         pra cada idioma. Nao e' um "return" -- o canal publico continua
         servindo quem nunca escolheu idioma, com o tradutor de sempre. */
      const fonte = (await fontesReplica(servidorId)).get(msg.channel.id);
      if (fonte) await replicarPorIdioma(msg, servidorId, fonte);

      /* Boas-vindas ganham as duas coisas: o convite pra escolher idioma e o
         tradutor. Antes parava no seletor, com a ideia de que a mensagem era
         so o convite -- mas ela tem texto de verdade ("entrou na alianca,
         bem-vindo ao time"), e quem acabou de chegar sem falar a lingua da
         casa e' exatamente quem mais precisa de traducao. */
      /* Daqui pra baixo e' recurso do portal do Kingshot (boas-vindas com GIF
         e assinatura de heroi), entao volta a perguntar pela alianca. Servidor
         que nao tem alianca simplesmente nao entra aqui. */
      const aliancaId = await aliancaDoGuild(msg.guild.id);
      if (aliancaId && await webhookEhBoasVindas(aliancaId, msg.webhookId)) await talvezMandarSeletorIdioma(msg);

      /* Avisos automaticos (evento, dica do dia, arena) vem como embed -- o
         texto que importa esta la, nao em msg.content (que as vezes so tem
         "@everyone"). */
      /* So em servidor com alianca, pelo mesmo motivo do outro ramo: num
         servidor qualquer, TODO webhook de terceiro (bot de música, aviso de
         GitHub, feed de notícia) ganharia um tópico de tradução pendurado. */
      if (!aliancaId) return;

      const emb = msg.embeds?.[0];
      const texto = String(emb ? [emb.title, emb.description].filter(Boolean).join("\n") : (msg.content || "")).trim();
      if (podeTraduzirAgora(msg.webhookId)) await traduzirEResponder(msg, texto);
      return;
    }
    if (msg.author.bot) return;

    const servidor = await servidorDoGuild(msg.guild.id);
    if (!servidor) return; // servidor sem instalacao
    const servidorId = servidor.id;

    /* Sala de comando: sai por aqui em qualquer caso. Nada de espelho, de
       replica nem de seletor de traducao -- e' conversa entre o dono e o bot
       sobre o proprio bot, e nao interessa a mais ninguem. */
    if (servidor.canal_config && msg.channel.id === servidor.canal_config) {
      await comandoDeConfig(msg, servidor).catch((e) => {
        console.error("config: comando falhou:", e?.message || e);
        msg.reply("❌ Não consegui salvar agora. Tente de novo em instantes.").catch(() => {});
      });
      return;
    }

    const texto = String(msg.content || "").trim();

    /* Canal de chat espelhado tem regra propria e sai por aqui: nada de
       seletor de traducao nem topico, porque a traducao ja vai acontecer nos
       outros canais. Vem antes do corte de texto vazio de proposito -- foto
       sem legenda tambem tem que atravessar. */
    /* Chat espelhado e' o recurso pago, e o corte tem que ser aqui, no motor.

       Nao e' capricho de embalagem: e' onde o dinheiro sai. O aviso replicado
       repete o mesmo texto toda semana e bate no cache pra sempre -- custo que
       tende a zero. Ja a conversa e' sempre nova, e cada frase vira uma
       traducao por idioma. Uma sala de sete idiomas com gente falando e' a
       unica coisa aqui dentro que escala com o tamanho do servidor.

       O corte na interface (esconder botao, nao oferecer) seria enfeite: o
       gasto acontece no momento em que a mensagem chega, entao e' aqui que ele
       tem que parar. */
    /* Gente escrevendo numa REPLICA nao aciona nada -- replica e' destino, nao
       origem. E o dono do servidor passa por cima do so-leitura, entao pra ele
       o canal parece um chat normal: ele digita, a mensagem aparece, e nada
       acontece do outro lado. Silencio de novo, e do pior tipo: parece que
       funcionou.

       Entao o bot diz onde e' o lugar certo. Uma vez a cada dez minutos por
       pessoa e canal -- repetir a cada frase seria trocar um silencio ruim por
       um papagaio. */
    const aqui = (await replicasDoIdioma(servidorId)).find((r) => r.canal_id === msg.channel.id);
    if (aqui) {
      await orientarNaReplica(msg, servidor, aqui);
      return;
    }

    /* Gente escrevendo no canal-fonte tambem replica.

       Isto so' existia no ramo do webhook, e por muito tempo bastou: no
       servidor onde tudo comecou a fonte e' alimentada por aviso automatico,
       que chega por webhook. Num servidor qualquer quem escreve no canal de
       anuncio e' UMA PESSOA -- e esse caminho nunca replicava. O anuncio saia
       em portugues e nao chegava em lingua nenhuma.

       Vem antes do espelho e do seletor de proposito: um canal e' fonte ou e'
       conversa, nunca os dois. */
    const fonteAqui = (await fontesReplica(servidorId)).get(msg.channel.id);
    if (fonteAqui) {
      await replicarPorIdioma(msg, servidorId, fonteAqui);
      return;
    }

    const espelho = planoDe(servidor) === "pago" ? await canaisEspelho(servidorId) : [];
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

    /* Daqui pra baixo e' coisa do portal do Kingshot, e por isso pergunta pela
       alianca antes.

       As duas estavam rodando em TODO servidor onde o bot entrasse:

       - A brincadeira das rosas: qualquer pessoa que escrevesse "lady" no
         servidor de um cliente recebia um GIF que e' piada interna de outra
         gente. Constrangedor no melhor caso.

       - O seletor de traducao pendurado em cada mensagem: ele nasceu pros
         canais da [TOP], onde e' util. Num servidor recem-instalado ele
         penduraria um topico embaixo de cada frase de cada canal -- inclusive
         nos que o dono nunca pediu pra traduzir. E' o tipo de coisa que faz
         tirarem o bot.

       O CYRON traduz onde mandaram traduzir: canal-fonte vira replica, sala de
       idioma vira conversa espelhada. Traduzir o servidor inteiro por conta
       propria e' outra funcao, e ela precisa ser pedida. */
    const aliancaId = await aliancaDoGuild(msg.guild.id);
    if (!aliancaId) return;

    if (mencionaLadyOuMaelle(texto)) {
      const url = await gifRosas();
      if (url) msg.reply({ files: [url], allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    if (podeTraduzirAgora(msg.author.id)) await traduzirEResponder(msg, texto);
  } catch (e) {
    console.error("erro ao processar mensagem:", e?.message || e);
  }
});

/* ---------------- os comandos que aparecem em cada servidor -----------------

   Comando global aparece em TODO servidor onde o aplicativo esta. Isso estava
   fazendo um servidor de comida italiana ver "/ranking — ranking de poder da
   alianca" e "/player — buscar jogador do Kingshot" no menu de barra.

   Nao e' so feio: e' o produto se apresentando como outra coisa. Quem instala
   um tradutor e ve comando de jogo conclui que instalou errado.

   O Discord separa comando global de comando por servidor. Entao os dois que
   servem pra qualquer lugar ficam globais, e os do Kingshot passam a existir
   so' nos servidores que tem alianca ligada.

   Nao escrevo a definicao de cada comando aqui: leio do Discord o que ja esta
   publicado e mudo de lugar. Reescrever a mao seria arriscar perder uma opcao,
   uma descricao traduzida, um tipo de campo -- coisas que ja estao certas e
   que eu nao teria como conferir sem testar comando por comando. */
const COMANDOS_DE_TODOS = new Set(["mylanguage", "Translate"]);

async function separarComandos() {
  try {
    const globais = await client.application.commands.fetch();
    const doJogo = [...globais.values()].filter((c) => !COMANDOS_DE_TODOS.has(c.name));
    if (!doJogo.length) return; // ja separado

    const vinculos = await sb(`alianca_discord?guild_id=not.is.null&select=guild_id`) || [];
    const guildsComAlianca = [...new Set(vinculos.map((v) => String(v.guild_id)))];
    if (!guildsComAlianca.length) {
      console.error("comandos: nenhum servidor com aliança; não mexo pra não sumir com tudo");
      return;
    }

    const carga = doJogo.map((c) => c.toJSON());

    /* Registra no servidor ANTES de tirar do global.

       Comando por servidor entra na hora; global some devagar. Fazendo nesta
       ordem, o pior caso e' o comando aparecer duplicado por alguns minutos.
       Na ordem inversa, o pior caso e' a alianca ficar sem /events. */
    for (const guildId of guildsComAlianca) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      await guild.commands.set(carga);
      console.log(`comandos: ${carga.length} comandos do jogo agora são só de ${guild.name}`);
    }

    const ficam = [...globais.values()].filter((c) => COMANDOS_DE_TODOS.has(c.name)).map((c) => c.toJSON());
    await client.application.commands.set(ficam);
    console.log(`comandos: globais reduzidos a ${ficam.map((c) => c.name).join(", ")}`);
  } catch (e) {
    console.error("comandos: não consegui separar:", e?.message || e);
  }
}

client.once("clientReady", () => {
  console.log(`Conectado como ${client.user.tag}, em ${client.guilds.cache.size} servidor(es).`);
  /* Uma vez ao subir, pra quem trocou de idioma com o bot fora do ar nao
     ficar esperando dez minutos, e depois de tempos em tempos. */
  sincronizarSalas().catch((e) => console.error("espelho: sincronia inicial falhou:", e?.message || e));
  garantirConvites().catch((e) => console.error("portaria: passada inicial falhou:", e?.message || e));
  repararInstalacoes().catch((e) => console.error("instalar: reparo inicial falhou:", e?.message || e));
  separarComandos();
  setInterval(() => {
    /* Reparo primeiro: sem porta e sem fonte, as outras duas nao tem o que
       montar nem onde postar. */
    repararInstalacoes()
      .catch((e) => console.error("instalar: reparo falhou:", e?.message || e))
      .then(() => sincronizarSalas())
      .catch((e) => console.error("espelho: sincronia falhou:", e?.message || e))
      .then(() => garantirConvites())
      .catch((e) => console.error("portaria: passada falhou:", e?.message || e))
      .then(() => atualizarCartoes())
      .catch((e) => console.error("config: cartões falharam:", e?.message || e));
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
