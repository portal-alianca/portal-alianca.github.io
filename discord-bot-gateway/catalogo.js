/* O catálogo do CYRON: tudo que ele faz, numerado e por categoria.
 *
 * Isto não é documentação escrita à parte -- é a LISTA, e a página
 * cyron/recursos.html nasce dela. Uma lista de recursos escrita à mão numa
 * página envelhece em silêncio: o recurso muda de nome, some, ganha um irmão,
 * e a página continua vendendo o de antes. Quem descobre é o cliente.
 *
 * Por isso cada item traz uma `prova`: um pedaço de texto que TEM que existir
 * no index.js. Se alguém apagar o recurso e esquecer da lista, o teste falha
 * e o publicar.sh recusa. A prova não garante que o recurso funciona -- para
 * isso existem os outros 2900 testes --, garante que ele não virou promessa
 * de folheto.
 *
 * Os textos são PT e EN à mão, e não traduzidos na hora: é a página de venda,
 * é lida por gente que ainda não confia no produto, e uma frase torta aqui
 * custa o cliente inteiro. As 20 línguas entram depois, quando houver
 * clientes que precisem delas.
 *
 * O número de cada recurso é a POSIÇÃO na lista, e não um campo: dois itens
 * com o mesmo número, ou um buraco na contagem, seriam erro de digitação
 * impossível de ver. Mexer na ordem renumera, e isso é aceitável -- o número
 * serve para conversar ("o 4"), não é identidade. Identidade é a `chave`.
 *
 * DUAS LISTAS, e não uma. O campo `quem` separa o que o cliente recebe do
 * que só existe para quem é dono do aplicativo. A primeira versão misturava
 * os dois e vendia o canal 🐛-erros como recurso do cliente -- ele nunca
 * chega em servidor de cliente nenhum, é do painel do dono. Prometer numa
 * página de venda algo que a pessoa não vai encontrar é o pior tipo de erro
 * que uma lista dessas pode ter, porque só é descoberto depois de instalar.
 */

/* As categorias que o cliente vê. A do dono está logo abaixo, fora desta
   lista de propósito: o que gera a página e o /help passa por aqui. */
export const CATEGORIAS = [
  {
    chave: "traduzir",
    emoji: "🌐",
    nome: { pt: "Traduzir", en: "Translate" },
    resumo: {
      pt: "O que o bot existe para fazer. Da tradução que uma pessoa pede até o servidor inteiro funcionando em vinte línguas ao mesmo tempo.",
      en: "What the bot exists to do. From a translation one person asks for, all the way to the whole server running in twenty languages at once.",
    },
  },
  {
    chave: "chegar",
    emoji: "👋",
    nome: { pt: "Quem chega", en: "Newcomers" },
    resumo: {
      pt: "Ninguém deveria precisar procurar onde se escolhe o idioma. O bot vai atrás, adivinha quando dá, e fala com cada pessoa na língua dela.",
      en: "Nobody should have to hunt for where you pick a language. The bot comes to you, guesses when it can, and speaks to each person in their own language.",
    },
  },
  {
    chave: "viver",
    emoji: "🎮",
    nome: { pt: "Viver junto", en: "Living together" },
    resumo: {
      pt: "Traduzir tira a barreira; isto dá motivo para atravessar. Jogo, horários que cada um lê no relógio dele, e a conta do que o servidor conseguiu na semana.",
      en: "Translation removes the wall; this gives people a reason to cross it. A game, times everyone reads on their own clock, and the tally of what the server pulled off this week.",
    },
  },
  {
    chave: "mandar",
    emoji: "⚙️",
    nome: { pt: "Quem administra", en: "Running it" },
    resumo: {
      pt: "Um painel, botões, e nenhum arquivo de configuração. O que der errado aparece escrito em português, com o conserto ao lado.",
      en: "One panel, buttons, and no config file. Whatever breaks shows up in plain language, with the fix next to it.",
    },
  },
  {
    chave: "confiar",
    emoji: "🛡️",
    nome: { pt: "Confiança", en: "Trust" },
    resumo: {
      pt: "O que eu guardo, por quanto tempo, quanto custa e o que acontece quando o tradutor falha. Escrito antes de você perguntar.",
      en: "What I store, for how long, what it costs and what happens when the translator fails. Written down before you ask.",
    },
  },
];

