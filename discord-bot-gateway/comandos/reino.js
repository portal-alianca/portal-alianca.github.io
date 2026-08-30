const clique = inter?.customId || "";

if (clique === "dono:reino:eu") {
  return inter.showModal({
    custom_id: "dono:reino:busca", title: "Where am I?",
    components: [{ type: 1, components: [{
      type: 4, custom_id: "quem", style: 1, required: true, max_length: 40,
      label: "Your in-game name or ID", placeholder: "The Saint   or   92207671" }] }],
  });
}

const r = await fetch("https://mightpulse.com/api/kingdoms/2311/ingame-ranks", {
  headers: { "User-Agent": "CYRON/1.0" }, signal: AbortSignal.timeout(20000),
});
if (!r.ok) return `Could not reach mightpulse (HTTP ${r.status}).`;
const d = await r.json();
const alis = d.boards?.["1"]?.rows || [];
const jogs = d.boards?.["3"]?.rows || [];
if (!alis.length && !jogs.length) return "The site answered, but sent no ranking.";

const n = (v) => Number(v || 0).toLocaleString("en-US");
const MED = ["🥇", "🥈", "🥉"];
const barra = (v, topo, larg = 12) => {
  const c = topo > 0 && v > 0 ? Math.max(1, Math.round((v / topo) * larg)) : 0;
  return "`" + "█".repeat(c) + "░".repeat(larg - c) + "` " +
    Math.round(topo > 0 ? (v / topo) * 100 : 0) + "%";
};

if (clique === "dono:reino:busca") {
  const q = String(inter.fields.getTextInputValue("quem") || "").trim().toLowerCase();
  /* ID, depois nome exato, e só então parcial: quem digita o nome inteiro não
     pode cair no de outro que apenas contenha o dele. */
  const eu = jogs.find((x) => String(x.uid) === q)
    || jogs.find((x) => String(x.nick_name || "").toLowerCase() === q)
    || jogs.find((x) => String(x.nick_name || "").toLowerCase().includes(q));

  if (!eu) return { flags: 64, embeds: [{
    color: 0x9AA0A6, title: "🔍 Not in the top 100",
    description: `No **${q}** in the top ${jogs.length} of Kingdom 2311.\n\n` +
      `The cut-off is **${n(jogs[jogs.length - 1]?.score)}** power.\n\n` +
      "_Check the spelling, or use your numeric ID._",
  }] };

  const alvo = jogs[9];
  const dentro = eu.rank <= 10;
  return { flags: 64, embeds: [{
    color: dentro ? 0xE0A63A : 0x4A6FA5,
    title: `${dentro ? MED[eu.rank - 1] || "🏅" : "📊"} ${eu.nick_name}`,
    ...(eu.avatar_url ? { thumbnail: { url: eu.avatar_url } } : {}),
    description: `**#${eu.rank}** of ${jogs.length} · ${n(eu.score)} power` +
      (eu.alliance_abbr ? ` · [${eu.alliance_abbr}]` : "") + "\n" +
      barra(Number(eu.score), Number(jogs[0].score)) + " of 1st place\n\n" +
      (dentro ? "🎉 **You are in the top 10.**"
        : `**${n(Number(alvo.score) - Number(eu.score))}** more power to reach the ` +
          `top 10 — the gap to #10 (**${alvo.nick_name}**).`),
    footer: { text: `Town Center ${eu.stove_lv} · mightpulse.com` },
  }] };
}

const podio = (l, nome) => {
  const topo = Number(l[0]?.score || 0);
  return l.slice(0, 10).map((x, i) =>
    `${i < 3 ? MED[i] : `\`${String(i + 1).padStart(2)}\``} **${nome(x)}** — ${n(x.score)}\n` +
    barra(Number(x.score), topo)).join("\n");
};
const nomeA = (x) => `[${x.abbr}] ${x.name}`;
const quando = Math.floor(d.captured_at || Date.now() / 1000);

const campos = [];
if (alis.length) campos.push({ name: "🏰 Top 10 alliances", value: podio(alis, nomeA) });
if (jogs.length) campos.push({ name: "⚔️ Top 10 players", value: podio(jogs, (x) => x.nick_name) });
campos.push({ name: "👑 Leader", value: alis[0] ? nomeA(alis[0]) : "—", inline: true });
campos.push({ name: "🏰 Top 10 combined", inline: true,
  value: n(alis.slice(0, 10).reduce((a, x) => a + Number(x.score || 0), 0)) });
campos.push({ name: "🕐 Captured", value: `<t:${quando}:R>`, inline: true });
/* Nome longo demais estoura os 1024 do campo e derruba o cartão INTEIRO. */
for (const c of campos) {
  if (c.value.length > 1024) c.value = c.value.slice(0, c.value.lastIndexOf("\n", 1024));
}

const cartao = {
  embeds: [{
    color: 0xE0A63A, title: "🏆 Kingdom #2311 — power ranking",
    url: "https://mightpulse.com/kingdom/2311", fields: campos,
    footer: { text: "mightpulse.com · bars are relative to 1st place" },
    timestamp: new Date(quando * 1000).toISOString(),
  }],
  components: [{ type: 1, components: [{ type: 2, style: 1,
    custom_id: "dono:reino:eu", emoji: { name: "📊" }, label: "Where am I?" }] }],
};

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
try { await nova.pin(); } catch {
  return `Posted, but I could not pin it — I need **Manage Messages** here.\n${nova.url}`;
}
return `📌 Ranking posted and pinned: ${nova.url}`;
