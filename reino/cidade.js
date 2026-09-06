/* A cidade — o retrato do seu reinado.
 *
 * Nada aqui é enfeite ou arte comprada: TUDO o que aparece na tela está lá
 * por causa de uma decisão sua ou de um número do reino.
 *
 *   as casas       são o seu povo, uma por punhado de pessoas
 *   a catedral     só existe porque você mandou construir
 *   a cicatriz     é a mina que você abriu
 *   o rio escuro   é a conta dessa mina chegando, oito anos depois
 *   os canais      são o forasteiro de quem você não riu
 *   o céu          é o clima do ano
 *   os pontinhos   são gente, e somem quando a peste passa
 *
 * É por isso que desenhar vale a pena aqui: não é ilustrar o texto, é dizer
 * a mesma coisa por outro caminho. Quem joga olha a cidade e lê o próprio
 * histórico sem precisar rolar a crônica.
 *
 * E é tudo forma geométrica -- não há um único arquivo de imagem. Cabe em
 * poucos KB e nunca fica desatualizado em relação ao jogo.
 */

/* As posições nascem UMA vez por reinado e não mudam mais.

   Sorteá-las a cada quadro faria a cidade tremer: as casas dançariam de lugar
   sessenta vezes por segundo, e o que era para ser um lugar viraria ruído. */
export function plantaDaCidade(semente) {
  let s = (semente >>> 0) || 1;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const casas = [];
  /* Sessenta lugares possíveis, ocupados conforme o povo cresce. Assim a
     cidade cresce PARA FORA a partir do centro, como cidade de verdade. */
  for (let i = 0; i < 60; i++) {
    const anel = Math.sqrt(i / 60);
    const angulo = i * 2.399963; // ângulo de ouro: espalha sem amontoar
    casas.push({
      /* Preso entre 6% e 94%: sem isso as casas da borda saíam cortadas pela
         moldura, e casa cortada pela metade parece defeito de desenho, não
         cidade que cresceu. */
      x: Math.min(0.94, Math.max(0.06, 0.5 + Math.cos(angulo) * anel * 0.36 + (r() - 0.5) * 0.03)),
      y: 0.72 + Math.sin(angulo) * anel * 0.12 + (r() - 0.5) * 0.02,
      alta: r() < 0.25,
      larg: 0.018 + r() * 0.012,
    });
  }
  const gente = [];
  /* A gente anda no chão da cidade, entre 20% e 92% — não na encosta da
     montanha, onde ficavam pontinhos flutuando na pedra. */
  for (let i = 0; i < 40; i++) gente.push({ x: 0.20 + r() * 0.72, y: 0.74 + r() * 0.20, passo: r() * 6.28 });
  return { casas, gente };
}

const CEU = {
  seca:    ["#2a1d12", "#6b4a24"],
  bom:     ["#171c26", "#3d4152"],
  fartura: ["#16221c", "#3a5546"],
};

