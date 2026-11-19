// Starts a Stripe Checkout for 1 to 3 OPEN CITY entries.
// The price comes from the database (oc_settings), never from the browser.

import { cors, json } from "../_shared/http.ts";
import { createCheckoutSession } from "../_shared/stripe.ts";
import { currentUser, env, portalUrl, serviceRpc } from "../_shared/backend.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "Please sign in first." }, 401);

    const body = await request.json().catch(() => ({}));
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
      return json({ error: "You can buy one, two or three entries at a time." }, 400);
    }

    const rpc = serviceRpc();
    if (!(await rpc("oc_flag", { p_key: "registration_open" }))) {
      return json({ error: "Registration isn't open yet." }, 403);
    }
    const unitAmount = Number(await rpc("oc_setting", { p_key: "price_cents" }));
    const currency = String((await rpc("oc_setting", { p_key: "currency" })) || "aud");
    if (!Number.isInteger(unitAmount) || unitAmount < 100) throw new Error("price_cents is not set");

    const back = portalUrl(request.headers.get("Origin"));
    const session = await createCheckoutSession({
      secretKey: env("STRIPE_SECRET_KEY")!,
      quantity,
      unitAmount,
      currency,
      userId: user.id,
      email: user.email,
      successUrl: `${back}?paid=1`,
      cancelUrl: `${back}?cancelled=1`,
    });
    return json({ url: session.url });
  } catch (problem) {
    console.error("oc-checkout", problem);
    return json({ error: "Couldn't start the payment. Please try again in a moment." }, 500);
  }
});
