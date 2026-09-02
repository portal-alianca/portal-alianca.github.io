/* Escreve cyron/recursos.html a partir do catalogo.js.
 *
 *   node discord-bot-gateway/fazer-recursos.js
 *
 * A página é gerada, e não escrita à mão, por um motivo só: lista de recursos
 * feita à mão mente com o tempo. O recurso some do código, a página continua
 * vendendo ele, e quem descobre é o cliente que instalou por causa daquela
 * linha. Aqui a página não tem como discordar da lista, e a lista não tem
 * como discordar do index.js -- a `prova` de cada item é conferida nos testes.
 *
 * O arquivo gerado É COMMITADO. GitHub Pages serve arquivo estático, não roda
 * gerador nenhum; e um teste compara o que está no disco com o que este
 * script produziria agora, então esquecer de rodar falha alto em vez de
 * publicar uma página velha.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CATEGORIAS, RECURSOS } from "./catalogo.js";

const aqui = dirname(fileURLToPath(import.meta.url));
export const DESTINO = `${aqui}/../cyron/recursos.html`;

/* Texto de dado vira texto de página, e não marcação.
 *
 * Nenhum texto do catálogo tem `<` hoje, e é justamente por isso que isto
 * precisa existir: no dia em que alguém escrever "a < b" numa descrição, o
 * certo é aparecer "a < b" na tela, e não a página quebrar em silêncio a
 * partir dali. */
