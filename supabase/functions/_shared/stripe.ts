// Everything that talks to Stripe. Plain fetch and Web Crypto, no SDK, so the
// same file runs in Supabase's edge runtime and in the tests.

export const PRODUCT = "open-city-2027";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Checks the Stripe-Signature header: "t=<unix seconds>,v1=<hmac>,..." where the
// hmac is SHA-256 of "<t>.<raw body>" keyed with the endpoint's signing secret.
// Events older than five minutes are refused, so a captured one can't be replayed.
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim());
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || !signatures.length) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => sameString(signature, expected));
}

export type CheckoutRequest = {
  secretKey: string;
  quantity: number;
  unitAmount: number;
  currency: string;
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
};

// The form Stripe's "create a Checkout Session" endpoint expects
export function checkoutForm(request: CheckoutRequest): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][quantity]", String(request.quantity));
  form.set("line_items[0][price_data][currency]", request.currency);
  form.set("line_items[0][price_data][unit_amount]", String(request.unitAmount));
  form.set("line_items[0][price_data][product_data][name]", "DES OPEN CITY 2027 entry");
  form.set("customer_email", request.email);
  form.set("client_reference_id", request.userId);
  // who is paying and for how many, read back by the webhook
  for (const target of ["metadata", "payment_intent_data[metadata]"]) {
    form.set(`${target}[product]`, PRODUCT);
    form.set(`${target}[user_id]`, request.userId);
    form.set(`${target}[email]`, request.email);
    form.set(`${target}[quantity]`, String(request.quantity));
  }
  form.set("success_url", request.successUrl);
  form.set("cancel_url", request.cancelUrl);
  return form;
}

export async function createCheckoutSession(request: CheckoutRequest, fetcher: typeof fetch = fetch): Promise<{ id: string; url: string }> {
  const response = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: checkoutForm(request).toString(),
  });
  const body = await response.json();
  if (!response.ok || !body.url) {
    throw new Error(`Stripe refused the checkout: ${body?.error?.message || response.status}`);
  }
  return { id: body.id, url: body.url };
}

// Turns a verified Stripe event into a database call. Returns what it did.
// deno-lint-ignore no-explicit-any
export async function handleStripeEvent(event: any, rpc: Rpc): Promise<string> {
  const object = event?.data?.object || {};

  switch (event?.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const meta = object.metadata || {};
      if (meta.product !== PRODUCT) return "ignored: not an OPEN CITY checkout";
      // bank transfers etc. complete first and get paid later, in the second event
      if (object.payment_status !== "paid") return "ignored: not paid yet";
      await rpc("oc_record_payment", {
        p_session: object.id,
        p_intent: object.payment_intent,
        p_user: meta.user_id || object.client_reference_id,
        p_email: meta.email || object.customer_details?.email || object.customer_email,
        p_quantity: Number(meta.quantity) || 1,
        p_amount_cents: object.amount_total ?? 0,
        p_currency: object.currency || "aud",
      });
      return "payment recorded";
    }

    case "charge.refunded": {
      if (!object.payment_intent) return "ignored: no payment intent";
      const full = object.refunded === true || (object.amount_refunded ?? 0) >= (object.amount ?? Infinity);
      await rpc("oc_record_refund", {
        p_intent: object.payment_intent,
        p_refunded_cents: object.amount_refunded ?? 0,
        p_full: full,
      });
      return full ? "refund recorded" : "part refund recorded";
    }

    case "charge.dispute.created": {
      if (!object.payment_intent) return "ignored: no payment intent";
      await rpc("oc_record_dispute", { p_intent: object.payment_intent });
      return "dispute recorded";
    }

    default:
      return "ignored: event type not used";
  }
}
