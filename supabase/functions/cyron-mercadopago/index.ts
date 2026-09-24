/* Pix pelo Mercado Pago: cria a cobranca e recebe o aviso de pago.

   Sem burocracia de Stripe e sem conferir banco na mao: o bot pede uma
   cobranca Pix aqui, mostra o QR para quem vai pagar, e quando o dinheiro cai
   o proprio Mercado Pago avisa este endereco -- e o plano liga sozinho.

   O Access Token do Mercado Pago mora SO' no cofre desta funcao
   (MP_ACCESS_TOKEN). Nem o bot o conhece.

   Tres portas:

   - {acao: "criar"}: so' o bot. Ele prova quem e' com a chave de servico do
     Supabase, que so' ele e esta funcao tem. Sem isso qualquer um encheria a
     conta do Mercado Pago de cobrancas falsas.
   - {acao: "conferir"}: diz se o token funciona, e nada mais. Nao devolve
     dado nenhum da conta.
   - o aviso do Mercado Pago (?type=payment&data.id=...): NAO se confia no
     que chega. Chega so' um numero; o pagamento e' lido de novo direto no
     Mercado Pago, com o nosso token. Um aviso falso com status "approved"
     nao liga nada, porque o status que vale e' o que o Mercado Pago responde.

   verify_jwt fica desligado: o Mercado Pago nao manda token do Supabase. */

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const MP = "https://api.mercadopago.com";
const AQUI = `${SB_URL}/functions/v1/cyron-mercadopago`;

/* O preco e' daqui, e nao do bot: quem paga nao escolhe quanto paga. O
   "teste" e' o Pix de R$ 1 do dono, para ver o caminho inteiro funcionando
   sem ligar plano de ninguem. */
const PRECOS: Record<string, number> = { pro: 29.9, alianca: 79, teste: 1 };
const DIAS = 31;

async function rpc(fn: string, corpo: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function sb(caminho: string, init: RequestInit = {}) {
  return await fetch(`${SB_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/* Mesmo canal de pagamentos da Stripe. Nunca estoura: o aviso e' enfeite, o
   credito ja' foi feito. */
async function avisarDono(texto: string) {
  try {
    const r = await sb("cyron_ajuste?chave=eq.webhook_pagamentos&select=valor");
    const url = r.ok ? (await r.json())?.[0]?.valor : null;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: texto.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch (e) {
    console.error("mercadopago: não consegui avisar no Discord:", e instanceof Error ? e.message : e);
  }
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

/* Comparacao de tempo constante, como na assinatura da Stripe. */
function iguais(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* E' o bot? A chave de servico pode estar em dois formatos (o antigo e o
   novo do Supabase), e o bot pode usar um enquanto esta funcao recebe o
   outro. Entao, se nao for identica, a prova e' pratica: ler uma tabela que
   so' a chave de servico enxerga. Chave anonima le zero linhas; chave
   nenhuma, erro. */
async function ehOBot(chave: string) {
  if (!chave) return false;
  if (iguais(chave, SB_KEY)) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/cyron_ajuste?select=chave&limit=1`, {
      headers: { apikey: chave, Authorization: `Bearer ${chave}` },
    });
    return r.ok && ((await r.json()) ?? []).length > 0;
  } catch {
    return false;
  }
}

/* A referencia que viaja dentro do Pix: de quem e' e o que e'. Volta
   intacta no aviso, e e' so' ela que diz qual servidor ligar. */
function referencia(servidor: string, nivel: string) {
  return `cyron:${servidor}:${nivel}`;
}
function lerReferencia(ref: string): { servidor: string; nivel: string } | null {
  const m = /^cyron:([0-9a-f-]{36}):(pro|alianca|teste)$/.exec(String(ref ?? ""));
  return m ? { servidor: m[1], nivel: m[2] } : null;
}

