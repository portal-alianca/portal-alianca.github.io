/* Bot do Discord da aliança (CYRON), atendido por HTTP.

   O portal não tem servidor ligado o tempo todo (GitHub Pages + Supabase), o que
   descartaria o bot clássico de gateway. Mas o Discord aceita receber os comandos
   por HTTP: ele assina cada chamada com Ed25519 e a gente confere a assinatura
   aqui. É por isso que verify_jwt fica desligado -- quem autentica é a assinatura
   do Discord, não um token do Supabase. */

const PUB_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ??
  "28b1131143b46b8e438c6dc19da7ce0c78f0e8037d0165287300dd4e8cd8f07e";
const APP_ID = Deno.env.get("DISCORD_APP_ID") ?? "1498142929041096856";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PORTAL = "https://portal-alianca.github.io/";
const COR = 16098851;
const COR_OK = 6208835;
const FONTE = "https://kingshotstats.com";
const BALDE = "top-midia";
const NOSSO_STORAGE = `${SB_URL}/storage/`;
const MAX_BYTES = 20 * 1024 * 1024;

/* Idiomas oferecidos no /mylanguage e usados como alvo do /Translate. Os
   códigos batem com o que o Google Translate espera. */
const LINGUAS: Record<string, string> = {
  pt: "Português", en: "Inglês", es: "Espanhol", ko: "Coreano", ja: "Japonês",
  "zh-CN": "Chinês", de: "Alemão", fr: "Francês", it: "Italiano", ru: "Russo",
  ar: "Árabe", tr: "Turco", id: "Indonésio", th: "Tailandês", vi: "Vietnamita",
  pl: "Polonês", nl: "Holandês", tl: "Filipino", hi: "Hindi", uk: "Ucraniano",
};

/* Mesmas bandeiras do seletor que o bot de conexão permanente pendura no canal,
   pra lista aberta e resposta terem a mesma cara. */
const BANDEIRA: Record<string, string> = {
  pt: "🇧🇷", en: "🇬🇧", es: "🇪🇸", ko: "🇰🇷", ja: "🇯🇵", "zh-CN": "🇨🇳",
  de: "🇩🇪", fr: "🇫🇷", it: "🇮🇹", ru: "🇷🇺", ar: "🇸🇦", tr: "🇹🇷",
  id: "🇮🇩", th: "🇹🇭", vi: "🇻🇳", pl: "🇵🇱", nl: "🇳🇱", tl: "🇵🇭",
  hi: "🇮🇳", uk: "🇺🇦",
};

/* O mesmo seletor vai junto da resposta efêmera, não só na mensagem do canal.
   Sem isso, trocar de idioma exigia rolar o chat de volta até a mensagem
   original; com ele a pessoa troca ali mesmo, e como a efêmera só existe pra
   ela, o Discord edita aquela resposta no lugar em vez de criar outra. */
function menuTraduzir(id: string, escolhido?: string) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `traduzir-msg:${id}`,
      placeholder: "🌐 Trocar de idioma / Change language",
      options: Object.keys(LINGUAS).map((c) => ({
        label: LINGUAS[c],
        value: c,
        emoji: { name: BANDEIRA[c] ?? "🌐" },
        default: c === escolhido,
      })),
    }],
  };
}

function hex(s: string): Uint8Array {
  const limpo = s.trim();
  const a = new Uint8Array(Math.floor(limpo.length / 2));
  for (let i = 0; i < a.length; i++) a[i] = parseInt(limpo.substr(i * 2, 2), 16);
  return a;
}

async function assinaturaConfere(req: Request, corpo: string): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  try {
    const k = await crypto.subtle.importKey("raw", hex(PUB_KEY), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, k, hex(sig), new TextEncoder().encode(ts + corpo));
  } catch {
    return false;
  }
}

async function sb(caminho: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return await r.json();
}

async function rpc(fn: string, corpo: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  return await r.json();
}

