/* O servidor de suporte do CYRON: montado pelo proprio bot, e porta de entrada
   para o teste e para o pagamento.

   Duas coisas moram aqui:

     - montarSuporte: cria (ou arruma) as categorias, as salas e os textos do
       servidor de suporte -- boas-vindas, regras, modo de usar, planos. Pode
       rodar de novo quantas vezes quiser: o que existe e' reaproveitado, e o
       texto que eu ja' postei e' EDITADO, nao duplicado.
     - estaNoSuporte / exigirSuporte: o plano gratis e' de todos, mas o teste
       de 7 dias, o Pix e o codigo pedem que quem clicou esteja no servidor de
       suporte. E' la' que a pessoa tira duvida e fala com o dono se o
       pagamento der errado -- quem paga sem estar la' nao tem a quem recorrer.

   Qual e' o servidor de suporte sai do CONVITE (SUPORTE.link), e nao de um id
   escrito aqui: trocar de servidor e' trocar o link no ajuste.

   O index.js chama `ligarSuporte` uma vez, entregando o que este arquivo usa
   de la'. Assim nao ha' import circular. */

let d = null;
export function ligarSuporte(dependencias) { d = dependencias; }

/* ---------------- qual e' o servidor de suporte ---------------- */

let achado = { link: "", guild: null, t: 0 };

export async function guildDoSuporte() {
  const link = d.SUPORTE.link;
  if (achado.link === link && achado.guild && Date.now() - achado.t < 60 * 60 * 1000) return achado.guild;
  const convite = await d.client.fetchInvite(link).catch(() => null);
  const guild = convite?.guild?.id ? d.client.guilds.cache.get(convite.guild.id) ?? null : null;
  achado = { link, guild, t: Date.now() };
  return guild;
}

/* ---------------- quem esta' no suporte ----------------

   So' o SIM fica guardado: quem acabou de entrar precisa que o clique
   seguinte ja' passe, entao o NAO e' sempre perguntado de novo.

   Na duvida, deixa passar. Se o Discord nao responde, ou eu nem estou no
   servidor do convite, o problema e' meu -- e barrar um cliente que quer
   pagar por um defeito meu e' o pior erro possivel aqui. */
const membros = new Map(); // userId -> quando confirmei

export async function estaNoSuporte(userId) {
  const visto = membros.get(userId);
  if (visto && Date.now() - visto < 10 * 60 * 1000) return true;
  const guild = await guildDoSuporte().catch(() => null);
  if (!guild) return true;
  const membro = await guild.members.fetch({ user: userId, force: true })
    .catch((e) => (e?.code === 10007 || e?.code === 10013 ? null : undefined));
  if (membro === undefined) return true;
  if (!membro) return false;
  membros.set(userId, Date.now());
  return true;
}

export function botaoDoSuporte() {
  return { type: 2, style: 5, emoji: { name: "💬" }, label: "Entrar no suporte · Join support", url: d.SUPORTE.link };
}

/* Devolve true quando pode seguir. Quando nao pode, ja' respondeu -- na
   lingua de quem clicou, porque quem mais cai aqui e' justamente quem e' de
   fora. */
export async function exigirSuporte(inter, oque) {
  if (await estaNoSuporte(inter.user.id)) return true;
  const idioma = (await d.idiomaEscolhido(inter.user.id).catch(() => "")) || d.idiomaDoAplicativo(inter.locale);
  const embed = await d.traduzirEmbed({
    color: d.COR,
    title: "💬 Falta um passo",
    description: `Para ${oque}, entre antes no servidor de suporte do CYRON. ` +
      "Lá você tira dúvidas, recebe as novidades e fala com a gente se o pagamento der errado.\n\n" +
      "Depois de entrar, clique de novo no mesmo botão.",
  }, idioma).catch(() => null);
  const resposta = { flags: 64, embeds: [embed ?? { color: d.COR, title: "💬 Join the CYRON support server first" }],
    components: [{ type: 1, components: [botaoDoSuporte()] }] };
  if (inter.deferred || inter.replied) await inter.editReply(resposta);
  else await inter.reply(resposta);
  return false;
}

