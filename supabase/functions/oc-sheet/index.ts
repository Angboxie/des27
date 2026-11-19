// Feeds the DES Google Sheet: participants, teams and payments as rows.
// The sheet's script calls this every few minutes with a shared secret
// (SHEET_TOKEN). Read-only: nothing in the sheet can change the registrations.

import { hasToken, json } from "../_shared/http.ts";
import { env, serviceRpc } from "../_shared/backend.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

Deno.serve(async (request) => {
  if (!hasToken(request.headers.get("Authorization"), env("SHEET_TOKEN"))) {
    return json({ error: "Not allowed." }, 401);
  }
  try {
    return json(await serviceRpc()("oc_sheet_export", {}));
  } catch (problem) {
    console.error("oc-sheet", problem);
    return json({ error: "Could not read the registrations." }, 500);
  }
});
