// Sends the emails waiting in oc_outbox. The website calls this after any
// action that queues one (registering, inviting, accepting...).

import { cors, json } from "../_shared/http.ts";
import { currentUser, sendQueuedEmails, serviceRpc } from "../_shared/backend.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await currentUser(request))) return json({ error: "Please sign in first." }, 401);
  try {
    return json(await sendQueuedEmails(serviceRpc()));
  } catch (problem) {
    console.error("oc-mail", problem);
    return json({ error: "Could not send." }, 500);
  }
});