async function criar(servidor: string, nivel: string) {
  const valor = PRECOS[nivel];
  if (!valor || !/^[0-9a-f-]{36}$/.test(servidor)) return json({ erro: "pedido inválido" }, 400);

  /* Meia hora para pagar. Horario de Brasilia escrito com o fuso, como o
     Mercado Pago pede. */
  const expira = new Date(Date.now() + 30 * 60 * 1000 - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");
  const r = await fetch(`${MP}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json",
      /* Clique duplo no botao nao vira duas cobrancas. */
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      transaction_amount: valor,
      description: nivel === "teste" ? "CYRON · teste do Pix" : `CYRON ${nivel === "pro" ? "Pro" : "Aliança"} · 1 mês`,
      payment_method_id: "pix",
      payer: { email: `servidor-${servidor.slice(0, 8)}@cyron-bot.com` },
      external_reference: referencia(servidor, nivel),
      notification_url: AQUI,
      date_of_expiration: expira,
    }),
  });
  const p = await r.json().catch(() => ({}));
  const dados = p?.point_of_interaction?.transaction_data;
  if (!r.ok || !dados?.qr_code) {
    /* O motivo do Mercado Pago vai para o log, e nao para quem clicou. */
    console.error(`mercadopago: não criou a cobrança (HTTP ${r.status}): ${String(p?.message ?? "").slice(0, 200)}`);
    return json({ erro: "o Mercado Pago recusou a cobrança", status: r.status }, 502);
  }
  return json({ id: p.id, valor, copiaecola: dados.qr_code, qr: dados.qr_code_base64, expira });
}

/* O aviso do Mercado Pago. Sempre 200 no fim, a nao ser em erro de banco:
   aviso repetido ou pagamento ainda pendente nao melhoram com reenvio. */
async function aviso(id: string) {
  if (!/^\d{1,20}$/.test(id)) return json({ ok: false, motivo: "id estranho" });
  const r = await fetch(`${MP}/v1/payments/${id}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
  if (!r.ok) {
    console.error(`mercadopago: não consegui ler o pagamento ${id} (HTTP ${r.status})`);
    return json({ ok: false }, r.status >= 500 ? 500 : 200);
  }
  const p = await r.json();
  if (p?.status !== "approved") return json({ ok: false, motivo: `status ${p?.status}` });

  const ref = lerReferencia(p.external_reference);
  if (!ref) return json({ ok: false, motivo: "não é do CYRON" });

  /* Pagou menos do que custa, nao liga. Cobranca criada aqui sempre tem o
     valor certo -- isto so' pega quem tentasse montar um Pix por fora. */
  if (Number(p.transaction_amount) + 0.001 < PRECOS[ref.nivel]) {
    console.error(`mercadopago: pagamento ${id} veio com valor menor que o do plano`);
    return json({ ok: false, motivo: "valor" });
  }

  if (ref.nivel === "teste") {
    await avisarDono(`🧪 **Pix de teste recebido** · R$ ${Number(p.transaction_amount).toFixed(2)} · o caminho inteiro funciona.`);
    return json({ ok: true, teste: true });
  }

  try {
    const c = (await rpc("cyron_creditar_pagamento", {
      p_evento: `mp:${id}`, p_tipo: "mercadopago.pix",
      p_servidor: ref.servidor, p_assinatura: null, p_dias: DIAS,
    }))?.[0];
    if (!c?.ok) return json({ ok: false, motivo: c?.motivo });
    const n = await sb(`cyron_servidor?id=eq.${ref.servidor}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ nivel: ref.nivel }),
    });
    if (!n.ok) console.error(`mercadopago: não gravei o nível (HTTP ${n.status})`);
    const nome = (await (await sb(`cyron_servidor?id=eq.${ref.servidor}&select=nome`)).json().catch(() => []))?.[0]?.nome ?? "?";
    await avisarDono(`💠 **Pix recebido** · ${nome} · ${ref.nivel === "pro" ? "Pro" : "Aliança"} · ` +
      `R$ ${Number(p.transaction_amount).toFixed(2).replace(".", ",")} · pago até ${new Date(c.ate).toLocaleDateString("pt-BR")}`);
    return json({ ok: true, ate: c.ate });
  } catch (e) {
    console.error("mercadopago: falhei ao creditar:", e instanceof Error ? e.message : e);
    return json({ ok: false }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("só POST", { status: 405 });
  if (!MP_TOKEN) {
    console.error("mercadopago: falta MP_ACCESS_TOKEN no cofre da função");
    return json({ erro: "Pix ainda não configurado" }, 503);
  }

  const url = new URL(req.url);
  const texto = await req.text();
  let corpo: any = {};
  try { corpo = texto ? JSON.parse(texto) : {}; } catch { /* aviso pode vir sem corpo */ }

  /* O aviso do Mercado Pago: o id vem na URL (?data.id= ou ?id=) ou no corpo. */
  const idAviso = url.searchParams.get("data.id") || url.searchParams.get("id") ||
    (corpo?.type === "payment" || corpo?.topic === "payment" ? String(corpo?.data?.id ?? corpo?.resource ?? "") : "");
  if (idAviso && !corpo?.acao) return await aviso(idAviso.trim());

  if (corpo?.acao === "conferir") {
    const r = await fetch(`${MP}/users/me`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
    return json({ ok: r.ok, status: r.status });
  }

  if (corpo?.acao === "criar") {
    const quem = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!await ehOBot(quem)) return json({ erro: "não autorizado" }, 401);
    return await criar(String(corpo.servidor ?? ""), String(corpo.nivel ?? ""));
  }

  return json({ ok: true, ignorado: true });
});
