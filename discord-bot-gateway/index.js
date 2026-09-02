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

import { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, WebhookClient, ChannelType, MessageType } from "discord.js";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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
    /* Reacao e' o gesto mais barato que existe no Discord: um toque, sem sair
       da conversa, sem abrir menu. E' por ele que passa a traducao PUXADA --
       a pessoa poe a bandeira dela numa fala e recebe aquela fala na lingua
       dela, no privado. Nao e' intent privilegiada, entao nao depende de
       aprovacao de ninguem. */
    GatewayIntentBits.GuildMessageReactions,
    /* Sem este, mensagem no privado nao chega aqui -- e quem abre uma conversa
       comigo recebe silencio. E' o primeiro contato de quem achou o bot pela
       lista de servidores ou pelo perfil, e ele estava caindo no vazio. */
    GatewayIntentBits.DirectMessages,
  ],
  /* Reaction e User entram junto com a intent: sem eles, reagir a uma mensagem
     ANTERIOR ao ultimo religamento do bot chega como objeto pela metade e o
     evento e' descartado em silencio -- que e', justamente, a conversa velha
     que alguem quer entender. */
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

/* ---------------- Supabase (mesmo padrao do top-discord) ---------------- */

async function sb(caminho) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return await r.json();
}

async function sbPost(caminho, corpo, prefer = "") {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      /* merge-duplicates transforma o POST em upsert -- e' assim que um
         ajuste e' gravado sem eu precisar saber se ele ja existia. */
      Prefer: ["return=representation", prefer].filter(Boolean).join(","),
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

/* O que eu guardo, e por quanto tempo.

   Escrito num lugar so' porque e' o que a pagina de privacidade promete: duas
   verdades sobre o mesmo assunto, em arquivos diferentes, divergem no dia em
   que alguem mexer numa. Um teste confere que os numeros daqui sao os numeros
   que a pagina mostra.

   Os prazos vem do uso, nao de numero redondo:

   - texto (7 dias): serve ao seletor "ler no seu idioma", que se usa nos
     minutos seguintes a mensagem. O clique depois disso ja respondia "pode ter
     expirado" -- frase que so' agora e' verdade.
   - cache (90 dias): existe pra nao pagar duas vezes pela mesma frase. Frase
     que se repete, se repete dentro de semanas; guardar pra sempre nao
     economiza mais nada e so' aumenta o que eu teria a perder.
   - falas (14 dias): responder e' coisa de conversa viva. Aqui nao ha texto,
     so' os numeros das mensagens. */
const GUARDO_POR = [
  ["discord_msg_traducao", 7, "o texto das mensagens"],
  ["discord_traducao_cache", 90, "o cache de traduções"],
  ["discord_fala_espelhada", 14, "as falas espelhadas"],
];

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
    /* Le a linha INTEIRA, de proposito.

       Aqui havia uma lista de colunas escrita a mao, e ela envelheceu em
       silencio: eu criei pago_ate e tradutor_motor, gravei nos dois, e nunca
       os LI -- entao o pagamento do Stripe nao dava plano nenhum, e a chave
       de Azure/DeepL nunca era usada. As duas coisas funcionavam de um lado
       so', e o painel mostrava "GRATIS" e "Google gratis" com toda a
       convicção do mundo.

       Pior: a lista ainda pedia "tradutor", coluna de um desenho anterior que
       ninguem le mais. Ela continuava chegando, e a que importava, nao.

       Um select=* custa alguns bytes por servidor a cada cinco minutos.
       Descobrir isto de novo custou uma hora. */
    const r = await sb(`cyron_servidor?guild_id=eq.${encodeURIComponent(guildId)}&select=*`);
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
    const r = await sb(
      `discord_gifs?alianca_id=eq.${encodeURIComponent(aliancaId)}&uso=eq.rosas&ativo=eq.true&select=url&limit=1`);
    v = r?.[0]?.url ?? null;
  } catch { /* sem gif por enquanto, sem problema */ }
  cacheGifRosas.set(aliancaId, { v, t: Date.now() });
  return v;
}

async function gifBoasVindas(aliancaId) {
  if (!aliancaId) return null;
  try {
    const r = await sb(
      `discord_gifs?alianca_id=eq.${encodeURIComponent(aliancaId)}&uso=eq.boas_vindas&ativo=eq.true&select=url`);
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
/* Quatro colunas: codigo, nome em portugues, bandeira e o nome NA PROPRIA
   LINGUA.

   A quarta faltava, e a falta era do mesmo tipo do defeito que a NYX
   encontrou. Esta lista existe justamente para quem nao fala portugues -- e
   estava escrita so' em portugues. Uma alema procurando a lingua dela numa
   lista que diz "Alemão" depende inteiramente de reconhecer a bandeira; se
   errar a bandeira, escolhe errado e conclui que o bot nao funciona.

   Nome de lingua se escreve na propria lingua: e' o padrao de qualquer
   seletor de idioma serio, e nao custa nada -- e' texto fixo, escrito uma vez,
   que nunca precisa passar por tradutor. */
const LINGUAS_MENU = [
  ["pt", "Português", "🇧🇷", "Português"], ["en", "Inglês", "🇬🇧", "English"],
  ["es", "Espanhol", "🇪🇸", "Español"], ["ko", "Coreano", "🇰🇷", "한국어"],
  ["ja", "Japonês", "🇯🇵", "日本語"], ["zh-CN", "Chinês", "🇨🇳", "中文"],
  ["de", "Alemão", "🇩🇪", "Deutsch"], ["fr", "Francês", "🇫🇷", "Français"],
  ["it", "Italiano", "🇮🇹", "Italiano"], ["ru", "Russo", "🇷🇺", "Русский"],
  ["ar", "Árabe", "🇸🇦", "العربية"], ["tr", "Turco", "🇹🇷", "Türkçe"],
  ["id", "Indonésio", "🇮🇩", "Bahasa Indonesia"], ["th", "Tailandês", "🇹🇭", "ไทย"],
  ["vi", "Vietnamita", "🇻🇳", "Tiếng Việt"], ["pl", "Polonês", "🇵🇱", "Polski"],
  ["nl", "Holandês", "🇳🇱", "Nederlands"], ["tl", "Filipino", "🇵🇭", "Filipino"],
  ["hi", "Hindi", "🇮🇳", "हिन्दी"], ["uk", "Ucraniano", "🇺🇦", "Українська"],
];

/* O nome como quem fala aquela lingua o escreve.

   Serve onde o texto NAO passa pelo tradutor -- a tabela do placar, o menu de
   escolha -- e e' exatamente ali que ele importa: sao as telas que a pessoa ve
   antes de o bot saber em que lingua falar com ela. */
function nomeNaPropriaLingua(cod) {
  const achado = LINGUAS_MENU.find(([c]) => c === cod);
  return achado ? `${achado[2]} ${achado[3] || achado[1]}` : cod;
}

function menuIdioma() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("escolher-idioma")
    .setPlaceholder("Selecione seu idioma / Select your language")
    /* Os dois nomes, e o proprio primeiro: quem procura "Deutsch" le' a
       primeira palavra da linha, e quem procura "Alemão" tambem acha. Quando
       sao iguais -- Português, Italiano, Filipino -- nao se repete. */
    .addOptions(LINGUAS_MENU.map(([value, label, emoji, proprio]) => ({
      label: proprio && proprio !== label ? `${proprio} · ${label}` : label,
      value,
      emoji,
    })));
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
/* Por que esta fala NAO vai ser traduzida -- ou null, se vai.

   Era um booleano, e o booleano escondia a diferenca que importa. "Nao vale a
   pena" cobre tanto o "ok" de duas letras, que e' economia funcionando, quanto
   o aviso de 4000 caracteres, que e' o produto falhando. Do lado de fora os
   dois somem igual, e foi assim que um teto baixo demais passou dias mandando
   aviso de alianca sem traduzir sem deixar rastro em lugar nenhum.

   Agora o motivo tem nome, e os que significam "alguem perdeu uma traducao
   que queria" viram numero no cartao do dia. */
function porQueNaoTraduzir(texto, teto = 800, minimo = 12) {
  const t = String(texto || "").trim();
  if (t.length > teto) return "tamanho";
  if (t.length < minimo) return "curto";

  /* Sem a pontuacao do fim: "ok!" e "ok" sao a mesma coisa. */
  if (UNIVERSAIS.has(t.toLowerCase().replace(/[!?.…\s]+$/u, ""))) return "curto";

  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t)) return "curto";
  if (/^https?:\/\/\S+$/i.test(t)) return "curto";
  if (/^[\d\s.,:!?-]+$/.test(t)) return "curto";
  if (/^[/!.][a-z]/i.test(t)) return "curto"; // parece comando

  /* So risadas e interjeicoes: "kkkkkk", "hahaha", "rsrsrs", "hehe".

     Exige quatro letras porque com o piso de dois esta regra passou a ser
     perigosa: "se", "as", "ei", "ir" e "ha" sao palavras de verdade e caem
     todas neste conjunto de letras. Risada de verdade nao tem duas letras. */
  if (t.length >= 4 && /^[kkhaeirs\s!?.]+$/i.test(t)) return "curto";

  if (pareceDesenho(t)) return "desenho";

  return null;
}

function vantajosoTraduzir(texto, teto = 800, minimo = 12) {
  return !porQueNaoTraduzir(texto, teto, minimo);
}

/* Os motivos que valem contar: alguem ficou sem uma traducao que queria.

   "curto" fica de fora de proposito -- e' a economia funcionando, e' a maior
   parte do movimento, e contar isso afogaria os dois numeros que importam. */
const MOTIVOS_QUE_DOEM = new Set(["tamanho", "desenho", "recusa"]);

function anotarSemTraducao(servidorId, motivo, quantas = 1) {
  if (!MOTIVOS_QUE_DOEM.has(motivo) || quantas < 1) return;
  anotarUso(servidorId, `sem:${motivo}`, { traducoes: quantas });
}

/* Desenho feito de texto -- mapa de batalha, tabela, formacao.

   Traduzir isto nao melhora nada e destroi duas coisas ao mesmo tempo. As
   palavras mudam de tamanho, entao as barras deixam de encontrar o que
   apontavam; e se a lingua de chegada e' escrita da direita pra esquerda, o
   Discord vira o bloco inteiro, porque quem manda na direcao do paragrafo e' a
   primeira letra forte dele. O mapa do castelo chegou no canal arabe com as
   pontas trocadas e as linhas soltas -- ilegivel, e sem nada dizendo por que.

   Sem traduzir, o desenho continua em letra latina, o Discord mantem a
   direcao, e ele chega igualzinho ao original. Perde-se a traducao de quatro
   palavras ("north", "castle"), e ganha-se o mapa.

   Tres exigencias juntas, porque cada uma sozinha da falso positivo: varias
   linhas (uma frase com espaco duplo nao e' desenho), metade delas com
   alinhamento deliberado, e tracos de desenho.

   Tres tracos, e nao quatro: uma tabela de tres linhas separadas por `|` tem
   exatamente tres, e tabela quebra ao traduzir pelo mesmo motivo que o mapa
   -- a coluna deixa de alinhar quando a palavra muda de tamanho. Com as duas
   primeiras exigencias no caminho, baixar o terceiro numero nao abre porta
   pra texto normal: prosa nao tem coluna. */
const RISCO_DE_DESENHO = /[/\\|_^<>+=~-]/g;

/* De onde veio esta fala, dito em bandeira.

   Bandeira e nao palavra porque o rodape e' a UNICA parte do cartao que eu
   escrevo. O resto e' a pessoa falando, e sai traduzido; um "traduzido do
   ingles" meu sairia em portugues na sala arabe -- ou me custaria uma chamada
   de tradutor por mensagem so' pra rodape. Bandeira nao precisa de lingua.

   A SETA e' o recado, e nao a bandeira: ela so' aparece quando houve traducao
   de verdade. Sem seta, o que esta ali e' o original -- que e' exatamente o
   caso que confundiu todo mundo quando um aviso longo passou do teto e chegou
   em ingles na sala arabe, com cara de coisa traduzida.

   Idioma que eu nao conheco fica sem selo, em vez de ganhar uma bandeira
   errada: dizer "veio do ingles" sobre uma fala que veio de outro lugar e'
   pior do que nao dizer nada. */
function bandeiraDoIdioma(cod) {
  return LINGUAS_MENU.find(([c]) => c === cod)?.[2] || "";
}

/* ---------------- o caminho de volta: bandeira -> idioma ----------------

   Uma bandeira do Discord nao e' um caractere: sao DOIS, o par de
   "indicadores regionais" que o teclado desenha junto. 🇧🇷 e' o B regional
   seguido do R regional. Entao ler a bandeira e' aritmetica simples -- tira o
   deslocamento e sobra "BR" --, e nao uma tabela de emoji escrita a mao.

   Isso importa porque a tabela a mao envelheceria: cada pais novo que alguem
   usasse teria que ser acrescentado. Assim, qualquer bandeira do mundo chega
   aqui como sigla de pais, e o que decido e' so' se aquele pais tem idioma
   que eu atendo. */
function paisDaBandeira(emoji) {
  const pontos = [...String(emoji || "")];
  if (pontos.length !== 2) return "";
  const letras = pontos.map((c) => c.codePointAt(0) - 0x1f1e6);
  if (letras.some((n) => n < 0 || n > 25)) return "";
  return letras.map((n) => String.fromCharCode(65 + n)).join("");
}

/* Pais -> idioma. Um idioma tem muitos paises, e o menu so' mostra um deles:
   quem e' do Mexico poe 🇲🇽, nao 🇪🇸, e quem e' dos Estados Unidos poe 🇺🇸,
   nao 🇬🇧. Aceitar so' a bandeira do menu seria dizer "sua bandeira nao
   serve" pra maior parte do mundo que fala aquela lingua.

   Onde o pais fala mais de uma lingua, vale a maioria: 🇨🇭 vira alemao, 🇧🇪
   vira holandes, 🇨🇦 vira ingles. Nao e' um juizo sobre o pais -- e' um chute
   sobre em que lingua a pessoa quer LER, e errar aqui custa um clique.

   🇹🇼 e 🇭🇰 caem em chines porque o que o menu tem e' chines; mandar a pessoa
   embora sem traducao seria pior do que entregar na variante que existe. */
const IDIOMA_DO_PAIS = {
  ...Object.fromEntries(
    LINGUAS_MENU.map(([cod, , bandeira]) => [paisDaBandeira(bandeira), cod]).filter(([p]) => p),
  ),
  US: "en", AU: "en", CA: "en", NZ: "en", IE: "en",
  PT: "pt", AO: "pt", MZ: "pt",
  MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", UY: "es",
  BO: "es", EC: "es", GT: "es", CR: "es", DO: "es", PY: "es", PA: "es",
  AT: "de", CH: "de", LI: "de",
  BE: "nl",
  TW: "zh-CN", HK: "zh-CN", SG: "zh-CN", MO: "zh-CN",
  AE: "ar", EG: "ar", MA: "ar", DZ: "ar", IQ: "ar", KW: "ar", QA: "ar",
  BH: "ar", OM: "ar", JO: "ar", LB: "ar", LY: "ar", TN: "ar", YE: "ar",
};

function idiomaDaBandeira(emoji) {
  const pais = paisDaBandeira(emoji);
  return pais ? IDIOMA_DO_PAIS[pais] || "" : "";
}

function seloDeOrigem(idiomaOrigem, idiomaDestino, traduziu) {
  const de = bandeiraDoIdioma(idiomaOrigem);
  if (!de) return "";
  if (!traduziu) return de;
  const para = bandeiraDoIdioma(idiomaDestino);
  return para ? `${de} → ${para}` : de;
}

function pareceDesenho(texto) {
  const linhas = String(texto || "").split("\n").filter((l) => l.trim());
  if (linhas.length < 3) return false;

  const alinhadas = linhas.filter((l) => /\S {2,}\S/.test(l)).length;
  if (alinhadas * 2 < linhas.length) return false;

  return (String(texto).match(RISCO_DE_DESENHO) || []).length >= 3;
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
/* ---------------- O tradutor de cada servidor ----------------

   Ate aqui todo mundo dividia o mesmo endpoint gratuito do Google, sem chave.
   Funciona -- e ja devolveu 429 uma vez com cinco servidores. O problema nao
   e' a falha: e' que o teto e' COMPARTILHADO. Quanto mais gente usa, pior fica
   pra todo mundo, e quem traduz muito nao tem como pagar mais pra traduzir
   mais, porque o custo nao e' dele, e' de quem hospeda.

   Com chave por servidor o teto vem junto com o cliente. O Azure da 2 milhoes
   de caracteres por mes POR CONTA -- entao cada cliente traz o proprio limite
   gratuito, e a conta cresce junto com a base em vez de bater num muro.

   A chave e' de quem contratou, nao minha. Fica cifrada, e o segredo mora numa
   variavel de ambiente do bot: o banco vazado sozinho nao usa a chave de
   ninguem. Se o segredo nao existir, eu me RECUSO a guardar chave -- guardar
   em texto puro "por enquanto" e' o tipo de coisa que fica pra sempre. */

const SEGREDO = process.env.CYRON_SEGREDO || "";

function chaveDeCifra() {
  if (!SEGREDO) return null;
  return createHash("sha256").update(SEGREDO).digest();  // 32 bytes
}

function cifrar(texto) {
  const k = chaveDeCifra();
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64")).join(".");
}

function decifrar(guardado) {
  const k = chaveDeCifra();
  if (!k || !guardado) return null;
  try {
    const [iv, tag, dados] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
  } catch {
    /* Segredo trocado, ou linha mexida na mao. Nao da' pra usar, e insistir
       so' geraria erro de autenticacao no tradutor -- que apareceria como
       "a traducao parou" e mandaria alguem procurar no lugar errado. */
    console.error("tradutor: nao consegui decifrar a chave deste servidor");
    return null;
  }
}

/* Cada tradutor chama os idiomas do seu jeito. */
const AZURE_IDIOMA = { "zh-CN": "zh-Hans", tl: "fil" };
const DEEPL_IDIOMA = { pt: "PT-BR", en: "EN-US", "zh-CN": "ZH" };

const MOTORES = {
  azure: {
    nome: "Azure Translator",
    /* 2 milhoes de caracteres/mes no plano F0, por conta. */
    async traduzir(texto, alvo, cfg) {
      const r = await fetch(
        `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${AZURE_IDIOMA[alvo] || alvo}`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": cfg.chave,
            ...(cfg.regiao ? { "Ocp-Apim-Subscription-Region": cfg.regiao } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify([{ Text: texto }]),
          signal: AbortSignal.timeout(8000),
        });
      if (!r.ok) throw new Error(`azure ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j?.[0]?.translations?.[0]?.text || "";
    },
  },
  deepl: {
    nome: "DeepL",
    /* Chave terminada em :fx e' da conta gratuita, e o endereco dela e' outro.
       Errar isto devolve 403 -- que parece chave invalida e nao e'. */
    async traduzir(texto, alvo, cfg) {
      const base = cfg.chave.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
      const r = await fetch(`${base}/v2/translate`, {
        method: "POST",
        headers: { Authorization: `DeepL-Auth-Key ${cfg.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [texto], target_lang: DEEPL_IDIOMA[alvo] || alvo.toUpperCase() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`deepl ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j?.translations?.[0]?.text || "";
    },
  },
};

/* Qual tradutor este servidor usa. Cache curto: e' lido a cada mensagem. */
const cacheMotor = new Map();
const MOTOR_AUTO = { tipo: "auto" };

/* O motor a partir do guild, pros lugares que so tem a interacao na mao. */
async function motorDoGuild(guildId) {
  if (!guildId) return MOTOR_AUTO;
  return motorDe(await servidorDoGuild(guildId).catch(() => null));
}

function motorDe(servidor) {
  if (!servidor) return MOTOR_AUTO;
  const guardado = cacheMotor.get(servidor.id);
  if (guardado && guardado.quando > Date.now() - 5 * 60 * 1000) return guardado.motor;

  /* Ate' o gratuito carrega o id do servidor. Antes so' o motor com chave
     carregava, porque so' ele precisava -- e a contagem de uso, que veio
     depois, teria nascido cega justamente pra maioria dos servidores. */
  /* A cota viaja junto com o motor porque quem decide usar a chave do dono e'
     `traduzir`, la' embaixo, e ela so' recebe o motor. */
  let motor = { tipo: "auto", servidorId: servidor.id, cotaDoDono: cotaDoDonoNoDia(servidor) };
  if (servidor.tradutor_motor && servidor.tradutor_motor !== "auto" && servidor.tradutor_chave) {
    const chave = decifrar(servidor.tradutor_chave);
    if (chave) {
      motor = { tipo: servidor.tradutor_motor, chave, regiao: servidor.tradutor_regiao || null,
        servidorId: servidor.id, cotaDoDono: cotaDoDonoNoDia(servidor) };
    } else {
      /* Nao decifrou -- segredo trocado, ou linha mexida. Sem isto aqui o
         painel dizia "🟢 Azure, chave deste servidor" (ele so' olha se a
         coluna esta preenchida) enquanto eu traduzia pelo gratuito. Mentira
         exata sobre o que a pessoa esta pagando. */
      falhaDoMotor.set(servidor.id, {
        quando: Date.now(),
        porque: "não consegui decifrar a chave guardada — precisa ser colada de novo",
      });
    }
  }
  cacheMotor.set(servidor.id, { motor, quando: Date.now() });
  return motor;
}

/* ---------------- quanto cada servidor traduz ----------------

   Isto nao existia, e era a unica lacuna do projeto que piorava sozinha: o
   que nao foi contado hoje nao da' pra recuperar amanha. Sem esses numeros
   nao da' pra saber quanto um cliente custa, nao ha base pra decidir preco, e
   um painel de controle nasceria sem historico nenhum pra mostrar.

   Conto em MEMORIA e descarrego de minuto em minuto. Uma escrita no banco por
   mensagem traduzida poria o banco no caminho da conversa -- e a conversa e' o
   produto. O preco disso e' perder ate' um minuto de contagem se o processo
   cair no meio; pra uma metrica de uso, arredondamento aceitavel.

   Acerto de cache conta separado, e de proposito: ele nao custa nada, entao
   somar junto inflaria o consumo e faria o cache parecer inutil. Contado a
   parte, ele mostra exatamente o quanto esta economizando. */
const usoPendente = new Map(); // servidorId|dia|motor -> { caracteres, traducoes, cache }

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function anotarUso(servidorId, motor, { caracteres = 0, traducoes = 0, cache = 0 }) {
  if (!servidorId) return;
  const chave = `${servidorId}|${hojeISO()}|${motor}`;
  const atual = usoPendente.get(chave) || { caracteres: 0, traducoes: 0, cache: 0 };
  atual.caracteres += caracteres;
  atual.traducoes += traducoes;
  atual.cache += cache;
  usoPendente.set(chave, atual);
}

async function descarregarUso() {
  if (!usoPendente.size) return;
  /* Tira tudo do mapa ANTES de escrever: o que chegar durante a escrita entra
     na proxima leva, em vez de ser contado duas vezes ou perdido. */
  const leva = [...usoPendente.entries()];
  usoPendente.clear();

  for (const [chave, v] of leva) {
    const [servidorId, dia, motor] = chave.split("|");
    try {
      await rpc("cyron_somar_uso", {
        p_servidor: servidorId, p_dia: dia, p_motor: motor,
        p_caracteres: v.caracteres, p_traducoes: v.traducoes, p_cache: v.cache,
      });
    } catch (e) {
      console.error("uso: nao consegui gravar:", e?.message || e);
      /* Devolve pro mapa pra tentar de novo -- somando com o que chegou
         nesse meio tempo, senao a falha de uma vez apagaria a contagem. */
      const voltou = usoPendente.get(chave) || { caracteres: 0, traducoes: 0, cache: 0 };
      voltou.caracteres += v.caracteres;
      voltou.traducoes += v.traducoes;
      voltou.cache += v.cache;
      usoPendente.set(chave, voltou);
    }
  }
}

/* O que este servidor traduziu hoje, pro painel. */
async function usoDeHoje(servidorId) {
  const linhas = await sb(
    `cyron_uso_diario?servidor_id=eq.${servidorId}&dia=eq.${hojeISO()}&select=caracteres,traducoes,do_cache`) || [];
  return linhas.reduce((a, l) => ({
    caracteres: a.caracteres + Number(l.caracteres || 0),
    traducoes: a.traducoes + Number(l.traducoes || 0),
    cache: a.cache + Number(l.do_cache || 0),
  }), { caracteres: 0, traducoes: 0, cache: 0 });
}

async function traduzirComCache(texto, alvo, motor = MOTOR_AUTO) {
  if (texto.length > MAX_CACHE) return await traduzir(texto, alvo, motor);

  /* O motor entra na chave do cache.

     Ela era so (idioma, texto), e o cache e' de todos os servidores juntos --
     entao quem esta pagando DeepL receberia a traducao que o Google guardou
     pra outro servidor. Barato e desonesto: a pessoa contratou a qualidade do
     motor que escolheu, nao a de quem passou ali antes. */
  const chave = createHash("sha256").update(`${motor.tipo} ${alvo} ${texto}`).digest("hex").slice(0, 40);
  const guardado = await doCache(chave);
  if (guardado) {
    anotarUso(motor.servidorId, motor.tipo, { cache: 1 });
    return guardado;
  }

  const novo = await traduzir(texto, alvo, motor);
  if (novo) {
    /* Sem await: a conversa nao espera o banco pra seguir. */
    sbPost("discord_traducao_cache", { chave, idioma: alvo, traduzido: novo, motor: motor.tipo })
      .catch(() => { /* ja traduzido; guardar e' bonus */ });
  }
  return novo;
}

/* A ultima falha do tradutor de cada servidor, pra aparecer no painel.

   Chave errada nao pode calar o servidor: se o motor do cliente recusa, eu
   caio no gratuito e a conversa segue. So que assim a falha fica invisivel --
   ele continua achando que usa o DeepL que pagou, e o log fica aqui comigo.
   Guardando a falha, o painel dele conta. */
const falhaDoMotor = new Map();

/* A fila dos gratuitos.

   Eram dois, e os dois eram o MESMO Google no mesmo endereco de saida. Quando
   ele responde 429 -- "voce esta chamando demais" --, os dois caem no mesmo
   segundo, e a fila inteira acaba antes de ter servido pra alguma coisa. Foi
   exatamente o que aconteceu no primeiro 429 que apareceu no canal de erros.

   Cascata de verdade precisa de PROVEDORES diferentes, nao de enderecos
   diferentes do mesmo provedor: o que esgota e' a cota de quem atende, entao
   dois caminhos pra mesma porta contam como um. O Lingva atende por conta
   propria, e cada instancia tem limite proprio.

   O MyMemory entrou aqui e saiu no mesmo dia. Ele nao e' um tradutor: e' um
   ACERVO de traducoes que gente contribuiu, e devolve a mais parecida que
   achar. Alguem cadastrou "vamos no urso" -> "let's go on the bear" e marcou
   como alemao; pedindo alemao, ele devolveu isso, com `target: de-DE` escrito
   num texto em ingles. Nao da' pra filtrar -- a resposta mente sobre si
   mesma.

   Mensagem sem traducao e' ruim; mensagem no idioma errado e' pior, porque
   parece certa e ninguem confere. Entre uma reserva que as vezes entrega
   coisa errada e nao ter reserva, nao ter e' mais honesto. */
/* Como se fala com cada tipo de tradutor publico.

   Sao dois formatos no mundo -- Lingva e LibreTranslate -- e quase toda
   instancia publica e' uma das duas. Sabendo os dois, aceitar um endereco novo
   passa a ser uma linha de texto no painel em vez de uma alteracao de codigo.

   Isso importa porque estes enderecos MORREM: dos oito que testei pra montar
   esta lista, sete estavam fora do ar. Nao e' acidente, e' a natureza de
   servico mantido por voluntario. Se cada morte exigir publicar o bot de novo,
   o tradutor fica quebrado ate' alguem ter tempo. */
const FORMATOS = {
  lingva: (base) => ({
    url: (texto, alvo) => `${String(base).replace(/\/+$/, "")}/api/v1/auto/${alvo}/${encodeURIComponent(texto)}`,
    ler: (j) => j?.translation || "",
  }),
  libre: (base) => ({
    url: () => `${String(base).replace(/\/+$/, "")}/translate`,
    corpo: (texto, alvo) => ({ q: texto, source: "auto", target: alvo, format: "text" }),
    ler: (j) => j?.translatedText || "",
  }),
};

const GRATUITOS = [
  {
    nome: "google-dict",
    url: (texto, alvo) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${alvo}&q=${encodeURIComponent(texto)}`,
    ler: (j) => (Array.isArray(j) ? j.map((p) => (Array.isArray(p) ? p[0] : p)).join("") : ""),
  },
  {
    nome: "google-gtx",
    url: (texto, alvo) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${alvo}&dt=t&q=${encodeURIComponent(texto)}`,
    ler: (j) => (j?.[0] || []).map((p) => p?.[0] || "").join(""),
  },
  /* Lingva repassa o Google: a qualidade e' a de la', mas a cota e' do IP
     DELE. E' isso que o torna reserva de verdade, enquanto os dois de cima nao
     servem um pro outro -- sao duas portas da mesma casa, e quando ela fecha,
     fecham as duas.

     Custa uns 2 segundos por chamada, entao vem por ultimo: quem esta de pe
     responde mais rapido, e reserva boa e' a que so' aparece quando precisa. */
  { nome: "lingva-dialectapp", ...FORMATOS.lingva("https://lingva.dialectapp.org") },
];

/* Os enderecos que voce acrescentou pelo painel.

   Uma linha por tradutor: `formato|endereco`. Formato invalido some em
   silencio de proposito -- linha errada no meio da lista nao pode derrubar as
   que estao certas, e o painel confere na hora de salvar. */
function tradutoresDoPainel(texto) {
  const extras = [];
  for (const linha of String(texto || "").split(/[\n,]+/)) {
    const [formato, ...resto] = linha.split("|").map((x) => x.trim());
    const base = resto.join("|");
    if (!base || !/^https:\/\//i.test(base)) continue;
    const molde = FORMATOS[String(formato).toLowerCase()];
    if (!molde) continue;
    extras.push({ nome: `extra:${base.replace(/^https:\/\//, "").slice(0, 40)}`, ...molde(base) });
  }
  return extras;
}

/* Quem levou nao, descansa.

   Sem isto, um 429 do Google era pago de novo em CADA mensagem: a fila
   sempre comecava por ele, sempre tomava o mesmo nao, e cada fala carregava
   uma chamada perdida e um pedido a mais pra quem ja tinha mandado parar --
   que e' a receita pra o castigo durar mais.

   Dez minutos de canto: tempo de a janela de cota do outro lado virar, sem
   ser tanto que a gente fique no tradutor pior por horas depois de um
   tropeco unico. */
const descansoDoGratuito = new Map(); // nome -> ate quando
const DESCANSO_APOS_NAO = 10 * 60 * 1000;
const DESCANSO_APOS_QUEDA = 2 * 60 * 1000;

function porDeCastigo(nome, quanto) {
  descansoDoGratuito.set(nome, Date.now() + quanto);
}

function estaDescansando(nome) {
  const ate = descansoDoGratuito.get(nome) || 0;
  if (Date.now() >= ate) { descansoDoGratuito.delete(nome); return false; }
  return true;
}

/* A fila da vez: quem nao esta de castigo, na ordem.

   Se TODOS estiverem, a fila volta inteira. Preferir uma chamada que
   provavelmente falha a nao tentar nada: o castigo existe pra economizar
   chamada, nao pra impedir a unica tentativa que ainda poderia dar certo. */
let CHAVE_PRIMEIRO = true; // a chave do dono na frente da fila? ver traduzir()
let extrasDoPainel = [];   // tradutores publicos, recarregados com os ajustes
let reservasDoDono = [];   // chaves do dono, idem

/* As chaves do DONO, que valem pra todos os servidores.

   Diferente da chave por servidor, que ja existia: aquela e' do cliente, ele
   escolheu e paga; esta e' sua, e existe pra nao deixar NENHUM servidor sem
   traducao quando o gratuito recusa. As duas convivem -- a do cliente e'
   tentada primeiro, porque ele contratou aquela qualidade.

   Guardadas cifradas, como as dos clientes. A tabela de ajustes so' e' lida
   pela chave de servico, mas chave em texto puro no banco e' o tipo de coisa
   que envelhece mal: basta um dia alguem exportar a tabela pra depurar. */
function motoresDoDono() { return reservasDoDono; }

function lerReservasDoDono(a) {
  const fora = [];
  for (const tipo of ["azure", "deepl"]) {
    /* Duas origens, e o cofre da maquina vem primeiro.

       O painel existe pra quem esta no celular e nao tem outro jeito. Mas
       chave do DONO tem lugar melhor: o mesmo cofre onde ja moram o token do
       Discord e a chave do Supabase. La ela nunca passa pelo banco, nunca
       aparece numa tela, e some junto com a maquina.

       Quem esta no cofre ganha, porque mexer no cofre exige acesso a maquina
       -- e' a decisao mais deliberada das duas. */
    const doCofre = process.env[`${tipo.toUpperCase()}_CHAVE`];
    if (doCofre) {
      fora.push({
        tipo,
        chave: doCofre.trim(),
        regiao: process.env[`${tipo.toUpperCase()}_REGIAO`] || a[`${tipo}_regiao`] || null,
        servidorId: null,
      });
      continue;
    }

    const guardada = a[`${tipo}_chave`];
    if (!guardada) continue;
    const chave = decifrar(guardada);
    if (!chave) {
      console.error(`tradutor: nao consegui decifrar a chave ${tipo} do dono -- precisa ser colada de novo`);
      continue;
    }
    fora.push({ tipo, chave, regiao: a[`${tipo}_regiao`] || null, servidorId: null });
  }
  return fora;
}

function gratuitosDaVez(texto) {
  const todos = [...GRATUITOS, ...extrasDoPainel];
  const servem = todos.filter((g) => !g.cabe || g.cabe(texto));
  const livres = servem.filter((g) => !estaDescansando(g.nome));
  return livres.length ? livres : servem;
}

/* ---------------- quanto ainda sobra da cota ----------------

   A cota mensal e' o unico limite deste produto que acaba SEM avisar. Chave
   errada da erro na hora; tradutor fora do ar aparece no canal de erros; cota
   estourada devolve 403, a cascata cai no gratuito, o gratuito devolve 429 --
   e o que a pessoa ve e' "o bot parou de traduzir", tres camadas longe da
   causa.

   O numero existe: a DeepL publica quanto ja' foi gasto. So' que ninguem
   olhava, e olhar depois que acabou nao serve pra nada. Entao ele passa a ser
   lido de hora em hora, e a falar antes.

   Uma vez por hora, e nao a cada mensagem: e' um numero de mes, e uma chamada
   por fala seria gastar rede pra saber que quase nada mudou. */
const COTA_DE = {
  async deepl(cfg) {
    const base = cfg.chave.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const r = await fetch(`${base}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${cfg.chave}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`deepl usage ${r.status}`);
    const j = await r.json();
    const teto = Number(j?.character_limit || 0);
    if (!teto) return null;
    return { usado: Number(j?.character_count || 0), teto };
  },
  /* A Azure nao tem endereco de consumo no F0 -- o numero so' existe no portal
     dela. Fica sem: melhor nao ter a linha do que inventar uma. */
};

const AVISOS_DE_COTA = [95, 85, 70];
const cotaDoDono = new Map();  // tipo -> { usado, teto, pct, quando, faixa }

function comoEstaACota() { return [...cotaDoDono.entries()].map(([tipo, v]) => ({ tipo, ...v })); }

/* Em que faixa este consumo esta, e se ela merece aviso.

   O aviso e' por faixa e so' pra CIMA. Sem isso, "passou de 70%" seria
   verdade em toda leitura dali pra frente -- um aviso por hora, o mes inteiro,
   sobre algo que nao mudou. Aviso repetido nao alerta ninguem; ele ensina a
   ignorar o canal.

   E a faixa guardada acompanha o consumo pra BAIXO tambem. A primeira versao
   disto guardava `Math.max(faixa, faixaAnterior)`, que parecia prudente e
   quebrava exatamente onde importa: virado o mes, o gasto zera, mas a faixa
   guardada continuaria em 95 -- e o proximo 70%, o 85% e o 95% do mes seguinte
   passariam calados. Um alarme que dispara uma vez na vida. */
function faixaDaCota(pct) {
  return AVISOS_DE_COTA.find((f) => pct >= f) || 0;
}

function precisaAvisar(pct, faixaAnterior = 0) {
  const faixa = faixaDaCota(pct);
  return faixa > faixaAnterior ? faixa : 0;
}

async function olharAsCotas() {
  for (const reserva of motoresDoDono()) {
    const ler = COTA_DE[reserva.tipo];
    if (!ler) continue;
    let leitura = null;
    try {
      leitura = await ler(reserva);
    } catch (e) {
      /* Nao saber quanto sobrou nao pode virar erro no canal: a traducao
         continua funcionando, e a proxima hora tenta de novo. */
      console.error(`cota: nao consegui ler a da ${reserva.tipo}:`, String(e?.message || e).slice(0, 120));
      continue;
    }
    if (!leitura) continue;

    const antes = cotaDoDono.get(reserva.tipo) || { faixa: 0 };
    const pct = Math.round((leitura.usado / leitura.teto) * 100);
    const avisar = precisaAvisar(pct, antes.faixa);

    cotaDoDono.set(reserva.tipo, { ...leitura, pct, quando: Date.now(), faixa: faixaDaCota(pct) });
    if (!avisar) continue;

    const nome = MOTORES[reserva.tipo]?.nome || reserva.tipo;
    const sobra = leitura.teto - leitura.usado;
    await avisarNoPainel(CANAL_ERROS, {
      embeds: [{
        color: pct >= 95 ? 0xB3261E : pct >= 85 ? 0xE0A63A : 0x4A6FA5,
        title: `${pct >= 95 ? "🔴" : pct >= 85 ? "🟠" : "🟡"} A cota da ${nome} está em ${pct}%`,
        description:
          `Já foram **${leitura.usado.toLocaleString("pt-BR")}** de ` +
          `**${leitura.teto.toLocaleString("pt-BR")}** caracteres deste mês. ` +
          `Sobram **${sobra.toLocaleString("pt-BR")}**.\n\n` +
          (pct >= 95
            ? "**Quando acabar, ela devolve 403 e eu caio no tradutor gratuito** — que a este " +
              "volume responde 429. O sintoma para quem usa é a mensagem chegar sem tradução, " +
              "sem nada explicando por quê."
            : "Quando acabar, eu caio no tradutor gratuito, que a volumes altos recusa. " +
              "Dá tempo de cadastrar outra chave antes disso."),
        fields: [{
          name: "O que fazer",
          value: "Cadastre uma segunda chave em `/admin` → 🔑 **Chaves de tradução**. " +
            "A Azure Translator no plano F0 dá 2 milhões de caracteres por mês, " +
            "tem teto rígido e nunca cobra — ela entra na cascata e assume quando esta acabar.",
        }],
        timestamp: new Date().toISOString(),
      }],
    });
    console.log(`cota: ${reserva.tipo} em ${pct}% (${leitura.usado}/${leitura.teto})`);
  }
}

/* As chaves do dono, na ordem em que ele cadastrou. */
/* Quanto cada servidor ja' gastou das minhas chaves hoje.

   Em memoria, e nao no banco, porque isto e' consultado a cada fala: uma ida
   ao Postgres por mensagem seria pior que o problema que resolve.

   Ao subir, o numero de cada servidor comeca do que ja' esta gravado no dia --
   senao um reinicio no meio da tarde zeraria o teto e o servidor grande teria
   duas cotas no mesmo dia. Uma leitura por servidor por dia, e ela fica. */
const gastoDoDia = new Map(); // `${servidorId}|${dia}` -> caracteres

async function jaGastouHoje(servidorId) {
  const chave = `${servidorId}|${hojeISO()}`;
  if (gastoDoDia.has(chave)) return gastoDoDia.get(chave);
  let inicial = 0;
  try {
    const linhas = await sb(`cyron_uso_diario?servidor_id=eq.${servidorId}&dia=eq.${hojeISO()}` +
      "&select=caracteres,motor") || [];
    inicial = linhas
      .filter((l) => String(l.motor || "").startsWith("dono-"))
      .reduce((a, l) => a + Number(l.caracteres || 0), 0);
  } catch { /* sem o passado, comeco do zero: teto frouxo e' melhor que bot mudo */ }
  gastoDoDia.set(chave, inicial);
  /* Um dia de chaves velhas nao precisa ficar na memoria pra sempre. */
  for (const k of gastoDoDia.keys()) if (!k.endsWith(hojeISO())) gastoDoDia.delete(k);
  return inicial;
}

function somarGasto(servidorId, quantos) {
  const chave = `${servidorId}|${hojeISO()}`;
  gastoDoDia.set(chave, (gastoDoDia.get(chave) || 0) + quantos);
}

/* Passou do teto: a chave do dono sai da fila SO' pra este servidor. */
async function estourouACota(servidorId, teto) {
  if (!servidorId || !(teto > 0)) return false;
  return (await jaGastouHoje(servidorId)) >= teto;
}

async function tentarChavesDoDono(texto, alvo, motor) {
  if (await estourouACota(motor.servidorId, motor.cotaDoDono)) return null;
  for (const reserva of motoresDoDono()) {
    if (estaDescansando(`dono:${reserva.tipo}`)) continue;
    try {
      const saiu = await MOTORES[reserva.tipo].traduzir(texto, alvo, reserva);
      if (saiu) {
        anotarUso(motor.servidorId, `dono-${reserva.tipo}`, { caracteres: texto.length, traducoes: 1 });
        somarGasto(motor.servidorId, texto.length);
        return saiu;
      }
    } catch (e) {
      /* Cota do mes estourada demora a voltar; erro de rede, nao. Insistir a
         cada fala nao traz o mes de volta -- seis horas de canto, e a fila
         segue nos gratuitos ate' la. */
      const porque = String(e?.message || e);
      const acabou = /40[36]|quota|limit/i.test(porque);
      porDeCastigo(`dono:${reserva.tipo}`, acabou ? 6 * 60 * 60 * 1000 : DESCANSO_APOS_QUEDA);
      tradutorFalhas.erros++; tradutorFalhas.ultimoErro = `${reserva.tipo} do dono: ${porque.slice(0, 90)}`;
      console.error(`tradutor: chave ${reserva.tipo} do dono falhou${acabou ? " (cota do mês?)" : ""}:`,
        porque.slice(0, 120));
    }
  }
  return null;
}

async function traduzir(texto, alvo, motor = MOTOR_AUTO) {
  const escolhido = MOTORES[motor.tipo];
  if (escolhido && motor.chave) {
    try {
      const saiu = await escolhido.traduzir(texto, alvo, motor);
      if (saiu) {
        if (motor.servidorId) falhaDoMotor.delete(motor.servidorId);
        anotarUso(motor.servidorId, motor.tipo, { caracteres: texto.length, traducoes: 1 });
        return saiu;
      }
      throw new Error("resposta vazia");
    } catch (e) {
      const porque = String(e?.message || e).slice(0, 160);
      tradutorFalhas.erros++; tradutorFalhas.quedas++; tradutorFalhas.ultimoErro = porque;
      console.error(`tradutor: ${motor.tipo} falhou:`, porque);
      if (motor.servidorId) falhaDoMotor.set(motor.servidorId, { quando: Date.now(), porque });
      /* Cai no gratuito em vez de devolver nada: mensagem sem traducao ainda
         chega; mensagem nenhuma some da conversa. */
    }
  }

  /* Os gratuitos primeiro; a chave do dono depois.

     Parece invertido -- a chave e' mais confiavel --, e nao e'. A camada
     gratuita da Azure e' 2 milhoes de caracteres por MES, com teto rigido:
     estourou, ela recusa ate' virar o mes. Gastar isso nas falas que o Google
     ja atenderia de graca seria queimar a reserva justamente para o dia em que
     o Google fechar a porta.

     Entao a chave fica guardada pra quando precisa, que e' o que reserva
     quer dizer. */
  /* A chave do dono vem ANTES dos gratuitos.

     Eu tinha posto depois, com o argumento de guardar a cota pro dia em que o
     gratuito fechasse a porta. A chave de verdade derrubou o argumento: 1
     milhao de caracteres por mes contra 377 mil de uso -- folga de 2,6x --,
     250ms contra os 2,2s do Lingva, e traducao melhor que a de todos ("Bear
     Rally" onde o gratuito escreveu "manifestacao").

     Guardar a melhor e a mais rapida pra usar a pior seria economizar o que
     nao falta. E se o mes acabar, o castigo rebaixa ela sozinha por seis horas
     e a fila cai nos gratuitos -- que e' de onde ela veio.

     A ordem inverte pelo painel, sem publicar o bot. */
  if (CHAVE_PRIMEIRO) {
    const saiu = await tentarChavesDoDono(texto, alvo, motor);
    if (saiu) return saiu;
  }

  for (const t of gratuitosDaVez(texto)) {
    try {
      /* Lingva pede o texto na URL; LibreTranslate pede num POST. Um `corpo`
         no molde e' o que diz qual dos dois. */
      const r = t.corpo
        ? await fetch(t.url(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t.corpo(texto, alvo)),
          signal: AbortSignal.timeout(12000),
        })
        : await fetch(t.url(texto, alvo), { signal: AbortSignal.timeout(12000) });
      if (!r.ok) {
        /* 429 e' cota estourada: esse demora a voltar. 5xx e' o servico
           passando mal: costuma voltar rapido. Castigos diferentes, porque
           tratar os dois igual ou desperdica chamada ou abandona um tradutor
           bom por causa de um tropeco de meio minuto. */
        porDeCastigo(t.nome, r.status === 429 ? DESCANSO_APOS_NAO : DESCANSO_APOS_QUEDA);
        tradutorFalhas.erros++; tradutorFalhas.ultimoErro = `HTTP ${r.status} no ${t.nome}`;
        console.error(`espelho: tradutor ${t.nome} devolveu HTTP ${r.status}`); continue;
      }
      const saiu = t.ler(await r.json());
      if (!saiu) { porDeCastigo(t.nome, DESCANSO_APOS_QUEDA); continue; }
      if (saiu) {
        /* Sempre "auto" aqui, mesmo quando o servidor tem chave propria: se
           chegou nesta linha e' porque o motor dele recusou e eu caí no
           gratuito. Contar como se fosse a chave dele esconderia justamente o
           que ele precisa ver -- que o que ele paga nao esta sendo usado. */
        anotarUso(motor.servidorId, "auto", { caracteres: texto.length, traducoes: 1 });
        return saiu;
      }
    } catch (e) {
      porDeCastigo(t.nome, DESCANSO_APOS_QUEDA);
      console.error(`espelho: tradutor ${t.nome} falhou:`, String(e).slice(0, 100));
    }
  }

  /* Nao foi antes da fila? Entao e' agora, como ultima esperanca antes de a
     fala chegar sem traducao nenhuma. */
  if (!CHAVE_PRIMEIRO) {
    const saiu = await tentarChavesDoDono(texto, alvo, motor);
    if (saiu) {
      console.log("tradutor: a chave do dono salvou uma fala que o gratuito recusou");
      return saiu;
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

/* O que o tradutor nao pode encostar.

   Mencao, emoji do servidor, canal e link nao sao palavras -- sao codigo que o
   Discord desenha. `<@866033442688073748>` passando por um tradutor volta com
   espaco no meio, com o sinal trocado ou traduzido ao pe da letra, e o que era
   uma pessoa marcada vira lixo na tela. Este defeito estava calado desde
   sempre: marcar alguem numa sala e ver a marcacao chegar quebrada na outra.

   Entao eles saem do texto antes da traducao e voltam depois, no lugar. A
   volta aceita espaco a mais dentro do marcador, porque tradutor mexe no
   espacamento; e o que nao voltar vai pro fim, que e' feio mas e' melhor do
   que sumir com a marcacao de alguem. */
const PEDACOS_INTOCAVEIS = /(<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|<t:\d+(?::[tTdDfFR])?>|https?:\/\/\S+)/g;

/* As palavras que sao DESTE servidor.

   Testado num tradutor de verdade: "alguem no rally?" virou em alemao "hat
   jemand an der Kundgebung teilgenommen?" -- alguem participou da
   MANIFESTACAO. E "abre os baus" virou "öffnet den Bus", abre o onibus.

   Nenhum tradutor vai acertar isso, porque o erro nao e' de traducao: rally e
   baú tem significado proprio dentro daquele servidor, e ele nao esta em
   dicionario nenhum. Trocar de motor -- inclusive por inteligencia
   artificial -- nao resolve sozinho; ensinar as palavras resolve.

   Vai pelo mesmo caminho que ja protege mencao e emoji, entao custa zero e
   vale pra qualquer motor. E' a unica parte do tradutor que e' de verdade
   nossa: os outros sabem lingua, so' nos sabemos as palavras da casa.

   Do mais longo pro mais curto, senao um termo curto quebraria um longo pelo
   meio ("urso" comendo o "urso polar" de quem cadastrou os dois). */
function regraDosTermos(termos) {
  const limpos = [...new Set((termos || []).map((t) => String(t).trim()).filter((t) => t.length > 1))]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!limpos.length) return null;
  /* Fronteira feita na mao em vez de \b: \b nao entende acento, entao "baú"
     nao casaria direito -- e acento e' justamente o que aparece nas palavras
     que se cadastra aqui. */
  /* O plural entra junto. Quem cadastra "baú" quer "baús" protegido tambem --
     obrigar a cadastrar as duas formas seria transferir pra pessoa um trabalho
     que a regra faz. So' "s" e "es", que cobrem portugues, ingles e espanhol
     sem virar adivinhacao: "urso" pega "ursos" e continua nao pegando
     "ursinho". */
  return new RegExp(`(?<![\\p{L}\\p{N}])(${limpos.join("|")})(es|s)?(?![\\p{L}\\p{N}])`, "giu");
}

function protegerDoTradutor(texto, termos) {
  const pecas = [];
  let marcado = String(texto);
  const regra = regraDosTermos(termos);
  if (regra) {
    marcado = marcado.replace(regra, (achado) => {
      pecas.push(achado);
      return ` %%${pecas.length - 1}%% `;
    });
  }
  marcado = marcado.replace(PEDACOS_INTOCAVEIS, (achado) => {
    pecas.push(achado);
    return ` %%${pecas.length - 1}%% `;
  });
  return { marcado, pecas };
}

function devolverPecas(texto, pecas) {
  if (!pecas.length) return texto;
  const usadas = new Set();
  let volta = String(texto).replace(/%\s*%\s*(\d+)\s*%\s*%/g, (tudo, n) => {
    const i = Number(n);
    if (!pecas[i]) return tudo;
    usadas.add(i);
    return pecas[i];
  });
  const perdidas = pecas.filter((_, i) => !usadas.has(i));
  if (perdidas.length) volta = `${volta.trim()} ${perdidas.join(" ")}`;

  /* Tira o espaco que EU coloquei, nao o que a pessoa escreveu.

     O marcador vai cercado de espaco pra o tradutor nao grudar ele na palavra
     do lado. Isso resolve a traducao e estraga a pontuacao na volta: "no
     rally?" voltava "no rally ?", e "[TOP]" voltava "[ TOP ]". Ninguem escreve
     assim, e ficava na cara em toda mensagem com mencao. */
  return volta
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?)\]}»…])/g, "$1")
    .replace(/([(\[{«¿¡])\s+/g, "$1")
    .trim();
}

/* Uma cor por pessoa, sempre a mesma.

   A barra colorida do card e' o que faz a conversa ser lida de relance: o olho
   acha "as falas do Tiago" pela cor antes de ler o nome. Sorteada a cada
   mensagem ela viraria enfeite; presa ao id da pessoa, vira identidade.

   Paleta escolhida a dedo em vez de cor calculada do id: calcular da' cinza,
   marrom e quase-preto, que somem no fundo escuro do Discord. */
const CORES_DE_PESSOA = [
  0x5865F2, 0xE67E22, 0x2ECC71, 0xE91E63, 0x1ABC9C,
  0xF1C40F, 0x9B59B6, 0x3498DB, 0xE74C3C, 0x11806A,
];

function corDaPessoa(id) {
  let soma = 0;
  for (const c of String(id)) soma = (soma * 31 + c.charCodeAt(0)) % 100000;
  return CORES_DE_PESSOA[soma % CORES_DE_PESSOA.length];
}

/* Onde cada fala mora em cada sala.

   Uma fala vira oito mensagens: a original e as sete traduzidas, cada uma com
   id proprio na sala dela. Sem guardar isso, o cabecalho "↩ Fulano" e' enfeite:
   ele diz a quem se respondeu mas nao leva a lugar nenhum, porque eu nao sei
   qual das oito mostrar pra quem esta lendo.

   E tem que ser a copia DA SALA DELE. Apontar pra original seria pior do que
   nao apontar: quem le em alemao nao enxerga a sala de portugues, entao o
   toque levaria a uma mensagem que o Discord vai recusar a mostrar.

   Memoria E banco, nesta ordem. A memoria responde na hora; o banco e' quem
   sobrevive.

   A primeira versao era so' memoria, por um calculo meu que estava errado: eu
   achei caro gravar uma linha por copia e barato perder as antigas. E' o
   contrario. Sao umas 350 linhas por dia, perto de 1 MB por mes com limpeza --
   e o que se perdia era o recurso funcionando nas falas da ultima hora e
   falhando calado no resto. "As vezes funciona" nao ensina a regra a ninguem,
   so' ensina a nao confiar no botao. */
const ondeMoraAFala = new Map(); // id de qualquer copia -> Map(canal -> id da copia de la')
const MAX_FALAS_LEMBRADAS = 6000;

function lembrarFala(familia, canalId, msgId, familiaId, servidorId) {
  if (!canalId || !msgId) return;
  familia.set(canalId, msgId);
  ondeMoraAFala.set(msgId, familia);
  if (familiaId) {
    /* Sem await: a conversa nao pode esperar o banco pra continuar, e perder
       uma linha aqui custa um cabecalho mudo, nao uma fala. */
    sbPost("discord_fala_espelhada",
      { msg_id: msgId, familia_id: familiaId, canal_id: canalId, servidor_id: servidorId || null })
      .catch(() => { /* o cabecalho fica mudo; a fala chegou, que e' o que importa */ });
  }
  /* Map do JavaScript percorre na ordem em que se inseriu, entao a primeira
     chave e' sempre a mais velha: dá um descarte por ordem de chegada sem eu
     precisar guardar hora nenhuma. */
  while (ondeMoraAFala.size > MAX_FALAS_LEMBRADAS) {
    ondeMoraAFala.delete(ondeMoraAFala.keys().next().value);
  }
}

/* Falas seguidas da mesma pessoa entram no MESMO cartao.

   No Discord, tres frases seguidas de alguem aparecem como um bloco so': o
   nome sai uma vez e o resto vem embaixo. O espelho nao fazia isso -- cada
   fala virava um cartao proprio, com moldura e assinatura -- e uma frase
   partida em tres, que e' como as pessoas escrevem no celular, virava tres
   caixas empilhadas. Do lado de la a conversa lia pior do que o original.

   Em vez de segurar a mensagem esperando pra ver se vem outra (o que atrasaria
   TODA fala pra melhorar algumas), a primeira sai na hora e as seguintes sao
   ACRESCENTADAS ao cartao que ja' esta la'.

   Guardo por sala de origem, so' na memoria: se o bot reiniciar, a proxima
   fala comeca cartao novo. E' o unico jeito de errar aqui, e o erro e' o
   comportamento de antes -- diferente do endereco das falas, onde esquecer
   deixava um botao quebrado e por isso foi pro banco. */
const ultimaFalaDaSala = new Map(); // canal de origem -> { autor, quando, cartoes }
const JANELA_DE_GRUPO = 7 * 60 * 1000; // a mesma do Discord
const MAX_SALAS_LEMBRADAS = 2000;
const LIMITE_DO_CARTAO = 3800; // o embed aceita 4096; sobra pra assinatura

/* A decisao de emendar, separada em duas e sem efeito nenhum.

   Puras de proposito: sao sete condicoes, duas delas com consequencia
   invisivel (sino que nao toca, ordem que mente), e a funcao que as usava
   e' a mais quente do produto -- nao da' pra conferir isso subindo bot. */
function emendaNaFalaAnterior(anterior, { autor, agora, respondeAlguem, marcados, arquivos }) {
  return !!anterior
    && anterior.autor === autor
    && agora - anterior.quando < JANELA_DE_GRUPO
    && !respondeAlguem
    && !marcados.length
    && !arquivos.length;
}

/* E, por sala: as sete andam em ritmos diferentes.

   `mesmaLingua` guarda contra o cartao bilingue. Uma fala longa demais pra
   traduzir sai no original; a seguinte, curta, sai traduzida. Emendar as duas
   dava um cartao com metade em ingles e metade em arabe, sem nada dizendo o
   que aconteceu -- foi assim que o defeito do teto apareceu. Trecho que ficou
   no original comeca cartao proprio. */
function emendaNestaSala(velho, ultimoDaSala, juntas, traduzidoAgora = null) {
  if (!velho || !velho.id) return false;
  if (traduzidoAgora !== null && velho.traduzido !== traduzidoAgora) return false;
  return ultimoDaSala === velho.id && juntas.length <= LIMITE_DO_CARTAO;
}

/* Onde a fala respondida mora, quando a memoria ja' esqueceu.

   Duas perguntas ao banco em vez de uma consulta so' com juncao: a primeira
   acha de que familia esta mensagem e', a segunda traz as irmas. Vale porque
   isto so' roda quando alguem RESPONDE algo antigo -- nao em toda fala -- e
   duas consultas simples sao mais faceis de ler daqui a um ano do que uma
   esperta. */
async function procurarFamilia(msgId) {
  try {
    const eu = await sb(`discord_fala_espelhada?msg_id=eq.${encodeURIComponent(msgId)}&select=familia_id`);
    const familiaId = eu?.[0]?.familia_id;
    if (!familiaId) return null;
    const irmas = await sb(
      `discord_fala_espelhada?familia_id=eq.${encodeURIComponent(familiaId)}&select=canal_id,msg_id`) || [];
    if (!irmas.length) return null;
    const familia = new Map(irmas.map((i) => [i.canal_id, i.msg_id]));
    /* Volta pra memoria: quem respondeu uma vez costuma responder de novo. */
    for (const i of irmas) ondeMoraAFala.set(i.msg_id, familia);
    return familia;
  } catch {
    return null; // cabecalho mudo e' melhor do que fala travada
  }
}

/* A quem a mensagem responde.

   Responder e' metade de uma conversa: sem isso, do outro lado chega um "Sim"
   solto e ninguem sabe sim pra que. Webhook nao consegue criar resposta de
   verdade -- o Discord nao deixa --, entao a resposta vira o cabecalho pequeno
   do card, que e' o mesmo lugar onde o Discord desenha a dele.

   So o nome, sem trecho do texto: o trecho viria na lingua de quem escreveu e
   estragaria justamente o card que existe pra deixar tudo na lingua de quem
   le. Traduzir o trecho tambem seria uma chamada a mais por destino, por
   pedaco de mensagem que a pessoa ja leu. */
async function aQuemResponde(msg) {
  if (!msg.reference?.messageId) return null;
  try {
    const alvo = await msg.fetchReference();
    if (!alvo) return null;
    return {
      name: `↩ ${(alvo.member?.displayName || alvo.author?.username || "alguém").slice(0, 60)}`,
      icon_url: alvo.author?.displayAvatarURL?.({ extension: "png", size: 64 }),
    };
  } catch {
    return null; // mensagem respondida foi apagada, ou veio de longe demais
  }
}

/* Os termos da casa, do jeito que a pessoa escreveu: um por linha. */
function termosDoServidor(servidor) {
  return String(servidor?.glossario || "").split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
}

async function espelharMensagem(msg, lista, origem, texto, motor = MOTOR_AUTO, servidorId = null, termos = []) {
  /* Apelido do servidor antes do nome global: e' assim que a pessoa aparece
     pros outros aqui dentro. */
  const nome = (msg.member?.displayName || msg.author.username || "alguem").slice(0, 80);
  const foto = msg.author.displayAvatarURL({ extension: "png", size: 128 });
  const { arquivos, links: anexos } = msg.attachments.size
    ? await baixarAnexos(msg)
    : { arquivos: [], links: [] };
  const respondendo = await aQuemResponde(msg);
  const cor = corDaPessoa(msg.author.id);

  /* E a familia da fala RESPONDIDA, se houver: e' dela que sai o endereco do
     cabecalho, um por sala. Memoria primeiro; se ela ja' esqueceu -- ou se o
     bot reiniciou depois daquela fala --, pergunta ao banco. */
  const respondido = msg.reference?.messageId;
  const familiaAlvo = respondido
    ? (ondeMoraAFala.get(respondido) || await procurarFamilia(respondido))
    : null;
  /* Colchete no apelido quebraria o link e o nome sairia cru, com a URL do
     lado. Apelido e' texto que a pessoa escolhe: mais cedo ou mais tarde
     alguem se chama [TOP]Tiago. */
  const assinatura = nome.replace(/[[\]]/g, "").trim() || "perfil";

  /* Quem foi marcado de verdade LEVA o toque, e leva uma vez so'.

     Antes nao tocava sino pra ninguem, com medo de avisar a mesma pessoa sete
     vezes. So' que cada um enxerga UMA sala -- a da propria lingua --, entao
     as sete copias chegam a sete publicos diferentes e cada marcado e' tocado
     exatamente uma vez. Marcar alguem e nao chamar essa pessoa era esvaziar a
     unica coisa que marcar faz.

     O autor sai da lista: a assinatura do proprio card marca ele, e seria um
     sino por mensagem que ele mesmo escreveu. Cargo e @everyone continuam de
     fora -- um deles acorda o servidor inteiro, e nao e' o espelho que tem que
     decidir isso. */
  const marcados = [...msg.mentions.users.keys()].filter((id) =>
    id !== msg.author.id && new RegExp(`<@!?${id}>`).test(texto || ""));

  /* Da' pra emendar esta fala na anterior?

     As tres primeiras condicoes sao o que o leitor espera de um bloco: mesma
     pessoa, pouco tempo depois, e sem cabecalho proprio (responder a alguem
     abre assunto novo -- o cabecalho tem que ficar em cima da frase dele).

     As duas ultimas nao sao estetica, sao funcionamento:

     - Marcacao exige mensagem NOVA. Editar uma mensagem pra incluir um <@id>
       nao toca sino em ninguem: o Discord so' avisa no envio. Emendar uma fala
       que marca alguem seria entregar a fala e engolir o aviso, calado.

     - Anexo tambem exige mensagem nova. O arquivo vai preso ao envio, e
       emendar deixaria a legenda no cartao de cima e o arquivo sem dono. */
  const anterior = ultimaFalaDaSala.get(msg.channel.id);
  const podeEmendar = emendaNaFalaAnterior(anterior, {
    autor: msg.author.id,
    agora: Date.now(),
    respondeAlguem: !!msg.reference,
    marcados,
    arquivos,
  });

  /* A familia desta fala: onde ela mora em cada sala. Quem responder a ela
     mais tarde, em qualquer sala, chega aqui por qualquer um dos ids.

     Fala emendada entra na familia da fala de cima, e nao abre familia
     propria -- porque ela nao tem cartao proprio: o texto dela esta' DENTRO
     daquele cartao. Responder a ela tem que levar ao mesmo lugar.

     Onde isto fica torto: se numa das salas o cartao de cima ja' nao era o
     ultimo, aquela sala recebe cartao novo e a familia passa a apontar pra
     ele. Um cabecalho que aponta pra fala vizinha, do mesmo autor, segundos
     antes -- e' impreciso e nao e' quebrado, e o preco de nao guardar uma
     familia por sala. */
  const familia = (podeEmendar && anterior.familia) || ondeMoraAFala.get(msg.id) || new Map();
  const familiaId = (podeEmendar && anterior.familiaId) || msg.id;
  lembrarFala(familia, msg.channel.id, msg.id, familiaId, servidorId);

  /* Traduz ANTES de sair enviando, e uma vez por idioma.

     Antes isto vivia dentro do laco de envio, o que fazia duas coisas bobas:
     mascarava o mesmo texto sete vezes (o resultado e' identico pros sete
     destinos) e, pior, esperava cada traducao terminar pra pedir a proxima.
     Com sete idiomas a ultima sala recebia segundos depois da primeira.

     O vantajosoTraduzir e' economia, nao filtro: "ok", "kkkk", um link solto e
     um emoji atravessam iguais em qualquer lingua, e traduzir isso seria
     gastar sete chamadas pra devolver a mesma palavra. */
  /* O teto era 1200, e era baixo demais pra este canal.

     Aviso de alianca nao e' conversa: e' o texto longo do jogo, a lista de
     eventos do dia, a estrategia da batalha. Passando de 1200 caracteres a
     fala saia INTEIRA na lingua de origem, sem nada dizendo por que -- e
     quem le arabe recebia um aviso em ingles achando que o bot tinha
     desistido dele. 3500 e' o mesmo teto que o caminho das replicas ja' usa;
     ter dois numeros pra mesma pergunta era o defeito por tras do defeito.

     E passa a usar traduzirLongo, que corta em pedacos de 1500 nas quebras de
     linha: acima de 1500 uma chamada so' e' recusa na certa em qualquer
     tradutor. */
  const alvos = [...new Set(lista
    .filter((d) => d.canal_id !== origem.canal_id && d.idioma !== origem.idioma)
    .map((d) => d.idioma))];
  const motivo = texto ? porQueNaoTraduzir(texto, TEXTO_MAXIMO, 2) : "curto";
  const vale = !motivo;
  /* Conta em TRADUCOES PERDIDAS, nao em falas: a fala e' uma, mas quem ficou
     sem ela sao as salas. Assim o numero fica na mesma unidade do "traduções"
     do cartao, e da' pra ler um contra o outro. */
  if (motivo) anotarSemTraducao(servidorId, motivo, alvos.length);
  const idiomas = vale ? alvos : [];
  const { marcado, pecas } = vale ? protegerDoTradutor(texto, termos) : { marcado: "", pecas: [] };
  const traduzido = new Map();
  /* Quais idiomas receberam traducao DE VERDADE. Sem isto o cartao nao tem
     como saber que aquele trecho ficou no original, e uma fala traduzida
     emendaria embaixo de uma que nao foi -- meio cartao em cada lingua. */
  const traduzidoMesmo = new Set();

  const traduzirUm = async (idioma) => {
    /* Tradutor fora do ar nao pode calar a conversa: manda o original e deixa
       a pessoa se virar, que e' melhor do que a mensagem sumir. */
    const saiu = await traduzirLongo(marcado, idioma, motor);
    if (saiu) traduzidoMesmo.add(idioma);
    else anotarSemTraducao(servidorId, "recusa");
    traduzido.set(idioma, saiu ? devolverPecas(saiu, pecas) : texto);
  };

  /* Em paralelo so' com chave. Medido: 7 idiomas caem de 2814ms para 850ms na
     DeepL, sem uma recusa.

     Mas paralelo e' privilegio de quem tem contrato. Sete chamadas ao mesmo
     tempo no endereco gratuito do Google viram 429 na certa -- e viraria
     justamente na hora em que a chave falhou e o gratuito e' tudo que restou.
     Piorar o plano B e' o tipo de otimizacao que se paga caro. */
  if (motor.chave || motoresDoDono().length) {
    await Promise.all(idiomas.map((i) => traduzirUm(i).catch(() => {})));
  } else {
    for (const idioma of idiomas) await traduzirUm(idioma).catch(() => {});
  }

  const cartoes = new Map(); // canal de destino -> { id, linhas, cabecalho }

  for (const destino of lista) {
    if (destino.canal_id === origem.canal_id) continue;

    const corpo = traduzido.get(destino.idioma) ?? texto;

    /* A assinatura fica no PE do card, miuda.

       Ela existe porque o perfil que assina a mensagem e' um fantasma: nome e
       foto o webhook copia, mas sao pintura, e tocar neles nao abre nada. O
       <@id> devolve a pessoa de verdade -- toca e abre o perfil, da pra
       mandar mensagem, ver cargo.

       Ela estava na frente da fala, e era a primeira coisa que se lia: um
       bloco azul antes de cada frase, em toda mensagem, empurrando a conversa
       pra direita. No fim e miuda ela some do caminho da leitura e continua
       ali pra quem precisar.

       Vai como NOME em link, nao como <@id>. As duas coisas levam ao mesmo
       perfil, mas a mencao o Discord desenha como um bloco azul do tamanho da
       fala -- pesado demais pra uma assinatura, e sobrava embaixo do texto
       parecendo peca solta. O nome em link fica do tamanho do subtexto e some
       na moldura do card.

       No corpo do embed, e nao no rodape: o rodape e' o canto certo, mas la'
       o Discord nao desenha link nenhum -- o nome apareceria morto, e a
       assinatura existe justamente pra ser tocada. */
    const linhaNova = [corpo, ...anexos].filter(Boolean).join("\n");
    if (!linhaNova && !arquivos.length) continue;

    const cabecalho = respondendo ? {
      ...respondendo,
      /* Endereco da copia que existe NA SALA DE DESTINO. Sem ela
         conhecida, o cabecalho vai sem toque -- melhor mudo do que
         levando a uma sala que a pessoa nao enxerga. */
      ...(familiaAlvo?.get(destino.canal_id)
        ? { url: `https://discord.com/channels/${msg.guild.id}/${destino.canal_id}/${familiaAlvo.get(destino.canal_id)}` }
        : {}),
    } : null;

    /* Emendar so' vale se aquele cartao ainda for a ULTIMA coisa da sala.

       Esta e' a condicao que se decide por sala, e nao pela fala: as sete
       salas andam em ritmos diferentes. Se alguem falou embaixo do cartao
       enquanto isso, editar jogaria a frase nova pra cima da fala dessa
       pessoa -- a conversa passaria a mentir sobre a ordem em que aconteceu.
       Nessa sala sai cartao novo; nas outras, emenda. */
    const velho = podeEmendar ? anterior.cartoes.get(destino.canal_id) : null;
    const salaDestino = msg.guild.channels.cache.get(destino.canal_id);
    const linhas = velho ? [...velho.linhas, linhaNova] : [linhaNova];
    const juntas = linhas.join("\n");
    /* Se esta sala nao pediu traducao (mesmo idioma da origem), o estado e' o
       da fala anterior -- senao toda fala na propria lingua abriria cartao. */
    const traduziuAqui = idiomas.includes(destino.idioma) ? traduzidoMesmo.has(destino.idioma) : null;
    const emendavel = emendaNestaSala(velho, salaDestino?.lastMessageId, juntas, traduziuAqui);

    /* A assinatura fica no PE do card, miuda.

       Ela existe porque o perfil que assina a mensagem e' um fantasma: nome e
       foto o webhook copia, mas sao pintura, e tocar neles nao abre nada. O
       <@id> devolve a pessoa de verdade -- toca e abre o perfil, da pra
       mandar mensagem, ver cargo.

       Ela estava na frente da fala, e era a primeira coisa que se lia: um
       bloco azul antes de cada frase, em toda mensagem, empurrando a conversa
       pra direita. No fim e miuda ela some do caminho da leitura e continua
       ali pra quem precisar.

       Vai como NOME em link, nao como <@id>. As duas coisas levam ao mesmo
       perfil, mas a mencao o Discord desenha como um bloco azul do tamanho da
       fala -- pesado demais pra uma assinatura, e sobrava embaixo do texto
       parecendo peca solta. O nome em link fica do tamanho do subtexto e some
       na moldura do card.

       No corpo do embed, e nao no rodape: o rodape e' o canto certo, mas la'
       o Discord nao desenha link nenhum -- o nome apareceria morto, e a
       assinatura existe justamente pra ser tocada. */
    const selo = seloDeOrigem(origem.idioma, destino.idioma, traduziuAqui === true);
    const montar = (corpoDoCartao, cabecalhoDoCartao) => ({
      color: cor,
      ...(cabecalhoDoCartao ? { author: cabecalhoDoCartao } : {}),
      description: `${corpoDoCartao.slice(0, LIMITE_DO_CARTAO)}` +
        `\n-# [${assinatura}](https://discord.com/users/${msg.author.id})` +
        (selo ? ` · ${selo}` : ""),
    });

    const webhook = clienteDoWebhook(destino.webhook);
    let emendou = false;

    if (emendavel) {
      /* Se a edicao falhar, a fala NAO pode ir junto: o cartao pode ter sido
         apagado por alguem, e emendar em algo que nao existe mais e' o unico
         caminho por onde uma mensagem sumiria calada. Cai pro envio normal. */
      try {
        const cabecalhoQueFica = cabecalho || velho.cabecalho;
        await webhook.editMessage(velho.id, { embeds: [montar(juntas, cabecalhoQueFica)] });
        cartoes.set(destino.canal_id, { id: velho.id, linhas, cabecalho: cabecalhoQueFica, traduzido: velho.traduzido });
        /* A fala nova passa a morar no cartao de cima: quem responder a ela
           tem que cair onde o texto dela esta', que agora e' ali.

           Sem gravar: esta sala ja' foi gravada quando o cartao nasceu, e a
           familia e' a mesma. Repetir seria bater na chave primaria da tabela
           sete vezes por fala emendada -- erro engolido, trabalho jogado
           fora. */
        lembrarFala(familia, destino.canal_id, velho.id, null, servidorId);
        emendou = true;
      } catch (e) {
        console.error("espelho: nao consegui emendar em", destino.idioma, e?.message || e);
      }
    }

    if (emendou) continue;

    try {
      const posta = await webhook.send({
        username: nome,
        avatarURL: foto,
        files: arquivos,
        embeds: [montar(linhaNova, cabecalho)],
        /* Cargo e @everyone continuam barrados: so' quem foi marcado por nome. */
        allowedMentions: { parse: [], users: marcados },
      });
      if (posta?.id) {
        cartoes.set(destino.canal_id, { id: posta.id, linhas: [linhaNova], cabecalho, traduzido: traduziuAqui });
        lembrarFala(familia, destino.canal_id, posta.id, familiaId, servidorId);
      }
    } catch (e) {
      console.error("espelho: nao consegui postar em", destino.idioma, e?.message || e);
    }
  }

  /* O que ficou por ultimo em cada sala, pra proxima fala saber onde emendar.

     O delete antes do set nao e' enfeite: `set` numa chave que ja existe NAO
     muda a posicao dela na ordem do Map, e e' essa ordem que a poda usa pra
     escolher quem sai. Sem ele, a sala mais movimentada do produto seria a
     primeira a ser descartada. */
  ultimaFalaDaSala.delete(msg.channel.id);
  if (cartoes.size) {
    ultimaFalaDaSala.set(msg.channel.id,
      { autor: msg.author.id, quando: Date.now(), cartoes, familia, familiaId });
  }
  /* Map percorre na ordem de insercao, entao a primeira chave e' a sala que
     ficou mais tempo sem falar. */
  while (ultimaFalaDaSala.size > MAX_SALAS_LEMBRADAS) {
    ultimaFalaDaSala.delete(ultimaFalaDaSala.keys().next().value);
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
/* O que separa os planos.

   Isto era uma escada de NUMEROS -- tres idiomas contra vinte, dois canais
   contra dez --, e escada de numero nao vende: o gratis fazia tudo o que o
   pago fazia, um pouco menor, e ninguem paga por "um pouco maior". Pior, o
   gratis podia colar a propria chave de tradutor e furar a cota diaria, que
   era justamente a alavanca do pago.

   Agora a linha e' de FUNCAO, e cabe numa frase: no gratis voce LE na sua
   lingua quando quiser; no pago o servidor inteiro VIVE em todas as linguas.

   Zero idiomas nao quer dizer que o gratis nao traduz -- ele traduz sem
   limite nenhum pela bandeira e pelo botao, que sao puxados e so custam
   quando alguem quis ler. Quer dizer que ele nao CONSTROI: sem categoria por
   idioma, sem replica, sem sala de conversa espelhada.

   Quem ja tem categoria nao perde nada. A regra que monta so' cria idioma
   novo ate' o teto e nunca tira o que existe, entao servidor gratis que ja
   montou continua exatamente como esta -- o teto zero vale dali pra frente.
   O teto de canais fica em 20 e nao em zero por causa disso: com zero, o
   orcamento da passada nasceria vazio e nem a manutencao do que ja existe
   aconteceria. */
const PLANOS = {
  gratis: { idiomas: 0,  canais: 20,  fontes: 0,  cotaDoDono: 8000 },
  pago:   { idiomas: 20, canais: 200, fontes: 10, cotaDoDono: 40000 },
};

/* Quanto das MINHAS chaves cada servidor pode gastar por dia.

   Este era o buraco de verdade, e ele nao derruba o bot -- derruba os
   vizinhos. As chaves do dono sao uma so' bolsa para todos os inquilinos: 3
   milhoes de caracteres por mes, uns 100 mil por dia. O servidor mais
   movimentado que eu tenho gastou 92 mil num unico dia. Sem teto, ele sozinho
   esvazia a bolsa antes do almoco e TODOS os outros passam o resto do mes no
   endereco gratuito do Google, que a esse volume devolve 429. Um cliente
   estraga o produto dos outros sem nunca saber.

   Estourar o teto nao corta a tradução: corta o acesso a MINHA chave. O
   servidor cai pra chave dele, se tiver, e depois pros gratuitos -- e o
   caminho de sair do teto e' o mesmo que o produto ja vende, que e' o cliente
   por a propria chave.

   Os numeros: 40 mil/dia no pago sao 1,2 milhao no mes, e cabem dois clientes
   grandes na bolsa. 8 mil no gratis e' o bastante pra um servidor pequeno
   conversar o dia inteiro, e pouco pra alguem morar de graca na minha conta. */
function cotaDoDonoNoDia(servidor) {
  return PLANOS[planoDe(servidor)]?.cotaDoDono ?? PLANOS.gratis.cotaDoDono;
}

/* O plano que VALE agora, que nem sempre e' o que esta gravado.

   Um teste de sete dias nao pode ser gravado como plano = 'pago': alguem
   teria que lembrar de desfazer quando vencesse, e ninguem lembra. Fica numa
   data, e o vencimento acontece sozinho -- na varredura seguinte o servidor ja
   e' tratado como gratis, sem ninguem rodar nada.

   Uma funcao so' pra isso porque "este servidor e' pago?" aparece em varios
   lugares. Espalhar a regra seria garantir que um deles ficasse pra tras no
   dia em que ela mudasse. */
/* ---------------- ajustes vivos ----------------

   Link de pagamento, beta ligado, servidor do painel: coisas que mudam por
   decisao de negocio, nao por mudanca de codigo. Em variavel de ambiente,
   cada troca dessas exigia um deploy meu -- ou seja, exigia eu estar
   disponivel. No banco, e' um formulario do dono.

   Cache curto porque isto e' lido em toda montagem de painel. Um minuto de
   atraso pra ver um ajuste novo e' aceitavel; ler o banco a cada mensagem
   nao e'. */
let cacheAjustes = { v: null, t: 0 };

async function ajustes() {
  if (cacheAjustes.v && Date.now() - cacheAjustes.t < 60 * 1000) return cacheAjustes.v;
  let v = {};
  try {
    for (const r of (await sb("cyron_ajuste?select=chave,valor")) || []) v[r.chave] = r.valor;
  } catch {
    /* Banco fora do ar nao pode apagar o que ja' estava valendo. */
    if (cacheAjustes.v) return cacheAjustes.v;
  }
  cacheAjustes = { v, t: Date.now() };
  return v;
}

async function porAjuste(chave, valor) {
  await sbPost("cyron_ajuste", { chave, valor, atualizado_em: new Date().toISOString() },
    "resolution=merge-duplicates");
  cacheAjustes = { v: null, t: 0 };
}

/* Variavel de ambiente continua valendo como PADRAO.

   Assim nada quebra na virada: o que ja estava no Fly segue funcionando ate'
   o dono mexer no painel, e o painel passa a mandar a partir daí. */
async function ajuste(chave, doAmbiente) {
  const a = await ajustes();
  return a[chave] ?? doAmbiente ?? "";
}

/* Beta: todo mundo pago enquanto durar.

   Enquanto nao ha publico, cobrar so' serve pra afastar quem ia experimentar.
   Entao tudo fica liberado -- mas com DATA, e dita em voz alta no painel.

   Data, e nao um "por enquanto", por dois motivos. Quem instala precisa saber
   que isso acaba, senao o fim vira sensacao de golpe. E eu preciso de uma
   data pra escrever no painel: "temporario" nao e' informacao, e' desculpa.

   Chamar de BETA, e nao de promocao, resolve tres coisas de uma vez: diz que
   e' temporario sem precisar de data, explica por que ainda aparece defeito, e
   nao promete um preco que ainda nao existe.

   Dois modos, porque o comeco e o fim pedem coisas diferentes:

     CYRON_BETA=1                    em beta, sem data ainda
     CYRON_BETA_ATE=2027-03-31       beta com fim marcado, e o painel conta

   Comecar sem data e' honesto: ninguem sabe quando havera publico, e chutar
   uma data pra depois adiar e' pior que nao ter. Mas "temporario, sem data"
   sozinho soa arbitrario -- entao no lugar da data vai uma promessa que o
   codigo consegue cumprir: quando houver fim, ele aparece aqui com
   antecedencia. Basta preencher a segunda variavel, e o painel de todo mundo
   passa a mostrar o prazo. */
const BETA_DO_AMBIENTE = process.env.CYRON_BETA === "1" || process.env.CYRON_BETA === "sim";
const BETA_ATE_DO_AMBIENTE = process.env.CYRON_BETA_ATE || "";

/* O que vale e' o banco; o ambiente e' so' o padrao de partida.

   planoDe e' chamado em todo lugar e nao pode ser assincrono -- entao os dois
   ficam aqui, atualizados pela volta do relogio, e nao lidos na hora. Um
   minuto de atraso pra um ajuste de negocio e' aceitavel; tornar planoDe
   assincrono contaminaria metade do arquivo. */
let BETA = BETA_DO_AMBIENTE;
let BETA_ATE = BETA_ATE_DO_AMBIENTE;
let LINK_PAGAMENTO_VIVO = "";

async function recarregarAjustes() {
  const a = await ajustes();
  BETA = a.beta != null ? a.beta === "1" || a.beta === "sim" : BETA_DO_AMBIENTE;
  BETA_ATE = a.beta_ate || BETA_ATE_DO_AMBIENTE;
  LINK_PAGAMENTO_VIVO = a.stripe_link || LINK_PAGAMENTO;

  /* Os tradutores de reserva sao lidos aqui, e nao a cada mensagem: enderecos
     mudam de mes em mes, nao de fala em fala. A cada minuto os ajustes voltam
     do banco, entao trocar um endereco morto vale em ate' um minuto -- sem
     publicar o bot. */
  const antes = extrasDoPainel.map((e) => e.nome).join();
  extrasDoPainel = tradutoresDoPainel(a.tradutores_extras);
  const agora = extrasDoPainel.map((e) => e.nome).join();
  if (antes !== agora) {
    console.log(`tradutor: reservas do painel agora sao [${agora || "nenhuma"}]`);
  }

  CHAVE_PRIMEIRO = a.chave_primeiro == null ? true : !["0", "nao", "não"].includes(String(a.chave_primeiro).toLowerCase());

  const antesDono = reservasDoDono.map((r) => r.tipo).join();
  reservasDoDono = lerReservasDoDono(a);
  const agoraDono = reservasDoDono.map((r) => r.tipo).join();
  if (antesDono !== agoraDono) {
    console.log(`tradutor: chaves do dono agora sao [${agoraDono || "nenhuma"}]`);
  }
}

function planoDe(servidor) {
  if (BETA || venceEm(BETA_ATE)) return "pago";       // beta aberto
  if (servidor?.plano === "pago") return "pago";      // liberado na mao, sem prazo
  if (venceEm(servidor?.teste_ate)) return "pago";    // teste de 7 dias
  if (venceEm(servidor?.pago_ate)) return "pago";     // codigo de ativacao
  return "gratis";
}

/* A data, se ela ainda esta no futuro. Nula quando ja venceu -- assim o plano
   cai sozinho no dia seguinte, sem nada precisar rodar pra derrubar. */
function venceEm(quando) {
  const t = quando ? Date.parse(quando) : 0;
  return t && t > Date.now() ? t : 0;
}

/* Idiomas que alguem escolheu e que nao couberam no plano.

   Mora em memoria de proposito: e' um retrato do momento, recalculado a cada
   varredura. Guardar no banco criaria uma segunda verdade pra manter em dia --
   e a primeira coisa que ficaria velha seria justamente esta. */
const esperando = new Map(); // servidorId -> [{ idioma, quantos }]
const semAlcance = new Map(); // servidorId -> [discord_user_id] fora da minha hierarquia
const cargoAcimaDeMim = new Map(); // servidorId -> [nome do cargo] que eu nao alcanço
const cargoTrocado = new Map();    // servidorId -> [nome do cargo velho] que virou lixo

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

  /* Teto zero e teto cheio são duas situações diferentes, e o mesmo texto
     servia mal nas duas.

     Com teto cheio, "não coube" é a verdade: existem salas, e estas pessoas
     ficaram de fora delas. Com teto zero — o plano grátis — não há sala
     nenhuma para caber, e dizer "você está usando 0 de 0 idiomas" descreveria
     um limite estourado onde na verdade há um recurso que o plano não inclui.
     Quem lesse concluiria que o bot quebrou. */
    const semEspelho = !(limite.idiomas > 0);

  await canal.send({
    content: semEspelho
      ? [
        "🌐 **Escolheram o idioma delas aqui.**",
        "",
        quem,
        "",
        "Elas continuam lendo tudo: a **tradução por bandeira** e o **botão de tradução** " +
        "funcionam sem limite no plano grátis, e eu falo com cada uma na língua dela.",
        "",
        "O que o plano grátis não monta são as **salas por idioma** — aquelas em que a " +
        "conversa acontece traduzida para todo mundo ao mesmo tempo. Isso é do plano pago.",
      ].join("\n")
      : [
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
/* Cria o cargo do idioma.

   Sem escolher posicao, de proposito -- e isso e' uma correcao de uma tentativa
   minha que teria PIORADO as coisas.

   Eu tinha passado `position: minhaPosicao - 1` achando que assim o cargo
   nasceria uma casa abaixo do meu. Dois numeros diferentes com o mesmo nome:
   o `position` que o discord.js expoe e' um INDICE calculado (ele ordena os
   cargos e devolve o lugar na fila), enquanto o `position` que a API aceita na
   criacao e' o numero cru do Discord. Num servidor onde todo mundo esta cru=1,
   o indice calculado do meu cargo era 3 -- e mandar criar em cru=2 poria o
   cargo do idioma ACIMA de mim, causando exatamente o defeito que eu queria
   evitar.

   E nao ha o que fazer daqui de qualquer jeito: quando meu cargo esta no fundo
   (cru=1), nao existe posicao abaixo, porque zero e' do @everyone. Quem
   resolve e' uma pessoa arrastando o cargo do bot pra cima -- e quando isso
   faz falta, o painel diz. */
async function criarCargoDeIdioma(guild, nome, motivo) {
  return await guild.roles.create({ name: nome, mentionable: false, reason: motivo });
}

/* Passa as portas do cargo velho pro novo.

   Trocar o cargo no banco nao basta, e essa era a metade que faltava: quem
   abre canal e categoria nao e' a linha do banco, e' a lista de permissoes
   gravada em CADA canal, e ela guarda o ID do cargo. Se eu so' trocasse a
   linha, todo mundo ganharia um cargo novo que nao abre porta nenhuma -- o
   servidor continuaria quebrado, agora com dois cargos.

   Varro os canais pelo que eles dizem, em vez de reconstruir a estrutura pela
   memoria (categoria, sala, replicas): o canal e' quem sabe se tem porta do
   cargo velho, e assim entram tambem os canais que fugiram da regra --
   replica renomeada, canal movido na mao, o que for.

   Mexer em porta de canal nao esbarra na hierarquia (ela vale pra mandar em
   CARGO, nao em canal), entao isto funciona mesmo com o cargo velho acima de
   mim. Apagar a porta velha pode falhar sem estrago: porta a mais nao fecha
   nada. */
async function trocarCargoNasPortas(guild, velhoId, novoId) {
  let trocadas = 0;
  for (const [, canal] of guild.channels.cache) {
    const porta = canal.permissionOverwrites?.cache?.get(velhoId);
    if (!porta) continue;
    try {
      await canal.permissionOverwrites.edit(novoId, {
        ...Object.fromEntries([...porta.allow.toArray().map((p) => [p, true]),
          ...porta.deny.toArray().map((p) => [p, false])]),
      }, { reason: "cargo do idioma trocado por um que eu alcanço" });
      await canal.permissionOverwrites.delete(velhoId, "cargo antigo aposentado").catch(() => {});
      trocadas += 1;
    } catch (e) {
      console.error("cargo: nao consegui passar a porta de", canal.name, e?.message || e);
    }
  }
  return trocadas;
}

async function garantirIdioma(guild, servidorId, idioma) {
  const cargo = await criarCargoDeIdioma(guild, nomeDoIdioma(idioma), "cargo do idioma");

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
      console.error("espelho: passada curta falhou em", guild.name, e?.message || e);
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

async function traduzirLongo(texto, alvo, motor = MOTOR_AUTO) {
  if (texto.length <= PEDACO_TRADUCAO) return await traduzirComCache(texto, alvo, motor);

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
    const t = await traduzirComCache(pedaco, alvo, motor);
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

/* As portas de uma replica.

   A replica era so' leitura: o cargo do idioma via e lia, mas nao falava, e
   quem escrevia ali levava um recado dizendo que aquilo nao ia pra ninguem.
   Isso partia o servidor em dois pela metade errada -- aviso de um lado,
   conversa do outro -- e o comentario do administrador embaixo do proprio
   aviso, que e' a coisa mais natural do mundo, caia no vazio.

   Agora a replica CONVERSA: o que se escreve numa aparece traduzido nas
   irmas, igual as salas de chat. E quem manda no acesso e' o canal de origem,
   copiado ao pe da letra:

   - Origem aberta a todos -> a replica e' do cargo do idioma, e ele fala se
     na origem todo mundo fala. Canal de anuncio onde so' o administrador
     escreve continua assim na replica.

   - Origem fechada -> a replica herda quem enxerga la', cargo por cargo. Isto
     tapa um vazamento que existia calado: #leaders so' dos lideres gerava um
     leaders-pt que TODO falante de portugues via. O aviso de lideranca
     aparecia traduzido para o servidor inteiro.

   O "so' na propria lingua" sai dos cargos dos outros idiomas levando um
   "nao ve" explicito. No Discord negar num cargo vence permitir em outro,
   entao o lider que fala ingles e' barrado no leaders-pt pelo cargo de
   ingles, mesmo tendo o de lider. Sem essa regra, ou ele veria as oito salas,
   ou eu teria que inventar e manter um cargo "lider-pt" por idioma. */
function portasDaReplica(guild, cargoId, fonte, outrosCargos, podeConversar) {
  const V = PermissionFlagsBits.ViewChannel;
  const R = PermissionFlagsBits.ReadMessageHistory;
  const S = PermissionFlagsBits.SendMessages;
  const soLeitura = Object.keys(SO_LEITURA).map((k) => PermissionFlagsBits[k]);
  const todos = guild.roles.everyone;

  /* Um id, uma entrada.

     A lista vai por Mapa e nao por vetor porque as duas metades da conta
     podem falar do mesmo cargo: o cargo de ingles pode ter permissao explicita
     no #leaders (entra permitindo) e ser tambem um "outro idioma" da sala pt
     (entra negando). Em vetor, iam os dois, e o Discord fica com um deles por
     sorte -- o mesmo tropeco que o comentario da criacao ja' avisava. Em Mapa,
     quem chega depois manda, e a ordem aqui poe a negativa por ultimo: entre
     "e' lider" e "nao fala esta lingua", quem decide e' a lingua. */
  /* O `type` vai escrito em toda porta, e nao e' detalhe.

     Sem ele o discord.js tenta adivinhar de quem e' o id procurando na
     memoria dele: primeiro nos cargos, depois nas pessoas. Cargo apagado ou
     pessoa que ele nunca viu -- o que e' o normal, porque eu nao carrego a
     lista de membros -- nao esta em memoria nenhuma, e ai ele nao adivinha:
     levanta erro. O erro derruba a montagem inteira daquele idioma, a cada
     varredura, por causa de UMA porta.

     Isto nunca aconteceu nos sete servidores de hoje porque nenhum deles poe
     permissao de PESSOA em canal. Bastaria um cliente fazer isso. */
  const CARGO = 0, PESSOA = 1;
  const portas = new Map();
  portas.set(todos.id, { id: todos.id, type: CARGO, deny: [V] });
  portas.set(client.user.id, {
    id: client.user.id,
    type: PESSOA,
    allow: [V, S, PermissionFlagsBits.ManageWebhooks],
  });
  const fala = (quem) => podeConversar && !!fonte?.permissionsFor(quem)?.has(S);
  const entrada = (id, tipo, podeFalar) => portas.set(id, podeFalar
    ? { id, type: tipo, allow: [V, R, S] }
    : { id, type: tipo, allow: [V, R], deny: soLeitura });

  if (!fonte || fonte.permissionsFor(todos)?.has(V)) {
    entrada(cargoId, CARGO, fala(todos));
    return [...portas.values()];
  }

  /* Fonte fechada. Pergunto pela permissao EFETIVA, nao pelo que esta escrito
     no overwrite: um cargo costuma ganhar "ver" explicito e herdar "falar" do
     cargo em si. Lendo so' o overwrite, esse cargo entraria como leitor mudo
     numa sala que ele deveria poder usar. */
  for (const [id, porta] of fonte.permissionOverwrites.cache) {
    if (id === todos.id || id === client.user.id) continue;
    const cargo = guild.roles.cache.get(id);
    if (cargo) {
      if (!fonte.permissionsFor(cargo)?.has(V)) continue;
      entrada(id, CARGO, fala(cargo));
    } else {
      /* Permissao de PESSOA, nao de cargo. Aqui vale o que esta escrito na
         porta, e nao a permissao efetiva: a pessoa pode nao estar em cache
         (a lista de membros nao e' garantida) e eu perderia o acesso dela
         calado, que e' pior do que copiar a porta como ela e'. */
      if (!porta.allow.has(V)) continue;
      entrada(id, PESSOA, podeConversar && porta.allow.has(S));
    }
  }

  /* Fonte fechada sem NENHUMA porta explicita: a replica fica fechada tambem.

     Eu tinha posto aqui uma rede que devolvia a sala pro cargo do idioma,
     com o argumento de que canal que ninguem ve e' lixo. O argumento estava
     errado e recriava, em silencio, exatamente o vazamento que este codigo
     existe pra fechar: um canal privado cujo acesso vem de Administrator --
     e nao de porta escrita -- nao tem porta nenhuma pra eu copiar, e a rede
     entregava a copia dele ao servidor inteiro.

     E o "ninguem ve" nem era verdade: Administrator fura tranca de canal, e
     por isso quem enxerga a fonte por ser administrador continua enxergando
     a replica. Fechada, ela espelha a origem; aberta, ela vazava. */

  /* Cargo apagado nao entra: o id ficou no banco, o cargo nao existe mais, e
     mandar uma porta pra ele derruba a montagem inteira do idioma. */
  for (const outro of outrosCargos) {
    if (outro === cargoId || !guild.roles.cache.has(outro)) continue;
    portas.set(outro, { id: outro, type: CARGO, deny: [V] });
  }
  return [...portas.values()];
}

/* As portas ja' sao estas?

   A varredura passa de dez em dez minutos. Reescrever a lista de permissoes
   toda vez seria uma chamada por replica por passada -- em oito idiomas e
   cinco canais, quarenta chamadas de dez em dez minutos pra nao mudar nada,
   e o Discord cobra isso em limite de taxa. */
function mesmasPortas(canal, desejadas) {
  const atual = canal.permissionOverwrites.cache;
  if (atual.size !== desejadas.length) return false;
  for (const p of desejadas) {
    const tem = atual.get(p.id);
    if (!tem) return false;
    const somar = (l) => (l || []).reduce((a, b) => a | b, 0n);
    if (tem.allow.bitfield !== somar(p.allow)) return false;
    if (tem.deny.bitfield !== somar(p.deny)) return false;
  }
  return true;
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

async function garantirReplica(guild, servidorId, sala, categoria, def, posicao, nome,
  fonte, outrosCargos, podeConversar) {
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
    topic: `${def.tipo} — ${nomeDoIdioma(sala.idioma)}. O que se escreve aqui aparece traduzido nos outros idiomas.`,
    /* Quem entra e quem fala vem do canal de origem -- ver portasDaReplica.

       Tudo de um cargo numa entrada so: dois overwrites com o mesmo id fazem
       o Discord ficar com um deles, e qual dos dois vira sorte. */
    permissionOverwrites: portasDaReplica(guild, sala.role_id, fonte, outrosCargos, podeConversar),
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
    /* O canal de origem viaja junto: e' dele que a replica tira quem entra e
       quem fala. Antes so' o rotulo vinha, e por isso a replica de um canal
       fechado nascia aberta ao servidor inteiro. */
    tipos.push({ tipo, canalId, nomeBase: modelos.get(tipo) || tipo });
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
        /* O canal de origem e os cargos dos OUTROS idiomas: os dois lados da
           conta que portasDaReplica faz. Origem sumida vira replica do cargo
           do idioma, que e' o comportamento de sempre. */
        const fonte = def.canalId
          ? await guild.channels.fetch(def.canalId).catch(() => null)
          : null;
        const outrosCargos = [...porIdioma.values()]
          .map((s) => s.role_id).filter((r) => r && r !== sala.role_id);
        const jaExiste = porChave.get(`${sala.idioma}|${def.tipo}`);

        if (!jaExiste) {
          if (!podeCriarCanal(orcamento, guild, limite)) continue;
          await garantirReplica(guild, servidorId, sala, categoria, def, i, nome,
            fonte, outrosCargos, pago);
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
        /* As portas sao refeitas do zero, nao remendadas.

           Aqui so' se trancava o tópico de quem nasceu antes daquela ideia.
           Agora quem decide a replica e' o canal de origem, e origem muda: o
           dono fecha o #leaders na terca e a replica precisa fechar junto, ou
           o vazamento continua com cara de resolvido. Comparar antes de
           escrever mantem isso barato -- ver mesmasPortas. */
        /* O texto segue o PLANO. No gratis a replica continua so' leitura,
           e prometer conversa num canal onde a pessoa nao consegue escrever
           e' pior do que nao dizer nada -- ela tenta, nao vai, e o recado do
           bot diz o contrario do topico logo acima. */
        const assunto = `${def.tipo} — ${nomeDoIdioma(sala.idioma)}. ` + (pago
          ? "O que se escreve aqui aparece traduzido nos outros idiomas."
          : "Cópia traduzida do canal original.");
        if (canal.topic !== assunto && umaVezPorProcesso(`topico:${canal.id}`)) {
          await canal.setTopic(assunto, "réplica deixou de ser só leitura")
            .catch(() => { /* assunto e' capricho */ });
        }

        const querem = portasDaReplica(guild, sala.role_id, fonte, outrosCargos, pago);
        if (sala.role_id && !mesmasPortas(canal, querem)) {
          await canal.permissionOverwrites.set(querem, "portas da réplica seguem o canal de origem");
          console.log(`idioma: #${canal.name} teve as portas refeitas pelo canal de origem`);
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
async function replicarPorIdioma(msg, servidorId, tipo, motor = MOTOR_AUTO) {
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
        ? (await traduzirLongo(titulo, destino.idioma, motor)) || titulo : titulo;
      const c = corpo && vantajosoTraduzir(corpo, TEXTO_MAXIMO, 2)
        ? (await traduzirLongo(corpo, destino.idioma, motor)) || corpo : corpo;

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
              ? (await traduzirLongo(campo.name, destino.idioma, motor)) || campo.name : campo.name,
            value: vantajosoTraduzir(campo.value, TEXTO_MAXIMO, 2)
              ? (await traduzirLongo(campo.value, destino.idioma, motor)) || campo.value : campo.value,
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

/* A varredura do relogio passa pela MESMA porta que os botoes.

   Ela chamava sincronizarUmGuild direto, por fora do controle que impede duas
   montagens ao mesmo tempo no mesmo servidor. Enquanto so' o relogio montava,
   isso nunca doeu: era uma passada de cada vez. Agora nao e' -- o menu de
   canais e o "Remontar agora" disparam montagem na hora, e um clique no minuto
   errado poe as duas pra criar os mesmos canais lado a lado. Foi assim que
   apareceram quatro recursos-en iguais uma vez.

   Passando por aqui, quem chegar depois nao monta em paralelo: marca que
   precisa refazer, e quem esta' montando refaz ao terminar. */
async function sincronizarSalas() {
  for (const [, guild] of client.guilds.cache) {
    await sincronizarAgora(guild);
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
          const cargo = await criarCargoDeIdioma(guild, nomeDoIdioma(sala.idioma), "sala de idioma do chat espelhado");
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

      /* Quem eu nao alcanco.

         O Discord nao deixa um bot mexer nos cargos de quem tem cargo mais
         alto que o dele, nem do dono do servidor -- nunca, nem com
         Administrator, porque isso e' hierarquia e nao permissao. E ao entrar
         num servidor novo o cargo do bot nasce EMBAIXO de todos os outros.

         Isso era so' uma linha de log repetindo de dez em dez minutos. Pra
         quem instalou, e' outra coisa: a pessoa escolhe o idioma, nao ganha o
         cargo, nao ve categoria nenhuma e conclui que o bot nao funciona.
         Entao passa a aparecer no painel, com o nome de quem ficou de fora e
         o que fazer.

         Administrador nao entra na conta: ele enxerga todas as categorias de
         qualquer jeito (Administrator fura tranca de canal), entao pra ele o
         cargo faltando nao esconde nada -- avisar seria barulho sem conserto,
         ja que o dono e' inalcancavel por definicao. */
      const minhaAltura = guild.members.me?.roles?.highest?.position ?? 0;
      /* Uma linha por servidor, uma vez por partida: onde estou na fila de
         cargos e onde estao os cargos de idioma. Foi o que finalmente mostrou
         que o problema era a posicao do cargo, e nao a da pessoa. */
      if (umaVezPorProcesso(`altura:${guild.id}`)) {
        const posicoes = [...cargosDeSala].map((id) => guild.roles.cache.get(id)?.position ?? "?");
        console.log(`cargo: ${guild.name} eu=${minhaAltura} idiomas=[${posicoes.join(",")}]`);
      }
      const foraDoAlcance = [];

      /* Cargo de idioma acima do meu: eu criei e nao alcanço mais.

         Vale pros cargos que ja existiam antes de eu passar a cria-los na
         posicao certa, e pra quando alguem arrasta o CYRON pra baixo depois.
         Daqui nao ha conserto: mover um cargo acima do meu exige alcanca-lo,
         e e' exatamente o que falta. Quem conserta e' uma pessoa, arrastando
         -- entao o painel precisa dizer isso com todas as letras, porque o
         sintoma ("escolhi idioma e nao apareceu canal") nao aponta pra ca. */
      const altosDemais = [...cargosDeSala]
        .map((id) => guild.roles.cache.get(id))
        .filter((c) => c && c.position >= minhaAltura);

      /* Aviso so' quando e' verdade.

         Eu tinha posto tambem um aviso preventivo por "meu cargo esta no fundo
         da lista", achando que servidor novo sempre quebra. Nao quebra: dos
         tres servidores novos, dois funcionam. Com varios cargos empatados na
         mesma posicao crua, quem fica por cima sai de um desempate por id --
         entao e' sorte, e um aviso vermelho gritando num servidor que funciona
         e' pior que aviso nenhum: ensina a ignorar o painel.

         A comparacao abaixo e' a mesma que o Discord faz, e por isso ela acerta
         nos quatro casos que eu tenho pra conferir. */
      /* Cargo fora de alcance: troco por um novo, em vez de so' reclamar.

         Mover um cargo acima do meu exige alcanca-lo -- e' o proprio problema.
         Apagar, idem. Mas CRIAR eu consigo, e cargo que eu crio nasce abaixo
         de mim: e' o que se ve nos servidores que funcionam, onde todos os
         cargos de idioma que eu criei estao abaixo do meu.

         Entao a saida e' abandonar o cargo velho e passar a usar um novo com
         o mesmo nome. Quem tinha o velho continua com ele -- nao consigo tirar
         --, mas ele deixa de mandar em qualquer coisa, porque as portas dos
         canais passam a ser abertas pelo novo.

         O velho fica no servidor como lixo, e o painel avisa. Preferi lixo
         visivel a um servidor que nao funciona: o primeiro se apaga em dois
         cliques, o segundo faz o cliente desistir. */
      for (const velho of altosDemais) {
        const sala = [...porIdioma.entries()].find(([, s]) => s.role_id === velho.id);
        if (!sala) continue;
        const [idioma, linha] = sala;
        try {
          const novo = await criarCargoDeIdioma(guild, velho.name, "cargo antigo ficou fora do meu alcance");
          if (novo.position >= minhaAltura) {
            /* Nasceu alto tambem. Nao ha o que fazer daqui: desfaco pra nao
               deixar dois cargos iguais e inuteis. */
            await novo.delete("nasceu fora do meu alcance também").catch(() => {});
            continue;
          }
          const portas = await trocarCargoNasPortas(guild, velho.id, novo.id);
          await sbPatch(`discord_chat_espelho?id=eq.${encodeURIComponent(linha.id)}`, { role_id: novo.id });
          linha.role_id = novo.id;
          cargosDeSala.delete(velho.id);
          cargosDeSala.add(novo.id);
          console.log(`cargo: ${guild.name} trocou o cargo de ${idioma} por um que eu alcanço ` +
            `(${portas} porta(s) repassada(s))`);
        } catch (e) {
          console.error("cargo: nao consegui trocar o cargo de", idioma, e?.message || e);
        }
      }

      /* O painel so' fica vermelho se AINDA houver cargo fora de alcance
         depois da troca. Sobra de cargo velho e' recado, nao alarme. */
      const aindaAltos = [...cargosDeSala]
        .map((id) => guild.roles.cache.get(id))
        .filter((c) => c && c.position >= minhaAltura);
      if (aindaAltos.length) cargoAcimaDeMim.set(servidorId, { nomes: aindaAltos.map((c) => c.name) });
      else cargoAcimaDeMim.delete(servidorId);

      /* A sobra e' lida do servidor, nao anotada na hora da troca.

         Anotar na hora parecia mais simples e estava errado por dois motivos:
         o recado sumiria na varredura seguinte (que ja nao encontra cargo alto
         nenhum, porque a troca deu certo) e sumiria de novo em cada reinicio.
         Perguntando ao servidor -- cargo acima de mim, com nome de idioma que
         eu uso, que nao e' o cargo em uso -- o recado fica de pe enquanto o
         lixo existir e some sozinho no minuto em que a pessoa apagar. */
      const nomesEmUso = new Set([...porIdioma.keys()].map((i) => nomeDoIdioma(i)));
      const lixoAlto = [...guild.roles.cache.values()]
        .filter((c) => c.position >= minhaAltura && !cargosDeSala.has(c.id) && nomesEmUso.has(c.name))
        .map((c) => c.name);
      if (lixoAlto.length) cargoTrocado.set(servidorId, lixoAlto);
      else cargoTrocado.delete(servidorId);
      for (const [, membro] of membros) {
        if (membro.user.bot) continue;
        const querido = porIdioma.get(porPessoa.get(membro.id))?.role_id || null;

        const precisaMexer = [...cargosDeSala].some((c) =>
          (c === querido) !== membro.roles.cache.has(c));
        if (!precisaMexer) continue;

        if (membro.id === guild.ownerId || membro.roles.highest.position >= minhaAltura) {
          if (!membro.permissions.has(PermissionFlagsBits.Administrator)) foraDoAlcance.push(membro);
          continue;
        }

        for (const cargo of cargosDeSala) {
          const tem = membro.roles.cache.has(cargo);
          if (cargo === querido && !tem) {
            await membro.roles.add(cargo, "idioma escolhido no bot").catch((e) => {
              /* Uma vez por servidor e por pessoa, nao a cada dez minutos.

                 Esta linha vinha repetindo desde ontem, e o painel do servidor
                 ja' diz a mesma coisa de forma permanente e com o conserto
                 junto. Repetida, ela nao informa nada novo -- so' empurra pra
                 fora da tela o erro que eu ainda nao conheco. */
              if (!umaVezPorProcesso(`semcargo:${guild.id}:${membro.id}`)) return;
              /* Com os numeros junto.

                 "Missing Permissions" sozinho nao diz de quem e' a culpa: pode
                 ser o cargo acima de mim, a pessoa acima de mim, ou o dono do
                 servidor -- que e' inalcancavel sempre. Eu passei uma hora
                 supondo qual dos tres era. O log agora responde. */
              const alvo = guild.roles.cache.get(cargo);
              console.error(
                `espelho: nao consegui dar o cargo a ${membro.id}: ${e?.message || e}` +
                ` | eu=${minhaAltura} pessoa=${membro.roles.highest.position}` +
                ` cargo=${alvo?.position ?? "?"} dono=${membro.id === guild.ownerId}`);
            });
          } else if (cargo !== querido && tem) {
            await membro.roles.remove(cargo, "trocou de idioma").catch((e) =>
              console.error("espelho: nao consegui tirar o cargo de", membro.id, e?.message || e));
          }
        }
      }
      if (foraDoAlcance.length) semAlcance.set(servidorId, foraDoAlcance.map((m) => m.id));
      else semAlcance.delete(servidorId);
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

/* A porta de entrada.

   Era um bloco de texto puro com a mesma frase repetida em cinco idiomas, um
   embaixo do outro. No celular isso ocupava a tela inteira e ninguem lia --
   e' a primeira coisa que um membro novo ve do CYRON, e parecia um aviso de
   condominio.

   O que ficou: uma frase, tres colunas dizendo o que muda pra pessoa, e a
   lista de idiomas comprimida numa linha so' no rodape. As cinco traducoes
   viraram cinco palavras.

   O texto do embed nao da' pra traduzir por pessoa -- e' uma mensagem publica,
   uma so' pra todo mundo. Por isso o botao "Como funciona": ele abre a
   explicacao completa em EFEMERO, ja traduzida pro idioma de quem clicou.
   Quem nao entende o idioma da casa e' justamente quem precisa dela. */
const RODAPE_IDIOMAS =
  "🇧🇷 Escolha abaixo · 🇬🇧 Pick below · 🇪🇸 Elige abajo · 🇸🇦 اختر أدناه · 🇨🇳 在下方选择 · 🇮🇩 Pilih di bawah";

function colunasDoConvite() {
  return [
    {
      name: "📥 Você lê no seu idioma",
      value: "Os canais principais ganham uma cópia no seu idioma — e o que você responder nela " +
        "aparece traduzido para os outros.\n_The main channels get a copy in your language — and what " +
        "you reply there shows up translated for everyone else._",
      inline: true,
    },
    {
      name: "📤 Você fala no seu idioma",
      value: "O que você escrever chega traduzido para os outros.\n_What you write reaches everyone translated._",
      inline: true,
    },
    {
      name: "🔎 Uma mensagem solta",
      value: "Segure a mensagem → **Apps** → **Translate**.\n_Hold the message → Apps → Translate._",
      inline: true,
    },
  ];
}

function embedDoConvite(tipo) {
  const portao = tipo === "portao";
  return {
    color: COR,
    thumbnail: { url: client.user.displayAvatarURL({ extension: "png", size: 128 }) },
    title: portao
      ? "🌐 Escolha seu idioma para conversar · Pick your language to chat"
      : "🌐 Escolha seu idioma · Pick your language",
    description: portao
      ? "Este canal virou a entrada. Escolha seu idioma abaixo e você cai na sala da sua língua — " +
        "lá você escreve normalmente, e sua fala chega traduzida para todo mundo.\n" +
        "_This channel is now the entrance. Pick your language and you'll land in your own room._"
      : "Escolha uma vez e o servidor passa a falar com você na sua língua. Dá para trocar quando quiser.\n" +
        "_Pick once and the server starts speaking your language. You can change it anytime._",
    fields: colunasDoConvite(),
    footer: { text: RODAPE_IDIOMAS },
  };
}

function componentesDoConvite() {
  return [
    ...menuIdioma(),
    {
      type: 1,
      components: [
        { type: 2, custom_id: "como-funciona", style: 2, emoji: { name: "❓" },
          label: "Como funciona · How it works" },
      ],
    },
  ];
}

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

/* Fixar deixa um rastro, e o rastro fica na sala.

   O Discord anuncia cada fixada com uma mensagem de sistema no proprio canal
   -- "CYRON fixou uma mensagem". Num canal que existe pra ter UM cartao, esse
   aviso e' a segunda mensagem; e como eu re-fixo sempre que o cartao e'
   reposto, a sala vai juntando avisos com o tempo.

   Duas tentativas porque o aviso costuma chegar DEPOIS do retorno do pin: uma
   olhada imediata muitas vezes nao acha nada, e desistir na primeira deixaria
   o rastro justamente nas vezes em que a rede esta lenta.

   Precisa de "Gerenciar mensagens". Onde nao houver, o aviso fica -- feio, e
   nada mais: nunca vale derrubar o que funciona por causa de enfeite. */
async function apagarAvisoDeFixado(canal, depoisDe) {
  for (const espera of [500, 2000]) {
    await new Promise((r) => setTimeout(r, espera));
    const recentes = await canal.messages
      .fetch({ limit: 5, after: depoisDe }).catch(() => null);
    const aviso = recentes?.find((m) => m.type === MessageType.ChannelPinnedMessage);
    if (aviso) {
      await aviso.delete().catch(() => {});
      return;
    }
  }
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

          const embed = embedDoConvite(porta.tipo);

          if (porta.mensagem_id) {
            const viva = await canal.messages.fetch(porta.mensagem_id).catch(() => null);
            if (viva) {
              /* Ja esta la. Nao posta de novo -- mas ATUALIZA se o desenho
                 mudou, senao os servidores que ja tinham a mensagem antiga
                 ficariam com ela pra sempre, e a unica forma de trocar seria
                 alguem apagar na mao em cada um. */
              const antes = viva.embeds?.[0]?.toJSON?.();
              const mudou = !antes || antes.title !== embed.title ||
                antes.description !== embed.description ||
                (antes.fields || []).length !== embed.fields.length;
              if (mudou) {
                await viva.edit({ content: null, embeds: [embed], components: componentesDoConvite() })
                  .then(() => console.log(`portaria: convite de #${canal.name} atualizado`))
                  .catch((e) => console.error("portaria: nao consegui atualizar:", e?.message || e));
              }
              continue;
            }
          }

          const posta = await canal.send({
            embeds: [embed],
            components: componentesDoConvite(),
            allowedMentions: { parse: [] },
          });
          await posta.pin("convite de idioma").catch((e) =>
            console.error("portaria: nao consegui fixar em", canal.name, e?.message || e));
          await apagarAvisoDeFixado(canal, posta.id);

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

/* O link de pagamento, se existir.

   E' um Payment Link do Stripe -- uma URL, nao uma chave. O bot nao precisa
   de credencial nenhuma do Stripe pra vender: ele so' pendura o id deste
   servidor na URL, e quem confirma o pagamento e' a funcao cyron-pagamento,
   do outro lado. Chave secreta nao passa nem perto do bot.

   Sem a variavel, o botao simplesmente nao aparece e o codigo de ativacao
   continua sendo o caminho. */
const LINK_PAGAMENTO = process.env.STRIPE_LINK || "";
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

  /* A arena.

     Nasce junto porque uma sala vazia que ninguem sabe que existe nao convida
     ninguem -- e o placar e' o convite. Se a tabela do jogo ainda nao estiver
     no banco, o desenho falha sozinho e sobra um canal com uma frase; o bot
     continua traduzindo, que e' o que ele veio fazer. */
  await canalPorNomeOuCria(guild, CANAL_ARENA,
    "Lute pela bandeira que você escolheu. Time pequeno bate mais forte.")
    .then(async (canal) => {
      console.log(`instalar: arena em #${canal.name}`);
      /* O placar vai JUNTO com o canal.
         Criar a sala e deixar para desenhar depois foi o defeito: os botoes
         moram dentro do placar, entao sem ele nao ha' o que clicar, e o jogo
         inteiro fica atras de uma porta que nao existe. */
      await desenharArena(guild, servidor);
    })
    .catch((e) => console.error("instalar: nao consegui criar a arena:", e?.message || e));

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

/* O painel do servidor.

   Antes era um bloco de texto que misturava estado com manual de instrucoes, e
   pra saber quantos idiomas cabiam voce lia um paragrafo. Agora o estado vem
   primeiro, em campos que se leem de relance, e o manual vira uma linha no pe.

   Embed em vez de texto puro por um motivo pratico, nao estetico: campo de
   embed alinha em grade e aceita uma cor. "1 de 2" ao lado de "2 de 3" com uma
   faixa amarela na lateral diz num piscar o que tres paragrafos diriam lendo. */
function corDoPainel(cheio, esperando) {
  if (esperando) return 0xB4534A;   // alguem ficou de fora
  if (cheio) return 0xB08A2E;       // no teto
  return 0x2E8B7A;                  // com folga
}

/* A assinatura do que esta desenhado. Se nao mudou, nao edita.

   Sem isto o cartao era reescrito a cada volta do relogio, pra sempre, mesmo
   sem nada ter mudado -- uma chamada por servidor a cada dez minutos e um
   "(editado)" que nao correspondia a mudanca nenhuma.

   Os botoes entram na assinatura junto com o embed. O estado deles E' estado:
   o botao do tradutor muda de rotulo e de cor. Assinando so' o embed, ligar o
   tradutor nao mudaria nada visivel no cartao ate' alguma outra coisa mudar --
   o painel mentiria exatamente sobre o que a pessoa acabou de fazer.

   As opcoes do menu de canais entram junto. Elas mudam por coisas que o embed
   nao mostra -- um canal criado, um renomeado, um que virou copia minha --, e
   sem elas na assinatura o menu ficaria oferecendo a lista velha ate' que
   alguma outra coisa mudasse. */
function assinaturaDoCartao(embed, componentes) {
  return JSON.stringify([
    embed.description,
    embed.color,
    (embed.fields || []).map((f) => [f.name, f.value]),
    embed.footer?.text,
    (componentes || []).map((linha) => (linha.components || []).map((c) => [
      c.custom_id, c.label, c.style, c.placeholder,
      (c.options || []).map((o) => [o.value, o.label, !!o.default]),
    ])),
  ]);
}

/* Copias que ficaram sem origem.

   Tirar um canal da lista de fontes apaga a linha, mas nao apaga os canais de
   traducao que existiam por causa dele: eles continuam la', vazios, parecendo
   canais de verdade. Com o menu isso deixou de ser raro -- tirar tres fontes
   agora e' um clique, e antes era digitar tres vezes "remover".

   Nao apago sozinho. Sao canais, e canal apagado nao volta; se eu errar a
   conta de qual ficou sem origem, o estrago e' meu e o prejuizo e' de quem
   nem sabia que eu ia mexer. Entao eles aparecem no painel, com um botao ao
   lado -- o clique do administrador e' a confirmacao. */
async function replicasOrfas(guild, servidor) {
  const fontes = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=tipo`) || [];
  const comOrigem = new Set(fontes.map((f) => f.tipo));
  const replicas = await sb(
    `discord_canal_idioma?servidor_id=eq.${servidor.id}&select=id,tipo,canal_id`) || [];
  return replicas.filter((r) => !comOrigem.has(r.tipo) && guild.channels.cache.has(r.canal_id));
}

/* Os controles do painel.

   O menu de canais e' o nativo do Discord (tipo 8): ele lista os canais do
   servidor, filtra enquanto se digita e ja vem com os canais atuais marcados.
   Isso resolve o defeito que sobrou do jeito escrito -- pra saber o que estava
   configurado era preciso LER o cartao e comparar com o que se ia digitar. Aqui
   o que esta marcado e' o que esta valendo, na mesma tela em que se muda.

   Por ser um menu, a semantica e' de CONJUNTO: o que ficar marcado e' a lista
   final. No jeito escrito eu tinha aprendido o contrario -- ali "somar" e' o
   certo, porque quem digita `#recursos` nao esta' vendo os outros dois e nao
   quis apaga-los. Aqui esta': os outros dois aparecem marcados na frente da
   pessoa enquanto ela mexe. Mesma pergunta, respostas diferentes, porque o que
   muda e' se o conjunto atual esta' visivel na hora de responder.

   max_values vai no teto do Discord e nao no teto do plano de proposito. Cortar
   em dois faria o menu simplesmente parar de aceitar cliques no plano gratis,
   sem dizer por que -- o silencio de sempre. Deixando escolher e explicando na
   hora, a pessoa fica sabendo que existe limite, qual e', e o que fazer. */
function componentesDoPainel(servidor, fontes, limite, orfas, opcoes) {
  const escolhidos = new Set(fontes.map((f) => f.canal_id));

  /* O teto do menu e' o teto do plano, e nao o do Discord.

     Eu tinha feito o contrario, com um argumento que na hora pareceu bom:
     cortar em dois faria o menu parar de aceitar cliques sem dizer por que.
     Só que o rotulo do menu ja' diz "ate' 2 no plano gratis" -- entao nao e'
     silencio, e' coerencia: dois cabem, dois marcam, acabou. Deixar escolher
     cinco pra depois recusar os cinco era pedir trabalho pra jogar fora.

     Se o plano caiu e sobrou fonte a mais, o teto sobe pro que ja' esta'
     marcado. Sem isso o Discord recusa a mensagem inteira (marcado nao pode
     passar do maximo) e o painel some -- e a pessoa perde o unico lugar de
     onde poderia tirar as fontes sobrando. */
  const teto = Math.min(25, Math.max(limite.fontes, escolhidos.size));

  const linhas = [];

  if (opcoes.length) {
    linhas.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: "cyron:fontes",
        /* "até 0 no plano gratis" seria uma frase sem sentido: descreve um
           teto onde o certo é dizer que o recurso é de outro plano. */
        placeholder: limite.fontes > 0
          ? `Canais que eu traduzo — até ${limite.fontes} no plano ${planoDe(servidor)}`
          : "Canais que eu traduzo — do plano pago",
        min_values: 0,
        /* Nunca acima do numero de opcoes: o Discord recusa a mensagem
           inteira se o maximo for maior que a lista, e o painel some. */
        max_values: Math.min(teto, opcoes.length),
        options: opcoes.map((c) => ({
          label: `#${c.name}`.slice(0, 100),
          value: c.id,
          default: escolhidos.has(c.id),
        })),
      }],
    });
  }

  linhas.push({
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "cyron:tradutor",
        style: servidor.tradutor_topico ? 3 : 2,
        emoji: { name: "💬" },
        label: servidor.tradutor_topico ? "Tradutor por mensagem: ligado" : "Tradutor por mensagem: desligado",
      },
      /* Havia DOIS botões chamados "Tradutor" nesta mesma linha: este, que
         escolhe o motor, e o liga/desliga por mensagem ao lado. O nome passa a
         ser o mesmo do campo que ele mexe -- botão e campo com nomes
         diferentes obrigam a pessoa a descobrir a ligação sozinha. */
      { type: 2, custom_id: "cyron:motor", style: 2, emoji: { name: "🌐" }, label: "Motor de tradução" },
      /* "Palavras da casa" e "Remontar agora" não dizem o que fazem nem se
         desfazem algo. Verbo e objeto: dá para decidir sem clicar para ver. */
      { type: 2, custom_id: "cyron:palavras", style: 2, emoji: { name: "📖" }, label: "Palavras que eu não traduzo" },
      { type: 2, custom_id: "cyron:remontar", style: 2, emoji: { name: "🔄" }, label: "Reconstruir os canais" },
      { type: 2, custom_id: "cyron:ajuda", style: 2, emoji: { name: "❓" }, label: "Ajuda" },
    ],
  });

  /* Os botoes de situacao vao numa linha propria.

     Estavam junto dos quatro fixos, e num servidor que tinha copia sem origem
     E ainda nao era pago deram SEIS numa linha -- o Discord aceita cinco.
     O painel daquele servidor parou de atualizar, e o log dizia
     "components[1].components: Must be between 1 and 5 in length".

     Pior que o erro: ele so' aparece na combinacao exata dos dois, entao
     testar cada botao sozinho nunca acharia. */
  const situacao = [
    /* Botao de link (estilo 5) nao gera interacao: o Discord abre a URL e
       pronto. Por isso ele nao tem custom_id e nao passa por cliquePainel. */
    /* Nao ofereco assinatura a quem ja tem uma.

       A condicao era plano !== "pago", e plano e' a coluna do liberado-pra-
       sempre -- quem pagou pelo Stripe fica pago pela DATA, nao por ela.
       Resultado: o cliente que acabou de assinar continuava vendo "Assinar o
       plano pago" no painel dele.

       Quem esta no teste de 7 dias CONTINUA vendo o botao, e isso e' o certo:
       o teste e' exatamente o momento de assinar. */
    ...(LINK_PAGAMENTO_VIVO && !servidor.stripe_assinatura && servidor.plano !== "pago"
      ? [{
          type: 2, style: 5, emoji: { name: "💳" }, label: "Assinar o plano pago",
          url: `${LINK_PAGAMENTO_VIVO}${LINK_PAGAMENTO_VIVO.includes("?") ? "&" : "?"}client_reference_id=${encodeURIComponent(servidor.id)}`,
        }]
      : []),
    /* O codigo continua a mao mesmo em quem ja' e' pago por data: resgatar
       soma dias, entao renovar por codigo e' legitimo. So' some pra quem esta
       liberado sem prazo, onde nao ha dia pra somar. */
    ...(servidor.plano === "pago"
      ? []
      : [{ type: 2, custom_id: "cyron:codigo", style: 1, emoji: { name: "🎟️" }, label: "Ativar código" }]),
    ...(orfas?.length
      ? [{
          type: 2, custom_id: "cyron:limpar", style: 4, emoji: { name: "🗑️" },
          label: `Apagar ${orfas.length} ${orfas.length === 1 ? "cópia sem origem" : "cópias sem origem"}`,
        }]
      : []),
  ];
  if (situacao.length) linhas.push({ type: 1, components: situacao });

  /* Linha própria, e não junto dos de situação: aquela linha já chega a três
     botões, e cinco é o teto do Discord -- passar disso não dá erro bonito,
     o painel inteiro deixa de ser postado. Foi assim que ele parou de
     atualizar uma vez. */
  linhas.push({
    type: 1,
    components: [
      { type: 2, custom_id: "cyron:anunciar", style: 2, emoji: { name: "📣" },
        label: "Anunciar a Arena no servidor" },
      /* O cartão fixado é UMA mensagem para o servidor inteiro, então ele é
         português para todos os administradores. Este botão devolve a cópia
         de cada um, na língua dela -- mesma saída do 🌐 da arena, e a única
         possível numa mensagem só. */
      { type: 2, custom_id: "cyron:idioma", style: 2, emoji: { name: "🌐" },
        label: "Na minha língua · My language" },
    ],
  });

  return linhas;
}

/* Canais que ja' tem outro papel no CYRON.

   Uma linha de fonte com gera_replica=false nao produz copia nenhuma: ela
   existe pra EMPRESTAR O NOME. Na [TOP] e' o #general-chat, de quem as salas
   de conversa por idioma tiram general-chat-pt, general-chat-ar e o resto.

   Ele aparecia no menu desmarcado, e era um convite pra clicar. Marcar dava
   erro (a linha dele ja existe, e o canal e' unico na tabela) e, se nao
   desse, seria pior: as copias nasceriam com o mesmo nome das salas de
   conversa, duas coisas diferentes chamadas general-chat-pt no mesmo
   servidor. */
async function fontesDeOutroPapel(servidor) {
  const linhas = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.false&select=canal_id`) || [];
  return new Set(linhas.map((l) => l.canal_id));
}

/* Quais canais podem virar fonte.

   O menu nativo do Discord (tipo 8) lista TODOS os canais e nao aceita lista
   de exclusao. Na pratica ele mostrava geral-pt, geral-en, anuncios-pt e
   anuncios-en junto com os originais -- que sao exatamente as copias que eu
   mesmo criei. Marcar uma delas nunca ia dar certo (eu recusava depois), e
   pra quem olha a lista sao quatro linhas indistinguiveis das de verdade.

   Trocar por um menu de opcoes montado aqui custa o filtro nativo do Discord
   e o limite de 25 opcoes; devolve uma lista em que tudo que aparece e'
   escolhivel. Pra servidor com mais de 25 candidatos, os marcados entram
   primeiro (nenhuma fonte atual pode sumir da lista) e o resto vem por ordem
   do servidor -- e continua dando pra apontar os outros escrevendo `#canal`. */
async function canaisElegiveis(guild, servidor, fontes) {
  const proprios = await canaisMeus(servidor);
  const escolhidos = new Set(fontes.map((f) => f.canal_id));
  const comOutroPapel = await fontesDeOutroPapel(servidor);

  const candidatos = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText && !proprios.has(c.id) && !comOutroPapel.has(c.id))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  if (candidatos.length <= 25) return candidatos;
  const dentro = candidatos.filter((c) => escolhidos.has(c.id));
  const fora = candidatos.filter((c) => !escolhidos.has(c.id));
  return [...dentro, ...fora].slice(0, 25).sort((a, b) => a.rawPosition - b.rawPosition);
}

/* O que o painel diz sobre o tradutor.

   Tres estados, e o terceiro e' o que importa: motor do cliente FALHANDO. Sem
   ele, chave vencida vira "a qualidade piorou" -- eu caio no gratuito, a
   conversa continua, e ninguem liga uma coisa a outra por dias. */
async function comoEstaOMotor(servidor, T = falaFixa()) {
  const tipo = servidor.tradutor_motor;
  if (!tipo || tipo === "auto" || !servidor.tradutor_chave) {
    return await T("⚪ **Google grátis**\ncompartilhado — pode ficar lento em pico");
  }
  /* O nome do motor é marca -- "DeepL", "Azure Translator" -- e marca não se
     traduz. Como marcador, ele nem chega ao tradutor. */
  const nome = MOTORES[tipo]?.nome || tipo;
  const falha = falhaDoMotor.get(servidor.id);
  if (falha) {
    /* A mensagem de erro do provedor vem em inglês e crua, e fica como está:
       ela é o que se cola numa busca ou num chamado de suporte. Traduzir um
       erro literal só o torna impossível de procurar. */
    const quando = quandoFoi(falha.quando, "f");
    return await T("🔴 **{0}** recusou\n`{1}`\n_{2} — estou traduzindo pelo grátis. " +
      "Refaça a chave no botão 🌐._", nome, falha.porque.slice(0, 90), quando);
  }
  return await T("🟢 **{0}**\nchave deste servidor", nome);
}

/* Desenha o painel sem escrever em lugar nenhum.

   Separado do envio porque o mesmo desenho serve a dois destinos: a mensagem
   fixada no canal de configuracao e a copia efemera que o /cyron abre onde a
   pessoa estiver. Fossem duas montagens, elas iam divergir na primeira vez que
   eu mexesse numa e esquecesse da outra. */
/* Traduzir frase com número dentro, sem que cada número vire uma chave nova.

   Este painel é quase todo "1 de 10", "0.5k de 40k", "3 pessoas". Jogar a
   frase JÁ MONTADA no tradutor faria de cada valor uma chave de cache
   diferente -- e o painel é redesenhado a cada varredura, em todo servidor.
   Seria uma tradução paga por varredura, para sempre, e nada quebraria.

   Então o que sobe para o tradutor é o MOLDE, que nunca muda, e os valores
   entram depois: "Canais que eu traduzo — {0} de {1}" é uma chave só, para
   sempre, valha ela 1 de 10 ou 9 de 10.

   O molde resolve também o que eu não posso traduzir de jeito nenhum: nome de
   cargo, menção de canal, nome de servidor. Eles viram {0} -- ficam fora do
   tradutor por construção, em vez de por lembrança.

   E se o tradutor comer um marcador (acontece), a frase volta ao original em
   vez de aparecer com "{0}" na tela ou sem o número. Em português e certa é
   melhor que traduzida e quebrada. */
function porMolde(molde, valores) {
  return String(molde).replace(/\{(\d+)\}/g, (bruto, i) => {
    const v = valores[Number(i)];
    return v === undefined ? bruto : String(v);
  });
}

/* A língua em que a tela está ESCRITA entra como parâmetro, e isso não é
   detalhe.

   O painel é escrito em português; a arena, em inglês. Quem lê na língua de
   origem não precisa de tradução nenhuma -- e quem lê em qualquer outra
   precisa, inclusive o português quando o original é inglês. Com "pt" fixo
   aqui dentro, a arena em inglês chegaria em inglês para o brasileiro, que é
   justamente a maioria de hoje. */
function falaFixa(idioma, motor = MOTOR_AUTO, origem = "pt") {
  const nativo = !idioma || idioma === origem;
  return async (molde, ...valores) => {
    if (nativo || !/\p{L}/u.test(molde)) return porMolde(molde, valores);
    const t = await traduzirComCache(molde, idioma, motor);
    const inteiro = t && valores.every((_, i) => t.includes(`{${i}}`));
    return porMolde(inteiro ? t : molde, valores);
  };
}

/* A primeira linha do painel responde "eu preciso fazer alguma coisa?".

   Sem ela, quem abre o painel precisa ler os doze campos para descobrir que
   nao ha nada a fazer -- e quem abre com pressa fecha sem ver o 🚨 que havia.
   A resposta cabe numa linha, e a linha diz o NUMERO de problemas, porque
   "tem algo errado" nao ajuda a saber se acabou depois de consertar um.

   O plural e' escrito, e nao "problema(s)": a barra e o parenteses sao lixo
   que o leitor de tela tambem le, e este cartao e' o lugar onde a pessoa mais
   precisa entender de primeira. */
async function vereditoDoPainel(problemas, canais, idiomas, T = falaFixa()) {
  const quantos = problemas.length;
  if (quantos) {
    /* Os nomes dos problemas já vêm traduzidos daqui de baixo: eles são os
       próprios `name` dos campos, e o veredito só os repete. */
    const nomes = problemas.map((p) => String(p.name || "").replace(/^\W+\s*/, "")).slice(0, 3);
    const cabeca = quantos === 1
      ? await T("**🔴 Uma coisa precisa de você.**")
      : await T("**🔴 {0} coisas precisam de você.**", quantos);
    const sobra = quantos > nomes.length
      ? "\n• _" + await T("…e mais {0}", quantos - nomes.length) + "_"
      : "";
    return `${cabeca}\n` + nomes.map((n) => `• ${n}`).join("\n") + sobra +
      "\n\n_" + await T("O conserto de cada uma está escrito logo abaixo.") + "_";
  }
  /* Servidor recem-instalado nao esta "tudo funcionando": nada esta quebrado,
     mas nada esta acontecendo tambem, e a pessoa PRECISA fazer o proximo
     passo. Dizer que esta tudo certo ali seria verdade tecnica e mentira
     pratica -- ela fecharia o painel achando que acabou. */
  if (!canais) {
    return await T("**👋 Falta um passo.** Ninguém apontou um canal para eu traduzir ainda — " +
      "escolha no menu aqui embaixo e eu começo.");
  }
  /* Com canal apontado, a linha diz o que esta acontecendo -- e nao "tudo
     certo" sozinho, que nao deixa conferir se e' o que a pessoa esperava.

     Os dois números saem da frase e viram marcador: sem isso, "traduzo 1 canal
     em 6 idiomas" e "traduzo 2 canais em 6 idiomas" seriam duas traduções
     diferentes, e o painel muda de número o tempo todo. O plural continua
     escrito por extenso, e por isso são quatro moldes e não um -- quatro
     chaves fixas custam menos que uma frase que nunca se repete. */
  const canalOuCanais = canais === 1
    ? await T("**{0} canal**", canais)
    : await T("**{0} canais**", canais);
  const idiomaOuIdiomas = idiomas === 1
    ? await T("**{0} idioma**", idiomas)
    : await T("**{0} idiomas**", idiomas);
  return await T("**🟢 Está tudo funcionando.** Eu traduzo {0} em {1}.",
    canalOuCanais, idiomaOuIdiomas);
}

/* ---------------- o recibo da semana ----------------

   O problema que ele resolve nao e' tecnico: quanto melhor eu funciono, mais
   invisivel eu fico. Ninguem agradece o cano de agua. Mas quem PAGA por mim
   decide a renovacao pelo que lembra, e quem usa nao lembra do que nunca viu.

   A cura nao e' XP nem ranking de gente. Eu vivo em servidor de jogo, que ja
   tem nivel e ranking proprios, e premiar quem me USA empurraria as pessoas a
   pedir traducao de que nao precisam -- cada uma custa caractere pago, e eu
   estaria gamificando exatamente a minha conta. O que falta nao e' um jogo: e'
   tornar visivel o que ja acontece.

   Tudo aqui sai de dado que ja existe. Nenhuma contagem por pessoa e' criada,
   nenhuma linha nova e' guardada: as traducoes vem do uso diario que o painel
   ja le, e o numero de leitores vem dos CARGOS, contados no Discord na hora.
   Isso importa porque a pagina de privacidade acabou de prometer o que eu
   guardo -- um recurso novo que exigisse contador por jogador me obrigaria a
   reescrever a promessa uma semana depois de publicá-la. */

const SEMANA = 7 * 24 * 3600 * 1000;

function diaISO(quando) {
  return new Date(quando).toISOString().slice(0, 10);
}

/* Qual semana e' esta, como texto comparavel.

   Serve de marca de "ja mandei" no cyron_ajuste. Segunda-feira e' o comeco:
   recibo que chega no domingo fala de uma semana que ainda nao acabou. */
function semanaDe(quando = Date.now()) {
  const d = new Date(quando);
  const desdeSegunda = (d.getUTCDay() + 6) % 7; // domingo=6, segunda=0
  return diaISO(d.getTime() - desdeSegunda * 24 * 3600 * 1000);
}

/* Quantas traducoes o servidor fez entre duas datas. */
async function traducoesEntre(servidorId, de, ate) {
  const linhas = await sb(
    `cyron_uso_diario?servidor_id=eq.${servidorId}&dia=gte.${de}&dia=lt.${ate}&select=traducoes`,
  ).catch(() => null) || [];
  return linhas.reduce((a, l) => a + Number(l.traducoes || 0), 0);
}

/* Quem le em cada lingua, contado pelos cargos.

   Pelo cargo, e nao pelo banco: discord_idioma_jogador nao sabe de que
   servidor a pessoa e', entao contar por ela daria o total do mundo em todo
   servidor -- um numero errado e lisonjeiro, que e' o pior tipo. O cargo e' a
   verdade daquele servidor, e ele esta no Discord, de graca. */
function leitoresPorIdioma(guild, salas) {
  const fora = [];
  for (const s of salas) {
    const cargo = s.role_id ? guild.roles?.cache?.get(s.role_id) : null;
    if (!cargo) continue;
    fora.push({ idioma: s.idioma, quantos: cargo.members?.size ?? 0 });
  }
  return fora.sort((a, b) => b.quantos - a.quantos);
}

/* Quantas semanas seguidas este servidor traduziu alguma coisa.

   O streak e' DO SERVIDOR, e nao de cada pessoa, e a diferenca e' a coisa
   toda. O streak do Duolingo funciona porque a acao e' sua: voce pratica,
   voce mantem. Aqui a graca e' que ninguem faz nada -- um streak pessoal
   seria "dias em que por acaso apareceu um estrangeiro", que se perde sem
   culpa e se defende forcando traducao inutil. Coletivo, ninguem falha
   sozinho e ninguem consegue farmar. */
function semanasSeguidas(porSemana) {
  let n = 0;
  for (const q of porSemana) {
    if (!q) break;
    n++;
  }
  return n;
}

async function reciboDaSemana(guild, servidor) {
  const fimISO = semanaDe();                       // segunda desta semana
  const fim = new Date(`${fimISO}T00:00:00Z`).getTime();
  const inicioISO = diaISO(fim - SEMANA);          // segunda passada

  const [agora, antes] = await Promise.all([
    traducoesEntre(servidor.id, inicioISO, fimISO),
    traducoesEntre(servidor.id, diaISO(fim - 2 * SEMANA), inicioISO),
  ]);

  /* Semana sem nenhuma traducao nao vira cartao. Um recibo dizendo "zero"
     toda segunda e' o bot lembrando que nao serviu pra nada -- o contrario
     exato do que ele existe pra fazer. */
  if (!agora) return null;

  const salas = await sb(
    `discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma,role_id`).catch(() => null) || [];
  const leitores = leitoresPorIdioma(guild, salas);
  const gente = leitores.reduce((a, l) => a + l.quantos, 0);

  /* As oito ultimas semanas, pra contar o streak sem guardar historico. */
  const oito = [];
  for (let i = 0; i < 8; i++) {
    const a = diaISO(fim - (i + 1) * SEMANA);
    const b = diaISO(fim - i * SEMANA);
    oito.push(await traducoesEntre(servidor.id, a, b));
  }
  const seguidas = semanasSeguidas(oito);

  /* Bilingue por CONSTRUCAO, e nao traduzido.

     Traduzir este cartao gastaria caractere pago -- e um recurso que existe
     pra fazer lembrarem de mim nao pode se pagar com a conta que eu quero
     baixar. Mas so' portugues seria repetir, no dono, o defeito que acabei de
     consertar na NYX: cartao numa lingua que ele nao le.

     A saida e' escrever pouco. O cartao e' quase todo numero e bandeira, que
     nao tem lingua, e as duas frases que precisam de palavras vem nas duas.
     Custa zero e serve a todo mundo. */
  const quantos = leitores.length || salas.length;

  /* Numero SEM separador de milhar. "1.240" em portugues e' mil duzentos e
     quarenta; para quem le em ingles e' um virgula dois. Num cartao que as
     duas pessoas leem, o ponto mente para uma delas -- e sem ele nao mente
     para ninguem. */
  const linhas = [
    `**${agora} ${agora === 1 ? "mensagem atravessou" : "mensagens atravessaram"}** ` +
    `**${quantos} ${quantos === 1 ? "idioma" : "idiomas"}** esta semana.`,
    `_${agora} ${agora === 1 ? "message crossed" : "messages crossed"} ` +
    `${quantos} ${quantos === 1 ? "language" : "languages"} this week._`,
  ];

  /* A comparacao so' aparece quando ha' com o que comparar: "↑ 100%" na
     primeira semana e' um numero inventado a partir de zero. */
  if (antes > 0) {
    const variacao = Math.round(((agora - antes) / antes) * 100);
    if (variacao !== 0) {
      const sinal = `${variacao > 0 ? "+" : ""}${variacao}%`;
      linhas.push(`${variacao > 0 ? "📈" : "📉"} ${sinal} · semana passada / _last week_`);
    }
  }

  if (seguidas >= 2) {
    linhas.push(`🔥 **${seguidas} semanas seguidas** sem ninguém ficar sem entender · ` +
      `_${seguidas} weeks in a row with nobody left out_`);
  }

  const campos = [];
  if (leitores.length) {
    campos.push({
      name: `🗣️ Quem lê em cada língua · Who reads what — ${gente}`,
      /* Sem bandeira na frente: nomeDoIdioma JA' devolve "🇧🇷 Português".
         Acrescentar outra dava "🇧🇷 🇧🇷 Português" -- e nenhum teste pegaria,
         porque o texto continua certo e o limite continua cabendo. Foi a
         prévia do cartão que mostrou. */
      value: leitores.slice(0, 10)
        .map((l) => `${nomeDoIdioma(l.idioma)} — **${l.quantos}**`)
        .join("\n"),
    });
  }

  return {
    color: COR,
    title: "📊 A semana de vocês, em línguas · Your week in languages",
    description: linhas.join("\n"),
    fields: campos,
    /* O fecho e' o que faz a conta na cabeca de quem le: sem tradutor, essa
       gente teria lido a propria lingua e mais nada. E' a unica frase do
       cartao que precisa mesmo de palavras, entao vem nas duas linguas. */
    footer: {
      text: gente
        ? `Sem tradução, cada uma dessas ${gente} pessoas teria lido só a própria língua.\n` +
          `Without translation, each of those ${gente} would have read only their own.`
        : "Cada mensagem chegou legível para quem não fala a língua de quem escreveu.\n" +
          "Each message arrived readable for people who don't speak the writer's language.",
    },
  };
}

/* Um botão só, e o destino já é conhecido: o canal-fonte é o canal que o
   próprio servidor apontou para mim. Pedir para escolher o canal seria uma
   tela a mais entre a vontade de mostrar e o mostrar. */
/* ---------------- a Arena das Línguas ----------------

   Arena porque o Kingshot tem Arena: quem joga ali ja sabe o que a palavra
   quer dizer, e familiaridade vale mais que originalidade num botao que a
   pessoa ve pela primeira vez.

   O time e' o IDIOMA. Voce luta pela bandeira que escolheu, e e' isso que faz
   este jogo ser sobre o CYRON em vez de ser um clicker pregado nele.

   Tres decisoes que seguram o custo:

   - Zero traducao. Botao e' emoji, placar e' bandeira e numero. Nada aqui tem
     lingua, entao nada aqui passa pelo tradutor.
   - Cinco ataques por dia, por pessoa. O teto e' rigido: nao existe caminho
     pra alguem gastar mais clicando mais, que era o defeito da versao em que
     clique dava ouro sem limite.
   - Resposta efemera. So' quem clicou ve, e some sozinha. A sala fica com UMA
     mensagem fixada -- o placar -- editada no lugar. Nada a apagar, nada
     acumulando. */

const CANAL_ARENA = "⚔️-arena";
const ARENA_ATAQUES_DIA = 5;

/* Evoluir fica mais caro a cada nivel.

   Custo fixo faria o ouro virar so' uma espera: quem clica mais, sobe mais,
   pra sempre. Crescendo, o poder alto exige muitas vitorias -- e vitoria
   depende do time, nao do dedo. */
function custoDeEvoluir(poder) {
  /* Math.max(1, NaN) e' NaN, e nao 1 -- entao poder invalido devolvia custo
     NaN. Como `ouro >= NaN` e' sempre falso, a evolucao travaria em silencio
     para essa pessoa, sem erro e sem log. Number.isFinite antes do maximo. */
  const n = Math.trunc(Number(poder));
  return 10 * (Number.isFinite(n) && n > 1 ? n : 1);
}

/* Time pequeno bate mais forte, e esta e' a peca que amarra o jogo ao produto.

   Sem isto, o idioma com mais gente ganha sempre e os outros desistem na
   primeira semana. Com isto, os quatro alemaes conseguem ganhar dos quatorze
   brasileiros -- e a conversa que aparece no servidor vira "escolhe alemao,
   a gente ta precisando", que e' exatamente o passo que o CYRON precisa que
   aconteca. O jogo empurra a escolha de idioma em vez de queimar orcamento.

   O teto e' 2x: mais que isso, um time de uma pessoa so' venceria sempre e a
   vantagem viraria o novo defeito. */
function handicapDoTime(gente, maiorTime) {
  const meu = Math.max(1, Number(gente) || 1);
  const maior = Math.max(meu, Number(maiorTime) || 1);
  return 1 + (maior - meu) / maior;
}

/* Chance proporcional, e nunca 0% nem 100%.

   Certeza dos dois lados mata o jogo: o forte para de ter graca e o fraco para
   de tentar. Entre 10% e 90%, todo ataque vale a pena e nenhum e' garantido. */
function chanceDeVitoria(minha, alvo) {
  const a = Math.max(0, Number(minha) || 0);
  const b = Math.max(0, Number(alvo) || 0);
  if (a + b <= 0) return 0.5;
  return Math.min(0.9, Math.max(0.1, a / (a + b)));
}

/* Junta os jogadores por idioma e calcula a forca de cada time. */
/* A arena e' MUNDIAL: o time e' o idioma no mundo inteiro, e nao no servidor.

   Por servidor ela nascia morta. Com um servidor so', "so' a sua lingua entrou
   na arena" e' a resposta pra sempre -- um recurso esperando clientes que
   ainda nao existem. Mundial, ela funciona hoje, com tres pessoas online.

   E o tema ja e' mundial: portugues contra arabe e' ideia de escala
   planetaria, nao de sala. De quebra vira conversa que sai do servidor --
   "a gente ta em terceiro no mundo" faz outra alianca perguntar que bot e'
   esse, que e' distribuicao de graca.

   `linhas` ja vem somado por idioma pelo banco (cyron_arena_placar). Somar em
   JavaScript funcionava por servidor; mundial, seria ler todas as linhas do
   mundo a cada desenho -- e o placar e' redesenhado a cada varredura, em todo
   servidor.

   `traduzidas` e' o numero REAL de traducoes da semana, por idioma. Ele existe
   pra que o placar nunca nasca vazio SEM inventar jogador nenhum: no dia um ja
   ha times, numeros e ordem, todos verdadeiros. E o efeito e' o oposto do
   jogador falso -- em vez de esconder que o produto e' novo, mostra que ele
   esta funcionando. */
function timesDaArena(linhas, leitores, traduzidas) {
  const quantos = new Map((leitores || []).map((l) => [l.idioma, l.quantos]));
  const traduz = new Map(Object.entries(traduzidas || {}));

  /* Idioma que ainda nao tem jogador, mas TEM traducao, entra no placar
     mesmo assim -- e' dele que vem a vida do primeiro dia. */
  const idiomas = new Set([
    ...(linhas || []).map((l) => l.idioma),
    ...traduz.keys(),
  ]);

  const maior = Math.max(1, ...[...idiomas].map((i) => quantos.get(i) || 1));
  const porIdioma = new Map((linhas || []).map((l) => [l.idioma, l]));

  const times = [...idiomas].map((idioma) => {
    const l = porIdioma.get(idioma) || {};
    const gente = quantos.get(idioma) || 1;
    const handicap = handicapDoTime(gente, maior);
    const poder = Number(l.poder || 0);
    return {
      idioma,
      poder,
      vitorias: Number(l.vitorias || 0),
      jogadores: Number(l.jogadores || 0),
      meuServidor: Number(l.meu_servidor || 0),
      traducoes: Number(traduz.get(idioma) || 0),
      gente,
      handicap,
      forca: Math.round(poder * handicap),
    };
  });

  /* Vitorias mandam; empate desempata pela forca, e depois pelas traducoes --
     que e' o unico criterio que existe antes de alguem atacar. */
  return times.sort((a, b) =>
    b.vitorias - a.vitorias || b.forca - a.forca || b.traducoes - a.traducoes);
}

const MEDALHA = ["🥇", "🥈", "🥉"];

/* Duas setas quando o handicap e' grande: e' o convite pra entrar no time
   pequeno, e ele precisa ser visivel sem explicacao. */
function setaDoTime(t) {
  return t.handicap >= 1.5 ? " ▲▲" : t.handicap >= 1.2 ? " ▲" : "";
}

/* As linhas do placar sao as MESMAS em qualquer idioma, e isso e' decisao de
   produto, nao economia de token.

   Nome de lingua se escreve na propria lingua. O alemao procura "Deutsch" na
   lista, nao "Alemão" nem "الألمانية" -- traduzir a tabela de idiomas piora
   justamente para quem ela existe. Com o nome no original e o resto em simbolo
   (🏆 vitorias, ⚔️ forca, 💬 traducoes), a linha nao tem uma letra que precise
   virar outra coisa: ela ja nasce legivel para as vinte linguas.

   E de quebra o placar fixado -- que e' UMA mensagem para o servidor inteiro e
   por isso nunca podera' falar a lingua de cada leitor -- para de ser um texto
   em portugues no meio de uma sala multilingue. O que sobra em palavra e' o
   cabecalho e a legenda, e essas cabem no rodape, onde da' pra traduzir de
   graca porque sao fixas.

   O simbolo pede legenda; ela vai no rodape de quem chamar esta funcao. */
function linhasDoPlacar(times, destaque = "") {
  return times.slice(0, 12).map((t, i) => {
    /* Antes de alguem atacar, o que ha' para mostrar sao as traducoes -- e elas
       sao verdadeiras. Depois, a forca manda e a traducao vira coadjuvante. */
    const direita = t.poder ? `⚔️ ${t.forca}` : `💬 ${t.traducoes}`;
    const linha = `${nomeNaPropriaLingua(t.idioma)} — 🏆 ${t.vitorias} · ${direita}${setaDoTime(t)}`;
    /* O time de quem esta lendo em negrito: numa lista de doze bandeiras, achar
       a sua e' a primeira coisa que a pessoa tenta fazer. */
    return `${MEDALHA[i] || "　"} ${t.idioma === destaque ? `**${linha}**` : linha}`;
  }).join("\n");
}

/* O cartão fixado passa a ser escrito só em INGLÊS, e isso é o contrário do
   que eu tinha feito.

   Bilíngue por construção parecia a saída honesta para uma mensagem que é uma
   só para o servidor inteiro. Na tela, virou outra coisa: título dobrado,
   temporada dobrada, "seu servidor" dobrado, a legenda dos símbolos duas
   vezes, o convite do 🌐 duas vezes, e os quatro botões com dois rótulos cada.
   Metade do cartão era a mesma frase escrita de novo, e o que se lê primeiro
   é o tamanho.

   Uma língua só, e o 🌐 do lado, cabe numa tela e serve mais gente: em
   bilíngue eu atendia dois idiomas dos vinte; pelo botão, todos. Inglês como
   base porque é a língua que mais gente lê em servidor de jogo -- e porque a
   tabela já é bandeira e número, que não têm língua nenhuma. */
/* "hit harder" saiu, e o motivo é uma foto: em português o tradutor devolveu
   "times menores SOFREM mais" -- o oposto exato da regra que sustenta o jogo.

   Idioma é onde tradutor automático erra, e erra com cara de certo: a frase
   volta fluente e afirmando o contrário. Quem lesse isso concluiria que
   escolher o time pequeno é ruim, que é a decisão que o CYRON precisa que a
   pessoa tome ao contrário.

   "are stronger" é literal, e não tem como inverter. Vale para todo texto
   fixo daqui: quem escreve o original escreve para ser traduzido por máquina,
   não para soar bem em inglês.

   Trocar o texto também conserta o que já está no cache: a chave é o texto de
   origem, então a frase nova nasce sem tradução guardada e a errada fica para
   trás sozinha. */
const LEGENDA_ARENA = "🏆 wins · ⚔️ power · 💬 translations · ▲ smaller teams are stronger";
const ARENA_VAZIA = "The arena opens when the first message gets translated.";

function placarDaArena(times, temporada, servidores = 0) {
  const linhas = times.length ? linhasDoPlacar(times) : `_${ARENA_VAZIA}_`;

  const meu = times.reduce((a, t) => a + (t.meuServidor || 0), 0);
  const partes = [
    /* Dia e mês, e não a data do banco: "2026-08-31" é como eu guardo a
       semana, não como alguém a lê. */
    `**Season ${String(temporada).slice(8, 10)}/${String(temporada).slice(5, 7)}**` +
    " · worldwide · ends Sunday",
    "",
    linhas,
  ];

  /* A contribuicao do servidor so' aparece quando ha' o que contribuir.
     "0 vitorias" toda semana e' o bot lembrando que ninguem jogou. */
  if (meu > 0) {
    partes.push("", `🏠 **Your server:** ${meu} ${meu === 1 ? "win" : "wins"}`);
  }

  /* E o numero de servidores so' a partir de cinco. Hoje seria "1 de 1", que
     anuncia fraqueza justamente pro visitante que a gente quer impressionar --
     e nome de servidor nunca aparece, porque ranking com nome de cliente
     entrega a lista de clientes pra qualquer um que entre aqui. */
  if (servidores >= 5) {
    partes.push(`_${servidores} servers in the arena_`);
  }

  return {
    color: COR,
    title: "⚔️ Language Arena",
    description: partes.join("\n"),
    footer: { text: `${LEGENDA_ARENA}\n🌐 read this in your language` },
  };
}

/* Os botoes vivem no PLACAR, que e' uma mensagem so' para o servidor inteiro
   -- entao eles nao podem ser por pessoa, como as respostas sao. Bilingues por
   construcao, como o resto do cartao: o rotulo cabe nos 80 caracteres e nao
   custa traducao nenhuma. */
function botoesDaArena() {
  return [{
    type: 1,
    components: [
      /* Um rótulo só, em inglês. "Atacar · Attack" em quatro botões era metade
         da altura do cartão gasta repetindo a mesma palavra -- e o emoji já
         diz o que o botão faz para quem não lê nenhuma das duas. */
      { type: 2, custom_id: "arena:atacar", style: 1, emoji: { name: "⚔️" }, label: "Attack" },
      { type: 2, custom_id: "arena:evoluir", style: 2, emoji: { name: "⬆️" }, label: "Upgrade" },
      { type: 2, custom_id: "arena:perfil", style: 2, emoji: { name: "🏆" }, label: "My profile" },
      /* O botao que resolve o placar em portugues.
         A mensagem fixada e' uma so' e nunca vai falar cinco linguas ao mesmo
         tempo. Isto da' a cada pessoa a copia dela, efemera e no idioma dela --
         e e' o mesmo desenho do /arena, pra quem esta olhando o cartao e nao
         quer sair dele pra digitar um comando. */
      { type: 2, custom_id: "arena:placar", style: 2, emoji: { name: "🌐" }, label: "My language" },
    ],
  }];
}

/* Le a arena inteira de um servidor. Tabela ausente devolve lista vazia, e a
   arena simplesmente nao aparece -- o bot continua traduzindo. */
async function jogadoresDaArena(servidorId) {
  return await sb(
    `cyron_arena?servidor_id=eq.${servidorId}&select=discord_user_id,idioma,poder,ouro,vitorias,ataques_dia,dia,temporada`,
  ).catch(() => null) || [];
}

async function estadoDaArena(guild, servidor) {
  const temporada = semanaDe();
  const desde = new Date(Date.now() - SEMANA).toISOString();

  /* Tudo de uma vez, e tudo tolerante: funcao que ainda nao exista no banco
     devolve vazio e o placar perde uma coluna, em vez de a arena inteira
     sumir. O bot continua traduzindo de qualquer jeito. */
  const [linhas, salas, traducoes, servidores] = await Promise.all([
    rpc("cyron_arena_placar", { p_temporada: temporada, p_servidor: servidor.id }).catch(() => null),
    sb(`discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma,role_id`).catch(() => null),
    rpc("cyron_traducoes_por_idioma", { p_desde: desde }).catch(() => null),
    rpc("cyron_arena_servidores", {}).catch(() => null),
  ]);

  const porIdioma = Object.fromEntries(
    (traducoes || []).map((t) => [t.idioma, Number(t.quantas || 0)]));

  return {
    temporada,
    servidores: Number(servidores) || 0,
    times: timesDaArena(linhas || [], leitoresPorIdioma(guild, salas || []), porIdioma),
  };
}

/* O placar e' UMA mensagem fixada, editada no lugar.

   Uma por rodada encheria a sala com o historico inteiro de placares mortos,
   e o vivo perdido no meio -- mesmo motivo do cartao do painel. */
async function desenharArena(guild, servidor) {
  const canal = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === CANAL_ARENA);
  if (!canal) return;

  const { times, temporada, servidores } = await estadoDaArena(guild, servidor);
  const carga = {
    embeds: [placarDaArena(times, temporada, servidores)],
    components: botoesDaArena(),
  };

  /* O ID e' o registro; o pin e' enfeite.

     Eu achava o cartao pelos FIXADOS, e isso encheu a sala de placares. O
     fetchPinned da discord.js 14.27 fala com a rota NOVA de pins e trata a
     resposta como lista -- mas ela vem em { items: [...] }, que nao e'
     iteravel. A chamada estoura SEMPRE, o catch engolia, o bot concluia que
     nao havia placar, e postava outro a cada varredura.

     O painel nunca teve esse problema porque guarda msg_config. Mesma
     solucao, e sem migracao: o cyron_ajuste ja e' chave/valor. */
  const chave = `arena_msg:${servidor.id}`;
  const guardado = (await ajustes())[chave];
  if (guardado) {
    const antiga = await canal.messages.fetch(guardado).catch(() => null);
    if (antiga) {
      await antiga.edit(carga).catch((e) =>
        console.error("arena: nao consegui editar o placar:", e?.message || e));
      return;
    }
  }

  /* Antes de postar, recolhe o que o defeito anterior deixou na sala. */
  await limparPlacaresVelhos(canal);

  const nova = await canal.send(carga).catch((e) => {
    console.error("arena: nao consegui postar o placar:", e?.message || e);
    return null;
  });
  if (!nova) return;

  await porAjuste(chave, nova.id);
  await nova.pin("placar da arena").catch(() => {});
  await apagarAvisoDeFixado(canal, nova.id);
}

/* Recolhe placares antigos meus da sala.

   So' os MEUS, e so' os que sao placar: o titulo e' a assinatura. Apagar por
   autor sozinho levaria junto qualquer outra coisa que eu tivesse postado
   ali -- a sala e' minha, mas as mensagens nao sao todas. */
async function limparPlacaresVelhos(canal) {
  const recentes = await canal.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recentes) return;
  const meus = [...recentes.values()].filter((m) =>
    m.author?.id === client.user.id &&
    String(m.embeds?.[0]?.title || "").startsWith("⚔️ Arena das Línguas"));
  for (const m of meus) await m.delete().catch(() => {});
  if (meus.length) console.log(`arena: recolhi ${meus.length} placar(es) antigo(s)`);
}

/* Responder na lingua de quem clicou, sem que isso vire conta.

   O jogo de um tradutor falando so' portugues era a piada contra mim mesmo. A
   NYX e' alema; o placar diz "Vitoria!" e ela nao le.

   Da' pra traduzir de graca porque os ROTULOS sao fixos: "Poder", "Ouro",
   "Chance", "Ataques hoje". Vinte idiomas vezes uma duzia de palavras e' uma
   traducao unica, cacheada pra sempre -- diferente da mensagem de gente, que
   nunca se repete.

   O que muda -- os NUMEROS -- fica fora do texto traduzido, em campos
   separados. Se numero entrasse na frase, cada valor seria uma chave de cache
   nova e o jogo passaria a custar por clique. E' por isso que aqui e' rotulo
   num lado e numero no outro, e nao uma linha so' bonita.

   O PLACAR nao entra nisso, e nao tem jeito: ele e' UMA mensagem para o
   servidor inteiro. Nao existe versao por pessoa de uma mensagem so'. Ele
   segue bilingue por construcao, como o recibo. */
/* Os botões vão em TODA resposta, e não só no placar.

   Sem eles, atacar uma vez deixava a pessoa numa tela sem saída: ela tinha
   que rolar de volta até o cartão fixado para atacar de novo. Com eles, a
   resposta é o próprio jogo -- e, editada no lugar, é uma tela só que muda,
   em vez de uma pilha. */
async function respostaDaArena(inter, idioma, embed) {
  return inter.editReply({
    embeds: [{ color: COR, ...(await traduzirEmbed(embed, idioma, MOTOR_AUTO)) }],
    components: botoesDaArena(),
  });
}

/* O placar de cada um, na lingua de cada um -- e sem conta no fim do mes.

   O fixado e' uma mensagem so' para o servidor inteiro: nao existe versao por
   leitor de uma mensagem unica, e por isso ele e' bilingue por construcao. Este
   aqui e' outra coisa -- ele nasce no clique de UMA pessoa, efemero, e some
   sozinho. Podendo ser por pessoa, deve ser.

   O truque que faz isso caber no orcamento e' a separacao: o que VARIA (numero,
   bandeira, nome de lingua) fica fora do tradutor, e o que vai pro tradutor e'
   fixo -- titulo, rotulo de campo, legenda. Sao umas quinze frases; vinte
   idiomas depois, trezentas linhas de cache, uma vez, para sempre. A partir da
   segunda pessoa que apertar o botao naquele idioma, o placar traduzido nao
   custa uma traducao sequer.

   O contrario -- jogar a tabela inteira no tradutor -- pareceria mais simples e
   seria o defeito: cada vitoria nova muda o texto, cada texto novo e' uma chave
   de cache que nunca mais se repete, e um placar que muda o dia todo viraria
   traducao paga por clique, sem teto. */
async function placarPessoal(estado, idioma, eu, escolheu = true) {
  /* Origem INGLÊS, e é a linha que mais importa aqui.

     O cartão fixado passou a ser escrito em inglês. Se este molde continuasse
     saindo pelo traduzirEmbed, que pula o português por ser a língua em que o
     resto do bot está escrito, o brasileiro apertaria 🌐 e receberia o mesmo
     inglês de volta -- exatamente o defeito que a NYX encontrou, de cabeça
     para baixo, e na maioria de hoje. */
  const T = falaFixa(idioma, MOTOR_AUTO, "en");
  const { times, temporada, servidores } = estado;
  /* O palpite do Discord diz em que lingua FALAR com a pessoa. Ele nao diz
     por que time ela luta -- isso so' a escolha dela diz.
     Sem essa distincao, quem nunca escolheu nada via "Seu time: 🇩🇪" e a
     linha alema em negrito, e o cartao afirmava uma coisa que nao aconteceu.
     So' apareceu ao desenhar o cartao; nenhum teste tinha reparado. */
  const meuTime = escolheu ? times.find((t) => t.idioma === idioma) : null;
  const doServidor = times.reduce((a, t) => a + (t.meuServidor || 0), 0);

  const campos = [{
    /* Dia e mes, e nao a data do banco: "2026-08-31" e' como eu guardo a
       semana, nao como alguem a le. */
    name: await T("Season"),
    value: `${String(temporada).slice(8, 10)}/${String(temporada).slice(5, 7)} 🌍`,
    inline: true,
  }];

  if (meuTime) {
    campos.push({
      name: await T("Your team"),
      value: `${bandeiraDoIdioma(idioma) || "🌐"} 🏆 ${meuTime.vitorias} · ⚔️ ${meuTime.forca}${setaDoTime(meuTime)}`,
      inline: true,
    });
  }
  if (doServidor > 0) {
    campos.push({ name: await T("Your server"), value: `🏆 ${doServidor}`, inline: true });
  }
  if (eu) {
    const hoje = eu.dia === diaISO(Date.now()) ? eu.ataques_dia : 0;
    campos.push({ name: await T("You"), value: `⚔️ ${eu.poder ?? 1} · 🪙 ${eu.ouro ?? 0} · 🏆 ${eu.vitorias ?? 0}`, inline: true });
    campos.push({ name: await T("Attacks today"), value: `${hoje} / ${ARENA_ATAQUES_DIA}`, inline: true });
  }
  /* Igual ao fixado: numero de servidores so' a partir de cinco, e nome de
     servidor nunca -- ranking com nome de cliente entrega a lista de clientes. */
  if (servidores >= 5) {
    campos.push({ name: await T("Servers"), value: `${servidores}`, inline: true });
  }
  /* Quem nunca escolheu lingua VE o placar -- so' nao joga ainda. Barrar a
     leitura seria fechar a porta na cara de quem chegou pelo cartao; o convite
     vai no fim, ja na lingua do aparelho dela. */
  if (!escolheu) {
    campos.push({
      name: await T("🌐 Pick your language to join"),
      value: await T("You fight for the flag you picked. Use **/mylanguage**, " +
        "or drop by the language channel."),
    });
  }

  return {
    color: COR,
    title: await T("⚔️ Language Arena"),
    /* A tabela continua fora do tradutor: bandeira, número e o nome de cada
       língua escrito nela mesma. */
    description: times.length
      ? linhasDoPlacar(times, escolheu ? idioma : "")
      : await T(ARENA_VAZIA),
    fields: campos,
    footer: { text: await T(LEGENDA_ARENA) },
  };
}

/* Manda o placar pessoal de volta, com os botoes junto.

   Os botoes vao tambem na copia efemera de proposito: quem abriu o /arena no
   meio de outra conversa consegue jogar dali mesmo, sem ir ate' a sala. E' a
   mesma tela e o mesmo estado -- atacar aqui atualiza o fixado la'. */
async function mostrarArena(inter, servidor, idioma, escolheu) {
  const estado = await estadoDaArena(inter.guild, servidor);
  const eu = escolheu
    ? (await jogadoresDaArena(servidor.id)).find((j) => j.discord_user_id === inter.user.id)
    : null;
  return inter.editReply({
    embeds: [await placarPessoal(estado, idioma, eu, escolheu)],
    components: botoesDaArena(),
  });
}

async function cliqueArena(inter) {
  /* Clique vindo da própria resposta efêmera EDITA ela no lugar; vindo do
     cartão fixado, cria uma nova.

     Antes era sempre nova, e cada clique empilhava mais um cartão na tela:
     abrir o placar, ver o perfil e atacar deixava três mensagens, uma embaixo
     da outra, todas dizendo quase a mesma coisa. O jogo inteiro cabe numa
     tela só que muda.

     O fixado é público, e mensagem pública eu não posso trocar pela resposta
     de uma pessoa -- daí a primeira ainda nascer nova. É a mesma regra do
     menu de tradução das mensagens. */
  const naEfemera = (Number(inter.message?.flags?.bitfield ?? 0) & 64) !== 0;
  if (naEfemera) await inter.deferUpdate();
  else await inter.deferReply({ flags: 64 });

  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) return inter.editReply({ content: "Ainda não terminei de me instalar aqui." });

  /* A lingua de quem clicou manda em tudo daqui pra baixo. Sem escolha, vale
     a lingua do Discord dela -- o mesmo palpite que consertou a NYX. */
  const escolhido = await idiomaEscolhido(inter.user.id);
  const idioma = escolhido || idiomaDoAplicativo(inter.locale) || "en";
  const escolheu = !!escolhido;
  const acao = inter.customId.slice("arena:".length);

  /* Ler o placar nao exige ter escolhido lingua; jogar exige. */
  if (acao === "placar") return mostrarArena(inter, servidor, idioma, escolheu);

  if (!escolheu) {
    return respostaDaArena(inter, idioma, {
      title: "🌐 Escolha sua língua primeiro",
      description: "Você luta pela bandeira que escolheu. Use **/mylanguage** " +
        "ou passe no canal de idiomas.",
    });
  }

  const { times, temporada } = await estadoDaArena(inter.guild, servidor);
  const meu = times.find((t) => t.idioma === idioma);
  const eu = (await jogadoresDaArena(servidor.id)).find((j) => j.discord_user_id === inter.user.id);

  if (acao === "perfil") {
    const poder = eu?.poder ?? 1;
    const hoje = eu?.dia === diaISO(Date.now()) ? eu.ataques_dia : 0;
    return respostaDaArena(inter, idioma, {
      title: nomeDoIdioma(idioma),
      fields: [
        { name: "⚔️ Poder", value: `${poder}`, inline: true },
        { name: "🪙 Ouro", value: `${eu?.ouro ?? 0}`, inline: true },
        { name: "🏆 Vitórias", value: `${eu?.vitorias ?? 0}`, inline: true },
        { name: "Ataques hoje", value: `${hoje} / ${ARENA_ATAQUES_DIA}`, inline: true },
        { name: "Próxima evolução", value: `${custoDeEvoluir(poder)} 🪙`, inline: true },
      ],
    });
  }

  if (acao === "evoluir") {
    const custo = custoDeEvoluir(eu?.poder ?? 1);
    const r = (await rpc("cyron_arena_evoluir", {
      p_servidor: servidor.id, p_user: inter.user.id, p_custo: custo,
    }).catch((e) => {
      console.error("arena: evoluir falhou:", e?.message || e);
      return null;
    }))?.[0];

    if (!r?.r_ok) {
      return respostaDaArena(inter, idioma, {
        title: "🪙 Falta ouro",
        description: "Ataque para ganhar mais.",
        fields: [
          { name: "Custa", value: `${custo} 🪙`, inline: true },
          { name: "Você tem", value: `${r?.r_ouro ?? 0} 🪙`, inline: true },
        ],
      });
    }
    await desenharArena(inter.guild, servidor);
    return respostaDaArena(inter, idioma, {
      title: "⬆️ Evoluiu",
      fields: [
        { name: "⚔️ Poder", value: `${r.r_poder}`, inline: true },
        { name: "🪙 Ouro", value: `${r.r_ouro}`, inline: true },
      ],
    });
  }

  /* Quem esta sozinho bate n'A CASA, e nao no vazio.

     A alternativa que eu recusei foi criar jogadores falsos pra encher o
     placar: adversario inventado com cara de gente e' registro fabricado
     apresentado como verdadeiro, e quem descobre que o placar e' invencao
     passa a duvidar da traducao junto -- e a traducao e' o que se vende.

     A Casa se anuncia. Ninguem confunde "🏰 A Casa" com uma pessoa, e todo
     jogo tem boneco de treino. A forca dela acompanha a de quem bate: da' pra
     ganhar e da' pra perder, que e' o unico jeito de valer alguma coisa. */
  const aCasa = { idioma: null, forca: Math.max(2, Math.round((meu?.forca ?? 1) * 0.9)) };
  const alvo = times.find((t) => t.idioma !== idioma && t.poder > 0) || aCasa;

  const chance = chanceDeVitoria(meu?.forca ?? 1, alvo.forca);
  const venceu = Math.random() < chance;
  const r = (await rpc("cyron_arena_atacar", {
    p_servidor: servidor.id, p_user: inter.user.id, p_idioma: idioma,
    p_max_dia: ARENA_ATAQUES_DIA, p_venceu: venceu,
    p_hoje: diaISO(Date.now()), p_temporada: temporada,
  }).catch((e) => {
    console.error("arena: atacar falhou:", e?.message || e);
    return null;
  }))?.[0];

  if (!r) {
    return inter.editReply({ content: "A arena não respondeu agora. Tente de novo em instantes." });
  }
  if (!r.r_ok) {
    return respostaDaArena(inter, idioma, {
      title: "😴 Acabaram seus ataques de hoje",
      description: `Volte amanhã com mais ${ARENA_ATAQUES_DIA}.`,
    });
  }

  await desenharArena(inter.guild, servidor);

  /* O duelo em BANDEIRAS, e nao em nomes de idioma: bandeira nao tem lingua,
     entao esta linha nao custa traducao nenhuma e todo mundo le igual. */
  const duelo = `${bandeiraDoIdioma(idioma) || "🌐"} × ${alvo.idioma ? (bandeiraDoIdioma(alvo.idioma) || "🌐") : "🏰"}`;

  return respostaDaArena(inter, idioma, {
    title: venceu ? "⚔️ Vitória!" : "🛡️ Derrota",
    description: alvo.idioma ? undefined : "Você enfrentou **A Casa** — o adversário de treino.",
    fields: [
      { name: "Duelo", value: duelo, inline: true },
      { name: "Chance", value: `${Math.round(chance * 100)}%`, inline: true },
      { name: "🪙 Ouro", value: `+${venceu ? 5 : 1} · ${r.r_ouro}`, inline: true },
      { name: "🏆 Vitórias", value: `${r.r_vitorias}`, inline: true },
      { name: "Ataques hoje", value: `${r.r_ataques} / ${ARENA_ATAQUES_DIA}`, inline: true },
    ],
  });
}

/* O anúncio da Arena: escrito em inglês, lido em qualquer língua.

   Ele é UMA mensagem para o servidor inteiro, como o placar -- então não pode
   nascer na língua de cada leitor. A saída é o menu 🌐 pendurado nele: quem
   clica recebe a versão dele, efêmera, e a sala continua com uma mensagem só.

   POR QUE NÃO O MENU QUE JÁ EXISTE

   O `traduzir-msg` guarda o texto em discord_msg_traducao, e essa tabela é
   varrida em 7 dias -- prazo que a página de privacidade promete e que a
   varredura cumpre. Num anúncio FIXADO isso é uma bomba-relógio: no oitavo
   dia o botão passaria a responder "não encontrei mais essa mensagem", que do
   lado de fora é o bot quebrado.

   Aqui o texto mora no código. Não expira, não ocupa linha de banco nenhuma,
   e some junto com o bot -- que é o único jeito honesto de um cartão
   permanente ter botão permanente.

   POR QUE EM BLOCOS CURTOS, E NÃO UM TEXTÃO

   traduzirComCache só guarda até MAX_CACHE (400) caracteres; acima disso ele
   traduz e joga fora. E traduzirLongo reparte em pedaços de PEDACO_TRADUCAO
   (1500), que passam desse teto -- ou seja, o caminho "natural" para um texto
   deste tamanho NUNCA acertaria o cache, e cada clique seria uma tradução
   paga, para sempre.

   Em blocos abaixo de 400, cada um vira uma chave de cache que se repete em
   todo clique daquele idioma. Oito blocos por vinte línguas é o custo total,
   uma vez. Há teste que prende o tamanho. */
const ANUNCIO_ARENA = {
  titulo: "⚔️ Language Arena",
  blocos: [
    "**The tournament where your team is your flag.**",

    "You fight for the language you picked, and every win you score belongs " +
    "to your whole team. The board is worldwide: every server CYRON lives in, " +
    "one single ranking.",

    "**⚖️ The rule that changes everything**\n" +
    /* "are stronger", e não "hit harder", pelo mesmo motivo da legenda: o
       idioma volta invertido em português. */
    "Smaller teams are stronger — up to 2×. Four German speakers can beat " +
    "fourteen Portuguese speakers. Which means bringing someone into the " +
    "smaller team is worth more than clicking more.",

    "**▶️ How to play**\n" +
    "**1.** Pick your language with `/mylanguage`, or the flag menu.\n" +
    "**2.** Open the arena channel and press **⚔️ Attack**.\n" +
    "**3.** Spend the gold you win on **⬆️ Upgrade** to grow stronger.\n" +
    "**🌐** `/arena` shows the board **in your language**, from any channel.",

    "**📜 Rules**\n" +
    "⚔️ `5` attacks a day, per person — no exceptions.\n" +
    "🎲 Your odds are never 0% and never 100%: always between `10%` and `90%`.\n" +
    "🪙 `+5` gold for a win, `+1` for a loss.\n" +
    "⬆️ Upgrading costs `10 ×` your current power, so every level is dearer.\n" +
    "📅 The season ends on **Sunday**.\n" +
    "🏰 Nobody to fight? You face **The House**, the training dummy.",

    "**🔎 Reading the board**\n🏆 wins · ⚔️ power · 💬 translations · ▲ smaller team",

    "**🤝 Why this exists**\n" +
    "CYRON translates this server every single day and nobody notices — that " +
    "is exactly the point of it. The Arena is where the work becomes visible: " +
    "the 💬 on the board are **real** translations from this week. No player " +
    "here is invented.",

    "**🔜 This is only season one**\n" +
    "More is on the way, and anything new always shows up right here — nobody " +
    "has to go looking for it.",
  ],
  rodape: "Only you see the result of your own click — nothing clutters the channel.",
};

/* Inglês é o original, então pedir inglês não gasta nada.

   Mesmo motivo pelo qual traduzirEmbed pula o português: pagar para receber
   de volta o texto que já se tem é a única tradução que nunca vale a pena. */
async function anuncioTraduzido(idioma, motor = MOTOR_AUTO) {
  const original = !idioma || idioma === "en";
  const campo = async (t) => original ? t : ((await traduzirComCache(t, idioma, motor)) || t);

  const blocos = [];
  /* Um de cada vez, e não Promise.all: oito chamadas simultâneas por clique
     é o tipo de rajada que faz o tradutor devolver 429 justamente quando
     várias pessoas abrem o anúncio ao mesmo tempo. */
  for (const b of ANUNCIO_ARENA.blocos) blocos.push(await campo(b));

  return {
    color: COR,
    title: (await campo(ANUNCIO_ARENA.titulo)).slice(0, 256),
    description: blocos.join("\n\n").slice(0, 4000),
    footer: { text: (await campo(ANUNCIO_ARENA.rodape)).slice(0, 2048) },
  };
}

/* O menu do anúncio não carrega id de mensagem: o texto é fixo, então a chave
   é o próprio anúncio. É o que o faz sobreviver à varredura de 7 dias. */
function menuDoAnuncio() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("traduzir-fixo:arena")
    .setPlaceholder("🌐 Read in your language / Ler no seu idioma")
    .addOptions(LINGUAS_MENU.map(([value, label, emoji, proprio]) => ({
      label: proprio && proprio !== label ? `${proprio} · ${label}` : label,
      value,
      emoji,
    })));
  return [new ActionRowBuilder().addComponents(select)];
}

async function cliqueTraduzirFixo(inter) {
  const idioma = String(inter.values?.[0] || "");
  if (!LINGUAS_MENU.some(([c]) => c === idioma)) {
    return inter.reply({ content: "🤔 Não reconheci esse idioma.", flags: 64 });
  }

  /* Clique vindo da própria resposta efêmera edita ela no lugar; vindo da
     mensagem pública, cria uma nova -- igual ao menu das mensagens. */
  const naEfemera = (Number(inter.message?.flags?.bitfield ?? 0) & 64) !== 0;
  if (naEfemera) await inter.deferUpdate();
  else await inter.deferReply({ flags: 64 });

  /* Ler o anúncio em alemão é dizer que se lê alemão. Guardar aqui é o que
     transforma a curiosidade em time: a pessoa acaba de entrar na arena sem
     ter que descobrir o /mylanguage primeiro. */
  salvarIdiomaJogador(inter.user.id, idioma).catch(() => {});

  const embed = await anuncioTraduzido(idioma, await motorDoGuild(inter.guildId));
  return inter.editReply({ embeds: [embed], components: menuDoAnuncio() });
}

function botoesDoRecibo() {
  return [{
    type: 1,
    components: [
      { type: 2, custom_id: "cyron:publicar", style: 3, emoji: { name: "📣" },
        label: "Publicar para o servidor" },
    ],
  }];
}

/* O painel na língua de quem abriu -- quando dá para saber quem abriu.

   O cartão FIXADO não recebe idioma, e não é esquecimento: ele é uma mensagem
   só para o servidor inteiro, como o placar da arena, e não existe versão por
   leitor de uma mensagem única. Ele fica em português e ganha o botão 🌐, que
   devolve a cópia de cada um, efêmera.

   O /cyron é outra coisa: nasce do clique de UMA pessoa, e aí a língua dela
   manda. Mesmo desenho, mesmo estado, mesma função -- só o idioma muda. */
async function montarPainel(guild, servidor, idioma = "") {
  const T = falaFixa(idioma, await motorDoGuild(guild.id).catch(() => MOTOR_AUTO));
  const fontes = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id,tipo&order=criado_em.asc`) || [];
  const idiomas = await sb(
    `discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma,canal_id`) || [];
  const limite = limitesDo(servidor);
  /* O rodape diz ate quando, e por que. "Plano PAGO" sozinho nao responde a
     pergunta que a pessoa faz quando vai renovar. */
  const dia = (t) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const fimDoBeta = venceEm(BETA_ATE);   // data, se ja houver
  const emBeta = BETA || fimDoBeta;
  const pagoAte = venceEm(servidor.pago_ate);
  const testeAte = venceEm(servidor.teste_ate);
  const prazo = fimDoBeta ? " · " + await T("beta até {0}", dia(fimDoBeta))
    : emBeta ? " · " + await T("liberado durante o beta")
    : pagoAte ? " · " + await T("até {0}", dia(pagoAte))
    : testeAte ? " · " + await T("teste até {0}", dia(testeAte))
    : "";

  /* Canal apagado nao entra no painel. O Discord desenha "#desconhecido" pra id
     que nao existe mais, e isso aqui parece defeito -- e' so' uma linha
     esperando a proxima varredura limpar. */
  const vivas = fontes.filter((f) => guild.channels.cache.has(f.canal_id));
  const fila = esperando.get(servidor.id) || [];
  const orfas = await replicasOrfas(guild, servidor);
  const elegiveis = await canaisElegiveis(guild, servidor, vivas);
  /* O `await` aqui foi esquecido quando esta função virou assíncrona, e o
     painel parou de atualizar em TODO servidor.

     Sem ele, `motorUsado` é uma Promise. O Discord recebe um objeto onde
     esperava texto e recusa a mensagem inteira:
     `embeds[0].fields[2].value[STRING_TYPE_CONVERT]: Could not interpret "{}"
     as string`. Nada estourou aqui dentro -- a Promise é um valor válido em
     JavaScript --, os testes passaram, e o cartão simplesmente congelou.

     O `T` também faltava: sem ele o campo do motor ficaria em português
     mesmo no painel traduzido. */
  const motorUsado = await comoEstaOMotor(servidor, T);
  const uso = await usoDeHoje(servidor.id);
  const cotaHoje = cotaDoDonoNoDia(servidor);
  const gastoHoje = await jaGastouHoje(servidor.id);

  /* Um sinal antes do numero, pra dar pra ler sem contar. */
  const marca = (usado, teto) => (usado >= teto ? "🔴" : usado >= teto - 1 ? "🟡" : "🟢");
  const noTeto = vivas.length >= limite.fontes || idiomas.length >= limite.idiomas;
  const inalcancaveis = semAlcance.get(servidor.id) || [];
  const cargoRuim = cargoAcimaDeMim.get(servidor.id) || null;

  /* No plano grátis não há teto a mostrar, há um recurso que não está
     incluído. "0 de 0" com bolinha vermelha diria que algo estourou, e a
     pessoa iria procurar o defeito. */
  const espelhoIncluso = limite.idiomas > 0 || idiomas.length > 0;

  const campos = [
    espelhoIncluso
      ? {
        name: `${marca(vivas.length, limite.fontes)} ` +
          await T("Canais que eu traduzo — {0} de {1}", vivas.length, limite.fontes),
        /* Menção de canal é `<#id>`: número, e não texto. Nunca vai ao
           tradutor, e é lida igual em qualquer língua. */
        value: vivas.length
          ? vivas.map((f) => `<#${f.canal_id}>`).join("\n")
          : elegiveis.length
            ? "_" + await T("nenhum ainda — escolha no menu aqui embaixo") + "_"
            : "_" + await T("nenhum, e não sobrou canal para escolher: todos os canais de texto daqui já são meus. Crie um canal onde vocês escrevem e ele aparece no menu.") + "_",
      }
      : {
        name: await T("🔒 Salas por idioma — do plano pago"),
        value: await T("Aqui a conversa acontece traduzida para todo mundo ao mesmo tempo: cada " +
          "idioma ganha uma categoria com os seus canais, e quem escreve na sala dele " +
          "aparece na dos outros já traduzido.") + "\n\n_" +
          await T("No plano grátis a tradução é **puxada**: a bandeira e o botão traduzem " +
          "sem limite, quando alguém pede.") + "_",
      },
    espelhoIncluso
      ? {
        name: `${marca(idiomas.length, limite.idiomas)} ` +
          await T("Idiomas — {0} de {1}", idiomas.length, limite.idiomas),
        /* Na própria língua, como no placar da arena e no menu de escolha: o
           alemão procura "Deutsch", não "Alemão". De graça, e sem tradutor. */
        value: idiomas.length
          ? idiomas.map((i) => nomeNaPropriaLingua(i.idioma)).join("\n")
          : "_" + await T("ninguém escolheu ainda") + "_",
        inline: true,
      }
      : {
        /* Continua valendo escolher idioma no plano grátis, e por isso o
           número continua aqui: o bot fala com cada pessoa na língua dela.
           O que não existe é a sala. */
        name: await T("🌐 Escolheram um idioma — {0}", idiomas.length),
        value: idiomas.length
          ? await T("eu falo com cada uma na língua dela")
          : "_" + await T("ninguém escolheu ainda") + "_",
        inline: true,
      },
    {
      name: await T("🌐 Motor de tradução"),
      value: motorUsado,
      inline: true,
    },
    {
      name: await T("📊 Traduzido hoje"),
      /* Sem separador de milhar, e não toLocaleString("pt-BR"): "1.240" é mil
         duzentos e quarenta em português e um vírgula dois quatro em inglês.
         Num painel que pode ser lido nas duas, o ponto mente para metade. */
      value: uso.traducoes || uso.cache
        ? (uso.traducoes === 1
            ? await T("**{0}** tradução · {1}k caracteres", uso.traducoes, (uso.caracteres / 1000).toFixed(1))
            : await T("**{0}** traduções · {1}k caracteres", uso.traducoes, (uso.caracteres / 1000).toFixed(1))) +
          (uso.cache
            ? "\n_" + await T("{0} repetidas, servidas do cache sem custo", uso.cache) + "_"
            : "")
        : "_" + await T("nada ainda hoje") + "_",
      inline: true,
    },
    /* O teto do dia, dito ANTES de bater nele.

       Sem esta linha, estourar a cota seria degradação calada -- a tradução
       piora, ninguém sabe por quê, e o caminho de sair disso (pôr a própria
       chave) fica invisível. Foi esse o defeito de ontem, e não vou repetir
       ele num lugar novo. */
    ...(servidor.tradutor_chave ? [] : [{
      name: `${marca(gastoHoje, cotaHoje)} ` + await T("Cota do tradutor da casa — hoje"),
      value: await T("{0}k de {1}k caracteres",
        (gastoHoje / 1000).toFixed(1), (cotaHoje / 1000).toFixed(0)) +
        (gastoHoje >= cotaHoje
          ? "\n\n" + await T("🔴 **Bateu no teto de hoje.** Até amanhã eu traduzo por um caminho " +
            "gratuito, que é mais lento e às vezes recusa. Para não depender dele, " +
            "ponha uma chave própria em **🔑 Tradutor** — aí não há teto.")
          : "\n_" + await T("Este é o limite do tradutor que vem comigo. Com chave própria, não há teto.") + "_"),
      inline: true,
    }]),
    {
      name: await T("💬 Tradutor por mensagem"),
      value: servidor.tradutor_topico
        ? await T("🟢 **ligado**\nbotão de tradução em cada mensagem")
        : await T("⚪ **desligado**\nligue no botão abaixo"),
      inline: true,
    },
    /* Sem botao, e de proposito: nao ha o que desligar que valha um botao. A
       bandeira nao constroi nada, nao aparece em canal nenhum e so' custa
       quando alguem toca. O que falta ao dono nao e' controle -- e' SABER que
       existe, porque um recurso que ninguem conhece nao e' usado por
       ninguem. */
    {
      name: await T("🏳️ Tradução por bandeira"),
      value: await T("🟢 **sempre ligada**\nquem reage com a bandeira do país dele " +
        "recebe aquela mensagem traduzida, no privado"),
      inline: true,
    },
  ];

  /* O que pede ação fica numa lista separada, e ela vai na frente.

     O painel tinha até doze campos misturando três coisas diferentes: como
     está indo, o que está quebrado, e o que dá para comprar. Um 🚨 "ninguém
     está recebendo o cargo do idioma" aparecia DEPOIS das cotas e do aviso de
     beta -- quem abre o painel para ver se precisa fazer algo tinha que ler
     tudo para descobrir.

     Separadas, as duas listas também respondem a pergunta que decide o resto:
     a lista de problemas está vazia ou não. É dela que sai o veredito. */
  const problemas = [];

  if (fila.length) {
    const linhas = [];
    for (const f of fila) {
      linhas.push(`${nomeNaPropriaLingua(f.idioma)} — ` + (f.quantos === 1
        ? await T("{0} pessoa", f.quantos)
        : await T("{0} pessoas", f.quantos)));
    }
    problemas.push({
      name: await T("⚠️ Escolheram um idioma e não couberam"),
      value: linhas.join("\n") + "\n_" +
        await T("Para elas o bot parece não ter funcionado: escolheram e não receberam canal nenhum.") + "_",
    });
  }

  /* As salas de conversa aparecem no painel, e nao apareciam.

     O painel dizia "Canais que eu traduzo -- 4" e o servidor mostrava CINCO
     grupos de canais por idioma. O quinto sao as salas de conversa, que nao
     sao copia de canal nenhum: sao o lugar onde cada idioma fala, e o que se
     escreve numa sai traduzido nas outras. Elas so' tomam emprestado o nome
     de um canal.

     Nao contar elas fazia a conta do painel bater com o banco e nao bater com
     a tela -- e quem confere e' a tela. */
  const salas = idiomas.filter((i) => i.canal_id && guild.channels.cache.has(i.canal_id));
  if (salas.length) {
    campos.push({
      name: await T("💬 Salas de conversa — {0}", salas.length),
      value: salas.map((i) => `<#${i.canal_id}>`).join(" ") + "\n_" +
        await T("Uma por idioma. Não são cópias: é onde cada idioma conversa, e o que se escreve numa aparece traduzido nas outras.") + "_",
    });
  }

  /* O aviso do periodo aberto vem ANTES dos problemas, e nao depois.

     Ele nao e' um problema -- e' o motivo de os numeros estarem altos. Quem
     olha o painel e ve "10 canais" precisa saber que isso vence, na mesma
     olhada, ou vai planejar em cima de um limite que nao vai durar. */
  if (emBeta && !pagoAte && servidor.plano !== "pago") {
    const g = PLANOS.gratis;
    campos.push({
      name: fimDoBeta
        ? await T("🧪 CYRON em beta — até {0}", dia(fimDoBeta))
        : await T("🧪 CYRON está em beta"),
      value: [
        await T("Enquanto durar o beta, seu servidor usa o plano pago **sem pagar nada**: " +
          "**{0} idiomas** e **{1} canais traduzidos**.", PLANOS.pago.idiomas, PLANOS.pago.fontes),
        "",
        fimDoBeta
          ? await T("O beta vai até **{0}**.", dia(fimDoBeta))
          : await T("**O beta vai acabar** — ainda não há data. Quando houver, o prazo aparece aqui " +
            "neste painel com antecedência, antes de qualquer coisa mudar."),
        "",
        "_" + await T("Beta também quer dizer que ainda aparece defeito. Se algo estranho acontecer, é bug meu, não seu.") + "_",
        "",
        await T("Quando terminar, o servidor volta ao plano grátis (**{0} idiomas**, **{1} canais**). " +
          "**Nada é apagado** — o que passar do limite apenas para de crescer, e você escolhe o que manter.",
          g.idiomas, g.fontes),
      ].join("\n"),
    });
  }

  const trocados = cargoTrocado.get(servidor.id) || [];
  if (trocados.length && !cargoRuim) {
    campos.push({
      name: await T("🧹 Cargos antigos que dá para apagar"),
      /* Nome de cargo é do servidor, e vai como marcador: nunca chega ao
         tradutor, e não vira chave de cache que só serve a um cliente. */
      value: await T("{0} ficaram acima do meu cargo, então criei novos no lugar " +
        "e já religuei tudo — **está funcionando**.\n" +
        "Os antigos não mandam mais em nada e eu não consigo apagá-los (estão acima de mim). " +
        "Você pode apagar em Configurações do Servidor → Cargos.",
        trocados.map((n) => `**${n}**`).join(", ")),
    });
  }

  if (cargoRuim) {
    problemas.push({
      name: await T("🚨 Ninguém está recebendo o cargo do idioma"),
      value: [
        await T("Os cargos {0} estão **acima** do meu na lista de cargos, " +
          "e o Discord não deixa um bot mexer em cargo que não esteja abaixo do dele. " +
          "Daqui eu não tenho como resolver: mover um cargo acima do meu exige alcançá-lo.",
          cargoRuim.nomes.slice(0, 6).map((n) => `**${n}**`).join(", ")),
        "",
        await T("**Conserto (30 segundos):** Configurações do Servidor → Cargos → arraste **CYRON** para cima."),
        "",
        "_" + await T("Enquanto isso, quem escolhe um idioma não recebe cargo — e sem cargo não enxerga a categoria dele. " +
          "De fora, parece que eu não funciono.") + "_",
      ].join("\n"),
    });
  }

  if (inalcancaveis.length) {
    problemas.push({
      name: inalcancaveis.length === 1
        ? await T("⛔ Não consigo dar o cargo de idioma a {0} pessoa", inalcancaveis.length)
        : await T("⛔ Não consigo dar o cargo de idioma a {0} pessoas", inalcancaveis.length),
      value: inalcancaveis.slice(0, 10).map((id) => `<@${id}>`).join(" ") +
        (inalcancaveis.length > 10 ? " _" + await T("…e mais {0}", inalcancaveis.length - 10) + "_" : "") +
        "\n_" + await T("O cargo delas está acima do meu, e o Discord não deixa um bot mexer em quem está acima — " +
          "isso o Administrator não resolve.") + "_\n" +
        await T("**Conserto:** Configurações do Servidor → Cargos, e arraste **CYRON** para cima delas.") +
        "\n_" + await T("Sem isso, elas escolhem o idioma e não recebem canal nenhum.") + "_",
    });
  }

  if (orfas.length) {
    problemas.push({
      name: await T("🗑️ Cópias sem origem — {0}", orfas.length),
      value: orfas.slice(0, 15).map((o) => `<#${o.canal_id}>`).join("\n") +
        (orfas.length > 15 ? "\n_" + await T("…e mais {0}", orfas.length - 15) + "_" : "") +
        "\n_" + await T("O canal que alimentava estas cópias saiu da lista. Elas não recebem mais nada.") + "_",
    });
  }

  /* O manual saiu do cartao e virou o botao de Ajuda.

     O cartao tinha um campo "Como mudar" com cinco linhas de sintaxe. Com os
     botoes ali do lado, essas cinco linhas passaram a ensinar o caminho mais
     dificil pra fazer o que um clique faz -- e ocupavam a metade de baixo do
     painel, empurrando o estado (que e' o que se olha todo dia) pra cima. */
  const embed = {
    title: "⚙️ CYRON",
    description: await vereditoDoPainel(problemas, vivas.length, idiomas.length, T),
    color: corDoPainel(noTeto, fila.length > 0 || inalcancaveis.length > 0 || !!cargoRuim),
    /* Problemas primeiro, sempre. */
    fields: [...problemas, ...campos],
    /* Dois moldes inteiros, e não "Plano {0}" com o nome dentro.

       Eu tinha posto o nome do plano como marcador, tratando-o como marca. A
       prévia em alemão mostrou o resultado: "Tarif GRÁTIS". "DeepL" é marca e
       não se traduz; "grátis" é palavra comum, e deixá-la de fora esconde
       justamente a informação que a linha existe para dar.

       Palavra solta também não serve: "PAGO" fora de contexto vira "eu pago"
       em italiano. A frase inteira, com as duas versões escritas à mão, é uma
       chave fixa cada e não tem como sair errada. */
    footer: {
      text: (planoDe(servidor) === "pago" ? await T("Plano pago") : await T("Plano grátis")) + prazo,
    },
  };

  return { embed, componentes: componentesDoPainel(servidor, vivas, limite, orfas, elegiveis) };
}

async function cartaoDeConfig(guild, servidor) {
  const canal = await guild.channels.fetch(servidor.canal_config).catch(() => null);
  if (!canal) return;

  const { embed, componentes } = await montarPainel(guild, servidor);

  if (servidor.msg_config) {
    const antiga = await canal.messages.fetch(servidor.msg_config).catch(() => null);
    if (antiga) {
      const antes = antiga.embeds?.[0]
        ? assinaturaDoCartao(antiga.embeds[0].toJSON(), (antiga.components || []).map((l) => l.toJSON()))
        : null;
      if (antes !== assinaturaDoCartao(embed, componentes)) {
        await antiga.edit({ content: null, embeds: [embed], components: componentes });
      }
      return;
    }
  }

  const nova = await canal.send({ embeds: [embed], components: componentes, allowedMentions: { parse: [] } });
  await nova.pin("painel do CYRON").catch(() => {});
  await apagarAvisoDeFixado(canal, nova.id);
  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { msg_config: nova.id });
  servidor.msg_config = nova.id;
}

/* Mudanca que deu certo nao vira mensagem nova.

   O painel e' o cartao fixado, e ele e' EDITADO. Se cada ajuste tambem
   respondesse por escrito, o canal viraria um rolo de confirmacoes velhas onde
   so a de cima e' verdade -- que e' exatamente o defeito que o cartao editavel
   existe pra evitar.

   Entao o retorno de sucesso e' um ✅ na propria mensagem de quem pediu, e o
   resultado aparece no cartao. Erro, recusa e limite continuam sendo resposta
   escrita: essas a pessoa precisa LER, e sumir com elas seria o silencio de
   sempre. */
async function confirmado(msg) {
  await msg.react("✅").catch(() => {});
}

/* Os canais cujo conteudo e' meu.

   Serve pra barrar o laco: uma replica apontada como fonte faz o bot traduzir
   a propria traducao. Aqui o laco nao chega a rodar solto -- o destino repete
   o de origem e a coisa para --, mas enche o servidor de canal e traduz a
   mesma frase varias vezes. Vale pra replica, pro chat de idioma e pra sala
   de comando: nenhum e' lugar de conteudo original.

   Canal de CONVITE nao entra, e isso foi um erro meu que quase custou caro.
   Ele e' um canal comum das pessoas que ganhou uma mensagem fixada minha --
   o conteudo continua sendo delas, e e' justamente o tipo de canal que se quer
   traduzir. Na [TOP], #geral e #anuncios sao fonte E convite ao mesmo tempo.
   Excluindo convite, o menu do painel abria sem nenhuma das quatro fontes
   marcadas, e como o menu manda o conjunto inteiro, um clique ali teria
   apagado as quatro de uma vez.

   O risco que me fez excluir -- eu traduzir a minha propria mensagem de
   convite -- nao existe: mensagem de bot sai do tratador antes de chegar na
   replicacao. */
async function canaisMeus(servidor) {
  const proprios = new Set();
  for (const r of (await sb(`discord_canal_idioma?servidor_id=eq.${servidor.id}&select=canal_id`)) || []) proprios.add(r.canal_id);
  for (const r of (await sb(`discord_chat_espelho?servidor_id=eq.${servidor.id}&canal_id=not.is.null&select=canal_id`)) || []) proprios.add(r.canal_id);
  if (servidor.canal_config) proprios.add(servidor.canal_config);
  return proprios;
}

async function comandoDeConfig(msg, servidor) {
  const escolhidos = [...msg.mentions.channels.values()]
    .filter((c) => c.type === ChannelType.GuildText);
  const texto = String(msg.content || "").trim().toLowerCase();

  /* "tradutor ligar" / "tradutor desligar" */
  const mexeuNoTradutor = /^tradutor\b/.test(texto);
  if (mexeuNoTradutor) {
    if (!msg.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await msg.reply("🔒 Só quem tem **Gerenciar Servidor** pode mudar isto.");
      return true;
    }
    const ligar = /\b(ligar|liga|ativar|ativa|on|sim)\b/.test(texto);
    const desligar = /\b(desligar|desliga|desativar|desativa|off|nao|não)\b/.test(texto);
    if (!ligar && !desligar) {
      await msg.reply(
        `O tradutor por mensagem está **${servidor.tradutor_topico ? "ligado" : "desligado"}**.\n` +
        "Escreva `tradutor ligar` ou `tradutor desligar`.");
      return true;
    }

    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { tradutor_topico: ligar });
    servidor.tradutor_topico = ligar;
    cacheServidor.delete(msg.guild.id);

    await confirmado(msg);
    await cartaoDeConfig(msg.guild, servidor);
    return true;
  }

  if (!escolhidos.length) {
    /* Sem canal nenhum: so responde se parecia uma tentativa. A sala e' da
       administracao, e duas pessoas conversando ali nao querem um bot
       corrigindo cada frase. */
    if (/^(fonte|canais?|remover|remove|tirar|tira|tradutor)\b/.test(texto)) {
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
    const outroPapel = await fontesDeOutroPapel(servidor);
    const emprestando = escolhidos.filter((c) => outroPapel.has(c.id));
    if (emprestando.length) {
      await msg.reply(
        `🏷️ ${emprestando.map((c) => `<#${c.id}>`).join(", ")} já tem outro papel aqui: ` +
        "é dele que as salas de conversa por idioma tiram o nome.\n" +
        "Se eu também traduzisse ele, as cópias nasceriam com o mesmo nome das salas — duas coisas diferentes chamadas igual no mesmo servidor.");
      return true;
    }

    const proprios = await canaisMeus(servidor);
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
  await confirmado(msg);

  /* Monta na hora, com a pessoa olhando. Esperar a volta do relogio era o que
     matava a primeira impressao: quem acabou de apontar os canais fica dez
     minutos sem ver nada acontecer e conclui que nao funcionou. */
  cacheFontes.delete(servidor.id);
  await sincronizarAgora(msg.guild);

  /* O cartao por ultimo: ele mostra o que a montagem acabou de fazer. */
  await cartaoDeConfig(msg.guild, servidor);
  return true;
}

/* ---------------- Os cliques do painel ----------------

   Todo clique aqui comeca por deferUpdate. O Discord da' TRES segundos pra
   acusar o recebimento, e "remontar" pode levar um minuto criando canal --
   sem o defer o botao morre com "Esta interacao falhou" e a pessoa clica de
   novo, disparando a mesma montagem duas vezes. Acusando primeiro, o trabalho
   pode demorar o que precisar.

   Recusa e limite viram followUp EFEMERO, nao mensagem no canal. Sao coisas
   que so' interessam a quem clicou, e o canal de configuracao ja' foi um rolo
   de confirmacoes velhas uma vez -- nao vai voltar a ser por causa dos
   botoes. O que todo mundo precisa ver continua sendo o painel, que e'
   editado no lugar. */

async function refrescarPainel(inter, servidor) {
  /* A língua tem que combinar com a SUPERFÍCIE, e não com quem clicou.

     Se o clique veio do cartão fixado, `editReply` edita o próprio fixado --
     que é uma mensagem para o servidor inteiro. Redesenhar ele na língua de
     quem apertou o botão traduziria o cartão de todo mundo para a língua da
     última pessoa que mexeu nele. Ali é português, sempre.

     Na cópia efêmera é o contrário: ela é dela, e continua dela depois do
     clique. Perder a língua ao apertar um botão faria o painel "voltar para o
     português sozinho", que parece defeito e é dos piores de explicar. */
  const noFixado = inter.message?.id === servidor.msg_config;
  const idioma = noFixado ? "" : await idiomaEscolhido(inter.user.id);
  const { embed, componentes } = await montarPainel(inter.guild, servidor, idioma);
  await inter.editReply({ embeds: [embed], components: componentes }).catch(() => {});
  /* Se o clique veio da copia efemera do /cyron, o fixado ficou pra tras. */
  if (!noFixado) {
    await cartaoDeConfig(inter.guild, servidor).catch(() => {});
  }
}

/* O menu manda o conjunto inteiro, entao a gravacao e' a diferenca. */
async function definirFontes(guild, servidor, ids) {
  const antigas = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id`) || [];
  const atuais = new Set(antigas.map((a) => a.canal_id));
  const querem = new Set(ids);

  for (const id of atuais) {
    if (!querem.has(id)) await sbDel(`discord_fonte_replica?canal_id=eq.${encodeURIComponent(id)}`);
  }
  for (const id of querem) {
    if (atuais.has(id)) continue;
    const canal = guild.channels.cache.get(id);
    await sbPost("discord_fonte_replica", {
      servidor_id: servidor.id, canal_id: id, tipo: rotuloDoCanal(canal?.name || "canal"),
    });
  }
  cacheFontes.delete(servidor.id);
}

async function cliquePainel(inter) {
  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) {
    return inter.reply({ flags: 64, content: "Ainda não terminei de me instalar aqui. Tente de novo em um minuto." });
  }

  const acao = inter.customId.slice("cyron:".length);

  if (acao === "ajuda") {
    return inter.reply({
      flags: 64,
      embeds: [{
        title: "❓ Como o CYRON funciona",
        color: 0x2E8B7A,
        description: [
          "**1. Você escolhe os canais.** No menu do painel, marque os canais onde *vocês* escrevem — anúncios, geral, o que for.",
          "",
          "**2. Cada pessoa escolhe o idioma dela** no canal 🌐, uma vez só.",
          "",
          "**3. Eu monto uma cópia de cada canal por idioma**, dentro de uma categoria que só quem escolheu aquele idioma enxerga. O que for postado no canal original aparece traduzido lá.",
          "",
          "**Tradutor por mensagem** é outra coisa, e não precisa de canal nenhum: com ele ligado, qualquer pessoa pode traduzir uma mensagem solta pelo menu de contexto (botão direito → Apps → Translate).",
          "",
          "_Também dá para configurar escrevendo: `#canal1 #canal2` para somar, `remover #canal` para tirar._",
        ].join("\n"),
      }],
    });
  }

  /* A sala e' da administracao, mas cargo muda e convidado entra. A checagem
     e' no clique, nao na visibilidade do canal. */
  if (!inter.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return inter.reply({ flags: 64, content: "🔒 Só quem tem **Gerenciar Servidor** pode mexer aqui." });
  }

  /* Publicar o recibo para o servidor.

     Antes do deferUpdate porque a resposta e' uma mensagem nova, e nao a
     edicao do cartao: o recibo fica onde esta, com o botao, e quem clicou
     recebe a confirmacao so' pra si. Editar o cartao apagaria o proprio
     recibo que ele acabou de publicar. */
  if (acao === "publicar") {
    await inter.deferReply({ flags: 64 });
    const embed = inter.message?.embeds?.[0]?.toJSON?.() || inter.message?.embeds?.[0];
    if (!embed) return inter.editReply({ content: "Não achei o cartão para publicar." });

    const fonte = (await sb(
      `discord_fonte_replica?servidor_id=eq.${servidor.id}&select=canal_id&limit=1`).catch(() => null))?.[0];
    const canal = fonte?.canal_id ? await inter.guild.channels.fetch(fonte.canal_id).catch(() => null) : null;
    if (typeof canal?.send !== "function") {
      return inter.editReply({
        content: "Não tenho um canal para publicar. Marque um canal no menu do painel e o botão passa a funcionar.",
      });
    }
    const foi = await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    return inter.editReply({
      content: foi ? `📣 Publicado em <#${canal.id}>.` : "Não consegui publicar ali — falta permissão de escrever nesse canal.",
    });
  }

  /* A cópia do painel na língua de quem apertou.

     Ela é NOVA e efêmera, e não uma edição do fixado: editar o fixado poria o
     cartão do servidor inteiro na língua da última pessoa que clicou. */
  if (acao === "idioma") {
    await inter.deferReply({ flags: 64 });
    const meu = (await idiomaEscolhido(inter.user.id)) || idiomaDoAplicativo(inter.locale);
    const { embed, componentes } = await montarPainel(inter.guild, servidor, meu);
    return inter.editReply({ embeds: [embed], components: componentes });
  }

  /* Anunciar a arena: mesmo caminho do recibo, mesmo canal.

     Vai para a sala-fonte que o dono já apontou -- e não para a ⚔️-arena, que
     existe para ter UM cartão e onde ninguém ainda passa. Anúncio precisa
     nascer onde as pessoas já estão. */
  if (acao === "anunciar") {
    await inter.deferReply({ flags: 64 });

    const fonte = (await sb(
      `discord_fonte_replica?servidor_id=eq.${servidor.id}&select=canal_id&limit=1`).catch(() => null))?.[0];
    const canal = fonte?.canal_id ? await inter.guild.channels.fetch(fonte.canal_id).catch(() => null) : null;
    if (typeof canal?.send !== "function") {
      return inter.editReply({
        content: "Não tenho um canal para anunciar. Marque um canal no menu do painel e o botão passa a funcionar.",
      });
    }

    const posta = await canal.send({
      embeds: [await anuncioTraduzido("en")],
      components: menuDoAnuncio(),
      allowedMentions: { parse: [] },
    }).catch((e) => {
      console.error("anuncio: nao consegui publicar:", e?.message || e);
      return null;
    });
    if (!posta) {
      return inter.editReply({ content: "Não consegui publicar ali — falta permissão de escrever nesse canal." });
    }

    /* Fixar é o que faz um anúncio continuar existindo depois de vinte
       mensagens de conversa. E o rastro do "fixou uma mensagem" sai, como
       nos outros quatro lugares onde eu fixo. */
    await posta.pin("anúncio da arena").catch(() => {});
    await apagarAvisoDeFixado(canal, posta.id);

    return inter.editReply({ content: `📣 Anunciado em <#${canal.id}> — e fixado.` });
  }

  /* showModal so' vale em interacao ainda nao respondida -- por isso vem
     antes do deferUpdate, e nao junto das outras acoes la' embaixo. */
  if (acao === "motor") return inter.showModal(janelaValida(janelaDoMotor(servidor)));
  if (acao === "palavras") return inter.showModal(janelaValida(janelaDasPalavras(servidor)));
  if (acao === "codigo") return inter.showModal(janelaValida(janelaDoCodigo()));

  await inter.deferUpdate();

  if (acao === "tradutor") {
    const ligar = !servidor.tradutor_topico;
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { tradutor_topico: ligar });
    servidor.tradutor_topico = ligar;
    cacheServidor.delete(inter.guildId);
    return refrescarPainel(inter, servidor);
  }

  if (acao === "limpar") {
    const orfas = await replicasOrfas(inter.guild, servidor);
    if (!orfas.length) {
      await inter.followUp({ flags: 64, content: "Não sobrou nenhuma cópia sem origem." });
      return refrescarPainel(inter, servidor);
    }
    let apagadas = 0;
    for (const o of orfas) {
      const canal = inter.guild.channels.cache.get(o.canal_id);
      if (canal) {
        const foi = await canal.delete("cópia sem canal de origem, apagada pelo painel").then(() => true).catch(() => false);
        /* Se o Discord recusou, a linha FICA. Apagar o registro de um canal
           que continua existindo faria o canal virar invisivel pra mim: ele
           some do painel, ninguem mais e' avisado dele, e ele fica no
           servidor pra sempre sem ninguem saber de onde veio. */
        if (!foi) continue;
      }
      await sbDel(`discord_canal_idioma?id=eq.${encodeURIComponent(o.id)}`);
      apagadas++;
    }
    cacheReplicas.delete(servidor.id);
    await inter.followUp({
      flags: 64,
      content: apagadas === orfas.length
        ? `🗑️ Apaguei ${apagadas} ${apagadas === 1 ? "cópia" : "cópias"}.`
        : `🗑️ Apaguei ${apagadas} de ${orfas.length}. Nas outras o Discord recusou — provavelmente falta permissão minha nelas.`,
    });
    return refrescarPainel(inter, servidor);
  }

  if (acao === "remontar") {
    await sincronizarAgora(inter.guild);
    await inter.followUp({ flags: 64, content: "🔄 Passei por tudo: canais, categorias e quem escolheu idioma." });
    return refrescarPainel(inter, servidor);
  }

  if (acao === "fontes") {
    /* O que a pessoa NAO viu, ela nao decidiu tirar.

       O menu manda o conjunto inteiro, entao a ausencia de um canal e' um
       pedido pra remover. So que "ausente" tem dois motivos diferentes: ela
       desmarcou, ou o canal nem estava na lista que ela tinha na frente. Um
       painel aberto ha' uma hora, uma copia efemera do /cyron de antes, uma
       lista que passou de 25 -- em qualquer desses casos, obedecer ao
       conjunto ao pe' da letra apaga fonte que ninguem mandou apagar.

       Entao eu leio as opcoes da mensagem em que ela clicou, e as fontes que
       nao estavam la' ficam onde estao. So conta como remocao o que ela podia
       ver e deixou desmarcado. */
    const vistos = new Set();
    for (const linha of inter.message?.components || []) {
      for (const c of (linha.toJSON?.() ?? linha).components || []) {
        if (c.custom_id !== "cyron:fontes") continue;
        for (const o of c.options || []) vistos.add(o.value);
      }
    }
    const atuais = (await sb(
      `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id`)) || [];
    const invisiveis = atuais.map((a) => a.canal_id).filter((id) => !vistos.has(id));
    const ids = [...new Set([...(inter.values || []), ...invisiveis])];

    const proprios = await canaisMeus(servidor);
    const meus = ids.filter((id) => proprios.has(id));
    if (meus.length) {
      await inter.followUp({
        flags: 64,
        content: `🔁 ${meus.map((id) => `<#${id}>`).join(", ")} ${meus.length === 1 ? "é um canal meu" : "são canais meus"} — eu já escrevo neles.\n` +
          "Traduzir um canal meu seria traduzir a minha própria tradução, e o servidor encheria de cópias. " +
          "Marque os canais onde **vocês** escrevem.",
      });
      return refrescarPainel(inter, servidor);   // devolve as marcas ao que estava valendo
    }

    const limite = limitesDo(servidor);
    if (ids.length > limite.fontes) {
      const plano = planoDe(servidor);
      await inter.followUp({
        flags: 64,
        content: [
          `📦 Você marcou **${ids.length} canais**, e no plano **${plano}** eu traduzo até **${limite.fontes}**.`,
          "",
          "Não mudei nada — os canais de antes continuam valendo. Marque no máximo " +
          `${limite.fontes} e mande de novo.`,
          "",
          plano === "gratis"
            ? `_No plano pago são ${PLANOS.pago.fontes} canais e ${PLANOS.pago.idiomas} idiomas, com 7 dias de teste grátis._`
            : "",
        ].filter(Boolean).join("\n"),
      });
      return refrescarPainel(inter, servidor);
    }

    await definirFontes(inter.guild, servidor, ids);
    await sincronizarAgora(inter.guild);
    return refrescarPainel(inter, servidor);
  }
}

/* A janela onde a chave e' digitada.

   Chave de API nao pode ser digitada no canal. Mesmo sendo sala da
   administracao, a mensagem fica no historico, entra em backup, aparece pra
   quem entrar depois -- e apagar depois nao desfaz quem ja leu. O modal do
   Discord e' o unico lugar em que o texto vai do teclado da pessoa direto pro
   bot, sem passar por canal nenhum.

   Isso so' passou a ser possivel agora: enquanto as interacoes iam pra funcao
   HTTP, o bot nao tinha como abrir modal nenhum. */
/* A janela das palavras que nao se traduz.

   Texto livre, uma por linha, do jeito que a pessoa pensa nelas. Nao inventei
   lista pronta: os termos sao do servidor, nao meus -- num servidor de jogo
   sao "urso" e "rally", num de empresa sao os nomes dos produtos, e eu nao
   tenho como adivinhar nem devo. */
function janelaDasPalavras(servidor) {
  return {
    custom_id: "cyron:palavras",
    title: "Palavras que não devem ser traduzidas",
    components: [
      { type: 1, components: [{
        type: 4, custom_id: "termos", style: 2, required: false, max_length: 1500,
        label: "Uma por linha",
        placeholder: "urso\nrally\nbaú\nnome da aliança",
        ...(servidor.glossario ? { value: String(servidor.glossario).slice(0, 1500) } : {}),
      }] },
    ],
  };
}

async function salvarPalavras(inter) {
  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) return;
  const termos = String(inter.fields.getTextInputValue("termos") || "").trim();
  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { glossario: termos || null });
  cacheServidor.delete(inter.guildId); // a próxima fala já usa a lista nova
  const quantos = termos.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean).length;
  await inter.reply({
    content: quantos
      ? `📖 Guardei **${quantos}** ${quantos === 1 ? "palavra" : "palavras"}. ` +
        "De agora em diante elas atravessam a tradução sem mudar."
      : "📖 Lista vazia — volto a traduzir tudo.",
    flags: 64,
  });
}

function janelaDoMotor(servidor) {
  return {
    custom_id: "cyron:motor",
    title: "Tradutor deste servidor",
    components: [
      { type: 1, components: [{
        type: 4, custom_id: "motor", style: 1, required: true, max_length: 10,
        label: "Motor: azure, deepl ou google",
        placeholder: "azure",
        ...(servidor.tradutor_motor && servidor.tradutor_motor !== "auto"
          ? { value: servidor.tradutor_motor } : {}),
      }] },
      { type: 1, components: [{
        type: 4, custom_id: "chave", style: 1, required: false, max_length: 300,
        label: "Chave da API (vazio em google)",
        placeholder: "cole aqui a chave da sua conta",
      }] },
      { type: 1, components: [{
        type: 4, custom_id: "regiao", style: 1, required: false, max_length: 40,
        label: "Região — só Azure",
        placeholder: "brazilsouth",
        ...(servidor.tradutor_regiao ? { value: servidor.tradutor_regiao } : {}),
      }] },
    ],
  };
}

/* Guarda a chave -- se ela funcionar.

   Testo antes de gravar, e gravo so' o que passou. Chave errada guardada e'
   um servidor que parece configurado e traduz pelo gratuito sem ninguem
   saber; o erro so' apareceria dias depois, como "a qualidade piorou". Aqui a
   pessoa descobre no segundo seguinte, com a frase de teste na frente. */
/* Nenhuma janela sai daqui fora dos limites do Discord.

   O Discord recusa a janela INTEIRA quando um rotulo passa de 45 caracteres,
   e devolve "components[3].components[0].label" -- que nao diz qual campo e'
   nem o que fazer. Foi o que aconteceu com o formulario de ajustes: eu tinha
   escrito esse limite pro dono horas antes e depois o violei.

   Aqui eu corto e grito. Cortar deixa o rotulo pior; nao cortar deixa o botao
   quebrado. E o log passa a dizer o NOME do campo, nao o indice dele. */
function janelaValida(j) {
  const corta = (t, n, onde) => {
    const texto = String(t ?? "");
    if (texto.length <= n) return texto;
    console.error(`janela ${j.custom_id}: ${onde} tem ${texto.length} caracteres, o máximo é ${n} — cortei`);
    return texto.slice(0, n);
  };
  j.title = corta(j.title, 45, "o título");
  for (const linha of j.components || []) {
    for (const c of linha.components || []) {
      c.label = corta(c.label, 45, `o rótulo de "${c.custom_id}"`);
      if (c.placeholder) c.placeholder = corta(c.placeholder, 100, `o exemplo de "${c.custom_id}"`);
      if (c.value) c.value = corta(c.value, 4000, `o valor de "${c.custom_id}"`);
    }
  }
  if ((j.components || []).length > 5) {
    console.error(`janela ${j.custom_id}: ${j.components.length} campos, o máximo é 5 — cortei`);
    j.components = j.components.slice(0, 5);
  }
  return j;
}

async function salvarMotor(inter) {
  if (!inter.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return inter.reply({ flags: 64, content: "🔒 Só quem tem **Gerenciar Servidor** pode mexer aqui." });
  }
  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) return inter.reply({ flags: 64, content: "Ainda não terminei de me instalar aqui." });

  await inter.deferReply({ flags: 64 });

  /* getTextInputValue estoura se o campo nao veio, e campo opcional em branco
     nem sempre vem. Um throw aqui viraria "Esta interacao falhou" logo depois
     de a pessoa colar a chave -- e ela nao teria como saber se gravou. */
  const campo = (nome) => {
    try { return String(inter.fields.getTextInputValue(nome) || "").trim(); }
    catch { return ""; }
  };
  const tipo = campo("motor").toLowerCase();
  const digitada = campo("chave");
  const regiao = campo("regiao") || null;

  /* Chave em branco com motor ja configurado = "mexi so na regiao".
     Exigir a chave de novo pra trocar uma palavra e' o tipo de atrito que faz
     a pessoa desistir e deixar errado. */
  const chave = digitada || (servidor.tradutor_motor === tipo ? decifrar(servidor.tradutor_chave) : "") || "";

  /* Voltar pro gratuito e' um caminho de primeira classe, nao um esquecimento.
     Quem cancelou a conta do Azure precisa conseguir sair sem ficar com uma
     chave morta gravada. */
  if (!tipo || tipo === "google" || tipo === "auto" || tipo === "gratis" || tipo === "grátis") {
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`,
      { tradutor_motor: "auto", tradutor_chave: null, tradutor_regiao: null });
    cacheServidor.delete(inter.guildId);
    cacheMotor.delete(servidor.id);
    falhaDoMotor.delete(servidor.id);
    await inter.editReply("🌐 Voltei para o **Google grátis**, compartilhado com os outros servidores.");
    return atualizarUmCartao(inter.guild);
  }

  if (!MOTORES[tipo]) {
    return inter.editReply(
      `Não conheço o motor **${tipo}**. Os que eu sei usar são **azure** e **deepl** — ` +
      "ou **google** para voltar ao gratuito.");
  }
  if (!chave) {
    return inter.editReply(`O **${MOTORES[tipo].nome}** precisa de uma chave. Abra de novo e cole a sua.`);
  }
  if (!SEGREDO) {
    /* Sem segredo eu nao guardo. Texto puro "por enquanto" fica pra sempre, e
       a chave e' de quem contratou, nao minha pra arriscar. */
    console.error("tradutor: CYRON_SEGREDO não está definido; recusei guardar uma chave");
    return inter.editReply(
      "🔒 Não consigo guardar a chave com segurança agora — falta uma configuração do meu lado. " +
      "Não gravei nada. Avise quem cuida do bot.");
  }

  const teste = { tipo, chave, regiao, servidorId: servidor.id };
  let saiu;
  try {
    saiu = await MOTORES[tipo].traduzir("Bom dia, tudo bem?", "en", teste);
  } catch (e) {
    return inter.editReply([
      `❌ O **${MOTORES[tipo].nome}** recusou a chave.`,
      "```", String(e?.message || e).slice(0, 400), "```",
      "Não gravei nada — o que estava valendo continua valendo.",
      tipo === "azure" ? "_No Azure, chave sem a região certa dá 401. A região aparece na página do recurso._" : "",
    ].filter(Boolean).join("\n"));
  }
  if (!saiu) {
    return inter.editReply(`❌ O **${MOTORES[tipo].nome}** respondeu vazio. Não gravei nada.`);
  }

  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`,
    { tradutor_motor: tipo, tradutor_chave: digitada ? cifrar(digitada) : servidor.tradutor_chave, tradutor_regiao: regiao });
  cacheServidor.delete(inter.guildId);
  cacheMotor.delete(servidor.id);
  falhaDoMotor.delete(servidor.id);

  await inter.editReply([
    `✅ **${MOTORES[tipo].nome}** ligado, e testado agora:`,
    `> "Bom dia, tudo bem?" → **${saiu}**`,
    "",
    "A chave fica cifrada aqui. A partir de agora toda tradução deste servidor passa por ela — " +
    "o limite é o da sua conta, não mais o compartilhado.",
  ].join("\n"));
  return atualizarUmCartao(inter.guild);
}

async function atualizarUmCartao(guild) {
  const servidor = await servidorDoGuild(guild.id);
  if (servidor?.canal_config) await cartaoDeConfig(guild, servidor).catch(() => {});
}

/* Resgatar um código de ativação.

   O plano pago era um UPDATE feito a mao. Nao da' pra vender assim: o cliente
   paga e fica esperando alguem acordar.

   O codigo e' o denominador comum de qualquer forma de cobranca -- PIX,
   cartao, venda no boca a boca. O que muda de uma pra outra e' de onde o
   codigo sai, nao o que ele faz aqui.

   Ele entra por janela, e nao por mensagem no canal, pelo mesmo motivo da
   chave de API: um codigo postado num canal e' um codigo que outra pessoa
   resgata primeiro. */
function janelaDoCodigo() {
  return {
    custom_id: "cyron:codigo",
    title: "Ativar o plano pago",
    components: [
      { type: 1, components: [{
        type: 4, custom_id: "codigo", style: 1, required: true, max_length: 40,
        label: "Código de ativação",
        placeholder: "CYRON-XXXXXXXX",
      }] },
    ],
  };
}

async function resgatarCodigo(inter) {
  if (!inter.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return inter.reply({ flags: 64, content: "🔒 Só quem tem **Gerenciar Servidor** pode ativar um plano." });
  }
  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) return inter.reply({ flags: 64, content: "Ainda não terminei de me instalar aqui." });

  await inter.deferReply({ flags: 64 });

  let codigo = "";
  try { codigo = String(inter.fields.getTextInputValue("codigo") || "").trim(); } catch { /* campo vazio */ }
  if (!codigo) return inter.editReply("Você não digitou nenhum código.");

  let r;
  try {
    r = (await rpc("cyron_resgatar_codigo", { p_codigo: codigo, p_servidor: servidor.id }))?.[0];
  } catch (e) {
    console.error("codigo: resgate falhou:", e?.message || e);
    return inter.editReply("❌ Não consegui falar com o servidor agora. **Nada foi usado** — tente de novo em instantes.");
  }

  if (!r?.ok) {
    /* Recusa dizendo QUAL foi o problema: "código inválido" para as duas
       coisas faria quem digitou errado ficar procurando a compra, e quem já
       usou ficar redigitando. */
    return inter.editReply(r?.motivo === "usado"
      ? "🎟️ Esse código **já foi usado**. Cada código vale uma ativação — se você comprou e ele já constava usado, me chame."
      : "🎟️ Não encontrei esse código. Confira as letras: eles não têm **O**, **I**, **zero** nem **um**, justamente para não confundir.");
  }

  cacheServidor.delete(inter.guildId);
  const ate = new Date(r.ate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  await inter.editReply([
    `✅ **Plano pago ativado até ${ate}.**`,
    "",
    `Agora cabem **${PLANOS.pago.idiomas} idiomas** e **${PLANOS.pago.fontes} canais traduzidos**.`,
    "Resgatar outro código soma os dias a esta data — não substitui.",
  ].join("\n"));

  /* Monta na hora: quem acabou de pagar quer ver acontecer. */
  const atualizado = await servidorDoGuild(inter.guildId);
  await sincronizarAgora(inter.guild);
  if (atualizado) await cartaoDeConfig(inter.guild, atualizado).catch(() => {});
}

/* ---------------- o painel do dono ----------------

   Um servidor do Discord inteiro como area administrativa: um canal por
   cliente, mais canais de acontecimento. E' a ideia do dono, e ela e' boa pro
   que canal faz bem -- historico por assunto, em ordem, no celular.

   Cada cliente ganha um TOPICO, nao um canal.

   Canal por cliente era a ideia primeira, e ela esbarra em tres coisas: o
   Discord aceita 500 canais por servidor mas a barra lateral fica ilegivel
   bem antes; cliente que cancela vira faxina manual; e canal nao arquiva
   sozinho. Topico resolve os tres -- some da barra quando esfria, volta
   quando acontece algo, e continua pesquisavel.

   O que topico NAO resolve, e canal nenhum resolveria: ordenar, filtrar e
   somar. "Quem traduziu mais essa semana" nao se responde olhando uma lista.
   Por isso o painel tem duas metades -- os topicos e os canais pro que
   acontece, e o /admin pro que se pergunta.

   O bot NAO se instala no servidor do painel. Sem isso, ele criaria ali a
   porta de idioma, o canal de configuracao e o resto, tratando o dono como
   mais um cliente. */

/* Os ultimos erros, em memoria.

   O log do Fly tem tudo, mas exige terminal e some no meio de linhas
   repetidas -- foi assim que eu quase perdi o "Invalid Form Body" hoje. Aqui
   ficam os ultimos, filtrados, com hora e lugar, pra olhar do celular.

   Em memoria, e nao no banco, de proposito: erro e' coisa de agora. Gravar
   cada um daria uma tabela que so cresce e que ninguem lê, e um erro no
   gravador de erros e' um laco que ninguem quer depurar. Somem no reinicio, e
   o painel diz isso. */
const errosRecentes = [];
const MAX_ERROS = 60;

/* O canal #erros recebe cada erro UMA vez por hora.

   Sem trava, um erro que se repete de dez em dez minutos -- e eu tenho um
   assim hoje -- encheria o canal de linhas iguais ate' o dono parar de olhar.
   Um canal de erro que ninguem le e' pior que nenhum: da a impressao de que
   esta tudo sob controle.

   A lista do /admin guarda todas as ocorrencias; o canal so' avisa. */
const jaAvisado = new Map();
const ESPERA_AVISO = 60 * 60 * 1000;

/* O canal de erros falando com gente.

   Ele nascia despejando a frase que o programa usa pra falar consigo mesmo:
   "passada curta falhou em 1541430419289940069 supabase 504". Quem le isso
   nao tem como saber tres coisas que sao justamente as unicas que importam:
   o que aconteceu, se alguem precisa fazer alguma coisa, e o que. Sem elas o
   canal so' produz preocupacao -- e preocupacao sem acao vira o habito de
   ignorar o canal, que e' pior do que nao ter canal nenhum.

   Entao cada erro conhecido ganha as tres respostas, e quem NAO precisa de
   ninguem diz isso com todas as letras. Erro que eu ainda nao sei explicar
   aparece cru e assumido como tal, em vez de fingir que e' grave. */
const EXPLICA_ERRO = [
  {
    /* ANTES da regra do banco, e por causa dela.

       "fetch failed", "ECONNRESET" e afins sao os mesmos sintomas de rede
       venham de onde vierem -- e a regra do banco os reivindicava todos. Uma
       traducao que nao voltou aparecia como "O banco de dados piscou", que
       manda olhar o status.supabase.com por um problema que nao e' de la'.
       Explicacao errada e' pior que nenhuma: ela custa o tempo de quem foi
       procurar no lugar indicado.

       Por isso a palavra "tradutor" tem que estar perto do sintoma: e' o
       proprio comeco da linha de log, e e' ela que diz de quem e' a falha. */
    quando: /tradutor.{0,60}(aborted due to timeout|TimeoutError|ETIMEDOUT|fetch failed|ECONNRESET|socket hang up|EAI_AGAIN)/i,
    titulo: "O tradutor demorou demais e eu desisti de esperar",
    precisaDeVoce: false,
    oque: "Pedi uma tradução e o serviço não respondeu em 8 segundos, então cortei a espera. " +
      "Quase sempre é a rede no meio do caminho, e não a chave: ela continua válida.\n\n" +
      "Deixo esse motor de molho por 2 minutos e a fala sai pelos tradutores grátis. " +
      "Ninguém fica sem tradução — no máximo ela chega um pouco pior nesses dois minutos.",
    fazer: "Nada. Só vale olhar se aparecer muitas vezes no mesmo dia, e sempre com o mesmo " +
      "motor: aí é o serviço, e não a rede.",
  },
  {
    quando: /supabase 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|EAI_AGAIN/i,
    titulo: "O banco de dados piscou",
    precisaDeVoce: false,
    oque: "O Supabase ficou fora do ar por alguns segundos, e a varredura daquele momento foi pulada. " +
      "A seguinte, dez minutos depois, faz o que ficou para trás — nada se perde.",
    fazer: "Nada. Só vale olhar se isso ficar repetindo por mais de uma hora: aí é o Supabase fora do ar de " +
      "verdade, e dá para conferir em status.supabase.com.",
  },
  {
    /* O 429 tem que vir COM a palavra tradutor. Solto, ele casaria com
       qualquer mensagem que por acaso contivesse esses tres digitos -- um id,
       um contador, um trecho de texto -- e o erro apareceria explicado
       errado, que e' pior do que nao explicado. */
    quando: /tradutor.{0,40}\b429\b/i,
    titulo: "O tradutor grátis mandou desacelerar",
    precisaDeVoce: true,
    oque: "O endereço gratuito do Google recusou a tradução por excesso de chamadas. A mensagem chega " +
      "do outro lado, mas **sem traduzir** — que num bot de tradução é a falha que mais aparece para quem usa.",
    fazer: "Ligar um motor com chave (DeepL ou Google Cloud) nos ajustes do `/admin`. " +
      "Enquanto o volume for baixo isso é raro; quanto mais gente usar, mais vai aparecer.",
  },
  {
    quando: /tradutor devolveu HTTP|tradutor fora do ar|traducao falhou/i,
    titulo: "O tradutor recusou uma tradução",
    precisaDeVoce: false,
    oque: "Uma chamada de tradução voltou com erro. A mensagem chega sem traduzir, e a próxima " +
      "tentativa costuma passar.",
    fazer: "Nada, se for esporádico. Se virar rotina, é hora de um motor com chave.",
  },
  {
    quando: /Unknown interaction/i,
    titulo: "Alguém clicou num botão vencido",
    precisaDeVoce: false,
    oque: "O Discord dá três segundos para o bot acusar um clique. Ou o clique veio de uma mensagem " +
      "antiga, ou o bot estava ocupado naquele instante.",
    fazer: "Nada. Quem clicou vê “Esta interação falhou” e resolve clicando de novo.",
  },
  {
    quando: /Unknown Message|Unknown Channel|Unknown Webhook/i,
    titulo: "Apagaram algo que eu ainda usava",
    precisaDeVoce: false,
    oque: "Um canal, uma mensagem ou um webhook que eu tinha anotado não existe mais — alguém apagou " +
      "na mão. Eu refaço sozinho na próxima varredura.",
    fazer: "Nada.",
  },
  {
    quando: /rate limit|Too Many Requests/i,
    titulo: "O Discord pediu para eu ir mais devagar",
    precisaDeVoce: false,
    oque: "Fiz chamadas demais em pouco tempo e o Discord segurou. A biblioteca espera e repete sozinha.",
    fazer: "Nada. Se aparecer muito, me avise: é sinal de que alguma rotina minha está trabalhando à toa.",
  },
];

function explicarErro(onde, porque) {
  const texto = `${onde} ${porque}`;
  return EXPLICA_ERRO.find((e) => e.quando.test(texto)) || null;
}

/* Nem todo erro e' do dono.

   "nao consegui dar o cargo" e' configuracao do servidor do CLIENTE: o cargo
   do bot esta abaixo do cargo da pessoa, e quem arruma e' um administrador de
   la', arrastando. O painel daquele cliente ja diz isso em vermelho, com o
   passo a passo.

   Mandar pro canal de erros do dono, a cada reinicio, e' barulho sobre algo
   que ele nao pode consertar -- e barulho no canal de erro tem um preco
   especifico: ensina a ignorar o canal. Estes continuam na lista do /admin,
   que e' onde se procura quando se quer procurar. */
const ERRO_DO_CLIENTE = [
  /nao consegui dar o cargo/i,
  /nao consegui tirar o cargo/i,
  /Missing Permissions/i,
  /Missing Access/i,
];

/* A hora no relogio de QUEM LE, nao no meu.

   A maquina roda em UTC, e eu formatava com toLocaleTimeString("pt-BR"): o
   cartao dizia 06:06 enquanto o Discord, dois centimetros ao lado, dizia
   03:06. Duas horas para o mesmo instante na mesma tela -- e a errada era a
   minha, com cara de certa porque estava em portugues.

   O <t:...> e' o formato do proprio Discord: mando o instante, cada pessoa ve
   no fuso dela. Ele nao vale em rodape nem em titulo, so' no corpo -- e onde
   a hora precisava ficar no rodape, quem resolve e' o campo `timestamp` do
   embed, que o Discord tambem desenha no fuso de quem le. */
function quandoFoi(ms = Date.now(), estilo = "T") {
  return `<t:${Math.floor(ms / 1000)}:${estilo}>`;
}

function anotarErro(onde, porque) {
  errosRecentes.push({ quando: Date.now(), onde, porque: String(porque || "").slice(0, 300) });
  if (errosRecentes.length > MAX_ERROS) errosRecentes.shift();

  const texto = `${onde} ${porque}`;
  if (ERRO_DO_CLIENTE.some((r) => r.test(texto))) return;

  const explicacao = explicarErro(onde, porque);

  /* A repeticao junta pela EXPLICACAO, nao pelo texto cru.

     O Supabase caiu por trinta segundos e saiu uma linha por servidor: seis
     mensagens seguidas dizendo a mesma coisa com um numero diferente no meio.
     Pra quem le, seis problemas. Era um. Agrupando pelo que aquilo QUER
     DIZER, o mesmo tombo vira uma mensagem, e a janela de silencio depois
     dela vale pro problema inteiro. */
  const chave = explicacao ? `explicado|${explicacao.titulo}` : `${onde}|${String(porque).slice(0, 60)}`;
  const ultimo = jaAvisado.get(chave) || 0;
  if (Date.now() - ultimo < ESPERA_AVISO) return;
  jaAvisado.set(chave, Date.now());

  if (!explicacao) {
    /* Erro que eu ainda nao sei explicar. Aparece cru e ASSUMIDO como cru --
       fingir gravidade que eu nao sei medir seria pedir preocupacao no
       escuro. */
    avisarNoPainel(CANAL_ERROS, {
      embeds: [{
        color: 0x9aa0a6,
        title: "❔ Um erro que eu ainda não sei explicar",
        description: `Me mostre esta mensagem e eu passo a explicar este aqui também.\n\n` +
          `\`\`\`\n${onde}: ${porque}\n\`\`\``,
        footer: { text: "sem tradução para o português ainda" },
        timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});
    return;
  }

  avisarNoPainel(CANAL_ERROS, {
    embeds: [{
      color: explicacao.precisaDeVoce ? 0xE03E3E : 0x9aa0a6,
      title: `${explicacao.precisaDeVoce ? "🔴" : "⚪"} ${explicacao.titulo}`,
      fields: [
        { name: "O que aconteceu", value: explicacao.oque.slice(0, 1000) },
        {
          name: explicacao.precisaDeVoce ? "O que fazer" : "Precisa de você?",
          value: (explicacao.precisaDeVoce ? "" : "**Não.** ") + explicacao.fazer.slice(0, 900),
        },
      ],
      footer: { text: `${onde}: ${String(porque).slice(0, 120)}` },
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});
}

const CANAL_NOVOS = "📥-novos";
const CANAL_PAGAMENTOS = "💳-pagamentos";
const CANAL_ERROS = "🐛-erros";
const CANAL_CLIENTES = "📋-clientes";
const CANAL_DIARIO = "📊-diário";

/* Quem pode abrir o painel do dono.

   Pergunto ao Discord de quem e' o aplicativo, em vez de guardar um id numa
   variavel. Id escrito na mao envelhece calado: no dia em que a conta mudar
   ou o app virar de um time, ninguem lembra de atualizar, e o painel some pro
   dono legitimo.

   Vou direto na API em vez de usar o objeto que o discord.js guarda. A
   primeira versao usava client.application.owner, e ele nem sempre vem
   preenchido -- quando nao vinha, meu catch devolvia "nao e' o dono" sem
   dizer nada, e o dono de verdade levava "Não conheço esse comando" na cara
   sem nenhuma pista do motivo. Foi o que aconteceu no primeiro teste.

   A lista "donos" nos ajustes existe pra quem tem mais de uma conta -- o caso
   comum de quem criou o aplicativo numa e usa o Discord noutra. */
let cacheDonos = { v: null, t: 0 };

async function idsDeDono() {
  if (cacheDonos.v && Date.now() - cacheDonos.t < 10 * 60 * 1000) return cacheDonos.v;
  const ids = new Set();
  try {
    const r = await fetch(`${API}/applications/@me`, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (r.ok) {
      const app = await r.json();
      if (app?.owner?.id) ids.add(String(app.owner.id));
      for (const m of app?.team?.members || []) if (m?.user?.id) ids.add(String(m.user.id));
    } else {
      console.error(`admin: nao consegui saber de quem e o aplicativo: HTTP ${r.status}`);
    }
  } catch (e) {
    console.error("admin: nao consegui saber de quem e o aplicativo:", e?.message || e);
  }
  for (const extra of String((await ajustes()).donos || "").split(/[,\s]+/)) {
    if (/^\d{5,}$/.test(extra)) ids.add(extra);
  }
  if (ids.size) cacheDonos = { v: ids, t: Date.now() };
  return ids;
}

async function ehDono(userId) {
  const ids = await idsDeDono();
  const pode = ids.has(String(userId));
  /* Recusa deixa rastro. Sem isto, "não conheço esse comando" e' indistinguivel
     de "eu nao consegui descobrir quem e' o dono" -- que foi exatamente a
     duvida que me custou tempo. */
  if (!pode) console.log(`admin: recusei ${userId}; donos conhecidos: ${[...ids].join(",") || "NENHUM"}`);
  return pode;
}

async function guildDoPainel() {
  return (await ajustes()).admin_guild || "";
}

async function ehOPainel(guildId) {
  return !!guildId && guildId === await guildDoPainel();
}

/* Nome de canal a partir do nome do servidor.

   Discord so' aceita minusculas, sem espaco e sem acento. Um servidor chamado
   "Servidor de 𝐹𝑒𝓇𝓃𝒶𝓃𝒹𝑜 †" vira "servidor-de-fernando" -- e se sobrar vazio
   (nome so' de simbolos, que existe), cai no id, que nunca e' vazio. */
function nomeDeCanal(nome, id) {
  const limpo = String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  return limpo || `servidor-${String(id).slice(-6)}`;
}

async function canalDoPainel(guild, nome, categoria) {
  const achado = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === nome);
  if (achado) return achado;
  return await guild.channels.create({
    name: nome, type: ChannelType.GuildText,
    ...(categoria ? { parent: categoria.id } : {}),
    reason: "painel de administração do CYRON",
  }).catch((e) => {
    console.error("painel: nao consegui criar", nome, e?.message || e);
    return null;
  });
}

/* O canal de pagamentos precisa de uma boca que a funcao do Stripe alcance.

   Quem recebe o aviso de pagamento e' a edge function, que roda no Supabase e
   nao fala com o gateway do Discord. Um webhook resolve: o bot cria, guarda a
   URL nos ajustes, e a funcao so' faz um POST. Sem isso o canal existiria
   mudo -- que foi como ele nasceu.

   Reaproveito o que ja existe: criar um webhook novo a cada volta do relogio
   encheria o canal de webhooks orfaos ate' bater no limite de 15. */
async function garantirWebhookDePagamentos(guild) {
  try {
    const a = await ajustes();
    if (a.webhook_pagamentos) return;

    const canal = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === CANAL_PAGAMENTOS);
    if (!canal) return;

    const existentes = await canal.fetchWebhooks().catch(() => null);
    const meu = existentes?.find((w) => w.owner?.id === client.user.id);
    const w = meu || await canal.createWebhook({ name: "CYRON pagamentos" });
    await porAjuste("webhook_pagamentos", w.url);
    console.log("painel: webhook de pagamentos pronto");
  } catch (e) {
    console.error("painel: nao consegui preparar o webhook de pagamentos:", e?.message || e);
  }
}

/* Acha o topico do cliente, ou abre um.

   Guardo o id, nunca procuro pelo nome: servidor muda de nome, e busca por
   nome vira topico duplicado no dia da primeira renomeacao.

   Uma semana de auto-arquivamento: quem esta em uso fica a vista, quem
   esfriou sai da frente sem sumir. */
async function topicoDoCliente(guild, canal, servidor) {
  if (servidor.canal_admin) {
    const achado = await guild.channels.fetch(servidor.canal_admin).catch(() => null);
    if (achado) return achado;
  }
  const topico = await canal.threads.create({
    name: nomeDeCanal(servidor.nome, servidor.guild_id).slice(0, 90),
    autoArchiveDuration: 10080,
    reason: "ficha do cliente no painel",
  }).catch((e) => {
    console.error("painel: nao consegui abrir o tópico:", e?.message || e);
    return null;
  });
  if (!topico) return null;
  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`,
    { canal_admin: topico.id, msg_admin: null });
  servidor.canal_admin = topico.id;
  servidor.msg_admin = null;
  return topico;
}

/* Escreve num canal de acontecimento, se o painel existir.

   Nunca estoura: um aviso administrativo que derruba a operacao seria o
   cumulo. Se o painel nao existe ainda, a linha simplesmente nao e' escrita --
   o dado de verdade esta no banco de qualquer jeito. */
async function avisarNoPainel(nomeCanal, texto) {
  try {
    const gid = await guildDoPainel();
    if (!gid) return;
    const guild = client.guilds.cache.get(gid);
    if (!guild) return;
    const canal = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === nomeCanal);
    if (!canal) return;
    const corpo = typeof texto === "string"
      ? { content: texto.slice(0, 1900) }
      : texto;
    await canal.send({ ...corpo, allowedMentions: { parse: [] } });
  } catch (e) {
    console.error("painel: nao consegui avisar em", nomeCanal, e?.message || e);
  }
}

/* O cartao de um cliente: o que ele tem, o que ele usa, como esta.

   Mesmo padrao do painel do cliente -- mensagem fixada que se EDITA. Um canal
   por cliente com dez mensagens de estado velhas seria pior que nenhum canal:
   a pessoa leria a de cima achando que e' a atual. */
async function cartaoDoCliente(guild, servidor) {
  if (!servidor.canal_admin) return;
  const canal = await guild.channels.fetch(servidor.canal_admin).catch(() => null);
  if (!canal) return;

  const uso = await usoDeHoje(servidor.id);
  const sete = await sb(
    `cyron_uso_diario?servidor_id=eq.${servidor.id}&dia=gte.${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)}&select=caracteres,traducoes`) || [];
  const soma = sete.reduce((a, l) => ({
    c: a.c + Number(l.caracteres || 0), t: a.t + Number(l.traducoes || 0),
  }), { c: 0, t: 0 });

  const idiomas = await sb(`discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma`) || [];
  const fontes = await sb(
    `discord_fonte_replica?servidor_id=eq.${servidor.id}&gera_replica=is.true&select=canal_id`) || [];
  const cliente = client.guilds.cache.get(String(servidor.guild_id));
  const plano = planoDe(servidor);

  const embed = {
    color: servidor.saiu_em ? 0x8A3A33 : plano === "pago" ? 0x2E8B7A : 0xB08A2E,
    title: servidor.nome || nomeDeCanal(servidor.nome, servidor.guild_id),
    description: servidor.saiu_em
      ? `⚠️ **Me tiraram deste servidor** ${quandoFoi(Date.parse(servidor.saiu_em), "R")}.`
      : `${cliente ? `${cliente.memberCount} membros` : "_não estou vendo este servidor agora_"}`,
    fields: [
      { name: "Plano", value: plano === "pago" ? "🟢 pago" : "⚪ grátis", inline: true },
      { name: "Idiomas", value: String(idiomas.length), inline: true },
      { name: "Canais traduzidos", value: String(fontes.length), inline: true },
      { name: "Hoje", value: `${uso.traducoes} traduções\n${(uso.caracteres / 1000).toFixed(1)}k caracteres`, inline: true },
      { name: "7 dias", value: `${soma.t} traduções\n${(soma.c / 1000).toFixed(1)}k caracteres`, inline: true },
      { name: "Motor", value: servidor.tradutor_motor && servidor.tradutor_motor !== "auto"
          ? `🔑 ${servidor.tradutor_motor}` : "⚪ google grátis", inline: true },
      /* O problema do cliente aparece na ficha DELE, e nao no canal de erros
         do dono. Aqui ele e' contexto -- "por isso este servidor tem idioma e
         nao tem gente nas categorias" --, e nao um chamado. */
      ...(cargoAcimaDeMim.has(servidor.id) ? [{
        name: "⛔ Cargo fora de alcance",
        value: "Os cargos de idioma estão acima do meu neste servidor. " +
          "Ninguém recebe cargo até um administrador de lá arrastar o CYRON para cima.",
      }] : []),
    ],
    footer: { text: `guild ${servidor.guild_id} · instalado em ${new Date(servidor.criado_em).toLocaleDateString("pt-BR")}` },
  };

  if (servidor.msg_admin) {
    const antiga = await canal.messages.fetch(servidor.msg_admin).catch(() => null);
    if (antiga) {
      const botoes = botoesDaFicha(servidor);
      const antes = antiga.embeds?.[0]
        ? assinaturaDoCartao(antiga.embeds[0].toJSON(), (antiga.components || []).map((l) => l.toJSON()))
        : null;
      if (antes === assinaturaDoCartao(embed, botoes)) return;   // nada mudou

      /* Desarquiva SO' quando ha' o que escrever. Desarquivar a cada volta do
         relogio deixaria todos os topicos sempre ativos, e a barra lateral
         voltaria a ser a parede que o topico veio evitar. */
      if (canal.archived) await canal.setArchived(false, "ficha mudou").catch(() => {});
      await antiga.edit({ embeds: [embed], components: botoes });
      return;
    }
  }
  if (canal.archived) await canal.setArchived(false, "primeira ficha").catch(() => {});
  const nova = await canal.send({ embeds: [embed], components: botoesDaFicha(servidor) });
  await nova.pin("ficha do cliente").catch(() => {});
  await apagarAvisoDeFixado(canal, nova.id);
  await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { msg_admin: nova.id });
  servidor.msg_admin = nova.id;
}

/* Monta o painel inteiro: canais de acontecimento, categoria e um canal por
   cliente. Roda junto da volta do relogio, entao cliente novo ganha canal
   sozinho -- e cliente que ja tem canal so' tem a ficha atualizada. */
/* Uma montagem por vez.

   O painel duplicou todos os topicos na primeira vez que foi usado: o clique
   do dono disparou uma montagem e o relogio disparou outra, e as duas leram
   "este cliente ainda nao tem topico" antes de qualquer uma gravar. Cada uma
   abriu o seu.

   E' exatamente o defeito que eu ja tinha corrigido na montagem dos canais de
   idioma -- e nao apliquei aqui. Corrigir num lugar e esquecer do outro e' o
   jeito mais comum de um bug voltar. */
let montandoPainel = false;

async function montarPainelDoDono() {
  if (montandoPainel) return;
  montandoPainel = true;
  try {
    await montarPainelDoDonoAgora();
  } finally {
    montandoPainel = false;
  }
}

async function montarPainelDoDonoAgora() {
  const gid = await guildDoPainel();
  if (!gid) return;
  const guild = client.guilds.cache.get(gid);
  if (!guild) return;

  for (const nome of [CANAL_NOVOS, CANAL_PAGAMENTOS, CANAL_ERROS, CANAL_DIARIO]) {
    await canalDoPainel(guild, nome, null);
  }
  const sala = await canalDoPainel(guild, CANAL_CLIENTES, null);
  if (!sala) return;

  await garantirWebhookDePagamentos(guild);

  const todos = await sb("cyron_servidor?select=*&order=criado_em.asc") || [];
  for (const servidor of todos) {
    if (String(servidor.guild_id) === gid) continue;   // o painel nao e' cliente
    try {
      const topico = await topicoDoCliente(guild, sala, servidor);
      if (topico) await cartaoDoCliente(guild, servidor);
    } catch (e) {
      console.error("painel: cliente", servidor.nome, e?.message || e);
    }
  }

  await limparTopicosOrfaos(sala, todos);
}

/* Topico meu que nao pertence a cliente nenhum: sobra de duplicacao.

   So' apago o que EU abri (ownerId meu) e que nao esta apontado por nenhuma
   linha. Topico que o dono criou na mao fica onde esta -- apagar o que nao e'
   meu, num servidor que e' dele, seria passar por cima de uma decisao que nao
   me pertence. */
async function limparTopicosOrfaos(sala, servidores) {
  try {
    const meus = new Set(servidores.map((s) => s.canal_admin).filter(Boolean));
    const ativos = await sala.threads.fetchActive().catch(() => null);
    const velhos = await sala.threads.fetchArchived({ limit: 100 }).catch(() => null);

    for (const lista of [ativos?.threads, velhos?.threads]) {
      for (const [, t] of lista || []) {
        if (meus.has(t.id)) continue;
        if (t.ownerId !== client.user.id) continue;
        await t.delete("tópico duplicado do painel").catch(() => {});
        console.log(`painel: apaguei o tópico duplicado ${t.name}`);
      }
    }
  } catch (e) {
    console.error("painel: nao consegui limpar duplicados:", e?.message || e);
  }
}

/* O /admin: a metade do painel que responde perguntas.

   Canal por cliente mostra o historico de UM cliente. Aqui ficam as respostas
   que exigem olhar todos de uma vez -- quem usa mais, quantos existem, o que
   quebrou. E' de proposito que sejam duas coisas: tentar fazer a lista de
   canais responder isso e' o que ia frustrar em duas semanas. */
async function comandoAdmin(inter) {
  if (!await ehDono(inter.user.id)) {
    /* Nao digo "voce nao e' o dono" -- digo que o comando nao existe pra
       quem pergunta. Confirmar que existe um painel de dono e' contar metade
       do caminho pra quem estava tateando. */
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }

  await inter.deferReply({ flags: 64 });

  const gid = await guildDoPainel();
  if (!gid) {
    return inter.editReply({
      content: "Este servidor ainda não é o seu painel. Quer usar **este aqui** para acompanhar os clientes?",
      components: [{ type: 1, components: [
        { type: 2, custom_id: "admin:aqui", style: 3, emoji: { name: "📋" }, label: "Usar este servidor como painel" },
      ] }],
    });
  }

  return inter.editReply({ embeds: [await embedDoResumo()], components: linhasDoAdmin() });
}

function linhasDoAdmin() {
  return [{ type: 1, components: [
    { type: 2, custom_id: "admin:resumo", style: 2, emoji: { name: "📊" }, label: "Resumo" },
    { type: 2, custom_id: "admin:uso", style: 2, emoji: { name: "🏆" }, label: "Quem usa mais" },
    { type: 2, custom_id: "admin:erros", style: 2, emoji: { name: "🐛" }, label: "Erros" },
    { type: 2, custom_id: "admin:codigos", style: 1, emoji: { name: "🎟️" }, label: "Gerar códigos" },
    { type: 2, custom_id: "admin:remontar", style: 2, emoji: { name: "🔄" }, label: "Remontar painel" },
  ] }, { type: 1, components: [
    { type: 2, custom_id: "admin:saude", style: 2, emoji: { name: "🩺" }, label: "Saúde" },
    { type: 2, custom_id: "admin:busca", style: 2, emoji: { name: "🔎" }, label: "Procurar" },
    { type: 2, custom_id: "admin:ajustes", style: 1, emoji: { name: "⚙️" }, label: "Ajustes" },
    { type: 2, style: 5, emoji: { name: "➕" }, label: "Link para instalar o CYRON", url: linkDeConvite() },
  /* Fileira propria porque cinco e' o teto do Discord por fileira, e a de
     cima ja' estava cheia. Estourar isso nao avisa bonito: a mensagem
     inteira e' recusada, e o painel some. */
  ] }, { type: 1, components: [
    { type: 2, custom_id: "admin:chaves", style: 1, emoji: { name: "🔑" }, label: "Chaves de tradução" },
    { type: 2, custom_id: "admin:comandos", style: 2, emoji: { name: "🧪" }, label: "Meus comandos" },
    { type: 2, custom_id: "admin:novocomando", style: 4, emoji: { name: "➕" }, label: "Novo comando" },
  ] }];
}

async function embedDoResumo() {
  const todos = await sb("cyron_servidor?select=id,nome,plano,pago_ate,teste_ate,saiu_em") || [];
  const dentro = todos.filter((s) => !s.saiu_em);
  const pagos = dentro.filter((s) => s.plano === "pago" || venceEm(s.pago_ate));
  const hoje = await sb(
    `cyron_uso_diario?dia=eq.${hojeISO()}&select=caracteres,traducoes,do_cache`) || [];
  const soma = hoje.reduce((a, l) => ({
    c: a.c + Number(l.caracteres || 0), t: a.t + Number(l.traducoes || 0), k: a.k + Number(l.do_cache || 0),
  }), { c: 0, t: 0, k: 0 });
  const codigos = await sb("cyron_codigo?usado_em=is.null&select=codigo") || [];

  return {
    color: 0x2E8B7A,
    title: "📊 CYRON — resumo",
    fields: [
      { name: "Servidores", value: `**${dentro.length}** ativos\n${todos.length - dentro.length} saíram`, inline: true },
      { name: "Pagantes", value: `**${pagos.length}**${BETA || venceEm(BETA_ATE) ? "\n_beta: todos com limites do pago_" : ""}`, inline: true },
      { name: "Códigos livres", value: String(codigos.length), inline: true },
      { name: "Traduzido hoje", value: soma.t
          ? `**${soma.t}** traduções · ${(soma.c / 1000).toFixed(1)}k caracteres\n${soma.k} vieram do cache`
          : "_nada ainda_" },
      { name: "Erros guardados", value: errosRecentes.length ? `${errosRecentes.length} — veja em 🐛` : "_nenhum_", inline: true },
    ],
    footer: { text: "os contadores zeram quando eu reinicio" },
  };
}

async function embedDeUso() {
  const desde = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const linhas = await sb(`cyron_uso_diario?dia=gte.${desde}&select=servidor_id,caracteres,traducoes`) || [];
  const nomes = new Map((await sb("cyron_servidor?select=id,nome") || []).map((s) => [s.id, s.nome]));

  const por = new Map();
  for (const l of linhas) {
    const a = por.get(l.servidor_id) || { c: 0, t: 0 };
    a.c += Number(l.caracteres || 0); a.t += Number(l.traducoes || 0);
    por.set(l.servidor_id, a);
  }
  const ranking = [...por.entries()].sort((a, b) => b[1].c - a[1].c).slice(0, 15);

  return {
    color: 0x2E8B7A,
    title: "🏆 Quem mais traduziu — últimos 7 dias",
    description: ranking.length
      ? ranking.map(([id, v], i) =>
          `**${i + 1}.** ${nomes.get(id) || id} — ${(v.c / 1000).toFixed(1)}k caracteres · ${v.t} traduções`).join("\n")
      : "_ninguém traduziu nada nos últimos 7 dias_",
  };
}

function embedDeErros() {
  return {
    color: errosRecentes.length ? 0xB4534A : 0x2E8B7A,
    title: "🐛 Últimos erros do bot",
    description: errosRecentes.length
      ? errosRecentes.slice(-12).reverse().map((e) =>
          `${quandoFoi(e.quando)} **${e.onde}**\n${e.porque.slice(0, 140)}`).join("\n\n").slice(0, 3800)
      : "_nenhum erro desde que subi_",
    footer: { text: "guardados em memória; somem quando eu reinicio" },
  };
}

function janelaDeCodigos() {
  return {
    custom_id: "admin:codigos",
    title: "Gerar códigos de ativação",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "quantos", style: 1, required: true, max_length: 3,
        label: "Quantos códigos", placeholder: "5" }] },
      { type: 1, components: [{ type: 4, custom_id: "dias", style: 1, required: true, max_length: 4,
        label: "Dias de plano pago cada um", placeholder: "31" }] },
      { type: 1, components: [{ type: 4, custom_id: "nota", style: 1, required: false, max_length: 80,
        label: "Anotação (para você lembrar)", placeholder: "venda PIX - fulano" }] },
    ],
  };
}

async function cliqueAdmin(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  const acao = inter.customId.slice("admin:".length);

  if (acao === "codigos" && inter.isButton()) return inter.showModal(janelaValida(janelaDeCodigos()));
  if (acao === "ajustes" && inter.isButton()) return inter.showModal(janelaValida(await janelaDeAjustes()));
  if (acao === "chaves" && inter.isButton()) return inter.showModal(janelaValida(await janelaDasChaves()));
  if (acao === "novocomando" && inter.isButton()) {
    return inter.showModal(janelaValida(await janelaDeComando(null)));
  }
  if (acao === "comandos" && inter.isButton()) {
    await inter.deferUpdate();
    const { embed, componentes } = await listaDeComandos(inter.guildId);
    return inter.followUp({ flags: 64, embeds: [embed], components: componentes });
  }
  /* Abrir um comando que ja' existe pra editar.

     Isto NAO existia, e a falta era invisivel: a lista mostrava os comandos e
     nao levava a lugar nenhum, e o unico jeito de editar era clicar em "Novo
     comando" e digitar o mesmo nome de cabeca. Quem nao sabia disso -- eu
     inclusive, que mandei o dono "abrir o reino na lista" -- clicava, lia, e
     saia achando que tinha editado. */
  if (acao === "abrircomando" && inter.isStringSelectMenu()) {
    const escolhido = (await comandosDoDono(inter.guildId))
      .find((c) => c.nome === inter.values?.[0]);
    if (!escolhido) {
      return inter.reply({ flags: 64, content: "Esse comando não existe mais aqui." }).catch(() => {});
    }
    /* showModal exige interacao ainda nao respondida -- por isso este ramo vem
       antes do deferUpdate la' embaixo. */
    return inter.showModal(janelaValida(await janelaDeComando(escolhido)));
  }
  if (acao === "busca" && inter.isButton()) return inter.showModal(janelaValida(janelaDeBusca()));

  await inter.deferUpdate();

  if (acao === "aqui") {
    await porAjuste("admin_guild", inter.guildId);
    await arrumarOndeMoraOAdmin();
    await montarPainelDoDono();
    return inter.editReply({
      content: "📋 Pronto. Este servidor virou o seu painel: criei os canais de acontecimento e um canal por cliente.",
      embeds: [await embedDoResumo()], components: linhasDoAdmin(),
    });
  }
  if (acao === "remontar") {
    await montarPainelDoDono();
    return inter.editReply({ embeds: [await embedDoResumo()], components: linhasDoAdmin() });
  }
  if (acao === "uso") return inter.editReply({ embeds: [await embedDeUso()], components: linhasDoAdmin() });
  if (acao === "erros") return inter.editReply({ embeds: [embedDeErros()], components: linhasDoAdmin() });
  if (acao === "saude") return inter.editReply({ embeds: [await embedDeSaude()], components: linhasDoAdmin() });
  return inter.editReply({ embeds: [await embedDoResumo()], components: linhasDoAdmin() });
}

async function gerarCodigos(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  await inter.deferReply({ flags: 64 });
  const campo = (n) => { try { return String(inter.fields.getTextInputValue(n) || "").trim(); } catch { return ""; } };
  const quantos = Math.min(50, Math.max(1, parseInt(campo("quantos"), 10) || 0));
  const dias = Math.min(3650, Math.max(1, parseInt(campo("dias"), 10) || 0));
  if (!quantos || !dias) return inter.editReply("Quantidade e dias precisam ser números.");

  try {
    const r = await rpc("cyron_criar_codigos", { p_quantos: quantos, p_dias: dias, p_nota: campo("nota") || null });
    const lista = (r || []).map((x) => x.codigo);
    /* Efemero de proposito: codigo postado num canal e' codigo que outra
       pessoa resgata primeiro -- inclusive no seu proprio painel. */
    return inter.editReply(
      `🎟️ **${lista.length} códigos de ${dias} dias:**\n\`\`\`\n${lista.join("\n")}\n\`\`\`` +
      "\n_Só você está vendo isto. Copie agora: eu não mostro de novo._");
  } catch (e) {
    console.error("admin: nao consegui gerar codigos:", e?.message || e);
    return inter.editReply("❌ Não consegui gerar agora. Nada foi criado.");
  }
}

/* ---------------- o painel que AGE ----------------

   A primeira versao mostrava e nao fazia. Ficha de cliente sem botao e'
   relatorio: pra dar trinta dias a alguem eu ainda precisava abrir o banco,
   e pra trocar o link de pagamento precisava de um deploy meu -- ou seja, o
   dono dependia de mim pra qualquer decisao de negocio. */

/* Convite do bot, com as permissoes que ele realmente usa.

   Hoje o CYRON esta com Administrator nos servidores onde foi instalado, e
   isso e' o que mais assusta quem vai instalar: o Discord mostra em vermelho.
   O numero abaixo e' a soma exata do que o codigo exerce -- criar canal,
   mexer em cargo de idioma, abrir webhook, fixar mensagem, abrir topico.
   Nada alem disso.

   Trocar o convite nao rebaixa quem ja instalou: permissao concedida fica
   como esta ate' o dono do servidor mexer. Vale pros proximos. */
const PERMISSOES_DO_CONVITE = "327223209040";

function linkDeConvite() {
  return `https://discord.com/oauth2/authorize?client_id=${client.user.id}` +
    `&permissions=${PERMISSOES_DO_CONVITE}&scope=bot%20applications.commands`;
}

/* Botoes da ficha do cliente.

   O id do servidor vai no proprio botao. Sem isso eu teria que descobrir de
   quem e' a ficha pelo topico em que o clique aconteceu -- que funciona ate' o
   dia em que alguem arrasta a mensagem, e falha calado. */
function botoesDaFicha(servidor) {
  return [{ type: 1, components: [
    { type: 2, custom_id: `cli:mais30:${servidor.id}`, style: 3, emoji: { name: "➕" }, label: "30 dias" },
    { type: 2, custom_id: `cli:tirar:${servidor.id}`, style: 4, emoji: { name: "🚫" }, label: "Tirar plano" },
    { type: 2, custom_id: `cli:remontar:${servidor.id}`, style: 2, emoji: { name: "🔄" }, label: "Remontar" },
    { type: 2, custom_id: `cli:detalhes:${servidor.id}`, style: 2, emoji: { name: "🔍" }, label: "Detalhes" },
  ] }];
}

async function cliqueDaFicha(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  const [, acao, servidorId] = inter.customId.split(":");
  const servidor = (await sb(`cyron_servidor?id=eq.${encodeURIComponent(servidorId)}&select=*`))?.[0];
  if (!servidor) {
    return inter.reply({ flags: 64, content: "Não achei esse servidor no banco. A ficha está velha." });
  }

  await inter.deferReply({ flags: 64 });
  const guild = client.guilds.cache.get(String(servidor.guild_id));

  if (acao === "mais30") {
    const base = venceEm(servidor.pago_ate) || Date.now();
    const novo = new Date(base + 30 * 864e5).toISOString();
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`, { pago_ate: novo });
    cacheServidor.delete(String(servidor.guild_id));
    await refazerFicha(servidor.id);
    return inter.editReply(`➕ **${servidor.nome}** agora está pago até ${new Date(novo).toLocaleDateString("pt-BR")}.`);
  }

  if (acao === "tirar") {
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`,
      { pago_ate: null, teste_ate: null, plano: "gratis" });
    cacheServidor.delete(String(servidor.guild_id));
    await refazerFicha(servidor.id);
    /* Diz o que NAO aconteceu. Tirar o plano nao apaga canal nenhum, e quem
       aperta precisa saber disso antes de entrar em panico. */
    return inter.editReply(
      `🚫 **${servidor.nome}** voltou ao plano grátis.\n` +
      "_Nada foi apagado lá: o que passa do limite apenas para de crescer._" +
      (BETA || venceEm(BETA_ATE) ? "\n⚠️ O beta está ligado, então ele continua com os limites do pago." : ""));
  }

  if (acao === "remontar") {
    if (!guild) return inter.editReply("Não estou nesse servidor agora — não tenho o que remontar.");
    await sincronizarAgora(guild);
    await refazerFicha(servidor.id);
    return inter.editReply(`🔄 Passei por **${servidor.nome}**: canais, categorias e cargos.`);
  }

  if (acao === "detalhes") {
    const fontes = await sb(
      `discord_fonte_replica?servidor_id=eq.${servidor.id}&select=canal_id,tipo,gera_replica&order=criado_em.asc`) || [];
    const salas = await sb(`discord_chat_espelho?servidor_id=eq.${servidor.id}&select=idioma,canal_id`) || [];
    const replicas = await sb(`discord_canal_idioma?servidor_id=eq.${servidor.id}&select=tipo`) || [];
    const nomeDoCanal = (id) => guild?.channels?.cache?.get(id)?.name || id;

    return inter.editReply({ embeds: [{
      color: 0x2E8B7A,
      title: `🔍 ${servidor.nome}`,
      fields: [
        { name: "Canais-fonte", value: fontes.length
            ? fontes.map((f) => `${f.gera_replica ? "•" : "◦"} #${nomeDoCanal(f.canal_id)} _(${f.tipo})_`).join("\n").slice(0, 1000)
            : "_nenhum_" },
        { name: "Idiomas", value: salas.length ? salas.map((s) => nomeDoIdioma(s.idioma)).join(", ") : "_nenhum_" },
        { name: "Cópias criadas", value: String(replicas.length), inline: true },
        { name: "Tradutor por mensagem", value: servidor.tradutor_topico ? "ligado" : "desligado", inline: true },
        { name: "Assinatura Stripe", value: servidor.stripe_assinatura || "_nenhuma_", inline: true },
      ],
      footer: { text: "◦ = canal que só empresta o nome, não gera cópia" },
    }] });
  }
}

/* Redesenha a ficha de UM cliente, sem varrer todos.

   Depois de uma acao, a ficha ao lado do botao precisa mudar na hora -- senao
   a pessoa aperta "30 dias", ve o mesmo cartao de antes e aperta de novo. */
async function refazerFicha(servidorId) {
  try {
    const gid = await guildDoPainel();
    const guild = gid && client.guilds.cache.get(gid);
    if (!guild) return;
    const servidor = (await sb(`cyron_servidor?id=eq.${encodeURIComponent(servidorId)}&select=*`))?.[0];
    if (servidor) await cartaoDoCliente(guild, servidor);
  } catch (e) {
    console.error("painel: nao consegui refazer a ficha:", e?.message || e);
  }
}

/* Ajustes do sistema, num formulario.

   Sao as decisoes que hoje exigem um deploy meu. Cada campo vem preenchido
   com o que esta valendo: formulario em branco faz a pessoa apagar sem querer
   o que ja estava certo. */
/* As chaves de tradução do dono.

   Janela separada da de ajustes porque aquela ja' esta com cinco campos, que
   e' o teto do Discord por formulario -- e porque chave e configuracao sao
   coisas diferentes: uma se digita uma vez e se esquece, a outra se mexe.

   O campo volta VAZIO mesmo com chave gravada, de proposito. Devolver a chave
   pra tela seria mostra-la a quem abrir o painel, e formulario nao e' lugar de
   guardar segredo -- o estado ("tenho" ou "nao tenho") aparece no rotulo, que
   basta pra saber o que fazer. */
async function janelaDasChaves() {
  const a = await ajustes();
  /* O rotulo diz de ONDE veio a chave. Sem isso o painel mostraria "não
     tenho" para uma chave que esta no cofre e funcionando, e a pessoa colaria
     outra por cima achando que faltava. */
  const tem = (tipo) => {
    if (process.env[`${tipo.toUpperCase()}_CHAVE`]) return " (no cofre da máquina)";
    return a[`${tipo}_chave`] ? " (tenho uma; escreva pra trocar)" : "";
  };
  return {
    custom_id: "admin:chaves",
    title: "Chaves de tradução (reserva)",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "azure_chave", style: 1, required: false, max_length: 200,
        label: `Azure${tem("azure")}`.slice(0, 45),
        placeholder: "2 milhões de caracteres por mês, de graça" }] },
      { type: 1, components: [{ type: 4, custom_id: "azure_regiao", style: 1, required: false, max_length: 40,
        label: "Região da Azure",
        placeholder: "brazilsouth",
        ...(a.azure_regiao ? { value: a.azure_regiao } : {}) }] },
      { type: 1, components: [{ type: 4, custom_id: "deepl_chave", style: 1, required: false, max_length: 200,
        label: `DeepL${tem("deepl")}`.slice(0, 45),
        placeholder: "a chave grátis termina em :fx" }] },
      { type: 1, components: [{ type: 4, custom_id: "apagar", style: 1, required: false, max_length: 20,
        label: "Apagar alguma? (azure, deepl)",
        placeholder: "vazio mantém as duas" }] },
    ],
  };
}

async function salvarChaves(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  await inter.deferReply({ flags: 64 });
  const campo = (n) => { try { return String(inter.fields.getTextInputValue(n) || "").trim(); } catch { return ""; } };
  const apagar = campo("apagar").toLowerCase();
  const feito = [];

  for (const tipo of ["azure", "deepl"]) {
    if (apagar.includes(tipo)) {
      await porAjuste(`${tipo}_chave`, null);
      feito.push(`🗑️ ${tipo}: apagada`);
      continue;
    }
    const nova = campo(`${tipo}_chave`);
    if (!nova) continue;
    /* Cifrada antes de encostar no banco, igual as dos clientes. */
    await porAjuste(`${tipo}_chave`, cifrar(nova));
    feito.push(`🔑 ${tipo}: guardada`);
  }
  const regiao = campo("azure_regiao");
  if (regiao) { await porAjuste("azure_regiao", regiao); feito.push("📍 região da Azure gravada"); }

  await recarregarAjustes();
  return inter.editReply(feito.length
    ? `${feito.join("\n")}\n\nEla entra **só quando o gratuito recusar** — é reserva, não substituto. ` +
      "Assim a cota do mês fica guardada para o dia em que fizer falta."
    : "Nada mudou — todos os campos vieram vazios.");
}

async function janelaDeAjustes() {
  const a = await ajustes();
  const cheio = (v) => (v ? { value: String(v).slice(0, 300) } : {});
  return {
    custom_id: "admin:ajustes",
    title: "Ajustes do CYRON",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "stripe_link", style: 1, required: false, max_length: 300,
        label: "Link de pagamento", placeholder: "https://buy.stripe.com/...", ...cheio(a.stripe_link || LINK_PAGAMENTO) }] },
      { type: 1, components: [{ type: 4, custom_id: "beta", style: 1, required: false, max_length: 12,
        label: "Beta ligado? (1 ou 0)", placeholder: "1", ...cheio(a.beta ?? (BETA ? "1" : "0")) }] },
      { type: 1, components: [{ type: 4, custom_id: "beta_ate", style: 1, required: false, max_length: 12,
        label: "Beta acaba em (AAAA-MM-DD, vazio = sem data)", placeholder: "2027-03-31", ...cheio(a.beta_ate) }] },
      { type: 1, components: [{ type: 4, custom_id: "donos", style: 1, required: false, max_length: 200,
        label: "Outras contas suas (ids)", placeholder: "866033442688073748, 577245717114912830", ...cheio(a.donos) }] },
      /* Uma linha por tradutor de reserva. Fica aqui, e nao no codigo, porque
         instancia publica morre: das oito que testei, sete estavam fora do ar.
         Trocar um endereco tem que ser digitar, nao publicar. */
      { type: 1, components: [{ type: 4, custom_id: "tradutores_extras", style: 2, required: false, max_length: 600,
        label: "Tradutores de reserva (formato|endereço)",
        placeholder: "lingva|https://lingva.dialectapp.org\nlibre|https://libretranslate.exemplo.com",
        ...cheio(a.tradutores_extras) }] },
    ],
  };
}

async function salvarAjustes(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  await inter.deferReply({ flags: 64 });
  const campo = (n) => { try { return String(inter.fields.getTextInputValue(n) || "").trim(); } catch { return ""; } };

  const beta_ate = campo("beta_ate");
  if (beta_ate && !/^\d{4}-\d{2}-\d{2}$/.test(beta_ate)) {
    return inter.editReply("A data do beta precisa ser AAAA-MM-DD. **Não gravei nada.**");
  }
  const link = campo("stripe_link");
  if (link && !/^https:\/\//.test(link)) {
    return inter.editReply("O link de pagamento precisa começar com https://. **Não gravei nada.**");
  }

  /* Confere ANTES de gravar, e diz qual linha esta errada.

     Sem isto a linha ruim seria descartada em silencio na leitura, e o painel
     mostraria uma reserva configurada que nunca e' chamada -- mentira exata
     sobre o que esta protegendo o servidor. */
  const extras = campo("tradutores_extras");
  const linhasRuins = String(extras).split(/[\n,]+/)
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => !tradutoresDoPainel(l).length);
  if (linhasRuins.length) {
    return inter.editReply(
      `Não entendi ${linhasRuins.length === 1 ? "esta linha" : "estas linhas"} de tradutor:\n` +
      linhasRuins.map((l) => `\`${l.slice(0, 80)}\``).join("\n") +
      "\n\nO formato é `lingva|https://...` ou `libre|https://...`, e o endereço precisa ser **https**. " +
      "**Não gravei nada.**");
  }

  for (const [chave, valor] of [
    ["stripe_link", link], ["beta", campo("beta")], ["beta_ate", beta_ate], ["donos", campo("donos")],
    ["tradutores_extras", extras],
  ]) {
    await porAjuste(chave, valor || null);
  }
  cacheDonos = { v: null, t: 0 };

  return inter.editReply(
    "⚙️ Ajustes gravados. Valem na próxima volta do relógio, no máximo um minuto.\n" +
    (campo("beta") === "0" ? "_Beta desligado: os servidores voltam aos limites do plano deles._" : ""));
}

/* Saude do sistema: o que o dono so' descobriria por reclamacao.

   As telas de antes contam o que os clientes fazem. Esta conta o que EU estou
   fazendo -- se a volta do relogio esta acontecendo, se o tradutor esta
   respondendo, quantas vezes ele falhou. Sem isto, "o bot esta lento" chega
   pelo cliente, e nao pelo painel. */
let ultimaPassada = 0;
let duracaoPassada = 0;
const tradutorFalhas = { erros: 0, quedas: 0, ultimoErro: "" };

/* Os campos de cota, um por chave sua que souber responder.

   Ao vivo, e nao pela leitura guardada da hora em hora: quem abre esta tela
   quer o numero de AGORA, e costuma abrir justamente depois de receber o
   aviso. Quem le e' o mesmo COTA_DE que a vigia usa -- havia duas funcoes
   perguntando a mesma coisa ao DeepL, e duas envelhecem em direcoes
   diferentes. */
async function camposDeCota() {
  const campos = [];
  for (const reserva of motoresDoDono()) {
    const nome = MOTORES[reserva.tipo]?.nome || reserva.tipo;
    if (!COTA_DE[reserva.tipo]) {
      campos.push({ name: `Cota da ${nome}`, value: "_ela não informa por aqui — veja no portal.azure.com_" });
      continue;
    }
    try {
      const c = await COTA_DE[reserva.tipo](reserva);
      campos.push({ name: `Cota da ${nome} neste mês`, value: c ? barraDeCota(c) : "sem teto informado" });
    } catch (e) {
      campos.push({ name: `Cota da ${nome} neste mês`,
        value: `_não consegui perguntar: ${String(e.message || e).slice(0, 60)}_` });
    }
  }
  return campos;
}

/* ---------------- como foi o dia ----------------

   O canal de erros conta o que quebrou. Nada contava o que FUNCIONOU -- e a
   diferenca entre "o bot esta otimo" e "o bot esta mudo ha seis horas" era
   alguem abrir o Discord e reparar.

   E' empurrado, nao consultado. Tela que so' aparece quando se pergunta so'
   informa quem ja' desconfiava; o que falta e' a linha que chega sozinha no
   dia em que o numero cai pela metade.

   O dia que ele resume e' o que ACABOU, nao o de hoje: um resumo do dia
   corrente muda toda hora e nao serve pra comparar com o de ontem. */
function ontemISO() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/* As linhas `sem:*` ficam de fora da soma.

   Elas moram na mesma tabela e no mesmo campo `traducoes`, porque contam na
   mesma unidade -- traducoes que deviam ter acontecido. Somar junto faria o
   cartao dizer que traduziu o que justamente NAO traduziu. */
function somaDoDia(linhas) {
  return (linhas || []).filter((l) => !String(l.motor || "").startsWith("sem:")).reduce((a, l) => ({
    c: a.c + Number(l.caracteres || 0),
    t: a.t + Number(l.traducoes || 0),
    k: a.k + Number(l.do_cache || 0),
  }), { c: 0, t: 0, k: 0 });
}

/* Quanto variou de um dia pro outro, em texto.

   Sem a comparacao o cartao e' so um numero, e numero sozinho nao diz se esta
   bom: "1.430 traducoes" nao alarma ninguem, "1.430, sete vezes ontem" sim. */
function variacao(hoje, ontem) {
  if (!ontem) return hoje ? " _(primeiro dia com dado)_" : "";
  const pct = Math.round(((hoje - ontem) / ontem) * 100);
  if (Math.abs(pct) < 5) return " _(estável)_";
  return ` ${pct > 0 ? "▲" : "▼"} **${Math.abs(pct)}%** vs. o dia anterior`;
}

/* Contar linha sem trazer linha.

   O cartao de ontem disse "1000 cópias entregues" e eu quase acreditei: mil e
   redondo. Nao era o numero, era o TETO -- o PostgREST devolve no maximo mil
   linhas por consulta, e contar o que voltou conta o limite dele. Tinham sido
   1.777.

   Erro pior do que parece porque mente pra baixo e nunca pra cima: no dia em
   que o movimento dobrar, o cartao vai continuar dizendo mil, e a leitura vai
   ser "estamos estaveis" justamente quando nao estamos. E de quebra trazia mil
   linhas pela rede so' pra jogar fora.

   `Prefer: count=exact` faz o total vir no cabecalho, e `Range: 0-0` faz o
   corpo vir vazio. */
function totalDaFaixa(cabecalho) {
  const depois = String(cabecalho || "").split("/")[1];
  const n = Number(depois);
  return Number.isFinite(n) ? n : null;
}

async function contar(caminho) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
      method: "HEAD",
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        Prefer: "count=exact", Range: "0-0",
      },
    });
    if (!r.ok) return null;
    return totalDaFaixa(r.headers.get("content-range"));
  } catch {
    return null; // cartao com um campo vazio e' melhor que cartao nenhum
  }
}

async function cartaoDoDia() {
  const dia = ontemISO();
  const anterior = new Date(Date.parse(dia) - 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [linhasDoDia, linhasDeAntes, copias, servidores] = await Promise.all([
    sb(`cyron_uso_diario?dia=eq.${dia}&select=caracteres,traducoes,do_cache,motor`).catch(() => null),
    sb(`cyron_uso_diario?dia=eq.${anterior}&select=caracteres,traducoes,do_cache`).catch(() => null),
    contar(`discord_fala_espelhada?criado_em=gte.${dia}T00:00:00Z&criado_em=lt.${dia}T23:59:59Z&select=msg_id`),
    contar("cyron_servidor?saiu_em=is.null&select=id"),
  ]);

  const hoje = somaDoDia(linhasDoDia);
  const ontem = somaDoDia(linhasDeAntes);

  /* Qual motor carregou o dia. Importa porque "tudo no gratuito" e "tudo na
     sua chave" custam coisas diferentes e quebram de jeitos diferentes. */
  const porMotor = new Map();
  for (const l of linhasDoDia || []) {
    if (String(l.motor || "").startsWith("sem:")) continue;
    porMotor.set(l.motor, (porMotor.get(l.motor) || 0) + Number(l.traducoes || 0));
  }
  const motores = [...porMotor.entries()].sort((a, b) => b[1] - a[1])
    .map(([m, t]) => `\`${m}\` ${t}`).join(" · ") || "_ninguém traduziu_";

  /* O que NAO foi traduzido, e por quê. Este é o número que faltava: até
     ontem, uma fala grande demais sumia sem deixar rastro em lugar nenhum. */
  const perdidas = new Map();
  for (const l of linhasDoDia || []) {
    const m = String(l.motor || "");
    if (m.startsWith("sem:")) perdidas.set(m.slice(4), (perdidas.get(m.slice(4)) || 0) + Number(l.traducoes || 0));
  }
  const NOME_DO_MOTIVO = { tamanho: "grandes demais", desenho: "desenho", recusa: "tradutor recusou" };
  const totalPerdidas = [...perdidas.values()].reduce((a, b) => a + b, 0);
  const detalhePerdidas = [...perdidas.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, q]) => `${q} ${NOME_DO_MOTIVO[m] || m}`).join(" · ");

  const cota = comoEstaACota().map((c) => `**${MOTORES[c.tipo]?.nome || c.tipo}** ${c.pct}%`).join(" · ");
  const parado = !hoje.t && !copias;

  return {
    color: parado ? 0xB4534A : 0x2E8B7A,
    title: `📊 ${dia} — como foi o dia`,
    description: parado
      ? "**Nenhuma tradução e nenhuma mensagem espelhada neste dia.** Se o dia não foi " +
        "feriado no seu servidor, vale conferir se eu estive de pé."
      : undefined,
    fields: [
      { name: "Mensagens espelhadas", inline: true,
        value: copias == null ? "_não consegui contar_" : `**${copias}** cópias entregues` },
      { name: "Traduções", inline: true,
        value: `**${hoje.t}**${variacao(hoje.t, ontem.t)}\n${hoje.k} vieram do cache` },
      { name: "Caracteres", inline: true,
        value: `**${(hoje.c / 1000).toFixed(1)}k**${variacao(hoje.c, ontem.c)}` },
      { name: "Quem traduziu", value: motores },
      ...(totalPerdidas ? [{ name: "Sem tradução",
        value: `**${totalPerdidas}** traduções não aconteceram\n${detalhePerdidas}` }] : []),
      ...(cota ? [{ name: "Cota do mês", value: cota }] : []),
      { name: "Servidores ativos", inline: true, value: servidores == null ? "—" : String(servidores) },
      { name: "De pé desde", inline: true, value: quandoFoi(Date.now() - process.uptime() * 1000, "R") },
    ],
    footer: { text: "um por dia, sobre o dia que terminou" },
    timestamp: new Date().toISOString(),
  };
}

/* Publica o cartao uma vez por dia.

   Quem lembra que ja' publicou e' o CANAL, nao a memoria: o bot reinicia toda
   vez que eu publico, e uma variavel guardando "ja' mandei hoje" voltaria zerada
   -- o canal ganharia um cartao por deploy. Entao antes de mandar eu olho as
   ultimas mensagens de la' e procuro o cartao com o titulo daquele dia. */
async function talvezOCartaoDoDia() {
  const gid = await guildDoPainel();
  if (!gid) return;
  const guild = client.guilds.cache.get(gid);
  if (!guild) return;
  const canal = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === CANAL_DIARIO);
  if (!canal) return;

  const dia = ontemISO();
  const ultimas = await canal.messages.fetch({ limit: 15 }).catch(() => null);
  if (!ultimas) return;
  const jaTem = [...ultimas.values()].some((m) => m.author.id === client.user.id
    && (m.embeds?.[0]?.title || "").includes(dia));
  if (jaTem) return;

  await canal.send({ embeds: [await cartaoDoDia()], allowedMentions: { parse: [] } });
  console.log(`diário: cartão de ${dia} publicado`);
}

function barraDeCota({ usado, teto }) {
  const pct = Math.round((usado / teto) * 100);
  const cheios = Math.min(10, Math.round(pct / 10));
  const barra = "█".repeat(cheios) + "░".repeat(10 - cheios);
  const alerta = pct >= 95 ? " 🔴" : pct >= 85 ? " 🟠" : pct >= 70 ? " 🟡" : "";
  return `\`${barra}\` **${pct}%**${alerta}\n` +
    `${usado.toLocaleString("pt-BR")} de ${teto.toLocaleString("pt-BR")} caracteres`;
}

async function embedDeSaude() {
  const agora = Date.now();
  const idade = ultimaPassada ? Math.round((agora - ultimaPassada) / 1000) : null;
  const atrasada = idade != null && idade > (INTERVALO_SINCRONIA / 1000) * 1.6;

  const cache = await sb("discord_traducao_cache?select=chave&limit=1&head=false").then((r) => r?.length ?? 0).catch(() => 0);
  const motores = await sb("cyron_servidor?tradutor_motor=neq.auto&select=id").catch(() => []);

  return {
    color: atrasada || tradutorFalhas.quedas ? 0xB4534A : 0x2E8B7A,
    title: "🩺 Saúde do CYRON",
    fields: [
      { name: "Última volta do relógio", value: idade == null ? "_ainda não rodou_"
          : `há ${idade}s${atrasada ? " ⚠️ **atrasada**" : ""}\ndurou ${(duracaoPassada / 1000).toFixed(1)}s`, inline: true },
      { name: "De pé desde", value: quandoFoi(Date.now() - process.uptime() * 1000, "R"), inline: true },
      { name: "Servidores no gateway", value: String(client.guilds.cache.size), inline: true },
      { name: "Tradutor", value: tradutorFalhas.erros
          ? `⚠️ **${tradutorFalhas.erros}** falhas desde que subi\n${tradutorFalhas.quedas} caíram no grátis\n\`${tradutorFalhas.ultimoErro.slice(0, 80)}\``
          : "🟢 sem falhas desde que subi" },
      { name: "Chaves próprias", value: `${(motores || []).length} servidores`, inline: true },
      ...(await camposDeCota()),
      { name: "Memória", value: `${Math.round(process.memoryUsage().rss / 1048576)} MB`, inline: true },
    ],
    footer: { text: "os contadores zeram quando eu reinicio" },
  };
}

/* Buscar um servidor pelo nome ou pelo id.

   Com cinco clientes a lista serve. Com cinquenta, nao -- e o momento de
   precisar disso e' justamente quando um cliente reclama e voce tem o nome
   dele na mao, nao a posicao dele numa lista. */
function janelaDeBusca() {
  return {
    custom_id: "admin:busca",
    title: "Procurar servidor",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "termo", style: 1, required: true, max_length: 80,
        label: "Nome ou id do servidor", placeholder: "parte do nome já serve" }] },
    ],
  };
}

async function procurarServidor(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  await inter.deferReply({ flags: 64 });
  let termo = "";
  try { termo = String(inter.fields.getTextInputValue("termo") || "").trim(); } catch { /* vazio */ }
  if (!termo) return inter.editReply("Você não digitou nada.");

  const todos = await sb("cyron_servidor?select=*&order=criado_em.asc") || [];
  const alvo = termo.toLowerCase();
  const achados = todos.filter((s) =>
    String(s.guild_id) === termo || String(s.nome || "").toLowerCase().includes(alvo));

  if (!achados.length) return inter.editReply(`Não achei nenhum servidor com **${termo}**.`);
  if (achados.length > 1) {
    return inter.editReply(
      `Achei **${achados.length}**:\n` +
      achados.slice(0, 15).map((s) => `• ${s.nome} — \`${s.guild_id}\`${s.saiu_em ? " _(saiu)_" : ""}`).join("\n"));
  }

  const s = achados[0];
  const uso = await usoDeHoje(s.id);
  return inter.editReply({
    content: s.canal_admin ? `Ficha completa em <#${s.canal_admin}>` : undefined,
    embeds: [{
      color: s.saiu_em ? 0x8A3A33 : planoDe(s) === "pago" ? 0x2E8B7A : 0xB08A2E,
      title: s.nome,
      description: s.saiu_em ? `⚠️ saiu ${quandoFoi(Date.parse(s.saiu_em), "R")}` : "no ar",
      fields: [
        { name: "Plano", value: planoDe(s), inline: true },
        { name: "Hoje", value: `${uso.traducoes} traduções`, inline: true },
        { name: "guild", value: `\`${s.guild_id}\``, inline: true },
      ],
    }],
    components: botoesDaFicha(s),
  });
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

/* O placar da arena, mantido de pe pela varredura.

   Eu criava o CANAL na instalacao e nunca desenhava o placar: a unica coisa
   que chamava `desenharArena` era o clique num botao que so' existe DENTRO do
   placar. Circulo fechado -- precisa do placar pra clicar, precisa do clique
   pra ter placar. A sala nascia vazia e o jogo inteiro ficava inalcancavel.

   E' a quarta vez nesta semana que o defeito nao esta na coisa e sim em onde
   ela aparece. O conserto e' o mesmo padrao do cartao de config aqui em cima:
   quem mantem de pe e' a varredura, nao o evento. Assim tambem se conserta
   sozinho se alguem apagar o placar. */
async function atualizarArenas() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const servidor = await servidorDoGuild(guild.id);
      if (!servidor) continue;
      await desenharArena(guild, servidor);
    } catch (e) {
      console.error("arena: nao consegui desenhar em", guild.name, e?.message || e);
    }
  }
}

/* Sair tambem e' informacao.

   Sem isto, cliente que desiste some sem deixar rastro: a linha fica no banco
   parecendo ativa, o canal dele no painel continua verde, e a conta de
   "quantos servidores eu tenho" mente pra cima. */
client.on("guildDelete", async (guild) => {
  try {
    const servidor = await servidorDoGuild(guild.id);
    if (!servidor) return;
    await sbPatch(`cyron_servidor?id=eq.${encodeURIComponent(servidor.id)}`,
      { saiu_em: new Date().toISOString() });
    cacheServidor.delete(guild.id);
    console.log(`instalar: me tiraram de ${guild.name} (${guild.id})`);
    await avisarNoPainel(CANAL_NOVOS, `📤 **${guild.name}** me removeu · \`${guild.id}\``);
  } catch (e) {
    console.error("instalar: nao consegui anotar a saida:", e?.message || e);
  }
});

client.on("guildCreate", async (guild) => {
  try {
    /* O servidor do painel nao e' cliente. Sem esta linha, ele ganharia porta
       de idioma, canal de configuracao e replicas -- o dono viraria inquilino
       da propria area administrativa. */
    if (await ehOPainel(guild.id)) {
      console.log(`instalar: ${guild.name} é o painel do dono, não instalo nada aqui`);
      return;
    }
    console.log(`instalar: entrei em ${guild.name} (${guild.id})`);
    avisarNoPainel(CANAL_NOVOS,
      `📥 **${guild.name}** me instalou · ${guild.memberCount} membros · \`${guild.id}\``).catch(() => {});
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

  const linhas = ["📖 Aqui neste canal a conversa ainda não vai nos dois sentidos — " +
    "o que você escrever não chega em quem lê nos outros idiomas."];

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

/* ================= INTERACOES =================================================

   Clique, comando, menu e formulario chegam aqui.

   Ate agora nao chegavam: o aplicativo tinha um "endereco de interacoes"
   configurado, e configurar esse endereco faz o Discord PARAR de entregar
   interacao pelo gateway. Tudo ia por HTTP pra uma funcao no Supabase, que
   nao conhece canal, cargo nem membro -- ela tinha que perguntar tudo pela API
   REST a cada clique.

   Isso partia o bot em dois pela metade errada. "Criar um canal quando alguem
   aperta um botao" e' uma frase simples que virava um problema de arquitetura,
   porque quem via o botao nao era quem sabia criar canal.

   Com o endereco removido, a interacao volta pelo gateway e cai aqui dentro,
   onde o guild, os canais e os cargos ja estao na mao. O que era impossivel
   vira uma linha.

   Os tratadores abaixo nascem dormentes: enquanto o endereco existir, nenhuma
   interacao chega neles. E' de proposito -- assim eu publico primeiro e libero
   depois, sem um segundo sequer em que o Discord entregue algo que ninguem
   sabe responder. */

const COR = 0xF5A623;
const COR_OK = 0x5EBB83;
const PORTAL = "https://portal-alianca.github.io/";
const FONTE_JOGO = "https://kingshotstats.com";

/* Traduz o embed inteiro pro idioma de quem pediu.

   Em portugues nao mexe: e' o idioma em que todo o conteudo ja e' escrito, e
   traduzir pt->pt seria pagar por devolver o mesmo texto. */
async function traduzirEmbed(embed, idioma, motor = MOTOR_AUTO) {
  if (!idioma || idioma === "pt") return embed;
  const campo = async (t) => {
    if (typeof t !== "string" || !t.trim()) return t;
    /* Texto sem LETRA nenhuma nao vai pro tradutor.

       "7", "39%", "2 / 5", "🇧🇷 × 🇸🇦" voltariam iguais -- mas cada numero
       diferente seria uma chave de cache nova, que nunca se repete. Um painel
       com contador viraria uma traducao paga por clique, pra sempre, sem teto.

       \p{L} cobre alfabeto nenhum em particular: arabe, japones e cirilico
       contam como letra do mesmo jeito que o "a". */
    if (!/\p{L}/u.test(t)) return t;
    return (await traduzirComCache(t, idioma, motor)) || t;
  };
  const novo = { ...embed };
  if (novo.title) novo.title = await campo(novo.title);
  if (novo.description) novo.description = await campo(novo.description);
  if (novo.footer?.text) novo.footer = { ...novo.footer, text: await campo(novo.footer.text) };
  if (Array.isArray(novo.fields)) {
    novo.fields = [];
    for (const f of embed.fields) {
      novo.fields.push({ ...f, name: await campo(f.name), value: await campo(f.value) });
    }
  }
  return novo;
}

/* A lingua do CLIENTE de quem clicou, quando ela nunca escolheu uma.

   O Discord manda em toda interacao o idioma em que a pessoa usa o aplicativo.
   Ele nao e' a verdade absoluta -- alguem pode usar o Discord em ingles e
   preferir ler em alemao --, mas e' um palpite muito melhor que "ingles pra
   todo mundo", que era o que havia.

   E "ingles pra todo mundo" custou caro: uma jogadora alema pediu a traducao
   de uma mensagem em ingles, eu a mandei de volta em INGLES, e o que ela
   entendeu foi que o bot dizia que ingles ja estava em ingles. Ela e outro
   jogador tentaram uma hora e desistiram. Do lado de fora, um tradutor que
   devolve o texto igual esta quebrado.

   Os codigos do Discord nem sempre sao os meus: pt-BR, en-US e es-419 viram
   pt, en e es; o chines tradicional cai no simplificado, que e' o unico que eu
   tenho. O que nao bater cai em ingles, como antes. */
function idiomaDoAplicativo(local) {
  const bruto = String(local || "").trim();
  if (!bruto) return "";
  if (LINGUAS_MENU.some(([c]) => c === bruto)) return bruto;      // "de", "fr", "zh-CN"
  if (bruto === "zh-TW") return "zh-CN";                          // so' tenho o simplificado
  const curto = bruto.split("-")[0];                              // "pt-BR" -> "pt"
  return LINGUAS_MENU.some(([c]) => c === curto) ? curto : "";
}

/* O que a pessoa ESCOLHEU, e vazio se ela nunca escolheu.

   Separado de propósito. Quem só quer uma lingua pra escrever nela usa o
   idiomaDoJogador abaixo, que sempre devolve alguma. Mas quem precisa saber se
   ela JA' passou por aqui -- a conversa no privado, que abre perguntando --
   precisa distinguir "escolheu ingles" de "nunca escolheu", e as duas coisas
   estavam colapsadas num "en".

   O custo disso foi a primeira tela inteira: `idioma ? apresentacao : perguntar`
   nunca chegava a perguntar, porque "en" e' verdadeiro. Todo mundo que mandava
   "oi" recebia uma parede de texto em ingles, tivesse ou nao escolhido idioma.
   A pergunta existia no codigo e nao existia na tela. */
async function idiomaEscolhido(userId) {
  try {
    const r = await sb(`discord_idioma_jogador?discord_user_id=eq.${userId}&select=idioma`);
    return r?.[0]?.idioma || "";
  } catch {
    return "";
  }
}

async function idiomaDoJogador(userId, local) {
  return (await idiomaEscolhido(userId)) || idiomaDoAplicativo(local) || "en";
}

async function salvarIdiomaJogador(userId, idioma) {
  const r = await fetch(`${SB_URL}/rest/v1/discord_idioma_jogador`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ discord_user_id: userId, idioma, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`salvar idioma ${r.status}`);
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
  const r = await sb(
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
  const evs = await sb(
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
  const ms = await sb(
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
  const up = await fetch(`${SB_URL}/storage/v1/object/${BALDE}/${caminho}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": r.headers.get("content-type") || "application/octet-stream",
    },
    body: buf,
  });
  if (!up.ok) throw new Error("subir");
  return `${SB_URL}/storage/v1/object/public/${BALDE}/${caminho}`;
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
  if (link.startsWith(`${SB_URL}/storage/`)) return link;  // ja e' nosso
  return await reHospedar(link, prefixo);
}

async function rpc(fn, corpo) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  /* Funcao que devolve void responde 204 com corpo VAZIO, e r.json() estoura
     nele com "Unexpected end of JSON input". Foi o que aconteceu com a
     contagem de uso: ela gravava certo no banco e depois estourava na leitura
     da resposta, entao eu reenfileirava tudo e tentava de novo a cada minuto,
     pra sempre -- gravando duplicado e achando que nao tinha gravado nada. */
  const corpoTexto = await r.text();
  return corpoTexto ? JSON.parse(corpoTexto) : null;
}

async function comandoSettings(inter) {
  const guild = inter.guildId;
  const sub = inter.options.getSubcommand();

  if (sub === "server") {
    const r = await rpc("discord_ligar_servidor", { p_guild: guild, p_codigo: String(inter.options.getString("code") || "") });
    return r?.ok
      ? { color: COR_OK, title: "🔗 Servidor ligado!",
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
    const r = await rpc("discord_gif_evento", { p_guild: guild, p_titulo: titulo, p_url: url });
    return r?.ok
      ? { color: COR_OK, title: url ? "🖼️ GIF definido!" : "🧹 GIF removido",
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
    const r = await rpc("discord_gif_boas_vindas", { p_guild: guild, p_url: url, p_limpar: limpar });
    if (!r?.ok) {
      return { title: "❌ Não deu", description: r?.erro === "sem_vinculo"
        ? "Este servidor ainda não está ligado a uma aliança. Use `/settings server` primeiro."
        : "Tente de novo em instantes." };
    }
    return limpar
      ? { color: COR_OK, title: "🧹 GIFs de boas-vindas apagados", description: "As boas-vindas passam a ser só texto." }
      : { color: COR_OK, title: "🎉 GIF de boas-vindas somado!",
          description: `Agora são **${r.total}** no sorteio.`, image: { url } };
  }

  /* view */
  const v = await aliancaCompleta(guild);
  if (!v) {
    return { title: "🔗 Servidor não ligado",
      description: "Use `/settings server code:<código de oficial>` pra começar." };
  }
  const a = v.aliancas || {};
  const evs = await sb(`top_eventos?alianca_id=eq.${v.alianca_id}&ativa=eq.true&select=titulo,gif_url&order=ordem`);
  const gifs = await sb(`discord_gifs?alianca_id=eq.${encodeURIComponent(v.alianca_id)}&uso=eq.boas_vindas&ativo=eq.true&select=id`);
  const cfg = await sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guild)}&select=webhook,webhook_boas_vindas`);
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

/* ---------------- quem atende cada interacao ------------------------------ */

/* Responder ja traduzido pro idioma de quem clicou. */
async function responder(inter, embed, { efemera = true, idioma } = {}) {
  const alvo = idioma ?? await idiomaDoJogador(inter.user.id, inter.locale);
  const final = await traduzirEmbed(embed, alvo, await motorDoGuild(inter.guildId));
  const carga = { embeds: [{ color: COR, ...final }] };
  if (inter.deferred || inter.replied) return inter.editReply(carga);
  return inter.reply({ ...carga, flags: efemera ? 64 : undefined });
}

/* Seletor de idioma: no hall de entrada, nas boas-vindas e no convite. */
async function cliqueEscolherIdioma(inter) {
  const idioma = String(inter.values?.[0] || "");
  if (!nomeDoIdioma(idioma) || !LINGUAS_MENU.some(([c]) => c === idioma)) {
    return inter.reply({ content: "🤔 Não reconheci esse idioma.", flags: 64 });
  }

  /* No privado, escolher idioma nao e' o fim de nada -- e' o primeiro passo da
     conversa. Dizer "idioma salvo, sua categoria aparece em um minuto" ali
     seria falar de categoria para quem talvez nem tenha servidor, e deixar a
     pessoa sem o proximo passo. Aqui ela segue direto para a apresentacao, ja
     na lingua que acabou de escolher. */
  if (!inter.guild) {
    /* Reconhece o clique ANTES de traduzir. O Discord derruba a interacao em
       3 segundos, e montar esta tela pode passar disso com o cache frio: sao
       a descricao e dois rotulos, e um tradutor gratuito leva ~2,2s por
       chamada. Sem isto, a PRIMEIRA pessoa a escolher cada idioma veria
       "Esta interação falhou" -- e so ela, porque da segunda em diante o
       cache responde na hora. Defeito que nao apareceria em teste nenhum meu. */
    await inter.deferUpdate();
    await salvarIdiomaJogador(inter.user.id, idioma).catch((e) =>
      console.error("privado: nao consegui salvar o idioma:", e?.message || e));
    return inter.editReply(await telaDeApresentacao(idioma));
  }

  /* No cartao de boas-vindas a propria mensagem e' reescrita no idioma
     escolhido: ela e' publica e e' sobre uma pessoa so, entao faz sentido. Num
     aviso fixado seria estranho -- aquele e' de todo mundo. */
  const embedOriginal = inter.message?.embeds?.[0]?.toJSON?.();
  const ehBoasVindas = String(embedOriginal?.title || "").includes("Boas-vindas");

  await inter.deferReply({ flags: 64 });
  try {
    await salvarIdiomaJogador(inter.user.id, idioma);
  } catch (e) {
    console.error("idioma: nao consegui salvar:", e?.message || e);
    return responder(inter, { title: "❌ Não deu",
      description: "Não consegui salvar agora. Tente de novo em instantes." }, { idioma: "pt" });
  }

  if (ehBoasVindas) {
    const traduzido = await traduzirEmbed(embedOriginal, idioma, await motorDoGuild(inter.guildId));
    await inter.message.edit({ embeds: [traduzido] }).catch(() => {});
  }

  await responder(inter, {
    color: COR_OK,
    title: "🌐 Idioma salvo!",
    description: `A partir de agora o servidor fala com você em **${nomeDoIdioma(idioma)}**. ` +
      "Sua categoria aparece em até um minuto.",
  }, { idioma });

  /* Monta a categoria dele agora, com a pessoa olhando -- e' o momento em que
     ela decide se o bot funciona. */
  if (inter.guild) sincronizarAgora(inter.guild).catch(() => {});
}

/* Seletor pendurado num aviso: traduz aquele texto so pra quem clicou. */
async function cliqueTraduzirMsg(inter) {
  const id = inter.customId.slice("traduzir-msg:".length);
  const idioma = String(inter.values?.[0] || "");
  if (!LINGUAS_MENU.some(([c]) => c === idioma)) {
    return inter.reply({ content: "🤔 Não reconheci esse idioma.", flags: 64 });
  }

  /* Clique vindo da propria resposta efemera edita ela no lugar; vindo da
     mensagem publica, cria uma nova. Sem isso, trocar de idioma empurrava uma
     mensagem nova pro fim do canal e obrigava a rolar de volta. */
  const naEfemera = (Number(inter.message?.flags?.bitfield ?? 0) & 64) !== 0;
  if (naEfemera) await inter.deferUpdate();
  else await inter.deferReply({ flags: 64 });

  salvarIdiomaJogador(inter.user.id, idioma).catch(() => {});

  const r = await sb(`discord_msg_traducao?id=eq.${id}&select=texto,link`).catch(() => null);
  const texto = r?.[0]?.texto;
  const link = r?.[0]?.link;

  if (!texto) {
    const carga = { embeds: [{ color: COR, title: "🤔 Não encontrei mais essa mensagem",
      description: "Ela pode ter expirado. Tente de novo pelo **Translate** (clique direito → Apps)." }] };
    return naEfemera ? inter.editReply(carga) : inter.editReply(carga);
  }

  const traduzido = await traduzirLongo(texto, idioma, await motorDoGuild(inter.guildId));
  const carga = traduzido
    ? {
        embeds: [{
          color: COR,
          title: `${LINGUAS_MENU.find(([c]) => c === idioma)?.[2] ?? "🌐"} ${nomeDoIdioma(idioma)}`,
          description: traduzido.slice(0, 3800) + (link ? `\n\n[⤴ Voltar / Back](${link})` : ""),
          footer: { text: "Só você está vendo isto · troque o idioma abaixo" },
        }],
        components: menuTraduzir(id),
      }
    : { embeds: [{ color: COR, title: "❌ Não deu",
        description: "Não consegui traduzir agora. Tente de novo em instantes." }] };

  await inter.editReply(carga);
}

/* A pagina do bot, dentro do Discord.

   Existe uma pagina web explicando o CYRON, mas ela nao serve pro membro:
   morar fora do Discord ja e' um passo a mais, e a maioria le num celular no
   meio de outra coisa. Aqui a explicacao chega no mesmo lugar onde a duvida
   nasceu -- e, o que importa mais, TRADUZIDA: quem nao entende o idioma da
   casa e' exatamente quem precisa do texto de ajuda, e um manual so' em
   portugues seria a piada que o proprio produto existe pra resolver.

   O seletor de idioma vem junto, na mesma resposta. Mandar a pessoa "ir no
   canal tal" e' perder metade dela no caminho. */
function paginaDoMembro(souAdmin) {
  const linhas = [
    "**Você lê este servidor na sua língua.**",
    "Escolha o seu idioma no menu aqui embaixo. A partir daí, aparecem para você cópias dos canais principais já traduzidas — mesmos avisos, mesmos eventos, na sua língua.",
    "",
    "**Você continua falando na sua língua.**",
    "Nas salas de conversa, o que você escrever chega traduzido para quem escolheu outro idioma. Escreva normal.",
    "",
    "**Traduzir uma mensagem solta**",
    "Segure a mensagem (ou clique com o botão direito) → **Apps** → **Translate**. Serve para qualquer mensagem, sem mudar nada no servidor.",
    "",
    "**Trocar de idioma depois**",
    "Use `/mylanguage`, ou o menu abaixo de novo. Pode trocar quantas vezes quiser.",
    "",
    "**A Arena das Línguas**",
    "Use `/arena` para ver o placar mundial na sua língua, em qualquer sala. Você luta pela bandeira que escolheu, e time pequeno bate mais forte.",
  ];
  if (souAdmin) {
    linhas.push(
      "",
      "— — —",
      "**Você administra este servidor:** use `/cyron` para escolher quais canais eu traduzo, ligar o tradutor por mensagem e ver os limites do plano.");
  }
  return {
    title: "🌐 CYRON",
    description: linhas.join("\n"),
    footer: { text: "Só você está vendo esta mensagem." },
  };
}

/* ---------------- primeiro contato, no privado ----------------

   Quem abre uma conversa comigo quase nunca e' quem ja usa o bot: e' alguem
   que viu o nome num servidor, tocou no perfil e mandou um "oi". Ate agora
   recebia silencio -- que e' indistinguivel de bot quebrado, e acontecia
   justamente no momento em que a pessoa estava decidindo se instalava.

   O cartao e' diferente do /cyron de proposito. Aquele fala com quem JA esta'
   num servidor que me tem ("escolha seu idioma, suas salas aparecem"); este
   fala com quem talvez nem tenha servidor, e precisa entender o que eu sou
   antes de qualquer instrucao. */
const SITE_DO_CYRON = "https://portal-alianca.github.io/cyron/";

/* O estado da conversa mora no custom_id, e nao numa tabela.

   Cada tela pendura no proprio botao o passo seguinte, entao o clique chega
   aqui ja dizendo de onde veio. Guardar isso no banco seria criar uma sessao
   por pessoa -- com expiracao, limpeza e um jeito novo de ficar
   inconsistente -- para uma conversa de quatro telas que o Discord ja carrega
   sozinho na mensagem.

   E como cada passo EDITA a mensagem em vez de mandar outra, a conversa
   inteira acontece num cartao so', que se transforma. Empilhar telas deixaria
   a DM com sete cartoes mortos e o vivo la' embaixo. */
const PASSO = {
  inicio: "dm:inicio",
  sim: "dm:sim",
  nao: "dm:nao",
  ajuda: "dm:ajuda",
  /* O numero do passo entra depois dos dois pontos: `dm:passo:3`. E' o mesmo
     truque do resto da conversa -- o estado viaja no botao --, so' que aqui
     ele carrega uma posicao em vez de um destino. */
  passo: "dm:passo",
};

/* Rotulo de botao nao passa pelo traduzirEmbed -- ele so' olha titulo,
   descricao, rodape e campos.

   Sem isto o cartao chegava em arabe com os botoes em portugues, num bot cujo
   produto E' traducao. E' o tipo de detalhe que ninguem reclama e todo mundo
   repara. Sai barato: sao sempre as mesmas frases, entao o cache traduz cada
   uma uma vez por idioma e nunca mais. */
async function traduzirLinha(linha, idioma) {
  if (!idioma || idioma === "pt") return linha;
  const componentes = [];
  for (const c of linha.components) {
    const novo = { ...c };
    if (novo.label) novo.label = (await traduzirComCache(novo.label, idioma, MOTOR_AUTO)) || novo.label;
    if (novo.placeholder) {
      novo.placeholder = (await traduzirComCache(novo.placeholder, idioma, MOTOR_AUTO)) || novo.placeholder;
    }
    if (Array.isArray(novo.options)) {
      novo.options = [];
      for (const o of c.options) {
        novo.options.push({ ...o, label: (await traduzirComCache(o.label, idioma, MOTOR_AUTO)) || o.label });
      }
    }
    componentes.push(novo);
  }
  return { ...linha, components: componentes };
}

/* Botao de link nao tem custom_id e nao volta pra ca: o Discord abre e pronto. */
function botoesDeConvite() {
  return {
    type: 1,
    components: [
      { type: 2, style: 5, emoji: { name: "➕" }, label: "Adicionar ao meu servidor", url: linkDeConvite() },
      { type: 2, style: 5, emoji: { name: "🌐" }, label: "Ver o site", url: SITE_DO_CYRON },
    ],
  };
}

/* ---- passo 0: que língua você fala? ---- */

/* Perguntar o idioma ANTES de me apresentar, e nao depois, e' o ponto inteiro.

   Antes eu me apresentava em portugues e oferecia o menu no fim -- ou seja, a
   primeira coisa que um turco lia era uma parede de texto que ele nao entende,
   e a saida estava embaixo dela. Agora a primeira tela e' a unica que pode ser
   bilingue sem custo, e tudo depois dela chega na lingua certa. */
function telaDoIdioma() {
  return {
    embeds: [{
      color: COR,
      title: "🌐 CYRON",
      description: "**Qual língua você fala?**\n_Pick your language — I'll talk to you in it from here on._",
    }],
    components: menuIdioma(),
  };
}

/* ---- passo 1: quem eu sou, e a pergunta ---- */

function paginaDeApresentacao() {
  return {
    title: "🌐 CYRON",
    description: [
      "**Eu faço um servidor do Discord funcionar em várias línguas ao mesmo tempo.**",
      "",
      "Cada pessoa escreve na língua dela e lê todo mundo na dela — mesma conversa, " +
      "ao mesmo tempo, sem ninguém digitar comando nenhum.",
      "",
      "**Você pode me testar agora:** me mande qualquer texto nesta conversa e eu " +
      "traduzo para você, em 20 idiomas.",
      "",
      "— — —",
      "",
      "**Você quer usar o CYRON no seu servidor?**",
      "_Se preferir, veja antes o passo a passo da instalação._",
    ].join("\n"),
  };
}

/* O passo a passo tambem AQUI, na primeira tela.

   Eu tinha posto as duas entradas dele atras de uma pergunta: "Sim, quero" ->
   planos -> botao, ou "Ainda nao" -> menu -> tema. Quem mandou "oi" e olhou o
   primeiro cartao nao via a expressao "passo a passo" em lugar nenhum, e
   concluiu -- com razao -- que nao existia. Recurso a dois toques de distancia,
   sem nada na superficie que o anuncie, e' recurso que ninguem acha.

   Fica em terceiro, e nao em primeiro: quem ja decidiu instalar continua
   caindo nos planos pelo caminho mais curto. O passo a passo e' para quem
   ainda esta olhando. */
function botoesDaPergunta() {
  return {
    type: 1,
    components: [
      { type: 2, style: 3, custom_id: PASSO.sim, emoji: { name: "✅" }, label: "Sim, quero" },
      { type: 2, style: 2, custom_id: PASSO.nao, emoji: { name: "💬" }, label: "Ainda não" },
      { type: 2, style: 2, custom_id: `${PASSO.passo}:1`, emoji: { name: "📋" }, label: "Ver o passo a passo" },
    ],
  };
}

async function telaDeApresentacao(idioma) {
  return {
    embeds: [{ color: COR, ...(await traduzirEmbed(paginaDeApresentacao(), idioma, MOTOR_AUTO)) }],
    components: [await traduzirLinha(botoesDaPergunta(), idioma)],
  };
}

/* ---- passo 2: disse que sim ---- */

/* O preço na moeda de quem lê.

   "R$ 79/mês" não diz nada a um americano: ele não sabe se é caro ou barato, e
   ir procurar a cotação é onde ele fecha a conversa. É o mesmo conserto que o
   site levou, e que aqui tinha ficado para trás. */
function precoDoPlano(idioma) {
  return idioma === "pt" ? "R$ 79/mês" : "US$ 15/mês";
}

/* Texto meu passa por tradução automática, e frase curta de venda é
   exatamente onde ela quebra.

   A versão anterior dizia "Nada é construído no seu servidor: a tradução
   acontece quando alguém pede." Voltou do inglês como "Nada is built on your
   server: the translation happens when someone pede." Duas palavras
   sobreviveram, e "Nada is built" um inglês lê como se ALGO fosse construído
   -- o oposto do que a frase existe para dizer, na tela que decide a venda.

   O conserto não é trocar de tradutor: é escrever para ser traduzido. Sujeito
   explícito, verbo com objeto, e nada de começar por pronome indefinido que
   pareça nome próprio. Isso vale para as vinte línguas de uma vez, e não só
   para a única que eu vi quebrar. */
function paginaDosPlanos(idioma) {
  return {
    title: "🌐 Como o CYRON funciona no seu servidor",
    description: [
      "Instalar leva menos de um minuto: eu entro, crio o canal onde as pessoas " +
      "escolhem o idioma e um painel com botões. Se você nunca abrir o painel, " +
      "eu continuo funcionando.",
    ].join("\n"),
    fields: [
      {
        name: "🆓 Grátis, para sempre",
        value: "Tradução por bandeira sem limite · botão de tradução nos avisos · " +
          "eu falo com cada pessoa na língua dela.\n" +
          "_Eu não crio nenhum canal no seu servidor. Só traduzo quando alguém " +
          "pede uma tradução._",
      },
      {
        name: `⭐ Pago — ${precoDoPlano(idioma)}`,
        value: "Cada língua ganha uma ala própria, com os seus canais copiados e " +
          "traduzidos. Quem escreve na sala dele aparece na dos outros já traduzido, " +
          "com nome e foto. Até 20 idiomas.",
      },
    ],
    footer: { text: "Você começa no plano grátis. Eu não peço cartão." },
  };
}

function botoesDosPlanos() {
  return [
    botoesDeConvite(),
    { type: 1, components: [
      { type: 2, style: 1, custom_id: `${PASSO.passo}:1`, emoji: { name: "📋" }, label: "Ver o passo a passo" },
      { type: 2, style: 2, custom_id: PASSO.nao, emoji: { name: "💬" }, label: "Tenho outra dúvida" },
    ] },
  ];
}

/* ---- o passo a passo, um cartão por vez ----

   Os mesmos cinco passos do site, e de propósito: quem viu lá e veio para cá
   reconhece, e eu tenho um texto só para manter. O que muda é o meio -- aqui a
   pessoa avança no próprio ritmo, e o Discord desenha a imagem do passo dentro
   do cartão.

   As fotos vêm do site, pelo endereço público. Não há upload, não há anexo, e
   trocar a foto no site troca aqui junto. */
const PASSOS = [
  {
    titulo: "Adicione o CYRON ao seu servidor",
    texto: "Um clique no botão, escolher o servidor, autorizar.\n\n" +
      "Você precisa ser dono ou ter **Gerenciar Servidor** — o Discord só mostra " +
      "na lista os servidores onde você pode.",
    foto: "passo-autorizar",
    convite: true,
  },
  {
    titulo: "Ele se instala sozinho",
    texto: "Sem formulário e sem configuração.\n\n" +
      "Eu crio o canal onde as pessoas escolhem o idioma e um canal de " +
      "administração com um painel de botões, e já começo a funcionar. " +
      "Se você nunca abrir o painel, eu continuo funcionando.",
    foto: "passo-canais",
  },
  {
    titulo: "Cada pessoa escolhe a língua dela",
    texto: "No canal de entrada, num menu com 20 idiomas.\n\n" +
      "A partir daí eu falo com ela nessa língua, e ela só enxerga a ala dela " +
      "do servidor.",
    foto: "passo-idioma",
  },
  {
    titulo: "Você aponta quais canais eu traduzo",
    texto: "No painel de administração, num menu de canais do próprio Discord.\n\n" +
      "Cada canal que você marcar ganha uma cópia traduzida em cada idioma que " +
      "alguém escolheu.",
    foto: "passo-painel",
  },
  {
    titulo: "Pronto — o servidor vive em todas as línguas",
    texto: "Você publica uma vez no canal de sempre, e chega traduzido em todas " +
      "as alas.\n\n" +
      "Quem escreve na sala da língua dele aparece na dos outros já traduzido, " +
      "com o nome e a foto de quem falou.",
    foto: "passo-alas",
    convite: true,
  },
];

/* Recebe o numero do jeito que ele chega do botao -- texto, e vindo de fora --
   e devolve uma posicao que existe. Sem isto, um custom_id adulterado ou um
   passo removido no futuro dariam `undefined.titulo` e a conversa morreria com
   "Esta interação falhou". */
function passoValido(n) {
  const i = Math.trunc(Number(n));
  if (!Number.isFinite(i)) return 1;
  return Math.min(Math.max(i, 1), PASSOS.length);
}

/* O desenho do passo, na lingua de quem le.

   Duas versoes de cada um, e nao vinte: o texto dentro do desenho e' pixel, e
   pixel nao passa pelo tradutor. Portugues para quem fala portugues, ingles
   para todo o resto -- que e' a lingua em que o Discord ja se entende.

   Os arquivos moram no site, pelo endereco publico: sem upload, sem anexo, e
   trocar o desenho la' troca aqui junto. */
function fotoDoPasso(nome, idioma) {
  if (!nome) return null;
  return `${SITE_DO_CYRON}img/${nome}${idioma === "pt" ? "" : "-en"}.png`;
}

function paginaDoPasso(n, idioma) {
  const i = passoValido(n);
  const p = PASSOS[i - 1];
  const foto = fotoDoPasso(p.foto, idioma);
  return {
    title: `${i}. ${p.titulo}`,
    description: p.texto,
    ...(foto ? { image: { url: foto } } : {}),
    footer: { text: `Passo ${i} de ${PASSOS.length}` },
  };
}

/* Primeiro e ultimo passo nao tem para onde voltar nem para onde ir. Botao
   desabilitado, e nao botao ausente: a linha muda de tamanho a cada passo se
   eles sumirem, e os outros dancam de lugar embaixo do dedo de quem esta
   tocando. */
function botoesDoPasso(n) {
  const i = passoValido(n);
  const linhas = [{
    type: 1,
    components: [
      { type: 2, style: 2, custom_id: `${PASSO.passo}:${i - 1}`, emoji: { name: "◀" },
        label: "Anterior", disabled: i === 1 },
      { type: 2, style: 1, custom_id: `${PASSO.passo}:${i + 1}`, emoji: { name: "▶" },
        label: "Próximo", disabled: i === PASSOS.length },
      { type: 2, style: 2, custom_id: PASSO.sim, emoji: { name: "↩️" }, label: "Voltar aos planos" },
    ],
  }];
  if (PASSOS[i - 1].convite) linhas.push(botoesDeConvite());
  return linhas;
}

async function telaDoPasso(idioma, n) {
  const linhas = [];
  for (const l of botoesDoPasso(n)) linhas.push(await traduzirLinha(l, idioma));
  return {
    embeds: [{ color: COR, ...(await traduzirEmbed(paginaDoPasso(n, idioma), idioma, MOTOR_AUTO)) }],
    components: linhas,
  };
}

async function telaDosPlanos(idioma) {
  const linhas = [];
  for (const l of botoesDosPlanos()) linhas.push(await traduzirLinha(l, idioma));
  return {
    embeds: [{ color: COR_OK, ...(await traduzirEmbed(paginaDosPlanos(idioma), idioma, MOTOR_AUTO)) }],
    components: linhas,
  };
}

/* ---- passo 3: disse que não ---- */

/* Menu fechado, e nao conversa aberta.

   "Em que posso ajudar?" com campo livre promete um atendente que nao existe:
   quem escrevesse uma pergunta de verdade receberia o seletor de traducao, que
   nao e' resposta nenhuma. Cinco temas cobrem o que de fato perguntam, e cada
   um tem uma resposta escrita -- honesto sobre o que eu sei fazer. */
const TEMAS = {
  instalar: {
    rotulo: "Como instalar, passo a passo",
    /* Titulo e texto existem para o caso de alguem chegar aqui pelo caminho
       normal -- mas o roteador desvia este tema para a sequencia de cartoes
       antes de usa-los. */
    titulo: "📋 Como instalar",
    texto: "São cinco passos, e três acontecem sozinhos. Use os botões para " +
      "avançar no seu ritmo.",
  },
  ler: {
    rotulo: "Como eu leio uma mensagem na minha língua",
    titulo: "🏳️ Reaja com a sua bandeira",
    texto: "Em qualquer servidor onde eu esteja, ponha a bandeira do seu país numa " +
      "mensagem e ela chega traduzida aqui no privado.\n\n" +
      "Vale a bandeira que você tem: 🇲🇽, 🇵🇹, 🇦🇪, 🇺🇸 — não só as do menu. " +
      "Se a sua caixa de mensagens estiver fechada, eu respondo na própria sala e " +
      "apago sozinho em 90 segundos.",
  },
  falar: {
    rotulo: "Como eu falo e todo mundo entende",
    titulo: "💬 Escreva normal, na sua língua",
    texto: "Nos servidores com o plano pago, cada língua tem a sala dela. Você escreve " +
      "na sua, e a sua fala aparece na sala dos outros já traduzida — com o seu nome " +
      "e a sua foto, como se você tivesse escrito ali.\n\n" +
      "Você não muda nada no jeito de escrever.",
  },
  idioma: {
    rotulo: "Trocar o meu idioma",
    titulo: "🌐 Trocar de idioma",
    texto: "Use `/mylanguage` em qualquer servidor onde eu esteja, ou me mande " +
      "`idioma` aqui nesta conversa.\n\nPode trocar quantas vezes quiser.",
  },
  preco: {
    rotulo: "Quanto custa",
    titulo: "💳 Preço",
    texto: "O plano grátis não vence nunca: tradução por bandeira e botão de tradução, " +
      "sem limite de idioma nem de gente.\n\n" +
      "O plano pago custa **R$ 79/mês** e é o que constrói as salas por idioma. " +
      "Mensal, cancela quando quiser.",
  },
  traduzir: {
    rotulo: "Só quero traduzir um texto",
    titulo: "✍️ Me mande o texto",
    texto: "Escreva ou cole qualquer coisa nesta conversa e eu ofereço a tradução " +
      "em 20 idiomas. Não precisa de comando, e ninguém mais vê.",
  },
};

function menuDeTemas() {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: PASSO.ajuda,
      placeholder: "No que eu posso ajudar?",
      options: Object.entries(TEMAS).map(([valor, t]) => ({ label: t.rotulo, value: valor })),
    }],
  };
}

async function telaDeAjuda(idioma, tema = null) {
  const escolhido = tema && TEMAS[tema];
  const embed = escolhido
    ? { title: escolhido.titulo, description: escolhido.texto }
    : {
      title: "💬 Tudo bem",
      description: "Estou aqui de qualquer jeito. Escolha um assunto abaixo, ou " +
        "simplesmente me mande um texto que eu traduzo para você.",
    };
  return {
    embeds: [{ color: COR, ...(await traduzirEmbed(embed, idioma, MOTOR_AUTO)) }],
    components: [
      await traduzirLinha(menuDeTemas(), idioma),
      await traduzirLinha({ type: 1, components: [
        { type: 2, style: 2, custom_id: PASSO.inicio, emoji: { name: "↩️" }, label: "Voltar ao começo" },
      ] }, idioma),
    ],
  };
}

/* ---- o roteador dos cliques da conversa ---- */

/* Tudo com `update`, e nao `reply`: o cartao se transforma no lugar. Uma
   resposta nova a cada clique deixaria a conversa com o historico inteiro de
   telas mortas, e a viva perdida no meio. */
/* O tema que abre o passo a passo em vez de um cartao de texto.

   Ele mora na mesma lista dos outros para aparecer no menu, mas o valor e'
   tratado a parte no roteador: aqui a resposta nao e' uma explicacao, e' uma
   sequencia. */
const TEMA_INSTALAR = "instalar";

async function cliqueNoPrivado(inter) {
  /* Reconhece o clique antes de qualquer traducao, pelo mesmo motivo do
     seletor de idioma: montar uma tela nova pode passar dos 3 segundos que o
     Discord da', e a pessoa veria "Esta interação falhou" num botao que
     funcionou. Depois do deferUpdate, o editReply troca o cartao no lugar --
     que e' o mesmo efeito do update, sem o relogio correndo. */
  await inter.deferUpdate();
  const idioma = await idiomaDoJogador(inter.user.id, inter.locale);

  /* Antes das comparacoes exatas: este e' o unico custom_id da conversa que
     carrega um valor depois do nome. */
  if (inter.customId.startsWith(`${PASSO.passo}:`)) {
    return inter.editReply(await telaDoPasso(idioma, inter.customId.split(":")[2]));
  }
  if (inter.customId === PASSO.sim) return inter.editReply(await telaDosPlanos(idioma));
  if (inter.customId === PASSO.nao) return inter.editReply(await telaDeAjuda(idioma));
  if (inter.customId === PASSO.inicio) return inter.editReply(await telaDeApresentacao(idioma));
  if (inter.customId === PASSO.ajuda) {
    const tema = String(inter.values?.[0] || "");
    /* Instalar nao e' uma explicacao de um paragrafo: e' uma sequencia. Por
       isso ele aparece no menu como qualquer tema e sai daqui por outro
       caminho. */
    if (tema === TEMA_INSTALAR) return inter.editReply(await telaDoPasso(idioma, 1));
    return inter.editReply(await telaDeAjuda(idioma, tema));
  }
}

/* Uma apresentacao por hora, por pessoa.

   O cartao continua na tela da conversa -- reenviar a cada mensagem seria
   empurrar pra cima o texto que a pessoa acabou de mandar traduzir, e
   transformar ajuda em spam. Uma hora e' tempo de sobra pra ela ter rolado
   pra longe. */
const APRESENTEI = new Map(); // userId -> quando
const ESPERA_APRESENTACAO = 60 * 60 * 1000;

/* Perguntar e marcar sao duas coisas, e junta-las custou uma conversa.

   A versao anterior marcava a pessoa como apresentada no MOMENTO DA PERGUNTA.
   Se o envio falhasse logo depois -- e ele falha, por exemplo, quando quem
   escreveu apaga a propria mensagem antes de eu responder --, ela ficava
   marcada sem nunca ter visto o cartao, e calada por uma hora. Foi exatamente
   isso que aconteceu no primeiro teste real: "oi", apagado, e a mensagem
   seguinte nao trouxe nada.

   Agora quem marca e' o sucesso. */
function podeApresentar(userId) {
  return Date.now() - (APRESENTEI.get(userId) || 0) >= ESPERA_APRESENTACAO;
}

function marcarApresentado(userId) {
  APRESENTEI.set(userId, Date.now());
}

/* O privado vira um tradutor pessoal.

   E' o mesmo motor do seletor que ja existe nos canais, e reaproveita as duas
   funcoes que o alimentam. Aqui ele custa ainda menos: no privado nao ha
   plateia, entao nao existe a pergunta de encher canal de ninguem. */
/* Falar na conversa, e nao responder A mensagem.

   `reply` pendura a resposta numa mensagem especifica, e morre inteira se essa
   mensagem sumir -- foi o que derrubou o primeiro teste real. Numa DM a
   referencia nao serve pra nada de qualquer jeito: so' existem duas pessoas
   ali, e nao ha' o que desambiguar.

   Devolve se conseguiu, porque quem chama precisa saber: marcar como
   apresentado um envio que falhou e' o defeito que isto conserta. */
async function falarNoPrivado(msg, carga) {
  const onde = msg.channel;
  if (typeof onde?.send !== "function") return false;
  return onde.send({ ...carga, allowedMentions: { parse: [] } })
    .then(() => true)
    .catch((e) => {
      console.error("privado: nao consegui falar:", e?.message || e);
      return false;
    });
}

async function atenderNoPrivado(msg) {
  const texto = String(msg.content || "").trim();
  /* O ESCOLHIDO, não o de palpite: é ele que decide se a conversa abre
     perguntando a língua ou já se apresentando nela. */
  const escolhido = await idiomaEscolhido(msg.author.id);

  /* "idioma" numa conversa de tradutor quase nunca e' texto pra traduzir: e'
     alguem pedindo pra trocar. Vale nas duas linguas em que a pessoa poderia
     pedir sem ja ter escolhido uma. */
  if (/^(idioma|language|lingua|língua)$/i.test(texto)) {
    return falarNoPrivado(msg, telaDoIdioma());
  }

  if (podeApresentar(msg.author.id)) {
    /* Sem idioma escolhido, a PRIMEIRA tela e' a pergunta do idioma -- e nao a
       apresentacao. Me apresentar em portugues para quem fala turco e' entregar
       uma parede de texto que ele nao le, com a saida escondida embaixo. */
    const tela = escolhido ? await telaDeApresentacao(escolhido) : telaDoIdioma();
    /* Marca so' depois de entregar: assim uma falha de envio nao cala o bot
       por uma hora para alguem que nunca viu o cartao. */
    if (await falarNoPrivado(msg, tela)) marcarApresentado(msg.author.id);
  }

  /* Texto de verdade ganha o seletor de traducao. O limite por pessoa e' o
     mesmo dos canais: sem ele, uma conversa no privado seria um jeito de
     gastar a cota de tradutor sem passar por servidor nenhum. */
  if (porQueNaoTraduzir(texto, TEXTO_MAXIMO) !== null) return;
  if (!podeTraduzirAgora(msg.author.id)) return;

  const id = await guardarPraTraduzir(texto, msg.url).catch(() => null);
  if (!id) return;

  await falarNoPrivado(msg, {
    content: "-# 🌐 Ler no seu idioma / Read in your language",
    components: menuTraduzir(id),
  });
}

async function comandoAjuda(inter) {
  const idioma = await idiomaDoJogador(inter.user.id, inter.locale);
  const souAdmin = !!inter.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const embed = await traduzirEmbed(paginaDoMembro(souAdmin), idioma, await motorDoGuild(inter.guildId));
  return inter.reply({
    flags: 64,
    embeds: [{ color: COR, ...embed }],
    components: menuIdioma(),
  });
}

/* A arena em qualquer sala, e ja' na lingua de quem chamou.

   O fixado continua sendo o ponto de encontro -- e' ele que faz alguem que nao
   procurava nada parar e olhar. Mas ele mora numa sala so', e quem esta
   conversando em outra nao vai ate' la'. O comando traz a mesma tela para onde
   a pessoa esta', efemera: ninguem mais ve, e ela some sozinha. */
async function comandoArena(inter) {
  if (!inter.guildId) {
    return inter.reply({ flags: 64, content: "Este comando só funciona dentro de um servidor." });
  }
  await inter.deferReply({ flags: 64 });
  const servidor = await servidorDoGuild(inter.guildId);
  if (!servidor) {
    return inter.editReply({ content: "Ainda não terminei de me instalar aqui. Tente de novo em um minuto." });
  }
  const escolhido = await idiomaEscolhido(inter.user.id);
  return mostrarArena(inter, servidor, escolhido || idiomaDoAplicativo(inter.locale) || "en", !!escolhido);
}

async function comandoDeInteracao(inter) {
  const idioma = await idiomaDoJogador(inter.user.id, inter.locale);
  const nome = inter.commandName;

  /* O painel onde a pessoa estiver.

     O canal de configuracao e' fixado e so' os administradores enxergam. O
     /cyron abre a mesma tela em qualquer lugar, efemera -- pra quem tem o
     cargo mas nao lembra onde fica a sala, e pra quem esta' no meio de outra
     conversa e nao quer sair dela pra ligar uma coisa. E' o mesmo desenho e o
     mesmo estado: mexer aqui atualiza o fixado tambem. */
  if (nome === "help") return comandoAjuda(inter);
  if (nome === "admin") return comandoAdmin(inter);
  if (nome === "arena") return comandoArena(inter);

  /* Os comandos que o dono escreveu vem DEPOIS dos meus, nao antes.

     Antes, um comando chamado "help" ou "cyron" tomaria o lugar do de verdade
     e o dono derrubaria o proprio painel sem perceber. Depois, o pior caso e'
     o dele nao ser chamado -- e o formulario recusa esses nomes na hora de
     salvar, que e' onde ainda da' pra explicar por que. */
  if (inter.guildId) {
    const meu = (await comandosDoDono(inter.guildId)).find((c) => c.nome === nome);
    if (meu) return rodarComandoDoDono(inter, meu);
  }

  if (nome === "cyron") {
    if (!inter.guildId) {
      return inter.reply({ flags: 64, content: "Este comando só funciona dentro de um servidor." });
    }
    const servidor = await servidorDoGuild(inter.guildId);
    if (!servidor) {
      return inter.reply({ flags: 64, content: "Ainda não terminei de me instalar aqui. Tente de novo em um minuto." });
    }
    /* Efêmero e de uma pessoa só: aqui dá para falar a língua dela.
       O palpite do Discord entra como no resto -- quem nunca escolheu idioma
       ainda assim lê o painel na língua do aparelho. */
    await inter.deferReply({ flags: 64 });
    const meu = (await idiomaEscolhido(inter.user.id)) || idiomaDoAplicativo(inter.locale);
    const { embed, componentes } = await montarPainel(inter.guild, servidor, meu);
    return inter.editReply({ embeds: [embed], components: componentes });
  }

  if (nome === "mylanguage") {
    const novo = inter.options.getString("language");
    if (!LINGUAS_MENU.some(([c]) => c === novo)) {
      return responder(inter, { title: "🤔 Idioma não reconhecido",
        description: "Escolha uma das opções da lista." }, { idioma });
    }
    await inter.deferReply({ flags: 64 });
    await salvarIdiomaJogador(inter.user.id, novo);
    return responder(inter, { color: COR_OK, title: "🌐 Idioma salvo!",
      description: `A partir de agora tudo aparece em **${nomeDoIdioma(novo)}**.` }, { idioma: novo });
  }

  if (nome === "Translate") {
    /* Pela mesma funcao da bandeira, e nao por `.content`.
       Aviso automatico chega com o corpo vazio e a mensagem inteira dentro do
       embed -- entao o Translate respondia "mensagem vazia" justamente nos
       avisos, que sao o texto que mais gente precisa ler traduzido. */
    const texto = textoDaMensagem(inter.targetMessage);
    await inter.deferReply({ flags: 64 });
    if (!texto) {
      return responder(inter, { title: "🤔 Mensagem vazia",
        description: "Essa mensagem não tem texto pra traduzir (só imagem ou anexo)." }, { idioma });
    }
    const t = await traduzirLongo(texto, idioma, await motorDoGuild(inter.guildId));
    /* Traducao que volta igual ao original nao e' resposta: e' o texto de
       novo. Quem pediu conclui que o bot nao fez nada -- ou, pior, que ele
       disse que a mensagem ja estava na lingua dela. Dizer o que aconteceu, e
       onde se troca de idioma, custa uma frase. */
    if (t && t.trim() === texto.trim()) {
      return responder(inter, {
        title: `🌐 Já está em ${nomeDoIdioma(idioma)}`,
        description: "Esta mensagem já está no idioma em que eu falo com você.\n\n" +
          "Se você lê em outra língua, troque com **/mylanguage** — eu passo a " +
          "traduzir tudo para ela.",
      }, { idioma });
    }
    return responder(inter, t
      ? { title: `🌐 ${nomeDoIdioma(idioma)}`, description: t.slice(0, 3800),
          footer: { text: "Quer mudar o idioma? Use /mylanguage" } }
      : { title: "❌ Não deu", description: "Não consegui traduzir agora." }, { idioma: "pt" });
  }

  if (nome === "portal") {
    return responder(inter, { title: "🏰 Portal da Aliança",
      description: `Agenda no seu fuso, tutoriais dos eventos e ranking.\n\n${PORTAL}` },
      { efemera: false, idioma });
  }

  if (nome === "player") {
    const fid = String(inter.options.getString("id") || "").trim();
    if (!/^\d{5,15}$/.test(fid)) {
      return responder(inter, { title: "🤔 ID estranho",
        description: "O ID do jogo é só números. Veja no seu perfil dentro do jogo." }, { idioma });
    }
    await inter.deferReply();
    return responder(inter, await embedJogador(fid), { idioma });
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
    return responder(inter, embed, { idioma });
  }

  /* Daqui pra baixo precisa de alianca ligada. */
  const vinculo = await aliancaCompleta(inter.guildId);
  if (!vinculo) {
    return responder(inter, {
      title: "🔗 Falta ligar este servidor à aliança",
      description: "Um oficial resolve aqui mesmo:\n\n`/settings server code:<código de oficial>`\n\n" +
        `O código está no [portal](${PORTAL}), em **Painel do oficial → Minha aliança**.`,
    }, { idioma });
  }
  const tag = tagBonita(vinculo.aliancas || {});

  if (nome === "events") {
    await inter.deferReply();
    return responder(inter, await embedEventos(vinculo.alianca_id, tag), { idioma });
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
    return responder(inter, embed, { idioma });
  }

  return responder(inter, { title: "🤷 Não conheço esse comando" }, { idioma });
}

client.on("interactionCreate", async (inter) => {
  try {
    /* Painel: botao e menu de canais. O prefixo vem antes do tipo porque o
       menu de fontes deixou de ser o nativo (tipo 8) e virou menu de opcoes
       (tipo 3) -- o mesmo tipo do seletor de idioma. Roteando pelo customId,
       trocar o tipo do componente nao volta a quebrar isto. */
    if (inter.isMessageComponent() && inter.customId.startsWith("cyron:")) {
      return await cliquePainel(inter);
    }
    if (inter.isMessageComponent() && inter.customId.startsWith("arena:")) {
      return await cliqueArena(inter);
    }
    if (inter.isMessageComponent() && inter.customId.startsWith("admin:")) {
      return await cliqueAdmin(inter);
    }
    if (inter.isMessageComponent() && inter.customId.startsWith("cli:")) {
      return await cliqueDaFicha(inter);
    }
    /* A conversa do privado. Vem antes dos seletores porque um dos passos E'
       um seletor (o menu de temas), e la' embaixo ele cairia no ramo de
       idioma sem nunca chegar aqui. */
    if (inter.isMessageComponent() && inter.customId.startsWith("dm:")) {
      return await cliqueNoPrivado(inter);
    }
    /* Botao e formulario de um comando que o dono escreveu.

       Ate' aqui, um botao num cartao desses NASCIA MORTO: o codigo do dono
       montava o componente, o Discord desenhava, e o clique nao chegava em
       lugar nenhum -- ninguem estava escutando por ele. Quem clicasse via
       "Esta interação falhou", e nao havia como o dono descobrir por que.

       A convencao e' `dono:<nome>:<oquefor>`. O que vem depois do nome e' do
       codigo dele, e chega inteiro em `inter.customId`: e' assim que um mesmo
       comando atende o /nome, o botao e o formulario sem eu inventar tres
       registros diferentes. */
    if ((inter.isMessageComponent() || inter.isModalSubmit()) && inter.customId.startsWith("dono:")) {
      return await cliqueDeComandoDoDono(inter);
    }
    /* O botao da porta de entrada abre a mesma explicacao do /help, efemera e
       ja traduzida -- e' o unico jeito de essa mensagem publica falar a lingua
       de cada um que passa por ela. */
    if (inter.isButton() && inter.customId === "como-funciona") {
      return await comandoAjuda(inter);
    }
    if (inter.isModalSubmit()) {
      if (inter.customId === "cyron:motor") return await salvarMotor(inter);
      if (inter.customId === "cyron:palavras") return await salvarPalavras(inter);
      if (inter.customId === "cyron:codigo") return await resgatarCodigo(inter);
      if (inter.customId === "admin:codigos") return await gerarCodigos(inter);
      if (inter.customId === "admin:ajustes") return await salvarAjustes(inter);
      if (inter.customId === "admin:chaves") return await salvarChaves(inter);
      if (inter.customId === "admin:novocomando") return await salvarComando(inter);
      if (inter.customId === "admin:busca") return await procurarServidor(inter);
      return;
    }
    if (inter.isStringSelectMenu()) {
      if (inter.customId === "escolher-idioma") return await cliqueEscolherIdioma(inter);
      if (inter.customId.startsWith("traduzir-msg:")) return await cliqueTraduzirMsg(inter);
      if (inter.customId.startsWith("traduzir-fixo:")) return await cliqueTraduzirFixo(inter);
      return;
    }
    /* Autocompletar do nome do evento: sem isto o oficial teria que digitar
       "Urso (Bear Trap) 1" exatamente igual, acentos e parenteses inclusive. */
    if (inter.isAutocomplete()) {
      const digitado = String(inter.options.getFocused() || "").toLowerCase();
      const evs = await rpc("discord_eventos_do_guild", { p_guild: inter.guildId }).catch(() => []);
      return inter.respond((evs || [])
        .filter((e) => !digitado || String(e.titulo).toLowerCase().includes(digitado))
        .slice(0, 25)
        .map((e) => ({ name: (e.tem_gif ? "🖼️ " : "") + e.titulo, value: e.titulo })));
    }

    if (inter.isChatInputCommand() || inter.isMessageContextMenuCommand()) {
      return await comandoDeInteracao(inter);
    }
  } catch (e) {
    console.error("interacao: falhou:", e?.message || e);
    /* Erro sem resposta vira "Esta interação falhou", que nao diz nada a
       ninguem. Uma frase honesta e' melhor que o aviso generico do Discord. */
    const aviso = { content: "❌ Algo falhou aqui do meu lado. Tente de novo em instantes.", flags: 64 };
    /* Num clique de painel o defer foi deferUpdate: editReply ali apagaria o
       painel e poria o erro no lugar dele. O aviso vai por followUp. */
    if (inter.isMessageComponent?.() && inter.deferred) await inter.followUp(aviso).catch(() => {});
    else if (inter.deferred || inter.replied) await inter.editReply(aviso).catch(() => {});
    else await inter.reply(aviso).catch(() => {});
  }
});

client.on("messageCreate", async (msg) => {
  try {
    /* Conversa no privado sai por aqui, e antes de qualquer coisa: dali pra
       baixo tudo pressupoe servidor -- inquilino, plano, canais, cargos --, e
       nada disso existe numa DM.

       Bot nenhum entra: o meu proprio cartao voltaria como mensagem, e eu
       responderia a mim mesmo para sempre. */
    if (!msg.guild) {
      if (!msg.author?.bot) await atenderNoPrivado(msg);
      return;
    }

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
      if (fonte) await replicarPorIdioma(msg, servidorId, fonte, motorDe(servidor));

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
      /* Mesmo ajuste do outro ramo: sem ele, TODO webhook de terceiro (bot de
         música, aviso de GitHub, feed de notícia) ganharia um tópico de
         tradução pendurado. */
      if (!servidor.tradutor_topico) return;

      const texto = textoDaMensagem(msg);
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
    /* Falar numa replica agora chega nas irmas.

       A replica era destino, nunca origem: quem comentasse ali levava um
       recado dizendo que aquilo nao ia pra lugar nenhum. So' que comentar o
       aviso embaixo do aviso e' a coisa mais natural que existe, e a resposta
       do administrador -- justamente a que interessa a todo mundo -- morria
       na lingua dele.

       Agora a familia de replicas de um mesmo canal-fonte conversa entre si,
       igual as salas de chat. O caminho e' o mesmo daquelas, de proposito:
       uma lista de destinos e uma origem. Duas rotas de espelho seria a
       receita de corrigir de um lado e esquecer do outro, que ja' aconteceu
       neste projeto mais de uma vez.

       A fala NAO volta pro canal de origem: ele e' o original, na lingua da
       casa, e ja' esta escondido de quem escolheu idioma. Mandar de volta
       encheria o canal do dono com a conversa dos oito.

       No plano gratis a replica segue so' leitura -- por permissao, entao
       ninguem esbarra nisso sem querer --, e quem passa por cima (o dono do
       servidor passa) continua recebendo o recado de onde e' o lugar. */
    const replicas = await replicasDoIdioma(servidorId);
    const aqui = replicas.find((r) => r.canal_id === msg.channel.id);
    if (aqui) {
      if (planoDe(servidor) !== "pago") {
        await orientarNaReplica(msg, servidor, aqui);
        return;
      }
      const irmas = replicas.filter((r) => r.tipo === aqui.tipo);
      await espelharMensagem(msg, irmas, aqui, texto, motorDe(servidor), servidorId, termosDoServidor(servidor));
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
      await replicarPorIdioma(msg, servidorId, fonteAqui, motorDe(servidor));
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
      await espelharMensagem(msg, espelho, origem, texto, motorDe(servidor), servidorId, termosDoServidor(servidor));
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
    /* A piada das rosas continua sendo coisa da alianca. */
    const aliancaId = await aliancaDoGuild(msg.guild.id);
    if (aliancaId && mencionaLadyOuMaelle(texto)) {
      const url = await gifRosas(aliancaId);
      if (url) msg.reply({ files: [url], allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    /* O tradutor por topico e' ajuste do servidor, nao privilegio de plano.

       Ele cabe no gratis porque nao constroi nada -- nem categoria, nem cargo,
       nem canal -- e porque e' PUXADO: traduz uma vez, quando alguem clica, e so
       pra lingua daquela pessoa. A replica traduz pra todos os idiomas em toda
       mensagem, tenha leitor ou nao.

       Vem desligado porque ligado de fabrica ele pendura um topico embaixo de
       cada frase de cada canal, inclusive dos webhooks de terceiro. */
    if (servidor.tradutor_topico && podeTraduzirAgora(msg.author.id)) {
      await traduzirEResponder(msg, texto);
    }
  } catch (e) {
    console.error("erro ao processar mensagem:", e?.message || e);
  }
});

/* ---------------- traducao por bandeira ----------------

   O recurso mais barato do bot, e o unico que escala sem doer.

   O espelho traduz TODA fala pra TODO idioma que existe no servidor: uma
   mensagem de 45 caracteres num servidor de oito linguas custa 363
   caracteres de tradutor, tenha leitor ou nao. A bandeira custa 45, uma vez,
   e so' quando alguem de fato quis ler. Medindo o mesmo servidor, isso e' da
   ordem de cem vezes menos -- e' o que torna um plano gratis possivel sem
   que ele coma a cota de quem paga.

   Por isso ela nao pede plano nem constroi nada: sem canal, sem cargo, sem
   categoria, sem topico pendurado. So' existe quando alguem toca. */

/* O texto que interessa numa mensagem pode estar no corpo ou no embed --
   aviso automatico costuma vir so' com "@everyone" no corpo e a mensagem
   inteira dentro do embed. Isto ja era feito na mao no messageCreate; agora
   ha' dois lugares precisando do mesmo, entao vira funcao. */
function textoDaMensagem(msg) {
  const emb = msg?.embeds?.[0];
  const doEmbed = emb ? [emb.title, emb.description].filter(Boolean).join("\n") : "";
  return String(doEmbed || msg?.content || "").trim();
}

/* A entrega e' no PRIVADO, e essa escolha e' o recurso inteiro.

   Traducao publica encheria a sala: um servidor com oito linguas viraria oito
   respostas embaixo de cada fala, e a conversa -- que e' o produto -- sumiria
   embaixo do bot. No privado, so' quem pediu ve.

   Mas muita gente fecha a caixa de privado, e num servidor de jogo isso e'
   quase regra. Sem plano B, pra essas pessoas o botao simplesmente nao
   funciona, sem dizer por que. Entao ha' plano B: uma mensagem na propria
   sala, marcando so' quem pediu, que se apaga sozinha. Um minuto e meio e'
   tempo de ler e nao e' tempo de virar bagunca. */
const APAGAR_DEPOIS = 90 * 1000;

async function entregarNoPrivado(quem, canal, carga) {
  const foi = await quem.send(carga).then(() => true).catch(() => false);
  if (foi) return "privado";
  if (typeof canal?.send !== "function") return "";

  const solta = await canal.send({
    ...carga,
    content: `<@${quem.id}>`,
    allowedMentions: { users: [quem.id] },
  }).catch(() => null);
  if (!solta) return "";

  setTimeout(() => solta.delete().catch(() => {}), APAGAR_DEPOIS);
  return "canal";
}

/* Quem passou do limite recebe UM aviso por minuto, nao um por clique.

   Silencio seria pior: a pessoa clica, nao acontece nada, e a conclusao dela
   e' que o bot esta quebrado. Um aviso por clique seria o proprio flood que o
   limite existe pra evitar. */
const avisoDeLimite = new Map(); // userId -> quando
function podeAvisarDoLimite(userId) {
  const antes = avisoDeLimite.get(userId) || 0;
  if (Date.now() - antes < 60_000) return false;
  avisoDeLimite.set(userId, Date.now());
  return true;
}

/* ---- por que a bandeira nao deu em nada ----

   Uma jogadora alema pos a bandeira, nao aconteceu NADA, e ela passou uma hora
   com outro jogador tentando adivinhar antes de desistir. O caminho da
   bandeira tinha cinco saidas mudas -- servidor sem instalar, recurso
   desligado pelo dono, mensagem sem texto -- e em nenhuma delas ela tinha como
   saber o que havia de errado. Do lado de fora, bot que nao responde e' bot
   quebrado.

   Falar so' depois de a bandeira ser RECONHECIDA. 👍 e 😂 continuam nao
   custando nada: a intencao ali nao e' pedir traducao, e responder a elas
   seria transformar cada reacao do servidor numa mensagem minha.

   Um aviso por pessoa a cada dez minutos, contando o motivo junto: quem
   descobriu que o dono desligou o recurso nao precisa ouvir de novo a cada
   bandeira, e quem esbarrar noutro motivo continua sendo avisado. */
const avisoDaBandeira = new Map(); // `${userId}:${motivo}` -> quando
const ESPERA_AVISO_BANDEIRA = 10 * 60 * 1000;

const PORQUE_NAO = {
  semServidor: {
    titulo: "🌐 Eu ainda não fui instalado aqui",
    texto: "A bandeira funciona nos servidores onde eu estou instalado. Alguém com " +
      "**Gerenciar Servidor** pode me adicionar — é um clique, e eu me instalo sozinho.",
    ingles: "_Flags work in servers where I'm installed. Anyone with **Manage Server** can add me._",
  },
  desligado: {
    titulo: "🏳️ A tradução por bandeira está desligada neste servidor",
    texto: "Quem administra este servidor desligou este recurso. Você ainda pode me " +
      "mandar o texto **aqui no privado** que eu traduzo para você.",
    ingles: "_An admin turned this off here. You can still send me the text in a DM and I'll translate it._",
  },
  semTexto: {
    titulo: "🤔 Essa mensagem não tem texto",
    texto: "Só imagem, anexo ou emoji — não há o que traduzir. Ponha a bandeira numa " +
      "mensagem escrita.",
    ingles: "_Image, attachment or emoji only — there's nothing to translate. Put the flag on a written message._",
  },
};

async function bandeiraNaoDeu(quem, canal, motivo) {
  const p = PORQUE_NAO[motivo];
  if (!p) return;

  const chave = `${quem.id}:${motivo}`;
  if (Date.now() - (avisoDaBandeira.get(chave) || 0) < ESPERA_AVISO_BANDEIRA) return;
  avisoDaBandeira.set(chave, Date.now());

  /* Pela mesma entrega do sucesso, e nao por `quem.send` cru: a caixa de
     privado fechada e' quase regra em servidor de jogo, e um aviso que morre
     ali deixa a pessoa exatamente no silencio que ele existe pra quebrar. */
  await entregarNoPrivado(quem, canal, {
    embeds: [{ color: COR, title: p.titulo, description: `${p.texto}\n\n${p.ingles}` }],
  });
}

client.on("messageReactionAdd", async (reacao, quem) => {
  try {
    if (!quem || quem.bot) return;

    /* A bandeira decide ANTES de qualquer ida ao banco ou ao Discord: a
       esmagadora maioria das reacoes de um servidor e' 👍 e 😂, e nenhuma
       delas deve custar uma consulta. */
    const idioma = idiomaDaBandeira(reacao.emoji?.name);
    if (!idioma) return;

    if (reacao.partial) {
      const cheia = await reacao.fetch().catch(() => null);
      if (!cheia) return;
      reacao = cheia;
    }
    const msg = reacao.message?.partial
      ? await reacao.message.fetch().catch(() => null)
      : reacao.message;
    if (!msg?.guild) return;

    const servidor = await servidorDoGuild(msg.guild.id);
    if (!servidor) return await bandeiraNaoDeu(quem, msg.channel, "semServidor");
    /* `!== false` e nao `=== true`: enquanto a coluna nao existir, a leitura
       devolve undefined e o recurso fica ligado. No dia em que ela existir, o
       dono desliga sem que uma linha daqui mude. */
    if (servidor.tradutor_bandeira === false) {
      return await bandeiraNaoDeu(quem, msg.channel, "desligado");
    }

    const texto = textoDaMensagem(msg);
    if (!texto) return await bandeiraNaoDeu(quem, msg.channel, "semTexto");

    if (!podeTraduzirAgora(quem.id)) {
      if (podeAvisarDoLimite(quem.id)) {
        await entregarNoPrivado(quem, msg.channel, {
          embeds: [{ color: COR, title: "⏳ Calma aí / Slow down",
            description: "Você pediu muitas traduções seguidas. Tente de novo em um minuto.\n\n" +
              "_You asked for too many translations at once. Try again in a minute._" }],
        });
      }
      return;
    }

    const traduzido = await traduzirLongo(texto, idioma, motorDe(servidor));
    if (!traduzido) {
      await entregarNoPrivado(quem, msg.channel, {
        embeds: [{ color: COR, title: "❌ Não deu / Failed",
          description: "Não consegui traduzir agora. Tente de novo em instantes.\n\n" +
            "_Could not translate right now. Try again shortly._" }],
      });
      return;
    }

    /* Quem falou vem no cabecalho porque, no privado, a fala chega fora da
       sala: sem o nome e sem o link de volta, e' um texto solto que a pessoa
       nao consegue situar nem responder. */
    const autor = msg.member?.displayName || msg.author?.username || "";
    const onde = await entregarNoPrivado(quem, msg.channel, {
      embeds: [{
        color: COR,
        author: autor ? { name: autor, icon_url: msg.author?.displayAvatarURL?.() } : undefined,
        title: nomeDoIdioma(idioma),
        description: traduzido.slice(0, 3800) + (msg.url ? `\n\n[⤴ Voltar / Back](${msg.url})` : ""),
        footer: { text: `#${msg.channel?.name || ""} · ${msg.guild.name}` },
      }],
    });
    if (!onde) return; // nem privado nem sala: nao ha o que limpar

    /* Tirar a bandeira devolve a mensagem limpa e deixa a pessoa pedir de
       novo. So' depois de entregar: reacao que sumiu sem resposta seria a
       unica pista de que houve tentativa. Precisa de "Gerenciar mensagens",
       entao e' na tentativa -- onde nao ha, a bandeira fica, e funciona
       igual. */
    await reacao.users.remove(quem.id).catch(() => {});
  } catch (e) {
    console.error("bandeira: nao consegui traduzir:", e?.message || e);
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
/* "admin" entra nesta lista mesmo nao sendo de todos.

   A lista diz "nao mexa nisto", e nao "todo mundo usa". Sem ele aqui,
   separarComandos leria /admin como comando do jogo e o empurraria pros
   servidores com alianca -- exatamente o contrario do que ele e'. */
const COMANDOS_DE_TODOS = new Set(["mylanguage", "Translate", "cyron", "help", "admin", "arena"]);

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

      /* `set` nao acrescenta: ele troca a lista inteira daquele servidor, e
         leva junto os comandos que o dono escreveu. Mandar os dele dentro da
         carga nao resolveria -- `set` cria tudo com id novo, e o id gravado no
         banco e' justamente como o publicador sabe que o comando e' dele.

         Entao deixo o `set` limpar e mando publicar de novo logo atras: ele
         recria o que falta e grava os ids novos. Some por um segundo, e volta
         sabendo de quem e'. */
      await publicarComandosDoDono(guild);
    }

    const ficam = [...globais.values()].filter((c) => COMANDOS_DE_TODOS.has(c.name)).map((c) => c.toJSON());
    await client.application.commands.set(ficam);
    console.log(`comandos: globais reduzidos a ${ficam.map((c) => c.name).join(", ")}`);
  } catch (e) {
    console.error("comandos: não consegui separar:", e?.message || e);
  }
}

/* ---------------- Comandos que o dono escreve ----------------

   Pedido do dono: um lugar pra colar codigo e o bot passar a atender um
   comando novo, sem eu publicar nada. Argumentei contra tres vezes, ele
   manteve o pedido tres vezes -- e' produto dele. O que me cabe e' construir
   com as travas que nao atrapalham o uso, e deixar escrito o que continua
   valendo APESAR delas.

   O que as travas cobrem:
   - So' o dono cria, edita e apaga.
   - Quem pode CHAMAR e' escolhido por comando, e nasce em "so' o dono".
   - Tudo em try/catch: trecho que estoura vira mensagem, nao queda do bot.
   - Prazo de resposta, porque o Discord desiste da interacao em 15 minutos.
   - O ultimo erro fica gravado: comando que quebra calado e' pior que
     comando que nao existe.
   - Registrado so' no servidor onde foi criado, entao nao vaza pros clientes.

   O que as travas NAO cobrem, e por isso esta escrito:
   - O codigo roda DENTRO do bot e enxerga o token do Discord e as chaves.
   - `while (true) {}` trava o processo inteiro, e prazo nao resolve:
     JavaScript nao interrompe codigo que ja esta rodando. So' o Fly
     reiniciando resolve, e ate' la os sete servidores ficam parados.
   - Apagar canal e sair de servidor funcionam. Nao ha desfazer.
   - Nao passa pelos testes nem pela trava de publicacao, por definicao: e'
     codigo que nenhum dos dois viu. */

const cacheComandos = new Map(); // guildId -> { v, t }
async function comandosDoDono(guildId) {
  const achado = cacheComandos.get(guildId);
  if (achado && Date.now() - achado.t < 30 * 1000) return achado.v;
  let v = [];
  try {
    /* `select=*` de proposito. Nomear as colunas parecia mais caprichado ate'
       eu quase publicar isto: se o banco ainda nao tiver a coluna nova, o
       PostgREST recusa a consulta INTEIRA com 400, o catch aqui embaixo devolve
       lista vazia -- e todo comando do dono desaparece do servidor sem uma
       linha de erro. A linha e' pequena; o risco de nomear nao vale. */
    v = await sb(`cyron_comando?guild_id=eq.${encodeURIComponent(guildId)}&ativo=is.true&select=*`) || [];
  } catch { /* tenta de novo na proxima */ }
  cacheComandos.set(guildId, { v, t: Date.now() });
  return v;
}

/* Registra um por um, e nao com um `set` da lista inteira.

   `guild.commands.set(...)` SUBSTITUI todos os comandos daquele servidor --
   e' assim que separarComandos publica os do jogo. Se eu usasse `set` aqui
   tambem, um dos dois apagaria o outro, e o ultimo a rodar ganharia. Criar e
   apagar de um em um custa mais chamadas e nao pisa em ninguem. */
async function publicarComandosDoDono(guild) {
  try {
    const querem = await comandosDoDono(guild.id);
    const jaLa = await guild.commands.fetch();

    /* Quem e' meu se decide pelo ID gravado, nunca pelo nome.

       Decidir por nome foi um erro caro e silencioso: um comando do dono
       chamado "ranking" batia no /ranking do Kingshot, que ja' morava neste
       servidor. O codigo achava "ja' existe, entao e' o meu" e reescrevia a
       descricao do comando do jogo -- sem log, porque o ramo de editar nao
       logava nada. E na hora que o dono desativasse o dele, o laco de baixo
       apagaria o /ranking do jogo de vez.

       Com o id: comando sem id gravado nao e' meu, e eu nao encosto nele. */
    for (const c of querem) {
      const descricao = (c.descricao || `comando de ${c.nome}`).slice(0, 100);
      const meu = c.discord_id ? jaLa.get(c.discord_id) : null;

      if (meu) {
        if (meu.name !== c.nome || meu.description !== descricao) {
          await meu.edit({ name: c.nome, description: descricao });
          console.log(`comando do dono: /${c.nome} atualizado em ${guild.name}`);
        }
        continue;
      }

      /* Nome ocupado por um comando que nao e' meu: nao publico e nao roubo.
         Falo no log, porque calado o dono so' descobriria pelo comando que
         nunca aparece. O caminho certo e' ele escolher outro nome -- e
         salvarComando ja' recusa esse nome antes de gravar. */
      const alheio = [...jaLa.values()].find((x) => x.name === c.nome);
      if (alheio) {
        console.error(`comando do dono: /${c.nome} nao publicado em ${guild.name} ` +
          "-- ja' existe um comando com esse nome que nao e' meu");
        continue;
      }

      const novo = await guild.commands.create({ name: c.nome, description: descricao });
      await sbPatch(`cyron_comando?id=eq.${encodeURIComponent(c.id)}`, { discord_id: novo.id });
      c.discord_id = novo.id; // o laco de apagar, la' embaixo, le' daqui
      cacheComandos.delete(guild.id);
      console.log(`comando do dono: /${c.nome} publicado em ${guild.name}`);
    }

    /* Apaga so' o que EU criei e que saiu da tabela -- e de novo pelo id.
       Um id gravado e' prova de que aquele comando nasceu aqui; nome nao e'. */
    const vivos = new Set(querem.map((c) => c.discord_id).filter(Boolean));
    const meusAlgumDia = await sb(
      `cyron_comando?guild_id=eq.${encodeURIComponent(guild.id)}&select=nome,discord_id`) || [];
    for (const m of meusAlgumDia) {
      if (!m.discord_id || vivos.has(m.discord_id)) continue;
      const velho = jaLa.get(m.discord_id);
      if (velho) {
        await velho.delete();
        console.log(`comando do dono: /${velho.name} tirado de ${guild.name}`);
      }
    }
  } catch (e) {
    console.error("comando do dono: nao consegui publicar em", guild.name, e?.message || e);
  }
}

function podeChamar(inter, comando) {
  if (comando.quem_pode === "todos") return true;
  if (comando.quem_pode === "admin") {
    return inter.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true;
  }
  return null; // "dono": quem decide e' ehDono, que e' assincrono
}

const PRAZO_DO_COMANDO = 60 * 1000;

/* Rodar o codigo, anotar como foi, e nada mais.

   Separado porque agora existem DOIS jeitos de um comando rodar -- alguem
   digitando, e o relogio -- e eles so' se parecem aqui no meio. Fora daqui um
   tem interacao pra responder e prazo do Discord; o outro nao tem nem quem
   avisar. Deixar a execucao em dois lugares seria garantir que uma correcao
   entrasse so' num deles. */
async function executarCodigo(comando, { guild, canal, inter = null, canalId = null }) {
  const comeco = Date.now();
  let saiu, erro = null;
  try {
    /* AsyncFunction, e nao eval: assim `await` funciona sem a pessoa ter que
       embrulhar tudo. O que o codigo devolver com `return` e' o que aparece. */
    const Assincrona = Object.getPrototypeOf(async function () {}).constructor;
    const f = new Assincrona("client", "guild", "inter", "canal", "sb", "sbPost", "sbPatch", "sbDel", comando.codigo);
    saiu = await Promise.race([
      f(client, guild, inter, canal, sb, sbPost, sbPatch, sbDel),
      new Promise((_, x) => setTimeout(
        () => x(new Error(`passou de ${PRAZO_DO_COMANDO / 1000}s e eu parei de esperar`)), PRAZO_DO_COMANDO)),
    ]);
  } catch (e) {
    erro = String(e?.stack || e?.message || e);
  }
  const levou = Date.now() - comeco;

  /* Guarda o resultado da ultima vez. Comando que quebra em silencio faz quem
     chamou ver "falhou" sem saber por que, e o dono nao ficar sabendo. */
  sbPatch(`cyron_comando?id=eq.${encodeURIComponent(comando.id)}`, {
    ultima_vez: new Date().toISOString(),
    ultimo_erro: erro ? erro.slice(0, 500) : null,
    ...(canalId ? { canal_id: canalId } : {}),
  }).catch(() => { /* anotar e' bonus; a resposta ja' vai sair */ });

  return { saiu, erro, levou };
}

/* Chegou a hora deste comando rodar sozinho?

   Pura porque a conta erra calada dos dois lados: apertada demais faz o cartao
   envelhecer sem ninguem notar, larga demais faz o mesmo comando bater na API
   de terceiro a cada volta do relogio. */
function estaNaHora(comando, agora = Date.now()) {
  const cada = Number(comando?.cada_minutos || 0);
  if (!(cada > 0) || !comando?.canal_id) return false;
  if (!comando.ultima_vez) return true;
  const quando = Date.parse(comando.ultima_vez);
  if (Number.isNaN(quando)) return true;
  return agora - quando >= cada * 60 * 1000;
}

/* Os comandos que se atualizam sozinhos.

   O canal e' o ultimo em que alguem chamou o comando na mao. Sem isso eu teria
   que inventar um, e um cartao aparecendo num canal que ninguem escolheu e'
   pior do que cartao nenhum. */
async function rodarComandosAgendados() {
  for (const [, guild] of client.guilds.cache) {
    let lista = [];
    try {
      lista = await comandosDoDono(guild.id);
    } catch { continue; }

    for (const comando of lista) {
      if (!estaNaHora(comando)) continue;
      const canal = guild.channels.cache.get(String(comando.canal_id));
      if (!canal) continue;

      const { saiu, erro, levou } = await executarCodigo(comando, { guild, canal });
      if (erro) {
        console.error(`comando agendado: /${comando.nome} falhou:`, erro.slice(0, 200));
        continue;
      }
      /* O que voltou pronto pra ser mensagem sai no canal; o resto fica no log.
         O /reino, por exemplo, ja' edita o proprio cartao fixado e devolve so'
         uma confirmacao -- publicar isso seria empilhar recado a cada hora. */
      if (saiu && typeof saiu === "object" && (saiu.embeds || saiu.content || saiu.files)) {
        await canal.send({ ...saiu, allowedMentions: { parse: [] } })
          .catch((e) => console.error(`comando agendado: nao consegui publicar /${comando.nome}:`, e?.message || e));
      }
      console.log(`comando agendado: /${comando.nome} rodou em ${levou}ms (#${canal.name})`);
    }
  }
}

/* De qual comando é este clique. Pura porque um customId torto tem que virar
   "não sei quem atende isso" e não uma exceção no meio do despacho. */
function comandoDoCustomId(customId) {
  const p = String(customId || "").split(":");
  return p[0] === "dono" && p[1] ? p[1] : null;
}

async function cliqueDeComandoDoDono(inter) {
  const nome = comandoDoCustomId(inter.customId);
  if (!nome || !inter.guildId) return;
  const comando = (await comandosDoDono(inter.guildId)).find((c) => c.nome === nome);
  if (!comando) {
    /* O comando sumiu, mas o cartao dele continua no canal com o botao. Dizer
       isso e' melhor do que o silencio que o Discord traduz como "falhou". */
    return inter.reply({ flags: 64, content: "Este botão é de um comando que não existe mais." })
      .catch(() => {});
  }
  return rodarComandoDoDono(inter, comando);
}

async function rodarComandoDoDono(inter, comando) {
  const liberado = podeChamar(inter, comando);
  if (liberado === false || (liberado === null && !await ehDono(inter.user.id))) {
    return inter.reply({ flags: 64, content: "Este comando não é para você." });
  }

  /* Comando por barra eu adio; clique eu NAO.

     Adiar responde a interacao, e depois de respondida o Discord recusa
     `showModal`. Como o caminho natural de um botao e' justamente abrir um
     formulario, adiar aqui deixaria o unico gesto util impossivel -- e o erro
     apareceria como "esta interação falhou", longe da causa.

     O preco e' que o codigo do dono tem tres segundos pra dar sinal de vida
     num clique. Quem precisar de mais adia sozinho, com `inter.deferReply`. */
  const porBarra = typeof inter.isChatInputCommand === "function" && inter.isChatInputCommand();
  if (porBarra) {
    /* Efemero: resposta de comando escrito as pressas nao devia aparecer pro
       canal inteiro sem alguem ter decidido isso. */
    await inter.deferReply({ flags: 64 });
  }

  /* Registro ANTES de rodar. Se o trecho travar o processo, o que ficou no
     log e' a unica pista do que aconteceu. */
  console.log(`comando do dono: /${comando.nome} ${porBarra ? "chamado" : `(${inter.customId})`}` +
    ` por ${inter.user.tag || inter.user.id}`);

  const { saiu, erro, levou } = await executarCodigo(comando, {
    guild: inter.guild, canal: inter.channel, inter,
    /* So' o comando por barra escolhe onde o cartao mora. Um clique acontece
       ONDE O CARTAO JA ESTA, e gravar o canal daqui daria no mesmo -- ate' o
       dia em que alguem clicasse num cartao encaminhado pra outro canal e o
       agendado mudasse de lugar sozinho. */
    canalId: porBarra ? inter.channelId : null,
  });

  /* Quem ja respondeu, respondeu. O codigo pode ter aberto um formulario ou
     mandado a propria resposta; falar de novo por cima seria a segunda
     mensagem que ninguem pediu -- ou um erro de "interação já respondida". */
  const responder = async (corpo) => {
    if (inter.replied || inter.deferred) return inter.editReply(corpo).catch(() => {});
    return inter.reply({ ...(typeof corpo === "string" ? { content: corpo } : corpo), flags: 64 })
      .catch(() => {});
  };

  if (erro) {
    console.error(`comando do dono: /${comando.nome} falhou:`, erro.slice(0, 200));
    return responder(`❌ **/${comando.nome}** falhou em ${levou}ms\n\`\`\`js\n${erro.slice(0, 1700)}\n\`\`\``);
  }

  /* Codigo que respondeu sozinho e nao devolveu nada ja' terminou. Sem esta
     linha, um botao que so' abre formulario ganharia um "rodou em 40ms" de
     brinde por cima. */
  if (saiu === undefined && (inter.replied || inter.deferred) && !porBarra) return;

  /* O que voltou vira resposta. Texto sai como texto; objeto sai formatado;
     e o que ja' e' uma mensagem pronta (embed, componentes) sai como veio --
     e' o que deixa dar' pra montar cartao de verdade. */
  if (saiu && typeof saiu === "object" && (saiu.embeds || saiu.content || saiu.files)) {
    return responder(saiu);
  }
  if (typeof saiu === "string") return responder(saiu.slice(0, 1900) || "_(vazio)_");
  if (saiu === undefined) return responder(`✅ rodou em ${levou}ms, sem nada pra mostrar.`);

  let texto;
  try {
    texto = JSON.stringify(saiu, (k, v) => (typeof v === "bigint" ? `${v}n` : v), 2);
  } catch {
    texto = String(saiu); // objeto que se referencia, funcao, o que for
  }
  return responder(`\`${levou}ms\`\n\`\`\`json\n${String(texto).slice(0, 1800)}\n\`\`\``);
}

/* A janela de criar e editar comando.

   Nome vazio na edicao seria ambiguo -- criar outro ou renomear? -- entao o
   nome e' sempre obrigatorio e e' ele que decide: nome que ja existe neste
   servidor edita aquele, nome novo cria um. Uma regra, sem botao de modo. */
async function janelaDeComando(existente) {
  const c = existente || {};
  /* Codigo que nao se divide em duas caixas abre o formulario VAZIO, com o
     aviso no rotulo -- e salvar com as caixas vazias mantem o codigo que ja'
     esta la'. Assim o dono ainda muda nome, quem pode e ritmo de um comando
     grande demais, em vez de ficar trancado do lado de fora. */
  const partes = pedacosDoCodigo(c.codigo || "");
  return {
    custom_id: "admin:novocomando",
    title: c.nome ? `Comando /${c.nome}`.slice(0, 45) : "Novo comando",
    components: [
      /* Nome e descricao dividem a linha, separados por barra vertical.

         Espremer aqui foi o que liberou a QUINTA linha pro codigo. O Discord
         da' cinco linhas por formulario e nao negocia; o codigo e' a unica
         coisa aqui que nao tem tamanho previsivel, entao e' ele que ganha o
         espaco que sobra. */
      { type: 1, components: [{
        type: 4, custom_id: "nome", style: 1, required: true, max_length: 133,
        label: "Nome | descrição", placeholder: "reino | ranking do reino 2311",
        ...(c.nome ? { value: `${c.nome}${c.descricao ? ` | ${c.descricao}` : ""}` } : {}) }] },
      /* Idem: quem pode e de quanto em quanto tempo repetir. */
      { type: 1, components: [{
        type: 4, custom_id: "quem_pode", style: 1, required: false, max_length: 20,
        label: "Quem pode, e repetir a cada N minutos",
        placeholder: "todos 60  →  todos usam, e roda sozinho de hora em hora",
        ...(c.quem_pode ? { value: `${c.quem_pode}${c.cada_minutos ? ` ${c.cada_minutos}` : ""}` } : {}) }] },
      /* Duas caixas pro codigo, emendadas na hora de gravar.

         4000 e' o teto do Discord por caixa, e eu tinha posto 3500 -- numero
         meu, sem razao. Mas nem 4000 basta: o primeiro comando com botao deu
         4866 caracteres, e comando vindo de um assistente costuma ser maior
         ainda. Estourar aqui e' o pior jeito de recusar, porque o formulario
         nao avisa: ele so' para de aceitar letra, e a pessoa salva o codigo
         cortado no meio sem perceber. */
      { type: 1, components: [{
        type: 4, custom_id: "codigo", style: 2, required: false, max_length: CAIXA_DE_CODIGO,
        label: partes.coube
          ? "Código — o que der return vira a resposta"
          : "Código: grande demais pra caber aqui (vazio = mantém)",
        placeholder: partes.coube
          /* 100 e' o teto do Discord pra exemplo. Este tinha 109, entao toda
             vez que o formulario abria a janelaValida cortava e mandava um
             cartao pro canal de erros -- um erro por abertura, sobre o meu
             proprio texto. */
          ? "const r = await fetch(URL);\nconst j = await r.json();\nreturn `Poder: ${j.power}`;"
          : "deixe vazio pra manter o código atual e mudar só o resto",
        ...(partes.um ? { value: partes.um } : {}) }] },
      { type: 1, components: [{
        type: 4, custom_id: "codigo2", style: 2, required: false, max_length: CAIXA_DE_CODIGO,
        label: "Código (continuação — começa em linha nova)",
        placeholder: "deixe vazio se o código todo coube na caixa de cima",
        ...(partes.dois ? { value: partes.dois } : {}) }] },
      { type: 1, components: [{
        type: 4, custom_id: "apagar", style: 1, required: false, max_length: 10,
        label: "Apagar este comando? escreva SIM",
        placeholder: "vazio mantém" }] },
    ],
  };
}

/* Nomes que eu ja uso. Deixar o dono criar um /cyron dele nao daria erro
   nenhum -- simplesmente o dele nunca seria chamado, porque os meus vem
   antes. Silencio desses e' o pior tipo: parece que funcionou. */
/* "ranking" estava escrito aqui como "ranking-oficial" -- um nome que nao
   existe em lugar nenhum. A lista parecia cobrir o comando do jogo e nao
   cobria nada, e foi por essa fresta que um /ranking do dono passou e tomou o
   lugar do /ranking do Kingshot. Lista escrita a mao erra assim, calada;
   por isso salvarComando tambem pergunta ao Discord o que ja' existe. */
const NOMES_MEUS = new Set([
  "cyron", "help", "admin", "mylanguage", "arena", "settings", "portal", "player", "events", "ranking",
]);

/* Uma linha do formulario que carrega duas respostas: "todos 60".

   Separada e pura porque e' onde um dedo errado vira dano invisivel. Escrever
   `todos 5` num comando que fala com um site de terceiro sao 288 chamadas por
   dia, e ninguem descobre pelo Discord -- descobre quando o site bloqueia. O
   piso de 10 minutos existe por isso, e recusar em voz alta e' melhor do que
   arredondar calado: arredondar faria a pessoa achar que pediu 5 e recebeu 5.

   Numero sem sentido tambem recusa em vez de virar zero. "todos 0" pode ser
   dedo trocado pra 60, e ligar "nunca repete" nesse caso seria eu escolhendo
   por ela. */
const MINIMO_DO_RITMO = 10;

/* Corta o codigo nas duas caixas do formulario, e junta de volta.

   O contrato e' um so', e por isso ele fecha: **a segunda caixa comeca numa
   linha nova**. Juntar e' sempre `um + "\n" + dois`, entao cortar tem que ser
   sempre EM cima de uma quebra de linha -- nunca no meio de uma.

   Cortar na contagem crua parecia inofensivo e nao e': o `\n` que a juncao
   poe de volta apareceria no meio de uma linha que nao tinha nenhum. Num
   texto isso e' uma linha em branco; em codigo e' uma string literal partida
   ao meio. Um teste pegou isto antes de subir.

   Quando nao da' pra cortar em quebra -- codigo minificado, uma linha unica
   maior que a caixa --, eu digo que NAO COUBE em vez de cortar mesmo assim.
   Quem chama decide o que fazer com isso; o que nao pode e' devolver dois
   pedacos que nao remontam. */
const CAIXA_DE_CODIGO = 4000;

function pedacosDoCodigo(codigo) {
  const inteiro = String(codigo || "");
  if (inteiro.length <= CAIXA_DE_CODIGO) return { um: inteiro, dois: "", coube: true };

  const corte = inteiro.lastIndexOf("\n", CAIXA_DE_CODIGO);
  if (corte <= 0) return { um: "", dois: "", coube: false };

  const dois = inteiro.slice(corte + 1);
  /* Nem em duas caixas cabe: aqui tambem e' melhor dizer que nao coube. */
  if (dois.length > CAIXA_DE_CODIGO) return { um: "", dois: "", coube: false };

  return { um: inteiro.slice(0, corte), dois, coube: true };
}

function juntarCodigo(a, b) {
  const um = String(a || "");
  const dois = String(b || "");
  if (!dois) return um;
  return `${um}\n${dois}`;
}

function lerQuemPode(cru) {
  const partes = String(cru || "").trim().split(/\s+/).filter(Boolean);
  const PAPEIS = ["dono", "admin", "todos"];

  /* Quem escreve so' o numero quis o ritmo, nao um papel: "60" e' "de hora em
     hora", com quem pode ficando no padrao. Sem esta linha o 60 caía como
     papel desconhecido e o ritmo sumia calado -- o pior dos dois desfechos. */
  if (partes.length === 1 && /^\d+$/.test(partes[0])) return lerQuemPode(`dono ${partes[0]}`);

  /* Papel que eu nao conheco cai em "dono" -- o mais fechado -- e o resto da
     linha e' ignorado junto. Tentar ler minutos aqui fazia "qualquer um"
     responder "não entendi `um` como minutos", culpando a metade errada da
     frase e mandando a pessoa consertar o que nao estava quebrado. */
  if (!PAPEIS.includes(partes[0])) return { quem: "dono", cada: null, erroDoRitmo: null };

  const quem = partes[0];
  const resto = partes.slice(1).join(" ");
  if (!resto) return { quem, cada: null, erroDoRitmo: null };

  if (!/^\d+$/.test(resto)) {
    return { quem, cada: null,
      erroDoRitmo: `Não entendi \`${resto}\` como minutos — escreva só o número, por exemplo \`${quem} 60\`.` };
  }
  const cada = Number(resto);
  if (cada === 0) {
    return { quem, cada: null,
      erroDoRitmo: "Para não repetir, deixe só quem pode (`" + quem + "`) e apague o número." };
  }
  if (cada < MINIMO_DO_RITMO) {
    return { quem, cada: null,
      erroDoRitmo: `A cada ${cada} min é rápido demais — o mínimo é ${MINIMO_DO_RITMO}. ` +
        "Comando que fala com site de terceiro acaba bloqueado, e você descobriria pelo site, não por aqui." };
  }
  return { quem, cada, erroDoRitmo: null };
}

async function salvarComando(inter) {
  if (!await ehDono(inter.user.id)) {
    return inter.reply({ flags: 64, content: "Não conheço esse comando." });
  }
  await inter.deferReply({ flags: 64 });
  const campo = (n) => { try { return String(inter.fields.getTextInputValue(n) || "").trim(); } catch { return ""; } };

  /* "reino | ranking do reino" -- nome antes da barra, descricao depois. */
  const [nomeCru, ...restoDoNome] = campo("nome").split("|");
  const descricaoNaLinha = restoDoNome.join("|").trim();

  /* O Discord so' aceita minusculas, numeros, hifen e sublinhado, de 1 a 32.
     Recusar aqui com o motivo escrito e' melhor do que deixar a API recusar
     com um erro em ingles que ninguem le. */
  const nome = nomeCru.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9_-]{1,32}$/.test(nome)) {
    return inter.editReply("O nome só aceita letras minúsculas, números, `-` e `_`, até 32. **Não gravei nada.**");
  }
  if (NOMES_MEUS.has(nome)) {
    return inter.editReply(`\`/${nome}\` já é meu — o seu nunca seria chamado, e você não descobriria por quê. Escolha outro nome.`);
  }

  const jaExiste = (await sb(
    `cyron_comando?guild_id=eq.${encodeURIComponent(inter.guildId)}&nome=eq.${encodeURIComponent(nome)}` +
    "&select=id,discord_id,codigo"))?.[0];

  if (campo("apagar").toLowerCase() === "sim") {
    if (!jaExiste) return inter.editReply(`Não tenho nenhum \`/${nome}\` aqui para apagar.`);
    /* Desligo em vez de apagar a linha, e e' de proposito: o `discord_id` mora
       nela, e e' ele que diz ao publicador qual comando do Discord tirar. Com
       a linha apagada eu perdia o id junto, e o comando ficava pendurado no
       menu do servidor pra sempre, sem ninguem atras dele. */
    await sbPatch(`cyron_comando?id=eq.${encodeURIComponent(jaExiste.id)}`, { ativo: false });
    cacheComandos.delete(inter.guildId);
    await publicarComandosDoDono(inter.guild);
    return inter.editReply(`🗑️ \`/${nome}\` apagado e tirado do servidor.`);
  }

  /* Pergunto ao Discord antes de gravar: o nome pode estar ocupado por um
     comando que nao e' meu (os do Kingshot, por exemplo, moram no servidor).
     Recusar aqui e' a unica hora em que da' pra explicar o porque -- depois
     de gravado, o sintoma seria "criei e nao apareceu". */
  if (!jaExiste) {
    try {
      const jaLa = await inter.guild.commands.fetch();
      const ocupado = [...jaLa.values()].find((x) => x.name === nome);
      if (ocupado) {
        return inter.editReply(
          `Já existe um \`/${nome}\` neste servidor que não é seu — *${ocupado.description}*.\n` +
          "Se eu gravasse o seu, ou ele nunca apareceria, ou tomaria o lugar do outro. " +
          "Escolha outro nome. **Não gravei nada.**");
      }
    } catch { /* se o Discord nao respondeu, sigo: o publicador recusa de novo */ }
  }

  const { quem, cada, erroDoRitmo } = lerQuemPode(campo("quem_pode"));
  if (erroDoRitmo) return inter.editReply(`${erroDoRitmo} **Não gravei nada.**`);

  /* Caixa vazia num comando que ja' existe MANTEM o codigo, nao apaga.

     Vale pros dois casos em que ela vem vazia: o comando grande demais, que o
     formulario abre sem codigo de proposito, e o dedo que limpou a caixa sem
     querer. Nos dois, guardar vazio seria destruir o trabalho da pessoa por
     causa de um campo em branco. */
  const digitado = juntarCodigo(campo("codigo"), campo("codigo2"));
  const codigo = digitado || (jaExiste?.codigo || "");
  if (!codigo) return inter.editReply("O código está vazio. **Não gravei nada.**");

  const linha = {
    nome,
    descricao: descricaoNaLinha.slice(0, 100) || `comando ${nome}`,
    codigo,
    quem_pode: quem,
    cada_minutos: cada,
    guild_id: inter.guildId,
    ativo: true,
    ultimo_erro: null,
  };

  if (jaExiste) await sbPatch(`cyron_comando?id=eq.${encodeURIComponent(jaExiste.id)}`, linha);
  else await sbPost("cyron_comando", linha);

  cacheComandos.delete(inter.guildId);
  await publicarComandosDoDono(inter.guild);

  return inter.editReply(
    `${jaExiste ? "✏️ Atualizei" : "✅ Criei"} \`/${nome}\` — quem pode usar: **${quem}**.\n` +
    "Pode levar alguns segundos até aparecer na lista do Discord.\n\n" +
    "⚠️ Este código roda **dentro do bot**: ele enxerga as chaves, e um laço infinito trava os 7 servidores. " +
    "Teste com calma.");
}

/* A lista, pra saber o que existe e o que quebrou na ultima vez. */
async function embedDosComandos(guildId) {
  const meus = await sb(`cyron_comando?guild_id=eq.${encodeURIComponent(guildId)}` +
    "&select=*&order=nome.asc") || [];
  if (!meus.length) {
    return {
      color: 0x9aa0a6,
      title: "🧪 Comandos que você escreveu",
      description: "_nenhum ainda_\n\nO botão **Novo comando** cria o primeiro.",
    };
  }
  return {
    color: meus.some((c) => c.ultimo_erro) ? 0xE03E3E : 0x2E8B7A,
    title: "🧪 Comandos que você escreveu",
    fields: meus.slice(0, 20).map((c) => ({
      name: `/${c.nome}${c.ativo ? "" : " (desligado)"}`,
      value: [
        c.descricao || "_sem descrição_",
        `quem pode: **${c.quem_pode}**`,
        /* Um comando marcado pra repetir e SEM canal nunca vai rodar sozinho:
           ele não tem onde publicar, e fica esperando calado. Dizer isso aqui
           é o que evita a pessoa achar que ligou e não ligou. */
        c.cada_minutos
          ? (c.canal_id
            ? `🔁 sozinho a cada **${c.cada_minutos} min** em <#${c.canal_id}>`
            : `🔁 a cada **${c.cada_minutos} min** — ⚠️ chame ele uma vez no canal onde deve ficar`)
          : "",
        c.ultima_vez ? `última vez: ${quandoFoi(Date.parse(c.ultima_vez), "R")}` : "_nunca foi chamado_",
        c.ultimo_erro ? `❌ \`${String(c.ultimo_erro).split("\n")[0].slice(0, 90)}\`` : "",
      ].filter(Boolean).join("\n"),
    })),
    footer: { text: "escolha um abaixo para editar" },
  };
}

/* A lista E o caminho pra mexer nela.

   O menu vem junto do embed de proposito: lista que so' mostra e nao deixa
   agir ensina que aquele botao nao serve pra nada, e a pessoa para de clicar.

   Vinte e cinco e' o teto do Discord por menu. Passando disso, os de baixo
   ficam so' no texto -- e o rodape diz isso, em vez de eles sumirem calados. */
const MAX_NO_MENU = 25;

async function listaDeComandos(guildId) {
  const embed = await embedDosComandos(guildId);
  const meus = await comandosDoDono(guildId);
  if (!meus.length) return { embed, componentes: [] };

  const opcoes = meus.slice(0, MAX_NO_MENU).map((c) => ({
    label: `/${c.nome}`.slice(0, 100),
    description: String(c.descricao || "").slice(0, 100) || undefined,
    value: c.nome,
  }));
  if (meus.length > MAX_NO_MENU) {
    embed.footer = { text: `escolha um abaixo para editar · ${meus.length - MAX_NO_MENU} não cabem no menu` };
  }

  return {
    embed,
    componentes: [{ type: 1, components: [{
      type: 3, custom_id: "admin:abrircomando",
      placeholder: "Editar um comando…", options: opcoes,
    }] }],
  };
}

/* ---------------- Tirar a trava de HTTP ----------------

   Enquanto o aplicativo tem um "interactions endpoint URL" configurado, o
   Discord NAO entrega interacao nenhuma pelo gateway: clique, comando e menu
   viram POST pra aquela URL. Foi por isso que este processo, que ve tudo o
   que acontece no chat, era cego pra qualquer botao -- e por isso que metade
   do CYRON morava numa Edge Function separada, com dois deploys, dois lugares
   pra procurar bug e o limite de 3 segundos de resposta HTTP.

   Os tratadores ja estao neste arquivo (interactionCreate acima). Enquanto a
   URL existir, eles nascem dormindo: nada chega. Limpando a URL aqui, no
   mesmo processo que os carrega, nao existe janela em que o Discord entrega
   pra ninguem -- quem apaga e' exatamente quem passa a atender.

   Faco isso uma vez por partida e so' se ainda estiver setado. Se o PATCH
   falhar, digo alto: o sintoma de falhar em silencio seria "todos os comandos
   pararam" horas depois, sem nada obvio ligando uma coisa a outra. */
const API = "https://discord.com/api/v10";

async function soltarAsInteracoes() {
  if (!umaVezPorProcesso("soltar-interacoes")) return;
  const cabecalho = { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" };
  try {
    const r = await fetch(`${API}/applications/@me`, { headers: cabecalho });
    if (!r.ok) throw new Error(`GET ${r.status} ${(await r.text()).slice(0, 200)}`);
    const app = await r.json();

    if (!app.interactions_endpoint_url) {
      console.log("interações: já chegam pelo gateway (nenhum endpoint HTTP configurado)");
      return;
    }

    console.log(`interações: tirando a trava de HTTP (${app.interactions_endpoint_url})`);
    const p = await fetch(`${API}/applications/@me`, {
      method: "PATCH",
      headers: cabecalho,
      body: JSON.stringify({ interactions_endpoint_url: null }),
    });
    if (!p.ok) throw new Error(`PATCH ${p.status} ${(await p.text()).slice(0, 300)}`);
    console.log("interações: trava removida; comandos e botões agora vêm direto pro bot");
  } catch (e) {
    console.error("interações: NÃO consegui limpar o endpoint HTTP:", e?.message || e);
    console.error("interações: os comandos continuam indo pra Edge Function. Nada quebrou, mas o bot segue cego pra botão.");
  }
}

/* Publica o /cyron se ele ainda nao existir.

   Global e restrito a Gerenciar Servidor: quem nao tem o cargo nem ve o
   comando na lista, entao a recusa nao precisa ser explicada pra maioria --
   ela simplesmente nao aparece. A checagem no clique continua existindo
   mesmo assim, porque cargo muda depois do comando publicado. */
/* Publica os comandos que nao vem do jogo, se ainda nao existirem.

   /cyron e' restrito a Gerenciar Servidor: quem nao tem o cargo nem ve o
   comando na lista, entao a recusa nao precisa ser explicada pra maioria --
   ela simplesmente nao aparece. A checagem no clique continua existindo mesmo
   assim, porque cargo muda depois do comando publicado.

   /help e' de todo mundo, de proposito: e' a unica porta que a pessoa que nao
   entende o idioma da casa consegue achar sozinha. */
const GLOBAIS_DO_CYRON = [
  {
    name: "cyron",
    description: "Abrir o painel de configuração do CYRON",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    dmPermission: false,
  },
  {
    name: "help",
    description: "Como usar o CYRON / How to use CYRON",
    dmPermission: false,
  },
  {
    /* De todo mundo, como o /help: o placar fixado e' bilingue por ser uma
       mensagem so', e este comando e' a saida para quem nao le nenhuma das
       duas linguas. */
    name: "arena",
    description: "Ver a Arena das Línguas na sua língua / See the Language Arena in your language",
    dmPermission: false,
  },
  {
    /* Sem defaultMemberPermissions: quem manda aqui nao e' cargo de servidor,
       e' ser dono do aplicativo. Administrador de um servidor qualquer nao
       pode ver os numeros de todos os outros. A checagem e' no clique. */
    name: "admin",
    description: "Painel do dono do CYRON",
    dmPermission: false,
  },
];

/* O /admin some da lista de quem nao e' o dono.

   Ele nasce global porque precisa existir em algum lugar antes de haver
   painel -- e' com ele que o painel e' criado. Assim que o painel existe,
   ele vira comando DAQUELE servidor e sai do global. Cliente nenhum volta a
   ver na lista um comando que nao pode usar.

   A recusa no clique continua existindo de qualquer jeito: comando escondido
   nao e' comando protegido, e quem souber o nome ainda consegue chamar. */
async function arrumarOndeMoraOAdmin() {
  try {
    const def = GLOBAIS_DO_CYRON.find((d) => d.name === "admin");
    const globais = await client.application.commands.fetch();
    const noGlobal = [...globais.values()].find((c) => c.name === "admin");
    const gid = await guildDoPainel();

    if (!gid) {
      if (!noGlobal) await client.application.commands.create(def);
      return;
    }
    const guild = client.guilds.cache.get(gid);
    if (!guild) return;   // painel configurado mas eu nao estou nele; nao mexo

    const doGuild = await guild.commands.fetch();
    if (![...doGuild.values()].some((c) => c.name === "admin")) {
      await guild.commands.create(def);
      console.log(`comandos: /admin agora é só de ${guild.name}`);
    }
    /* Tira do global DEPOIS de existir no servidor. Na ordem inversa, o dono
       ficaria alguns minutos sem nenhum /admin em lugar nenhum. */
    if (noGlobal) {
      await noGlobal.delete();
      console.log("comandos: /admin saiu da lista global");
    }
  } catch (e) {
    console.error("comandos: não consegui arrumar o /admin:", e?.message || e);
  }
}

async function garantirComandosGlobais() {
  if (!umaVezPorProcesso("comandos-globais")) return;
  try {
    const globais = await client.application.commands.fetch();
    const existem = new Set([...globais.values()].map((c) => c.name));
    for (const def of GLOBAIS_DO_CYRON) {
      if (def.name === "admin") continue;   // quem cuida dele e' arrumarOndeMoraOAdmin
      if (existem.has(def.name)) continue;
      await client.application.commands.create(def);
      console.log(`comandos: /${def.name} publicado`);
    }
  } catch (e) {
    console.error("comandos: não consegui publicar os globais:", e?.message || e);
  }
}

/* Uma volta completa: reparo, montagem, portaria e painel.

   A ordem importa e nao e' arbitraria. Reparo primeiro porque sem porta e sem
   fonte as outras nao tem o que montar nem onde postar. Painel por ultimo
   porque ele mostra o que as tres acabaram de decidir -- desenhado antes,
   seria sempre o retrato da passada anterior, e um painel atrasado e' pior
   que painel nenhum: a pessoa confia nele.

   A mesma funcao serve a partida e ao relogio. Na partida elas rodavam soltas
   e em paralelo, e o painel nao rodava de jeito nenhum -- entao, depois de
   cada reinicio, o cartao ficava ate' dez minutos mostrando o estado velho.
   Isso apareceu na hora errada: subi os botoes e fui conferir se tinham
   chegado, e o painel ainda era o de antes. */
async function umaPassada() {
  const comecou = Date.now();
  await recarregarAjustes().catch((e) => console.error("ajustes: nao consegui recarregar:", e?.message || e));
  await repararInstalacoes().catch((e) => console.error("instalar: reparo falhou:", e?.message || e));
  await sincronizarSalas().catch((e) => console.error("espelho: sincronia falhou:", e?.message || e));
  await garantirConvites().catch((e) => console.error("portaria: passada falhou:", e?.message || e));
  await atualizarCartoes().catch((e) => console.error("config: cartões falharam:", e?.message || e));
  await atualizarArenas().catch((e) => console.error("arena: passada falhou:", e?.message || e));
  await montarPainelDoDono().catch((e) => console.error("painel: montagem falhou:", e?.message || e));
  await rodarComandosAgendados().catch((e) => console.error("agendado: passada falhou:", e?.message || e));
  await deHoraEmHora().catch((e) => console.error("hora: passada falhou:", e?.message || e));
  ultimaPassada = Date.now();
  duracaoPassada = ultimaPassada - comecou;
}

/* O que nao precisa de dez em dez minutos.

   A cota e' numero de MES: ler a cada varredura seria vinte e quatro vezes
   mais chamada pra saber a mesma coisa. Peguei carona na varredura em vez de
   abrir outro relogio -- relogio proprio segue disparando quando a varredura
   trava, e aviso que chega enquanto o resto esta parado engana. */
let ultimaHora = 0;
async function deHoraEmHora() {
  if (Date.now() - ultimaHora < 60 * 60 * 1000) return;
  ultimaHora = Date.now();
  await olharAsCotas().catch((e) => console.error("cota: passada falhou:", e?.message || e));
  await talvezOCartaoDoDia().catch((e) => console.error("diário: cartão falhou:", e?.message || e));
}

client.once("clientReady", () => {
  console.log(`Conectado como ${client.user.tag}, em ${client.guilds.cache.size} servidor(es).`);
  /* Os comandos do dono voltam a existir depois de cada reinicio. Eles moram
     no banco, mas quem os registra no Discord e' o bot ao subir -- sem isto,
     um reinicio deixaria /ranking na lista do Discord apontando pra um bot
     que nao sabe mais o que fazer com ele. */
  for (const [, g] of client.guilds.cache) {
    publicarComandosDoDono(g).catch(() => { /* ja' registrado no log */ });
  }

  separarComandos()
    .then(() => garantirComandosGlobais())
    .then(() => arrumarOndeMoraOAdmin());
  soltarAsInteracoes();
  /* Uma vez ao subir, pra quem mexeu em algo com o bot fora do ar nao ficar
     esperando dez minutos, e depois de tempos em tempos. */
  recarregarAjustes().then(() => umaPassada());
  setInterval(umaPassada, INTERVALO_SINCRONIA);

  /* Uma vez por dia, joga fora o que passou do prazo.

     A limpeza das falas existia sozinha desde sempre. O texto das mensagens e
     o cache de traducao nao tinham nenhuma: eu acumulava, sem prazo, o
     conteudo de mensagens de gente que nem sabe que eu existo. Numa lista, uma
     tabela nova sem prazo fica visivel; espalhada em setInterval, some.

     Falhar aqui e' barulhento de proposito. Se a tabela nao tiver `criado_em`,
     o PostgREST recusa e o erro nomeia a tabela: limpeza que nao limpa em
     silencio e' pior que limpeza nenhuma, porque a pagina de privacidade
     promete o prazo. */
  const limparOVelho = async () => {
    for (const [tabela, dias, oQue] of GUARDO_POR) {
      const corte = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
      await sbDel(`${tabela}?criado_em=lt.${corte}`).catch((e) => console.error(
        `retencao: NAO consegui apagar ${oQue} com mais de ${dias} dias (${tabela}): ${e?.message || e}`));
    }
  };
  limparOVelho();
  setInterval(limparOVelho, 24 * 60 * 60 * 1000);

  /* O recibo da semana, uma vez por semana, por servidor.

     A marca de "ja mandei" vive no cyron_ajuste, que ja e' uma tabela de
     chave/valor -- assim isto nao pede coluna nova nem migracao, e um servidor
     que nunca recebeu simplesmente nao tem chave.

     Vai pra sala da administracao, e nao pro canal de todo mundo. Postar
     sozinho, toda semana, num canal da comunidade de um cliente e' o jeito
     mais rapido de um bot ser expulso -- e o cartao publicado pelo dono vale
     mais que o cartao publicado por mim, porque vem dele. O botao esta ali
     do lado. */
  const mandarRecibos = async () => {
    const semana = semanaDe();
    const servidores = await sb("cyron_servidor?select=id,guild_id,canal_config").catch(() => null) || [];
    for (const s of servidores) {
      try {
        if ((await ajustes())[`recibo:${s.id}`] === semana) continue;
        const guild = client.guilds.cache.get(s.guild_id);
        if (!guild) continue;
        const canal = s.canal_config ? await guild.channels.fetch(s.canal_config).catch(() => null) : null;
        if (typeof canal?.send !== "function") continue;

        const embed = await reciboDaSemana(guild, s);
        /* Semana sem traducao nao vira cartao -- mas vira marca, senao eu
           tentaria montar o recibo de novo a cada volta do relogio. */
        if (embed) await canal.send({ embeds: [embed], components: botoesDoRecibo() });
        await porAjuste(`recibo:${s.id}`, semana);
      } catch (e) {
        console.error(`recibo: falhei no servidor ${s.id}:`, e?.message || e);
      }
    }
  };
  /* De hora em hora, e nao uma vez por dia: o bot reinicia a cada deploy, e um
     relogio diario perderia a semana inteira se o reinicio caisse na hora
     errada. A marca no banco e' quem garante que sai uma vez so'. */
  setTimeout(() => {
    mandarRecibos().catch((e) => console.error("recibo: falhei:", e?.message || e));
    setInterval(() => mandarRecibos().catch((e) => console.error("recibo: falhei:", e?.message || e)),
      60 * 60 * 1000);
  }, 60 * 1000);
  setInterval(() => {
    sincronizarRecentes().catch((e) => console.error("espelho: passada curta falhou:", e?.message || e));
    descarregarUso().catch((e) => console.error("uso: descarga falhou:", e?.message || e));
  }, 60 * 1000);
});

/* Descarrega a contagem antes de morrer.

   O Fly manda SIGINT a cada deploy, e eu ando fazendo varios por dia. Sem
   isto, cada deploy jogaria fora ate' um minuto de contagem -- e como os
   deploys acontecem justamente quando estou mexendo, a metrica ficaria com
   buracos exatamente nos dias de mais movimento.

   Com prazo curto: se o banco nao responder, desligar continua sendo mais
   importante que contar. */
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    await Promise.race([
      descarregarUso().catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    process.exit(0);
  });
}

/* Todo console.error passa a alimentar o painel tambem.

   Envolver o console em vez de sair chamando anotarErro em cinquenta lugares:
   assim nenhum erro fica de fora por eu ter esquecido de um deles -- inclusive
   os que eu ainda vou escrever. */
const erroOriginal = console.error.bind(console);
console.error = (...partes) => {
  erroOriginal(...partes);
  try {
    const texto = partes.map((p) => (p instanceof Error ? p.message : String(p))).join(" ");
    const [onde, ...resto] = texto.split(":");
    /* avisarNoPainel usa console.error quando falha. Sem esta trava, um erro
       ao avisar viraria um aviso que falha, que avisa, que falha. */
    if (!texto.startsWith("painel:")) {
      anotarErro(onde.slice(0, 40), resto.join(":").trim().slice(0, 300) || texto);
    }
  } catch { /* nunca deixar o registrador derrubar o registro */ }
};

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