async function aliancaDoGuild(guildId: string | null) {
  if (!guildId) return null;
  const r = await sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guildId)}&select=alianca_id,aliancas(id,tag,nome,servidor)`);
  return (r && r[0]) ? r[0] : null;
}

/* Toda imagem vira arquivo nosso, venha de anexo ou de link.

   Dois motivos, os dois já vistos na prática: (1) o Discord NÃO carrega imagem
   do Tenor dentro de embed -- testado lado a lado, só a do nosso domínio
   apareceu; (2) a URL de anexo do Discord vem assinada e caduca em poucas horas,
   então guardar o link faria a imagem sumir sozinha depois. */
async function reHospedar(url: string, prefixo: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("baixar");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("grande");
  const base = decodeURIComponent(url.split("?")[0].split("/").pop() || "midia")
    .replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60);
  const caminho = `${prefixo}-${Date.now()}-${base}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BALDE}/${caminho}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": r.headers.get("content-type") || "application/octet-stream",
    },
    body: buf,
  });
  if (!up.ok) throw new Error("subir");
  return `${SB_URL}/storage/v1/object/public/${BALDE}/${caminho}`;
}

function fmtPoder(n: number) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}

function proximaOcorrencia(horaUtc: string, diaSemana: number | null): Date | null {
  const [h, m] = String(horaUtc).split(":").map(Number);
  const agora = new Date();
  for (let d = 0; d < 8; d++) {
    const t = new Date(Date.UTC(
      agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + d, h, m || 0, 0));
    if (t.getTime() <= agora.getTime()) continue;
    if (diaSemana === null || diaSemana === undefined || t.getUTCDay() === diaSemana) return t;
  }
  return null;
}

/* ---------------- traducao da propria resposta do bot ---------------- */

/* Dois caminhos até o mesmo tradutor, porque um deles fecha a porta aqui.

   O endpoint clássico (translate.googleapis.com/translate_a/single) devolve
   429 "Sorry..." para a saída do Supabase -- o Google barra IP de datacenter
   nele. Descobri isso do jeito ruim: o seletor de tradução respondia "Não
   consegui traduzir agora" e o erro era engolido por um catch mudo, então
   parecia bug nosso.

   O clients5 com o cliente do dicionário do Chrome passa, e é o mesmo motor
   de tradução. Fica em primeiro. O antigo continua em segundo porque funciona
   de outros lugares e pode voltar a funcionar daqui.

   Cada um responde num formato diferente, daí o `ler` de cada entrada. */
const TRADUTORES = [
  {
    nome: "google-dict",
    url: (t: string, alvo: string) =>
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${alvo}&q=${encodeURIComponent(t)}`,
    /* [["texto traduzido","en"]] */
    ler: (j: any) => ({
      traduzido: Array.isArray(j) ? j.map((p: any) => (Array.isArray(p) ? p[0] : p)).join("") : "",
      idioma: (Array.isArray(j) && Array.isArray(j[0]) ? j[0][1] : "") || "",
    }),
  },
  {
    nome: "google-gtx",
    url: (t: string, alvo: string) =>
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${alvo}&dt=t&q=${encodeURIComponent(t)}`,
    /* [[["pedaço","original",...],...], null, "en"] */
    ler: (j: any) => ({
      traduzido: (j?.[0] || []).map((p: any) => p?.[0] || "").join(""),
      idioma: j?.[2] || "",
    }),
  },
];

async function traduzirTexto(texto: string, alvo: string): Promise<{ idioma: string; traduzido: string } | null> {
  for (const t of TRADUTORES) {
    try {
      const r = await fetch(t.url(texto, alvo), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        /* Silêncio aqui foi o que escondeu o 429 por horas. */
        console.error(`traducao: ${t.nome} devolveu HTTP ${r.status}`);
        continue;
      }
      const lido = t.ler(await r.json());
      if (lido.traduzido) return lido;
      console.error(`traducao: ${t.nome} respondeu 200 mas veio vazio`);
    } catch (e) {
      console.error(`traducao: ${t.nome} falhou:`, String(e).slice(0, 120));
    }
  }
  return null;
}

/* Traduz o embed inteiro (titulo, descricao, rodape, campos) pro idioma que o
   jogador escolheu em /mylanguage. Em português nao mexe em nada -- e o idioma
   em que todo o conteudo ja é escrito. */
