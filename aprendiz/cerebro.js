/* O cérebro dela.
 *
 * Uma rede pequena, escrita à mão, sem biblioteca nenhuma. São 11 números
 * entrando, 16 no meio, 3 saindo -- e as 3 saídas são as únicas coisas que
 * ela pode decidir: seguir reto, virar à direita, virar à esquerda.
 *
 * POR QUE À MÃO, e não uma biblioteca: o arquivo inteiro tem que caber no
 * celular de quem instala, e uma biblioteca de rede neural pesa mais que o
 * app todo. Aqui são duas contas de matriz. Não há mágica escondida, e é
 * justamente por isso que dá para mostrar o que ela aprendeu sem mentir.
 *
 * E ela aprende DE VERDADE. Barra de progresso falsa seria mais fácil de
 * escrever e não valeria nada: o número que este arquivo devolve é medido
 * em jogadas que ela nunca viu no treino.
 */

/* Quantas jogadas suas ficam ESCONDIDAS do treino.
 *
 * Este é o número mais importante do arquivo. Sem separar nada, dá para
 * decorar as suas jogadas e cantar 100% -- e aí o número vira enfeite: ele
 * só subiria, sempre, dissesse o que dissesse a realidade.
 *
 * Guardando uma parte fora, o acerto passa a significar "ela adivinha o que
 * você faria numa situação que nunca viu". Esse número pode CAIR. Número que
 * pode cair é o único que vale a pena mostrar. */
const FATIA_DE_PROVA = 0.25;

const ENTRADAS = 11;
const MEIO = 16;
const SAIDAS = 3;

function zeros(n) { return new Float64Array(n); }

/* Pesos pequenos e aleatórios, escalados pelo tamanho da camada.
 *
 * Começar tudo em zero faria os 16 neurônios do meio aprenderem exatamente a
 * mesma coisa para sempre -- eles recebem o mesmo erro e se movem juntos. O
 * acaso aqui é o que os deixa virar 16 coisas diferentes. */
function sorteados(n, entradaDe) {
  const w = new Float64Array(n);
  const escala = Math.sqrt(2 / entradaDe);
  for (let i = 0; i < n; i++) w[i] = (Math.random() * 2 - 1) * escala;
  return w;
}

export function cerebroNovo() {
  return {
    w1: sorteados(ENTRADAS * MEIO, ENTRADAS), b1: zeros(MEIO),
    w2: sorteados(MEIO * SAIDAS, MEIO), b2: zeros(SAIDAS),
  };
}

/* O que ela pensa, dado o que está vendo. Devolve as 3 preferências. */
export function pensar(c, x) {
  const h = zeros(MEIO);
  for (let j = 0; j < MEIO; j++) {
    let s = c.b1[j];
    for (let i = 0; i < ENTRADAS; i++) s += x[i] * c.w1[i * MEIO + j];
    h[j] = Math.tanh(s);
  }
  const o = zeros(SAIDAS);
  let maior = -Infinity;
  for (let k = 0; k < SAIDAS; k++) {
    let s = c.b2[k];
    for (let j = 0; j < MEIO; j++) s += h[j] * c.w2[j * SAIDAS + k];
    o[k] = s;
    if (s > maior) maior = s;
  }
  /* Softmax com o maior descontado: sem isso, `exp` de um número grande vira
     infinito e a decisão vira NaN -- ela congela e ninguém entende por quê. */
  let soma = 0;
  for (let k = 0; k < SAIDAS; k++) { o[k] = Math.exp(o[k] - maior); soma += o[k]; }
  for (let k = 0; k < SAIDAS; k++) o[k] /= soma;
  return { h, o };
}

export function decidir(c, x) {
  const { o } = pensar(c, x);
  let melhor = 0;
  for (let k = 1; k < SAIDAS; k++) if (o[k] > o[melhor]) melhor = k;
  return melhor;
}

