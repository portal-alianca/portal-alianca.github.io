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
    let j = abre.endsWith("= ") ? i + abre.length : fonte.indexOf("{", i);

    /* Anda pelo texto contando chaves e colchetes, pulando o que estiver
       dentro de texto, de comentario ou de expressao regular.

       A expressao regular e' a parte chata, e foi ela que quebrou a primeira
       versao disto: `/<@[!&]?\d+>/` tem um colchete que fecharia a contagem
       no meio da regra. Saber se uma barra comeca uma regra ou e' divisao
       depende do que veio antes -- depois de `(`, `=`, `,` e afins e' regra;
       depois de um valor e' divisao. E' heuristica, e basta para este
       arquivo. */
    /* Escapado e' quem tem um numero IMPAR de barras antes.

       Olhar so' a barra anterior erra em `\\]`, onde a primeira barra escapa a
       segunda e o colchete fecha de verdade. Esse erro fazia a classe nunca
       fechar, a expressao regular nunca terminar, e a extracao engolir o
       arquivo inteiro -- 282 mil caracteres em vez de 300. */
    const escapado = (k) => {
      let n = 0;
      while (fonte[k - 1 - n] === "\\") n++;
      return n % 2 === 1;
    };

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
        const antes = fonte.slice(0, k).replace(/\s+$/, "").slice(-1);
        if (antes === "" || "(,=:[!&|?{};+return".includes(antes)) { dentro = "re"; continue; }
      }
      if (c === '"' || c === "'" || c === "`") { dentro = c; continue; }
      /* Parenteses contam junto: `new Set([...])` fecha o colchete ANTES do
         parentese, e sem contar os dois a extracao parava no `]` e devolvia
         codigo pela metade. */
      if (c === "{" || c === "[" || c === "(") nivel++;
      else if (c === "}" || c === "]" || c === ")") { nivel--; if (nivel === 0) { k++; break; } }
      else if (c === ";" && nivel === 0) { k++; break; }
    }
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

/* ---- o resultado ---- */
if (falhou.length) {
  console.log(`\n  ${falhou.length} teste(s) falharam de ${passou + falhou.length}:\n`);
  for (const f of falhou) console.log(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log(`  ${passou} testes passaram.`);
