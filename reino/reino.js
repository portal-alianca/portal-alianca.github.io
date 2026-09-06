/* O reino, sem tela nenhuma.
 *
 * A REGRA QUE FAZ NÃO SER UM BARALHO: nenhuma petição é sorteada de uma lista.
 * Cada uma tem uma CONDIÇÃO, e só bate na sua porta quando o reino chegou
 * naquele estado. O camponês só pede trigo porque houve seca; a opção "abre o
 * celeiro" só existe porque há trigo dentro dele.
 *
 * A SEGUNDA, que dá alma: CONSEQUÊNCIA ATRASADA. A mina que você abriu no ano
 * 4 é por que o rio está morto no ano 12. Se toda escolha resolvesse na hora,
 * isto seria caça-níquel de roupa medieval.
 *
 * A TERCEIRA nasceu de um defeito medido, e é a mais importante das três.
 *
 * A primeira versão deste arquivo rodou 120 anos e produziu 25 petições, das
 * quais 21 eram REPETIÇÃO -- o mesmo forasteiro oferecendo os mesmos canais,
 * palavra por palavra, três vezes. Um jogo assim se entrega na primeira
 * sessão: a pessoa percebe que está lendo um disco riscado.
 *
 * O conserto foi separar o mundo em duas naturezas:
 *
 *   OFERTA   -- alguém te oferece algo. Recusou, ele insiste UMA vez, com
 *               outras palavras. Recusou de novo, some para sempre e a
 *               crônica registra que sumiu. O mundo segue sem você.
 *
 *   PROBLEMA -- não some porque você ignorou. Volta, e volta PIOR, e o texto
 *               diz que é a mesma coisa de antes. É a sua decisão velha te
 *               cobrando na cara.
 *
 * Repetição virou consequência. É a diferença entre o reino ser um lugar e
 * ser um baralho.
 */

/* Um acaso que se repete: com a mesma semente, a mesma história. Sem isso não
   dá para comparar dois reis -- toda diferença poderia ser sorte, e eu estaria
   lendo ruído achando que é consequência. */
