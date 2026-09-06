/* Prova que o mundo VIVE -- e, mais que isso, que ele nao para.
 *
 *   node vive.mjs
 *
 * Existe por causa de um defeito que so aparecia depois de uns dois mil
 * passos: as civs batiam no ultimo nivel, as casas paravam de subir e o
 * territorio congelava num numero que nao mudava mais nunca. Na tela ainda
 * havia gente andando, entao parecia vivo -- e nao estava mais acontecendo
 * nada. Olhar por dez segundos no navegador nunca pegaria isso.
 *
 * Por isso o teste nao pergunta "rodou sem erro?", e sim "no fim ainda estava
 * MUDANDO?". Ele falha (codigo 1) se o mundo estagnar. */
import { mundoNovo, semearPovo, passo, contar, nivelDe, terrasDe, CORES, NOMES } from "./mundo.js";

const PASSOS = 6000;
const m = mundoNovo(48, 90, 12345);

let terra = 0;
for (const t of m.terreno) if (t >= 1 && t <= 3) terra++;
console.log(`mapa ${m.L}x${m.A} · ${Math.round(terra / m.terreno.length * 100)}% de terra firme`);

semearPovo(m, 14, 20, CORES[0], NOMES[0]);
semearPovo(m, 30, 62, CORES[1], NOMES[1]);

const foto = () => ({
  casas: m.casas.length,
  terra: m.povos.reduce((s, p) => s + terrasDe(m, p.id), 0),
  nivel: m.povos.reduce((s, p) => s + nivelDe(p), 0),
});

const t0 = Date.now();
let meio = null;
for (let t = 1; t <= PASSOS; t++) {
  passo(m);
  if (t === Math.floor(PASSOS / 2)) meio = foto();
  if (t % 1000 === 0) {
    console.log(`t=${String(t).padStart(4)} · gente ${m.povos.map((p) => contar(m, p.id)).join("/")}`
      + ` · terra ${m.povos.map((p) => terrasDe(m, p.id)).join("/")}`
      + ` · casas ${m.casas.length} · nivel ${m.povos.map(nivelDe).join("/")}`);
  }
}
const fim = foto();
console.log(`${PASSOS} passos em ${Date.now() - t0}ms`);

console.log("\n--- diario ---");
for (const d of m.diario.slice(-12)) console.log(`t=${String(d.tempo).padStart(4)} ${d.texto}`);

/* ---- o que tem que ser verdade ---- */
const falhas = [];
const vivos = m.povos.filter((p) => contar(m, p.id) > 0).length;
if (!vivos) falhas.push("nao sobrou ninguem vivo no fim");
if (m.casas.length < 20) falhas.push(`poucas casas no fim (${m.casas.length}) -- ninguem se assentou`);

/* O coracao do teste: comparar a segunda metade com a primeira. */
if (fim.casas <= meio.casas && fim.terra <= meio.terra && fim.nivel <= meio.nivel) {
  falhas.push(`mundo estagnado: na metade era casas=${meio.casas} terra=${meio.terra} nivel=${meio.nivel},`
    + ` no fim casas=${fim.casas} terra=${fim.terra} nivel=${fim.nivel} -- nada avancou na segunda metade`);
}

/* Um diario que se repete e' um diario que ninguem le. */
const textos = m.diario.map((d) => d.texto);
const repetida = textos.find((t) => textos.filter((o) => o === t).length > 2);
if (repetida) falhas.push(`linha repetida demais no diario: "${repetida}"`);

console.log("");
if (falhas.length) {
  for (const f of falhas) console.log("FALHOU: " + f);
  process.exit(1);
}
console.log(`passou · o mundo cresceu de casas=${meio.casas}/terra=${meio.terra}/nivel=${meio.nivel}`
  + ` para casas=${fim.casas}/terra=${fim.terra}/nivel=${fim.nivel} na segunda metade`);
