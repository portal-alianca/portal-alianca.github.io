/* Um mundo que vive sem você.
 *
 * A diferença para o jogo de rei que veio antes é a posição de quem joga: lá
 * você era o rei e respondia petições; aqui você está FORA, e o mundo corre
 * sozinho. As pessoas caçam, comem, constroem, se multiplicam, encontram
 * outros povos e brigam -- e nada disso espera por você.
 *
 * Você derruba coisas dentro e vê o que acontece.
 *
 * O QUE FAZ EMERGIR, e é pouca regra:
 *
 *   1. Cada pessoa só quer não passar fome. Anda para onde há comida, come,
 *      volta para perto de casa.
 *   2. Onde sobra comida, nasce gente. Onde sobra gente, nasce casa.
 *   3. Casa reivindica o chão à volta. Chão reivindicado é o território -- e
 *      é vendo as manchas de cor crescerem que se entende o mundo de relance.
 *   4. Território que encosta em território vira atrito.
 *
 * Ninguém programa "fundar cidade". A cidade acontece porque comida virou
 * gente e gente virou casa, no lugar onde havia comida.
 *
 * BARATO DE PROPÓSITO: nada de caminho calculado por pessoa. Cada uma olha
 * uma janelinha à volta e anda para a melhor casa vizinha. Trezentas pessoas
 * fazendo isso cabem num celular; trezentos algoritmos de caminho, não.
 */

export const AGUA = 0, AREIA = 1, CAMPO = 2, FLORESTA = 3, MONTANHA = 4;

/* Quanto cada chão dá de comida, e quão rápido devolve o que tiraram. */
const FERTIL = [0, 0.02, 0.55, 0.9, 0];
const TETO   = [0, 0.3, 1.0, 1.6, 0];

/* Quatro cores que se distinguem de relance num mapa pequeno, inclusive para
   quem confunde vermelho e verde: as manchas de território são a leitura
   principal do mundo, e leitura errada aqui é o jogo inteiro perdido. */
export const CORES = ["#e0564f", "#4f9ee0", "#e8c14a", "#a86fd4"];
export const NOMES = ["os Vermelhos", "os Azuis", "os Dourados", "os Roxos"];

export function mundoNovo(L = 48, A = 68, semente = Date.now() % 99999) {
  let s = (semente >>> 0) || 1;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  const m = {
    L, A, r, tempo: 0,
    terreno: new Uint8Array(L * A),
    comida: new Float32Array(L * A),
    dono: new Int8Array(L * A).fill(-1),
    gente: [],
    casas: [],
    povos: [],
    diario: [],
  };
  desenharTerra(m);
  for (let i = 0; i < L * A; i++) m.comida[i] = TETO[m.terreno[i]];
  return m;
}

/* A terra: duas camadas de ruído somadas, uma grossa e uma fina.
   Só a grossa daria manchas redondas de continente; só a fina daria confete.
   Somadas, dão costa recortada -- que é o que faz o mapa parecer um lugar. */
function desenharTerra(m) {
  const { L, A, r } = m;
  const grossa = ruido(L, A, 7, r);
  const fina = ruido(L, A, 17, r);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const i = y * L + x;
      /* Beira do mapa puxada para a água: sem isso o continente é cortado
         pela moldura e o mundo parece um pedaço de outro maior. */
      const bx = Math.min(x, L - 1 - x) / (L * 0.42);
      const by = Math.min(y, A - 1 - y) / (A * 0.42);
      const beira = Math.min(1, Math.min(bx, by));
      const h = (grossa[i] * 0.68 + fina[i] * 0.32) * beira;
      /* O corte da água foi de 0,34 para 0,27 depois de medir: com o valor
         antigo sobravam 22% de terra firme, e dois povos em cantos opostos
         se encostavam antes de terem espaço para virar alguma coisa. Um mundo
         onde tudo se toca no começo não tem história para contar. */
      m.terreno[i] = h < 0.27 ? AGUA : h < 0.31 ? AREIA : h < 0.60 ? CAMPO : h < 0.78 ? FLORESTA : MONTANHA;
    }
  }
}

