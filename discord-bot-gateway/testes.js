/* Os testes do CYRON.
 *
 * Rodam aqui, sem rede, sem Discord, sem banco: texto inventado entrando nas
 * funcoes do bot e o resultado conferido. Nenhuma frase daqui chega em
 * servidor nenhum -- isto e' outra coisa, e bem diferente, do teste de carga.
 *
 * Existem porque todo defeito desta semana foi pego por alguem usando o
 * produto, ou por mim testando na mao e jogando o teste fora depois. Estes
 * ficam, e o publicar.sh roda antes de subir.
 *
 * Por que extrair as funcoes em vez de importar o arquivo: carregar o
 * index.js LIGA o bot -- ele entra no Discord, abre relogios, fala com o
 * banco. Um teste que faz isso nao e' teste, e' um segundo bot. Entao o que
 * se carrega e' o pedaco: acha a declaracao pelo nome, pega ate' a chave que
 * fecha, e avalia tudo num escopo so' para que uma funcao enxergue a outra.
 *
 * Se alguem renomear uma funcao testada, o carregamento falha alto e o
 * publicar.sh recusa. E' o comportamento certo: teste que sumiu em silencio
 * quando a funcao mudou de nome e' pior do que nenhum.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/* Do discord.js so' a tabela de permissoes -- ela e' constante, e importar a
   biblioteca nao liga bot nenhum. Quem liga o bot e' o index.js. */
import { PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
globalThis.PermissionFlagsBits = PermissionFlagsBits;
/* Os construtores entram pelo mesmo motivo: são fábricas de objeto, e nenhuma
   delas abre conexão. Quem liga o bot é o `new Client()` do index.js, que
   nunca é avaliado aqui. */
globalThis.ActionRowBuilder = ActionRowBuilder;
globalThis.StringSelectMenuBuilder = StringSelectMenuBuilder;

const aqui = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(`${aqui}/index.js`, "utf8");

/* Escapado é quem tem um número ÍMPAR de barras antes.

   Olhar só a barra anterior erra em `\\]`, onde a primeira barra escapa a
   segunda e o colchete fecha de verdade. Esse erro fazia a classe nunca
   fechar, a expressão regular nunca terminar, e a extração engolir o arquivo
   inteiro -- 282 mil caracteres em vez de 300. */
function escapado(k) {
  let n = 0;
  while (fonte[k - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

/* Anda pelo texto a partir de `j` contando chaves, colchetes e parênteses,
   pulando o que estiver dentro de texto, de comentário ou de expressão
   regular, e devolve a posição logo depois do fecha que zera a conta (ou do
   `;` solto, para as constantes).

   A expressão regular é a parte chata, e foi ela que quebrou a primeira
   versão disto: `/<@[!&]?\d+>/` tem um colchete que fecharia a contagem no
   meio da regra. Saber se uma barra começa uma regra ou é divisão depende do
   que veio antes -- depois de `(`, `=`, `,` e afins é regra; depois de um
   valor é divisão. É heurística, e basta para este arquivo. */
function fimDoBloco(j) {
  let nivel = 0, dentro = null, k = j;
  for (; k < fonte.length; k++) {
    const c = fonte[k], d = fonte[k + 1];
    if (dentro === "//") { if (c === "\n") dentro = null; continue; }
    if (dentro === "/*") { if (c === "*" && d === "/") { dentro = null; k++; } continue; }
    if (dentro === "re") {
      if (escapado(k)) continue;
      if (c === "[") dentro = "re[";
      else if (c === "/") dentro = null;
      continue;
    }
    if (dentro === "re[") { if (c === "]" && !escapado(k)) dentro = "re"; continue; }
    if (dentro) { if (c === dentro && !escapado(k)) dentro = null; continue; }

    if (c === "/" && d === "/") { dentro = "//"; k++; continue; }
    if (c === "/" && d === "*") { dentro = "/*"; k++; continue; }
    if (c === "/") {
      /* A palavra-chave é conferida como PALAVRA, não como letras soltas.

         Antes a lista era a string "(,=:[!&|?{};+return" e o teste era
         `includes` de um caractere só -- o que fazia r, e, t, u e n contarem
         como sinal de expressão regular. Aí `Math.round(pct / 10)` tinha um
         `t` antes da barra, virava início de regra, e a extração engolia 79
         mil caracteres até achar a próxima barra. Só não tinha aparecido
         porque nenhuma função testada dividia por algo terminado nessas
         letras. */
      const antes = fonte.slice(0, k).replace(/\s+$/, "");
      const pontuacao = "(,=:[!&|?{};+".includes(antes.slice(-1));
      const palavra = /(?<![\p{L}\p{N}_$])(return|typeof|case|in|of|do|else|yield|await|new)$/u.test(antes);
      if (!antes || pontuacao || palavra) { dentro = "re"; continue; }
    }
    if (c === '"' || c === "'" || c === "`") { dentro = c; continue; }
    /* Parênteses contam junto: `new Set([...])` fecha o colchete ANTES do
       parêntese, e sem contar os dois a extração parava no `]` e devolvia
       código pela metade. */
    if (c === "{" || c === "[" || c === "(") nivel++;
    else if (c === "}" || c === "]" || c === ")") { nivel--; if (nivel === 0) { k++; break; } }
    else if (c === ";" && nivel === 0) { k++; break; }
  }
  return k;
}

function pedaco(nome) {
  /* `async function` vem ANTES de `function` nesta lista, e a ordem é o
     conserto de um defeito: `indexOf("function X(")` casa lá dentro de
     `async function X(`, no meio da palavra. A extração começava depois do
     `async`, e o primeiro `await` do corpo estourava com "await is only valid
     in async functions" -- erro que aponta pro código do bot, que está certo.
     Só apareceu agora porque nenhuma função assíncrona tinha sido testada. */
  for (const abre of [`async function ${nome}(`, `function ${nome}(`, `const ${nome} = `]) {
    const i = fonte.indexOf(abre);
    if (i < 0) continue;

    /* Achar o corpo pulando a lista de parâmetros, e não pela primeira chave.

       Parâmetro desestruturado tem chave PRÓPRIA, e ela vem antes:
       `function f(a, { b, c })` fazia a contagem começar no `{` do parâmetro
       e terminar no `}` dele, devolvendo uma assinatura sem corpo nenhum. O
       erro saía como "Unexpected token 'function'", apontando para a função
       seguinte -- longe de onde o problema estava. */
    const j = abre.endsWith("= ")
      ? i + abre.length
      : fonte.indexOf("{", fimDoBloco(fonte.indexOf("(", i)));

    const k = fimDoBloco(j);
    return fonte.slice(i, k).replace(/^const /, "var ");
  }
  throw new Error(`não achei "${nome}" no index.js — foi renomeada?`);
}

function carregar(nomes) {
  const codigo = nomes.map(pedaco).join("\n\n");
  const devolve = `;({${nomes.join(",")}})`;
  try {
    return (0, eval)(codigo + devolve);
  } catch (e) {
    throw new Error(`não consegui carregar [${nomes.join(", ")}]: ${e.message}`);
  }
}

/* ---- o placar ---- */
let passou = 0; const falhou = [];
function ok(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { passou++; return; }
  falhou.push(`${nome}\n      esperava: ${JSON.stringify(esperado)}\n      veio:     ${JSON.stringify(real)}`);
}
function verdade(nome, valor) { ok(nome, !!valor, true); }

/* ================= o glossário e a proteção do tradutor =================
   Toda esta seção nasceu de defeitos reais. */
{
  const { protegerDoTradutor, devolverPecas } =
    carregar(["PEDACOS_INTOCAVEIS", "regraDosTermos", "protegerDoTradutor", "devolverPecas"]);
  const ida_e_volta = (t, termos = []) => {
    const { marcado, pecas } = protegerDoTradutor(t, termos);
    return devolverPecas(marcado, pecas);
  };
  const termos = ["urso", "rally", "baú", "urso polar", "TOP"];

  /* O texto tem que voltar IGUAL quando nada e' traduzido. Se isto quebrar,
     toda fala do chat sai deformada. */
  for (const t of [
    "alguem no rally?",
    "abre os baús e o baú",
    "a [TOP] vai no urso, e nos ursos de amanha",
    "olha o <#1535115497035530374>! e <@866033442688073748>, beleza?",
    "(vamos no urso) — urso polar depois",
    "link https://kingshot.fandom.com/wiki/Bear no meio",
    "sem nada especial",
  ]) ok(`ida e volta: ${t.slice(0, 32)}`, ida_e_volta(t, termos), t);

  /* O tradutor mexe no espacamento dos marcadores -- foi assim que "rally?"
     virou "rally ?" em producao. */
  {
    const { marcado, pecas } = protegerDoTradutor("olha o <@123> ali!", []);
    const comoOTradutorDevolve = marcado.replace(/%%(\d+)%%/g, "%% $1 %%");
    ok("tradutor mexeu no espaço do marcador", devolverPecas(comoOTradutorDevolve, pecas), "olha o <@123> ali!");
  }

  /* Marcador que o tradutor ENGOLIU nao pode sumir com a mencao de alguem. */
  {
    const { marcado, pecas } = protegerDoTradutor("<@111> e <@222> venham", []);
    const perdido = devolverPecas(marcado.replace("%%0%%", ""), pecas);
    verdade("menção engolida pelo tradutor volta no fim", perdido.includes("<@111>") && perdido.includes("<@222>"));
  }

  /* Plural entra; diminutivo nao. */
  verdade("termo pega o plural", protegerDoTradutor("os baús", ["baú"]).pecas.length === 1);
  verdade("termo não pega diminutivo", protegerDoTradutor("o ursinho", ["urso"]).pecas.length === 0);
  /* Termo longo ganha do curto, senao "urso" comeria "urso polar" pelo meio. */
  ok("termo longo tem prioridade", protegerDoTradutor("no urso polar", termos).pecas, ["urso polar"]);
  /* Sem glossário, nada de texto é protegido -- só menção, emoji e link. */
  ok("sem glossário não protege palavra", protegerDoTradutor("vamos no urso", []).pecas, []);
}

/* ================= a cor de cada pessoa ================= */
{
  const { corDaPessoa, CORES_DE_PESSOA } = carregar(["CORES_DE_PESSOA", "corDaPessoa"]);
  const id = "866033442688073748";
  ok("a cor da pessoa não muda entre chamadas", corDaPessoa(id), corDaPessoa(id));
  verdade("a cor sai da paleta escolhida", CORES_DE_PESSOA.includes(corDaPessoa(id)));
  verdade("pessoas diferentes não são todas da mesma cor",
    new Set(["1", "22", "333", "4444", "55555", "666666"].map(corDaPessoa)).size > 1);
}

/* ================= a explicação dos erros ================= */
{
  const { explicarErro } = carregar(["EXPLICA_ERRO", "explicarErro"]);
  const titulo = (onde, porque) => explicarErro(onde, porque)?.titulo || null;

  ok("supabase fora do ar é calmo",
    explicarErro("espelho", "passada curta falhou em Tttt supabase 504").precisaDeVoce, false);
  ok("tradutor sobrecarregado é com você",
    explicarErro("espelho", "tradutor devolveu HTTP 429").precisaDeVoce, true);
  /* O 429 solto num id nao pode virar alarme de tradutor. */
  ok("429 dentro de um número não vira alarme", titulo("idioma", "canal 1429384 sumiu"), null);
  ok("clique vencido é calmo", explicarErro("interacao", "falhou: Unknown interaction").precisaDeVoce, false);
  ok("erro que eu não conheço aparece cru", titulo("zzz", "coisa que nunca vi"), null);

  /* ---- a linha que o cartão "não sei explicar" trouxe ----

     Foi assim que ela chegou, palavra por palavra. `explicarErro` recebe o
     que vem ANTES do primeiro ":" como `onde` e todo o resto como `porque`,
     que é como o embrulho do console.error parte a linha. */
  const timeout = explicarErro("tradutor",
    "chave azure do dono falhou: The operation was aborted due to timeout");
  verdade("o tempo esgotado do tradutor tem explicação agora", !!timeout);
  ok("e ele não precisa de você", timeout.precisaDeVoce, false);
  verdade("a explicação diz que a chave continua boa", /chave/i.test(timeout.oque));
  verdade("e que a fala sai pelos grátis mesmo assim", /grátis/i.test(timeout.oque));

  /* ---- e não pode voltar a ser reclassificado como banco ----

     A regra do banco reivindica "fetch failed", "ECONNRESET" e afins, e ela
     vem primeiro no arquivo desde sempre. Uma tradução que não voltou
     aparecia como "O banco de dados piscou" e mandava conferir o
     status.supabase.com por um problema que não é de lá. Explicação errada
     custa o tempo de quem foi procurar no lugar indicado. */
  for (const sintoma of ["fetch failed", "ECONNRESET", "socket hang up", "ETIMEDOUT"]) {
    ok(`"${sintoma}" vindo do tradutor não vira problema de banco`,
      titulo("tradutor", `chave azure do dono falhou: ${sintoma}`),
      timeout.titulo);
  }
  /* Mas o banco continua dono dos sintomas dele: a regra nova exige a palavra
     "tradutor" perto, senão ela roubaria os erros de todo o resto do bot. */
  ok("o mesmo sintoma vindo do banco continua sendo do banco",
    titulo("espelho", "passada curta falhou: fetch failed"), "O banco de dados piscou");
  ok("e um tempo esgotado longe do tradutor não é adivinhado",
    titulo("herois", "algo muito, muito longo aqui no meio de uma frase enorme que separa " +
      "as duas palavras: aborted due to timeout"), null);
}

/* ============ o anúncio da Arena, lido em qualquer língua ============

   Ele é UMA mensagem para o servidor inteiro, escrita em inglês, com o menu 🌐
   pendurado. O risco não é ele quebrar: é ele funcionar e cobrar por clique,
   para sempre, sem nada quebrar. Os testes perseguem isso. */
{
  const { ANUNCIO_ARENA, anuncioTraduzido, menuDoAnuncio, MAX_CACHE, LINGUAS_MENU } =
    carregar(["MAX_CACHE", "PEDACO_TRADUCAO", "LINGUAS_MENU", "ANUNCIO_ARENA",
      "anuncioTraduzido", "menuDoAnuncio"]);

  globalThis.COR = 0xF5A623;
  globalThis.MOTOR_AUTO = { tipo: "teste" };
  let pedidos = [];
  globalThis.traduzirComCache = async (t) => { pedidos.push(t); return `<${t}>`; };

  /* ---- O TESTE QUE IMPORTA: todo bloco cabe no cache ----

     traduzirComCache só GUARDA até MAX_CACHE caracteres -- acima disso ele
     traduz e joga a tradução fora. Um bloco que passe de 400 seria retraduzido
     a cada clique de cada pessoa, para sempre, e nada quebraria: só a fatura.

     É um erro fácil de cometer sem perceber, porque escrever mais uma frase
     num bloco existente é a coisa mais natural do mundo. */
  const tudo = [ANUNCIO_ARENA.titulo, ...ANUNCIO_ARENA.blocos, ANUNCIO_ARENA.rodape];
  for (const b of tudo) {
    verdade(`o bloco "${b.slice(0, 32)}…" (${b.length}) cabe no cache`, b.length <= MAX_CACHE);
  }

  /* ---- inglês é o original: pedir inglês não gasta nada ---- */
  pedidos = [];
  const emIngles = await anuncioTraduzido("en");
  ok("ninguém paga para receber o texto que já tem", pedidos.length, 0);
  verdade("e o cartão vem inteiro mesmo assim",
    !!emIngles.title && !!emIngles.description && !!emIngles.footer.text);
  verdade("o original diz Language Arena", /Language Arena/.test(emIngles.title));

  /* ---- outra língua: tudo traduzido, e só o que é fixo ---- */
  pedidos = [];
  const emAlemao = await anuncioTraduzido("de");
  ok("cada bloco é pedido uma vez", pedidos.length, tudo.length);
  verdade("nenhum bloco escapou", tudo.every((b) => pedidos.includes(b)));
  verdade("o título traduzido entra no cartão", emAlemao.title.startsWith("<"));
  verdade("o rodapé também", emAlemao.footer.text.startsWith("<"));

  /* A segunda pessoa a abrir em alemão pede exatamente as mesmas chaves --
     que é o que faz o cache servir para alguma coisa. */
  const primeira = [...pedidos];
  pedidos = [];
  await anuncioTraduzido("de");
  ok("a segunda leitura pede as mesmas chaves", pedidos, primeira);

  /* ---- os limites do Discord ---- */
  verdade("o título cabe", emAlemao.title.length <= 256);
  verdade("a descrição cabe", emAlemao.description.length <= 4096);
  verdade("o rodapé cabe", emAlemao.footer.text.length <= 2048);

  const opcoes = menuDoAnuncio()[0].components[0].options.map((o) => o.data ?? o);
  ok("o menu tem todas as línguas", opcoes.length, LINGUAS_MENU.length);
  verdade("e cabe no teto de 25 do Discord", opcoes.length <= 25);
  for (const o of opcoes) {
    verdade(`"${o.label}" cabe no menu`, o.label.length <= 100);
    /* O nome próprio aqui pela mesma razão do menu de idiomas: é a tela que
       serve exatamente a quem não lê a língua da casa. */
    const [, emPortugues, , proprio] = LINGUAS_MENU.find(([c]) => c === o.value);
    verdade(`"${o.label}" traz o nome próprio`, o.label.includes(proprio));
    verdade(`"${o.label}" traz o nome em português`, o.label.includes(emPortugues));
  }

  /* ---- e o menu não pode carregar id de mensagem ----

     Se ele voltar a ser `traduzir-msg:<id>`, o texto passa a sair de
     discord_msg_traducao -- que a varredura apaga em 7 dias. No oitavo dia um
     anúncio FIXADO responderia "não encontrei mais essa mensagem", que do lado
     de fora é o bot quebrado. */
  const cid = menuDoAnuncio()[0].components[0].data.custom_id;
  ok("a chave do menu é o próprio anúncio, e não uma mensagem", cid, "traduzir-fixo:arena");

  const fonteAnuncio = readFileSync(`${aqui}/index.js`, "utf8");
  const corpo = fonteAnuncio.slice(
    fonteAnuncio.indexOf("async function anuncioTraduzido"),
    fonteAnuncio.indexOf("function menuDoAnuncio"));
  verdade("achei o anúncio para conferir", corpo.length > 100);
  /* traduzirLongo reparte em pedaços de 1500, que passam de MAX_CACHE: usá-lo
     aqui furaria o cache sem mudar uma linha visível. */
  verdade("o anúncio não passa por traduzirLongo, que fura o cache",
    !corpo.includes("traduzirLongo"));
  verdade("e não lê a tabela que a varredura apaga",
    !corpo.includes("discord_msg_traducao"));
}

/* ================= a lista de tradutores do painel ================= */
{
  const { tradutoresDoPainel } = carregar(["FORMATOS", "tradutoresDoPainel"]);
  const nomes = (t) => tradutoresDoPainel(t).map((x) => x.nome);

  ok("aceita lingva e libre", nomes("lingva|https://a.com\nlibre|https://b.com").length, 2);
  ok("recusa http sem s", nomes("lingva|http://inseguro.com"), []);
  ok("recusa formato desconhecido", nomes("foo|https://a.com"), []);
  ok("recusa linha sem endereço", nomes("lingva|"), []);
  ok("vazio não quebra", nomes(""), []);
  ok("nulo não quebra", nomes(null), []);
  /* Uma linha ruim nao pode derrubar as boas. */
  ok("linha ruim no meio não leva as boas junto",
    nomes("lingva|https://bom.com\nlixo\nlibre|https://outro.com").length, 2);
  {
    const [lingva, libre] = tradutoresDoPainel("lingva|https://a.com/\nlibre|https://b.com/");
    ok("lingva monta a URL com o texto dentro", lingva.url("bom dia", "de"), "https://a.com/api/v1/auto/de/bom%20dia");
    ok("libre manda o texto no corpo", libre.corpo("bom dia", "de"),
      { q: "bom dia", source: "auto", target: "de", format: "text" });
  }
}

/* ================= onde cada fala mora ================= */
{
  const { ondeMoraAFala, lembrarFala, MAX_FALAS_LEMBRADAS } =
    carregar(["ondeMoraAFala", "MAX_FALAS_LEMBRADAS", "lembrarFala"]);
  const fam = new Map();
  lembrarFala(fam, "pt", "m1"); lembrarFala(fam, "en", "m2"); lembrarFala(fam, "de", "m3");

  /* Quem responde a QUALQUER copia tem que achar a irma da sala dele. */
  ok("respondendo em en, acha a cópia em de", ondeMoraAFala.get("m2").get("de"), "m3");
  ok("respondendo em de, acha a original em pt", ondeMoraAFala.get("m3").get("pt"), "m1");
  ok("id que nunca vi não inventa resposta", ondeMoraAFala.get("nunca-vi"), undefined);
  lembrarFala(fam, "fr", null);
  ok("id nulo não entra na memória", ondeMoraAFala.has(null), false);

  for (let i = 0; i < MAX_FALAS_LEMBRADAS + 100; i++) lembrarFala(new Map(), "pt", `x${i}`);
  ok("a memória respeita o teto", ondeMoraAFala.size, MAX_FALAS_LEMBRADAS);
  ok("a fala mais velha é a que sai", ondeMoraAFala.get("m1"), undefined);
}

/* ================= as horas ================= */
{
  const { quandoFoi } = carregar(["quandoFoi"]);
  /* Formato do Discord: cada pessoa ve no fuso dela. Se isto virar hora
     formatada, volta o defeito de mostrar o relogio do servidor. */
  ok("hora vai no formato do Discord", quandoFoi(1788018572000), "<t:1788018572:T>");
  ok("aceita estilo relativo", quandoFoi(1788018572000, "R"), "<t:1788018572:R>");
  verdade("sem argumento usa agora", /^<t:\d{10}:T>$/.test(quandoFoi()));
}

/* ================= os termos do servidor ================= */
{
  const { termosDoServidor } = carregar(["termosDoServidor"]);
  ok("uma por linha", termosDoServidor({ glossario: "urso\nrally\nbaú" }), ["urso", "rally", "baú"]);
  ok("aceita vírgula e ponto e vírgula", termosDoServidor({ glossario: "urso, rally; baú" }), ["urso", "rally", "baú"]);
  ok("linha vazia não vira termo", termosDoServidor({ glossario: "urso\n\n\nrally\n" }), ["urso", "rally"]);
  ok("servidor sem glossário", termosDoServidor({}), []);
  ok("servidor nulo não quebra", termosDoServidor(null), []);
}

/* ================= o formulário do Discord ================= */
{
  const { janelaValida } = carregar(["janelaValida"]);
  /* O Discord recusa rotulo acima de 45 e o formulario nao abre. Ja aconteceu:
     um rotulo de 47 deixou os Ajustes inacessiveis. */
  const j = janelaValida({
    custom_id: "t", title: "x".repeat(60),
    components: [{ type: 1, components: [{ type: 4, custom_id: "a", label: "y".repeat(60), placeholder: "z".repeat(150) }] }],
  });
  verdade("título é cortado em 45", j.title.length <= 45);
  verdade("rótulo é cortado em 45", j.components[0].components[0].label.length <= 45);
  verdade("dica é cortada em 100", j.components[0].components[0].placeholder.length <= 100);
}



/* ================= as portas das réplicas =================
   Vieram de uma revisão do código, não de um defeito visto: os dois primeiros
   casos abaixo derrubariam a montagem inteira de um idioma, e o terceiro
   entregaria a cópia de um canal privado ao servidor todo. Nenhum tinha
   acontecido ainda porque nenhum dos sete servidores de hoje usa permissão de
   pessoa em canal. Bastaria um cliente usar. */
{
  const { portasDaReplica } = carregar(["SO_LEITURA", "portasDaReplica"]);
  /* Dublês do discord.js: só o que a função realmente pergunta. */
  const bits = (n) => ({ has: (b) => (BigInt(n) & BigInt(b)) === BigInt(b), toArray: () => [] });
  const V = 1n << 10n, S = 1n << 11n;
  const guild = (cargos) => ({
    roles: { everyone: { id: "todos" }, cache: new Map(cargos.map((c) => [c, { id: c }])) },
  });
  const fonte = (verQuem, falaQuem, portas = []) => ({
    permissionsFor: (quem) => bits((verQuem.includes(quem?.id ?? quem) ? V : 0n) | (falaQuem.includes(quem?.id ?? quem) ? S : 0n)),
    permissionOverwrites: { cache: new Map(portas.map((p) => [p.id, { allow: bits(p.ver ? V | (p.fala ? S : 0n) : 0n) }])) },
  });
  globalThis.client = { user: { id: "bot" } };

  /* Toda porta tem que dizer de quem ela é -- sem isso o discord.js tenta
     adivinhar, não acha, e levanta erro que derruba o idioma inteiro. */
  {
    const p = portasDaReplica(guild(["pt", "en", "lider"]), "pt",
      fonte(["lider", "pessoa1"], ["lider"], [{ id: "lider", ver: true, fala: true }, { id: "pessoa1", ver: true }]),
      ["en"], true);
    verdade("toda porta diz se é de cargo ou de pessoa", p.every((x) => x.type === 0 || x.type === 1));
    ok("a porta do bot é de pessoa", p.find((x) => x.id === "bot").type, 1);
    ok("a porta de um cargo é de cargo", p.find((x) => x.id === "lider").type, 0);
    ok("a porta de alguém é de pessoa", p.find((x) => x.id === "pessoa1").type, 1);
  }

  /* Cargo que foi apagado não pode entrar na lista. */
  {
    const p = portasDaReplica(guild(["pt", "lider"]), "pt", fonte(["lider"], ["lider"], [{ id: "lider", ver: true, fala: true }]),
      ["en-apagado"], true);
    ok("cargo apagado fica de fora", p.some((x) => x.id === "en-apagado"), false);
  }

  /* O caso que recriava o vazamento: canal privado sem porta escrita
     (acesso por Administrator) NÃO pode virar cópia aberta. */
  {
    const p = portasDaReplica(guild(["pt", "en"]), "pt", fonte([], [], []), ["en"], true);
    ok("canal privado sem porta não abre a cópia ao idioma", p.some((x) => x.id === "pt"), false);
    ok("e continua fechado para todos", p.find((x) => x.id === "todos").deny.length, 1);
  }

  /* Canal aberto continua sendo do cargo do idioma, como sempre foi. */
  {
    const p = portasDaReplica(guild(["pt", "en"]), "pt", fonte(["todos"], ["todos"], []), ["en"], true);
    const doIdioma = p.find((x) => x.id === "pt");
    verdade("canal aberto: a réplica é do cargo do idioma", !!doIdioma);
    verdade("e quem fala na origem fala na réplica", doIdioma.allow.length === 3);
  }

  /* Canal onde só o administrador escreve: a réplica lê, mas não escreve. */
  {
    const p = portasDaReplica(guild(["pt", "en"]), "pt", fonte(["todos"], [], []), ["en"], true);
    const doIdioma = p.find((x) => x.id === "pt");
    verdade("origem sem escrita: réplica fica só de leitura", (doIdioma.deny || []).length > 0);
  }

  /* No plano grátis ninguém fala, nem quem fala na origem. */
  {
    const p = portasDaReplica(guild(["pt"]), "pt", fonte(["todos"], ["todos"], []), [], false);
    verdade("plano grátis: réplica é só leitura", (p.find((x) => x.id === "pt").deny || []).length > 0);
  }
}



/* ================= os comandos que o dono escreve ================= */
{
  const { NOMES_MEUS } = carregar(["NOMES_MEUS"]);
  /* Um comando do dono chamado "cyron" nunca seria chamado, porque os meus
     vem antes no despacho -- e ele nao descobriria por que. O formulario tem
     que recusar na hora, que e' onde ainda dá para explicar. */
  for (const n of ["cyron", "help", "admin", "mylanguage"]) {
    verdade(`/${n} é meu e não pode ser reaproveitado`, NOMES_MEUS.has(n));
  }

  /* Este teste dizia `!NOMES_MEUS.has("ranking")` -- ele afirmava o defeito.

     A lista trazia "ranking-oficial", nome que não existe em lugar nenhum, e
     o /ranking do Kingshot ficava desprotegido. Um comando do dono com esse
     nome passou pela peneira e adotou o comando do jogo. */
  for (const n of ["ranking", "player", "events", "settings", "portal"]) {
    verdade(`/${n} é do jogo e não pode ser reaproveitado`, NOMES_MEUS.has(n));
  }
  verdade("nome livre continua livre", !NOMES_MEUS.has("reino"));

  /* O Discord só aceita minúsculas, números, hífen e sublinhado, até 32. */
  const valido = (n) => /^[a-z0-9_-]{1,32}$/.test(n);
  ok("nome simples passa", valido("ranking"), true);
  ok("nome com hífen passa", valido("meu-ranking"), true);
  ok("nome com maiúscula não passa", valido("Ranking"), false);
  ok("nome com espaço não passa", valido("meu ranking"), false);
  ok("nome com acento não passa", valido("classificação"), false);
  ok("nome vazio não passa", valido(""), false);
  ok("nome de 33 letras não passa", valido("x".repeat(33)), false);
}

/* ========== de quem é o comando: pelo id gravado, nunca pelo nome ==========

   Esta seção existe por um estrago de verdade, em produção. O publicador
   decidia "é meu" comparando NOME. O dono criou um /ranking; o /ranking do
   Kingshot já morava naquele servidor; o publicador achou que era o dele,
   reescreveu a descrição do comando do jogo -- calado, porque o ramo de
   editar não logava -- e teria apagado o comando do jogo no dia em que o
   dono desativasse o seu.

   Nenhum teste pegou isso na época porque não havia teste desta função. */
{
  const { publicarComandosDoDono } = carregar(["publicarComandosDoDono"]);

  /* O que a função toca no mundo, trocado por bonecos. */
  const fingirGuild = (comandos) => {
    const mexeu = { criou: [], editou: [], apagou: [] };
    const mapa = new Map();
    for (const c of comandos) {
      mapa.set(c.id, {
        ...c,
        edit: async (mudanca) => { mexeu.editou.push({ id: c.id, ...mudanca }); },
        delete: async () => { mexeu.apagou.push(c.id); },
      });
    }
    return {
      mexeu,
      guild: {
        id: "g1",
        name: "servidor de teste",
        commands: {
          fetch: async () => mapa,
          create: async ({ name, description }) => {
            const novo = { id: `novo-${name}`, name, description };
            mexeu.criou.push(novo);
            return novo;
          },
        },
      },
    };
  };

  /* `carregar` avalia no escopo global, então as dependências moram nele. */
  const cenario = async ({ noDiscord, ativos, todasAsLinhas }) => {
    const { mexeu, guild } = fingirGuild(noDiscord);
    const gravou = [];
    globalThis.cacheComandos = new Map();
    globalThis.comandosDoDono = async () => ativos.map((c) => ({ ...c }));
    globalThis.sb = async () => todasAsLinhas;
    globalThis.sbPatch = async (rota, corpo) => { gravou.push({ rota, corpo }); };
    await publicarComandosDoDono(guild);
    return { ...mexeu, gravou };
  };

  /* O caso exato do estrago. */
  {
    const r = await cenario({
      noDiscord: [{ id: "do-jogo", name: "ranking", description: "Alliance power ranking" }],
      ativos: [{ id: "linha1", nome: "ranking", descricao: "ranking do reino 2311", discord_id: null }],
      todasAsLinhas: [{ nome: "ranking", discord_id: null }],
    });
    ok("nome ocupado por comando alheio: não edita", r.editou, []);
    ok("nome ocupado por comando alheio: não cria", r.criou, []);
    ok("nome ocupado por comando alheio: não apaga", r.apagou, []);
  }

  /* Comando meu de verdade: tem id gravado, e aí sim eu mexo. */
  {
    const r = await cenario({
      noDiscord: [{ id: "meu-id", name: "reino", description: "descrição velha" }],
      ativos: [{ id: "linha1", nome: "reino", descricao: "descrição nova", discord_id: "meu-id" }],
      todasAsLinhas: [{ nome: "reino", discord_id: "meu-id" }],
    });
    ok("comando meu com descrição mudada: edita", r.editou.map((e) => e.description), ["descrição nova"]);
    ok("comando meu com descrição mudada: não cria outro", r.criou, []);
  }

  /* Nome livre: cria e guarda o id, senão ele vira órfão no próximo reinício. */
  {
    const r = await cenario({
      noDiscord: [{ id: "do-jogo", name: "ranking", description: "Alliance power ranking" }],
      ativos: [{ id: "linha1", nome: "reino", descricao: "ranking do reino 2311", discord_id: null }],
      todasAsLinhas: [{ nome: "reino", discord_id: null }],
    });
    ok("nome livre: cria", r.criou.map((c) => c.name), ["reino"]);
    ok("nome livre: grava o id do Discord", r.gravou.map((g) => g.corpo.discord_id), ["novo-reino"]);
    ok("nome livre: não encosta no comando do jogo", r.editou.concat(r.apagou), []);
  }

  /* Desativado sai do Discord -- mas só o que tem id meu. */
  {
    const r = await cenario({
      noDiscord: [{ id: "meu-id", name: "reino", description: "x" }],
      ativos: [],
      todasAsLinhas: [{ nome: "reino", discord_id: "meu-id" }],
    });
    ok("comando desativado sai do Discord", r.apagou, ["meu-id"]);
  }

  /* E o contrário: linha sem id nunca pode virar ordem de apagar. Era este o
     caminho que levaria o /ranking do Kingshot embora. */
  {
    const r = await cenario({
      noDiscord: [{ id: "do-jogo", name: "ranking", description: "Alliance power ranking" }],
      ativos: [],
      todasAsLinhas: [{ nome: "ranking", discord_id: null }],
    });
    ok("linha sem id não apaga comando alheio de mesmo nome", r.apagou, []);
  }
}

/* ============ o formulário de criar comando, do começo ao fim ============

   Ele não tinha teste nenhum, e é a função que mais mudou no conserto acima.
   Aqui o formulário é preenchido de mentira e se confere o que ele gravou. */
{
  const { salvarComando, lerQuemPode } = carregar([
    "NOMES_MEUS", "MINIMO_DO_RITMO", "CAIXA_DE_CODIGO",
    "pedacosDoCodigo", "juntarCodigo", "lerQuemPode", "salvarComando"]);

  const preencher = async (campos, { noDiscord = [], linhaExistente = null } = {}) => {
    const feito = { post: [], patch: [], del: [], publicou: 0, resposta: "" };
    globalThis.ehDono = async () => true;
    globalThis.cacheComandos = new Map();
    globalThis.publicarComandosDoDono = async () => { feito.publicou++; };
    globalThis.sb = async () => (linhaExistente ? [linhaExistente] : []);
    globalThis.sbPost = async (rota, corpo) => { feito.post.push({ rota, corpo }); };
    globalThis.sbPatch = async (rota, corpo) => { feito.patch.push({ rota, corpo }); };
    globalThis.sbDel = async (rota) => { feito.del.push(rota); };

    const inter = {
      user: { id: "dono1" },
      guildId: "g1",
      guild: { commands: { fetch: async () => new Map(noDiscord.map((c) => [c.id, c])) } },
      fields: { getTextInputValue: (n) => (n in campos ? campos[n] : "") },
      deferReply: async () => {},
      reply: async (r) => { feito.resposta = typeof r === "string" ? r : r.content; },
      editReply: async (r) => { feito.resposta = typeof r === "string" ? r : r.content; },
    };
    await salvarComando(inter);
    return feito;
  };

  /* O caminho feliz: nome livre, código colado, comando gravado. */
  {
    const r = await preencher({ nome: "reino", descricao: "ranking do reino", codigo: "return 1;", quem_pode: "todos" });
    ok("criar comando novo: grava uma linha", r.post.length, 1);
    ok("criar comando novo: grava o nome certo", r.post[0]?.corpo?.nome, "reino");
    ok("criar comando novo: grava quem pode", r.post[0]?.corpo?.quem_pode, "todos");
    ok("criar comando novo: nasce ativo", r.post[0]?.corpo?.ativo, true);
    ok("criar comando novo: publica no Discord", r.publicou, 1);
    verdade("criar comando novo: confirma pro dono", /Criei/.test(r.resposta));
  }

  /* Quem não escolhe, não vira "todos" por acidente. */
  {
    const r = await preencher({ nome: "reino", codigo: "return 1;" });
    ok("quem pode em branco nasce em 'dono'", r.post[0]?.corpo?.quem_pode, "dono");
  }

  /* O defeito de hoje, barrado uma casa antes: nome ocupado por comando alheio. */
  {
    const r = await preencher(
      { nome: "ranking2", codigo: "return 1;" },
      { noDiscord: [{ id: "do-jogo", name: "ranking2", description: "Alliance power ranking" }] });
    ok("nome ocupado por comando alheio: não grava nada", r.post.concat(r.patch), []);
    verdade("nome ocupado por comando alheio: diz que não gravou", /Não gravei nada/.test(r.resposta));
  }

  /* Nome que é meu: recusado pela lista, sem nem perguntar ao Discord. */
  {
    const r = await preencher({ nome: "ranking", codigo: "return 1;" });
    ok("nome do jogo é recusado", r.post.concat(r.patch), []);
  }

  /* O Discord não aceita maiúscula; recusar aqui explica, lá dá erro em inglês. */
  {
    const r = await preencher({ nome: "Reino", codigo: "return 1;" });
    ok("nome com maiúscula vira minúscula e passa", r.post[0]?.corpo?.nome, "reino");
  }
  {
    const r = await preencher({ nome: "cla$$", codigo: "return 1;" });
    ok("nome com símbolo é recusado", r.post.concat(r.patch), []);
  }

  /* Apagar desliga a linha em vez de sumir com ela -- o discord_id mora nela,
     e sem ele o comando ficaria pendurado no menu do servidor para sempre. */
  {
    const r = await preencher(
      { nome: "reino", apagar: "SIM" },
      { linhaExistente: { id: "linha1", discord_id: "meu-id" } });
    ok("apagar não deleta a linha", r.del, []);
    ok("apagar desliga a linha", r.patch.map((p) => p.corpo.ativo), [false]);
    ok("apagar manda republicar (é quem tira do Discord)", r.publicou, 1);
  }

  /* Nome e descrição dividem uma linha; foi o que liberou a quinta pro código. */
  {
    const r = await preencher({ nome: "reino | ranking do reino 2311", codigo: "return 1;" });
    ok("o nome vem antes da barra", r.post[0]?.corpo?.nome, "reino");
    ok("e a descrição depois", r.post[0]?.corpo?.descricao, "ranking do reino 2311");
  }
  {
    const r = await preencher({ nome: "reino", codigo: "return 1;" });
    ok("sem barra, a descrição é gerada", r.post[0]?.corpo?.descricao, "comando reino");
  }

  /* As duas caixas de código viram uma coisa só, com a segunda em linha nova. */
  {
    const r = await preencher({ nome: "reino", codigo: "const a = 1;", codigo2: "return a;" });
    ok("as duas caixas se juntam com uma quebra", r.post[0]?.corpo?.codigo, "const a = 1;\nreturn a;");
  }

  /* Caixa vazia num comando que já existe MANTÉM o código. É o caso do comando
     grande demais (o formulário abre sem código de propósito) e o do dedo que
     limpou a caixa sem querer — nos dois, gravar vazio destruiria o trabalho. */
  {
    const r = await preencher(
      { nome: "reino", codigo: "" },
      { linhaExistente: { id: "linha1", discord_id: "meu-id", codigo: "return 'antigo';" } });
    ok("código vazio não apaga o que já existia", r.patch[0]?.corpo?.codigo, "return 'antigo';");
  }
  {
    const r = await preencher({ nome: "novato", codigo: "" });
    ok("mas comando novo sem código não é gravado", r.post.concat(r.patch), []);
  }

  /* Nome que já existe no banco edita aquele, em vez de criar um segundo. */
  {
    const r = await preencher(
      { nome: "reino", codigo: "return 2;" },
      { linhaExistente: { id: "linha1", discord_id: "meu-id" } });
    ok("nome já existente edita, não cria", r.post, []);
    ok("nome já existente grava o código novo", r.patch[0]?.corpo?.codigo, "return 2;");
  }
}

/* ========== falas seguidas da mesma pessoa entram no mesmo cartão ==========

   Três frases seguidas viravam três caixas empilhadas, cada uma com moldura e
   assinatura. Do lado de lá a conversa lia pior do que o original.

   Duas das sete condições não são estética, e são as que estes testes
   guardam: emendar uma fala que marca alguém entrega o texto e engole o sino
   (editar não notifica ninguém), e emendar num cartão que já não é o último
   da sala joga a frase para cima da fala de outra pessoa. */
{
  const { emendaNaFalaAnterior, emendaNestaSala } =
    carregar(["JANELA_DE_GRUPO", "LIMITE_DO_CARTAO", "emendaNaFalaAnterior", "emendaNestaSala"]);

  const agora = 1_700_000_000_000;
  const antes = { autor: "tiago", quando: agora - 5000 };
  const fala = (mudar = {}) => ({
    autor: "tiago", agora, respondeAlguem: false, marcados: [], arquivos: [], ...mudar,
  });

  verdade("mesma pessoa, logo depois: emenda", emendaNaFalaAnterior(antes, fala()));
  verdade("primeira fala da sala: não tem onde emendar", !emendaNaFalaAnterior(undefined, fala()));
  verdade("outra pessoa: não emenda", !emendaNaFalaAnterior(antes, fala({ autor: "mirian" })));

  /* Sete minutos é a janela do próprio Discord: passou disso, ele já mostra o
     nome de novo, e o cartão emendado ficaria diferente do que está do lado. */
  verdade("seis minutos depois: ainda emenda",
    emendaNaFalaAnterior({ autor: "tiago", quando: agora - 6 * 60 * 1000 }, fala()));
  verdade("oito minutos depois: cartão novo",
    !emendaNaFalaAnterior({ autor: "tiago", quando: agora - 8 * 60 * 1000 }, fala()));

  /* Responder abre assunto: o cabeçalho tem que ficar em cima da frase dele. */
  verdade("fala que responde alguém: cartão novo",
    !emendaNaFalaAnterior(antes, fala({ respondeAlguem: true })));

  /* Estas duas são o motivo de a regra existir em função separada. */
  verdade("fala que marca alguém: cartão novo, senão o sino não toca",
    !emendaNaFalaAnterior(antes, fala({ marcados: ["mirian"] })));
  verdade("fala com anexo: cartão novo, senão o arquivo fica sem dono",
    !emendaNaFalaAnterior(antes, fala({ arquivos: [{ name: "a.png" }] })));

  /* E a metade que se decide sala por sala. */
  const velho = { id: "cartao1", linhas: ["oi"] };
  verdade("cartão ainda é o último da sala: emenda",
    emendaNestaSala(velho, "cartao1", "oi\ntudo bem"));
  verdade("alguém falou embaixo: cartão novo, senão a ordem mente",
    !emendaNestaSala(velho, "outra-mensagem", "oi\ntudo bem"));
  verdade("sem cartão anterior nesta sala: cartão novo",
    !emendaNestaSala(null, "cartao1", "oi"));
  verdade("sala vazia (nenhuma última mensagem): cartão novo",
    !emendaNestaSala(velho, undefined, "oi"));
  verdade("texto junto estourando o embed: cartão novo",
    !emendaNestaSala(velho, "cartao1", "x".repeat(3801)));
  verdade("texto junto no limite: ainda emenda",
    emendaNestaSala(velho, "cartao1", "x".repeat(3800)));
}

/* ---- e o espelho inteiro rodando, com Discord de mentira ----

   A regra acima é pura, mas quem erra de verdade é a costura. Aqui a função
   quente do produto roda de ponta a ponta contra um Discord de brinquedo, e
   se confere o que apareceu na sala do outro idioma. */
{
  const { espelharMensagem, ultimaFalaDaSala } = carregar([
    "JANELA_DE_GRUPO", "LIMITE_DO_CARTAO", "MAX_SALAS_LEMBRADAS", "TEXTO_MAXIMO",
    "LINGUAS_MENU", "bandeiraDoIdioma", "seloDeOrigem", "MOTIVOS_QUE_DOEM", "anotarSemTraducao",
    "ultimaFalaDaSala", "emendaNaFalaAnterior", "emendaNestaSala", "espelharMensagem"]);

  /* Um Discord de brinquedo: salas que lembram qual foi a última mensagem,
     webhooks que guardam o que mandaram, e edição que troca o embed no lugar. */
  const montarMundo = () => {
    const salas = new Map([["en", { lastMessageId: null }], ["es", { lastMessageId: null }]]);
    const mensagens = new Map();
    let seq = 0;
    globalThis.clienteDoWebhook = (url) => ({
      send: async (o) => {
        const id = `m${++seq}`;
        mensagens.set(id, { canal: url, embed: o.embeds[0], mencoes: o.allowedMentions?.users || [] });
        salas.get(url).lastMessageId = id;
        return { id };
      },
      editMessage: async (id, o) => {
        if (!mensagens.has(id)) throw new Error("mensagem apagada");
        mensagens.get(id).embed = o.embeds[0];
      },
    });
    return { salas, mensagens, quantas: () => mensagens.size };
  };

  globalThis.baixarAnexos = async () => ({ arquivos: [], links: [] });
  globalThis.aQuemResponde = async () => null;
  globalThis.corDaPessoa = () => 0x5865f2;
  globalThis.ondeMoraAFala = new Map();
  globalThis.procurarFamilia = async () => null;
  globalThis.lembrarFala = (familia, canalId, msgId) => {
    if (canalId && msgId) familia.set(canalId, msgId);
  };
  /* Sem tradução: o que interessa aqui é a montagem do cartão, e texto igual
     dos dois lados deixa a conferência legível. */
  globalThis.porQueNaoTraduzir = () => "curto";
  globalThis.anotarUso = () => {};
  globalThis.protegerDoTradutor = (t) => ({ marcado: t, pecas: [] });
  globalThis.devolverPecas = (t) => t;
  globalThis.traduzirComCache = async (t) => t;
  globalThis.traduzirLongo = async (t) => t;
  globalThis.MOTOR_AUTO = { tipo: "auto", chave: null };
  globalThis.motoresDoDono = () => [];

  const lista = [
    { canal_id: "pt", idioma: "pt", webhook: "pt" },
    { canal_id: "en", idioma: "en", webhook: "en" },
    { canal_id: "es", idioma: "es", webhook: "es" },
  ];
  const origem = { canal_id: "pt", idioma: "pt" };

  const falar = async (mundo, texto, mudar = {}) => {
    const msg = {
      id: `o${Math.random().toString(36).slice(2)}`,
      author: { id: "tiago", username: "Tiago", displayAvatarURL: () => "http://foto" },
      member: { displayName: "Tiago" },
      attachments: { size: 0 },
      mentions: { users: new Map() },
      reference: null,
      channel: { id: "pt" },
      guild: { id: "g", channels: { cache: mundo.salas } },
      ...mudar,
    };
    await espelharMensagem(msg, lista, origem, texto);
    return msg;
  };

  /* O caso do relato: três frases seguidas viravam três caixas. */
  {
    ultimaFalaDaSala.clear();
    const mundo = montarMundo();
    await falar(mundo, "I'm about to go in");
    await falar(mundo, "I was tweaking my translation system");
    await falar(mundo, "😅");

    ok("três falas seguidas: um cartão por sala, não três", mundo.quantas(), 2);
    const emIngles = [...mundo.mensagens.values()].find((m) => m.canal === "en");
    verdade("as três frases estão no mesmo cartão",
      /I'm about to go in\nI was tweaking my translation system\n😅/.test(emIngles.embed.description));
    verdade("a assinatura aparece uma vez só",
      emIngles.embed.description.split("discord.com/users/").length - 1 === 1);
  }

  /* Marcar alguém abre cartão novo: editar não toca sino em ninguém. */
  {
    ultimaFalaDaSala.clear();
    const mundo = montarMundo();
    await falar(mundo, "hey");
    await falar(mundo, "<@mirian> come to the bear",
      { mentions: { users: new Map([["mirian", {}]]) } });

    ok("fala que marca alguém sai em cartão novo", mundo.quantas(), 4);
    const comSino = [...mundo.mensagens.values()].filter((m) => m.mencoes.includes("mirian"));
    ok("e o sino toca uma vez em cada sala", comSino.length, 2);
  }

  /* Se alguém falou embaixo, aquela sala recebe cartão novo -- senão a frase
     apareceria ACIMA da fala dessa pessoa, e a ordem passaria a mentir. */
  {
    ultimaFalaDaSala.clear();
    const mundo = montarMundo();
    await falar(mundo, "primeira");
    mundo.salas.get("en").lastMessageId = "alguem-falou";
    await falar(mundo, "segunda");

    ok("sala mexida recebe cartão novo; a outra emenda", mundo.quantas(), 3);
    const es = [...mundo.mensagens.values()].filter((m) => m.canal === "es");
    ok("a sala parada continua com um cartão só", es.length, 1);
    verdade("e ele tem as duas falas", /primeira\nsegunda/.test(es[0].embed.description));
  }

  /* O cartão bilíngue, que apareceu num aviso de aliança de verdade.

     Uma fala longa demais para traduzir sai no original; a seguinte, curta,
     sai traduzida. Emendadas, davam um cartão com metade em inglês e metade
     em árabe — e nada dizendo o que tinha acontecido. */
  {
    ultimaFalaDaSala.clear();
    const mundo = montarMundo();
    /* Só esta fala não traduz: passa do teto. */
    globalThis.porQueNaoTraduzir = (t) => (t.length <= TEXTO_MAXIMO ? null : "tamanho");
    globalThis.traduzirLongo = async (t) => `[traduzido] ${t}`;

    await falar(mundo, "x".repeat(TEXTO_MAXIMO + 1));
    await falar(mundo, "agora uma curta");

    ok("a longa e a curta não dividem cartão", mundo.quantas(), 4);
    const en = [...mundo.mensagens.values()].filter((m) => m.canal === "en");
    verdade("a longa saiu no original", /^x{100}/.test(en[0].embed.description));
    verdade("a curta saiu traduzida", /\[traduzido\] agora uma curta/.test(en[1].embed.description));
    verdade("e nenhum cartão tem as duas línguas juntas",
      en.every((m) => !(/x{100}/.test(m.embed.description) && /\[traduzido\]/.test(m.embed.description))));

    /* E o rodapé conta qual é qual, sem depender de o leitor perceber. */
    verdade("o cartão não traduzido mostra só a origem", /🇧🇷$/.test(en[0].embed.description));
    verdade("o traduzido mostra a seta", /🇧🇷 → 🇬🇧$/.test(en[1].embed.description));

    /* De volta ao normal para os testes seguintes. */
    globalThis.porQueNaoTraduzir = () => "curto";
    globalThis.traduzirLongo = async (t) => t;
  }

  /* Cartão apagado no meio do caminho não pode levar a fala junto. */
  {
    ultimaFalaDaSala.clear();
    const mundo = montarMundo();
    await falar(mundo, "primeira");
    for (const id of [...mundo.mensagens.keys()]) mundo.mensagens.delete(id);
    await falar(mundo, "segunda");
    ok("emenda que falha vira envio novo, a fala não some", mundo.quantas(), 2);
  }
}

/* ============ o aviso de cota, que só pode falar na hora certa ============

   A cota mensal é o único limite deste produto que acaba sem avisar: ela
   devolve 403, a cascata cai no gratuito, o gratuito devolve 429, e o que se
   vê é "o bot parou de traduzir" — três camadas longe da causa.

   Um alarme desses erra de dois jeitos, e os dois são silenciosos: falar
   demais (e ensinar a ignorar o canal) ou falar de menos. */
{
  const { faixaDaCota, precisaAvisar, barraDeCota } =
    carregar(["AVISOS_DE_COTA", "faixaDaCota", "precisaAvisar", "barraDeCota"]);

  ok("abaixo de 70% não tem faixa", faixaDaCota(69), 0);
  ok("70% cai na faixa de 70", faixaDaCota(70), 70);
  ok("84% ainda é a faixa de 70", faixaDaCota(84), 70);
  ok("85% sobe para a faixa de 85", faixaDaCota(85), 85);
  ok("100% é a faixa de 95", faixaDaCota(100), 95);

  ok("primeiro cruzamento avisa", precisaAvisar(72, 0), 70);
  ok("a mesma faixa não avisa de novo", precisaAvisar(78, 70), 0);
  ok("subir de faixa avisa", precisaAvisar(86, 70), 85);
  ok("subir direto para a última avisa uma vez", precisaAvisar(96, 0), 95);
  ok("depois de avisar 95 nada mais avisa", precisaAvisar(99, 95), 0);

  /* A virada do mês. A primeira versão guardava Math.max(faixa, anterior) --
     parecia prudente e quebrava aqui: zerado o gasto, a faixa guardada
     continuaria em 95, e o 70%, o 85% e o 95% do mês seguinte passariam
     calados. Um alarme que dispara uma vez na vida. */
  ok("virado o mês, a faixa cai junto com o gasto", faixaDaCota(3), 0);
  ok("e o próximo 70% volta a avisar", precisaAvisar(71, faixaDaCota(3)), 70);

  /* A barra não pode estourar nem ficar torta: são 10 blocos, sempre. */
  for (const [usado, teto] of [[0, 100], [50, 100], [100, 100], [1200, 1000]]) {
    const linha = barraDeCota({ usado, teto }).split("\n")[0];
    const blocos = (linha.match(/[█░]/g) || []).length;
    ok(`barra de ${usado}/${teto} tem 10 blocos`, blocos, 10);
  }
  verdade("cota estourada não vira barra maior que o trilho",
    !/█{11}/.test(barraDeCota({ usado: 5000, teto: 1000 })));
}

/* ============== o cartão diário: as contas, sem o Discord ============== */
{
  const { somaDoDia, variacao, ontemISO } = carregar(["somaDoDia", "variacao", "ontemISO"]);

  ok("dia sem linha nenhuma soma zero", somaDoDia([]), { c: 0, t: 0, k: 0 });
  ok("linhas de motores diferentes somam juntas",
    somaDoDia([{ caracteres: 100, traducoes: 5, do_cache: 1 },
      { caracteres: 50, traducoes: 3, do_cache: 2 }]), { c: 150, t: 8, k: 3 });
  /* O banco devolve número em texto às vezes; somar texto daria "10050". */
  ok("número em texto ainda soma como número",
    somaDoDia([{ caracteres: "100", traducoes: "5" }, { caracteres: "50", traducoes: "3" }]),
    { c: 150, t: 8, k: 0 });
  ok("coluna faltando conta como zero", somaDoDia([{ caracteres: 10 }]), { c: 10, t: 0, k: 0 });

  /* Número sozinho não diz se está bom: "1.430 traduções" não alarma
     ninguém, "1.430, sete vezes ontem" sim. */
  verdade("dobrou: aponta para cima", /▲ \*\*100%\*\*/.test(variacao(200, 100)));
  verdade("caiu pela metade: aponta para baixo", /▼ \*\*50%\*\*/.test(variacao(50, 100)));
  ok("variação pequena não vira alarme", variacao(103, 100), " _(estável)_");
  /* Dividir por zero daria Infinity% no cartão. */
  ok("sem dia anterior não inventa porcentagem", variacao(500, 0), " _(primeiro dia com dado)_");
  ok("zero e zero não diz nada", variacao(0, 0), "");
  verdade("dia que zerou é queda de 100%", /▼ \*\*100%\*\*/.test(variacao(0, 900)));

  /* O cartão resume o dia que ACABOU: o de hoje muda toda hora e não dá para
     comparar com o de ontem. */
  verdade("ontem tem forma de data", /^\d{4}-\d{2}-\d{2}$/.test(ontemISO()));
  verdade("e é mesmo antes de hoje", ontemISO() < new Date().toISOString().slice(0, 10));
}

/* ========= o comando que roda sozinho: o ritmo e a hora de rodar =========

   Duas contas que erram caladas. `todos 5` num comando que fala com site de
   terceiro são 288 chamadas por dia, e ninguém descobre pelo Discord —
   descobre quando o site bloqueia. E do outro lado, um cartão fixado que
   deixou de se atualizar não avisa; ele só fica velho parecendo atual. */
{
  const { lerQuemPode, estaNaHora } =
    carregar(["MINIMO_DO_RITMO", "lerQuemPode", "estaNaHora"]);

  ok("só quem pode, sem repetir", lerQuemPode("todos"), { quem: "todos", cada: null, erroDoRitmo: null });
  ok("vazio cai em dono", lerQuemPode(""), { quem: "dono", cada: null, erroDoRitmo: null });
  /* Papel desconhecido cai no mais fechado, e o resto da linha vai junto.
     Antes isto respondia "não entendi `um` como minutos" — culpando a metade
     errada da frase e mandando consertar o que não estava quebrado. */
  ok("palavra desconhecida cai em dono, não libera geral",
    lerQuemPode("qualquer um"), { quem: "dono", cada: null, erroDoRitmo: null });
  /* E quem escreve só o número quis o ritmo, não um papel. */
  ok("só o número vira ritmo", lerQuemPode("60"), { quem: "dono", cada: 60, erroDoRitmo: null });
  verdade("só um número rápido demais ainda é recusado", !!lerQuemPode("5").erroDoRitmo);
  ok("quem pode mais ritmo", lerQuemPode("todos 60"), { quem: "todos", cada: 60, erroDoRitmo: null });
  ok("espaço sobrando não atrapalha", lerQuemPode("  admin   30 "), { quem: "admin", cada: 30, erroDoRitmo: null });
  ok("o mínimo passa", lerQuemPode("todos 10").cada, 10);

  /* Recusar em voz alta, não arredondar: arredondar faria a pessoa achar que
     pediu 5 e recebeu 5. */
  ok("rápido demais não vira ritmo", lerQuemPode("todos 5").cada, null);
  verdade("e diz por quê", /mínimo é 10/.test(lerQuemPode("todos 5").erroDoRitmo));
  verdade("zero é recusado, não vira 'nunca'", !!lerQuemPode("todos 0").erroDoRitmo);
  verdade("texto no lugar do número é recusado", !!lerQuemPode("todos sempre").erroDoRitmo);
  /* Mesmo recusando o ritmo, quem pode continua lido — a mensagem de erro
     precisa sugerir o nome certo. */
  ok("o quem pode sobrevive ao erro do ritmo", lerQuemPode("admin 2").quem, "admin");

  /* E a hora de rodar. */
  const agora = 1_700_000_000_000;
  const min = (n) => new Date(agora - n * 60 * 1000).toISOString();

  verdade("sem ritmo nunca roda sozinho",
    !estaNaHora({ canal_id: "c", ultima_vez: min(999) }, agora));
  verdade("com ritmo mas sem canal não roda — não invento onde publicar",
    !estaNaHora({ cada_minutos: 60, ultima_vez: min(999) }, agora));
  verdade("nunca rodou: roda agora",
    estaNaHora({ cada_minutos: 60, canal_id: "c" }, agora));
  verdade("passou o tempo: roda",
    estaNaHora({ cada_minutos: 60, canal_id: "c", ultima_vez: min(61) }, agora));
  verdade("ainda não deu a hora: espera",
    !estaNaHora({ cada_minutos: 60, canal_id: "c", ultima_vez: min(59) }, agora));
  verdade("no minuto exato já vale",
    estaNaHora({ cada_minutos: 60, canal_id: "c", ultima_vez: min(60) }, agora));
  /* Data podre no banco não pode travar o comando para sempre. */
  verdade("data que não dá para ler: roda em vez de congelar",
    estaNaHora({ cada_minutos: 60, canal_id: "c", ultima_vez: "ontem de tarde" }, agora));
  verdade("ritmo em texto não conta como ritmo",
    !estaNaHora({ cada_minutos: "sempre", canal_id: "c" }, agora));
}

/* ====== o código dividido em duas caixas do formulário ======

   O Discord dá cinco linhas por formulário e 4000 caracteres por caixa, e o
   primeiro comando com botão deu 4866. Estourar aqui é o pior jeito de
   recusar: a caixa não avisa, ela só para de aceitar letra, e a pessoa salva
   o código cortado no meio sem perceber.

   A ida e volta tem que devolver o original EXATO — é código, e um `\n` a
   mais é uma linha em branco hoje e uma template string quebrada amanhã. */
{
  const { pedacosDoCodigo, juntarCodigo, CAIXA_DE_CODIGO } =
    carregar(["CAIXA_DE_CODIGO", "pedacosDoCodigo", "juntarCodigo"]);

  const voltaIgual = (t) => {
    const p = pedacosDoCodigo(t);
    return p.coube && juntarCodigo(p.um, p.dois) === t;
  };

  ok("código pequeno cabe todo na primeira caixa",
    pedacosDoCodigo("const a = 1;"), { um: "const a = 1;", dois: "", coube: true });
  verdade("e a volta é idêntica", voltaIgual("const a = 1;"));
  ok("vazio não inventa nada", pedacosDoCodigo(""), { um: "", dois: "", coube: true });

  /* Um arquivo de verdade, com linhas de tamanhos variados. */
  const grande = Array.from({ length: 150 },
    (_, i) => `const linha${i} = ${JSON.stringify("x".repeat(i % 30))};`).join("\n");
  verdade("o exemplo passa de uma caixa e cabe em duas",
    grande.length > CAIXA_DE_CODIGO && grande.length <= 2 * CAIXA_DE_CODIGO);
  const p = pedacosDoCodigo(grande);
  verdade("a primeira caixa cabe no limite do Discord", p.um.length <= CAIXA_DE_CODIGO);
  verdade("a segunda também", p.dois.length <= CAIXA_DE_CODIGO);
  verdade("ida e volta devolve o original exato", voltaIgual(grande));
  /* Cortar por contagem crua partiria uma linha ao meio, e o `\n` que a junção
     repõe cairia dentro dela — linha em branco num texto, string literal
     partida ao meio em código. */
  verdade("o corte cai em fim de linha, não no meio de uma",
    !p.um.endsWith("\n") && p.um.split("\n").pop().endsWith(";"));
  verdade("a continuação começa em linha inteira", p.dois.startsWith("const linha"));

  /* Código minificado: uma linha só, maior que a caixa. Não dá para cortar sem
     mentir, então ele DIZ que não coube em vez de devolver dois pedaços que
     não remontam. Quem chama decide; o formulário abre vazio e preserva. */
  const minificado = "a".repeat(CAIXA_DE_CODIGO + 500);
  ok("linha única gigante não é cortada às escondidas",
    pedacosDoCodigo(minificado), { um: "", dois: "", coube: false });
  /* E o que nem em duas caixas cabe também é recusado. */
  ok("maior que as duas caixas juntas também não coube",
    pedacosDoCodigo(("linha\n").repeat(2000)).coube, false);

  /* Linhas em branco de propósito no fim de um trecho não podem sumir. */
  const comBranco = "linha1\n\n\nlinha2";
  verdade("linhas em branco sobrevivem", voltaIgual(comBranco));
  ok("segunda caixa vazia não acrescenta quebra", juntarCodigo("abc", ""), "abc");
  ok("segunda caixa junta com uma quebra só", juntarCodigo("abc", "def"), "abc\ndef");
}

/* ====== a lista de comandos leva a algum lugar ======

   Ela só mostrava. O único jeito de editar era clicar em "Novo comando" e
   digitar o mesmo nome de cabeça — e quem não sabia disso clicava na lista,
   lia, e saía achando que tinha editado. Eu inclusive: mandei o dono "abrir o
   reino na lista", e a lista não abre nada. */
{
  const { listaDeComandos, MAX_NO_MENU } =
    carregar(["MAX_NO_MENU", "embedDosComandos", "listaDeComandos"]);

  const comLista = async (quantos) => {
    const meus = Array.from({ length: quantos }, (_, i) => ({
      nome: `cmd${i}`, descricao: `descrição ${i}`, ativo: true, quem_pode: "dono",
    }));
    globalThis.sb = async () => meus;
    globalThis.comandosDoDono = async () => meus;
    globalThis.quandoFoi = () => "há pouco";
    return listaDeComandos("g1");
  };

  {
    const { componentes } = await comLista(0);
    ok("sem comando nenhum, nenhum menu", componentes, []);
  }
  {
    const { componentes } = await comLista(3);
    const menu = componentes[0].components[0];
    ok("o menu aponta pro tratador certo", menu.custom_id, "admin:abrircomando");
    ok("com um item por comando", menu.options.length, 3);
    ok("e o valor é o nome, que é como o comando é achado", menu.options[0].value, "cmd0");
    ok("o rótulo mostra a barra", menu.options[0].label, "/cmd0");
  }
  /* 25 é o teto do Discord por menu: passar disso faz o Discord recusar o
     componente inteiro, e a lista voltaria a não levar a lugar nenhum. */
  {
    const { embed, componentes } = await comLista(30);
    ok("o menu para no teto do Discord", componentes[0].components[0].options.length, MAX_NO_MENU);
    verdade("e o rodapé conta quantos ficaram de fora", /5 não cabem/.test(embed.footer.text));
  }
}

/* ========== desenho feito de texto não se traduz ==========

   Um mapa de batalha em ASCII chegou no canal árabe com as pontas trocadas e
   as linhas soltas. Duas coisas o quebram ao mesmo tempo: as palavras mudam
   de tamanho, então as barras deixam de encontrar o que apontavam; e numa
   língua escrita da direita para a esquerda o Discord vira o bloco inteiro,
   porque quem manda na direção do parágrafo é a primeira letra forte dele.

   Sem traduzir, ele chega igualzinho ao original. */
{
  const { pareceDesenho, vantajosoTraduzir } =
    carregar(["RISCO_DE_DESENHO", "UNIVERSAIS", "pareceDesenho", "porQueNaoTraduzir", "vantajosoTraduzir"]);

  const mapa = [
    "(Message) .",
    "                north",
    "        God /       \\  TRG/HGR",
    "     ASD  /            \\",
    "   West /    castle     \\ east",
    "        \\              /",
    "   Top/Nkr \\        /  War/FZA",
    "              south",
  ].join("\n");

  verdade("o mapa do castelo é desenho", pareceDesenho(mapa));
  verdade("e por isso não é traduzido", !vantajosoTraduzir(mapa, 3500, 2));

  /* Cada exigência sozinha dá falso positivo — é por isso que são três. */
  for (const [nome, t] of [
    ["bom dia", "Good morning"],
    ["frase comprida", "POSITIONS it will be easy to teleport at there designated places"],
    ["prosa de três linhas", "vamos no urso as 20h\nquem for avisa aqui\nlevem tropa cheia"],
    ["lista numerada", "1. Champagne fair\n2. Working overtime\n3. Alliance mobilization"],
    ["lista com traços", "- urso as 20h\n- rally as 21h\n- castelo as 22h"],
    ["duas linhas alinhadas", "a    b\nc    d"],
    ["espaço duplo solto", "vou   agora"],
  ]) {
    verdade(`${nome} não é desenho`, !pareceDesenho(t));
  }

  /* Uma tabela de horários também quebra ao traduzir, e cai na mesma regra. */
  verdade("tabela de espaços conta como desenho",
    pareceDesenho("urso     20:00  |  norte\nrally    21:00  |  sul\ncastelo  22:00  |  leste"));
}

/* ========== de qual idioma a fala veio ==========

   Bandeira e não palavra: o rodapé é a única parte do cartão que o bot
   escreve. Um "traduzido do inglês" sairia em português na sala árabe, ou
   custaria uma chamada de tradutor por mensagem só para o rodapé.

   E a SETA é o recado, não a bandeira: ela só aparece quando houve tradução
   de verdade. Sem seta, o que está ali é o original — que foi exatamente o
   caso que confundiu todo mundo quando um aviso passou do teto e chegou em
   inglês na sala árabe com cara de coisa traduzida. */
{
  const { seloDeOrigem, bandeiraDoIdioma } =
    carregar(["LINGUAS_MENU", "bandeiraDoIdioma", "seloDeOrigem"]);

  ok("a bandeira sai do menu de idiomas", bandeiraDoIdioma("en"), "🇬🇧");
  ok("idioma que eu não conheço não tem bandeira", bandeiraDoIdioma("xx"), "");

  ok("traduzido mostra de onde veio e para onde foi",
    seloDeOrigem("en", "ar", true), "🇬🇧 → 🇸🇦");
  ok("não traduzido mostra só a origem — sem seta",
    seloDeOrigem("en", "ar", false), "🇬🇧");

  /* Bandeira errada é pior que bandeira nenhuma: dizer "veio do inglês" sobre
     uma fala que veio de outro lugar engana com ar de precisão. */
  ok("origem desconhecida não ganha selo", seloDeOrigem("xx", "ar", true), "");
  ok("destino desconhecido mantém a origem", seloDeOrigem("en", "xx", true), "🇬🇧");
}

/* ====== o nome da língua na própria língua ======

   A lista de idiomas estava escrita só em português. Ela é, de todas as telas
   do bot, a que MENOS pode estar: é a primeira coisa que alguém que não fala
   português vê, e é ela que decide em que língua tudo o mais vai chegar. Uma
   alemã procurando "Deutsch" numa lista que diz "Alemão" só se salva se
   reconhecer a bandeira -- e se errar a bandeira, escolhe a língua errada e
   conclui que o bot não funciona. Foi assim que se perdeu uma hora.

   Nome próprio não passa por tradutor: é texto fixo, escrito uma vez. */
{
  const { LINGUAS_MENU, nomeNaPropriaLingua, menuIdioma } =
    carregar(["LINGUAS_MENU", "nomeNaPropriaLingua", "menuIdioma"]);

  for (const [cod, emPortugues, bandeira, proprio] of LINGUAS_MENU) {
    verdade(`${cod} tem nome na própria língua`, typeof proprio === "string" && proprio.length > 0);
    verdade(`o nome próprio de ${cod} não é o rótulo em português repetido por engano`,
      cod === "pt" || cod === "it" || cod === "tl" || proprio !== emPortugues);
    verdade(`${cod} continua com bandeira`, /\p{Regional_Indicator}/u.test(bandeira));
  }

  ok("o alemão lê Deutsch", nomeNaPropriaLingua("de"), "🇩🇪 Deutsch");
  ok("e o árabe lê no alfabeto dele", nomeNaPropriaLingua("ar"), "🇸🇦 العربية");
  ok("português não muda", nomeNaPropriaLingua("pt"), "🇧🇷 Português");
  ok("idioma que eu não conheço volta como veio", nomeNaPropriaLingua("xx"), "xx");

  /* ---- o menu de escolha mostra os dois nomes ---- */
  const opcoes = menuIdioma()[0].components[0].options.map((o) => o.data ?? o);
  ok("todas as línguas estão no menu", opcoes.length, LINGUAS_MENU.length);
  for (const o of opcoes) {
    const [, emPortugues, , proprio] = LINGUAS_MENU.find(([c]) => c === o.value);
    verdade(`"${o.label}" traz o nome próprio`, o.label.includes(proprio));
    verdade(`"${o.label}" traz o nome em português também`, o.label.includes(emPortugues));
    /* Cem é o teto do Discord para rótulo de opção. */
    verdade(`"${o.label}" cabe no menu`, o.label.length <= 100);
    /* "Português · Português" seria o bot gaguejando. */
    verdade(`"${o.label}" não se repete`, !/^(.+) · \1$/.test(o.label));
  }
}

/* ====== contar linha sem trazer linha ======

   O cartão de ontem disse "1000 cópias entregues" e era mil redondo demais:
   não era o número, era o TETO do PostgREST, que devolve no máximo mil linhas
   por consulta. Tinham sido 1.777.

   Erro que mente sempre para baixo: no dia em que o movimento dobrar o cartão
   continua dizendo mil, e a leitura vira "estamos estáveis" justamente quando
   não estamos. */
{
  const { totalDaFaixa } = carregar(["totalDaFaixa"]);

  ok("o total vem depois da barra", totalDaFaixa("0-0/1777"), 1777);
  ok("faixa de tabela vazia", totalDaFaixa("*/0"), 0);
  /* Sem `Prefer: count=exact` o Postgrest devolve `*` no lugar do total — e
     `Number("*")` é NaN, que num embed apareceria como "NaN cópias". */
  ok("total desconhecido não vira NaN", totalDaFaixa("0-0/*"), null);
  ok("cabeçalho ausente não vira NaN", totalDaFaixa(null), null);
  ok("cabeçalho estranho não vira NaN", totalDaFaixa("sei lá"), null);
}

/* ====== as janelas cabem nos limites do Discord ======

   O formulário de comando abria com um exemplo de 109 caracteres, e o teto é
   100. A janelaValida cortava e mandava um cartão para o canal de erros — um
   erro por abertura, sobre o meu próprio texto, ao lado dos erros de verdade.

   Este teste confere as janelas ANTES da janelaValida: ela é a rede, não a
   regra. Texto meu que precisa ser cortado é texto meu escrito errado. */
{
  const { janelaDeComando, janelaDeBusca, janelaDeCodigos } =
    carregar(["CAIXA_DE_CODIGO", "pedacosDoCodigo", "janelaDeComando", "janelaDeBusca", "janelaDeCodigos"]);

  const confere = (j, nome) => {
    verdade(`${nome}: título até 45`, String(j.title || "").length <= 45);
    verdade(`${nome}: até 5 linhas`, (j.components || []).length <= 5);
    for (const linha of j.components || []) {
      for (const c of linha.components || []) {
        verdade(`${nome}: rótulo de "${c.custom_id}" até 45`, String(c.label || "").length <= 45);
        verdade(`${nome}: exemplo de "${c.custom_id}" até 100`,
          String(c.placeholder || "").length <= 100);
      }
    }
  };

  confere(await janelaDeComando(null), "novo comando");
  confere(janelaDeBusca(), "busca");
  confere(janelaDeCodigos(), "códigos");

  /* E a janela de um comando que já existe, que é a que abre preenchida. */
  confere(await janelaDeComando({
    nome: "reino", descricao: "ranking do reino", quem_pode: "todos",
    cada_minutos: 60, codigo: "return 1;",
  }), "editar comando");
}

/* ====== contar o que NÃO foi traduzido ======

   Era um booleano, e o booleano escondia a diferença que importa: "não vale a
   pena" cobria tanto o "ok" de duas letras — economia funcionando — quanto o
   aviso de 4000 caracteres — o produto falhando. Do lado de fora os dois
   sumiam igual, e foi assim que um teto baixo demais passou dias mandando
   aviso de aliança sem traduzir, sem deixar rastro em lugar nenhum. */
{
  const { porQueNaoTraduzir, somaDoDia, MOTIVOS_QUE_DOEM } =
    carregar(["RISCO_DE_DESENHO", "UNIVERSAIS", "pareceDesenho",
      "MOTIVOS_QUE_DOEM", "porQueNaoTraduzir", "somaDoDia"]);

  ok("fala normal é traduzida", porQueNaoTraduzir("vamos no urso hoje as 20h", 3500, 2), null);
  ok("acima do teto tem nome próprio", porQueNaoTraduzir("x".repeat(3501), 3500, 2), "tamanho");
  ok("curto demais é economia, não falha", porQueNaoTraduzir("ok", 3500, 2), "curto");
  ok("emoji sozinho é economia", porQueNaoTraduzir("😅😅", 3500, 2), "curto");
  ok("link sozinho é economia", porQueNaoTraduzir("https://x.com/a", 3500, 2), "curto");
  ok("desenho tem nome próprio",
    porQueNaoTraduzir("a  /  b\nc  \\  d\n  e  |  f", 3500, 2), "desenho");

  /* Só três viram número. "curto" é a maior parte do movimento; contá-lo
     afogaria os dois que importam. */
  verdade("tamanho conta", MOTIVOS_QUE_DOEM.has("tamanho"));
  verdade("desenho conta", MOTIVOS_QUE_DOEM.has("desenho"));
  verdade("recusa do tradutor conta", MOTIVOS_QUE_DOEM.has("recusa"));
  verdade("curto NÃO conta", !MOTIVOS_QUE_DOEM.has("curto"));

  /* As linhas `sem:*` moram na mesma tabela e no mesmo campo. Somar junto
     faria o cartão dizer que traduziu justamente o que não traduziu. */
  const linhas = [
    { motor: "dono-deepl", caracteres: 1000, traducoes: 20, do_cache: 2 },
    { motor: "sem:tamanho", caracteres: 0, traducoes: 7, do_cache: 0 },
    { motor: "sem:recusa", caracteres: 0, traducoes: 3, do_cache: 0 },
  ];
  ok("a soma do dia ignora o que não foi traduzido",
    somaDoDia(linhas), { c: 1000, t: 20, k: 2 });
}

/* ====== um servidor não pode esvaziar a chave dos outros ======

   Este é o buraco que não derruba o bot: derruba os vizinhos. As chaves do
   dono são UMA bolsa para todos os inquilinos — 3 milhões por mês, uns 100 mil
   por dia. O servidor mais movimentado gastou 92 mil num único dia. Sem teto,
   ele sozinho esvazia a bolsa antes do almoço e todos os outros passam o resto
   do mês no Google gratuito, que a esse volume devolve 429.

   Estourar o teto não corta a tradução: corta o acesso à chave do dono. */
{
  const { cotaDoDonoNoDia, jaGastouHoje, somarGasto, estourouACota, gastoDoDia } =
    carregar(["PLANOS", "gastoDoDia", "cotaDoDonoNoDia", "jaGastouHoje", "somarGasto", "estourouACota"]);

  globalThis.planoDe = (s) => s.plano;
  globalThis.hojeISO = () => "2026-08-30";

  ok("servidor pago tem a cota maior", cotaDoDonoNoDia({ plano: "pago" }), 40000);
  ok("servidor grátis tem a menor", cotaDoDonoNoDia({ plano: "gratis" }), 8000);
  /* Plano desconhecido cai no menor, não no maior: errar para o lado que
     protege a bolsa. */
  ok("plano estranho cai no mais apertado", cotaDoDonoNoDia({ plano: "sei lá" }), 8000);

  /* Sem servidor identificado não há teto: é o caminho do tradutor por tópico
     e dos testes, e travar ali seria travar o que não gasta a bolsa. */
  globalThis.sb = async () => [];
  verdade("sem servidor não há teto", !(await estourouACota(null, 40000)));
  verdade("sem cota configurada não há teto", !(await estourouACota("s1", 0)));

  gastoDoDia.clear();
  verdade("servidor novo começa livre", !(await estourouACota("s1", 40000)));
  somarGasto("s1", 39999);
  verdade("um caractere antes do teto ainda passa", !(await estourouACota("s1", 40000)));
  somarGasto("s1", 1);
  verdade("no teto, para", await estourouACota("s1", 40000));
  /* O vizinho não é afetado. É o ponto inteiro do recurso. */
  verdade("e o servidor do lado continua livre", !(await estourouACota("s2", 40000)));

  /* Reiniciar no meio da tarde não pode dar uma segunda cota ao mesmo
     servidor: o gasto do dia é lido do banco na primeira vez. */
  gastoDoDia.clear();
  globalThis.sb = async () => [
    { motor: "dono-azure", caracteres: 30000 },
    { motor: "dono-deepl", caracteres: 5000 },
    { motor: "auto", caracteres: 90000 },
  ];
  ok("ao subir, conta só o que saiu das minhas chaves", await jaGastouHoje("s3"), 35000);
  verdade("e o teto continua valendo depois do reinício", await estourouACota("s3", 35000));

  /* Banco fora do ar não pode calar o bot: teto frouxo é melhor que bot mudo. */
  gastoDoDia.clear();
  globalThis.sb = async () => { throw new Error("banco fora"); };
  ok("sem banco, começa do zero em vez de travar", await jaGastouHoje("s4"), 0);
}

/* ================= onde o grátis acaba e o pago começa =================

   A linha entre os planos deixou de ser uma escada de números e virou uma
   linha de função: o grátis LÊ na sua língua quando quiser, o pago VIVE em
   todas as línguas. Estes testes existem porque essa mudança tem um jeito
   silencioso de dar muito errado -- tirar o espelho de quem já o tem. */
{
  const { PLANOS, limitesDo } = carregar(["PLANOS", "venceEm", "planoDe", "limitesDo"]);
  globalThis.BETA = false;
  globalThis.BETA_ATE = null;

  ok("o grátis não constrói idioma nenhum", PLANOS.gratis.idiomas, 0);
  ok("nem aceita canal-fonte", PLANOS.gratis.fontes, 0);
  ok("o pago constrói", PLANOS.pago.idiomas, 20);

  /* O teto de canais NÃO é zero, e isso não é descuido.

     Com zero, o orçamento de cada passada nasceria vazio e nem a manutenção
     do que já existe aconteceria -- o servidor grátis que já montou veria
     suas salas pararem de ser cuidadas. */
  verdade("o grátis mantém orçamento de canais para cuidar do que já tem",
    PLANOS.gratis.canais > 0);

  ok("servidor grátis: sem idioma, sem fonte", limitesDo({ plano: "gratis" }),
    { idiomas: 0, canais: 20, fontes: 0 });
  ok("servidor pago: o espelho inteiro", limitesDo({ plano: "pago" }),
    { idiomas: 20, canais: 200, fontes: 10 });

  /* A porta de saída: a coluna de exceção por servidor já existia, e é ela
     que segura quem montou antes desta regra. Sem isto eu teria inventado uma
     coluna nova para um problema que já tinha solução. */
  ok("um servidor pode ser mantido no que tinha, sem virar pago",
    limitesDo({ plano: "gratis", limite_idiomas: 3 }).idiomas, 3);

  /* Teste de sete dias e liberação na mão continuam valendo como pago -- eles
     são o caminho pelo qual um cliente EXPERIMENTA o espelho. */
  const amanha = new Date(Date.now() + 86400000).toISOString();
  ok("quem está em teste enxerga o espelho", limitesDo({ plano: "gratis", teste_ate: amanha }).idiomas, 20);
  ok("e quem pagou também", limitesDo({ plano: "gratis", pago_ate: amanha }).idiomas, 20);
  ok("teste vencido volta ao grátis",
    limitesDo({ plano: "gratis", teste_ate: "2020-01-01T00:00:00Z" }).idiomas, 0);
}

/* ================= a conversa do privado =================

   Quatro telas que se substituem no mesmo cartão, com o estado no custom_id.
   Duas coisas quebram isso em silêncio, e são as que estes testes olham: um
   custom_id fora do prefixo (o roteador nunca vê o clique, e o botão parece
   morto) e um texto acima do limite do Discord (a mensagem inteira é recusada,
   e a conversa trava sem dizer por quê). */
{
  globalThis.client = { user: { id: "1498142929041096856" } };
  const {
    PASSO, TEMAS, menuDeTemas, botoesDaPergunta, botoesDeConvite, botoesDosPlanos,
    paginaDeApresentacao, paginaDosPlanos, telaDoIdioma, traduzirLinha,
    podeApresentar, marcarApresentado, APRESENTEI,
  } = carregar([
    "COR", "COR_OK", "PERMISSOES_DO_CONVITE", "SITE_DO_CYRON", "linkDeConvite", "LINGUAS_MENU", "menuIdioma",
    "PASSO", "TEMAS", "menuDeTemas", "botoesDaPergunta", "botoesDeConvite", "botoesDosPlanos",
    "paginaDeApresentacao", "precoDoPlano", "paginaDosPlanos", "telaDoIdioma", "traduzirLinha",
    "APRESENTEI", "ESPERA_APRESENTACAO", "podeApresentar", "marcarApresentado",
  ]);

  /* O roteador desvia por `startsWith("dm:")`. Um passo fora do prefixo vira
     um botão que não faz nada, e nada no log conta isso. */
  for (const [nome, id] of Object.entries(PASSO)) {
    verdade(`o passo "${nome}" cai no roteador do privado`, id.startsWith("dm:"));
  }

  /* ---- limites do Discord, tela por tela ---- */
  const embedCabe = (nome, e) => {
    verdade(`${nome}: o título cabe`, (e.title || "").length <= 256);
    verdade(`${nome}: a descrição cabe`, (e.description || "").length <= 4096);
    for (const f of e.fields || []) {
      verdade(`${nome}: o campo "${f.name}" cabe`, f.value.length <= 1024);
      verdade(`${nome}: o nome do campo "${f.name}" cabe`, f.name.length <= 256);
    }
    verdade(`${nome}: o rodapé cabe`, (e.footer?.text || "").length <= 2048);
  };
  embedCabe("apresentação", paginaDeApresentacao());
  embedCabe("planos", paginaDosPlanos("pt"));
  embedCabe("planos em inglês", paginaDosPlanos("en"));

  /* O preço acompanha a língua, e não só a palavra.

     "R$ 79/mês" não diz nada a um americano -- ele não sabe se é caro ou
     barato, e procurar a cotação é onde ele fecha a conversa. */
  verdade("em português o preço é em reais",
    paginaDosPlanos("pt").fields[1].name.includes("R$ 79"));
  verdade("em inglês o preço é em dólares",
    paginaDosPlanos("en").fields[1].name.includes("US$ 15"));
  verdade("em árabe também não é em reais",
    !paginaDosPlanos("ar").fields[1].name.includes("R$"));

  /* Texto meu passa por tradução automática, e ela devolveu "Nada is built on
     your server" -- o oposto do que a frase dizia. Começar por pronome
     indefinido é o que arma essa armadilha, então nenhuma frase minha começa
     assim. */
  const frases = [paginaDeApresentacao(), paginaDosPlanos("pt")]
    .flatMap((e) => [e.description, ...(e.fields || []).map((f) => f.value)])
    .flatMap((t) => String(t).split(/\n+/))
    .map((l) => l.replace(/^[_*\s]+/, "").trim())
    .filter(Boolean);
  const armadilhas = frases.filter((l) => /^(Nada|Ninguém|Nenhum|Tudo|Todos)\b/i.test(l));
  ok("nenhuma frase começa por pronome que o tradutor confunde com nome", armadilhas, []);
  embedCabe("idioma", telaDoIdioma().embeds[0]);
  for (const [k, t] of Object.entries(TEMAS)) embedCabe(`tema ${k}`, { title: t.titulo, description: t.texto });

  const linhaCabe = (nome, linha) => {
    ok(`${nome} é uma linha de ação`, linha.type, 1);
    verdade(`${nome} cabe em 5 componentes`, linha.components.length <= 5);
    for (const c of linha.components) {
      if (c.type === 2) {
        verdade(`${nome}: o rótulo "${c.label}" cabe`, c.label.length <= 80);
        /* Estilo 5 é botão de link: exige url e recusa custom_id. Os dois
           juntos derrubam a mensagem inteira. */
        if (c.style === 5) {
          verdade(`${nome}: "${c.label}" tem url`, /^https:\/\//.test(c.url || ""));
          verdade(`${nome}: "${c.label}" não tem custom_id`, c.custom_id === undefined);
        } else {
          verdade(`${nome}: "${c.label}" tem custom_id`, !!c.custom_id);
          verdade(`${nome}: "${c.label}" não tem url`, c.url === undefined);
        }
      }
      if (c.type === 3) {
        verdade(`${nome}: o texto do menu cabe`, (c.placeholder || "").length <= 150);
        verdade(`${nome}: o menu cabe em 25 opções`, c.options.length <= 25);
        for (const o of c.options) {
          verdade(`${nome}: a opção "${o.label}" cabe`, o.label.length <= 100);
        }
      }
    }
  };
  linhaCabe("a pergunta", botoesDaPergunta());
  linhaCabe("o convite", botoesDeConvite());
  linhaCabe("o menu de temas", menuDeTemas());
  for (const l of botoesDosPlanos()) linhaCabe("os planos", l);

  /* Opção do menu que não tem tema escrito devolveria uma tela vazia. */
  const semTema = menuDeTemas().components[0].options.filter((o) => !TEMAS[o.value]);
  ok("toda opção do menu tem uma resposta escrita", semTema, []);

  verdade("o convite carrega as permissões que eu preciso",
    botoesDeConvite().components[0].url.includes("permissions=327223209040"));

  /* ---- o passo a passo tem que estar na PRIMEIRA tela ----

     Ele existia só atrás de "Sim, quero" e de um tema do menu de ajuda: quem
     mandou "oi" e olhou o primeiro cartão não via a expressão em lugar nenhum
     e concluiu que não existia. Estes três testes prendem a superfície, que é
     onde o defeito estava -- o passo a passo em si já era testado inteiro. */
  const naPergunta = botoesDaPergunta().components
    .filter((c) => String(c.custom_id || "").startsWith(`${PASSO.passo}:`));
  ok("a primeira tela abre o passo a passo, e num botão só", naPergunta.length, 1);
  ok("e ele começa no passo 1", naPergunta[0].custom_id, `${PASSO.passo}:1`);
  verdade("a pergunta anuncia o passo a passo no texto, não só no botão",
    /passo a passo/i.test(paginaDeApresentacao().description));

  /* ---- a primeira tela é a do idioma, e ela é bilíngue ---- */
  const primeira = telaDoIdioma();
  verdade("a tela do idioma fala inglês também", /Pick your language/.test(primeira.embeds[0].description));
  verdade("e traz o menu dos 20 idiomas", primeira.components[0].components[0].options.length === LINGUAS_MENU.length);

  /* ---- rótulo de botão também é traduzido ---- */
  globalThis.traduzirComCache = async (t) => `<${t}>`;
  ok("em português, nada é traduzido", await traduzirLinha(botoesDaPergunta(), "pt"), botoesDaPergunta());

  const emArabe = await traduzirLinha(botoesDaPergunta(), "ar");
  ok("em outra língua, o rótulo vai junto", emArabe.components[0].label, "<Sim, quero>");
  ok("e o custom_id NÃO é traduzido", emArabe.components[0].custom_id, PASSO.sim);

  const menuArabe = await traduzirLinha(menuDeTemas(), "ar");
  ok("o texto do menu é traduzido", menuArabe.components[0].placeholder, "<No que eu posso ajudar?>");
  /* Pelo primeiro tema que existir, e não por um nome escrito aqui: a lista
     ganha temas com o tempo, e um teste preso à ordem quebra sem ter achado
     defeito nenhum -- foi o que aconteceu quando "instalar" entrou. */
  const primeiroTema = Object.keys(TEMAS)[0];
  ok("as opções também", menuArabe.components[0].options[0].label, `<${TEMAS[primeiroTema].rotulo}>`);
  ok("mas o valor da opção fica", menuArabe.components[0].options[0].value, primeiroTema);

  /* ---- o passo a passo ----

     Cinco cartões que se substituem, com a posição viajando no custom_id. O
     número vem de fora, então ele é a superfície que precisa aguentar
     qualquer coisa: um id adulterado ou um passo removido no futuro dariam
     `undefined.titulo`, e a conversa morreria com "Esta interação falhou". */
  const { PASSOS, passoValido, paginaDoPasso, botoesDoPasso, fotoDoPasso, TEMA_INSTALAR, SITE_DO_CYRON: site } =
    carregar(["SITE_DO_CYRON", "PASSOS", "passoValido", "paginaDoPasso", "botoesDoPasso", "fotoDoPasso", "TEMA_INSTALAR"]);

  ok("o primeiro passo é 1", passoValido(1), 1);
  ok("abaixo do primeiro volta para o primeiro", passoValido(0), 1);
  ok("muito abaixo também", passoValido(-99), 1);
  ok("acima do último para no último", passoValido(PASSOS.length + 1), PASSOS.length);
  ok("texto que não é número vira o primeiro", passoValido("abacaxi"), 1);
  ok("vazio também", passoValido(undefined), 1);
  ok("número em texto funciona, porque é assim que ele chega", passoValido("3"), 3);
  ok("quebrado vira inteiro", passoValido("2.7"), 2);

  for (let i = 1; i <= PASSOS.length; i++) {
    embedCabe(`passo ${i}`, paginaDoPasso(i));
    for (const l of botoesDoPasso(i)) linhaCabe(`passo ${i}`, l);
  }

  /* Botão desabilitado, e não botão ausente: sumindo, a linha muda de tamanho
     a cada passo e os outros dançam de lugar embaixo do dedo. */
  const primeiro = botoesDoPasso(1)[0].components;
  verdade("no primeiro passo, Anterior está desabilitado", primeiro[0].disabled === true);
  verdade("mas continua na tela", primeiro.length === 3);
  verdade("e Próximo está vivo", !primeiro[1].disabled);

  const ultimo = botoesDoPasso(PASSOS.length)[0].components;
  verdade("no último, Próximo está desabilitado", ultimo[1].disabled === true);
  verdade("e Anterior está vivo", !ultimo[0].disabled);

  /* ---- os desenhos ----

     "n tem nada la" foi sobre isto: passo a passo sem imagem nenhuma. Agora os
     cinco têm, e o que quebraria em silêncio é um desenho apontado para um
     arquivo que não existe -- o Discord simplesmente não desenha o cartão, sem
     erro, sem log, e o passo volta a ser só texto.

     Por isso o teste é no DISCO, e não na string: só assim ele acha o dia em
     que alguém renomear um png e esquecer daqui. */
  const IMG = new URL("../cyron/img/", import.meta.url);
  ok("todo passo tem desenho", PASSOS.filter((p) => p.foto).length, PASSOS.length);

  for (const p of PASSOS) {
    for (const idioma of ["pt", "en", "ar"]) {
      const url = fotoDoPasso(p.foto, idioma);
      verdade(`o desenho de "${p.titulo}" (${idioma}) vem do site`, url.startsWith(site));
      const arquivo = new URL(url.slice(site.length + "img/".length), IMG);
      verdade(`e o arquivo existe: ${url.split("/").pop()}`, existsSync(arquivo));
    }
  }

  /* Português para quem fala português, inglês para todo o resto: o texto
     dentro do desenho é pixel, e pixel não passa pelo tradutor. */
  ok("em árabe eu mostro o desenho em inglês",
    fotoDoPasso("passo-canais", "ar"), `${site}img/passo-canais-en.png`);
  ok("em português, o português",
    fotoDoPasso("passo-canais", "pt"), `${site}img/passo-canais.png`);
  ok("passo sem desenho não inventa endereço", fotoDoPasso(null, "pt"), null);

  /* O desenho entra no embed como imagem, e segue o idioma junto com o texto. */
  verdade("o cartão do passo 1 em português traz o desenho português",
    paginaDoPasso(1, "pt").image.url.endsWith("passo-autorizar.png"));
  verdade("e em turco traz o inglês",
    paginaDoPasso(1, "tr").image.url.endsWith("passo-autorizar-en.png"));

  verdade("o passo a passo tem entrada pelo menu de temas", !!TEMAS[TEMA_INSTALAR]);

  /* ---- a apresentação não se repete, mas só depois de acontecer ----

     Perguntar e marcar são duas coisas, e juntá-las custou uma conversa real:
     quem mandou "oi" e apagou a mensagem antes de eu responder ficou marcado
     como apresentado sem nunca ter visto o cartão, e calado por uma hora. */
  APRESENTEI.clear();
  verdade("a primeira mensagem pode ser apresentada", podeApresentar("u1"));
  verdade("perguntar não marca nada", podeApresentar("u1"));

  marcarApresentado("u1");
  verdade("depois de entregue, não repete", !podeApresentar("u1"));
  verdade("e outra pessoa continua livre", podeApresentar("u2"));

  /* Envio que falhou não marca — é isto que devolve o cartão a quem não o viu. */
  APRESENTEI.clear();
  const entregou = false;
  if (entregou) marcarApresentado("u3");
  verdade("falha no envio deixa a próxima mensagem tentar de novo", podeApresentar("u3"));
}

/* ================= a tradução por bandeira =================

   O recurso é puxado: só custa quando alguém toca. O que pode dar errado é
   ele NÃO reconhecer a bandeira que a pessoa usou -- e aí, do lado de fora, o
   bot simplesmente não responde. Silêncio é o pior defeito possível num botão,
   porque não deixa rastro nem no log nem na cara de quem clicou. */
{
  const { paisDaBandeira, idiomaDaBandeira, IDIOMA_DO_PAIS, LINGUAS_MENU } =
    carregar(["LINGUAS_MENU", "paisDaBandeira", "IDIOMA_DO_PAIS", "idiomaDaBandeira"]);

  ok("bandeira do Brasil é BR", paisDaBandeira("🇧🇷"), "BR");
  ok("bandeira do Japão é JP", paisDaBandeira("🇯🇵"), "JP");

  /* A esmagadora maioria das reações de um servidor cai aqui, e tem que sair
     barato e sem erro. */
  ok("joinha não é bandeira", paisDaBandeira("👍"), "");
  ok("letra solta não é bandeira", paisDaBandeira("🇧"), "");
  ok("vazio não é bandeira", paisDaBandeira(""), "");
  ok("nada não é bandeira", paisDaBandeira(undefined), "");
  /* Dois pontos de código, e nenhum deles é indicador regional: é exatamente
     a forma que a checagem de tamanho sozinha deixaria passar. */
  ok("bandeira branca não é país", paisDaBandeira("🏳️"), "");
  ok("emoji composto não é país", paisDaBandeira("👍🏽"), "");

  /* O ponto do recurso: a bandeira que a PESSOA tem, não a que o menu mostra. */
  ok("Estados Unidos lê em inglês", idiomaDaBandeira("🇺🇸"), "en");
  ok("México lê em espanhol", idiomaDaBandeira("🇲🇽"), "es");
  ok("Portugal lê em português", idiomaDaBandeira("🇵🇹"), "pt");
  ok("Emirados lê em árabe", idiomaDaBandeira("🇦🇪"), "ar");
  ok("Áustria lê em alemão", idiomaDaBandeira("🇦🇹"), "de");
  ok("Taiwan lê em chinês", idiomaDaBandeira("🇹🇼"), "zh-CN");

  /* País cujo idioma eu não atendo devolve vazio, e o evento morre ali sem
     custar tradução nenhuma. */
  ok("país sem idioma meu não vira nada", idiomaDaBandeira("🇰🇪"), "");
  ok("joinha não vira idioma", idiomaDaBandeira("👍"), "");

  /* Regressão que importa: se alguém trocar a bandeira de uma linha do menu,
     reagir com a bandeira que o próprio bot mostra pararia de funcionar. */
  for (const [cod, nome, bandeira] of LINGUAS_MENU) {
    ok(`a bandeira que o menu mostra para ${nome} volta como ${cod}`,
      idiomaDaBandeira(bandeira), cod);
  }

  /* E o contrário: um erro de digitação no mapa ("zh-cn", "pr") mandaria um
     código que o tradutor não conhece, e a pessoa receberia texto em branco. */
  const conhecidos = new Set(LINGUAS_MENU.map(([c]) => c));
  const forasteiros = [...new Set(Object.values(IDIOMA_DO_PAIS))].filter((c) => !conhecidos.has(c));
  ok("todo idioma do mapa de países existe no menu", forasteiros, []);
}

/* ============ a língua de quem nunca escolheu uma ============

   Uma jogadora alemã pediu a tradução de uma mensagem em inglês e recebeu
   INGLÊS de volta, porque quem nunca usou /mylanguage caía num "en" fixo. Ela
   entendeu que o bot dizia que inglês já estava em inglês, e desistiu depois
   de uma hora. O palpite passa a ser a língua em que a pessoa usa o Discord,
   que vem em toda interação. */
{
  const { idiomaDoAplicativo, LINGUAS_MENU } = carregar(["LINGUAS_MENU", "idiomaDoAplicativo"]);

  ok("alemão do cliente vira alemão", idiomaDoAplicativo("de"), "de");
  ok("pt-BR vira pt", idiomaDoAplicativo("pt-BR"), "pt");
  ok("en-US vira en", idiomaDoAplicativo("en-US"), "en");
  ok("en-GB também", idiomaDoAplicativo("en-GB"), "en");
  ok("es-419 vira es", idiomaDoAplicativo("es-419"), "es");
  /* zh-CN é código do meu menu: tem que passar inteiro, e não virar "zh". */
  ok("o chinês simplificado passa inteiro", idiomaDoAplicativo("zh-CN"), "zh-CN");
  ok("o tradicional cai no simplificado, que é o que eu tenho",
    idiomaDoAplicativo("zh-TW"), "zh-CN");

  /* Língua que eu não falo não pode virar um código que eu não sei traduzir:
     quem decide o padrão é quem chama, e ele usa "en". */
  ok("dinamarquês, que eu não falo, não vira idioma", idiomaDoAplicativo("da"), "");
  ok("sueco também não", idiomaDoAplicativo("sv-SE"), "");
  ok("vazio não vira nada", idiomaDoAplicativo(""), "");
  ok("nulo não quebra", idiomaDoAplicativo(null), "");
  ok("lixo não vira idioma", idiomaDoAplicativo("¿?"), "");

  /* Todo código do meu próprio menu tem que se reconhecer: se um dia entrar um
     idioma com código composto, este teste é quem avisa. */
  for (const [cod] of LINGUAS_MENU) {
    ok(`o menu fala ${cod}, então ${cod} se reconhece`, idiomaDoAplicativo(cod), cod);
  }
}

/* ---- "escolheu inglês" e "nunca escolheu" são coisas diferentes ----

   Estavam colapsadas num "en", e isso matou a primeira tela inteira: a
   conversa no privado abria com `idioma ? apresentação : perguntar`, e "en" é
   verdadeiro, então ela nunca chegava a perguntar. A pergunta existia no
   código e não existia na tela. */
{
  const { idiomaEscolhido, idiomaDoJogador } = carregar(["idiomaEscolhido", "idiomaDoJogador"]);

  let pedido = "";
  const responderBanco = (linhas) => { globalThis.sb = async (c) => { pedido = c; return linhas; }; };

  responderBanco([{ idioma: "de" }]);
  ok("quem escolheu alemão tem alemão escolhido", await idiomaEscolhido("u1"), "de");
  verdade("a busca é pelo id de quem perguntou", pedido.includes("u1"));

  responderBanco([]);
  ok("quem nunca escolheu não tem nada", await idiomaEscolhido("u2"), "");
  /* O ponto do conserto: vazio, e não "en". Se isto voltar a ser "en", a
     pergunta do idioma some da conversa outra vez, sem nada quebrar. */
  verdade("e vazio é falso, que é o que a primeira tela testa", !(await idiomaEscolhido("u2")));

  responderBanco([{ idioma: "" }]);
  ok("linha com idioma vazio também conta como nunca escolheu", await idiomaEscolhido("u3"), "");

  globalThis.sb = async () => { throw new Error("banco fora"); };
  ok("banco fora não inventa idioma", await idiomaEscolhido("u4"), "");

  /* Já o de palpite sempre devolve alguma coisa -- é para escrever nela. */
  responderBanco([]);
  ok("sem escolha, vale a língua do cliente", await idiomaDoJogador("u5", "de"), "de");
  ok("sem escolha e sem cliente, inglês", await idiomaDoJogador("u5", ""), "en");
  ok("cliente numa língua que eu não falo cai em inglês",
    await idiomaDoJogador("u5", "da"), "en");

  responderBanco([{ idioma: "ar" }]);
  ok("a escolha vence a língua do cliente", await idiomaDoJogador("u6", "de"), "ar");

  globalThis.sb = async () => { throw new Error("banco fora"); };
  ok("banco fora ainda respeita o cliente", await idiomaDoJogador("u7", "pt-BR"), "pt");
}

/* ============ o painel responde antes de ser lido ============

   Ele tinha até doze campos misturando como está indo, o que está quebrado e
   o que dá para comprar -- e um 🚨 aparecia depois das cotas. Quem abre o
   painel quer saber uma coisa antes de tudo: preciso fazer algo agora? */
{
  const { vereditoDoPainel } = carregar(["porMolde", "falaFixa", "vereditoDoPainel"]);

  const limpo = await vereditoDoPainel([], 2, 4);
  verdade("sem problema, o sinal é verde", limpo.startsWith("**🟢"));
  verdade("e diz o que está acontecendo, não só 'tudo certo'", /2 canais/.test(limpo));
  verdade("com o número de idiomas junto", /4 idiomas/.test(limpo));

  /* Singular escrito, e não "canal(is)": a barra e o parêntese são lixo que o
     leitor de tela também lê em voz alta. */
  const um = await vereditoDoPainel([], 1, 1);
  verdade("um canal é 'canal', não 'canais'", /1 canal\b/.test(um) && !/1 canais/.test(um));
  verdade("um idioma é 'idioma'", /1 idioma\b/.test(um) && !/1 idiomas/.test(um));
  for (const t of [limpo, um]) {
    verdade("nenhum plural com barra ou parêntese", !/\(s\)|\bs\/|canal\(/.test(t));
  }

  /* Servidor recém-instalado não é "tudo funcionando": nada quebrou, mas nada
     acontece, e quem lê "está tudo certo" fecha o painel achando que acabou. */
  const vazio = await vereditoDoPainel([], 0, 0);
  verdade("sem canal apontado, o veredito diz o que fazer", /menu/i.test(vazio));
  verdade("e não diz que está tudo funcionando", !/tudo funcionando/i.test(vazio));
  verdade("mas também não acusa problema", !vazio.startsWith("**🔴"));

  /* Com problema, o veredito conta QUANTOS -- "tem algo errado" não deixa
     saber se acabou depois de consertar um. */
  const um1 = await vereditoDoPainel([{ name: "🚨 Ninguém está recebendo o cargo do idioma" }], 2, 4);
  verdade("com problema, o sinal é vermelho", um1.startsWith("**🔴"));
  verdade("um problema é 'uma coisa'", /Uma coisa precisa de você/.test(um1));
  verdade("e o problema é nomeado", /Ninguém está recebendo o cargo/.test(um1));
  verdade("sem o emoji repetido na lista", !/• 🚨/.test(um1));

  const dois = await vereditoDoPainel(
    [{ name: "🚨 Um" }, { name: "⛔ Dois" }], 2, 4);
  verdade("dois problemas são 'coisas'", /2 coisas precisam de você/.test(dois));

  /* Mais de três não vira uma parede: os três primeiros e a contagem. */
  const muitos = await vereditoDoPainel(
    [1, 2, 3, 4, 5].map((n) => ({ name: `⚠️ Problema ${n}` })), 2, 4);
  verdade("cinco problemas contam cinco", /5 coisas precisam de você/.test(muitos));
  ok("mas só três aparecem na lista", (muitos.match(/• Problema/g) || []).length, 3);
  verdade("e o resto é contado", /e mais 2/.test(muitos));

  for (const t of [limpo, um, vazio, um1, dois, muitos]) {
    verdade("o veredito cabe na descrição do embed", t.length <= 4096);
  }
}

/* ============ o painel na língua de quem abriu ============

   Este painel é quase todo "1 de 10", "0.5k de 40k", "3 pessoas". Traduzir a
   frase JÁ MONTADA faria de cada valor uma chave de cache nova -- e o painel é
   redesenhado a cada varredura, em todo servidor. Seria uma tradução paga por
   varredura, para sempre, sem nada quebrar.

   O molde resolve isso e mais uma coisa: nome de cargo, menção de canal e nome
   de servidor viram marcador, então ficam fora do tradutor por construção em
   vez de por lembrança. */
{
  const { porMolde, falaFixa } = carregar(["porMolde", "falaFixa"]);
  globalThis.MOTOR_AUTO = { tipo: "teste" };

  /* ---- a substituição ---- */
  ok("o valor entra no lugar do marcador", porMolde("{0} de {1}", [1, 10]), "1 de 10");
  ok("o mesmo marcador serve duas vezes", porMolde("{0} e {0}", ["ok"]), "ok e ok");
  ok("zero não some", porMolde("{0} de {1}", [0, 40]), "0 de 40");
  /* Marcador sem valor fica como está, e não vira "undefined" na tela. */
  ok("marcador sem valor não vira undefined", porMolde("{0} e {1}", ["a"]), "a e {1}");
  ok("texto sem marcador passa inteiro", porMolde("nada aqui", [7]), "nada aqui");

  /* ---- português não paga para receber o mesmo texto ---- */
  let pedidos = [];
  globalThis.traduzirComCache = async (t) => { pedidos.push(t); return `<${t}>`; };

  const emCasa = falaFixa("");
  ok("sem idioma, nada vai ao tradutor",
    [await emCasa("Canais — {0} de {1}", 2, 10), pedidos.length].join("|"), "Canais — 2 de 10|0");
  pedidos = [];
  await falaFixa("pt")("Canais — {0} de {1}", 2, 10);
  ok("português também não", pedidos.length, 0);

  /* ---- O TESTE QUE IMPORTA: o que sobe é o molde, não a frase montada ---- */
  pedidos = [];
  const T = falaFixa("de");
  const dois = await T("Canais que eu traduzo — {0} de {1}", 2, 10);
  const nove = await T("Canais que eu traduzo — {0} de {1}", 9, 10);
  ok("o tradutor recebeu o molde, e não o texto com número",
    pedidos, ["Canais que eu traduzo — {0} de {1}", "Canais que eu traduzo — {0} de {1}"]);
  /* Tirando os marcadores, que têm dígito por definição: o que sobra é o texto
     que vai ao tradutor, e ELE não pode carregar número nenhum. */
  const semMarcador = (p) => p.replace(/\{\d+\}/g, "");
  verdade("fora os marcadores, nenhuma chave carrega número",
    pedidos.every((p) => !/\d/.test(semMarcador(p))));
  verdade("e mesmo assim cada resposta traz o seu número",
    /2 de 10/.test(dois) && /9 de 10/.test(nove));

  /* Nome de cargo é de UM servidor: como marcador ele nunca vira chave de
     cache, que é o que impediria o cache de servir a todos os outros. */
  pedidos = [];
  await T("Os cargos {0} estão acima do meu.", "**Admin**, **Mod da Aliança**");
  ok("nome de cargo não chega ao tradutor", pedidos, ["Os cargos {0} estão acima do meu."]);

  /* ---- marcador comido = frase volta ao original ----

     Acontece com tradutor de verdade. Em português e certa é melhor que
     traduzida e sem o número -- ou, pior, mostrando "{0}" na tela. */
  pedidos = [];
  globalThis.traduzirComCache = async () => "Kanäle die ich übersetze — von";  // comeu os dois
  const perdido = await falaFixa("de")("Canais que eu traduzo — {0} de {1}", 2, 10);
  ok("tradução que perdeu o marcador é descartada", perdido, "Canais que eu traduzo — 2 de 10");

  globalThis.traduzirComCache = async (t) => `<${t}>`;
  const meio = await falaFixa("de")("{0} de {1}", 2, 10);
  verdade("e um marcador só também não passa", /2 de 10/.test(meio));

  /* Texto sem letra nenhuma nem sai daqui -- mesma trava do traduzirEmbed. */
  pedidos = [];
  globalThis.traduzirComCache = async (t) => { pedidos.push(t); return `<${t}>`; };
  ok("símbolo puro não vai ao tradutor", await falaFixa("de")("{0} / {1}", 3, 5), "3 / 5");
  ok("e nem foi pedido", pedidos.length, 0);

  /* ---- o guarda estrutural: nada montado pode chegar ao T ----

     `await T(\`Canais — ${n}\`)` é a regressão natural deste desenho: continua
     compilando, continua desenhando certo, e devolve a conta por varredura.
     Molde é sempre string literal simples -- crase depois de T( é proibida. */
  const fontePainel = readFileSync(`${aqui}/index.js`, "utf8");
  const corpoDe = (nome, ate) => {
    const i = fontePainel.indexOf(nome);
    verdade(`achei ${nome} para conferir`, i > 0);
    return fontePainel.slice(i, fontePainel.indexOf(ate, i));
  };
  const painel = corpoDe("async function montarPainel", "async function cartaoDeConfig");
  const veredito = corpoDe("async function vereditoDoPainel", "\n/* ---------------- o recibo");
  for (const [onde, corpo] of [["o painel", painel], ["o veredito", veredito]]) {
    verdade(`em ${onde}, nenhum molde é template literal`, !/\bT\(\s*`/.test(corpo));
    verdade(`em ${onde}, nenhum molde carrega \${}`, !/\bT\([^)]*\$\{/.test(corpo));
  }
  /* O painel mostra idioma pelo nome próprio, como o placar e o menu. */
  verdade("os idiomas aparecem na própria língua", painel.includes("nomeNaPropriaLingua"));
  verdade("e não mais só em português", !/nomeDoIdioma\(i\.idioma\)/.test(painel));

  /* ---- o cartão fixado continua em português, e tem que continuar ----

     Ele é UMA mensagem para o servidor inteiro. Desenhá-lo na língua de quem
     mexeu por último traduziria o cartão de todos para a língua dessa pessoa. */
  const cartao = corpoDe("async function cartaoDeConfig", "\n/* Mudanca que deu certo");
  verdade("o cartão fixado é montado sem idioma",
    /montarPainel\(guild, servidor\)/.test(cartao));
  const refresca = corpoDe("async function refrescarPainel", "\n/* O menu manda");
  verdade("depois do clique, a língua sai da superfície e não de quem clicou",
    /noFixado \? "" :/.test(refresca));
}

/* ---- os botões dizem o que fazem ---- */
{
  const { componentesDoPainel } = carregar(["componentesDoPainel"]);
  /* Vive num `let` que só o carregamento dos ajustes preenche; aqui ele nunca
     roda, então o botão de assinar entra pelo mesmo caminho de um servidor
     sem link configurado. */
  globalThis.LINK_PAGAMENTO_VIVO = "https://pague.exemplo/x";
  const servidor = { id: "s1", plano: "gratis", tradutor_topico: true };
  const linhas = componentesDoPainel(servidor, [], { fontes: 10, idiomas: 20 }, [], []);
  const botoes = linhas.flatMap((l) => l.components).filter((c) => c.type === 2);
  const rotulos = botoes.map((b) => String(b.label || ""));

  /* Dois botões chamados "Tradutor" na mesma linha: um era o liga/desliga por
     mensagem, o outro o motor. Nenhum rótulo pode ser prefixo de outro -- é
     o que fazia os dois se confundirem. */
  for (const a of rotulos) {
    for (const b of rotulos) {
      if (a === b) continue;
      verdade(`"${a}" não é começo de "${b}"`, !b.startsWith(a));
    }
  }
  ok("nenhum rótulo se repete", new Set(rotulos).size, rotulos.length);
  for (const r of rotulos) verdade(`"${r}" cabe no botão`, r.length <= 80);
}

/* ---- a tradução por bandeira vem ligada, e sem precisar de nada ---- */
{
  const fonte = readFileSync(`${aqui}/index.js`, "utf8");
  /* `=== false` e não `=== true`: enquanto a coluna não existir no banco, a
     leitura devolve undefined, e undefined tem que LIGAR. Trocar por
     `!== true` desligaria o recurso em todo servidor de uma vez, em silêncio,
     e o painel continuaria dizendo "sempre ligada". */
  verdade("a bandeira só desliga com um false explícito",
    fonte.includes("servidor.tradutor_bandeira === false"));
  verdade("e não há nenhuma leitura que exija um true",
    !/tradutor_bandeira\s*===\s*true|!servidor\.tradutor_bandeira/.test(fonte));
}

/* ============ o recibo da semana ============

   Ele existe porque quanto melhor eu funciono, mais invisível eu fico -- e
   quem paga decide a renovação pelo que lembra. Nada aqui guarda contagem por
   pessoa: as traduções vêm do uso diário que o painel já lê, e os leitores
   são contados nos cargos, no Discord, na hora. */
{
  const { semanaDe, diaISO, semanasSeguidas, leitoresPorIdioma, botoesDoRecibo, reciboDaSemana,
          LINGUAS_MENU } =
    carregar(["LINGUAS_MENU", "SEMANA", "diaISO", "semanaDe", "traducoesEntre", "nomeDoIdioma", "bandeiraDoIdioma",
      "leitoresPorIdioma", "semanasSeguidas", "reciboDaSemana", "botoesDoRecibo"]);

  /* ---- a semana começa na segunda ---- */
  /* 2026-09-02 é uma quarta. A semana dela começa na segunda, dia 31/08. */
  ok("quarta cai na segunda anterior", semanaDe(Date.parse("2026-09-02T12:00:00Z")), "2026-08-31");
  ok("a própria segunda é o começo dela", semanaDe(Date.parse("2026-08-31T00:00:00Z")), "2026-08-31");
  /* Domingo é o FIM da semana, não o começo: recibo que chega no domingo
     falaria de uma semana que ainda não acabou. */
  ok("domingo ainda é da semana que passou", semanaDe(Date.parse("2026-09-06T23:59:00Z")), "2026-08-31");
  ok("segunda seguinte já é outra semana", semanaDe(Date.parse("2026-09-07T00:01:00Z")), "2026-09-07");
  verdade("a marca da semana é uma data e nada mais", /^\d{4}-\d{2}-\d{2}$/.test(semanaDe()));

  ok("diaISO corta a hora fora", diaISO(Date.parse("2026-09-02T23:45:00Z")), "2026-09-02");

  /* ---- o streak é do servidor, e para no primeiro buraco ---- */
  ok("três semanas seguidas", semanasSeguidas([5, 9, 2, 0, 7]), 3);
  ok("semana vazia agora zera", semanasSeguidas([0, 9, 2]), 0);
  ok("tudo cheio conta tudo", semanasSeguidas([1, 1, 1]), 3);
  ok("sem histórico, zero", semanasSeguidas([]), 0);
  /* Um buraco no meio não pode ser pulado: seria um streak que a pessoa não
     teve, e o número inteiro perderia o sentido. */
  ok("buraco no meio corta ali", semanasSeguidas([4, 0, 8, 8, 8]), 1);

  /* ---- os leitores vêm do cargo, não do banco ---- */
  const guild = {
    roles: { cache: new Map([
      ["r-pt", { members: { size: 12 } }],
      ["r-en", { members: { size: 9 } }],
      ["r-ar", { members: { size: 30 } }],
    ]) },
  };
  const salas = [
    { idioma: "pt", role_id: "r-pt" },
    { idioma: "en", role_id: "r-en" },
    { idioma: "ar", role_id: "r-ar" },
    /* Idioma cujo cargo foi apagado no Discord: some da conta, em vez de
       aparecer com zero e parecer que ninguém escolheu. */
    { idioma: "ja", role_id: "r-sumiu" },
    { idioma: "de", role_id: null },
  ];
  const leitores = leitoresPorIdioma(guild, salas);
  ok("só os idiomas com cargo vivo entram", leitores.length, 3);
  ok("e vêm do maior para o menor", leitores[0].idioma, "ar");
  ok("com a contagem do cargo", leitores[0].quantos, 30);
  verdade("cargo apagado não vira linha", !leitores.some((l) => l.idioma === "ja"));

  /* ---- o botão de publicar ---- */
  const linhas = botoesDoRecibo();
  ok("uma linha de botões", linhas.length, 1);
  verdade("cabe nos 5 componentes da linha", linhas[0].components.length <= 5);
  verdade("o rótulo cabe no botão", linhas[0].components[0].label.length <= 80);
  ok("um botão só", linhas[0].components.length, 1);
  verdade("e ele é de clique, não de link", linhas[0].components[0].custom_id === "cyron:publicar");

  /* ---- o cartão inteiro ---- */
  globalThis.client = { user: { id: "bot" } };
  const semanaAtual = semanaDe();
  /* Uma semana com 120 traduções, a anterior com 100, e as seis antes dela
     com movimento também: 8 semanas seguidas. */
  globalThis.sb = async (rota) => {
    if (rota.startsWith("discord_chat_espelho")) return salas;
    if (rota.startsWith("cyron_uso_diario")) {
      const de = /dia=gte\.([0-9-]+)/.exec(rota)?.[1];
      return [{ traducoes: de === diaISO(Date.parse(`${semanaAtual}T00:00:00Z`) - 7 * 864e5) ? 120 : 100 }];
    }
    return [];
  };
  const cartao = await reciboDaSemana(guild, { id: "s1" });

  verdade("o cartão sai", !!cartao);
  verdade("e diz quantas mensagens atravessaram", /120 mensagens atravessaram/.test(cartao.description));
  verdade("e quantos idiomas", /3 idiomas/.test(cartao.description));
  verdade("a variação aparece quando há com o que comparar", /\+20%/.test(cartao.description));
  verdade("o streak aparece", /semanas seguidas/.test(cartao.description));
  verdade("os leitores viram campo", /Quem lê em cada língua/.test(cartao.fields[0].name));
  /* O total sai como número solto, sem a palavra "pessoas": o campo é
     bilíngue e o número não tem língua. */
  verdade("com o total de gente", /— 51$/.test(cartao.fields[0].name));

  /* A bandeira sai UMA vez. nomeDoIdioma já devolve "🇧🇷 Português", e eu
     tinha posto outra na frente: "🇧🇷 🇧🇷 Português". Nenhum teste de texto ou
     de limite pegaria isso -- foi a prévia do cartão que mostrou, e este
     teste existe para a próxima vez em que não houver prévia. */
  for (const linha of cartao.fields[0].value.split("\n")) {
    const bandeiras = [...linha].filter((c) => {
      const n = c.codePointAt(0);
      return n >= 0x1f1e6 && n <= 0x1f1ff;
    }).length;
    /* Cada bandeira são DOIS indicadores regionais, então uma bandeira = 2. */
    verdade(`"${linha}" tem uma bandeira só`, bandeiras <= 2);
  }
  verdade("o fecho faz a conta na cabeça de quem lê", /Sem tradução/.test(cartao.footer.text));

  /* ---- o recibo não gasta tradução, e mesmo assim serve a quem não lê
         português ----

     As duas regras andam juntas e uma quase quebrou a outra. Traduzir o
     cartão gastaria caractere pago -- um recurso que existe para fazerem
     lembrar de mim não pode se pagar com a conta que eu quero baixar. Mas só
     português repetiria, no dono, exatamente o defeito que a NYX achou.
     A saída é escrever pouco e escrever nas duas. */
  const fonte = readFileSync(`${aqui}/index.js`, "utf8");
  /* Até a chave que fecha a função, e não até a próxima que eu lembrar de
     nomear: o recorte anterior ia de reciboDaSemana a botoesDoRecibo, e no dia
     em que cliqueArena nasceu no meio, o guarda do recibo passou a julgar a
     arena. Guarda que mede a coisa errada acusa defeito onde não há. */
  const inicioRecibo = fonte.indexOf("async function reciboDaSemana");
  const corpoDoRecibo = fonte.slice(inicioRecibo, fonte.indexOf("\n}", inicioRecibo) + 2);
  for (const proibido of ["traduzirComCache", "traduzirEmbed", "traduzirLongo", "anotarUso"]) {
    verdade(`o recibo não chama ${proibido}`, !corpoDoRecibo.includes(proibido));
  }

  const tudoQueEleEscreve = [cartao.title, cartao.description, cartao.footer.text,
    ...cartao.fields.map((f) => f.name)].join("\n");
  verdade("o título fala inglês também", /Your week in languages/.test(cartao.title));
  verdade("a contagem também", /messages crossed/.test(cartao.description));
  verdade("o streak também", /weeks in a row/.test(tudoQueEleEscreve));
  verdade("o campo dos leitores também", /Who reads what/.test(cartao.fields[0].name));
  verdade("e o fecho também", /Without translation/.test(cartao.footer.text));

  /* Separador de milhar mente para metade do público: "1.240" é mil duzentos
     e quarenta em português e um vírgula dois e quatro em inglês. Num cartão
     que os dois leem, o número vai sem separador. */
  globalThis.sb = async (rota) =>
    (rota.startsWith("discord_chat_espelho") ? salas : [{ traducoes: 12345 }]);
  const grande = await reciboDaSemana(guild, { id: "s1" });
  verdade("número grande sai sem ponto de milhar", /\b12345\b/.test(grande.description));
  verdade("e sem vírgula de milhar", !/12,345|12\.345/.test(grande.description));

  /* Os limites do Discord, medidos aqui porque o cartão é montado com números
     que vêm de fora: um servidor com vinte idiomas não pode estourar o embed
     e sumir com o recibo inteiro. */
  verdade("o título cabe", cartao.title.length <= 256);
  verdade("a descrição cabe", cartao.description.length <= 4096);
  verdade("o rodapé cabe", cartao.footer.text.length <= 2048);
  for (const f of cartao.fields) {
    verdade(`o campo "${f.name}" cabe`, f.name.length <= 256 && f.value.length <= 1024);
  }
  const tudo = cartao.title.length + cartao.description.length + cartao.footer.text.length +
    cartao.fields.reduce((a, f) => a + f.name.length + f.value.length, 0);
  verdade("e o cartão inteiro cabe nos 6000", tudo <= 6000);

  /* Vinte idiomas é o teto do plano pago: o campo dos leitores corta em dez
     justamente para não estourar os 1024 com nome de idioma. */
  const muitos = LINGUAS_MENU.map(([c], i) => ({ idioma: c, role_id: `r${i}` }));
  const guildCheio = { roles: { cache: new Map(muitos.map((s, i) => [s.role_id, { members: { size: i + 1 } }])) } };
  globalThis.sb = async (rota) => (rota.startsWith("discord_chat_espelho") ? muitos : [{ traducoes: 500 }]);
  const cheio = await reciboDaSemana(guildCheio, { id: "s1" });
  verdade("com 20 idiomas o campo continua cabendo", cheio.fields[0].value.length <= 1024);

  /* Semana sem tradução nenhuma NÃO vira cartão: um recibo dizendo "zero"
     toda segunda é o bot lembrando que não serviu para nada. */
  globalThis.sb = async (rota) =>
    (rota.startsWith("cyron_uso_diario") ? [{ traducoes: 0 }] : salas);
  ok("semana vazia não vira cartão", await reciboDaSemana(guild, { id: "s1" }), null);

  /* Primeira semana do servidor: sem semana anterior, não há porcentagem --
     "+100%" a partir de zero é um número inventado. */
  globalThis.sb = async (rota) => {
    if (rota.startsWith("discord_chat_espelho")) return salas;
    const de = /dia=gte\.([0-9-]+)/.exec(rota)?.[1];
    const daSemana = diaISO(Date.parse(`${semanaAtual}T00:00:00Z`) - 7 * 864e5);
    return [{ traducoes: de === daSemana ? 40 : 0 }];
  };
  const primeira = await reciboDaSemana(guild, { id: "s1" });
  verdade("na primeira semana não há porcentagem", !/%/.test(primeira.description));
  verdade("nem streak de uma semana só", !/semanas seguidas/.test(primeira.description));
  verdade("mas o número aparece", /40 mensagens/.test(primeira.description));
}

/* ============ a Arena das Línguas ============

   O time é o IDIOMA, e é isso que faz o jogo ser sobre o CYRON em vez de um
   clicker pregado nele. A regra que sustenta tudo é o handicap: sem ela o
   idioma com mais gente ganha sempre e os outros desistem na primeira semana. */
{
  const { custoDeEvoluir, handicapDoTime, chanceDeVitoria, timesDaArena,
          placarDaArena, botoesDaArena, ARENA_ATAQUES_DIA } =
    carregar(["CANAL_ARENA", "ARENA_ATAQUES_DIA", "MEDALHA", "nomeDoIdioma", "LINGUAS_MENU", "custoDeEvoluir", "handicapDoTime",
      "chanceDeVitoria", "timesDaArena", "setaDoTime", "nomeNaPropriaLingua", "linhasDoPlacar", "LEGENDA_ARENA",
      "ARENA_VAZIA", "placarDaArena", "botoesDaArena"]);

  /* ---- evoluir fica mais caro ---- */
  ok("o primeiro nível custa 10", custoDeEvoluir(1), 10);
  ok("o quinto custa 50", custoDeEvoluir(5), 50);
  verdade("e nunca fica mais barato subindo",
    [1, 2, 5, 10, 50].every((p, i, a) => i === 0 || custoDeEvoluir(p) > custoDeEvoluir(a[i - 1])));
  /* Custo fixo faria o ouro virar só espera: quem clica mais sobe mais, para
     sempre. Poder zero ou lixo não pode dar evolução de graça. */
  verdade("poder zero ainda custa", custoDeEvoluir(0) >= 10);
  verdade("poder inválido não zera o custo", custoDeEvoluir("abacaxi") >= 10);

  /* ---- time pequeno bate mais forte ---- */
  ok("o maior time não ganha handicap", handicapDoTime(14, 14), 1);
  verdade("um time menor ganha", handicapDoTime(4, 14) > 1);
  verdade("quanto menor, maior", handicapDoTime(2, 14) > handicapDoTime(7, 14));
  /* Teto de 2x: sem ele, um time de uma pessoa venceria sempre e a vantagem
     viraria o defeito novo. */
  verdade("mas nunca passa de 2x", handicapDoTime(1, 100000) <= 2);
  ok("time vazio conta como um", handicapDoTime(0, 10), handicapDoTime(1, 10));
  verdade("lixo não quebra a conta", Number.isFinite(handicapDoTime(null, undefined)));

  /* ---- a chance nunca é certeza ---- */
  ok("forças iguais dão meio a meio", chanceDeVitoria(100, 100), 0.5);
  verdade("mais forte tem mais chance", chanceDeVitoria(300, 100) > 0.5);
  /* Certeza dos dois lados mata o jogo: o forte perde a graça e o fraco para
     de tentar. */
  ok("e o esmagador ainda pode perder", chanceDeVitoria(999999, 1), 0.9);
  ok("o esmagado ainda pode ganhar", chanceDeVitoria(1, 999999), 0.1);
  ok("dois zeros dão meio a meio", chanceDeVitoria(0, 0), 0.5);
  verdade("negativo não vira chance maluca",
    chanceDeVitoria(-5, 100) >= 0.1 && chanceDeVitoria(-5, 100) <= 0.9);

  /* ---- os times ---- */
  /* Já somado pelo banco (cyron_arena_placar): mundial, somar em JavaScript
     seria ler todas as linhas do mundo a cada desenho de placar. */
  const linhasDoBanco = [
    { idioma: "pt", poder: 15, vitorias: 4, jogadores: 2, meu_servidor: 4 },
    { idioma: "de", poder: 8, vitorias: 9, jogadores: 1, meu_servidor: 0 },
  ];
  const leitores = [{ idioma: "pt", quantos: 14 }, { idioma: "de", quantos: 4 }];
  const times = timesDaArena(linhasDoBanco, leitores, {});

  ok("dois times", times.length, 2);
  ok("o placar é por vitórias da temporada", times[0].idioma, "de");
  ok("o poder vem somado do banco", times.find((t) => t.idioma === "pt").poder, 15);
  ok("e quantos jogam também", times.find((t) => t.idioma === "pt").jogadores, 2);
  ok("a contribuição do servidor vem junto", times.find((t) => t.idioma === "pt").meuServidor, 4);
  /* O tamanho do time é quanta GENTE lê naquele idioma, não quantos jogam --
     senão o handicap premiaria o idioma que ninguém escolheu, que é o
     contrário do que ele existe para fazer. */
  ok("o tamanho vem dos leitores, não dos jogadores",
    times.find((t) => t.idioma === "de").gente, 4);
  verdade("e o time pequeno fica mais forte que o poder cru dele",
    times.find((t) => t.idioma === "de").forca > 8);

  ok("sem jogadores e sem traduções, sem times", timesDaArena([], leitores, {}).length, 0);

  /* O placar não nasce vazio SEM inventar jogador: idioma que ainda não tem
     ninguém jogando, mas TEM tradução de verdade, entra assim mesmo. É daí
     que vem a vida do primeiro dia, e o número é real. */
  const soTraducao = timesDaArena([], leitores, { pt: 620, ar: 180 });
  ok("idioma com tradução e sem jogador entra no placar", soTraducao.length, 2);
  ok("e o primeiro é quem mais traduziu", soTraducao[0].idioma, "pt");
  ok("com poder zero, porque ninguém jogou", soTraducao[0].poder, 0);
  ok("e as traduções contadas", soTraducao[0].traducoes, 620);
  /* Idioma sem leitor cadastrado não pode quebrar a conta. */
  verdade("jogador de idioma sem leitores ainda entra",
    timesDaArena([{ idioma: "ja", poder: 2, vitorias: 0 }], leitores, {}).length === 1);

  /* ---- o placar ---- */
  const placar = placarDaArena(times, "2026-08-31");
  /* Uma língua só. Bilíngue por construção dobrava título, temporada, "seu
     servidor", legenda e os quatro rótulos de botão -- metade do cartão era a
     mesma frase escrita de novo. O 🌐 serve os vinte idiomas; o bilíngue
     servia dois. */
  verdade("o título é só inglês", /^⚔️ Language Arena$/.test(placar.title));
  verdade("e nada no cartão vem dobrado com ·  português",
    !/Arena das Línguas|Temporada|Seu servidor|vitórias/.test(
      placar.title + placar.description + placar.footer.text));
  verdade("mostra a temporada em dia/mês, não na data do banco",
    /31\/08/.test(placar.description) && !/2026-08-31/.test(placar.description));
  verdade("o time pequeno ganha a seta que convida", /▲/.test(placar.description));
  verdade("o rodapé explica o handicap sem precisar de manual",
    /smaller teams hit harder/i.test(placar.footer.text));
  verdade("e a legenda não é repetida em outra língua",
    (placar.footer.text.match(/smaller teams/gi) || []).length === 1 &&
    !/bate mais forte/.test(placar.footer.text));
  verdade("o rodapé aponta o 🌐 uma vez só",
    (placar.footer.text.match(/🌐/g) || []).length === 1);

  const vazio = placarDaArena([], "2026-08-31");
  verdade("arena sem nada explica que ela abre com a primeira tradução",
    /first message gets translated/i.test(vazio.description));
  verdade("e sem a segunda cópia em português",
    !/primeira mensagem for traduzida/i.test(vazio.description));

  /* ---- mundial, e sem entregar a lista de clientes ---- */
  verdade("o placar se diz mundial", /worldwide/i.test(placar.description));
  /* Nome de servidor nunca aparece: ranking com nome de cliente entrega a
     lista de clientes para qualquer um que entre num servidor. */
  const comContribuicao = placarDaArena(times, "2026-08-31", 12);
  verdade("a contribuição do servidor aparece", /Your server/.test(comContribuicao.description));
  verdade("com 12 servidores, o número aparece", /12 servers/.test(comContribuicao.description));

  /* "1 de 1" anuncia fraqueza justamente para o visitante que se quer
     impressionar. Só a partir de cinco. */
  const sozinho = placarDaArena(times, "2026-08-31", 1);
  verdade("com um servidor só, o número não aparece", !/servers in the arena/.test(sozinho.description));
  const quatro = placarDaArena(times, "2026-08-31", 4);
  verdade("nem com quatro", !/servers in the arena/.test(quatro.description));

  /* Servidor que não contribuiu com nada não vê "0 vitórias" toda semana. */
  const semContribuir = placarDaArena(
    times.map((t) => ({ ...t, meuServidor: 0 })), "2026-08-31", 12);
  verdade("sem contribuição, a linha some", !/Your server/.test(semContribuir.description));

  /* Doze times é o teto do desenho; vinte idiomas não podem estourar o embed. */
  const muitos = timesDaArena(
    LINGUAS_MENU.map(([c], i) => ({ idioma: c, poder: 100 + i, vitorias: i })),
    LINGUAS_MENU.map(([c], i) => ({ idioma: c, quantos: i + 1 })));
  const cheio = placarDaArena(muitos, "2026-08-31");
  verdade("com 20 idiomas a descrição cabe", cheio.description.length <= 4096);
  verdade("e o rodapé cabe", cheio.footer.text.length <= 2048);

  /* ---- os botões ---- */
  const linhasArena = botoesDaArena();
  ok("uma linha", linhasArena.length, 1);
  ok("quatro botões", linhasArena[0].components.length, 4);
  /* Cinco é o teto do Discord numa linha. Passar disso não dá erro bonito:
     o cartão inteiro deixa de ser postado. */
  verdade("e cabem numa linha do Discord", linhasArena[0].components.length <= 5);
  for (const b of linhasArena[0].components) {
    verdade(`"${b.label}" cabe`, b.label.length <= 80);
    verdade(`"${b.label}" é clique, não link`, b.style !== 5 && !!b.custom_id);
    verdade(`"${b.label}" é da arena`, b.custom_id.startsWith("arena:"));
  }
  /* O botão que resolve o placar em português: sem ele, quem não lê nenhuma
     das duas línguas do cartão fixado não tem saída dentro da sala. */
  verdade("há um botão que traz o placar na língua de quem clicou",
    linhasArena[0].components.some((b) => b.custom_id === "arena:placar"));

  /* ---- o teto de ataques é rígido ---- */
  verdade("há um teto de ataques por dia", Number.isInteger(ARENA_ATAQUES_DIA) && ARENA_ATAQUES_DIA > 0);
  verdade("e ele é baixo o bastante para o custo não escapar", ARENA_ATAQUES_DIA <= 20);

  /* ---- o placar existe SEM ninguém ter clicado ----

     Este é o defeito que a sala vazia mostrou: eu criava o canal na instalação
     e a única coisa que desenhava o placar era o clique num botão que só
     existe DENTRO do placar. Círculo fechado -- precisa do placar para clicar,
     precisa do clique para ter placar.

     É a quarta vez nesta semana que o defeito não está na coisa e sim em onde
     ela aparece, então o teste é sobre a superfície, não sobre o jogo: quem
     desenha tem que ser algo que roda sozinho. */
  const fonteDoBot = readFileSync(`${aqui}/index.js`, "utf8");
  const chamadas = [...fonteDoBot.matchAll(/desenharArena\s*\(/g)].length;
  verdade("desenharArena é chamado de mais de um lugar", chamadas >= 3); // definição + cliques + upkeep
  /* Ancorado no começo da linha, e não em qualquer lugar do texto: a primeira
     versão deste teste procurava a chamada solta, e uma linha COMENTADA
     continuava passando -- provei comentando-a e vendo os testes verdes.
     Guarda que aceita código morto é pior que guarda nenhum, porque dá
     confiança. */
  verdade("a varredura desenha a arena sozinha",
    /^\s*await atualizarArenas\(\)/m.test(fonteDoBot));
  verdade("e a instalação já deixa o placar de pé",
    /instalar: arena em[\s\S]{0,400}desenharArena/.test(fonteDoBot));
  /* Se atualizarArenas sair de umaPassada, o placar volta a depender de
     clique -- e a sala volta a nascer vazia, em silêncio. */
  const passada = fonteDoBot.slice(
    fonteDoBot.indexOf("async function umaPassada"),
    fonteDoBot.indexOf("async function deHoraEmHora"));
  verdade("atualizarArenas está dentro da varredura, e viva",
    /^\s*await atualizarArenas\(\)/m.test(passada));

  /* ---- o que o bot lê tem que ser o que a função devolve ----

     A arena respondeu "não respondeu agora" a noite inteira por causa disto:
     `returns table (poder int, ouro int, ...)` declara VARIÁVEIS com o nome
     das colunas, e dentro da função `set ouro = ouro + 5` virou ambíguo. O
     Postgres recusou a função inteira -- erro 42702 -- em tempo de execução.

     A saída ganhou prefixo `r_`. O teste prende os dois lados: o SQL
     versionado não pode voltar a devolver nomes que colidem com colunas, e o
     bot tem que ler exatamente os nomes que a função devolve. Errar um lado
     dos dois dá "undefined" na tela, em silêncio. */
  const sqlArena = readFileSync(`${aqui}/../supabase/migracoes/001-arena.sql`, "utf8");
  const colunas = ["poder", "ouro", "vitorias", "ataques_dia", "idioma", "dia", "temporada"];

  /* SÓ nas funções plpgsql. Em `language sql` a saída não vira variável, e
     não há conflito -- cyron_arena_placar devolve `idioma` e `poder` e está
     correta, aplicada e em uso. Guarda que acusa código certo acaba desligado
     por quem estiver com pressa, e aí ele não guarda mais nada.

     A primeira versão deste teste era assim, e reprovou três funções boas. */
  const plpgsql = [...sqlArena.matchAll(
    /returns table \(([^)]*)\)\s*language plpgsql/gs)];
  verdade("achei as funções plpgsql para conferir", plpgsql.length >= 2);
  for (const saida of plpgsql) {
    for (const campo of saida[1].split(",")) {
      const nome = campo.trim().split(/\s+/)[0];
      if (!nome) continue;
      verdade(`a saída plpgsql "${nome}" não colide com nome de coluna`, !colunas.includes(nome));
    }
  }

  const fonteRpc = readFileSync(`${aqui}/index.js`, "utf8");
  const trecho = fonteRpc.slice(fonteRpc.indexOf("async function cliqueArena"));
  const usa = trecho.slice(0, trecho.indexOf("\nfunction "));
  for (const campo of ["r_ok", "r_ouro", "r_poder", "r_vitorias", "r_ataques"]) {
    verdade(`o bot lê ${campo}, o nome que a função devolve`, usa.includes(campo));
  }
  /* E não pode ter sobrado nenhuma leitura pelo nome antigo. */
  for (const velho of ["r.ok", "r.ouro", "r.poder", "r.vitorias", "r.ataques_dia"]) {
    verdade(`nenhuma leitura por "${velho}", que não existe mais`, !usa.includes(velho));
  }

  /* O erro do banco tem que ir para o log. Foi o `.catch(() => null)` que
     escondeu a mensagem exata por horas e mostrou "não respondeu agora". */
  verdade("o erro de atacar vai para o log", /arena: atacar falhou/.test(fonteRpc));
  verdade("o erro de evoluir também", /arena: evoluir falhou/.test(fonteRpc));

  /* ---- o placar é achado pelo ID, e não pelos fixados ----

     Achar pelo pin encheu a sala: o fetchPinned da discord.js 14.27 fala com a
     rota nova de pins e trata a resposta como lista, mas ela vem em
     { items: [...] } -- não é iterável, a chamada estoura sempre, e o bot
     conclui que não há placar e posta outro a cada varredura.

     Foi um `.catch` meu que escondeu isso pela segunda vez na mesma noite.
     Este teste prende as duas coisas: nada de fetchPinned, e o id guardado. */
  const fonteArena2 = readFileSync(`${aqui}/index.js`, "utf8");
  verdade("nenhuma chamada a fetchPinned, que está quebrada nesta versão",
    !/\.fetchPinned\s*\(/.test(fonteArena2));
  /* A chave sozinha não prova nada: ela continua escrita mesmo se a busca for
     destruída -- provei quebrando a linha e vendo os 900 verdes. O que prende
     é a LEITURA do ajuste e o fetch pelo id guardado. */
  verdade("o placar é guardado por id no cyron_ajuste",
    /arena_msg:\$\{servidor\.id\}/.test(fonteArena2));
  verdade("e o id guardado é realmente lido",
    /const guardado = \(await ajustes\(\)\)\[chave\]/.test(fonteArena2));
  verdade("e usado para buscar a mensagem",
    /canal\.messages\.fetch\(guardado\)/.test(fonteArena2));
  verdade("e gravado depois de postar", /porAjuste\(chave, nova\.id\)/.test(fonteArena2));
  verdade("e o erro de editar o placar vai para o log",
    /nao consegui editar o placar/.test(fonteArena2));
  verdade("o de postar também", /nao consegui postar o placar/.test(fonteArena2));
  /* Recolher placar velho tem que olhar autor E título: só o autor levaria
     junto qualquer outra coisa que o bot tenha postado na sala. */
  verdade("a limpeza confere o autor", /m\.author\?\.id === client\.user\.id/.test(fonteArena2));
  verdade("e o título, para não apagar o que não é placar",
    /startsWith\("⚔️ Arena das Línguas"\)/.test(fonteArena2));

  /* ---- número não vai para o tradutor ----

     O jogo fala a língua de quem clicou, e isso é de graça porque os RÓTULOS
     são fixos: vinte idiomas vezes uma dúzia de palavras é uma tradução única,
     cacheada para sempre.

     O que quebraria isso é número dentro da frase: cada valor seria uma chave
     de cache nova, que nunca se repete, e o jogo passaria a custar por clique.
     Por isso rótulo de um lado e número do outro -- e por isso o tradutor
     agora recusa texto sem letra nenhuma. */
  {
    const { traduzirEmbed } = carregar(["traduzirEmbed"]);
    const pedidos = [];
    globalThis.traduzirComCache = async (t) => { pedidos.push(t); return `<${t}>`; };

    const traduzido = await traduzirEmbed({
      title: "⚔️ Vitória!",
      fields: [
        { name: "Chance", value: "39%" },
        { name: "🪙 Ouro", value: "+5 · 28" },
        { name: "Ataques hoje", value: "3 / 5" },
        { name: "Duelo", value: "🇧🇷 × 🇸🇦" },
      ],
    }, "de");

    verdade("o rótulo é traduzido", traduzido.fields[0].name === "<Chance>");
    ok("o número passa intacto", traduzido.fields[0].value, "39%");
    ok("o ouro com sinal também", traduzido.fields[1].value, "+5 · 28");
    ok("a contagem de ataques também", traduzido.fields[2].value, "3 / 5");
    ok("e as bandeiras do duelo também", traduzido.fields[3].value, "🇧🇷 × 🇸🇦");

    for (const t of pedidos) {
      verdade(`"${t}" tem letra, então valia traduzir`, /\p{L}/u.test(t));
    }
    /* O ponto: nenhum número foi pedido ao tradutor. */
    verdade("nada sem letra foi ao tradutor", !pedidos.some((t) => !/\p{L}/u.test(t)));

    /* Alfabeto nenhum é privilegiado: árabe, japonês e cirílico contam como
       letra do mesmo jeito que o "a". */
    pedidos.length = 0;
    await traduzirEmbed({ title: "العربية", description: "日本語" }, "en");
    ok("árabe e japonês são texto, e vão", pedidos.length, 2);

    pedidos.length = 0;
    await traduzirEmbed({ title: "2 / 5", description: "100%" }, "en");
    ok("só número não vai", pedidos.length, 0);

    globalThis.traduzirComCache = async (t) => `<${t}>`;
  }

  /* ---- os rótulos da arena são fixos, para o cache pegar ----

     Se um número entrar no título ou na descrição, cada valor vira uma chave
     de cache nova e o jogo passa a custar por clique, para sempre. */
  const fonteJogo = readFileSync(`${aqui}/index.js`, "utf8");
  const clique = fonteJogo.slice(
    fonteJogo.indexOf("async function cliqueArena"),
    fonteJogo.indexOf("\nfunction botoesDoRecibo"));
  for (const m of clique.matchAll(/title: "([^"]*)"/g)) {
    verdade(`o título "${m[1]}" não carrega número`, !/\d/.test(m[1]));
  }
  verdade("a resposta passa pelo tradutor na língua de quem clicou",
    /traduzirEmbed\(embed, idioma, MOTOR_AUTO\)/.test(fonteJogo));
  /* A cadeia inteira, e nas DUAS portas: o botão do cartão e o /arena.
     Escolha da pessoa primeiro, língua do aplicativo como palpite, inglês só
     no fim. Foi a falta do palpite do meio que mandou inglês para uma alemã. */
  const comando = fonteJogo.slice(
    fonteJogo.indexOf("async function comandoArena"),
    fonteJogo.indexOf("async function comandoDeInteracao"));
  verdade("achei o /arena para conferir", comando.length > 100);
  for (const [onde, corpo] of [["o botão", clique], ["o /arena", comando]]) {
    verdade(`em ${onde} a língua sai da escolha da pessoa`,
      /idiomaEscolhido\(inter\.user\.id\)/.test(corpo));
    verdade(`em ${onde} o Discord é o palpite, e o inglês o último recurso`,
      /\|\| idiomaDoAplicativo\(inter\.locale\) \|\| "en"/.test(corpo));
  }

  /* ---- não pode sobrar leitura pelo nome antigo, nem com ?. ----

     A primeira vez que renomeei isto, um `r?.ouro` escapou: a substituição sem
     assert falhou em silêncio, e o teste procurava "r.ouro", que não casa com
     "r?.ouro". Quem ficasse sem ouro via "você tem 0", sempre. */
  for (const velho of ["r.ouro", "r?.ouro", "r.poder", "r?.poder", "r.vitorias", "r.ataques_dia"]) {
    verdade(`nenhuma leitura por "${velho}"`, !clique.includes(velho));
  }

  /* ---- A Casa se anuncia, e não finge ser gente ----

     A alternativa recusada foi criar jogadores falsos para encher o placar.
     Adversário inventado com cara de pessoa é registro fabricado apresentado
     como verdadeiro -- e quem descobre que o placar é invenção passa a duvidar
     da tradução junto, que é o que se vende.

     O teste prende a diferença: o nome d'A Casa tem que se anunciar, e não
     pode existir nenhum jogador semeado no banco. */
  const fonteCasa = readFileSync(`${aqui}/index.js`, "utf8");
  verdade("A Casa se identifica como adversário de treino",
    /A Casa\*\* — o adversário de treino/.test(fonteCasa));
  verdade("e ela não tem idioma, então não entra no placar como time",
    /idioma: null, forca:/.test(fonteCasa));
  /* No duelo ela aparece como 🏰, e não como bandeira: bandeira ali seria um
     país, e aí sim pareceria gente. */
  verdade("no duelo ela é um castelo, não uma bandeira",
    /alvo\.idioma \? \(bandeiraDoIdioma\(alvo\.idioma\) \|\| "🌐"\) : "🏰"/.test(fonteCasa));
  /* Nenhum insert de jogador que não venha de um ataque real de alguém. */
  const inserts = [...fonteCasa.matchAll(/sbPost\("cyron_arena"/g)].length;
  ok("o bot nunca insere jogador direto na arena", inserts, 0);

  /* ---- fixar não pode deixar rastro na sala ----

     O Discord anuncia cada fixada com uma mensagem de sistema no próprio
     canal. Numa sala que existe para ter UM cartão, esse aviso é a segunda
     mensagem -- e como o cartão é re-fixado sempre que é reposto, a sala vai
     juntando avisos.

     O teste é sobre a superfície de novo: todo lugar que fixa tem que limpar
     atrás de si, e é fácil acrescentar um `pin` novo no futuro e esquecer. */
  const fontePin = readFileSync(`${aqui}/index.js`, "utf8");
  const fixadas = [...fontePin.matchAll(/\.pin\(/g)].length;
  const limpezas = [...fontePin.matchAll(/apagarAvisoDeFixado\(/g)].length;
  /* Uma a mais que as fixadas: a definição da própria função. */
  ok("todo lugar que fixa também apaga o aviso", limpezas, fixadas + 1);
  verdade("e o aviso é identificado pelo tipo do Discord, não pelo texto",
    /MessageType\.ChannelPinnedMessage/.test(fontePin));
  verdade("MessageType está importado", /MessageType[,\s}].*from "discord\.js"/.test(fontePin));

  /* ---- a arena não gasta tradução ----

     A regra vale para todo recurso de engajamento: gamificar o recurso medido
     é transformar diversão em conta a pagar. */
  const fonteArena = readFileSync(`${aqui}/index.js`, "utf8");
  /* A regra MUDOU, e mudou por um motivo, não por conveniência.

     Era "a arena não traduz nada". Estava certa enquanto o texto misturava
     rótulo e número: traduzir "Poder 7 · Ouro 23" cobraria por clique, para
     sempre, porque cada número é uma chave de cache nova.

     Separado -- rótulo fixo de um lado, número do outro --, traduzir passa a
     ser uma vez por idioma e nunca mais. E aí NÃO traduzir é que era o defeito:
     um jogo de tradutor falando só português é a piada contra si mesmo.

     O que continua proibido é o que de fato custa: texto que varia. Isso é
     guardado acima, no bloco que prova que número não vai ao tradutor. */
  /* Por FUNÇÃO, e não por região do arquivo. Recortar "daqui até ali" já me
     mordeu três vezes hoje: basta alguém escrever uma função nova no meio para
     o guarda passar a julgar o código errado. O nome não se move. */
  const corpoDe = (nome) => {
    const i = fonteArena.indexOf(nome);
    verdade(`achei ${nome} para conferir`, i > 0);
    return fonteArena.slice(i, fonteArena.indexOf("\n}", i) + 2);
  };
  for (const naoTraduz of ["function placarDaArena", "async function desenharArena",
                           "function linhasDoPlacar"]) {
    const c = corpoDe(naoTraduz);
    verdade(`${naoTraduz} não traduz: é uma mensagem para o servidor inteiro`,
      !c.includes("traduzirEmbed") && !c.includes("traduzirComCache"));
  }

  /* ---- e a tabela é anexada DEPOIS de traduzir, nunca antes ----

     Esta é a linha inteira do orçamento. Se `pronto.description = linhasDoPlacar(...)`
     subir para antes do `traduzirEmbed`, a tabela passa a ir para o tradutor --
     e ela muda a cada vitória, então cada estado do placar vira uma chave de
     cache nova que nunca mais se repete. O jogo passaria a custar por clique,
     para sempre, e nada quebraria: só a fatura no fim do mês. */
  const pessoal = corpoDe("async function placarPessoal");
  verdade("o placar pessoal traduz o molde", pessoal.includes("traduzirEmbed"));
  verdade("a tabela do placar pessoal é a mesma do fixado",
    /description: times\.length\s*\n\s*\? linhasDoPlacar\(times, /.test(pessoal));
  /* A tabela nunca pode virar argumento do tradutor. `await T(linhasDoPlacar(...))`
     compila, desenha certo, e devolve a conta a cada vitória nova. */
  verdade("e ela não passa por dentro do T", !/T\(\s*linhasDoPlacar/.test(pessoal));
  /* Origem inglês: sem isto o brasileiro aperta 🌐 e recebe inglês de volta. */
  verdade("o placar pessoal traduz A PARTIR do inglês",
    /falaFixa\(idioma, MOTOR_AUTO, "en"\)/.test(pessoal));
}

/* ============ o placar de cada um, na língua de cada um ============

   O cartão fixado é UMA mensagem para o servidor inteiro: ele nunca vai falar
   cinco línguas ao mesmo tempo. O /arena e o botão 🌐 resolvem isso do único
   jeito possível -- uma cópia efêmera por pessoa.

   O risco desse recurso não é ele quebrar, é ele funcionar e cobrar. Por isso
   os testes abaixo perseguem uma coisa só: o que sobe para o tradutor é fixo,
   e nada que varia encosta nele. */
{
  const { placarPessoal, linhasDoPlacar, timesDaArena } = carregar([
    "MEDALHA", "LINGUAS_MENU", "nomeDoIdioma", "nomeNaPropriaLingua", "bandeiraDoIdioma", "diaISO", "SEMANA",
    "ARENA_ATAQUES_DIA", "LEGENDA_ARENA", "ARENA_VAZIA", "handicapDoTime",
    "setaDoTime", "linhasDoPlacar", "timesDaArena", "traduzirEmbed", "placarPessoal"]);

  globalThis.COR = 0xF5A623;
  globalThis.MOTOR_AUTO = { tipo: "teste" };

  /* Tudo que for pedido ao tradutor fica registrado. É o que os testes leem. */
  let pedidos = [];
  globalThis.traduzirComCache = async (t) => { pedidos.push(t); return `<${t}>`; };

  const leitores = [
    { idioma: "pt", quantos: 14 }, { idioma: "de", quantos: 3 }, { idioma: "ar", quantos: 6 }];
  const times = timesDaArena([
    { idioma: "pt", poder: 20, vitorias: 7, meu_servidor: 4 },
    { idioma: "de", poder: 9, vitorias: 5 },
    { idioma: "ar", poder: 12, vitorias: 5 },
  ], leitores, { pt: 620, de: 90, ar: 180 });

  const estado = { times, temporada: "2026-08-31", servidores: 12 };
  const eu = { poder: 3, ouro: 41, vitorias: 5, ataques_dia: 2, dia: "1970-01-01" };

  const cartao = await placarPessoal(estado, "de", eu, true);

  /* ---- a tabela não passou pelo tradutor ---- */
  ok("a tabela é a mesma do fixado, sem tradução",
    cartao.description, linhasDoPlacar(times, "de"));
  verdade("nenhuma linha da tabela foi pedida ao tradutor",
    !pedidos.some((p) => p.includes("🥇") || p.includes("Deutsch")));

  /* ---- nome de língua fica na própria língua ---- */
  verdade("o alemão acha 'Deutsch' escrito Deutsch", /Deutsch/.test(cartao.description));
  verdade("e o árabe acha o dele no alfabeto dele", /[؀-ۿ]/.test(cartao.description));
  verdade("o time de quem está lendo vem em negrito",
    /\*\*[^*]*Deutsch[^*]*\*\*/.test(cartao.description));
  verdade("e só o dele", (cartao.description.match(/\*\*/g) || []).length === 2);

  /* ---- o que subiu ao tradutor é fixo ----

     Nenhum dos textos pedidos pode carregar número. Se carregar, cada valor
     novo é uma chave de cache nova e a conta cresce com o uso. */
  verdade("alguma coisa foi traduzida", pedidos.length > 0);
  for (const p of pedidos) {
    verdade(`"${p.slice(0, 40)}" não carrega número`, !/\d/.test(p));
  }

  /* ---- e todo valor de campo é número ou símbolo, jamais texto ---- */
  for (const f of cartao.fields) {
    verdade(`o rótulo "${f.name}" foi traduzido`, f.name.startsWith("<"));
    verdade(`o valor de "${f.name}" não tem letra para traduzir`, !/\p{L}/u.test(f.value));
  }
  verdade("o título foi traduzido", cartao.title.startsWith("<"));
  verdade("a legenda dos símbolos também", cartao.footer.text.startsWith("<"));

  /* ---- o placar muda, a conta não ----

     É esta a promessa do recurso: a segunda pessoa que apertar o botão naquele
     idioma não gasta uma tradução sequer, por mais que o placar tenha mudado. */
  const antes = [...pedidos];
  pedidos = [];
  const outroEstado = {
    times: timesDaArena([
      { idioma: "pt", poder: 44, vitorias: 19, meu_servidor: 9 },
      { idioma: "de", poder: 31, vitorias: 22 },
      { idioma: "ar", poder: 12, vitorias: 5 },
    ], leitores, { pt: 991, de: 402, ar: 180 }),
    temporada: "2026-09-07", servidores: 31,
  };
  const depois = await placarPessoal(outroEstado, "de", { ...eu, ouro: 999, poder: 12 }, true);
  verdade("o placar realmente mudou", depois.description !== cartao.description);
  ok("e mesmo assim pediu exatamente os mesmos textos", pedidos, antes);

  /* ---- quem nunca escolheu língua LÊ o placar, e é convidado ---- */
  pedidos = [];
  const semEscolha = await placarPessoal(estado, "de", null, false);
  verdade("o convite aparece", semEscolha.fields.some((f) => /mylanguage/.test(f.value)));
  verdade("e o convite foi traduzido",
    pedidos.some((p) => p.includes("mylanguage")));
  verdade("a tabela continua lá para quem só quer olhar",
    semEscolha.description === linhasDoPlacar(times, ""));
  verdade("e nada de perfil de quem ainda não joga",
    !semEscolha.fields.some((f) => f.name.includes("Ataques")));

  /* O palpite do Discord diz em que LÍNGUA falar, não por que time lutar.
     Só apareceu ao desenhar o cartão: quem nunca escolheu nada via "Seu time:
     🇩🇪" e a linha alemã em negrito -- o cartão afirmando uma coisa que não
     tinha acontecido. */
  verdade("quem nunca escolheu não ganha time",
    !semEscolha.fields.some((f) => /Seu time/.test(f.name)));
  verdade("nem linha em negrito", !semEscolha.description.includes("**"));

  /* ---- arena vazia explica-se na língua de quem olha ---- */
  pedidos = [];
  const vazia = await placarPessoal({ times: [], temporada: "2026-08-31", servidores: 0 }, "de", null, true);
  verdade("a frase de arena vazia foi traduzida", vazia.description.startsWith("<"));
  verdade("e é a frase certa", /first message gets translated/.test(vazia.description));

  /* ---- quem não paga agora é o INGLÊS, e o português passou a pagar ----

     Esta prova virou do avesso quando o cartão passou a ser escrito em inglês,
     e é a mais importante do bloco: o português é a maioria de hoje. Se o
     molde continuasse saindo pelo traduzirEmbed -- que pula "pt" porque o
     resto do bot está escrito em português --, o brasileiro apertaria 🌐 e
     receberia o mesmo inglês de volta. É o defeito da NYX de cabeça para
     baixo, na maior parte dos usuários. */
  pedidos = [];
  const emCasa = await placarPessoal(estado, "en", eu, true);
  ok("inglês é o original, e não custa nada", pedidos.length, 0);
  verdade("e o cartão continua inteiro", !!emCasa.title && !!emCasa.description);
  verdade("em inglês o título vem cru", emCasa.title === "⚔️ Language Arena");

  pedidos = [];
  const emPortugues = await placarPessoal(estado, "pt", eu, true);
  verdade("português É traduzido, porque o original é inglês", pedidos.length > 0);
  verdade("e o título dele não volta em inglês", emPortugues.title.startsWith("<"));

  /* ---- os limites do Discord ---- */
  const todos = timesDaArena(
    LINGUAS_MENU.map(([c], i) => ({ idioma: c, poder: 100 + i, vitorias: i })),
    LINGUAS_MENU.map(([c], i) => ({ idioma: c, quantos: i + 1 })), {});
  const lotado = await placarPessoal({ times: todos, temporada: "2026-08-31", servidores: 40 }, "de", eu, false);
  verdade("com 20 idiomas a descrição cabe", lotado.description.length <= 4096);
  verdade("o rodapé cabe", lotado.footer.text.length <= 2048);
  verdade("e o embed não passa de 25 campos", lotado.fields.length <= 25);
  for (const f of lotado.fields) {
    verdade(`o rótulo "${f.name}" cabe`, f.name.length <= 256);
    verdade(`o valor de "${f.name}" cabe`, f.value.length <= 1024);
  }
}

/* ============ a bandeira que não deu em nada ============

   Cinco saídas mudas: servidor sem instalar, recurso desligado, mensagem sem
   texto. Do lado de fora, bot que não responde é bot quebrado -- e foi
   exatamente uma hora perdida adivinhando. */
{
  const { PORQUE_NAO } = carregar(["PORQUE_NAO"]);

  const motivos = Object.keys(PORQUE_NAO);
  verdade("há motivo escrito para cada saída sem resultado", motivos.length >= 3);
  for (const m of ["semServidor", "desligado", "semTexto"]) {
    verdade(`o motivo "${m}" tem texto`, !!PORQUE_NAO[m]);
  }

  for (const [m, p] of Object.entries(PORQUE_NAO)) {
    verdade(`${m}: o título cabe no embed`, p.titulo.length <= 256);
    /* Bilíngue sempre: a bandeira é justamente de quem não lê português. */
    verdade(`${m}: fala inglês também`, /[a-z]/.test(p.ingles) && p.ingles.includes("_"));
    verdade(`${m}: cabe na descrição`, `${p.texto}\n\n${p.ingles}`.length <= 4096);
    /* A armadilha da tradução automática que já me pegou: frase começada por
       pronome indefinido vira nome próprio e inverte o sentido. */
    verdade(`${m}: não começa com pronome indefinido`,
      !/^(Nada|Ninguém|Nenhum|Tudo|Todos)\b/i.test(p.texto));
  }
}

/* ================= de onde sai o texto de uma mensagem ================= */
{
  const { textoDaMensagem } = carregar(["textoDaMensagem"]);

  ok("mensagem comum usa o corpo", textoDaMensagem({ content: "  oi  " }), "oi");

  /* Aviso automático chega com "@everyone" no corpo e a mensagem inteira no
     embed. Traduzir o corpo aqui seria traduzir "@everyone". */
  ok("aviso automático usa o embed",
    textoDaMensagem({ content: "@everyone", embeds: [{ title: "Urso", description: "às 20h" }] }),
    "Urso\nàs 20h");

  /* Embed que só carrega imagem não tem texto nenhum -- e antes disto virar
     função, esse caso devolvia "" e engolia o corpo que existia. */
  ok("embed sem texto cai no corpo",
    textoDaMensagem({ content: "olha isto", embeds: [{ image: { url: "x" } }] }), "olha isto");

  ok("mensagem vazia não tem texto", textoDaMensagem({ content: "   " }), "");
  ok("mensagem nenhuma não quebra", textoDaMensagem(null), "");
}

/* ============ o que eu guardo, e o que a página promete ============

   Os prazos existem em dois lugares: na lista GUARDO_POR, que manda na
   varredura, e escritos na página de privacidade, que é o que o cliente lê.
   Duas verdades sobre o mesmo assunto divergem no dia em que alguém mexer
   numa -- e a que fica errada é sempre a página, porque ela não quebra nada
   ao mentir. Este bloco é o que faz ela quebrar. */
{
  const { GUARDO_POR } = carregar(["GUARDO_POR"]);
  const site = `${aqui}/../cyron`;
  const privacidade = readFileSync(`${site}/privacidade.html`, "utf8");
  const termos = readFileSync(`${site}/termos.html`, "utf8");
  const inicio = readFileSync(`${site}/index.html`, "utf8");

  verdade("tenho uma lista de prazos", Array.isArray(GUARDO_POR) && GUARDO_POR.length > 0);

  for (const linha of GUARDO_POR) {
    const [tabela, dias, oQue] = linha;
    ok(`a linha de ${tabela} tem três partes`, linha.length, 3);
    verdade(`${tabela}: o prazo é um número de dias`, Number.isInteger(dias) && dias > 0);
    verdade(`${tabela}: tem uma descrição em português`, typeof oQue === "string" && oQue.length > 3);
    /* O prazo tem que aparecer na página, nas duas línguas. Uma tabela nova
       sem a linha correspondente é exatamente o caso que isto pega. */
    verdade(`${tabela}: "${dias} dias" está na página de privacidade`,
      privacidade.includes(`${dias} dias`));
    verdade(`${tabela}: "${dias} days" está na versão inglesa`,
      privacidade.includes(`${dias} days`));
  }

  /* O contrário também: prazo escrito na página que não existe no código
     seria promessa que ninguém cumpre. Só conto os que estão na tabela do
     quadro, com a classe que só ela usa. */
  const naPagina = [...privacidade.matchAll(/class="prazo"[^]*?data-pt>(\d+) dias</g)].map((m) => Number(m[1]));
  const noCodigo = GUARDO_POR.map(([, d]) => d);
  for (const d of naPagina) {
    verdade(`o prazo de ${d} dias na página existe no código`, noCodigo.includes(d));
  }
  ok("a página mostra um prazo por tabela guardada", naPagina.length, noCodigo.length);

  /* As duas páginas precisam existir E estar alcançáveis: página legal que
     ninguém acha não serve para verificação nenhuma. */
  for (const [nome, texto] of [["privacidade", privacidade], ["termos", termos]]) {
    verdade(`${nome}.html está ligada no rodapé do site`, inicio.includes(`./${nome}.html`));
    verdade(`${nome}.html tem título próprio`, /<title>[^<]*CYRON[^<]+<\/title>/.test(texto));
    /* Bilíngue de verdade: todo trecho em português precisa do par em inglês,
       senão o visitante estrangeiro lê um buraco. */
    const pt = (texto.match(/data-pt>/g) || []).length;
    const en = (texto.match(/data-en>/g) || []).length;
    ok(`${nome}.html tem um inglês para cada português`, en, pt);
    verdade(`${nome}.html aponta para a outra`,
      texto.includes(nome === "termos" ? "privacidade.html" : "termos.html"));
  }

  /* A frase que o bot já responde quando o texto sumiu passou a ser verdade
     só agora -- antes nada expirava. Se a varredura do texto sair da lista, a
     frase volta a ser mentira. */
  verdade("o texto das mensagens tem prazo",
    GUARDO_POR.some(([t]) => t === "discord_msg_traducao"));
}

/* ---- o resultado ---- */
if (falhou.length) {
  console.log(`\n  ${falhou.length} teste(s) falharam de ${passou + falhou.length}:\n`);
  for (const f of falhou) console.log(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log(`  ${passou} testes passaram.`);
