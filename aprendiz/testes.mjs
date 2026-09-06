/* Os testes do Aprendiz.
 *
 * Rodam sem navegador e sem tela. Existem porque as duas coisas que podem
 * estar erradas aqui são invisíveis olhando o jogo:
 *
 * 1. Se `olhar()` descrever o mundo errado, ela aprende a coisa errada -- e o
 *    número de acerto SOBE do mesmo jeito, porque ele mede se ela concorda
 *    com você, e você não vê o que ela vê.
 * 2. Se o treino não estiver aprendendo de verdade, o acerto fica passeando
 *    perto de 33% (o acaso entre três ações) e parece "ela ainda é burrinha".
 *
 * O último teste é o que vale por todos: um professor de mentira, que joga
 * sempre pela mesma regra, tem que ser imitado bem. Se ela não consegue
 * copiar uma regra fixa, não vai copiar uma pessoa.
 */
import { jogoNovo, andar, olhar, acaoEntre, paraOnde, DIRECOES, RETO, DIREITA, ESQUERDA, LARGURA, ALTURA } from "./jogo.js";
import { treinar, decidir, guardarCerebro, lerCerebro, cerebroNovo } from "./cerebro.js";

let passou = 0; const falhou = [];
const ok = (nome, real, esperado) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) return passou++;
  falhou.push(`${nome}\n      esperava: ${JSON.stringify(esperado)}\n      veio:     ${JSON.stringify(real)}`);
};
const verdade = (nome, v) => ok(nome, !!v, true);

/* ---------------- o jogo ---------------- */
{
  const j = jogoNovo(() => 0.5);
  ok("nasce com três pedaços", j.corpo.length, 3);
  verdade("nasce viva", j.viva);
  verdade("nasce com comida na mesa", !!j.comida);

  /* Virar à direita é +1 no relógio, à esquerda é -1. Se esta ordem inverter,
     ela vira para o lado errado e nada mais no jogo acusa. */
  ok("da direita para baixo", paraOnde(1, DIREITA), 2);
  ok("da direita para cima", paraOnde(1, ESQUERDA), 0);
  ok("reto não vira", paraOnde(1, RETO), 1);
  ok("dá a volta no relógio", paraOnde(3, DIREITA), 0);
}

{
  /* Bater na parede mata. */
  const j = jogoNovo(() => 0.5);
  j.corpo = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  j.dir = 3; // esquerda, para fora
  const r = andar(j, RETO);
  verdade("bater na parede mata", r.morreu && !j.viva);
}

{
  /* Seguir a própria cauda NÃO é bater: o último pedaço sai no mesmo instante
     em que a cabeça entra. Contar como batida mataria a cobra em curvas que
     qualquer um faz sem pensar. */
  const j = jogoNovo(() => 0.5);
  j.corpo = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }];
  j.dir = 1; // direita; a ponta da cauda está em (6,5)
  const r = andar(j, RETO);
  verdade("entrar onde a cauda está saindo não mata", !r.morreu);
}

{
  /* Comer cresce e não anda a cauda. */
  const j = jogoNovo(() => 0.5);
  j.corpo = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }];
  j.dir = 0;
  j.comida = { x: 5, y: 4 };
  const antes = j.corpo.length;
  const r = andar(j, RETO);
  verdade("comer marca ponto", r.comeu && j.pontos === 1);
  ok("e a cobra cresce um", j.corpo.length, antes + 1);
  verdade("e nasce comida nova", !!j.comida && !(j.comida.x === 5 && j.comida.y === 4));
}

{
  /* Andar em círculo não pode durar para sempre, senão a partida DELA nunca
     termina e a tela fica travada esperando. */
  const j = jogoNovo(() => 0.5);
  let voltas = 0;
  while (j.viva && voltas < 5000) { andar(j, DIREITA); voltas++; }
  verdade("rodar em círculo sem comer acaba", !j.viva && voltas < 5000);
}

/* ---------------- o que ela vê ---------------- */
{
  const j = jogoNovo(() => 0.5);
  j.corpo = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }];
  j.dir = 0; // cima
  j.comida = { x: 8, y: 2 };
  const x = olhar(j);
  ok("são onze números", x.length, 11);
  ok("sem perigo nenhum à volta", [x[0], x[1], x[2]], [0, 0, 0]);
  ok("a direção sai marcada só numa casa", [x[3], x[4], x[5], x[6]], [1, 0, 0, 0]);
  ok("a comida está acima e à direita", [x[7], x[8], x[9], x[10]], [1, 1, 0, 0]);

  /* Encostada na parede de cima, o perigo tem que aparecer NA FRENTE. */
  const k = jogoNovo(() => 0.5);
  k.corpo = [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }];
  k.dir = 0;
  ok("parede na frente é perigo na frente", olhar(k)[0], 1);
}