async function traduzirEmbed(embed: Record<string, any>, idioma: string): Promise<Record<string, any>> {
  if (idioma === "pt") return embed;
  const campo = async (s: unknown) => {
    if (typeof s !== "string" || !s.trim()) return s;
    const r = await traduzirTexto(s, idioma);
    return r?.traduzido || s;
  };
  const novo: Record<string, any> = { ...embed };
  const [title, description, footerText, fields] = await Promise.all([
    campo(novo.title),
    campo(novo.description),
    novo.footer?.text ? campo(novo.footer.text) : Promise.resolve(undefined),
    Array.isArray(novo.fields)
      ? Promise.all(novo.fields.map(async (f: any) => ({ ...f, name: await campo(f.name), value: await campo(f.value) })))
      : Promise.resolve(undefined),
  ]);
  if (novo.title) novo.title = title;
  if (novo.description) novo.description = description;
  if (novo.footer?.text) novo.footer = { ...novo.footer, text: footerText };
  if (fields) novo.fields = fields;
  return novo;
}

async function resposta(embed: Record<string, unknown>, efemera = false, idioma = "pt") {
  const final = await traduzirEmbed(embed, idioma);
  return { type: 4, data: { embeds: [{ color: COR, ...final }], ...(efemera ? { flags: 64 } : {}) } };
}

/* components fica opcional de proposito: quem nao passa nada (todos os comandos)
   segue mandando so o embed, e o Discord deixa o que ja estava na mensagem. */
async function editarResposta(
  token: string,
  embed: Record<string, unknown>,
  idioma = "pt",
  components?: unknown[],
) {
  const final = await traduzirEmbed(embed, idioma);
  await fetch(`https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ color: COR, ...final }],
      ...(components ? { components } : {}),
    }),
  });
}

async function cmdEventos(aliancaId: string, tag: string, idioma: string) {
  /* Dois modelos de agenda convivem: proxima_em guarda a data exata da próxima
     vez (para o que não tem dia fixo, como o Urso -- a armadilha recarrega em
     ~47h30 e o dia anda pelo calendário), e hora_utc/dia_semana cobrem o que é
     mesmo semanal. Quando as duas estão preenchidas, a data exata manda. */
  const evs = await sb(`top_eventos?alianca_id=eq.${aliancaId}&ativa=eq.true&select=titulo,hora_utc,dia_semana,proxima_em&order=ordem`);
  const agora = Date.now();
  const proximos = (evs || [])
    .map((e: any) => ({
      titulo: e.titulo,
      quando: e.proxima_em
        ? new Date(e.proxima_em)
        : (e.hora_utc ? proximaOcorrencia(e.hora_utc, e.dia_semana) : null),
    }))
    /* Data marcada que já passou some da lista em vez de aparecer como se fosse
       futura: o portal cobra do oficial a próxima, e até ele marcar não há o
       que prometer. */
    .filter((e: any) => e.quando && e.quando.getTime() > agora)
    .sort((a: any, b: any) => a.quando - b.quando).slice(0, 8);

  if (!proximos.length) {
    return resposta({ title: "📅 Agenda da aliança",
      description: `Nenhum evento com horário marcado ainda.\nOs oficiais marcam no [portal](${PORTAL}).` }, false, idioma);
  }
  return resposta({
    title: `📅 Próximos eventos — ${tag}`,
    description: proximos.map((e: any) =>
      `**${e.titulo}**\n<t:${Math.floor(e.quando.getTime() / 1000)}:R> · <t:${Math.floor(e.quando.getTime() / 1000)}:t>`).join("\n\n"),
    footer: { text: "O horário aparece no seu fuso automaticamente" },
  }, false, idioma);
}

async function rankingDoJogo(reino: string, sigla: string, quantos: number, tag: string) {
  const slug = String(sigla || "").replace(/[^a-zA-Z0-9]/g, "");
  const kid = parseInt(String(reino || ""), 10);
  if (!kid || !slug) return null;
  const r = await fetch(`${FONTE}/api/alliances/lookup?kid=${kid}&slug=${encodeURIComponent(slug)}`,
    { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const d = await r.json();
  const membros: any[] = d?.members || [];
  if (!membros.length) return null;

  const ord = membros.slice().sort((a, b) => (b.power || 0) - (a.power || 0));
  const medalha = ["🥇", "🥈", "🥉"];
  const mostra = ord.slice(0, quantos);
  const total = ord.reduce((s, m) => s + (Number(m.power) || 0), 0);
  return {
    title: `⚡ Ranking da aliança — ${tag}`,
    description: mostra.map((m, i) =>
      `${medalha[i] || `**${i + 1}**`} ${m.nick_name} — \`${fmtPoder(m.power)}\``).join("\n"),
    footer: { text: `Mostrando ${mostra.length} de ${ord.length} membros · Poder total ${fmtPoder(total)}` +
      (ord.length > mostra.length ? ` · use /ranking amount:${Math.min(ord.length, 100)} pra ver todos` : "") },
  };
}