/* ---------------- o que o servidor tem ----------------

   Os textos sao escritos em portugues e ingles. O ingles e' o que fica na
   sala: o servidor e' internacional, e ingles e' a lingua que mais gente le.
   O botao 🌐 de cada texto traduz o PORTUGUES para a lingua de quem clicou --
   o tradutor parte sempre do portugues, e o portugues e' o texto original. */
const COR_SUPORTE = 0x5865F2;

export const TEXTOS = {
  boas: {
    pt: {
      title: "👋 Bem-vindo ao suporte do CYRON",
      description: [
        "O CYRON é um bot de tradução para Discord: cada pessoa escreve na língua dela e todo mundo lê na sua.",
        "",
        "**Por onde começar:**",
        "📜 Leia as regras.",
        "📖 Veja como usar o bot.",
        "❓ Tem uma dúvida? Pergunte em ajuda.",
        "💳 Quer assinar, ou o pagamento deu errado? Fale em planos e pagamentos.",
        "",
        "Pode escrever na sua língua. Aqui a gente se entende.",
      ].join("\n"),
    },
    en: {
      title: "👋 Welcome to CYRON Support",
      description: [
        "CYRON is a translation bot for Discord: everyone writes in their own language and everyone reads in theirs.",
        "",
        "**Where to start:**",
        "📜 Read the rules.",
        "📖 See how to use the bot.",
        "❓ Got a question? Ask in help.",
        "💳 Want to subscribe, or had a payment problem? Talk to us in plans-and-payments.",
        "",
        "Feel free to write in your own language. We'll understand each other here.",
      ].join("\n"),
    },
  },
  regras: {
    pt: {
      title: "📜 Regras",
      description: [
        "**1.** Respeito com todo mundo. Sem ofensa, preconceito ou provocação.",
        "**2.** Sem spam e sem propaganda de outros servidores ou bots.",
        "**3.** Escreva na língua que quiser. O CYRON traduz.",
        "**4.** Nunca poste token, senha ou chave de API. A equipe **nunca** pede isso.",
        "**5.** A equipe **nunca** chama você no privado para cobrar. Pagamento é só pelo botão do bot. Se alguém pedir dinheiro no privado, é golpe: avise a gente.",
        "**6.** Dúvida na sala de ajuda, problema de pagamento na sala de planos, defeito na sala de bugs.",
        "",
        "Quem não cumprir as regras pode ser removido do servidor.",
      ].join("\n"),
    },
    en: {
      title: "📜 Rules",
      description: [
        "**1.** Be respectful to everyone. No insults, hate or provocation.",
        "**2.** No spam and no advertising other servers or bots.",
        "**3.** Write in any language you like. CYRON translates.",
        "**4.** Never post a token, password or API key. Staff will **never** ask for one.",
        "**5.** Staff will **never** DM you asking for payment. Payment happens only through the bot's button. If someone asks you for money in DMs, it's a scam: let us know.",
        "**6.** Questions go in help, payment problems in plans-and-payments, defects in bugs.",
        "",
        "Anyone who breaks the rules may be removed from the server.",
      ].join("\n"),
    },
  },
  uso: {
    pt: {
      title: "📖 Como usar o CYRON",
      description: [
        "**1. Instale.** Use o link de instalação e escolha o seu servidor. Eu crio um canal onde cada pessoa escolhe o idioma dela, e um painel para a administração.",
        "",
        "**2. Abra o painel com /cyron.** Lá você marca os canais que quer traduzir e vê o seu plano.",
        "",
        "**3. Cada pessoa escolhe o idioma** no canal 🌐, uma vez só.",
        "",
        "**Traduzir uma mensagem solta:** reaja com a bandeira do idioma, ou use o botão direito na mensagem → Apps → Translate.",
        "",
        "**No Pro e na Aliança:** cada idioma ganha salas próprias, e quem escreve numa sala aparece traduzido nas outras, com nome e foto. Também traduzo texto em imagem 🖼️ e áudio 🎧.",
        "",
        "**Teste grátis:** no /cyron, o botão 🎁 liga 7 dias de Pro. Para liberar, é preciso estar neste servidor.",
      ].join("\n"),
    },
    en: {
      title: "📖 How to use CYRON",
      description: [
        "**1. Install.** Use the install link and pick your server. I create a channel where each person picks their language, plus a panel for the admins.",
        "",
        "**2. Open the panel with /cyron.** There you mark the channels you want translated and see your plan.",
        "",
        "**3. Everyone picks their language** in the 🌐 channel, just once.",
        "",
        "**Translate a single message:** react with the language's flag, or right-click the message → Apps → Translate.",
        "",
        "**On Pro and Alliance:** each language gets its own rooms, and whoever writes in one room shows up translated in the others, with name and avatar. I also translate text in images 🖼️ and audio 🎧.",
        "",
        "**Free trial:** in /cyron, the 🎁 button turns on 7 days of Pro. To unlock it, you need to be in this server.",
      ].join("\n"),
    },
  },
  novidades: {
    pt: { title: "📣 Novidades", description: "Aqui saem as novidades do CYRON: recursos novos, correções e avisos importantes. Siga este canal para receber no seu servidor." },
    en: { title: "📣 News", description: "CYRON news lands here: new features, fixes and important notices. Follow this channel to get them in your own server." },
  },
  ajuda: {
    pt: { title: "❓ Ajuda", description: "Pergunte aqui, na sua língua. Conte o que tentou fazer e o que aconteceu. Um print ajuda muito.\n\n**Nunca poste token, senha ou chave.**" },
    en: { title: "❓ Help", description: "Ask here, in your own language. Tell us what you tried to do and what happened. A screenshot helps a lot.\n\n**Never post a token, password or key.**" },
  },
  pagamento: {
    pt: {
      title: "💳 Planos e pagamentos",
      description: [
        "⭐ **Pro** — R$ 29,90 ou US$ 6 por mês: até 5 idiomas, 3 canais copiados, imagem e áudio.",
        "🏆 **Aliança** — R$ 79 ou US$ 15 por mês: até 20 idiomas, 10 canais copiados e o triplo de tradução e de áudio.",
        "",
        "🇧🇷 **No Brasil:** no /cyron, clique em 💠 Pagar com Pix. O plano liga sozinho quando o Pix cai.",
        "🌍 **Fora do Brasil:** escreva aqui qual plano você quer e o nome do seu servidor. A gente combina o pagamento com você.",
        "",
        "Pagamento é só por aqui ou pelo botão do bot. A equipe nunca cobra no privado.",
      ].join("\n"),
    },
    en: {
      title: "💳 Plans and payments",
      description: [
        "⭐ **Pro** — US$ 6 (R$ 29.90) per month: up to 5 languages, 3 mirrored channels, images and audio.",
        "🏆 **Alliance** — US$ 15 (R$ 79) per month: up to 20 languages, 10 mirrored channels and triple the translation and audio.",
        "",
        "🇧🇷 **In Brazil:** in /cyron, click 💠 Pagar com Pix. The plan turns on by itself when the Pix lands.",
        "🌍 **Outside Brazil:** write here which plan you want and your server's name. We'll arrange payment with you.",
        "",
        "Payment happens only here or through the bot's button. Staff never charges in DMs.",
      ].join("\n"),
    },
  },
  sugestoes: {
    pt: { title: "💡 Sugestões", description: "Tem uma ideia para o CYRON? Escreva aqui. Reaja com 👍 nas ideias que você também quer: as mais votadas vêm primeiro." },
    en: { title: "💡 Suggestions", description: "Got an idea for CYRON? Write it here. React 👍 on the ideas you want too: the most voted come first." },
  },
  bugs: {
    pt: { title: "🐞 Bugs", description: "Achou um defeito? Conte aqui:\n**1.** O que você fez.\n**2.** O que esperava que acontecesse.\n**3.** O que aconteceu de verdade.\nUm print ajuda muito." },
    en: { title: "🐞 Bugs", description: "Found a defect? Tell us here:\n**1.** What you did.\n**2.** What you expected to happen.\n**3.** What actually happened.\nA screenshot helps a lot." },
  },
};