function ruido(L, A, celulas, r) {
  const gx = Math.ceil(L / celulas) + 2, gy = Math.ceil(A / celulas) + 2;
  const g = [];
  for (let i = 0; i < gx * gy; i++) g.push(r());
  const suave = (t) => t * t * (3 - 2 * t);
  const saida = new Float32Array(L * A);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const fx = x / celulas, fy = y / celulas;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = suave(fx - x0), ty = suave(fy - y0);
      const a = g[y0 * gx + x0], b = g[y0 * gx + x0 + 1];
      const c = g[(y0 + 1) * gx + x0], d = g[(y0 + 1) * gx + x0 + 1];
      saida[y * L + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return saida;
}

const dentro = (m, x, y) => x >= 0 && y >= 0 && x < m.L && y < m.A;
const pisavel = (m, x, y) => dentro(m, x, y) && m.terreno[y * m.L + x] >= AREIA && m.terreno[y * m.L + x] <= FLORESTA;

/* ---------------- os povos ---------------- */
export function semearPovo(m, x, y, cor, nome) {
  if (!pisavel(m, x, y)) {
    /* Sem isto, um toque no mar criava um povo que nascia afogado e sumia --
       e quem tocou concluía que o botão não funciona. Procura chão perto. */
    let achou = null;
    for (let raio = 1; raio < 12 && !achou; raio++)
      for (let dy = -raio; dy <= raio && !achou; dy++)
        for (let dx = -raio; dx <= raio && !achou; dx++)
          if (pisavel(m, x + dx, y + dy)) achou = { x: x + dx, y: y + dy };
    if (!achou) return null;
    x = achou.x; y = achou.y;
  }
  const p = { id: m.povos.length, cor, nome, saber: 0, mortos: 0, guerras: 0 };
  m.povos.push(p);
  for (let i = 0; i < 6; i++) {
    m.gente.push({ x: x + (m.r() * 3 | 0) - 1, y: y + (m.r() * 3 | 0) - 1, povo: p.id, fome: 0.3, idade: 0 });
  }
  anotar(m, `${nome} apareceu no mundo.`);
  return p;
}

const anotar = (m, texto) => {
  m.diario.push({ tempo: m.tempo, texto });
  if (m.diario.length > 200) m.diario.shift();
};

/* ---------------- um instante ---------------- */
export function passo(m) {
  m.tempo++;

  /* A comida volta sozinha, devagar. É o relógio de tudo: mundo com comida
     enche de gente, mundo sem comida esvazia. */
  if (m.tempo % 3 === 0) {
    for (let i = 0; i < m.comida.length; i++) {
      const teto = TETO[m.terreno[i]];
      if (m.comida[i] < teto) m.comida[i] = Math.min(teto, m.comida[i] + FERTIL[m.terreno[i]] * 0.06);
    }
  }

  const nascer = [];
  for (let k = m.gente.length - 1; k >= 0; k--) {
    const g = m.gente[k];
    g.idade++;
    g.fome += 0.010;

    /* Procura a melhor casa vizinha numa janelinha. É a decisão inteira de
       uma pessoa, e é de propósito burra: o que interessa não é ela ser
       esperta, é serem trezentas. */
    let melhorX = g.x, melhorY = g.y, melhor = -1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = g.x + dx, y = g.y + dy;
        if (!pisavel(m, x, y)) continue;
        const i = y * m.L + x;
        let vale = m.comida[i];
        /* Chão do próprio povo puxa um pouco: é o que faz a aldeia se manter
           junta em vez de a gente se espalhar até sumir. */
        if (m.dono[i] === g.povo) vale += 0.25;
        else if (m.dono[i] >= 0) vale -= 0.5; // terra dos outros repele
        vale -= (Math.abs(dx) + Math.abs(dy)) * 0.05;
        if (vale > melhor) { melhor = vale; melhorX = x; melhorY = y; }
      }
    }
    g.x = melhorX; g.y = melhorY;

    const i = g.y * m.L + g.x;
    if (m.comida[i] > 0.12) {
      const comeu = Math.min(0.35, m.comida[i]);
      m.comida[i] -= comeu;
      g.fome = Math.max(0, g.fome - comeu * 1.6);
    }

    if (g.fome > 1) { m.gente.splice(k, 1); m.povos[g.povo].mortos++; continue; }
    if (g.idade > 900) { m.gente.splice(k, 1); continue; }
    /* Gente farta e adulta faz gente. O teto por povo evita que um só encha
       o mundo e o celular junto. */
    /* O teto por povo é válvula de segurança do celular, não regra do jogo --
       por isso é alto: quem limita de verdade é a comida. Com o teto baixo o
       mundo congelava em 140/140 e ficava parado para sempre, que é o pior
       destino de um mundo que devia estar vivo. */
    if (g.fome < 0.25 && g.idade > 60 && m.r() < 0.006 && contar(m, g.povo) < 400) {
      nascer.push({ x: g.x, y: g.y, povo: g.povo, fome: 0.4, idade: 0 });
    }
  }
  m.gente.push(...nascer);

  /* ---- casas: onde há gente parada e comida, nasce casa ---- */
  if (m.tempo % 12 === 0) construir(m);

  /* ---- território: cada casa reivindica o chão à volta ---- */
  if (m.tempo % 20 === 0) reivindicar(m);

  /* ---- atrito nas fronteiras ---- */
  if (m.tempo % 10 === 0) atritar(m);

  /* ---- saber: povo grande e alimentado aprende ---- */
  if (m.tempo % 60 === 0) {
    for (const p of m.povos) {
      const n = contar(m, p.id);
      if (n > 8) {
        const antes = nivelDe(p);
        p.saber += n * 0.05;
        const agora = nivelDe(p);
        if (agora > antes) anotar(m, `${p.nome} aprendeu a construir melhor (nível ${agora}).`);
      }
    }
  }

  if (m.tempo % 120 === 0) observar(m);
  return m;
}

