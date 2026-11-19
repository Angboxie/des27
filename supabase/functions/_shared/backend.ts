// Connections the functions share: the database (as the trusted service role)
// and the mailer. Only this file needs Supabase's own library and Deno's env.

import { createClient } from "npm:@supabase/supabase-js@2";
import { drainOutbox, resendSender } from "./mail.ts";
import { siteUrl } from "./http.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export const env = (name: string) => Deno.env.get(name);

export function serviceRpc() {
  const client = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
}

// Who is calling? Reads the sign-in token the website sends with each request.
export async function currentUser(request: Request): Promise<{ id: string; email: string } | null> {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
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