async function rankingDoPortal(aliancaId: string, tag: string) {
  const ms = await sb(`top_membros?alianca_id=eq.${aliancaId}&poder=gt.0&status=neq.saiu&select=nome,poder,castelo&order=poder.desc&limit=25`);
  if (!ms || !ms.length) {
    return { title: "⚡ Ranking de poder", description: `Não consegui a lista agora, e ninguém tem poder registrado no [portal](${PORTAL}) ainda.` };
  }
  const medalha = ["🥇", "🥈", "🥉"];
  return {
    title: `⚡ Ranking de poder — ${tag}`,
    description: ms.map((m: any, i: number) =>
      `${medalha[i] || `**${i + 1}**`} ${m.nome} — \`${fmtPoder(m.poder)}\`${m.castelo ? ` · CV${m.castelo}` : ""}`).join("\n"),
    footer: { text: "Lista do portal (a do jogo não respondeu agora)" },
  };
}

async function completarRanking(token: string, vinculo: any, tag: string, quantos: number, idioma: string) {
  const a = vinculo.aliancas || {};
  let embed: Record<string, unknown> | null = null;
  try { embed = await rankingDoJogo(a.servidor, a.tag, quantos, tag); } catch { /* reserva abaixo */ }
  if (!embed) {
    try { embed = await rankingDoPortal(vinculo.alianca_id, tag); }
    catch { embed = { title: "❌ Algo falhou", description: "Não consegui montar o ranking agora. Tente de novo em instantes." }; }
  }
  await editarResposta(token, embed, idioma);
}