/* Uma passada de aprendizado sobre um lote de jogadas suas. */
function umaPassada(c, lote, taxa) {
  const g = {
    w1: zeros(c.w1.length), b1: zeros(MEIO),
    w2: zeros(c.w2.length), b2: zeros(SAIDAS),
  };
  for (const { x, a } of lote) {
    const { h, o } = pensar(c, x);
    /* Erro na saída: o quanto ela preferiu cada ação menos o que você fez. */
    const dO = zeros(SAIDAS);
    for (let k = 0; k < SAIDAS; k++) dO[k] = o[k] - (k === a ? 1 : 0);

    const dH = zeros(MEIO);
    for (let j = 0; j < MEIO; j++) {
      let s = 0;
      for (let k = 0; k < SAIDAS; k++) {
        g.w2[j * SAIDAS + k] += h[j] * dO[k];
        s += c.w2[j * SAIDAS + k] * dO[k];
      }
      dH[j] = s * (1 - h[j] * h[j]); // derivada do tanh
    }
    for (let k = 0; k < SAIDAS; k++) g.b2[k] += dO[k];
    for (let j = 0; j < MEIO; j++) {
      g.b1[j] += dH[j];
      for (let i = 0; i < ENTRADAS; i++) g.w1[i * MEIO + j] += x[i] * dH[j];
    }
  }
  const passo = taxa / lote.length;
  for (let i = 0; i < c.w1.length; i++) c.w1[i] -= passo * g.w1[i];
  for (let i = 0; i < c.b1.length; i++) c.b1[i] -= passo * g.b1[i];
  for (let i = 0; i < c.w2.length; i++) c.w2[i] -= passo * g.w2[i];
  for (let i = 0; i < c.b2.length; i++) c.b2[i] -= passo * g.b2[i];
}

export function acerto(c, prova) {
  if (!prova.length) return 0;
  let certos = 0;
  for (const { x, a } of prova) if (decidir(c, x) === a) certos++;
  return certos / prova.length;
}

/* Embaralha com o algoritmo de Fisher-Yates, e no lugar.
 *
 * Ordenar por `Math.random() - 0.5` é o jeito errado que todo mundo escreve:
 * ele não embaralha parelho, e aqui isso significaria a fatia de prova cair
 * quase sempre no fim da partida -- só as jogadas de quando a cobra já estava
 * comprida. A prova mediria uma coisa e o número diria outra. */
function embaralhar(v) {
  for (let i = v.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [v[i], v[j]] = [v[j], v[i]];
  }
  return v;
}

/* Treina do zero com tudo o que você já mostrou.
 *
 * Do zero, e não continuando de onde parou, por um motivo que aparece na
 * segunda partida: continuar faz as jogadas antigas pesarem para sempre, e a
 * pessoa que mudou de estratégia nunca consegue ensinar a estratégia nova.
 * Recomeçar custa um segundo e deixa você mandar. */
export function treinar(memoria, aoAndar) {
  const tudo = embaralhar(memoria.slice());
  const corte = Math.max(1, Math.floor(tudo.length * FATIA_DE_PROVA));
  const prova = tudo.slice(0, corte);
  const treino = tudo.slice(corte);
  if (!treino.length) return { cerebro: cerebroNovo(), acerto: 0, curva: [] };

  const c = cerebroNovo();
  const curva = [];
  const RODADAS = 260;
  for (let r = 0; r < RODADAS; r++) {
    umaPassada(c, embaralhar(treino), 0.9);
    if (r % 20 === 0 || r === RODADAS - 1) {
      curva.push(acerto(c, prova));
      if (aoAndar) aoAndar(r / RODADAS);
    }
  }
  return { cerebro: c, acerto: acerto(c, prova), curva, treinou: treino.length, provou: prova.length };
}

/* Ela cabe num texto -- é isso que faz "salvar a minha IA" ser possível. */
export function guardarCerebro(c) {
  return JSON.stringify({
    v: 1,
    w1: Array.from(c.w1, (n) => +n.toFixed(4)), b1: Array.from(c.b1, (n) => +n.toFixed(4)),
    w2: Array.from(c.w2, (n) => +n.toFixed(4)), b2: Array.from(c.b2, (n) => +n.toFixed(4)),
  });
}

export function lerCerebro(texto) {
  try {
    const d = JSON.parse(texto);
    if (!d || d.v !== 1 || !Array.isArray(d.w1)) return null;
    const c = {
      w1: Float64Array.from(d.w1), b1: Float64Array.from(d.b1),
      w2: Float64Array.from(d.w2), b2: Float64Array.from(d.b2),
    };
    /* Tamanho conferido antes de usar: um cérebro de outra versão do jogo
       entraria e daria decisão sem sentido, que é pior do que recusar. */
    if (c.w1.length !== ENTRADAS * MEIO || c.w2.length !== MEIO * SAIDAS) return null;
    return c;
  } catch { return null; }
}