export const contar = (m, povo) => m.gente.reduce((n, g) => n + (g.povo === povo ? 1 : 0), 0);
export const terrasDe = (m, povo) => {
  let n = 0;
  for (let i = 0; i < m.dono.length; i++) if (m.dono[i] === povo) n++;
  return n;
};

/* O mundo tem que continuar CONTANDO o que faz.
 *
 * Todos os avisos originais eram de estreia -- a primeira casa, o primeiro
 * nível, a primeira briga -- e o nível para no 3. Depois de uns milhares de
 * passos o mundo seguia vivo e mudo: gente nascendo, fronteira mudando de
 * dono, e nenhuma linha nova. Quem olhava concluía que tinha travado.
 *
 * Nada aqui inventa acontecimento: só olha o que já está no estado e conta
 * quando MUDOU o bastante para valer uma frase. */
const MARCOS = [50, 100, 200, 300, 400];
function observar(m) {
  for (const p of m.povos) {
    const n = contar(m, p.id);

    if (n === 0) {
      if (!p.acabou) { p.acabou = true; anotar(m, `${p.nome} acabou. Não sobrou ninguém.`); }
      continue;
    }
    p.acabou = false;

    const antes = p.vistoGente ?? n;
    /* Queda de um quarto entre duas olhadas: isso é fome ou guerra, não o
       vaivém normal de nascer e morrer. */
    if (antes >= 20 && n <= antes * 0.75) {
      anotar(m, `${p.nome} perdeu ${antes - n} pessoas. Eram ${antes}, agora são ${n}.`);
    } else {
      /* Só o marco mais alto JÁ ALCANÇADO, e nunca de novo. Comparar com a
         medida anterior fazia uma civ que oscila em volta de 300 anunciar a
         mesma linha seis vezes, e um diário que se repete é um diário que
         ninguém lê. */
      const marco = MARCOS.filter((v) => n >= v).pop();
      if (marco && marco > (p.marco || 0)) {
        p.marco = marco;
        anotar(m, `${p.nome} passou de ${marco} pessoas.`);
      }
    }
    p.vistoGente = n;

    /* A guerra só vira notícia de novo quando o número de mortos DOBRA: sem
       isso a fronteira encheria o diário com a mesma linha para sempre. */
    if (p.guerras >= 20 && p.guerras >= (p.vistoGuerras || 10) * 2) {
      p.vistoGuerras = p.guerras;
      anotar(m, `${p.nome} já enterrou ${p.guerras} na fronteira.`);
    }
  }

  /* Quem manda no mapa. Só se houver com quem comparar e a diferença for
     folgada, senão duas civs empatadas trocariam de líder toda olhada. */
  const vivos = m.povos.filter((p) => contar(m, p.id) > 0);
  if (vivos.length > 1) {
    const placar = vivos.map((p) => ({ p, terra: terrasDe(m, p.id) })).sort((a, b) => b.terra - a.terra);
    const lider = placar[0];
    if (lider.terra > placar[1].terra * 1.25 && m.lider !== lider.p.id) {
      m.lider = lider.p.id;
      anotar(m, `${lider.p.nome} tem mais terra que todo mundo agora.`);
    }
  }
}
/* A escada do saber.
 *
 * Ela ia só até 3, e isso matava o mundo por dentro: por volta do passo 2000
 * as duas civs batiam no nível 3, as casas paravam em 70, o território
 * congelava em 548/613 e não mudava mais NUNCA. O mundo continuava se mexendo
 * -- gente nascendo e morrendo -- mas não acontecia mais nada. Era exatamente
 * o "eles param de desenvolver" que não podia acontecer.
 *
 * Seis degraus, cada vez mais caros, e cada degrau muda coisa que se VÊ: casa
 * maior, mais aldeias, e mais alcance para reivindicar terra -- que é o que
 * mantém as fronteiras se empurrando em vez de virarem uma linha pintada. */