async function completarJogador(token: string, fid: string, idioma: string) {
  let embed: Record<string, unknown>;
  try {
    const r = await fetch(`${FONTE}/api/search?q=${encodeURIComponent(fid)}&limit=5&live=1`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const m = (d?.results || []).find((x: any) => String(x.fid) === fid);
    embed = m ? {
      title: `👤 ${m.nick_name}`,
      thumbnail: m.avatar_url ? { url: m.avatar_url } : undefined,
      fields: [
        { name: "Poder", value: fmtPoder(m.power), inline: true },
        { name: "Castelo", value: String(m.stove_lv ?? m.town_center_level ?? "—"), inline: true },
        { name: "Reino", value: String(m.kid ?? "—"), inline: true },
        { name: "Aliança", value: m.alliance_abbr ? `[${m.alliance_abbr}] ${m.alliance_name ?? ""}` : "—", inline: true },
      ],
    } : { title: "🤔 Não achei esse ID", description: `Nada encontrado para \`${fid}\`. Confira o número no perfil do jogo.` };
  } catch {
    embed = { title: "❌ Deu ruim na consulta", description: "Não consegui buscar esse jogador agora. Tente de novo em instantes." };
  }
  await editarResposta(token, embed, idioma);
}

async function completarBoasVindasIdioma(token: string, discordUserId: string, idioma: string, embedOriginal: any) {
  try { await salvarIdiomaJogador(discordUserId, idioma); } catch { /* traduz mesmo assim */ }
  await editarResposta(token, embedOriginal || {}, idioma);
}

async function completarTraduzirMsg(token: string, discordUserId: string, id: string, idioma: string) {
  let embed: Record<string, unknown>;
  let achou = false;
  try {
    salvarIdiomaJogador(discordUserId, idioma).catch(() => {}); // nao bloqueia a traducao
    const r = await sb(`discord_msg_traducao?id=eq.${id}&select=texto,link`);
    const texto = r?.[0]?.texto;
    const link = r?.[0]?.link;
    if (!texto) {
      embed = { title: "🤔 Não encontrei mais essa mensagem", description: "Ela pode ter expirado. Tente traduzir de novo com o **Translate** (clique direito na mensagem → Apps)." };
    } else {
      const t = await traduzirTexto(texto, idioma);
      if (t?.traduzido) {
        achou = true;
        /* O link de volta é o remendo possível para uma limitação do Discord:
           resposta efêmera nasce sempre no fim do canal, e não há como pedir
           outro lugar. Quem tocou no seletor de um recado antigo foi jogado
           pra baixo; com o link, voltar é um toque em vez de rolar na mão.
           O rótulo vai nos dois idiomas porque o embed não é traduzido aqui --
           ele já sai no idioma escolhido, e traduzir de novo custaria uma
           chamada a mais só pra duas palavras. */
        embed = {
          title: `${BANDEIRA[idioma] ?? "🌐"} ${LINGUAS[idioma] ?? idioma}`,
          description: t.traduzido.slice(0, 3800)
            + (link ? `\n\n[⤴ Voltar / Back](${link})` : ""),
          footer: { text: "Só você está vendo isto · troque o idioma abaixo" },
        };
      } else {
        embed = { title: "❌ Não deu", description: "Não consegui traduzir agora. Tente de novo em instantes." };
      }
    }
  } catch {
    embed = { title: "❌ Não deu", description: "Não consegui traduzir agora. Tente de novo em instantes." };
  }
  /* O seletor volta junto da resposta: quem quiser ler noutro idioma troca sem
     precisar rolar o chat de volta ate a mensagem original. So faz sentido
     quando a traducao deu certo -- num erro o texto ja nao existe mais. */
  await editarResposta(token, embed, "pt", achou ? [menuTraduzir(id, idioma)] : undefined);
}

/* ---------------- /mylanguage e "Translate" ---------------- */

async function idiomaDoJogador(discordUserId: string): Promise<string> {
  try {
    const r = await sb(`discord_idioma_jogador?discord_user_id=eq.${discordUserId}&select=idioma`);
    return r?.[0]?.idioma || "en"; // ninguem configurou ainda -> ingles por padrao
  } catch {
    return "en";
  }
}

async function salvarIdiomaJogador(discordUserId: string, idioma: string) {
  const r = await fetch(`${SB_URL}/rest/v1/discord_idioma_jogador`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ discord_user_id: discordUserId, idioma, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`salvar idioma ${r.status}`);
}

async function completarMeuIdioma(token: string, discordUserId: string, idioma: string) {
  let embed: Record<string, unknown>;
  try {
    await salvarIdiomaJogador(discordUserId, idioma);
    embed = { color: COR_OK, title: "🌐 Idioma salvo!",
      description: `A partir de agora, todos os comandos e o **Translate** (clique direito numa mensagem → Apps) aparecem em **${LINGUAS[idioma] ?? idioma}**.` };
  } catch {
    embed = { title: "❌ Não deu", description: "Não consegui salvar agora. Tente de novo em instantes." };
  }
  // a confirmacao ja sai no idioma que a pessoa acabou de escolher
  await editarResposta(token, embed, idioma);
}

async function completarTraduzir(token: string, discordUserId: string, texto: string) {
  let embed: Record<string, unknown>;
  try {
    if (!texto.trim()) {
      embed = { title: "🤔 Mensagem vazia", description: "Essa mensagem não tem texto pra traduzir (só imagem/anexo, por exemplo)." };
    } else {
      const alvo = await idiomaDoJogador(discordUserId);
      const r = await traduzirTexto(texto, alvo);
      embed = r && r.traduzido
        ? { title: `🌐 Tradução (${LINGUAS[alvo] ?? alvo})`, description: r.traduzido.slice(0, 3800),
            footer: { text: "Quer mudar o idioma? Use /mylanguage" } }
        : { title: "❌ Não deu", description: "Não consegui traduzir agora. Tente de novo em instantes." };
    }
  } catch {
    embed = { title: "❌ Não deu", description: "Não consegui traduzir agora. Tente de novo em instantes." };
  }
  await editarResposta(token, embed); // ja sai no idioma certo, nao traduz de novo
}

/* ---------------- /settings ---------------- */

async function midiaDaOpcao(i: any, sub: any, prefixo: string): Promise<string | null> {
  const pega = (n: string) => (sub.options || []).find((o: any) => o.name === n)?.value;

  const idAnexo = pega("file");
  if (idAnexo) {
    const anexo = i.data?.resolved?.attachments?.[idAnexo];
    if (!anexo?.url) throw new Error("anexo");
    if (Number(anexo.size) > MAX_BYTES) throw new Error("grande");
    return await reHospedar(anexo.url, prefixo);
  }

  const link = String(pega("link") || "").trim();
  if (!link) return null;
  if (!/^https:\/\/\S+$/i.test(link)) throw new Error("link");
  if (link.startsWith(NOSSO_STORAGE)) return link;   // já é nosso, nao copia de novo
  return await reHospedar(link, prefixo);            // link também vem pra casa
}

async function completarConfigurar(token: string, i: any, sub: any, idioma: string) {
  const guild = i.guild_id ?? null;
  const pega = (n: string) => (sub.options || []).find((o: any) => o.name === n)?.value;
  let embed: Record<string, unknown>;

  try {
    if (sub.name === "server") {
      const r = await rpc("discord_ligar_servidor", { p_guild: guild, p_codigo: String(pega("code") || "") });
      embed = r?.ok
        ? { color: COR_OK, title: "🔗 Servidor ligado!",
            description: `Este Discord agora responde pela **${r.tag ?? ""} ${r.nome ?? ""}**.\nJá pode usar \`/ranking\` e \`/events\`.` }
        : { title: "❌ Não deu", description: {
              codigo: "Esse código de oficial não confere com nenhuma aliança.",
              guild: "Não consegui identificar este servidor.",
              guild_usado: "Este servidor já está ligado a outra aliança.",
            }[r?.erro as string] ?? "Tente de novo em instantes." };

    } else if (sub.name === "event-gif") {
      const titulo = String(pega("event") || "").trim();
      const url = await midiaDaOpcao(i, sub, "evento");
      const r = await rpc("discord_gif_evento", { p_guild: guild, p_titulo: titulo, p_url: url });
      embed = r?.ok
        ? { color: COR_OK, title: url ? "🖼️ GIF definido!" : "🧹 GIF removido",
            description: `**${titulo}**` + (url ? `\nVai aparecer no aviso deste evento.` : `\nO aviso volta a ser só texto.`),
            ...(url ? { image: { url } } : {}) }
        : { title: "❌ Não deu", description: {
              sem_vinculo: "Este servidor ainda não está ligado a uma aliança. Use `/settings server` primeiro.",
              evento: `Não achei um evento chamado **${titulo}** nesta aliança.`,
            }[r?.erro as string] ?? "Tente de novo em instantes." };

    } else if (sub.name === "welcome-gif") {
      const limpar = pega("clear") === true;
      const url = limpar ? null : await midiaDaOpcao(i, sub, "boasvindas");
      if (!limpar && !url) {
        embed = { title: "🤔 Faltou a imagem", description: "Mande um **arquivo** ou um **link**. Ou use `clear: true` pra apagar os atuais." };
      } else {
        const r = await rpc("discord_gif_boas_vindas", { p_guild: guild, p_url: url, p_limpar: limpar });
        embed = r?.ok
          ? (limpar
              ? { color: COR_OK, title: "🧹 GIFs de boas-vindas apagados", description: "As boas-vindas passam a ser só texto." }
              : { color: COR_OK, title: "🎉 GIF de boas-vindas somado!",
                  description: `Agora são **${r.total}** no sorteio.`, image: { url: url! } })
          : { title: "❌ Não deu", description: r?.erro === "sem_vinculo"
              ? "Este servidor ainda não está ligado a uma aliança. Use `/settings server` primeiro."
              : "Tente de novo em instantes." };
      }

    } else { // view
      const v = await aliancaDoGuild(guild);
      if (!v) {
        embed = { title: "🔗 Servidor não ligado", description: "Use `/settings server code:<código de oficial>` pra começar." };
      } else {
        const a = v.aliancas || {};
        const evs = await sb(`top_eventos?alianca_id=eq.${v.alianca_id}&ativa=eq.true&select=titulo,gif_url&order=ordem`);
        const gifs = await sb(`discord_gifs?uso=eq.boas_vindas&ativo=eq.true&select=id`);
        const cfg = await sb(`alianca_discord?guild_id=eq.${encodeURIComponent(guild!)}&select=webhook,webhook_boas_vindas`);
        const comGif = (evs || []).filter((e: any) => e.gif_url);
        embed = {
          title: `⚙️ Configuração — ${a.tag ?? ""} ${a.nome ?? ""}`,
          fields: [
            { name: "Canal de avisos", value: (cfg?.[0]?.webhook ? "✅ ligado" : "❌ sem webhook"), inline: true },
            { name: "Canal de boas-vindas", value: (cfg?.[0]?.webhook_boas_vindas ? "✅ ligado" : "— usa o de avisos"), inline: true },
            { name: "GIFs de boas-vindas", value: String((gifs || []).length), inline: true },
            { name: "Eventos com GIF", value: `${comGif.length} de ${(evs || []).length}` },
            { name: "Quais têm GIF", value: comGif.length ? comGif.map((e: any) => `• ${e.titulo}`).join("\n").slice(0, 1000) : "—" },
          ],
        };
      }
    }
  } catch (e) {
    const m = String((e as Error)?.message || "");
    embed = { title: "❌ Não deu", description:
      m === "grande" ? "Esse arquivo passa de 20 MB. Mande um menor ou use um link."
      : m === "link" ? "O link precisa começar com `https://`."
      : m === "baixar" ? "Não consegui baixar essa imagem. Confira se o link abre direto no arquivo."
      : m === "subir" ? "Baixei o arquivo mas não consegui guardar. Tente de novo."
      : "Algo falhou. Tente de novo em instantes." };
  }
  await editarResposta(token, embed, idioma);
}

Deno.serve(async (req) => {
  const corpo = await req.text();
  if (!(await assinaturaConfere(req, corpo))) return new Response("assinatura invalida", { status: 401 });

  let i: any;
  try { i = JSON.parse(corpo); } catch { return new Response("json invalido", { status: 400 }); }

  const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
  const emBackground = (p: Promise<unknown>) => {
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* segue sem */ }
  };

  if (i.type === 1) return J({ type: 1 });

  /* Autocompletar do nome do evento: sem isso o oficial teria que digitar
     "Urso (Bear Trap) 1" exatamente igual, acentos e parênteses inclusive. */
  if (i.type === 4) {
    try {
      const sub = (i.data?.options || [])[0];
      const digitado = String((sub?.options || []).find((o: any) => o.focused)?.value || "").toLowerCase();
      const evs = await rpc("discord_eventos_do_guild", { p_guild: i.guild_id ?? null });
      const opts = (evs || [])
        .filter((e: any) => !digitado || String(e.titulo).toLowerCase().includes(digitado))
        .slice(0, 25)
        .map((e: any) => ({ name: (e.tem_gif ? "🖼️ " : "") + e.titulo, value: e.titulo }));
      return J({ type: 8, data: { choices: opts } });
    } catch {
      return J({ type: 8, data: { choices: [] } });
    }
  }

  const autorIdCedo = i.member?.user?.id ?? i.user?.id;

  /* Clique no seletor que sai embaixo de um aviso automático (evento, arena,
     dica do dia) -- traduz só pra quem clicou, sem empilhar todo idioma no
     canal. O texto original foi guardado pelo bot de conexão permanente na
     hora que postou o seletor. */
  if (i.type === 3 && String(i.data?.custom_id || "").startsWith("traduzir-msg:")) {
    const id = String(i.data.custom_id).slice("traduzir-msg:".length);
    const idioma = String(i.data?.values?.[0] || "");
    const autorId = i.member?.user?.id ?? i.user?.id;
    if (!LINGUAS[idioma]) return J(await resposta({ title: "🤔 Não reconheci esse idioma" }, true));
    emBackground(completarTraduzirMsg(i.token, autorId, id, idioma));

    /* Se o clique veio da própria resposta efêmera (ela também leva o seletor),
       edita ela no lugar -- assim trocar de idioma não empurra uma mensagem
       nova pro fim do canal, obrigando a pessoa a rolar de volta. Vindo da
       mensagem pública do canal, aí sim cria a efêmera. */
    const naEfemera = (Number(i.message?.flags ?? 0) & 64) !== 0;
    return J(naEfemera ? { type: 6 } : { type: 5, data: { flags: 64 } });
  }

  /* Clique no seletor de idioma que sai junto do aviso de boas-vindas --
     mesma gravação do /meuidioma, só que sem precisar digitar comando. */
  if (i.type === 3 && i.data?.custom_id === "escolher-idioma") {
    const idioma = String(i.data?.values?.[0] || "");
    if (!LINGUAS[idioma]) return J(await resposta({ title: "🤔 Não reconheci esse idioma" }, true));

    /* No card de boas-vindas (tem "Boas-vindas" no título) a gente edita a
       propria mensagem pra ela já nascer traduzida -- é publica e é sobre
       uma pessoa só, faz sentido. Nos outros lugares (aviso fixado, prompt
       do webhook) isso seria estranho: sao compartilhados por todo mundo. */
    const embedOriginal = i.message?.embeds?.[0];
    if (String(embedOriginal?.title || "").includes("Boas-vindas")) {
      emBackground(completarBoasVindasIdioma(i.token, autorIdCedo, idioma, embedOriginal));
      return J({ type: 6 }); // DEFERRED_UPDATE_MESSAGE: edita a mensagem original
    }

    emBackground(completarMeuIdioma(i.token, autorIdCedo, idioma));
    return J({ type: 5, data: { flags: 64 } });
  }

  if (i.type !== 2) return J({ type: 1 });

  const nome = i.data?.name;
  const opts: any[] = i.data?.options || [];
  const arg = (n: string) => opts.find((o) => o.name === n)?.value;
  const autorId = autorIdCedo;
  const idioma = await idiomaDoJogador(autorId);

  try {
    if (nome === "settings") {
      const sub = opts[0];
      if (!sub) return J(await resposta({ title: "🤷 Falta dizer o que configurar", description: "Tente `/settings view`." }, true, idioma));
      emBackground(completarConfigurar(i.token, i, sub, idioma));
      return J({ type: 5, data: { flags: 64 } });   // só quem mandou vê
    }

    if (nome === "portal") {
      return J(await resposta({ title: "🏰 Portal da Aliança",
        description: `Agenda no seu fuso, tutoriais dos eventos e ranking.\n\n${PORTAL}` }, false, idioma));
    }

    if (nome === "player") {
      const fid = String(arg("id") ?? "").trim();
      if (!/^\d{5,15}$/.test(fid)) {
        return J(await resposta({ title: "🤔 ID estranho", description: "O ID do jogo é só números. Veja no seu perfil dentro do jogo." }, true, idioma));
      }
      emBackground(completarJogador(i.token, fid, idioma));
      return J({ type: 5 });
    }

    if (nome === "mylanguage") {
      const novoIdioma = String(arg("language") ?? "");
      if (!LINGUAS[novoIdioma]) {
        return J(await resposta({ title: "🤔 Idioma não reconhecido", description: "Escolha uma das opções da lista." }, true, idioma));
      }
      emBackground(completarMeuIdioma(i.token, autorId, novoIdioma));
      return J({ type: 5, data: { flags: 64 } });
    }

    if (nome === "Translate") {
      const alvoId = i.data?.target_id;
      const msgAlvo = i.data?.resolved?.messages?.[alvoId];
      const texto = String(msgAlvo?.content || "");
      emBackground(completarTraduzir(i.token, autorId, texto));
      return J({ type: 5, data: { flags: 64 } });   // efêmera: só quem clicou vê
    }

    const vinculo = await aliancaDoGuild(i.guild_id ?? null);
    if (!vinculo) {
      return J(await resposta({
        title: "🔗 Falta ligar este servidor à aliança",
        description: "Um oficial resolve isso aqui mesmo:\n\n`/settings server code:<código de oficial>`\n\n" +
          `O código está no [portal](${PORTAL}), em **Painel do oficial → Minha aliança**.`,
      }, true, idioma));
    }
    const a = vinculo.aliancas || {};
    const tag = a.tag ? (/^\[.*\]$/.test(a.tag) ? a.tag : `[${a.tag}]`) : "Aliança";

    if (nome === "events") return J(await cmdEventos(vinculo.alianca_id, tag, idioma));

    if (nome === "ranking") {
      let quantos = parseInt(String(arg("amount") ?? "15"), 10);
      if (!Number.isFinite(quantos)) quantos = 15;
      quantos = Math.max(1, Math.min(100, quantos));
      emBackground(completarRanking(i.token, vinculo, tag, quantos, idioma));
      return J({ type: 5 });
    }

    return J(await resposta({ title: "🤷 Não conheço esse comando", description: "Tente /events, /ranking, /player, /portal ou /settings." }, true, idioma));
  } catch {
    return J(await resposta({ title: "❌ Algo falhou", description: "Não consegui buscar os dados agora. Tente de novo em instantes." }, true, idioma));
  }
});