function esc(t) {
  return String(t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* As duas línguas ficam as duas na página, escondidas por CSS -- é o que as
   outras páginas do CYRON fazem. Assim a troca é instantânea e o buscador
   enxerga os dois textos. */
function bi(par) {
  return `<span data-pt>${esc(par.pt)}</span><span data-en>${esc(par.en)}</span>`;
}

/* Só o que foge da regra ganha marca.
 *
 * 26 dos 30 são grátis, então "Grátis" escrito 26 vezes é ruído que ninguém
 * lê -- e some com o que importa, que são os quatro do plano pago. Os de
 * plano "ambos" também não ganham marca: eles funcionam no grátis, e o teto
 * maior está escrito no detalhe, onde a frase inteira cabe. */
const SELO = { pago: { pt: "pago", en: "paid" } };

/* O texto que a busca varre.
 *
 * Sem acento dos DOIS lados. O campo de busca tira o acento do que se digita;
 * se aqui ficasse "tradução" acentuado, procurar "traducao" não acharia nada
 * -- e a busca só serviria para quem já sabe escrever o nome exato. */
function paraBuscar(r) {
  const tudo = `${r.nome.pt} ${r.nome.en} ${r.oque.pt} ${r.oque.en} ${r.como.pt} ${r.como.en} ${r.chave}`;
  return tudo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* Uma linha fechada, e não um cartão aberto.
 *
 * A primeira versão desta página punha os 30 recursos como 30 cartões com o
 * parágrafo inteiro à mostra. Cabia tudo, estava correto, e era ilegível: uma
 * parede de texto onde nada tinha mais peso que o resto, 30 selos "Grátis"
 * repetidos e cinco parágrafos de categoria para dizer o que o nome já dizia.
 * Quem chega quer VER A LISTA -- e olhar o detalhe do que interessou.
 *
 * Então a linha mostra três coisas: o número, o nome, e "pago" quando for o
 * caso. O selo do grátis não existe: 26 dos 30 são grátis, e um selo que
 * aparece em quase tudo não informa nada -- só o que foge da regra merece
 * tinta. O resto abre no clique. */
function linha(r, numero) {
  const pago = r.plano === "pago";
  return `        <div class="item" data-plano="${r.plano}" data-cat="${r.categoria}" data-busca="${esc(paraBuscar(r))}">
          <button type="button" class="linha" aria-expanded="false">
            <span class="n">${String(numero).padStart(2, "0")}</span>
            <span class="nome">${bi(r.nome)}</span>
            ${pago ? `<span class="pago">${bi(SELO[r.plano])}</span>` : ""}
            <span class="seta" aria-hidden="true">›</span>
          </button>
          <div class="detalhe" hidden>
            <p>${bi(r.oque)}</p>
            <p class="como"><span class="rot" data-pt>Como se usa</span><span class="rot" data-en>How you use it</span> ${bi(r.como)}</p>
          </div>
        </div>`;
}

function secao(c) {
  const itens = RECURSOS
    .map((r, i) => [r, i + 1])
    .filter(([r]) => r.categoria === c.chave);
  return `  <section class="grupo" id="${c.chave}" data-cat="${c.chave}">
    <h2><span class="emoji">${c.emoji}</span> ${bi(c.nome)} <em>${itens.length}</em></h2>
    <div class="itens">
${itens.map(([r, n]) => linha(r, n)).join("\n")}
    </div>
  </section>`;
}

function chip(valor, rotulo, tipo) {
  return `      <button type="button" class="chip" data-${tipo}="${valor}" aria-pressed="false">${rotulo}</button>`;
}

export function pagina() {
  const total = RECURSOS.length;
  const gratis = RECURSOS.filter((r) => r.plano !== "pago").length;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CYRON — tudo que ele faz</title>
<meta name="description" content="As ${total} funções do CYRON, por categoria: traduzir, quem chega, viver junto, quem administra e confiança.">
<meta property="og:title" content="CYRON — tudo que ele faz">
<meta property="og:description" content="As ${total} funções do CYRON, por categoria. ${gratis} delas no plano grátis.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>">

<!-- ESTA PÁGINA É GERADA. Não edite à mão: quem manda é
     discord-bot-gateway/catalogo.js, e o gerador é fazer-recursos.js.
     Um teste compara este arquivo com o que o gerador produz agora. -->
<style>
:root{
  --fundo:#0B0D11; --painel:#13161C; --painel-2:#1A1E26; --painel-3:#222833;
  --borda:#232935; --borda-viva:#333B49;
  --texto:#EDEFF3; --fraco:#98A1AE; --fraquinho:#6C7583;
  --ambar:#F5A623; --ambar-claro:#FFC768; --verde:#5EBB83; --azul:#5865F2;
  --r:16px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--fundo); color:var(--texto);
  font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
a{color:var(--ambar); text-decoration:none}
a:hover{text-decoration:underline}
.env{max-width:1000px; margin:0 auto; padding:0 22px}
h1,h2,h3{line-height:1.15; margin:0; letter-spacing:-.022em}

.barra{position:sticky; top:0; z-index:30; background:rgba(11,13,17,.86); backdrop-filter:blur(12px); border-bottom:1px solid var(--borda)}
.barra .env{display:flex; align-items:center; gap:14px; height:60px}
.marca{font-weight:800; letter-spacing:.14em; font-size:15px; color:var(--texto)}
.marca b{color:var(--ambar); font-weight:800}
.barra nav{margin-left:auto; display:flex; align-items:center; gap:6px}
.barra nav a{color:var(--fraco); font-size:14.5px; padding:8px 11px; border-radius:9px; white-space:nowrap}
.barra nav a:hover{color:var(--texto); background:var(--painel-2); text-decoration:none}
.barra nav a[aria-current]{color:var(--texto); background:var(--painel-2)}
.idioma{display:flex; border:1px solid var(--borda-viva); border-radius:9px; overflow:hidden; margin-left:6px; flex:0 0 auto}
.idioma button{background:none; border:0; color:var(--fraco); font:700 12px/1 inherit; padding:8px 10px; cursor:pointer}
.idioma button[aria-pressed="true"]{background:var(--ambar); color:#1a1206}
@media (max-width:760px){
  .barra .env{height:auto; padding:9px 16px 0; flex-wrap:wrap; gap:0 10px}
  .barra nav{order:3; width:100%; margin:6px -16px 0; padding:0 16px 8px;
    overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none; gap:2px}
  .barra nav::-webkit-scrollbar{display:none}
  .barra nav a{padding:7px 10px; font-size:14px}
  .idioma{margin-left:auto}
}

/* Um topo de três linhas, e não de dez.
 *
 * Havia aqui um rótulo, um título, um parágrafo de três linhas e quatro
 * caixas de número. Nada errado -- e cinco coisas para ler antes de chegar na
 * lista, que é o que a pessoa veio ver. Ficou o título e uma linha. */
.topo{padding:52px 0 0}
.topo h1{font-size:clamp(28px,4.6vw,40px); font-weight:760}
.topo h1 em{font-style:normal; color:var(--ambar)}
.abre{margin:14px 0 0; color:var(--fraco); font-size:16px}

/* ---------- os filtros ----------

   Ficam grudados embaixo da barra: numa lista de ${total} itens, filtrar e ter
   que subir de volta para trocar o filtro é o mesmo que não ter filtro. */
/* Opaco, e não translúcido como a barra de cima: aqui passa um <h2> de 30px
   por baixo, e a 8% de transparência ele aparecia como um borrão atrás dos
   filtros -- parecia defeito de renderização. */
.filtros{position:sticky; top:60px; z-index:20; background:var(--fundo);
  border-bottom:1px solid var(--borda); margin-top:40px; padding:14px 0}
.filtros .env{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
/* O filtro de plano se distingue pela COR, e não por um separador.
   O separador era um risco de 1px que, quando a fileira quebrava, ficava
   pendurado no fim da primeira linha sem separar nada. Verde diz sozinho que
   ele não é mais uma categoria. */
.chip[data-plano]{color:var(--verde); border-color:rgba(94,187,131,.32)}
.chip[data-plano][aria-pressed="true"]{background:var(--verde); border-color:var(--verde); color:#08170e}
/* A busca ocupa a linha inteira. Dividindo a fileira com os chips ela tomava
   455px e empurrava um deles para uma segunda fileira sozinho. */
.busca{flex:1 1 100%; display:flex; align-items:center; gap:8px;
  background:var(--painel); border:1px solid var(--borda-viva); border-radius:10px; padding:0 12px}
.busca input{flex:1; background:none; border:0; color:var(--texto); font:15px/1 inherit; padding:11px 0; outline:none; min-width:0}
.busca input::placeholder{color:var(--fraquinho)}
.chips{display:flex; gap:6px; flex-wrap:wrap}
.chip{background:var(--painel); border:1px solid var(--borda-viva); color:var(--fraco);
  border-radius:999px; padding:9px 13px; font:600 13.5px/1 inherit; cursor:pointer; white-space:nowrap}
.chip:hover{color:var(--texto)}
.chip[aria-pressed="true"]{background:var(--ambar); border-color:var(--ambar); color:#1a1206}
@media (max-width:760px){
  .filtros{top:auto; position:static}
  .chips{width:100%; padding-bottom:2px}
}

/* ---------- a lista ----------

   Sem moldura, sem sombra, sem fundo por item: 30 caixas desenhadas é o que
   fazia a página parecer cheia. O que separa uma linha da outra é um risco de
   1px, e o que dá relevo é a linha em que o dedo está. */
main{padding:0 0 80px}
.env.lista{max-width:800px}
/* A barra de cima mais os filtros somam ~190px de coisa grudada no topo. Sem
   isto, clicar num link para #viver deixaria o título da categoria embaixo
   deles -- a página pularia para o lugar certo e mostraria o errado. */
.grupo{padding:44px 0 0; scroll-margin-top:200px}
.grupo h2{font-size:19px; font-weight:700; display:flex; align-items:center; gap:9px;
  color:var(--fraco); letter-spacing:0}
.grupo h2 .emoji{font-size:1.05em}
.grupo h2 em{font-style:normal; font-size:13px; font-weight:600; color:var(--fraquinho)}

.itens{margin-top:8px; border-top:1px solid var(--borda)}
.item{border-bottom:1px solid var(--borda)}

.linha{width:100%; display:flex; align-items:center; gap:14px; text-align:left;
  background:none; border:0; color:inherit; font:inherit; cursor:pointer; padding:13px 6px}
.linha:hover{background:var(--painel)}
.linha .n{flex:0 0 auto; color:var(--fraquinho); font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.linha .nome{flex:1; font-size:16px; font-weight:600; min-width:0}
.linha .pago{flex:0 0 auto; font-size:11.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--ambar); border:1px solid rgba(245,166,35,.32); border-radius:999px; padding:3px 8px}
.linha .seta{flex:0 0 auto; color:var(--fraquinho); font-size:19px; line-height:1;
  transition:transform .15s ease}
.linha[aria-expanded="true"]{background:var(--painel)}
.linha[aria-expanded="true"] .n{color:var(--ambar)}
.linha[aria-expanded="true"] .seta{transform:rotate(90deg)}

.detalhe{padding:0 6px 16px 46px; background:var(--painel)}
.detalhe p{margin:0; color:var(--fraco); font-size:15px; line-height:1.6; max-width:62ch}
.detalhe .como{margin-top:9px; font-size:13.5px; color:var(--fraquinho)}
.detalhe .rot{color:var(--fraquinho); font-weight:700; text-transform:uppercase;
  letter-spacing:.08em; font-size:11px; margin-right:7px}
@media (max-width:560px){ .detalhe{padding-left:6px} }

.vazio{display:none; padding:60px 0; color:var(--fraco)}
body[data-vazio] .vazio{display:block}
.item[hidden],.grupo[hidden]{display:none}

/* ---------- fecho ---------- */
.fecho{border-top:1px solid var(--borda); margin-top:70px; padding:64px 0; text-align:center}
.fecho h2{font-size:clamp(23px,3.4vw,32px)}
.fecho p{color:var(--fraco); margin:16px auto 0; max-width:540px}
.bt{display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:14px 24px;
  border-radius:12px; font-weight:650; font-size:15.5px; border:1px solid transparent; cursor:pointer;
  transition:transform .13s ease, filter .13s ease; margin-top:28px}
.bt:hover{text-decoration:none; transform:translateY(-1px); filter:brightness(1.08)}
.bt-1{background:var(--azul); color:#fff; box-shadow:0 8px 26px -12px rgba(88,101,242,.9)}

footer{border-top:1px solid var(--borda); padding:28px 0; color:var(--fraquinho); font-size:14px}
footer .env{display:flex; gap:18px; flex-wrap:wrap}
footer nav{margin-left:auto; display:flex; gap:18px; flex-wrap:wrap}

[data-en]{display:none}
html[lang="en"] [data-pt]{display:none}
html[lang="en"] [data-en]{display:revert}
</style>
</head>
<body>

<header class="barra">
  <div class="env">
    <a class="marca" href="./">CY<b>RON</b></a>
    <nav>
      <a href="./"><span data-pt>Início</span><span data-en>Home</span></a>
      <a href="./recursos.html" aria-current="page"><span data-pt>Tudo que ele faz</span><span data-en>Everything it does</span></a>
      <a href="./#planos"><span data-pt>Planos</span><span data-en>Pricing</span></a>
      <a href="./painel.html"><span data-pt>Meus servidores</span><span data-en>My servers</span></a>
    </nav>
    <div class="idioma" role="group" aria-label="Idioma / Language">
      <button type="button" data-troca="pt" aria-pressed="true">PT</button>
      <button type="button" data-troca="en" aria-pressed="false">EN</button>
    </div>
  </div>
</header>

<div class="topo">
  <div class="env lista">
    <h1>
      <span data-pt><em>${total} coisas</em> que o CYRON faz</span>
      <span data-en><em>${total} things</em> CYRON does</span>
    </h1>
    <p class="abre">
      <span data-pt>${gratis} delas no plano grátis. Toque em qualquer uma para ver o que faz.</span>
      <span data-en>${gratis} of them on the free plan. Tap any one to see what it does.</span>
    </p>
  </div>
</div>

<div class="filtros">
  <div class="env lista">
    <label class="busca">
      <span aria-hidden="true">🔎</span>
      <input type="search" id="busca" autocomplete="off"
        data-pt-ph="Procurar: bandeira, evento, arena…" data-en-ph="Search: flag, event, arena…">
    </label>
    <div class="chips" role="group">
${chip("", `<span data-pt>Tudo</span><span data-en>All</span>`, "cat")}
${CATEGORIAS.map((c) => chip(c.chave, `${c.emoji} ${bi(c.nome)}`, "cat")).join("\n")}
${chip("gratis", `<span data-pt>grátis</span><span data-en>free</span>`, "plano")}
    </div>
  </div>
</div>

<main>
  <div class="env lista">
${CATEGORIAS.map(secao).join("\n")}

    <div class="vazio">
      <p><span data-pt>Nada com esse nome. Tente “bandeira”, “evento” ou “sala”.</span><span data-en>Nothing by that name. Try “flag”, “event” or “room”.</span></p>
    </div>
  </div>
</main>

<div class="fecho">
  <div class="env lista">
    <h2><span data-pt>Põe no seu servidor e vê.</span><span data-en>Put it in your server and see.</span></h2>
    <a class="bt bt-1 convite" href="./"><span data-pt>Adicionar o CYRON</span><span data-en>Add CYRON</span></a>
  </div>
</div>

<footer>
  <div class="env">
    <span>CYRON</span>
    <nav>
      <a href="./"><span data-pt>Início</span><span data-en>Home</span></a>
      <a href="./privacidade.html"><span data-pt>Privacidade</span><span data-en>Privacy</span></a>
      <a href="./termos.html"><span data-pt>Termos de uso</span><span data-en>Terms of use</span></a>
    </nav>
  </div>
</footer>

<script>
var CLIENT_ID = "1498142929041096856";
var PERMISSOES = "327223209040";
var CONVITE = "https://discord.com/oauth2/authorize?client_id=" + CLIENT_ID +
  "&permissions=" + PERMISSOES + "&scope=bot%20applications.commands";
[].forEach.call(document.querySelectorAll(".convite"), function (a) { a.href = CONVITE; });

/* ---- PT / EN ---- */
function idioma(qual) {
  document.documentElement.lang = qual === "en" ? "en" : "pt-BR";
  [].forEach.call(document.querySelectorAll("[data-troca]"), function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.troca === qual));
  });
  /* O texto do campo de busca não é elemento, é atributo: o truque do CSS com
     data-pt/data-en não alcança ele, e sem isto a busca continuaria pedindo
     "Procurar: bandeira" para quem está lendo a página em inglês. */
  var b = document.getElementById("busca");
  if (b) b.placeholder = qual === "en" ? b.dataset.enPh : b.dataset.ptPh;
  try { localStorage.setItem("cyron-idioma", qual); } catch (e) { /* aba anônima */ }
}
[].forEach.call(document.querySelectorAll("[data-troca]"), function (b) {
  b.addEventListener("click", function () { idioma(b.dataset.troca); });
});
(function () {
  var guardado = null;
  try { guardado = localStorage.getItem("cyron-idioma"); } catch (e) { /* idem */ }
  if (guardado) return idioma(guardado);
  var nav = (navigator.language || "pt").toLowerCase();
  idioma(nav.indexOf("pt") === 0 ? "pt" : "en");
})();

/* ---- abrir e fechar uma linha ----

   Uma de cada vez. Deixar várias abertas devolve a página à parede de texto
   que ela era, e ninguém abre duas para comparar -- abre uma, lê, abre a
   próxima. Fechar a anterior é o que mantém a lista sendo uma lista. */
var aberta = null;
function abrir(linha) {
  var eraEla = aberta === linha;
  if (aberta) {
    aberta.setAttribute("aria-expanded", "false");
    aberta.parentNode.querySelector(".detalhe").hidden = true;
  }
  aberta = null;
  if (eraEla) return;
  linha.setAttribute("aria-expanded", "true");
  linha.parentNode.querySelector(".detalhe").hidden = false;
  aberta = linha;
}
[].forEach.call(document.querySelectorAll(".linha"), function (b) {
  b.addEventListener("click", function () { abrir(b); });
});

/* ---- os filtros ----

   Categoria e plano são independentes de propósito: "só o que é grátis"
   continua valendo enquanto se passeia pelas categorias. Sem isso, escolher
   uma categoria apagaria o filtro de plano sem avisar, e a lista mudaria por
   um motivo que ninguém pediu. */
var categoria = "";
var sograte = false;
var termo = "";

function marcar(selector, atual) {
  [].forEach.call(document.querySelectorAll(selector), function (b) {
    b.setAttribute("aria-pressed", String(atual(b)));
  });
}

function aplicar() {
  var achou = 0;
  var unico = null;
  [].forEach.call(document.querySelectorAll(".grupo"), function (g) {
    var vivos = 0;
    [].forEach.call(g.querySelectorAll(".item"), function (r) {
      var passa =
        (!categoria || r.dataset.cat === categoria) &&
        (!sograte || r.dataset.plano !== "pago") &&
        (!termo || r.dataset.busca.indexOf(termo) >= 0);
      r.hidden = !passa;
      if (passa) { vivos++; unico = r; }
    });
    g.hidden = vivos === 0;
    /* O número ao lado do título conta o que está À VISTA. Procurar "arena" e
       ver "Viver junto 4" com uma linha embaixo é a página se contradizendo
       na mesma tela. */
    var conta = g.querySelector("h2 em");
    if (conta) conta.textContent = vivos;
    achou += vivos;
  });
  if (achou) document.body.removeAttribute("data-vazio");
  else document.body.setAttribute("data-vazio", "1");

  /* Sobrou um só: abre. Quem digitou até restar um item já disse qual queria
     -- pedir mais um clique para ver a resposta é cobrar duas vezes pela
     mesma pergunta. */
  var so = achou === 1 ? unico.querySelector(".linha") : null;
  /* A função abrir ALTERNA: chamada na linha já aberta, ela fecha. Sem esta
     guarda, cada tecla digitada depois de sobrar um item abriria e fecharia
     o detalhe. */
  if (termo && so && aberta !== so) abrir(so);
}

[].forEach.call(document.querySelectorAll("[data-cat]"), function (b) {
  if (b.tagName !== "BUTTON") return;
  b.addEventListener("click", function () {
    categoria = b.dataset.cat;
    marcar(".chip[data-cat]", function (o) { return o.dataset.cat === categoria; });
    aplicar();
  });
});
[].forEach.call(document.querySelectorAll(".chip[data-plano]"), function (b) {
  b.addEventListener("click", function () {
    sograte = !sograte;
    b.setAttribute("aria-pressed", String(sograte));
    aplicar();
  });
});
document.getElementById("busca").addEventListener("input", function (e) {
  /* Minúsculas e sem acento dos dois lados: quem procura "traducao" tem que
     achar "tradução", senão a busca só serve para quem já sabe escrever o
     nome exato do recurso. */
  termo = e.target.value.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  aplicar();
});

marcar(".chip[data-cat]", function (o) { return o.dataset.cat === categoria; });
</script>

</body>
</html>
`;
}

/* Rodar direto escreve; importar (o teste) só usa a função. */
if (process.argv[1] && process.argv[1].endsWith("fazer-recursos.js")) {
  const novo = pagina();
  const velho = (() => { try { return readFileSync(DESTINO, "utf8"); } catch { return null; } })();
  writeFileSync(DESTINO, novo);
  console.log(velho === novo
    ? `cyron/recursos.html já estava em dia (${RECURSOS.length} recursos).`
    : `cyron/recursos.html reescrito: ${RECURSOS.length} recursos em ${CATEGORIAS.length} categorias.`);
}