/* leitura: so' eu escrevo (a pessoa le e reage). sistema: e' onde o Discord
   anuncia quem entrou. */
export const ESTRUTURA = [
  { categoria: "📌 START HERE", canais: [
    { nome: "👋・welcome", texto: "boas", leitura: true, sistema: true },
    { nome: "📜・rules", texto: "regras", leitura: true },
    { nome: "📖・how-to-use", texto: "uso", leitura: true },
    { nome: "📣・news", texto: "novidades", leitura: true },
  ] },
  { categoria: "💬 HELP", canais: [
    { nome: "❓・help", texto: "ajuda", topico: "Questions in any language · Dúvidas em qualquer língua" },
    { nome: "💳・plans-and-payments", texto: "pagamento", topico: "Plans, payments and payment problems · Planos e pagamentos" },
    { nome: "💡・suggestions", texto: "sugestoes", topico: "Ideas for CYRON · Ideias para o CYRON" },
    { nome: "🐞・bugs", texto: "bugs", topico: "Report a defect · Conte um defeito" },
  ] },
];

export const PREFIXO_LER = "sup:ler:";

function linhaDeLer(chave) {
  return { type: 1, components: [
    { type: 2, style: 2, custom_id: `${PREFIXO_LER}${chave}`, emoji: { name: "🌐" }, label: "My language · Na minha língua" },
  ] };
}

