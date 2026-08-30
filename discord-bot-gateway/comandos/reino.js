const r = await fetch("https://mightpulse.com/api/kingdoms/2311/ingame-ranks", {
  headers: { "User-Agent": "CYRON/1.0" },
  signal: AbortSignal.timeout(20000),
});
if (!r.ok) return `Could not reach mightpulse (HTTP ${r.status}).`;
const d = await r.json();

const alis = d.boards?.["1"]?.rows || [];
const jogs = d.boards?.["3"]?.rows || [];
if (!alis.length && !jogs.length) return "The site answered, but sent no ranking.";

const n = (v) => Number(v || 0).toLocaleString("en-US");
const MEDALHA = ["🥇", "🥈", "🥉"];

/* Barra relativa ao 1º: faz a distância virar imagem, não conta. Mínimo de
   um bloco pra quem pontuou — barra vazia parece erro, não "muito atrás". */
const barra = (v, topo, larg = 12) => {
  const c = topo > 0 && v > 0 ? Math.max(1, Math.round((v / topo) * larg)) : 0;
  return "`" + "█".repeat(c) + "░".repeat(larg - c) + "` " +
    Math.round(topo > 0 ? (v / topo) * 100 : 0) + "%";
};

/* Pódio com barra; o resto em linha só: 50 barras seriam parede. */
const podio = (l, nome, ate) => {
  const topo = Number(l[0]?.score || 0);
  return l.slice(0, ate).map((x, i) =>
    `${i < 3 ? MEDALHA[i] : `\`${String(i + 1).padStart(2)}\``} **${nome(x)}** — ${n(x.score)}\n` +
    barra(Number(x.score), topo)).join("\n");
};

const fila = (l, de, ate, nome) => l.slice(de, ate)
  .map((x, i) => `\`${String(de + i + 1).padStart(2)}\` ${nome(x)} — ${n(x.score)}`).join("\n");

const nomeA = (x) => `[${x.abbr}] ${x.name}`;
const nomeJ = (x) => x.nick_name;
const quando = Math.floor(d.captured_at || Date.now() / 1000);

const campos = [];
if (alis.length) campos.push({ name: `🏰 Top ${Math.min(10, alis.length)} alliances`, value: podio(alis, nomeA, 10) });
if (jogs.length) {
  campos.push({ name: `⚔️ Top ${Math.min(50, jogs.length)} players`, value: podio(jogs, nomeJ, 10) });
  if (jogs.length > 10) campos.push({ name: "​", value: fila(jogs, 10, 30, nomeJ) });
  if (jogs.length > 30) campos.push({ name: "​", value: fila(jogs, 30, 50, nomeJ) });
}
campos.push({ name: "👑 Leader", value: alis[0] ? nomeA(alis[0]) : "—", inline: true });
campos.push({ name: "🏰 Top 10 combined", inline: true,
  value: n(alis.slice(0, 10).reduce((a, x) => a + Number(x.score || 0), 0)) });
campos.push({ name: "🕐 Captured", value: `<t:${quando}:R>`, inline: true });

/* Nome longo demais estoura os 1024 do campo e derruba o cartão INTEIRO. */
for (const c of campos) {
  if (c.value.length > 1024) c.value = c.value.slice(0, c.value.lastIndexOf("\n", 1024));
}

const cartao = { embeds: [{
  color: 0xE0A63A,
  title: "🏆 Kingdom #2311 — power ranking",
  url: "https://mightpulse.com/kingdom/2311",
  fields: campos,
  footer: { text: "mightpulse.com · bars are relative to 1st place" },
  timestamp: new Date(quando * 1000).toISOString(),
}] };

/* Reaproveita o fixado: ranking fixado é pra ficar no mesmo lugar. */
let fixada = null;
try {
  const { items } = await canal.messages.fetchPins();
  fixada = items.find((p) => p.message.author.id === client.user.id
    && (p.message.embeds?.[0]?.title || "").startsWith("🏆 Kingdom #2311"))?.message || null;
} catch { /* sem permissão de ler fixadas: cai no envio novo */ }

if (fixada) {
  await fixada.edit(cartao);
  return `📌 Pinned ranking updated: ${fixada.url}`;
}
const nova = await canal.send(cartao);
try {
  await nova.pin();
} catch {
  return `Posted, but I could not pin it — I need **Manage Messages** here.\n${nova.url}`;
}
return `📌 Ranking posted and pinned: ${nova.url}`;