{
  /* A tradução do dedo para o pensamento dela. */
  ok("mesmo rumo é reto", acaoEntre(1, 1), RETO);
  ok("um passo no relógio é direita", acaoEntre(1, 2), DIREITA);
  ok("um passo contra o relógio é esquerda", acaoEntre(1, 0), ESQUERDA);
  /* Meia-volta mataria na hora. Vira reto em vez de virar morte por dedo
     torto -- e, principalmente, não entra na memória como uma jogada que
     você "fez", porque você não fez. */
  ok("meia-volta não existe", acaoEntre(1, 3), RETO);
}

/* ---------------- ela aprende mesmo? ---------------- */

/* Um professor de mentira: desvia do perigo e, quando dá, anda na direção da
   comida. É uma regra fixa e sem gosto nenhum -- de propósito. Se ela não
   consegue copiar ISTO, não copia uma pessoa. */
function professor(j) {
  const x = olhar(j);
  const [pf, pd, pe] = [x[0], x[1], x[2]];
  const querCima = x[7], querDir = x[8], querBaixo = x[9], querEsq = x[10];
  const rumoDe = (a) => paraOnde(j.dir, a);
  const bom = (a) => {
    const d = rumoDe(a);
    return (d === 0 && querCima) || (d === 1 && querDir) || (d === 2 && querBaixo) || (d === 3 && querEsq);
  };
  const livres = [[RETO, pf], [DIREITA, pd], [ESQUERDA, pe]].filter(([, p]) => !p).map(([a]) => a);
  if (!livres.length) return RETO;
  return livres.find(bom) ?? livres[0];
}

{
  const memoria = [];
  for (let partida = 0; partida < 40; partida++) {
    const j = jogoNovo();
    while (j.viva && memoria.length < 4000) {
      const x = olhar(j);
      const a = professor(j);
      memoria.push({ x, a });
      andar(j, a);
    }
  }
  verdade("o professor gerou jogadas suficientes", memoria.length > 500);

  const r = treinar(memoria);
  /* O acaso entre três ações é 33%. Copiar uma regra fixa tem que ficar bem
     acima disso -- se ficar rente, o treino não está treinando. */
  verdade(`ela copia o professor bem acima do acaso (deu ${(r.acerto * 100).toFixed(0)}%)`, r.acerto > 0.75);
  verdade("e a curva de aprendizado sobe do começo ao fim",
    r.curva[r.curva.length - 1] > r.curva[0]);

  /* E o que interessa de verdade: ela JOGA, e não só concorda. */
  let pontos = 0;
  for (let p = 0; p < 20; p++) {
    const j = jogoNovo();
    while (j.viva) andar(j, decidir(r.cerebro, olhar(j)));
    pontos += j.pontos;
  }
  verdade(`ela come de verdade jogando sozinha (${pontos} em 20 partidas)`, pontos >= 20);

  /* ---- o cérebro cabe num texto, que é o que faz "salvar a minha IA" existir ---- */
  const texto = guardarCerebro(r.cerebro);
  verdade("o cérebro cabe em poucos KB", texto.length < 12000);
  const devolta = lerCerebro(texto);
  verdade("e volta inteiro", !!devolta);
  let iguais = 0, total = 0;
  for (let i = 0; i < 200; i++) {
    const j = jogoNovo();
    const x = olhar(j);
    if (decidir(r.cerebro, x) === decidir(devolta, x)) iguais++;
    total++;
  }
  ok("e decide igual depois de voltar", iguais, total);

  verdade("texto estragado é recusado em vez de virar decisão sem sentido",
    lerCerebro("{lixo") === null && lerCerebro('{"v":9}') === null);
  /* Cérebro de outro tamanho entraria e daria decisão sem sentido. */
  verdade("cérebro de outro formato também é recusado",
    lerCerebro(JSON.stringify({ v: 1, w1: [1, 2], b1: [1], w2: [1], b2: [1] })) === null);
}

{
  /* Com pouquíssima coisa ela não pode ESTOURAR -- tem que devolver um número
     humilde. A pessoa vai apertar "ela tenta" na primeira partida. */
  const r = treinar([{ x: new Float64Array(11), a: 0 }]);
  verdade("uma jogada só não quebra o treino", r && typeof r.acerto === "number");
  const vazio = cerebroNovo();
  verdade("cérebro recém-nascido decide alguma coisa sem estourar",
    [0, 1, 2].includes(decidir(vazio, new Float64Array(11))));
}

if (falhou.length) {
  console.log(`\n  ${falhou.length} de ${passou + falhou.length} falharam:\n`);
  for (const f of falhou) console.log(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log(`  ${passou} testes passaram.`);
