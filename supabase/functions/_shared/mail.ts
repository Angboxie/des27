// The emails participants get, and the loop that sends whatever is waiting in
// the oc_outbox table. Sending goes through Resend (https://resend.com).

type Data = Record<string, unknown>;
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type Message = { to: string; subject: string; text: string; html: string };
type Draft = { subject: string; body: string[] };

const money = (cents: unknown) => "$" + (Number(cents || 0) / 100).toFixed(2);
const s = (value: unknown) => String(value ?? "");

const PATHS: Record<string, string> = {
  solo: "You're entering individually, so there is no team to set up. Your entry is confirmed as soon as your payment is verified.",
  team: "Next, one person from your team (the leader) registers the team and invites the others. Everyone confirms from their own OPEN CITY page.",
  looking: "Looking for teammates? Once your entry is paid you'll find the Discord team-finder on your OPEN CITY page. When you've found a team, its leader invites you. You won't need to register again.",
};

// One entry per email the system sends. `d` is the data queued with it.
const TEMPLATES: Record<string, (d: Data) => Draft> = {
  registration_received: (d) => ({
    subject: "OPEN CITY 2027: registration received",
    body: [`Dear ${s(d.name)},`, "Thank you for registering for DES OPEN CITY 2027. Your details have been received.", PATHS[s(d.path)] || "",
      "Every participant needs their own paid entry. If you haven't paid yet, you can do it from your OPEN CITY page."],
  }),
  payment_confirmation: (d) => ({
    subject: "OPEN CITY 2027: payment received",
    body: [`We've received your payment of ${money(d.amount_cents)} for ${s(d.quantity)} ${Number(d.quantity) === 1 ? "entry" : "entries"}.`,
      "The full competition brief is now unlocked on your OPEN CITY page.",
      Number(d.spare) > 0 ? `You have ${s(d.spare)} spare ${Number(d.spare) === 1 ? "entry" : "entries"}. On your OPEN CITY page, enter the email address of the person each one is for. Buying entries together doesn't create a team: that's a separate step.` : "",
      "If you haven't yet, complete your registration there too."],
  }),
  entry_assigned: (d) => ({
    subject: "OPEN CITY 2027: your entry has been paid for",
    body: [`${s(d.from)} has paid for your OPEN CITY 2027 entry.`,
      "Open the registration page and enter this email address to complete your registration and access the full brief."],
  }),
  team_created: (d) => ({
    subject: `OPEN CITY 2027: team "${s(d.team)}" registered`,
    body: [`Your team "${s(d.team)}" is registered. Team ID: ${s(d.code)}.`,
      `We've emailed an invitation to: ${(Array.isArray(d.invited) ? d.invited : []).join(", ")}.`,
      "The team is approved automatically once every member has confirmed, completed their registration and has a paid entry. You can follow progress on your OPEN CITY page."],
  }),
  team_invite: (d) => ({
    subject: `DES OPEN CITY 2027: ${s(d.leader)} has invited you to join team "${s(d.team)}"`,
    body: [`Dear ${s(d.name)},`, `${s(d.leader)} has invited you to join team "${s(d.team)}" (Team ID ${s(d.code)}) for DES OPEN CITY 2027.`,
      "To respond, open the registration page using the button below and enter this email address. You will be asked to complete your own registration, after which you can accept or decline the invitation.",
      "Each team member requires their own paid entry."],
  }),
  invite_accepted: (d) => ({
    subject: `OPEN CITY 2027: ${s(d.member)} joined "${s(d.team)}"`,
    body: [`${s(d.member)} has confirmed their place in "${s(d.team)}".`],
  }),
  invite_declined: (d) => ({
    subject: `OPEN CITY 2027: ${s(d.member)} declined "${s(d.team)}"`,
    body: [`${s(d.member)} has declined the invitation to "${s(d.team)}".`, "You can invite someone else from your OPEN CITY page."],
  }),
  membership_confirmed: (d) => ({
    subject: `OPEN CITY 2027: you're in team "${s(d.team)}"`,
    body: [`You're confirmed as a member of "${s(d.team)}" (Team ID ${s(d.code)}).`],
  }),
  member_left: (d) => ({
    subject: `OPEN CITY 2027: ${s(d.member)} left "${s(d.team)}"`,
    body: [`${s(d.member)} has left "${s(d.team)}".`, "You can invite someone else from your OPEN CITY page."],
  }),
  removed_from_team: (d) => ({
    subject: `OPEN CITY 2027: you're no longer in "${s(d.team)}"`,
    body: [`You've been removed from team "${s(d.team)}".`, "Your registration and paid entry are unchanged, so you can join or create another team."],
  }),
  team_cancelled: (d) => ({
    subject: `OPEN CITY 2027: team "${s(d.team)}" was cancelled`,
    body: [`The registration for team "${s(d.team)}" has been cancelled.`, s(d.note),
      "Your own registration and paid entry are unchanged, so you can join or create another team."],
  }),
  team_rejected: (d) => ({
    subject: `OPEN CITY 2027: team "${s(d.team)}" was not accepted`,
    body: [`DES has not been able to accept the registration for team "${s(d.team)}".`, s(d.note), "Reply to this email if you have questions."],
  }),
  team_approved: (d) => ({
    subject: d.solo ? "OPEN CITY 2027: your entry is confirmed" : `OPEN CITY 2027: team "${s(d.team)}" is confirmed`,
    body: [d.solo ? "Your individual entry is officially confirmed." : `Team "${s(d.team)}" is officially confirmed. Every member has registered, confirmed and paid.`,
      `Entry ID: ${s(d.code)}`,
      "The brief, rules, submission requirements and Discord are on your OPEN CITY page."],
  }),
  payment_refunded: (d) => ({
    subject: "OPEN CITY 2027: payment refunded",
    body: [d.full ? "Your OPEN CITY payment has been refunded, and the entries it covered are no longer valid." : "Part of your OPEN CITY payment has been refunded. DES will confirm which entry this affects.",
      "Reply to this email if this wasn't expected."],
  }),
  reminder_team: (d) => ({
    subject: `OPEN CITY 2027: team "${s(d.team)}" is waiting on you`,
    body: [`Team "${s(d.team)}" (Team ID ${s(d.code)}) can't be confirmed yet. Still needed from you:`,
      d.needs_confirmation ? "- accept the team invitation (after completing your own registration)" : "",
      d.needs_payment ? "- a paid entry" : ""],
  }),
  reminder_no_team: (d) => ({
    subject: "OPEN CITY 2027: your entry isn't complete yet",
    body: [`Dear ${s(d.name)},`, "You're registered for OPEN CITY 2027 but not yet part of an entry.",
      d.paid ? "" : "You also still need a paid entry.",
      "Create a team, accept an invitation, or switch to entering individually from your OPEN CITY page."],
  }),
  reminder_register: () => ({
    subject: "OPEN CITY 2027: complete your registration",
    body: ["Your OPEN CITY 2027 entry is paid, but your registration form isn't filled in yet. It takes about two minutes."],
  }),
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmail(template: string, data: Data, portalUrl: string): Omit<Message, "to"> | null {
  const build = TEMPLATES[template];
  if (!build) return null;
  const draft = build(data || {});
  const body = draft.body.filter(Boolean);
  const footer = "DES OPEN CITY 2027 · Design Student Society, University of Melbourne";

  const text = [...body, "", `Registration page: ${portalUrl}`, "", footer].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0d0d0d;max-width:34em">` +
    body.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
    `<p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 22px;background:#d8f26d;color:#0d0d0d;border:2px solid #0d0d0d;border-radius:8px;text-decoration:none;font-weight:bold">Open the registration page</a></p>` +
    `<p style="font-size:13px;color:#5f5f5f">${escapeHtml(footer)}</p></div>`;
  return { subject: draft.subject, text, html };
}

export function resendSender(apiKey: string, from: string, replyTo: string | undefined, fetcher: typeof fetch = fetch) {
  return async (message: Message): Promise<void> => {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  };
}

// Sends queued emails. Each one is tried up to five times (counted in the database).
export async function drainOutbox(rpc: Rpc, send: (message: Message) => Promise<void>, portalUrl: string, batch = 20) {
  const result = { sent: 0, failed: 0 };
  for (let round = 0; round < 10; round++) {
    const rows = (await rpc("oc_outbox_take", { p_limit: batch })) as Array<{ id: number; to_email: string; template: string; data: Data }> | null;
    if (!rows || !rows.length) break;
    for (const row of rows) {
      const rendered = renderEmail(row.template, row.data, portalUrl);
      let error: string | null = null;
      if (!rendered) {
        error = `unknown template ${row.template}`;
      } else {
        try {
          await send({ to: row.to_email, ...rendered });
        } catch (problem) {
          error = String((problem as Error)?.message || problem).slice(0, 300);
        }
      }
      await rpc("oc_outbox_done", { p_id: row.id, p_error: error });
      if (error) result.failed++; else result.sent++;
    }
  }
  return result;
}