const ESCADA = [40, 140, 340, 700, 1300];
export const nivelDe = (p) => {
  let n = 1;
  for (const passo of ESCADA) if (p.saber >= passo) n++;
  return n;
};
export const NIVEL_MAX = ESCADA.length + 1;

function construir(m) {
  /* Onde há três ou mais da mesma gente juntas e ainda não há casa, sobe uma.
     Não existe ordem de "funde uma aldeia": a aldeia é o que sobra quando
     gente parou no mesmo lugar porque ali havia o que comer. */
  const juntos = new Map();
  for (const g of m.gente) {
    const chave = ((g.y >> 1) * m.L + (g.x >> 1)) * 8 + g.povo;
    const j = juntos.get(chave) || { n: 0, x: 0, y: 0, povo: g.povo };
    j.n++; j.x += g.x; j.y += g.y;
    juntos.set(chave, j);
  }
  for (const j of juntos.values()) {
    if (j.n < 3) continue;
    const x = Math.round(j.x / j.n), y = Math.round(j.y / j.n);
    if (!pisavel(m, x, y)) continue;
    if (m.casas.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < 3)) continue;
    /* O teto de aldeias sobe com o saber. Era fixo em 34, e junto com o nível
       travado no 3 era o outro pino que prendia o mundo parado. */
    if (m.casas.filter((c) => c.povo === j.povo).length > 18 + nivelDe(m.povos[j.povo]) * 8) continue;
    m.casas.push({ x, y, povo: j.povo, nivel: nivelDe(m.povos[j.povo]) });
    if (m.casas.filter((c) => c.povo === j.povo).length === 1)
      anotar(m, `${m.povos[j.povo].nome} levantou a primeira casa.`);
  }
  /* Casas velhas melhoram com o saber do povo: é como o avanço APARECE. */
  for (const c of m.casas) c.nivel = Math.max(c.nivel, nivelDe(m.povos[c.povo]));
}

