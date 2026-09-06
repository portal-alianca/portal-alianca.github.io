/* Quarenta anos de reino, em texto.
 *
 * Este arquivo não é o jogo — é a PERGUNTA. Ler isto é interessante? As
 * escolhas são difíceis? A conta atrasada aparece e dá para ligar uma coisa
 * à outra?
 *
 * Se sair morno, o desenho não salvaria, e ficamos sabendo agora.
 */
import { reinoNovo, umAno, peticaoDoAno, decidir } from "./reino.js";

/* Três reis, para ver se o reino responde a QUEM manda -- e não só ao acaso.
   Mesma semente para os três: toda diferença na crônica é escolha, não sorte. */
const REIS = {
  "o generoso": (p) => p.opcoes.findIndex((o) => /Abrir|Financiar|Proteger|Racionar|Construir/.test(o.rotulo)),
  "o avarento": (p) => p.opcoes.findIndex((o) => /fechado|embora|Deixar|Ano que vem|Pagar/.test(o.rotulo)),
  "o guerreiro": (p) => p.opcoes.findIndex((o) => /Marchar|exército|Abrir a mina|Tomar/.test(o.rotulo)),
};

const barra = (n, teto = 100) => "█".repeat(Math.round((Math.max(0, n) / teto) * 10)).padEnd(10, "·");

for (const [nome, comoDecide] of Object.entries(REIS)) {
  const R = reinoNovo(7);
  console.log(`\n${"═".repeat(66)}\n  ${nome.toUpperCase()}\n${"═".repeat(66)}`);

  for (let i = 0; i < 40 && !R.fim; i++) {
    umAno(R);
    if (R.fim) break;
    const p = peticaoDoAno(R);
    if (!p || !p.opcoes.length) continue;

    const escolha = Math.max(0, comoDecide(p));
    console.log(`\n  Ano ${String(R.ano).padStart(2)} · ${p.titulo}`);
    console.log(`     ${p.texto}`);
    console.log(`     ${p.opcoes.map((o, k) => (k === escolha ? `▸ ${o.rotulo}` : `  ${o.rotulo}`)).join("   ")}`);
    decidir(R, p, escolha);
    /* Só o que aconteceu DEPOIS da decisão deste ano. */
    for (const c of R.cronica.filter((c) => c.ano === R.ano)) console.log(`     → ${c.texto}`);
  }

  /* As contas atrasadas que chegaram sozinhas, sem petição no meio. */
  const soltas = R.cronica.filter((c) => /rio|canais|norte/.test(c.texto) && c.ano > 0);
  console.log(`\n  ${"─".repeat(62)}`);
  console.log(`  Fim: ${R.fim || `reinou os 40 anos e morreu na cama.`}`);
  console.log(`  povo ${String(R.povo).padStart(4)}  ouro ${String(R.ouro).padStart(4)}  saber ${String(R.saber).padStart(3)}`);
  console.log(`  fé      ${barra(R.fe)}   espada ${barra(R.espada)}`);
  console.log(`  ${R.decisoes.length} decisões · ${R.tem.size ? [...R.tem].join(", ") : "nada construído"}`);
}