function cartao(chave, lingua) {
  return { color: COR_SUPORTE, ...TEXTOS[chave][lingua] };
}

/* O texto que eu ja' postei e' reconhecido pelo botao dele, e nao pelo
   titulo: o titulo pode mudar numa versao nova, o custom_id nao. */
async function postarOuEditar(canal, chave) {
  const corpo = { embeds: [cartao(chave, "en")], components: [linhaDeLer(chave)] };
  const recentes = await canal.messages.fetch({ limit: 30 }).catch(() => null);
  const meu = recentes?.find((m) => m.author?.id === d.client.user.id &&
    m.components?.some((l) => l.components?.some((c) => c.customId === `${PREFIXO_LER}${chave}`)));
  if (meu) { await meu.edit(corpo); return "editado"; }
  await canal.send(corpo);
  return "postado";
}

export async function montarSuporte(guild) {
  const { ChannelType, PermissionFlagsBits: P } = d;
  const feito = [];
  const leitura = [];
  await guild.channels.fetch();
  const eu = d.client.user.id;

  for (const bloco of ESTRUTURA) {
    let categoria = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === bloco.categoria);
    if (!categoria) {
      categoria = await guild.channels.create({ name: bloco.categoria, type: ChannelType.GuildCategory });
      feito.push(`📁 ${bloco.categoria}`);
    }
    for (const c of bloco.canais) {
      let canal = guild.channels.cache.find((x) => x.type === ChannelType.GuildText && x.name === c.nome);
      if (!canal) {
        canal = await guild.channels.create({
          name: c.nome, type: ChannelType.GuildText, parent: categoria.id, topic: c.topico,
          permissionOverwrites: c.leitura
            ? [
                { id: guild.roles.everyone.id, deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] },
                { id: eu, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
              ]
            : [],
        });
        feito.push(`#${c.nome}`);
      }
      const como = await postarOuEditar(canal, c.texto);
      if (como === "postado") feito.push(`📝 texto em #${c.nome}`);
      if (c.sistema && guild.systemChannelId !== canal.id) {
        await guild.setSystemChannel(canal).then(() => feito.push(`👋 entradas anunciadas em #${c.nome}`)).catch(() => {});
      }
      if (c.leitura) leitura.push(canal.id);
    }
  }

  /* As salas de leitura viram FONTE: cada idioma escolhido ganha a copia
     delas, traduzida, e a sala nova ja' nasce com os textos. Quem chega do
     Japao le as regras em japones na sala dele -- e ve o bot funcionando
     antes de instalar. */
  if (d.somarFontes && leitura.length) {
    const n = await d.somarFontes(guild, leitura).catch(() => 0);
    if (n) feito.push(`🌐 ${n} ${n === 1 ? "sala passa" : "salas passam"} a ganhar cópia traduzida em cada idioma`);
  }
  return feito;
}

/* O 🌐 de cada texto: a copia na lingua de quem clicou, so' para ela. */
export async function cliqueSuporte(inter) {
  const chave = inter.customId.slice(PREFIXO_LER.length);
  if (!TEXTOS[chave]) return inter.reply({ flags: 64, content: "🤷" });
  await inter.deferReply({ flags: 64 });
  const idioma = (await d.idiomaEscolhido(inter.user.id).catch(() => "")) || d.idiomaDoAplicativo(inter.locale) || "en";
  const embed = idioma === "en" ? cartao(chave, "en") : await d.traduzirEmbed(cartao(chave, "pt"), idioma);
  return inter.editReply({ embeds: [embed] });
}
