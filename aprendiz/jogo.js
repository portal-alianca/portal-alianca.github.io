/* A cobrinha, sem tela nenhuma.
 *
 * Separado do desenho de propósito: assim o jogo inteiro roda num teste, sem
 * navegador, e dá para conferir que a leitura do mundo está certa. Se esta
 * parte estiver errada, ela aprende a coisa errada e ninguém descobre -- o
 * número sobe igual, porque ele mede se ela concorda com você, e você também
 * estaria vendo o mundo errado.
 */

export const LARGURA = 13;
export const ALTURA = 17; // retrato, que é como o celular fica na mão

/* As quatro direções, na ORDEM DO RELÓGIO. A ordem não é enfeite: virar à
   direita é +1 nesta lista, virar à esquerda é -1. Trocar a ordem quebra o
   jogo de um jeito silencioso -- ela passa a virar para o lado errado. */
export const DIRECOES = [
  { x: 0, y: -1 }, // 0 cima
  { x: 1, y: 0 },  // 1 direita
  { x: 0, y: 1 },  // 2 baixo
  { x: -1, y: 0 }, // 3 esquerda
];

export const RETO = 0, DIREITA = 1, ESQUERDA = 2;

export function jogoNovo(sorteio = Math.random) {
  const meio = { x: (LARGURA >> 1), y: (ALTURA >> 1) };
  const corpo = [meio, { x: meio.x, y: meio.y + 1 }, { x: meio.x, y: meio.y + 2 }];
  const j = { corpo, dir: 0, comida: null, viva: true, pontos: 0, passos: 0, sorteio };
  j.comida = novaComida(j);
  return j;
}

function ocupado(j, p) {
  return j.corpo.some((c) => c.x === p.x && c.y === p.y);
}

function novaComida(j) {
  const livres = [];
  for (let y = 0; y < ALTURA; y++)
    for (let x = 0; x < LARGURA; x++)
      if (!ocupado(j, { x, y })) livres.push({ x, y });
  if (!livres.length) return null;
  return livres[Math.floor(j.sorteio() * livres.length)];
}

function bate(j, p) {
  if (p.x < 0 || p.y < 0 || p.x >= LARGURA || p.y >= ALTURA) return true;
  /* O último pedaço sai no mesmo instante em que a cabeça entra, então entrar
     onde a ponta da cauda está agora NÃO é bater. Contar isso como batida faz
     a cobra morrer em curvas que qualquer jogador faz sem pensar -- e ela
     aprenderia a evitar uma curva que não tem perigo nenhum. */
  const ate = j.corpo.length - 1;
  for (let i = 0; i < ate; i++) if (j.corpo[i].x === p.x && j.corpo[i].y === p.y) return true;
  return false;
}

export function paraOnde(dir, acao) {
  if (acao === DIREITA) return (dir + 1) % 4;
  if (acao === ESQUERDA) return (dir + 3) % 4;
  return dir;
}

/* O que ela vê. Onze números, e nada mais.
 *
 * Ela NÃO vê a tela: vê perigo em três lados, para onde está indo, e para que
 * lado está a comida. É pouco de propósito -- com pouco, ela aprende com as
 * poucas partidas que uma pessoa tem paciência de jogar. Dar a grade inteira
 * seria mais "inteligente" e exigiria milhares de partidas suas.
 */
export function olhar(j) {
  const cabeca = j.corpo[0];
  const frente = paraOnde(j.dir, RETO);
  const dir = paraOnde(j.dir, DIREITA);
  const esq = paraOnde(j.dir, ESQUERDA);
  const passo = (d) => ({ x: cabeca.x + DIRECOES[d].x, y: cabeca.y + DIRECOES[d].y });

  const x = new Float64Array(11);
  x[0] = bate(j, passo(frente)) ? 1 : 0;
  x[1] = bate(j, passo(dir)) ? 1 : 0;
  x[2] = bate(j, passo(esq)) ? 1 : 0;
  x[3 + j.dir] = 1; // para onde ela vai agora
  if (j.comida) {
    x[7] = j.comida.y < cabeca.y ? 1 : 0;
    x[8] = j.comida.x > cabeca.x ? 1 : 0;
    x[9] = j.comida.y > cabeca.y ? 1 : 0;
    x[10] = j.comida.x < cabeca.x ? 1 : 0;
  }
  return x;
}

/* Um passo. Devolve o que aconteceu, para a tela poder reagir. */
export function andar(j, acao) {
  if (!j.viva) return { comeu: false, morreu: true };
  j.dir = paraOnde(j.dir, acao);
  const d = DIRECOES[j.dir];
  const cabeca = { x: j.corpo[0].x + d.x, y: j.corpo[0].y + d.y };

  if (bate(j, cabeca)) { j.viva = false; return { comeu: false, morreu: true }; }

  j.corpo.unshift(cabeca);
  const comeu = j.comida && cabeca.x === j.comida.x && cabeca.y === j.comida.y;
  if (comeu) { j.pontos++; j.comida = novaComida(j); }
  else j.corpo.pop();

  j.passos++;
  /* Rodando em círculo sem comer, ela ficaria viva para sempre e a partida
     dela nunca terminaria. O teto cresce com o tamanho: cobra comprida tem
     mais caminho a fazer entre uma comida e outra. */
  if (j.passos > 120 + j.corpo.length * 40) j.viva = false;
  return { comeu, morreu: !j.viva };
}

/* A jogada humana chega como direção ABSOLUTA (o dedo arrasta para cima), e
   ela pensa em RELATIVO (reto, direita, esquerda). Esta função é a tradução.
   Meia-volta não existe: no jogo ela mataria a cobra na hora, então vira
   "segue reto" em vez de virar morte por dedo torto. */
export function acaoEntre(dirAtual, dirDesejada) {
  if (dirDesejada === dirAtual) return RETO;
  if (dirDesejada === (dirAtual + 1) % 4) return DIREITA;
  if (dirDesejada === (dirAtual + 3) % 4) return ESQUERDA;
  return RETO;
}