function reivindicar(m) {
  for (const c of m.casas) {
    const raio = 2 + c.nivel;
    for (let dy = -raio; dy <= raio; dy++) {
      for (let dx = -raio; dx <= raio; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (!pisavel(m, x, y)) continue;
        if (dx * dx + dy * dy > raio * raio) continue;
        const i = y * m.L + x;
        /* Terra sem dono é tomada; terra dos outros só cede à casa mais
           perto. É isso que faz as fronteiras se moverem em vez de piscarem. */
        if (m.dono[i] === -1) m.dono[i] = c.povo;
        else if (m.dono[i] !== c.povo) {
          const rival = m.casas.filter((o) => o.povo === m.dono[i])
            .reduce((menor, o) => Math.min(menor, Math.abs(o.x - x) + Math.abs(o.y - y)), 99);
          if (Math.abs(dx) + Math.abs(dy) < rival) m.dono[i] = c.povo;
        }
      }
    }
  }
}

function atritar(m) {
  /* Duas pessoas de povos diferentes no mesmo chão brigam. Não há declaração
     de guerra: a guerra é o que se chama depois, quando já morreu gente. */
  const grade = new Map();
  for (const g of m.gente) {
    const chave = g.y * m.L + g.x;
    const outro = grade.get(chave);
    if (outro && outro.povo !== g.povo) {
      const perde = m.r() < 0.5 ? g : outro;
      const i = m.gente.indexOf(perde);
      if (i >= 0) {
        m.gente.splice(i, 1);
        const p = m.povos[perde.povo];
        p.mortos++;
        p.guerras++;
        if (p.guerras === 1) anotar(m, `${p.nome} perdeu gente numa fronteira. Começou assim.`);
      }
    } else grade.set(chave, g);
  }
}

/* ---------------- o que você derruba dentro ---------------- */
export const PODERES = {
  comida: (m, x, y) => {
    pincelar(m, x, y, 4, (i) => { if (m.terreno[i] >= AREIA && m.terreno[i] <= FLORESTA) m.comida[i] = TETO[m.terreno[i]] * 1.6; });
    anotar(m, "Choveu fartura num pedaço do mundo.");
  },
  floresta: (m, x, y) => {
    pincelar(m, x, y, 3, (i) => { if (m.terreno[i] === CAMPO || m.terreno[i] === AREIA) { m.terreno[i] = FLORESTA; m.comida[i] = TETO[FLORESTA]; } });
    anotar(m, "A floresta cresceu onde não havia.");
  },
  fogo: (m, x, y) => {
    pincelar(m, x, y, 4, (i) => { if (m.terreno[i] === FLORESTA) { m.terreno[i] = AREIA; m.comida[i] = 0; } });
    /* Fogo mata quem estava lá. Poder que só muda o cenário não é poder. */
    const antes = m.gente.length;
    m.gente = m.gente.filter((g) => Math.abs(g.x - x) + Math.abs(g.y - y) > 3);
    anotar(m, `O fogo passou. Levou ${antes - m.gente.length} pessoas e a mata.`);
  },
  peste: (m, x, y) => {
    const antes = m.gente.length;
    m.gente = m.gente.filter((g) => Math.abs(g.x - x) + Math.abs(g.y - y) > 6 || m.r() > 0.6);
    anotar(m, `A peste passou e levou ${antes - m.gente.length}.`);
  },
  agua: (m, x, y) => {
    pincelar(m, x, y, 3, (i) => { m.terreno[i] = AGUA; m.comida[i] = 0; m.dono[i] = -1; });
    m.gente = m.gente.filter((g) => Math.abs(g.x - x) + Math.abs(g.y - y) > 2);
    m.casas = m.casas.filter((c) => m.terreno[c.y * m.L + c.x] !== AGUA);
    anotar(m, "A água subiu e engoliu o que havia ali.");
  },
};

function pincelar(m, cx, cy, raio, faz) {
  for (let dy = -raio; dy <= raio; dy++)
    for (let dx = -raio; dx <= raio; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!dentro(m, x, y) || dx * dx + dy * dy > raio * raio) continue;
      faz(y * m.L + x);
    }
}