/* A sexta categoria, que não vai para a página de venda: o que só quem é dono
   do aplicativo enxerga. Ela existe para o catálogo ser um INVENTÁRIO
   honesto -- "tudo que o bot faz" inclui a parte que opera o negócio --, e
   fica fora de CATEGORIAS para não haver como vazar por descuido. */
export const CATEGORIA_DONO = {
  chave: "dono",
  emoji: "🔑",
  nome: { pt: "Do dono", en: "Owner only" },
  resumo: {
    pt: "O painel de quem é dono do aplicativo. Nada disto aparece em servidor de cliente: mora num servidor só, o do painel.",
    en: "The panel for whoever owns the application. None of it shows up in a customer's server: it lives in one server, the panel's.",
  },
};

/* plano: "gratis" = está no plano grátis; "pago" = só no pago;
   "ambos" = existe nos dois, com teto diferente.
   quem:   "cliente" = o servidor que instala recebe; "dono" = só o painel
           do dono. Sem valor, vale "cliente". */
export const RECURSOS = [
  /* ---------------------------- traduzir ---------------------------- */
  {
    chave: "bandeira",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "Tradução por bandeira", en: "Translate by flag" },
    como: { pt: "Reagir com 🇪🇸", en: "React with 🇪🇸" },
    oque: {
      pt: "A pessoa reage com a bandeira do país dela e recebe aquela mensagem traduzida no privado. Vale a bandeira que ela tem — 🇲🇽 conta, não só 🇪🇸. Se a caixa de mensagens estiver fechada, o bot responde na própria sala e apaga sozinho.",
      en: "Someone reacts with their country's flag and gets that message translated in their DMs. Any flag counts — 🇲🇽 works, not just 🇪🇸. If their DMs are closed, the bot answers in the room and deletes itself.",
    },
    prova: "idiomaDaBandeira",
  },
  {
    chave: "botao",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "Botão de tradução", en: "Translate button" },
    como: { pt: "Menu 🌐 embaixo da mensagem", en: "🌐 menu under the message" },
    oque: {
      pt: "Embaixo de um aviso fica um menu com as 20 línguas. Cada um escolhe a sua e recebe a cópia traduzida só para ele — o aviso original não muda, e a sala não enche.",
      en: "A menu with all 20 languages sits under an announcement. Each person picks theirs and gets a translated copy for their eyes only — the original never changes, and the room stays clean.",
    },
    prova: "traduzir-msg",
  },
  {
    chave: "topico",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "Tradutor por mensagem", en: "Per-message translator" },
    como: { pt: "Painel /cyron, um botão", en: "/cyron panel, one button" },
    oque: {
      pt: "Ligado no painel, o bot abre um tópico ao lado de cada mensagem do canal escolhido com o seletor de línguas dentro — e fecha o tópico sozinho, para a barra lateral não virar uma lista de tópicos mortos.",
      en: "Switched on in the panel, the bot opens a thread beside every message in the chosen channel with the language picker inside — then closes the thread itself, so your sidebar never becomes a graveyard.",
    },
    prova: "tradutor_topico",
  },
  {
    chave: "privado",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "Traduzir no privado", en: "Translate in DMs" },
    como: { pt: "Mandar o texto para o bot", en: "Send the bot any text" },
    oque: {
      pt: "Cole qualquer texto na conversa privada com o bot e ele oferece a tradução nas 20 línguas. Sem comando, sem servidor, e ninguém mais vê.",
      en: "Paste any text into a DM with the bot and it offers the translation in 20 languages. No command, no server, and nobody else sees it.",
    },
    prova: "atenderNoPrivado",
  },
  {
    chave: "espelho",
    categoria: "traduzir",
    plano: "pago",
    nome: { pt: "Salas espelhadas por idioma", en: "Mirrored rooms per language" },
    como: { pt: "Sozinho, é só escrever", en: "On its own — just type" },
    oque: {
      pt: "A mesma conversa acontecendo em várias salas, uma por língua. Você escreve na sua e a sua fala aparece na dos outros já traduzida, com o seu nome e a sua foto — inclusive as imagens e os arquivos que você mandou junto.",
      en: "One conversation happening in several rooms, one per language. You type in yours and your line shows up in theirs already translated, with your name and your avatar — images and files you attached come along.",
    },
    prova: "espelharMensagem",
  },
  {
    chave: "reacoes",
    categoria: "traduzir",
    plano: "pago",
    nome: { pt: "As reações atravessam as salas", en: "Reactions cross the rooms" },
    como: { pt: "Sozinho, é só reagir", en: "On its own — just react" },
    oque: {
      pt: "Um 👍 dado na sala em árabe aparece na sala em português, somado com os das outras. Quem escreveu fica sabendo que gostaram — antes, a reação morria na língua de quem reagiu, longe justamente de quem ela existia para alcançar.",
      en: "A 👍 given in the Arabic room shows up in the Portuguese one, added to the rest. Whoever wrote the line finds out people liked it — before, the reaction died in the reactor's own language, away from the one person it existed to reach.",
    },
    prova: "atravessarReacoes",
  },
  {
    chave: "replica",
    categoria: "traduzir",
    plano: "pago",
    nome: { pt: "Cópias dos seus canais", en: "Copies of your channels" },
    como: { pt: "Escolher os canais no painel", en: "Pick the channels in the panel" },
    oque: {
      pt: "Anúncios, regras, eventos: você marca até 10 canais e cada um ganha uma cópia por língua, atualizada sozinha. Quem lê só em turco vê o mural da casa em turco.",
      en: "Announcements, rules, events: you tick up to 10 channels and each one gets a copy per language, kept up to date on its own. Someone who only reads Turkish sees the house noticeboard in Turkish.",
    },
    prova: "garantirReplica",
  },
  {
    chave: "categoria",
    categoria: "traduzir",
    plano: "pago",
    nome: { pt: "Uma ala inteira por língua", en: "A whole wing per language" },
    como: { pt: "Montado na instalação", en: "Built during setup" },
    oque: {
      pt: "Categoria, cargo e permissões de cada língua montados e mantidos pelo bot. Quem escolhe 🇰🇷 passa a ver a ala coreana e para de ver as outras — o servidor não fica cinco vezes maior na barra lateral de ninguém.",
      en: "The category, the role and the permissions for each language, built and maintained by the bot. Pick 🇰🇷 and you see the Korean wing and stop seeing the rest — nobody's sidebar gets five times longer.",
    },
    prova: "garantirCategoria",
  },
  {
    chave: "palavras",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "Palavras que eu não traduzo", en: "Words I leave alone" },
    como: { pt: "Painel /cyron → 📖", en: "/cyron panel → 📖" },
    oque: {
      pt: "A lista da casa: apelidos, siglas da aliança, nomes de eventos. O tradutor recebe o texto com esses pedaços escondidos e devolve com eles intactos — ninguém vira “Melhor” porque se chama Best.",
      en: "The house list: nicknames, alliance tags, event names. The translator gets the text with those pieces hidden and hands them back untouched — nobody becomes “Melhor” just because they are called Best.",
    },
    prova: "protegerDoTradutor",
  },
  {
    chave: "motor",
    categoria: "traduzir",
    plano: "ambos",
    nome: { pt: "Motor de tradução, com a sua chave", en: "Your own translation engine" },
    como: { pt: "Painel /cyron → 🌐", en: "/cyron panel → 🌐" },
    oque: {
      pt: "DeepL, Azure ou os gratuitos, escolhidos por servidor. Se você tiver a sua própria chave, ela entra no painel e o servidor passa a gastar dela — guardada cifrada, e nunca mostrada de volta na tela.",
      en: "DeepL, Azure or the free ones, chosen per server. If you have your own key it goes in the panel and the server spends from it — stored encrypted, and never shown back on screen.",
    },
    prova: "salvarMotor",
  },
  {
    chave: "cache",
    categoria: "traduzir",
    plano: "gratis",
    nome: { pt: "A mesma frase não se paga duas vezes", en: "The same line is never paid for twice" },
    como: { pt: "Sozinho", en: "On its own" },
    oque: {
      pt: "Toda tradução fica guardada por 30 dias. O segundo pedido da mesma frase é instantâneo e não custa caractere nenhum — num servidor de verdade isso é a maior parte deles.",
      en: "Every translation is kept for 30 days. The second request for the same line is instant and costs no characters at all — in a real server that is most of them.",
    },
    prova: "traduzirComCache",
  },

  /* ----------------------------- chegar ----------------------------- */
  {
    chave: "convite",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "Convite no privado ao entrar", en: "A DM the moment they join" },
    como: { pt: "Sozinho, quando alguém entra", en: "On its own, when someone joins" },
    oque: {
      pt: "Quem entra no servidor recebe na hora um cartão com as 20 bandeiras. Não precisa achar canal nenhum, e cada língua aparece escrita nela mesma — Deutsch, 한국어, العربية —, que é como a pessoa reconhece a dela.",
      en: "Anyone who joins gets a card with the 20 flags right away. No channel to find, and each language is written in itself — Deutsch, 한국어, العربية — which is how a person recognises their own.",
    },
    prova: "convidarParaEscolherIdioma",
  },
  {
    chave: "adivinhar",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "O idioma adivinhado pelo que a pessoa escreve", en: "The language guessed from what they type" },
    como: { pt: "Sozinho, na primeira frase", en: "On its own, on their first line" },
    oque: {
      pt: "Quem escreveu e nunca escolheu bandeira recebe uma oferta discreta — já na língua que ele parece falar. Na dúvida o bot cala a boca: adivinhar errado é pior do que não adivinhar.",
      en: "Someone who typed but never picked a flag gets a quiet offer — already in the language they seem to speak. When in doubt the bot says nothing: a wrong guess is worse than no guess.",
    },
    prova: "linguaProvavel",
  },
  {
    chave: "falacomvoce",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "O bot fala com cada um na língua dele", en: "The bot speaks to each person in their language" },
    como: { pt: "Sozinho, depois da escolha", en: "On its own, once they choose" },
    oque: {
      pt: "Não é só o chat: os cartões, os botões, os menus e os avisos do próprio bot chegam na língua de quem está lendo. Quem escolheu 🇻🇳 não vê uma palavra de português.",
      en: "Not just the chat: the bot's own cards, buttons, menus and notices arrive in the reader's language. Someone who picked 🇻🇳 never sees a word of Portuguese.",
    },
    prova: "falaFixa",
  },
  {
    chave: "help",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "/help, a porta que qualquer um acha", en: "/help, the door anyone can find" },
    como: { pt: "/help", en: "/help" },
    oque: {
      pt: "Um menu fechado com os assuntos que de fato perguntam, cada um com resposta escrita. Sem campo livre: prometer um atendente que não existe é pior do que dizer o que eu sei fazer.",
      en: "A closed menu of the questions people actually ask, each with a written answer. No free text box: promising a support agent that does not exist is worse than saying what I can do.",
    },
    prova: "comandoAjuda",
  },
  {
    chave: "mylanguage",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "/mylanguage", en: "/mylanguage" },
    como: { pt: "/mylanguage", en: "/mylanguage" },
    oque: {
      pt: "Trocar de língua a qualquer momento, em qualquer servidor onde o bot esteja, quantas vezes quiser. A escolha é da pessoa e vai com ela.",
      en: "Change language whenever you like, in any server the bot is in, as many times as you like. The choice belongs to the person and travels with them.",
    },
    prova: "mylanguage",
  },
  {
    chave: "passos",
    categoria: "chegar",
    plano: "gratis",
    nome: { pt: "Instalação em cinco cartões", en: "Setup in five cards" },
    como: { pt: "/help → Como instalar", en: "/help → How to install" },
    oque: {
      pt: "Cinco passos, e três acontecem sozinhos. Cada cartão tem uma foto do que você deveria estar vendo, e você avança no seu ritmo.",
      en: "Five steps, and three happen by themselves. Each card shows a picture of what you should be looking at, and you move at your own pace.",
    },
    prova: "paginaDoPasso",
  },

  /* ------------------------------ viver ----------------------------- */
  {
    chave: "arena",
    categoria: "viver",
    plano: "gratis",
    nome: { pt: "Arena das Línguas", en: "Language Arena" },
    como: { pt: "/arena", en: "/arena" },
    oque: {
      pt: "Cada língua do servidor é um time, e traduzir é o que dá força a ele. Placar fixado, ataques entre times, e um handicap que deixa o time de três pessoas capaz de derrubar o de trinta.",
      en: "Every language in the server is a team, and translating is what makes it stronger. A pinned scoreboard, attacks between teams, and a handicap that lets a team of three take down a team of thirty.",
    },
    prova: "placarDaArena",
  },
  {
    chave: "eventos",
    categoria: "viver",
    plano: "gratis",
    nome: { pt: "Eventos na hora de cada um", en: "Events in everyone's own time" },
    como: { pt: "/evento", en: "/evento" },
    oque: {
      pt: "Você marca “20:30” uma vez e o Brasil lê 20:30, a Alemanha lê 01:30 e as Filipinas leem 07:30 — cada um no relógio dele, sem o bot guardar o fuso de ninguém. O campo de horário sugere enquanto você digita.",
      en: "You set “20:30” once and Brazil reads 20:30, Germany reads 01:30 and the Philippines read 07:30 — each on their own clock, with the bot storing nobody's timezone. The time field suggests as you type.",
    },
    prova: "cartaoDoEvento",
  },
  {
    chave: "presenca",
    categoria: "viver",
    plano: "gratis",
    nome: { pt: "Votação de presença", en: "Attendance vote" },
    como: { pt: "Botão no cartão do evento", en: "A button on the event card" },
    oque: {
      pt: "Vou / não vou, com a contagem à vista. Quem convoca liga ou desliga a votação por evento — não é toda convocação que se pergunta.",
      en: "In / out, with the count in plain sight. Whoever calls the event turns the vote on or off per event — not every call is a question.",
    },
    prova: "evento:vou",
  },
  {
    chave: "recibo",
    categoria: "viver",
    plano: "gratis",
    nome: { pt: "Recibo da semana", en: "The week's receipt" },
    como: { pt: "Toda segunda, sozinho", en: "Every Monday, on its own" },
    oque: {
      pt: "Quantas traduções, para quantas pessoas, e se foi mais ou menos que a semana passada. Semana sem tradução nenhuma não vira cartão: um recibo dizendo “zero” é o bot lembrando que não serviu para nada.",
      en: "How many translations, for how many people, and whether it beat last week. A week with no translations produces no card at all: a receipt saying “zero” is the bot reminding you it was useless.",
    },
    prova: "reciboDaSemana",
  },

  /* ----------------------------- mandar ----------------------------- */
  {
    chave: "painel",
    categoria: "mandar",
    plano: "gratis",
    nome: { pt: "O painel /cyron", en: "The /cyron panel" },
    como: { pt: "/cyron", en: "/cyron" },
    oque: {
      pt: "Um cartão só, que se atualiza no lugar: o que está ligado, o que falta, quantos canais existem e o que fazer a seguir. Só quem gerencia o servidor vê o comando na lista.",
      en: "A single card that refreshes in place: what is on, what is missing, how many channels exist and what to do next. Only people who manage the server even see the command.",
    },
    prova: "montarPainel",
  },
  {
    chave: "instalacao",
    categoria: "mandar",
    plano: "gratis",
    nome: { pt: "Instalação automática ao entrar", en: "It installs itself on arrival" },
    como: { pt: "Ao adicionar o bot", en: "When you add the bot" },
    oque: {
      pt: "O bot entra, cria o canal de configuração, se apresenta e abre o painel. Não existe passo “agora rode este comando” antes de você ver alguma coisa funcionando.",
      en: "The bot joins, creates its config channel, introduces itself and opens the panel. There is no “now run this command” before you see anything working.",
    },
    prova: "instalarServidor",
  },
  {
    chave: "remontar",
    categoria: "mandar",
    plano: "gratis",
    nome: { pt: "Reconstruir os canais", en: "Rebuild the channels" },
    como: { pt: "Painel /cyron → 🔄", en: "/cyron panel → 🔄" },
    oque: {
      pt: "Apagou uma sala sem querer, mexeu numa permissão, mudou o nome do canal de origem: um botão refaz o que faltar e conserta o que ficou torto, sem apagar conversa.",
      en: "Deleted a room by accident, changed a permission, renamed a source channel: one button rebuilds what is missing and fixes what drifted, without deleting anyone's conversation.",
    },
    prova: "cyron:remontar",
  },
  {
    chave: "teto",
    categoria: "mandar",
    plano: "ambos",
    nome: { pt: "Teto de canais respeitado", en: "The channel ceiling is respected" },
    como: { pt: "Sozinho, antes de criar", en: "On its own, before it builds" },
    oque: {
      pt: "O Discord aceita 500 canais por servidor. O bot conta antes de criar, para quando fica apertado e avisa quem manda — em vez de deixar o servidor no limite e descobrir na hora errada.",
      en: "Discord allows 500 channels per server. The bot counts before it builds, stops when it gets tight and tells whoever is in charge — instead of parking your server at the limit and finding out the hard way.",
    },
    prova: "avisarDoTeto",
  },
  {
    chave: "codigo",
    categoria: "mandar",
    plano: "ambos",
    nome: { pt: "Código de ativação", en: "Activation code" },
    como: { pt: "Painel /cyron → 🎟️", en: "/cyron panel → 🎟️" },
    oque: {
      pt: "Dias de plano pago entregues por código, sem cartão. Serve para teste, para parceria e para quem não pode pagar em real — e resgatar de novo soma dias em vez de recomeçar.",
      en: "Paid days handed over as a code, no card involved. Good for trials, partnerships, and anyone who cannot pay in your currency — and redeeming again adds days instead of starting over.",
    },
    prova: "resgatarCodigo",
  },

  /* ----------------------------- confiar ---------------------------- */
  {
    chave: "privacidade",
    categoria: "confiar",
    plano: "gratis",
    nome: { pt: "O que eu guardo, e por quanto tempo", en: "What I store, and for how long" },
    como: { pt: "cyron/privacidade.html", en: "cyron/privacidade.html" },
    oque: {
      pt: "Cada tabela, o motivo dela e o prazo, numa página só — e o prazo é cumprido por uma varredura, não por promessa. O que não é guardado também está escrito lá: o fuso horário de ninguém, por exemplo.",
      en: "Every table, why it exists and how long it lives, on one page — and the deadline is enforced by a sweep, not by a promise. What is not stored is written down too: nobody's timezone, for instance.",
    },
    prova: "GUARDO_POR",
  },
  {
    chave: "cota",
    categoria: "confiar",
    plano: "gratis",
    nome: { pt: "Um servidor não gasta a cota do vizinho", en: "One server cannot spend its neighbour's quota" },
    como: { pt: "Sozinho", en: "On its own" },
    oque: {
      pt: "As chaves gratuitas são uma bolsa só para todos os servidores, então cada um tem o seu teto por dia. Tradutor que falha entra de castigo e o próximo assume — o servidor não para porque um provedor caiu.",
      en: "The free keys are one shared purse for every server, so each one has its own daily ceiling. A translator that fails is benched and the next one takes over — your server does not stop because a provider went down.",
    },
    prova: "estourouACota",
  },
  {
    chave: "sempre-gratis",
    categoria: "confiar",
    plano: "gratis",
    nome: { pt: "O plano grátis não vence", en: "The free plan does not expire" },
    como: { pt: "Não fazer nada", en: "Do nothing" },
    oque: {
      pt: "Bandeira, botão, tradutor por mensagem e o bot falando a língua de cada um: de graça, sem limite de gente nem de língua, sem data. O plano pago é o que constrói as salas — é essa a diferença, e não um número maior.",
      en: "Flags, the button, the per-message translator and the bot speaking everyone's language: free, with no member or language limit, and no expiry date. The paid plan is the one that builds rooms — that is the difference, not a bigger number.",
    },
    prova: "PLANOS",
  },

  /* ------------------------------ do dono ---------------------------
     Daqui para baixo, nada chega em servidor de cliente. Tudo mora no
     servidor do painel, e a checagem de quem pode é no clique -- comando
     escondido não é comando protegido. */
  {
    chave: "erros",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Erros explicados, não códigos", en: "Errors explained, not codes" },
    como: { pt: "Canal 🐛-erros", en: "The 🐛-erros channel" },
    oque: {
      pt: "Quando algo falha, o canal recebe um cartão dizendo o que aconteceu, se depende de alguém e qual é o conserto. “Missing Permissions” vira “falta a permissão X no canal Y”, e o mesmo erro só volta uma vez por hora.",
      en: "When something fails, the channel gets a card saying what happened, whether it needs a human, and what the fix is. “Missing Permissions” becomes “permission X is missing on channel Y”, and the same error only comes back once an hour.",
    },
    prova: "explicarErro",
  },
  {
    chave: "painel-dono",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "O painel /admin", en: "The /admin panel" },
    como: { pt: "/admin", en: "/admin" },
    oque: {
      pt: "Resumo, uso, saúde, busca, códigos, chaves e ajustes num cartão só. O comando some da lista de quem não é dono do aplicativo, e a recusa no clique continua existindo de qualquer jeito.",
      en: "Summary, usage, health, search, codes, keys and settings on one card. The command disappears from the list for anyone who does not own the application, and the click still checks anyway.",
    },
    prova: "linhasDoAdmin",
  },
  {
    chave: "resumo",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Quantos servidores, quantos pagam", en: "How many servers, how many pay" },
    como: { pt: "/admin → 📊", en: "/admin → 📊" },
    oque: {
      pt: "Quantos instalaram, quantos estão no teste, quantos pagam e quantos saíram — a conta que decide se o produto está de pé.",
      en: "How many installed, how many are on trial, how many pay and how many left — the tally that says whether the product is standing.",
    },
    prova: "embedDoResumo",
  },
  {
    chave: "quem-usa",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Quem usa mais", en: "Who uses it most" },
    como: { pt: "/admin → 🏆", en: "/admin → 🏆" },
    oque: {
      pt: "Os servidores que mais traduziram nos últimos 7 dias, com caracteres e traduções. É por aqui que se vê quem está prestes a estourar a cota e quem instalou e nunca usou.",
      en: "The servers that translated the most in the last 7 days, with characters and translations. This is where you see who is about to blow their quota and who installed it and never used it.",
    },
    prova: "embedDeUso",
  },
  {
    chave: "saude",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Saúde do bot", en: "The bot's health" },
    como: { pt: "/admin → 🩺", en: "/admin → 🩺" },
    oque: {
      pt: "Cota de cada tradutor com barra, quem está de castigo, e quanto falta para virar o dia. Ver antes de a chave acabar é a diferença entre trocar de motor e descobrir pelo cliente.",
      en: "Each translator's quota with a bar, who is benched, and how long until the day rolls over. Seeing it before a key runs out is the difference between switching engines and hearing it from a customer.",
    },
    prova: "embedDeSaude",
  },
  {
    chave: "cartao-do-dia",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "O cartão do dia", en: "The daily card" },
    como: { pt: "Canal 📊-diário", en: "The 📊-diário channel" },
    oque: {
      pt: "Todo dia, sozinho: traduções, caracteres, servidores novos e a variação em relação a ontem. O canal de erros conta o que quebrou; este conta o que funcionou.",
      en: "Every day, on its own: translations, characters, new servers and how it moved against yesterday. The errors channel says what broke; this one says what worked.",
    },
    prova: "cartaoDoDia",
  },
  {
    chave: "ficha",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "A ficha de cada cliente", en: "A card per customer" },
    como: { pt: "Canal 📋-clientes", en: "The 📋-clientes channel" },
    oque: {
      pt: "Um tópico por servidor, com o que ele tem, o que gasta e como está — e os botões de dar 30 dias, mandar remontar ou tirar. A mensagem se edita no lugar, para não haver dez estados velhos e o vivo perdido no meio.",
      en: "One thread per server with what it has, what it spends and how it is doing — plus buttons to grant 30 days, trigger a rebuild, or remove it. The message edits in place, so there are never ten stale states with the live one lost among them.",
    },
    prova: "cartaoDoCliente",
  },
  {
    chave: "gerar-codigos",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Gerar códigos de ativação", en: "Generate activation codes" },
    como: { pt: "/admin → 🎟️", en: "/admin → 🎟️" },
    oque: {
      pt: "Lotes de código com a quantidade de dias que você escolher, para dar em parceria, em teste ou para quem não consegue pagar por cartão.",
      en: "Batches of codes worth however many days you choose, to hand out for partnerships, trials, or to anyone who cannot pay by card.",
    },
    prova: "gerarCodigos",
  },
  {
    chave: "chaves-do-dono",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "As chaves dos tradutores", en: "The translator keys" },
    como: { pt: "/admin → 🔑", en: "/admin → 🔑" },
    oque: {
      pt: "DeepL, Azure e os gratuitos da vez, guardados cifrados e nunca mostrados de volta na tela. São a bolsa comum que serve os servidores sem chave própria.",
      en: "DeepL, Azure and whichever free ones are in play, stored encrypted and never shown back on screen. They are the shared purse that serves every server without its own key.",
    },
    prova: "salvarChaves",
  },
  {
    chave: "ajustes",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Mudar de ideia sem novo deploy", en: "Change your mind without a deploy" },
    como: { pt: "/admin → ⚙️", en: "/admin → ⚙️" },
    oque: {
      pt: "Preço, link de pagamento, dias de teste, donos e tradutores extras vivem numa tabela de chave e valor. Mexer neles é uma janela, e não uma publicação de código.",
      en: "Price, payment link, trial days, owners and extra translators live in a key-value table. Changing them is a dialog, not a code release.",
    },
    prova: "salvarAjustes",
  },
  {
    chave: "busca",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Procurar um servidor", en: "Find a server" },
    como: { pt: "/admin → 🔎", en: "/admin → 🔎" },
    oque: {
      pt: "Pelo nome ou pelo id, para achar a ficha de quem escreveu pedindo ajuda sem ter que rolar a lista inteira de clientes.",
      en: "By name or by id, to reach the card of whoever wrote asking for help without scrolling the whole customer list.",
    },
    prova: "procurarServidor",
  },
  {
    chave: "avisos",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Servidor novo e pagamento avisam", en: "New servers and payments announce themselves" },
    como: { pt: "Canais 📥-novos e 💳-pagamentos", en: "The 📥-novos and 💳-pagamentos channels" },
    oque: {
      pt: "Quem instalou, quem assinou, quem cancelou e quem venceu — cada um no seu canal, na hora em que acontece.",
      en: "Who installed, who subscribed, who cancelled and whose plan lapsed — each in its own channel, the moment it happens.",
    },
    prova: "CANAL_PAGAMENTOS",
  },
  {
    chave: "sobencomenda",
    categoria: "dono",
    quem: "dono",
    plano: "gratis",
    nome: { pt: "Comandos sob encomenda", en: "Commands made to order" },
    como: { pt: "/admin → ➕", en: "/admin → ➕" },
    oque: {
      pt: "Um comando que só um servidor tem, com o cargo que pode usar e, se fizer sentido, um horário para acontecer sozinho. É código escrito na janela — por isso não é recurso de cliente: alguém precisa escrever.",
      en: "A command only one server has, with the role allowed to use it and, if it makes sense, a time to fire on its own. It is code written in a dialog — which is why it is not a customer feature: somebody has to write it.",
    },
    prova: "rodarComandosAgendados",
  },
];

/* A posição na lista, começando em 1.

   Conta só os do cliente: é o número que aparece na página e o que se usa
   para conversar ("o 4"). Os do dono não entram na contagem porque não
   entram na lista que alguém lê. */
export function numeroDe(chave) {
  const i = doCliente().findIndex((r) => r.chave === chave);
  return i < 0 ? 0 : i + 1;
}

/* O que o servidor que instala recebe. Sem `quem`, vale cliente -- assim
   esquecer o campo num item novo o mantém na página, que é o padrão certo:
   o erro perigoso é o contrário, vender como do cliente algo que é do dono. */
export function doCliente() {
  return RECURSOS.filter((r) => (r.quem || "cliente") === "cliente");
}

export function doDono() {
  return RECURSOS.filter((r) => r.quem === "dono");
}

export function recursosDa(categoria) {
  return RECURSOS.filter((r) => r.categoria === categoria);
}