export function acaso(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function reinoNovo(semente = Date.now() % 100000) {
  return {
    ano: 0,
    povo: 400,
    trigo: 900,
    ouro: 120,
    fe: 50,        // como o clero te vê
    espada: 45,    // exército: força e lealdade juntas
    saber: 10,
    clima: "bom",
    /* O que foi decidido e ainda não cobrou o preço: a memória do reino. */
    semeado: [],
    tem: new Set(),
    vezes: {},     // quantas vezes cada porta bateu
    recusas: {},   // quantas vezes você disse não a cada oferta
    ultima: {},    // em que ano foi a última
    morta: new Set(), // ofertas que desistiram de você
    cronica: [],
    decisoes: [],
    fim: null,
    r: acaso(semente),
  };
}

const anota = (R, texto) => R.cronica.push({ ano: R.ano, texto });

/* ---------------- as petições ---------------- */
export const PETICOES = [
  /* ============ PROBLEMAS: voltam, e voltam piores ============ */
  {
    id: "seca", tipo: "problema", espera: 3,
    quando: (R) => R.clima === "seca" && !R.tem.has("irrigacao"),
    titulo: "A seca no vale",
    texto: (R, n) => n === 0
      ? `Não chove há dois verões. O celeiro tem trigo para ${Math.max(1, Math.round(R.trigo / (R.povo * 0.9)))} meses.`
      : `A seca de novo, e o vale já vinha fraco da anterior. Trigo para ${Math.max(1, Math.round(R.trigo / (R.povo * 0.9)))} meses.`,
    opcoes: [
      { rotulo: "Abrir o celeiro", pode: (R) => R.trigo > 200,
        faz: (R) => { R.trigo -= 350; R.fe += 8; R.povo += 5;
          anota(R, "O celeiro foi aberto. Ninguém passou fome, e o inverno ainda não chegou."); } },
      { rotulo: "Manter fechado", pode: () => true,
        faz: (R, n) => { R.povo -= Math.round(R.povo * (0.06 + n * 0.02)); R.fe -= 12;
          anota(R, n ? "Fechado outra vez. Desta vez ninguém veio pedir — foram embora." : "O celeiro ficou fechado. Enterraram os velhos primeiro."); } },
      { rotulo: "Comprar do vizinho", pode: (R) => R.ouro > 90,
        faz: (R) => { R.ouro -= 90; R.trigo += 300;
          anota(R, "Compramos trigo do reino vizinho. O tesouro sentiu."); } },
    ],
  },
  {
    id: "bandidos", tipo: "problema", espera: 4,
    quando: (R) => R.espada < 35 && R.ouro > 40,
    titulo: "A estrada não está mais segura",
    texto: (R, n) => n === 0
      ? "Três caravanas em dois meses. Os mercadores estão indo pela estrada do vizinho."
      : n === 1
        ? "Voltaram, e agora são o dobro. Sabiam exatamente quanto você paga."
        : `Voltaram pela ${n + 1}ª vez. Já não é bando: é o segundo senhor destas terras, e vive do seu tesouro.`,
    opcoes: [
      { rotulo: "Pagar para irem embora", pode: (R) => R.ouro > 40,
        faz: (R, n) => { const preco = 40 * Math.pow(2, n); R.ouro -= preco;
          anota(R, `Pagamos ${preco} de ouro aos bandidos. Foram embora, e sabem o caminho de volta.`); } },
      { rotulo: "Mandar o exército", pode: () => true,
        faz: (R, n) => { R.espada += 10; R.povo -= 6 + n * 8;
          anota(R, n > 1 ? "Foi batalha, não caçada. Voltou muito menos gente." : "O exército limpou a estrada. Voltaram menos do que foram."); } },
    ],
  },
  {
    id: "peste", tipo: "problema", espera: 6,
    quando: (R) => R.povo > 600 && R.saber < 45 && R.r() < 0.35,
    titulo: "A tosse que não passa",
    texto: (R, n) => n === 0
      ? "Começou no bairro dos curtumes e já chegou à praça. Ninguém sabe o que é."
      : "É a mesma tosse de antes. Desta vez começou já na praça.",
    opcoes: [
      { rotulo: "Fechar os portões", pode: () => true,
        faz: (R) => { R.povo -= Math.round(R.povo * 0.05); R.ouro -= 30; R.fe -= 6;
          anota(R, "Os portões fecharam por um ano. Morreu menos gente, e o comércio secou."); } },
      { rotulo: "Deixar correr", pode: () => true,
        faz: (R) => { R.povo -= Math.round(R.povo * 0.18);
          anota(R, "A peste correu solta. Uma casa em cinco ficou vazia."); } },
      { rotulo: "Chamar o clero", pode: (R) => R.fe > 40,
        faz: (R) => { R.povo -= Math.round(R.povo * 0.14); R.fe += 10;
          anota(R, "Houve procissão por nove dias. Morreram quase os mesmos, e rezaram por você."); } },
    ],
  },
  {
    id: "fome", tipo: "problema", espera: 3,
    quando: (R) => R.trigo < 120,
    titulo: "O celeiro está no fim",
    texto: (R, n) => n === 0
      ? "O responsável pelo celeiro veio de chapéu na mão, o que ele nunca faz."
      : "O responsável pelo celeiro nem tirou o chapéu desta vez. Já sabe a resposta.",
    opcoes: [
      { rotulo: "Racionar", pode: () => true,
        faz: (R) => { R.povo -= Math.round(R.povo * 0.04); R.fe -= 5; R.trigo += 120;
          anota(R, "Racionamos. Passou-se fome com ordem, que é como se passa fome num reino organizado."); } },
      { rotulo: "Tomar o trigo do clero", pode: (R) => R.fe > 30,
        faz: (R) => { R.trigo += 260; R.fe -= 25; anota(R, "O trigo do clero virou pão do povo. O bispo não esqueceu."); } },
    ],
  },
  {
    id: "herege", tipo: "problema", espera: 8,
    quando: (R) => R.saber > 35 && R.fe > 55,
    titulo: "O livro do copista",
    texto: (R, n) => n === 0
      ? "O clero achou, na biblioteca, um livro que diz que as estrelas não giram em torno de nós."
      : "Outro livro, outro copista. O bispo quer saber se vai ser sempre assim.",
    opcoes: [
      { rotulo: "Queimar o livro", pode: () => true,
        faz: (R) => { R.fe += 12; R.saber -= 15; anota(R, "O livro queimou na praça. O copista assistiu calado."); } },
      { rotulo: "Proteger o copista", pode: () => true,
        faz: (R) => { R.fe -= 15; R.saber += 10; anota(R, "O copista continuou copiando, sob a sua proteção. O bispo anotou o seu nome."); } },
    ],
  },
  {
    id: "imposto", tipo: "problema", espera: 5,
    quando: (R) => R.ouro < 60 && R.povo > 350,
    titulo: "O tesouro não fecha o ano",
    texto: (R, n) => n === 0
      ? "O tesoureiro trouxe as contas e não trouxe soluções."
      : "As contas de novo. Ele lembra, sem olhar nos seus olhos, do que você decidiu da última vez.",
    opcoes: [
      { rotulo: "Aumentar o imposto", pode: () => true,
        faz: (R, n) => { R.ouro += 90 + n * 20; R.fe -= 6; R.povo -= Math.round(R.povo * (0.01 + n * 0.01));
          anota(R, n ? "O imposto subiu de novo. Algumas famílias atravessaram a fronteira." : "O imposto subiu. Ninguém aplaudiu, ninguém saiu."); } },
      { rotulo: "Vender terra da coroa", pode: (R) => !R.tem.has("terravendida"),
        faz: (R) => { R.ouro += 140; R.tem.add("terravendida"); R.espada -= 8;
          anota(R, "Vendemos terra da coroa. Quem comprou agora tem opinião sobre o reino."); } },
    ],
  },

  /* ============ OFERTAS: insistem uma vez, depois desistem ============ */
  {
    id: "sabio", tipo: "oferta", espera: 4,
    quando: (R) => R.ouro > 100 && !R.tem.has("irrigacao"),
    titulo: "O forasteiro dos canais",
    texto: (R, n) => n === 0
      ? "Chegou com desenhos de valas que levam água do rio ao vale. Pede ouro e três anos."
      : "Voltou, mais velho e com menos paciência. Diz que é a última vez que oferece.",
    desistiu: "O forasteiro nunca mais voltou. Dizem que o vizinho do norte o recebeu bem.",
    opcoes: [
      { rotulo: "Financiar os canais", pode: (R) => R.ouro > 100,
        faz: (R) => { R.ouro -= 100; R.saber += 12; R.semeado.push({ ano: R.ano + 3, id: "canais" });
          anota(R, "Os canais começaram a ser cavados. Riram dele na praça."); } },
      { rotulo: "Mandar embora", pode: () => true, recusa: true,
        faz: (R) => { anota(R, "O forasteiro seguiu viagem. Levou os desenhos."); } },
    ],
  },
  {
    id: "mina", tipo: "oferta", espera: 5,
    quando: (R) => R.saber > 25 && !R.tem.has("mina"),
    titulo: "Acharam prata na montanha",
    texto: (R, n) => n === 0
      ? "Um pastor tropeçou no veio. O tesoureiro já sonha; o velho do moinho diz que a água desce de lá."
      : "O tesoureiro trouxe o assunto de volta, com números maiores e a mesma montanha.",
    desistiu: "A montanha ficou para sempre fechada. O velho do moinho morreu achando que tinha vencido.",
    opcoes: [
      { rotulo: "Abrir a mina", pode: () => true,
        faz: (R) => { R.tem.add("mina"); R.ouro += 60;
          /* A conta chega em oito anos. Você não vai lembrar desta escolha
             quando ela vier -- mas a crônica lembra, e é ela que te conta. */
          R.semeado.push({ ano: R.ano + 8, id: "rio" });
          anota(R, "A mina abriu. A prata desceu a montanha, e o rio também."); } },
      { rotulo: "Deixar a montanha em paz", pode: () => true, recusa: true,
        faz: (R) => { R.fe += 5; anota(R, "A montanha ficou fechada. O tesoureiro não falou com você por um mês."); } },
    ],
  },
  {
    id: "templo", tipo: "oferta", espera: 5,
    quando: (R) => R.fe > 58 && R.ouro > 130 && !R.tem.has("templo"),
    titulo: "O bispo quer a catedral",
    texto: (R, n) => n === 0
      ? "Diz que o reino já tem trigo demais e altar de menos."
      : "Trouxe a planta de novo, e desta vez trouxe o povo junto na porta.",
    desistiu: "O bispo parou de pedir a catedral. Passou a pedir outras coisas, em voz mais baixa.",
    opcoes: [
      { rotulo: "Construir", pode: (R) => R.ouro > 130,
        faz: (R) => { R.ouro -= 130; R.fe += 15; R.tem.add("templo");
          anota(R, "A catedral subiu em quatro anos. Dá para vê-la do vale."); } },
      { rotulo: "Ano que vem", pode: () => true, recusa: true,
        faz: (R) => { R.fe -= 8; anota(R, "A catedral ficou para o ano seguinte."); } },
    ],
  },
  {
    id: "guerra", tipo: "oferta", espera: 6,
    quando: (R) => R.espada > 60 && R.ouro < 200,
    titulo: "O general quer o vale do norte",
    texto: (R, n) => n === 0
      ? "Diz que é a hora: o vizinho está fraco e o vale é fértil. Os soldados estão parados há anos."
      : "Insiste. Diz que da última vez você tinha razão, e que desta vez não tem.",
    desistiu: "O general parou de falar em guerra. Parou de falar quase tudo.",
    opcoes: [
      { rotulo: "Marchar", pode: () => true,
        faz: (R) => { R.espada += 5; R.semeado.push({ ano: R.ano + 2, id: "volta" });
          anota(R, "O exército marchou para o norte na primavera."); } },
      { rotulo: "Recusar", pode: () => true, recusa: true,
        faz: (R) => { R.espada -= 14; anota(R, "Você recusou a guerra. O general cuspiu no chão ao sair."); } },
    ],
  },
  {
    id: "escola", tipo: "oferta", espera: 6,
    quando: (R) => R.saber > 30 && R.ouro > 120 && !R.tem.has("escola"),
    titulo: "Uma casa para ensinar os filhos dos outros",
    texto: (R, n) => n === 0
      ? "O copista propõe uma casa onde se ensine a ler a quem não é do castelo. Pede pouco e promete nada."
      : "Ele voltou com uma lista de nomes de crianças. Diz que não vai voltar uma terceira vez.",
    desistiu: "A casa de ensinar nunca existiu. O copista morreu ensinando três meninos na cozinha.",
    opcoes: [
      { rotulo: "Construir a escola", pode: (R) => R.ouro > 120,
        faz: (R) => { R.ouro -= 120; R.tem.add("escola"); R.semeado.push({ ano: R.ano + 6, id: "letrados" });
          anota(R, "A casa de ensinar abriu com onze alunos e nenhum livro seu."); } },
      { rotulo: "O reino não precisa disso", pode: () => true, recusa: true,
        faz: (R) => { anota(R, "O copista agradeceu a audiência e foi embora sem discutir."); } },
    ],
  },
  {
    id: "refugio", tipo: "oferta", espera: 7,
    quando: (R) => R.trigo > R.povo * 2 && R.r() < 0.5,
    titulo: "Chegaram famílias do sul",
    texto: (R, n) => n === 0
      ? "Fugiram de uma guerra que não é sua. São cento e poucas, e trazem ofício nas mãos."
      : "Chegou outro grupo. O primeiro ainda está acampado fora dos muros.",
    desistiu: "Pararam de vir. Souberam, de algum jeito, que aqui não adianta.",
    opcoes: [
      { rotulo: "Abrir os portões", pode: () => true,
        faz: (R) => { R.povo += 110; R.trigo -= 200; R.saber += 4; R.fe += 4;
          anota(R, "Entraram. Em dois anos ninguém lembrava que não eram daqui."); } },
      { rotulo: "Mandar seguir viagem", pode: () => true, recusa: true,
        faz: (R) => { R.fe -= 6; anota(R, "Seguiram viagem. Passaram a semana inteira passando."); } },
    ],
  },
];

/* ---------------- o que foi semeado, colhido ---------------- */
const COLHEITAS = {
  rio: (R) => { R.povo -= Math.round(R.povo * 0.08); R.fe -= 10;
    anota(R, "O rio abaixo da mina está morto. Ninguém liga uma coisa à outra, menos você."); },
  canais: (R) => { R.tem.add("irrigacao"); R.saber += 5;
    anota(R, "Os canais ficaram prontos. Na primeira seca o vale não secou — e pararam de rir."); },
  letrados: (R) => { R.saber += 18;
    anota(R, "A primeira turma da casa de ensinar saiu. Dois viraram escrivães, um virou problema."); },
  volta: (R) => {
    if (R.r() < 0.55) { R.ouro += 180; R.espada += 6; anota(R, "O exército voltou do norte com o vale e com carroças cheias."); }
    else { R.povo -= 40; R.espada -= 22; anota(R, "O exército voltou do norte sem o vale. Voltou com menos gente."); }
  },
};

/* ---------------- um ano ---------------- */
export function umAno(R) {
  R.ano++;

  const c = R.r();
  R.clima = c < 0.2 ? "seca" : c > 0.85 ? "fartura" : "bom";

  const colheita = { seca: 0.55, bom: 1.0, fartura: 1.35 }[R.clima] * (R.tem.has("irrigacao") ? 1.25 : 1);
  R.trigo += Math.round(R.povo * 2.2 * colheita) - Math.round(R.povo * 2.1);
  R.ouro += Math.round(R.povo * 0.06) + (R.tem.has("mina") ? 14 : 0);

  if (R.trigo < 0) { R.povo += Math.round(R.trigo / 8); R.trigo = 0; }
  R.povo += Math.round(R.povo * (R.trigo > R.povo ? 0.02 : -0.01));
  R.saber += R.ouro > 200 ? 2 : 1;

  /* A fé e a espada precisam de CAMINHO DE VOLTA.

     Antes eram -1 por ano, sempre, sem nada que subisse: os três reis do
     primeiro teste terminaram excomungados, cada um do seu jeito, porque a
     conta só descia. Isso não é dificuldade, é vazamento -- o jogador perde
     por aritmética, não por escolha. */
  R.fe += R.trigo > R.povo * 1.5 ? 1 : -2;
  if (R.tem.has("templo")) R.fe += 1;
  R.espada += R.ouro > 150 ? 1 : -2;
  R.fe = Math.max(0, Math.min(100, R.fe));
  R.espada = Math.max(0, Math.min(100, R.espada));

  for (const s of R.semeado.filter((s) => s.ano === R.ano)) COLHEITAS[s.id](R);
  R.semeado = R.semeado.filter((s) => s.ano > R.ano);

  if (R.povo < 120) R.fim = `O reino se esvaziou. Sobraram ${R.povo} pessoas, e nenhuma delas te procurou.`;
  else if (R.fe <= 0) R.fim = "O bispo te excomungou. Quem manda a partir de hoje reza melhor do que você.";
  else if (R.espada <= 0) R.fim = "O exército te abandonou. Foram embora sem barulho, que é o pior jeito.";
  return R.fim;
}

/* A petição do ano, se houver. Uma por vez: um rei decide uma coisa de cada
   vez, e uma tela de celular também. */
export function peticaoDoAno(R) {
  const cabem = PETICOES.filter((p) => {
    if (R.morta.has(p.id)) return false;
    if (!p.quando(R)) return false;
    const desde = R.ano - (R.ultima[p.id] ?? -99);
    return desde >= (p.espera ?? 3);
  });
  if (!cabem.length) return null;
  const p = cabem[Math.floor(R.r() * cabem.length)];
  const n = R.vezes[p.id] ?? 0;
  const opcoes = p.opcoes.filter((o) => o.pode(R));
  return { ...p, vez: n, texto: p.texto(R, n), opcoes };
}

export function decidir(R, peticao, indice) {
  const o = peticao.opcoes[indice];
  if (!o) return;
  const n = peticao.vez ?? 0;
  R.decisoes.push({ ano: R.ano, peticao: peticao.id, escolha: o.rotulo });
  R.vezes[peticao.id] = n + 1;
  R.ultima[peticao.id] = R.ano;
  o.faz(R, n);

  /* Oferta recusada duas vezes desiste de você -- e a crônica registra que
     desistiu. É o que separa um mundo de um baralho: quem te oferece algo
     tem paciência finita, e o mundo segue sem a sua resposta. */
  if (peticao.tipo === "oferta" && o.recusa) {
    R.recusas[peticao.id] = (R.recusas[peticao.id] ?? 0) + 1;
    if (R.recusas[peticao.id] >= 2) {
      R.morta.add(peticao.id);
      if (peticao.desistiu) anota(R, peticao.desistiu);
    }
  }
}
