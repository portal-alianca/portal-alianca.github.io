/* Recebe do Stripe o aviso de que um servidor pagou.

   O bot vive no Fly e nao tem endereco publico -- ele so' fala pra fora. O
   Stripe precisa falar pra dentro, entao quem atende e' esta funcao, que ja
   tem URL publica de graca.

   Nao uso a biblioteca do Stripe: a unica coisa que preciso dela e' conferir
   a assinatura do webhook, que sao dez linhas de HMAC. Uma dependencia a
   menos e' uma coisa a menos pra quebrar num deploy futuro.

   verify_jwt fica desligado: quem autentica aqui e' a assinatura do Stripe,
   nao um token do Supabase. */

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEGREDO = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

/* Um mes com um dia de folga.

   A cobranca da renovacao nem sempre cai no minuto exato -- cartao demora,
   o Stripe tenta de novo. Creditando 31 dias, um atraso de algumas horas nao
   derruba o plano de quem esta em dia. O dia sobrando nao se acumula: o
   credito e' somado a data atual, entao quem paga todo mes fica sempre um dia
   a frente, e nao um mes. */
const DIAS = 31;

/* Confere a assinatura do Stripe.

   O cabecalho vem como "t=123,v1=abc". A assinatura e' HMAC-SHA256 de
   "timestamp.corpo" com o segredo do endpoint. Sem isso, qualquer um que
   descobrisse a URL daria plano pago pra si mesmo mandando um JSON. */
async function assinaturaConfere(corpo: string, cabecalho: string): Promise<boolean> {
  if (!SEGREDO || !cabecalho) return false;

  const partes = Object.fromEntries(
    cabecalho.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = partes["t"];
  const v1 = partes["v1"];
  if (!t || !v1) return false;

  /* Recusa evento velho. Sem isso, uma copia interceptada de um pagamento
     legitimo poderia ser reenviada pra sempre por quem a tivesse. */
  const idade = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(idade) || idade > 300) return false;

  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SEGREDO),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", chave, new TextEncoder().encode(`${t}.${corpo}`),
  );
  const esperado = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  /* Comparacao de tempo constante: comparar com === vaza, pelo tempo de
     resposta, quantos caracteres do inicio bateram. */
  if (esperado.length !== v1.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) diferenca |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  return diferenca === 0;
}

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("só POST", { status: 405 });

  const corpo = await req.text();
  if (!await assinaturaConfere(corpo, req.headers.get("stripe-signature") ?? "")) {
    console.error("pagamento: assinatura do Stripe não confere");
    return new Response("assinatura inválida", { status: 400 });
  }

  let evento: any;
  try { evento = JSON.parse(corpo); } catch { return new Response("json inválido", { status: 400 }); }

  const obj = evento?.data?.object ?? {};
  let servidor: string | null = null;
  let assinatura: string | null = null;

  if (evento.type === "checkout.session.completed") {
    /* Primeira compra. O id do servidor veio pendurado no link de pagamento;
       e' o unico momento em que ele aparece. */
    servidor = obj.client_reference_id ?? null;
    assinatura = typeof obj.subscription === "string" ? obj.subscription : null;
  } else if (evento.type === "invoice.paid") {
    /* SO' renovacao.

       A primeira cobranca chega duas vezes: como checkout.session.completed e
       como invoice.paid, com ids de evento DIFERENTES -- entao a trava de
       repetido nao pega, porque pra ela sao dois eventos legitimos.

       Se o checkout for processado primeiro, ele guarda a assinatura; a
       fatura chega logo atras, encontra o servidor por ela, e credita de novo.
       Sessenta e dois dias por um mes pago, e ninguem repara, porque o cliente
       so' ganha.

       billing_reason separa os dois: "subscription_create" e' a primeira,
       "subscription_cycle" e' a renovacao. Aqui so' passa renovacao. */
    if (obj.billing_reason !== "subscription_cycle") {
      return new Response("primeira fatura, já creditada no checkout", { status: 200 });
    }
    assinatura = typeof obj.subscription === "string" ? obj.subscription : null;
  } else {
    /* Qualquer outro evento: 200 pra ele nao ficar reenviando pra sempre. */
    return new Response("ignorado", { status: 200 });
  }

  if (!servidor && !assinatura) {
    console.error(`pagamento: ${evento.type} sem servidor nem assinatura`);
    return new Response("sem destino", { status: 200 });
  }

  try {
    const r = (await rpc("cyron_creditar_pagamento", {
      p_evento: evento.id, p_tipo: evento.type,
      p_servidor: servidor, p_assinatura: assinatura, p_dias: DIAS,
    }))?.[0];

    if (r?.ok) console.log(`pagamento: ${evento.type} creditado, pago até ${r.ate}`);
    else console.log(`pagamento: ${evento.type} não creditado (${r?.motivo})`);

    /* 200 mesmo quando nao credita. "Repetido" e "sem servidor" nao melhoram
       com reenvio -- devolver erro faria o Stripe insistir por dias e encher
       o painel dele de falha vermelha por algo que esta certo. */
    return new Response(JSON.stringify(r ?? {}), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    /* Aqui sim: erro de banco melhora com reenvio, entao peco pra insistir. */
    console.error("pagamento: falhei ao creditar:", e instanceof Error ? e.message : e);
    return new Response("erro ao creditar", { status: 500 });
  }
});
