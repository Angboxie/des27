// Stripe tells us here when a payment is completed, refunded or disputed.
// This is the only place payments are written, and only after Stripe's
// signature on the message has been checked.

import { handleStripeEvent, verifyStripeSignature } from "../_shared/stripe.ts";
import { env, sendQueuedEmails, serviceRpc } from "../_shared/backend.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Use POST.", { status: 405 });

  const payload = await request.text();
  const genuine = await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env("STRIPE_WEBHOOK_SECRET") || "");
  if (!genuine) return new Response("Signature check failed.", { status: 400 });

  try {
    const rpc = serviceRpc();
    const outcome = await handleStripeEvent(JSON.parse(payload), rpc);
    // confirmation emails; a mail problem must not make Stripe think the event failed
    await sendQueuedEmails(rpc).catch((problem) => console.error("oc-stripe-webhook mail", problem));
    return new Response(outcome, { status: 200 });
  } catch (problem) {
    // a 500 makes Stripe send the event again later
    console.error("oc-stripe-webhook", problem);
    return new Response("Could not record the event.", { status: 500 });
  }
});
