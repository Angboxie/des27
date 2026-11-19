// Tests for the payment and email code that runs in Supabase's functions.
// The Stripe events are fed into the real database, so this covers the path
// from "Stripe says paid" to "team approved" and "email written".

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startDatabase, details } from "./harness.mjs";
import { verifyStripeSignature, checkoutForm, createCheckoutSession, handleStripeEvent, PRODUCT } from "../functions/_shared/stripe.ts";
import { renderEmail, drainOutbox } from "../functions/_shared/mail.ts";
import { siteUrl } from "../functions/_shared/http.ts";

const SECRET = "whsec_test_secret";
const sign = (payload, seconds, secret = SECRET) =>
  `t=${seconds},v1=${createHmac("sha256", secret).update(`${seconds}.${payload}`).digest("hex")}`;

test("only messages really signed by Stripe are accepted", async () => {
  const payload = JSON.stringify({ type: "checkout.session.completed" });
  const now = 1_800_000_000_000;
  const seconds = now / 1000;

  assert.equal(await verifyStripeSignature(payload, sign(payload, seconds), SECRET, 300, now), true);
  assert.equal(await verifyStripeSignature(payload, `t=${seconds},v1=deadbeef,v1=${sign(payload, seconds).split("v1=")[1]}`, SECRET, 300, now), true, "one of several signatures may match");

  assert.equal(await verifyStripeSignature(payload + " ", sign(payload, seconds), SECRET, 300, now), false, "altered body");
  assert.equal(await verifyStripeSignature(payload, sign(payload, seconds, "whsec_wrong"), SECRET, 300, now), false, "wrong secret");
  assert.equal(await verifyStripeSignature(payload, sign(payload, seconds - 600), SECRET, 300, now), false, "old event replayed");
  assert.equal(await verifyStripeSignature(payload, null, SECRET, 300, now), false);
  assert.equal(await verifyStripeSignature(payload, "garbage", SECRET, 300, now), false);
  assert.equal(await verifyStripeSignature(payload, sign(payload, seconds), "", 300, now), false, "no secret configured");
});

test("the checkout is created with the server's price and the buyer's identity", async () => {
  const request = { secretKey: "sk_test_x", quantity: 3, unitAmount: 1000, currency: "aud", userId: "user-1", email: "alex@example.edu", successUrl: "https://des.example/open-city/?paid=1", cancelUrl: "https://des.example/open-city/?cancelled=1" };
  const form = checkoutForm(request);
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("line_items[0][quantity]"), "3");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1000");
  assert.equal(form.get("metadata[product]"), PRODUCT);
  assert.equal(form.get("metadata[user_id]"), "user-1");
  assert.equal(form.get("payment_intent_data[metadata][quantity]"), "3");

  let sent;
  const session = await createCheckoutSession(request, async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 });
  });
  assert.equal(sent.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(sent.init.headers.Authorization, "Bearer sk_test_x");
  assert.equal(session.url, "https://checkout.stripe.com/c/pay/cs_1");

  await assert.rejects(
    createCheckoutSession(request, async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 })),
    /Invalid API Key/
  );
});

test("people are only sent back to an address on the allowed list", () => {
  const list = "https://angboxie.github.io/des27, http://localhost:8080/";
  assert.equal(siteUrl(list, "http://localhost:8080"), "http://localhost:8080");
  assert.equal(siteUrl(list, "https://angboxie.github.io"), "https://angboxie.github.io/des27");
  assert.equal(siteUrl(list, "https://evil.example"), "https://angboxie.github.io/des27");
  assert.equal(siteUrl(list, null), "https://angboxie.github.io/des27");
  assert.throws(() => siteUrl("", null), /SITE_URLS/);
});

