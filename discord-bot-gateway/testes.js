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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/* Do discord.js so' a tabela de permissoes -- ela e' constante, e importar a
   biblioteca nao liga bot nenhum. Quem liga o bot e' o index.js. */
import { PermissionFlagsBits } from "discord.js";
globalThis.PermissionFlagsBits = PermissionFlagsBits;

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

/* ---- o resultado ---- */
if (falhou.length) {
  console.log(`\n  ${falhou.length} teste(s) falharam de ${passou + falhou.length}:\n`);
  for (const f of falhou) console.log(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log(`  ${passou} testes passaram.`);
