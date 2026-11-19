// Small helpers shared by the functions

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// The site addresses people may be sent back to after paying, e.g.
// SITE_URLS="https://example.org,http://localhost:8080". The first is the default.
export function siteUrl(list: string | undefined, origin: string | null): string {
  const allowed = (list || "").split(",").map((url) => url.trim().replace(/\/+$/, "")).filter(Boolean);
  if (!allowed.length) throw new Error("SITE_URLS is not set");
  const match = origin && allowed.find((url) => url === origin || url.startsWith(origin + "/"));
  return match || allowed[0];
}