test("Stripe events drive the database: paid, refunded, disputed", async () => {
  const api = await startDatabase();
  const rpc = (fn, args) => api.service(fn, ...Object.values(args));
  const alex = await api.person("alex@student.example.edu");
  await alex.call("oc_save_registration", details("Alex", { path: "solo" }));

  const session = (overrides = {}) => ({
    type: "checkout.session.completed",
    data: { object: { id: "cs_live_1", payment_intent: "pi_live_1", payment_status: "paid", amount_total: 1000, currency: "aud",
      metadata: { product: PRODUCT, user_id: alex.id, email: alex.email, quantity: "1" }, ...overrides } },
  });

  // someone else's checkout on the same Stripe account, or an unpaid one, changes nothing
  assert.match(await handleStripeEvent(session({ metadata: { product: "locker-hire" } }), rpc), /ignored/);
  assert.match(await handleStripeEvent(session({ payment_status: "unpaid" }), rpc), /ignored/);
  assert.match(await handleStripeEvent({ type: "customer.created", data: { object: {} } }, rpc), /ignored/);
  assert.equal((await alex.me()).paid, false);

  assert.equal(await handleStripeEvent(session(), rpc), "payment recorded");
  assert.equal(await handleStripeEvent(session(), rpc), "payment recorded", "a repeat delivery is harmless");
  let me = await alex.me();
  assert.equal(me.paid, true);
  assert.equal(me.team.status, "approved");
  assert.equal(me.purchases.length, 1);

  assert.equal(await handleStripeEvent({ type: "charge.dispute.created", data: { object: { payment_intent: "pi_live_1" } } }, rpc), "dispute recorded");
  assert.equal((await alex.me()).team.status, "pending_review");

  assert.equal(await handleStripeEvent({ type: "charge.refunded", data: { object: { payment_intent: "pi_live_1", amount: 1000, amount_refunded: 1000, refunded: true } } }, rpc), "refund recorded");
  me = await alex.me();
  assert.equal(me.paid, false);
  assert.notEqual(me.team.status, "approved");
});

test("every email the database can queue has wording, and the queue is sent once", async () => {
  const api = await startDatabase();
  const rpc = async (fn, args) => {
    if (fn === "oc_outbox_take") return api.sql("select * from oc_outbox_take($1)", [args.p_limit]);
    return api.service(fn, ...Object.values(args));
  };
  const admin = await api.person("organiser@student.example.edu");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);
  const [alex, olivia, james] = await Promise.all(["alex", "olivia", "james"].map((n) => api.person(`${n}@student.example.edu`)));
  for (const person of [alex, olivia]) await person.call("oc_save_registration", details(person.email.split("@")[0]));

  // walk through enough of the journey to queue every kind of email
  await api.pay(alex, 2);
  await alex.call("oc_assign_entry", (await alex.me()).purchases[0].entries[1].id, olivia.email);
  await alex.call("oc_create_team", "Mail Test", "architecture", [{ name: "Olivia", email: olivia.email }, { name: "James", email: james.email }]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  await james.call("oc_respond_invite", (await james.me()).invitations[0].id, false);
  await admin.call("oc_admin_send_reminders");
  const team = (await alex.me()).team;
  assert.equal(team.status, "approved");
  await admin.call("oc_admin_remove_member", team.members[1].id);
  await admin.call("oc_admin_set_team", team.id, "reject", "Test");
  await api.service("oc_record_refund", (await api.sql("select payment_intent from oc_payments limit 1"))[0].payment_intent, 2000, true);

  const queued = await api.sql("select distinct template from oc_outbox order by 1");
  for (const { template } of queued) {
    const email = renderEmail(template, {}, "https://des.example/open-city/");
    assert.ok(email && email.subject && email.text.includes("https://des.example/open-city/"), `wording for ${template}`);
  }
  assert.ok(queued.length >= 12);

  const invite = renderEmail("team_invite", { name: "<b>Olivia</b>", team: "Urban Futures", code: "OC27-ABCDE", leader: "Alex" }, "https://des.example/open-city/");
  assert.match(invite.subject, /Alex invited you to team "Urban Futures"/);
  assert.ok(invite.html.includes("&lt;b&gt;Olivia&lt;/b&gt;"), "names can't inject HTML into emails");

  const delivered = [];
  let fail = true;
  const send = async (message) => {
    if (fail) { fail = false; throw new Error("mailbox full"); }
    delivered.push(message);
  };
  const total = (await api.sql("select count(*)::int as n from oc_outbox"))[0].n;
  const first = await drainOutbox(rpc, send, "https://des.example/open-city/");
  assert.deepEqual(first, { sent: total - 1, failed: 1 });
  assert.deepEqual(await drainOutbox(rpc, send, "https://des.example/open-city/"), { sent: 0, failed: 0 }, "a failed email waits before its next try");
  await api.sql("update oc_outbox set tried_at = now() - interval '5 minutes' where sent_at is null");
  const second = await drainOutbox(rpc, send, "https://des.example/open-city/");
  assert.deepEqual(second, { sent: 1, failed: 0 }, "the failed one is retried, the rest are not sent twice");
  assert.equal(delivered.length, total);
  assert.equal(new Set(delivered.map((m) => m.to + m.subject + m.text)).size <= total, true);
});

