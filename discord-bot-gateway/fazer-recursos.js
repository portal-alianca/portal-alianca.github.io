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

const SELO = {
  gratis: { pt: "Grátis", en: "Free" },
  pago: { pt: "Plano pago", en: "Paid plan" },
  ambos: { pt: "Nos dois planos", en: "Both plans" },
};

/* O texto que a busca varre.
 *
 * Sem acento dos DOIS lados. O campo de busca tira o acento do que se digita;
 * se aqui ficasse "tradução" acentuado, procurar "traducao" não acharia nada
 * -- e a busca só serviria para quem já sabe escrever o nome exato. */
function paraBuscar(r) {
  const tudo = `${r.nome.pt} ${r.nome.en} ${r.oque.pt} ${r.oque.en} ${r.como.pt} ${r.como.en} ${r.chave}`;
  return tudo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cartao(r, numero) {
  return `      <article class="rec" data-plano="${r.plano}" data-cat="${r.categoria}" data-busca="${esc(paraBuscar(r))}">
        <div class="n">${numero}</div>
        <div class="corpo">
          <h3>${bi(r.nome)}</h3>
          <p>${bi(r.oque)}</p>
          <div class="selos">
            <span class="selo ${r.plano}">${bi(SELO[r.plano])}</span>
            <span class="como">${bi(r.como)}</span>
          </div>
        </div>
      </article>`;
}

function secao(c) {
  const itens = RECURSOS
    .map((r, i) => [r, i + 1])
    .filter(([r]) => r.categoria === c.chave);
  return `  <section class="grupo" id="${c.chave}" data-cat="${c.chave}">
    <div class="cab">
      <h2><span class="emoji">${c.emoji}</span> ${bi(c.nome)} <em>${itens.length}</em></h2>
      <p>${bi(c.resumo)}</p>
    </div>
    <div class="recs">
${itens.map(([r, n]) => cartao(r, n)).join("\n")}
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

.topo{padding:70px 0 0; position:relative; overflow:hidden}
.topo::before{content:""; position:absolute; inset:-40% 30% auto; height:460px;
  background:radial-gradient(closest-side,rgba(245,166,35,.13),transparent 72%); pointer-events:none}
.rotulo{font-size:12px; font-weight:750; letter-spacing:.18em; text-transform:uppercase; color:var(--ambar); margin-bottom:14px; position:relative}
.topo h1{font-size:clamp(30px,5.2vw,46px); font-weight:760; position:relative}
.topo h1 em{font-style:normal; color:var(--ambar)}
.abre{margin:20px 0 0; color:var(--fraco); max-width:660px; font-size:18px; position:relative}

.contas{display:flex; gap:10px; flex-wrap:wrap; margin-top:26px; position:relative}
.conta{background:var(--painel); border:1px solid var(--borda); border-radius:12px; padding:11px 15px; font-size:14px; color:var(--fraco)}
.conta b{color:var(--texto); font-weight:700}

/* ---------- os filtros ----------

   Ficam grudados embaixo da barra: numa lista de ${total} itens, filtrar e ter
   que subir de volta para trocar o filtro é o mesmo que não ter filtro. */
/* Opaco, e não translúcido como a barra de cima: aqui passa um <h2> de 30px
   por baixo, e a 8% de transparência ele aparecia como um borrão atrás dos
   filtros -- parecia defeito de renderização. */
.filtros{position:sticky; top:60px; z-index:20; background:var(--fundo);
  border-bottom:1px solid var(--borda); margin-top:40px; padding:14px 0}
.filtros .env{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
/* O separador antes do filtro de plano: ele não é mais uma categoria, e sem
   isso a fileira lia como se fosse. */
.sep{width:1px; align-self:stretch; background:var(--borda-viva); margin:2px 4px}
.busca{flex:1 1 190px; min-width:150px; display:flex; align-items:center; gap:8px;
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
  /* No telefone os chips quebram em três fileiras, e o separador cai sozinho
     no começo de uma delas -- vira um risco solto que não separa nada. */
  .sep{display:none}
}

/* ---------- os grupos ---------- */
main{padding:0 0 90px}
/* A barra de cima mais os filtros somam ~190px de coisa grudada no topo. Sem
   isto, clicar num link para #viver deixaria o título da categoria embaixo
   deles -- a página pularia para o lugar certo e mostraria o errado. */
.grupo{padding:56px 0 0; scroll-margin-top:200px}
.grupo .cab{max-width:680px}
.grupo h2{font-size:clamp(22px,3vw,30px); display:flex; align-items:center; gap:11px; flex-wrap:wrap}
.grupo h2 .emoji{font-size:.95em}
.grupo h2 em{font-style:normal; font-size:13px; font-weight:700; color:var(--fraquinho);
  border:1px solid var(--borda-viva); border-radius:999px; padding:3px 9px; letter-spacing:.02em}
.grupo .cab p{color:var(--fraco); margin:12px 0 0; font-size:16px}

.recs{display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(400px,1fr)); margin-top:24px}
@media (max-width:900px){ .recs{grid-template-columns:1fr} }

.rec{display:flex; gap:15px; background:var(--painel); border:1px solid var(--borda);
  border-radius:var(--r); padding:17px 19px}
.rec .n{flex:0 0 34px; height:34px; border-radius:10px; background:var(--painel-3);
  border:1px solid var(--borda-viva); color:var(--ambar);
  display:flex; align-items:center; justify-content:center;
  font:700 14px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.rec .corpo{min-width:0}
.rec h3{font-size:17px; font-weight:700}
.rec p{margin:8px 0 0; color:var(--fraco); font-size:15px; line-height:1.6}
.selos{display:flex; gap:7px; flex-wrap:wrap; margin-top:12px; align-items:center}
.selo{font-size:12px; font-weight:700; border-radius:999px; padding:4px 10px; border:1px solid transparent}
.selo.gratis{color:var(--verde); border-color:rgba(94,187,131,.35); background:rgba(94,187,131,.09)}
.selo.pago{color:var(--ambar-claro); border-color:rgba(245,166,35,.35); background:rgba(245,166,35,.09)}
.selo.ambos{color:var(--fraco); border-color:var(--borda-viva); background:var(--painel-2)}
.como{font-size:12.5px; color:var(--fraquinho); font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

.vazio{display:none; padding:70px 0; text-align:center; color:var(--fraco)}
body[data-vazio] .vazio{display:block}
.rec[hidden],.grupo[hidden]{display:none}

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
  <div class="env">
    <div class="rotulo"><span data-pt>O catálogo</span><span data-en>The catalogue</span></div>
    <h1>
      <span data-pt>As <em>${total} coisas</em> que o CYRON faz</span>
      <span data-en>The <em>${total} things</em> CYRON does</span>
    </h1>
    <p class="abre">
      <span data-pt>Numeradas, por categoria, e com o plano de cada uma à mostra. Esta página nasce da mesma lista que o bot usa — se um recurso sair do código, ele sai daqui junto.</span>
      <span data-en>Numbered, grouped, and with each one's plan in plain sight. This page is generated from the same list the bot itself uses — if a feature leaves the code, it leaves this page with it.</span>
    </p>
    <div class="contas">
      <div class="conta"><b>${total}</b> <span data-pt>funções</span><span data-en>features</span></div>
      <div class="conta"><b>${gratis}</b> <span data-pt>no plano grátis</span><span data-en>on the free plan</span></div>
      <div class="conta"><b>20</b> <span data-pt>idiomas</span><span data-en>languages</span></div>
      <div class="conta"><b>${CATEGORIAS.length}</b> <span data-pt>categorias</span><span data-en>categories</span></div>
    </div>
  </div>
</div>

<div class="filtros">
  <div class="env">
    <label class="busca">
      <span aria-hidden="true">🔎</span>
      <input type="search" id="busca" autocomplete="off"
        data-pt-ph="Procurar: bandeira, evento, arena…" data-en-ph="Search: flag, event, arena…">
    </label>
    <div class="chips" role="group">
${chip("", `<span data-pt>Tudo</span><span data-en>All</span>`, "cat")}
${CATEGORIAS.map((c) => chip(c.chave, `${c.emoji} ${bi(c.nome)}`, "cat")).join("\n")}
      <span class="sep" aria-hidden="true"></span>
${chip("gratis", `<span data-pt>Só o que é grátis</span><span data-en>Free only</span>`, "plano")}
    </div>
  </div>
</div>

<main>
  <div class="env">
${CATEGORIAS.map(secao).join("\n")}

    <div class="vazio">
      <p><span data-pt>Nada com esse nome. Tente “bandeira”, “evento” ou “sala”.</span><span data-en>Nothing by that name. Try “flag”, “event” or “room”.</span></p>
    </div>
  </div>
</main>

<div class="fecho">
  <div class="env">
    <h2><span data-pt>Põe no seu servidor e vê.</span><span data-en>Put it in your server and see.</span></h2>
    <p>
      <span data-pt>As ${gratis} funções do plano grátis já funcionam no minuto em que ele entra. Nenhuma delas vence.</span>
      <span data-en>The ${gratis} free-plan features work the minute it joins. None of them expire.</span>
    </p>
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
  [].forEach.call(document.querySelectorAll(".grupo"), function (g) {
    var vivos = 0;
    [].forEach.call(g.querySelectorAll(".rec"), function (r) {
      var passa =
        (!categoria || r.dataset.cat === categoria) &&
        (!sograte || r.dataset.plano !== "pago") &&
        (!termo || r.dataset.busca.indexOf(termo) >= 0);
      r.hidden = !passa;
      if (passa) vivos++;
    });
    g.hidden = vivos === 0;
    achou += vivos;
  });
  if (achou) document.body.removeAttribute("data-vazio");
  else document.body.setAttribute("data-vazio", "1");
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