export function desenharCidade(ctx, L, A, R, planta, tempo = 0) {
  const [alto, baixo] = CEU[R.clima] || CEU.bom;
  const ceu = ctx.createLinearGradient(0, 0, 0, A * 0.72);
  ceu.addColorStop(0, alto); ceu.addColorStop(1, baixo);
  ctx.fillStyle = ceu;
  ctx.fillRect(0, 0, L, A);

  /* ---- a montanha, e a cicatriz da mina ---- */
  ctx.fillStyle = "#241d17";
  ctx.beginPath();
  ctx.moveTo(0, A * 0.72);
  ctx.lineTo(L * 0.13, A * 0.20);
  ctx.lineTo(L * 0.34, A * 0.72);
  ctx.closePath();
  ctx.fill();
  if (R.tem.has("mina")) {
    /* A mina não é um predinho bonitinho na montanha: é um talho. */
    ctx.fillStyle = "#4a3220";
    ctx.beginPath();
    ctx.moveTo(L * 0.12, A * 0.34);
    ctx.lineTo(L * 0.19, A * 0.40);
    ctx.lineTo(L * 0.15, A * 0.56);
    ctx.lineTo(L * 0.10, A * 0.46);
    ctx.closePath();
    ctx.fill();
  }

  /* ---- o chão ---- */
  ctx.fillStyle = R.clima === "seca" ? "#3b2f1d" : "#26301f";
  ctx.fillRect(0, A * 0.72, L, A * 0.28);

  /* ---- o rio, que escurece quando a conta da mina chega ---- */
  const rioMorto = R.cronica.some((c) => c.texto.includes("rio abaixo da mina"));
  ctx.strokeStyle = rioMorto ? "#3b3630" : "#3f5f79";
  ctx.lineWidth = Math.max(3, A * 0.022);
  ctx.beginPath();
  ctx.moveTo(L * 0.16, A * 0.60);
  ctx.quadraticCurveTo(L * 0.34, A * 0.80, L * 0.20, A);
  ctx.stroke();

  /* ---- os canais: linhas finas no vale, à direita ---- */
  if (R.tem.has("irrigacao")) {
    ctx.strokeStyle = "#4a6f7d";
    ctx.lineWidth = Math.max(1, A * 0.006);
    for (let i = 0; i < 4; i++) {
      const y = A * (0.80 + i * 0.045);
      ctx.beginPath(); ctx.moveTo(L * 0.72, y); ctx.lineTo(L, y - A * 0.02); ctx.stroke();
    }
  }

  /* ---- as casas: uma por punhado de gente ---- */
  const quantas = Math.max(1, Math.min(60, Math.round(R.povo / 22)));
  for (let i = 0; i < quantas; i++) {
    const c = planta.casas[i];
    const w = c.larg * L, h = w * (c.alta ? 1.5 : 1.05);
    const x = c.x * L - w / 2, y = c.y * A - h;
    ctx.fillStyle = "#4a3b2c";
    ctx.fillRect(x, y, w, h);
    /* Telhado: um triângulo. É o que faz um retângulo virar casa. */
    ctx.fillStyle = "#5d4632";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.16, y);
    ctx.lineTo(x + w / 2, y - h * 0.42);
    ctx.lineTo(x + w * 1.16, y);
    ctx.closePath(); ctx.fill();
    /* Uma janela acesa em algumas: é o que dá vida sem custar nada. */
    if (c.alta) { ctx.fillStyle = "#d9a441"; ctx.fillRect(x + w * 0.34, y + h * 0.28, w * 0.3, h * 0.26); }
  }

  /* ---- a catedral, se você a construiu ---- */
  if (R.tem.has("templo")) {
    const x = L * 0.5, base = A * 0.74, w = L * 0.055, h = A * 0.30;
    ctx.fillStyle = "#6b5741";
    ctx.fillRect(x - w / 2, base - h, w, h);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.72, base - h);
    ctx.lineTo(x, base - h * 1.42);
    ctx.lineTo(x + w * 0.72, base - h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(x - w * 0.06, base - h * 1.62, w * 0.12, h * 0.2);
    ctx.fillRect(x - w * 0.2, base - h * 1.55, w * 0.4, h * 0.06);
  }

  /* ---- a escola: baixa, larga, com a porta acesa ---- */
  if (R.tem.has("escola")) {
    const x = L * 0.72, base = A * 0.78, w = L * 0.085, h = A * 0.09;
    ctx.fillStyle = "#54452f";
    ctx.fillRect(x, base - h, w, h);
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(x + w * 0.42, base - h * 0.55, w * 0.16, h * 0.55);
  }

  /* ---- a gente ----
     Quantos pontinhos andam é o seu povo. Quando a peste passa, eles somem da
     tela -- e some ANTES de você ler a crônica, que é o que faz doer. */
  const almas = Math.max(0, Math.min(40, Math.round(R.povo / 34)));
  ctx.fillStyle = "#c8b6a0";
  for (let i = 0; i < almas; i++) {
    const g = planta.gente[i];
    /* Um vaivém lento e curto: gente que anda, não formiga em pânico. */
    const x = (g.x + Math.sin(tempo / 1400 + g.passo) * 0.012) * L;
    ctx.fillRect(x, g.y * A, Math.max(1.5, L * 0.005), Math.max(2.5, A * 0.016));
  }

  /* ---- a muralha, que só aparece quando há exército para guarnecê-la ---- */
  if (R.espada > 55) {
    ctx.strokeStyle = "#3b3025";
    ctx.lineWidth = Math.max(2, A * 0.012);
    ctx.beginPath();
    ctx.moveTo(L * 0.24, A * 0.80);
    ctx.quadraticCurveTo(L * 0.5, A * 0.66, L * 0.78, A * 0.80);
    ctx.stroke();
  }
}