test("the Google Sheet feed: rows for the sheet, behind a secret", async () => {
  const api = await startDatabase();
  const [alex, olivia] = await Promise.all(["alex", "olivia"].map((n) => api.person(`${n}@student.example.edu`)));
  await alex.call("oc_save_registration", details("=HYPERLINK(\"https://evil.example\")"));
  await olivia.call("oc_save_registration", details("Olivia"));
  await api.pay(alex, 2);
  await alex.call("oc_create_team", "Sheet Team", "architecture", [{ name: "Olivia", email: olivia.email }]);

  // the raw export and the stored secret are closed to everyone on the website
  await assert.rejects(alex.call("oc_sheet_export"), /permission denied/);
  await assert.rejects(api.anon("select public.oc_sheet_export()"), /permission denied/);
  await assert.rejects(api.anon("select * from public.oc_private"), /permission denied/);
  await assert.rejects(api.as(alex, "select * from public.oc_private"), /permission denied/);

  // the sheet gets in with its secret, and only with its secret
  const secret = (await api.sql("select value from oc_private where key = 'sheet_token'"))[0].value;
  assert.ok(secret.length >= 40);
  await assert.rejects(api.anon("select public.oc_sheet_feed($1)", ["wrong-secret-wrong-secret-wrong-secret-wrong"]), /Not allowed/);
  await assert.rejects(api.anon("select public.oc_sheet_feed($1)", [""]), /Not allowed/);
  await assert.rejects(api.anon("select public.oc_sheet_feed(null)"), /Not allowed/);
  const feed = (await api.anon("select public.oc_sheet_feed($1) as result", [secret]))[0].result;
  await api.sql("delete from oc_private where key = 'sheet_token'");
  await assert.rejects(api.anon("select public.oc_sheet_feed($1)", [secret]), /Not allowed/, "deleting the secret cuts the sheet off");
  assert.deepEqual(Object.keys(feed).sort(), ["Participants", "Payments", "Summary", "Teams"]);
  for (const [tab, rows] of Object.entries(feed)) {
    assert.ok(rows.every((row) => row.length === rows[0].length), `${tab}: every row is as wide as its headings`);
  }
  const column = (tab, heading) => feed[tab][0].indexOf(heading);
  const alexRow = feed.Participants.find((row) => row[column("Participants", "Email")] === alex.email);
  assert.equal(alexRow[column("Participants", "Paid")], "yes");
  assert.equal(alexRow[column("Participants", "Team")], "Sheet Team");
  const oliviaRow = feed.Participants.find((row) => row[column("Participants", "Email")] === olivia.email);
  assert.equal(oliviaRow[column("Participants", "Paid")], "no");

  assert.equal(feed.Payments.length, 3, "one row per entry bought");
  assert.equal(feed.Payments[1][column("Payments", "Amount")], 20);
  assert.equal(feed.Payments[2][column("Payments", "Covers (email)")], "(not assigned yet)");
  assert.equal(feed.Teams.length, 3);
  assert.ok(!JSON.stringify(feed).match(/S-[A-Z2-9]{6}/), "anonymous judging codes are not in the sheet");
  assert.deepEqual(feed.Summary.find((row) => row[0] === "Paid participants"), ["Paid participants", 1]);
});
