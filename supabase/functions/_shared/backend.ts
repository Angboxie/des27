// Connections the functions share: the database (as the trusted service role)
// and the mailer. Only this file needs Supabase's own library and Deno's env.

import { createClient } from "npm:@supabase/supabase-js@2";
import { drainOutbox, resendSender } from "./mail.ts";
import { siteUrl } from "./http.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export const env = (name: string) => Deno.env.get(name);

// Supabase gives functions these automatically. Newer projects name the keys
// SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY; older ones use the *_ROLE_KEY names.
const serviceKey = () => env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY") || "";

function serviceClient() {
  if (!env("SUPABASE_URL") || !serviceKey()) throw new Error("SUPABASE_URL or the service key is missing");
  return createClient(env("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export function serviceRpc() {
  const client = serviceClient();
  return async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
}

// Who is calling? The website sends the person's sign-in token; Supabase's own
// sign-in service is asked whether it is genuine and whose it is.
export async function currentUser(request: Request): Promise<{ id: string; email: string } | null> {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await serviceClient().auth.getUser(authorization.slice(7));
  if (error || !data.user?.email || !data.user.email_confirmed_at) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

export const portalUrl = (origin: string | null = null) => siteUrl(env("SITE_URLS"), origin) + "/open-city/register/";

// Send whatever is waiting. Without a Resend key the emails simply stay queued.
export async function sendQueuedEmails(rpc: ReturnType<typeof serviceRpc>) {
  const key = env("RESEND_API_KEY");
  const from = env("MAIL_FROM");
  if (!key || !from) return { sent: 0, failed: 0, skipped: "RESEND_API_KEY or MAIL_FROM is not set" };
  return await drainOutbox(rpc, resendSender(key, from, env("MAIL_REPLY_TO")), portalUrl());
}
