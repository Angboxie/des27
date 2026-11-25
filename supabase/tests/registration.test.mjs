// The OPEN CITY registration rules, exercised end to end against the real
// database migration. Run with:  npm install && npm test   (in this folder)

import { test } from "node:test";
import assert from "node:assert/strict";
import { startDatabase, details } from "./harness.mjs";

const api = await startDatabase();
let counter = 0;
const signIn = (name) => api.person(`${name.toLowerCase()}${++counter}@student.example.edu`);

// A leader plus registered teammates, all on the team path
async function trio(names = ["Alex", "Olivia", "James"]) {
  const people = [];
  for (const name of names) {
    const person = await signIn(name);
    await person.call("oc_save_registration", details(name));
    people.push(person);
  }
  return people;
}

const teamOf = async (person) => (await person.me()).team;
const invite = (person) => ({ name: person.email.split("@")[0], email: person.email });

test("the tables and helper functions are closed to the website", async () => {
  const [alex] = await trio(["Alex"]);

  for (const table of ["oc_participants", "oc_payments", "oc_entries", "oc_teams", "oc_team_members", "oc_resources", "oc_submissions", "oc_outbox", "oc_admins"]) {
    await assert.rejects(api.anon(`select * from public.${table}`), /permission denied/, `anon read ${table}`);
    await assert.rejects(api.as(alex, `select * from public.${table}`), /permission denied/, `signed-in read ${table}`);
  }

  // nobody but the Stripe webhook can record a payment, and helpers can't be called directly
  await assert.rejects(alex.call("oc_record_payment", "cs_x", "pi_x", alex.id, alex.email, 1, 1000, "aud"), /permission denied/);
  await assert.rejects(alex.call("oc_claim_entry", alex.id, alex.email), /permission denied/);
  await assert.rejects(alex.call("oc_recheck_team", alex.id), /permission denied/);
  await assert.rejects(alex.call("oc_queue_email", "x@example.com", "team_approved", {}), /permission denied/);
  await assert.rejects(api.anon("select public.oc_me()"), /permission denied/);

  await assert.rejects(alex.call("oc_admin_data"), /Only DES organisers/);
  await assert.rejects(alex.call("oc_admin_set_setting", "price_cents", 1), /Only DES organisers/);
});

test("registration needs every required field and the rules ticked", async () => {
  const sam = await signIn("Sam");
  await assert.rejects(sam.call("oc_save_registration", details("Sam", { rules_accepted: false })), /accept the competition rules/);
  await assert.rejects(sam.call("oc_save_registration", details("Sam", { category: "sculpture" })), /category/);
  await assert.rejects(sam.call("oc_save_registration", details("Sam", { discord: "" })), /Discord/);
  await assert.rejects(sam.call("oc_save_registration", details("", {})), /full name/);

  const me = await sam.call("oc_save_registration", details("Sam", { phone: " 0400 000 000 ", heard_from: "" }));
  assert.equal(me.participant.full_name, "Sam");
  assert.equal(me.participant.phone, "0400 000 000");
  assert.equal(me.participant.heard_from, null);
  assert.equal(me.paid, false);
  assert.deepEqual((await api.emails(sam.email)).map((e) => e.template), ["registration_received"]);
});

test("new registrations are refused while registration is closed", async () => {
  await api.sql("update oc_settings set value = 'false' where key = 'registration_open'");
  const late = await signIn("Late");
  await assert.rejects(late.call("oc_save_registration", details("Late")), /isn't open yet/);
  await api.sql("update oc_settings set value = 'true' where key = 'registration_open'");
});

test("Path C: an individual entry is approved once paid", async () => {
  const solo = await signIn("Solo");
  let me = await solo.call("oc_save_registration", details("Solo Entrant", { path: "solo", category: "graphic" }));
  assert.equal(me.team.solo, true);
  assert.equal(me.team.status, "pending_payment");
  assert.match(me.team.code, /^OC27-[A-Z2-9]{5}$/);
  assert.equal(me.team.submission, null);

  await api.pay(solo);
  me = await solo.me();
  assert.equal(me.paid, true);
  assert.equal(me.team.status, "approved");
  assert.match(me.team.submission.code, /^S-[A-Z2-9]{6}$/);
  assert.notEqual(me.team.submission.code, me.team.code);
  assert.ok((await api.emails(solo.email)).some((e) => e.template === "team_approved"));
});

test("the spec's example: a team waits until its last member has paid", async () => {
  const [alex, olivia, james] = await trio();
  await api.pay(alex);
  await api.pay(olivia);

  let me = await alex.call("oc_create_team", "Urban Futures", "architecture", [invite(olivia), invite(james)]);
  assert.equal(me.team.status, "pending_payment");
  assert.equal(me.team.is_leader, true);
  assert.equal(me.team.members.length, 3);

  // each invited member confirms for themselves
  assert.equal((await olivia.me()).invitations.length, 1);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  await james.call("oc_respond_invite", (await james.me()).invitations[0].id, true);

  me = await alex.me();
  assert.equal(me.team.status, "pending_payment", "James still has no paid entry");
  assert.deepEqual(me.team.members.map((m) => m.paid), [true, true, false]);

  await api.pay(james);
  me = await alex.me();
  assert.equal(me.team.status, "approved");
  for (const person of [alex, olivia, james]) {
    assert.ok((await api.emails(person.email)).some((e) => e.template === "team_approved"), `${person.email} told`);
  }
});

test("a fully paid team still waits for every member to confirm", async () => {
  const [alex, olivia, james] = await trio();
  for (const person of [alex, olivia, james]) await api.pay(person);

  await alex.call("oc_create_team", "Confirm Crew", "uiux", [invite(olivia), invite(james)]);
  assert.equal((await teamOf(alex)).status, "pending_confirmation");

  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  assert.equal((await teamOf(alex)).status, "pending_confirmation");

  const done = await james.call("oc_respond_invite", (await james.me()).invitations[0].id, true);
  assert.equal(done.team.status, "approved");
  assert.equal(done.participant.category, "uiux", "members take the team's category");
});

test("buying three entries does not make a team, and each entry covers one named person", async () => {
  const [alex, olivia, james] = await trio();
  await api.pay(alex, 3);

  let me = await alex.me();
  assert.equal(me.paid, true);
  assert.equal(me.team, null, "no team was created by the purchase");
  const [mine, spare1, spare2] = me.purchases[0].entries;
  assert.equal(mine.mine, true);
  assert.equal(spare1.assigned_email, null);

  assert.equal((await olivia.me()).paid, false);
  await alex.call("oc_assign_entry", spare1.id, olivia.email);
  assert.equal((await olivia.me()).paid, true);

  // the same entry can't be handed to a second person, and nobody gets two
  await assert.rejects(alex.call("oc_assign_entry", spare1.id, james.email), /already in use/);
  await assert.rejects(alex.call("oc_assign_entry", spare2.id, olivia.email), /already has a paid entry/);
  await assert.rejects(olivia.call("oc_assign_entry", spare2.id, olivia.email), /isn't one you bought/);

  // an entry set aside for someone who hasn't signed in yet is picked up when they do
  await alex.call("oc_assign_entry", spare2.id, "newcomer@student.example.edu");
  const newcomer = await api.person("newcomer@student.example.edu");
  assert.equal((await newcomer.me()).paid, true);
  assert.equal((await james.me()).paid, false);

  const used = await api.sql("select count(distinct participant_id)::int as people, count(*)::int as entries from oc_entries where payment_id = $1 and status = 'valid'", [me.purchases[0].id]);
  assert.deepEqual(used[0], { people: 3, entries: 3 });
});

test("nobody can join a team without being invited by its leader", async () => {
  const [alex, olivia, james] = await trio();
  const stranger = await signIn("Stranger");
  await stranger.call("oc_save_registration", details("Stranger"));

  const me = await alex.call("oc_create_team", "Invite Only", "architecture", [invite(olivia)]);
  const inviteId = (await olivia.me()).invitations[0].id;

  // knowing the invitation, team name or Team ID is not enough
  await assert.rejects(stranger.call("oc_respond_invite", inviteId, true), /isn't available/);
  assert.equal((await stranger.me()).invitations.length, 0);
  await assert.rejects(stranger.call("oc_team_invite", "Stranger", stranger.email), /Only the team leader/);
  await assert.rejects(olivia.call("oc_team_invite", "James", james.email), /Only the team leader/);
  assert.match(me.team.code, /^OC27-/);

  // a team stops at three
  await alex.call("oc_team_invite", "James", james.email);
  await assert.rejects(alex.call("oc_team_invite", "Stranger", stranger.email), /at most three/);
  await assert.rejects(
    api.sql("insert into oc_team_members (team_id, invite_name, invite_email) values ($1, 'X', 'x@example.com')", [me.team.id]),
    /at most three/,
    "the database itself refuses a fourth member"
  );
});

test("a person can only be in one team", async () => {
  const [alex, olivia, james] = await trio();
  await alex.call("oc_create_team", "First Team", "architecture", [invite(james)]);
  await olivia.call("oc_create_team", "Second Team", "architecture", [invite(james)]);

  const invitations = (await james.me()).invitations;
  assert.equal(invitations.length, 2);
  await james.call("oc_respond_invite", invitations[0].id, true);
  await assert.rejects(james.call("oc_respond_invite", invitations[1].id, true), /already in team/);

  // a leader can't start a second team either
  await assert.rejects(alex.call("oc_create_team", "Third Team", "architecture", [invite(olivia)]), /already in team/);
  await assert.rejects(alex.call("oc_create_team", "first team", "architecture", [invite(olivia)]), /already called/);
});

test("Path B: someone looking for teammates joins later without registering again", async () => {
  const [leader] = await trio(["Leader"]);
  const seeker = await signIn("Seeker");
  const before = await seeker.call("oc_save_registration", details("Seeker", { path: "looking", category: "graphic" }));
  await api.pay(seeker);
  await api.pay(leader);
  assert.equal(before.team, null);

  await leader.call("oc_create_team", "Found On Discord", "architecture", [invite(seeker)]);
  const after = await seeker.call("oc_respond_invite", (await seeker.me()).invitations[0].id, true);

  assert.equal(after.team.status, "approved");
  assert.equal(after.participant.registered_at, before.participant.registered_at, "same registration, not a new one");
  assert.equal(after.participant.path, "team");
});

test("an invited person must complete their own registration before confirming", async () => {
  const [leader] = await trio(["Leader"]);
  const fresh = await signIn("Fresh");
  await leader.call("oc_create_team", "Needs Forms", "architecture", [invite(fresh)]);
  const inviteId = (await fresh.me()).invitations[0].id;
  await assert.rejects(fresh.call("oc_respond_invite", inviteId, true), /Complete your own registration first/);
  await fresh.call("oc_save_registration", details("Fresh"));
  assert.equal((await fresh.call("oc_respond_invite", inviteId, true)).team.name, "Needs Forms");
});

test("an individual entrant can switch to a team, which replaces their one-person entry", async () => {
  const solo = await signIn("Switcher");
  const [mate] = await trio(["Mate"]);
  await solo.call("oc_save_registration", details("Switcher", { path: "solo" }));
  await api.pay(solo);
  assert.equal((await teamOf(solo)).status, "approved");

  const me = await solo.call("oc_create_team", "Now A Team", "architecture", [invite(mate)]);
  assert.equal(me.team.solo, false);
  assert.equal(me.paid, true, "the paid entry stays with the person");
  const old = await api.sql("select status from oc_teams where leader_id = $1 and solo", [solo.id]);
  assert.equal(old[0].status, "cancelled");
});

test("declining leaves the leader with a draft team that needs teammates", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  await api.pay(alex);
  await alex.call("oc_create_team", "Almost", "architecture", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, false);

  const team = await teamOf(alex);
  assert.equal(team.status, "draft");
  assert.equal(team.members.length, 1);
  assert.ok((await api.emails(alex.email)).some((e) => e.template === "invite_declined"));
});

test("a refund takes the entry away and the team loses its approval", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  await api.pay(alex);
  const oliviaPayment = await api.pay(olivia);
  await alex.call("oc_create_team", "Refunded", "architecture", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  assert.equal((await teamOf(alex)).status, "approved");
  assert.ok(Array.isArray(await olivia.call("oc_brief")));

  await api.service("oc_record_refund", oliviaPayment.intent, 1000, true);
  assert.equal((await teamOf(alex)).status, "pending_payment");
  assert.equal((await olivia.me()).paid, false);
  await assert.rejects(olivia.call("oc_brief"), /unlocks once your entry payment is verified/);

  // paying again restores it
  await api.pay(olivia);
  assert.equal((await teamOf(alex)).status, "approved");
});

test("a part refund or a dispute holds the team for an organiser", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  const admin = await signIn("Organiser");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);

  const payment = await api.pay(alex, 2);
  await alex.call("oc_assign_entry", (await alex.me()).purchases[0].entries[1].id, olivia.email);
  await alex.call("oc_create_team", "Half Refund", "architecture", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  assert.equal((await teamOf(alex)).status, "approved");

  await api.service("oc_record_refund", payment.intent, 1000, false);
  let team = await teamOf(alex);
  assert.equal(team.status, "pending_review");
  assert.match(team.review_reason, /refunded/);

  // the organiser cancels the refunded entry, then clears the hold: the team is not waved through
  const entries = (await admin.call("oc_admin_data")).payments.find((p) => p.reference === payment.intent).entries;
  await admin.call("oc_admin_void_entry", entries[1].id);
  assert.equal(await admin.call("oc_admin_set_team", team.id, "recheck", null), "pending_payment");

  await api.pay(olivia);
  assert.equal((await teamOf(alex)).status, "approved");

  await api.service("oc_record_dispute", payment.intent);
  team = await teamOf(alex);
  assert.equal(team.status, "pending_review");
});

test("Stripe sending the same event twice does not create a second payment", async () => {
  const buyer = await signIn("Buyer");
  for (let i = 0; i < 2; i++) {
    await api.service("oc_record_payment", "cs_same", "pi_same", buyer.id, buyer.email, 2, 2000, "aud");
  }
  const rows = await api.sql("select (select count(*)::int from oc_payments where session_id = 'cs_same') as payments, (select count(*)::int from oc_entries e join oc_payments p on p.id = e.payment_id where p.session_id = 'cs_same') as entries");
  assert.deepEqual(rows[0], { payments: 1, entries: 2 });
});

test("the brief is locked until payment is verified", async () => {
  const [reader] = await trio(["Reader"]);
  await assert.rejects(reader.call("oc_brief"), /unlocks once your entry payment is verified/);
  assert.equal((await reader.me()).settings.discord_invite, null);

  await api.sql(`update oc_settings set value = '"https://discord.gg/example"' where key = 'discord_invite'`);
  await api.pay(reader);
  const brief = await reader.call("oc_brief");
  assert.ok(brief.length >= 6);
  assert.ok(brief.some((r) => r.kind === "challenge" && r.category === "uiux"));
  assert.equal((await reader.me()).settings.discord_invite, "https://discord.gg/example");
});

test("an approved team can only be changed by an organiser", async () => {
  const [alex, olivia, james] = await trio();
  const admin = await signIn("Organiser");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);
  for (const person of [alex, olivia, james]) await api.pay(person);
  await alex.call("oc_create_team", "Locked In", "architecture", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);

  const team = await teamOf(alex);
  assert.equal(team.status, "approved");
  await assert.rejects(alex.call("oc_team_invite", "James", james.email), /already approved/);
  await assert.rejects(alex.call("oc_team_remove_member", team.members[1].id), /already approved/);
  await assert.rejects(olivia.call("oc_leave_team"), /already approved/);
  await assert.rejects(alex.call("oc_cancel_team"), /already approved/);

  // an authorised change: the organiser adds James, who still has to confirm
  assert.equal(await admin.call("oc_admin_add_member", team.id, "James", james.email), "pending_confirmation");
  await james.call("oc_respond_invite", (await james.me()).invitations[0].id, true);
  assert.equal((await teamOf(alex)).status, "approved");

  assert.equal(await admin.call("oc_admin_set_team", team.id, "hold", "Checking eligibility"), "pending_review");
  assert.equal(await admin.call("oc_admin_set_team", team.id, "recheck", null), "approved");

  // rejecting a team frees its members
  assert.equal(await admin.call("oc_admin_set_team", team.id, "reject", "Not eligible"), "rejected");
  assert.equal((await olivia.me()).team, null);
  assert.equal((await olivia.me()).paid, true);
});

test("organisers can delete cancelled or rejected teams, and nothing else", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  const admin = await signIn("Organiser");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);
  for (const person of [alex, olivia]) await api.pay(person);
  await alex.call("oc_create_team", "Short Lived", "graphic", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);
  const team = await teamOf(alex);

  // a live team can't be deleted, and only organisers may try
  await assert.rejects(admin.call("oc_admin_delete_team", team.id), /Only cancelled or rejected teams/);
  await assert.rejects(alex.call("oc_admin_delete_team", team.id), /organis|admin|permission/i);

  assert.equal(await admin.call("oc_admin_set_team", team.id, "cancel", "Test team"), "cancelled");
  await assert.rejects(alex.call("oc_admin_delete_team", team.id), /organis|admin|permission/i);
  await admin.call("oc_admin_delete_team", team.id);

  // gone from the dashboard and the database; the members keep their paid entries
  assert.equal((await admin.call("oc_admin_data")).teams.some((t) => t.id === team.id), false);
  assert.equal((await api.sql("select count(*)::int as n from oc_team_members where team_id = $1", [team.id]))[0].n, 0);
  assert.equal((await olivia.me()).team, null);
  assert.equal((await olivia.me()).paid, true);
  await assert.rejects(admin.call("oc_admin_delete_team", team.id), /Team not found/);
});

test("team changes can be closed for everyone", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  await api.sql("update oc_settings set value = 'false' where key = 'team_changes_open'");
  await assert.rejects(alex.call("oc_create_team", "Too Late", "architecture", [invite(olivia)]), /Team changes are closed/);
  await api.sql("update oc_settings set value = 'true' where key = 'team_changes_open'");
});

test("submissions: one per approved entry, from the leader, under an anonymous code", async () => {
  const [alex, olivia] = await trio(["Alex", "Olivia"]);
  const admin = await signIn("Organiser");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);
  await api.pay(alex);
  await alex.call("oc_create_team", "Submitters", "graphic", [invite(olivia)]);
  await olivia.call("oc_respond_invite", (await olivia.me()).invitations[0].id, true);

  await api.sql("update oc_settings set value = 'true' where key = 'submissions_open'");
  await assert.rejects(alex.call("oc_submit", "https://example.com/work.pdf", null), /Only approved entries/);
  await api.pay(olivia);
  await assert.rejects(olivia.call("oc_submit", "https://example.com/work.pdf", null), /Only the team leader/);
  await assert.rejects(alex.call("oc_submit", "example.com/work.pdf", null), /https/);

  await alex.call("oc_submit", "https://example.com/first.pdf", null);
  const me = await alex.call("oc_submit", "https://example.com/final.pdf", "Final boards");
  assert.equal(me.team.submission.link, "https://example.com/final.pdf");
  const stored = await api.sql("select count(*)::int as n from oc_submissions where team_id = $1", [me.team.id]);
  assert.equal(stored[0].n, 1);

  // what judges get has the code and the work, and nothing that identifies the entrant
  const sheet = await admin.call("oc_admin_judging_sheet");
  const row = sheet.find((s) => s.anon_code === me.team.submission.code);
  assert.deepEqual(Object.keys(row).sort(), ["anon_code", "category", "link", "notes"]);
  assert.ok(!JSON.stringify(sheet).includes(me.team.code));
  assert.ok(!JSON.stringify(sheet).includes("Submitters"));
  await api.sql("update oc_settings set value = 'false' where key = 'submissions_open'");
});

test("the admin dashboard sees participants, teams, payments and who is incomplete", async () => {
  const admin = await signIn("Organiser");
  await api.sql("insert into oc_admins (email) values ($1)", [admin.email]);
  const paidOnly = await signIn("PaidOnly");
  await api.pay(paidOnly);

  const data = await admin.call("oc_admin_data");
  assert.ok(data.participants.length > 10);
  assert.ok(data.teams.some((t) => t.status === "approved"));
  assert.ok(data.payments.every((p) => p.entries.length === p.quantity));
  assert.ok(data.unregistered.some((u) => u.email === paidOnly.email), "paid but not registered is listed");
  assert.ok(data.submissions.every((s) => s.anon_code && s.team_code && s.anon_code !== s.team_code));

  // a sponsored place, recorded as a manual payment with a reason
  await assert.rejects(admin.call("oc_admin_grant_entry", "guest@student.example.edu", ""), /Add a note/);
  await admin.call("oc_admin_grant_entry", "guest@student.example.edu", "Sponsored place");
  const guest = await api.person("guest@student.example.edu");
  assert.equal((await guest.me()).paid, true);

  const reminders = await admin.call("oc_admin_send_reminders");
  assert.ok(reminders > 0);
  assert.ok((await api.emails(paidOnly.email)).some((e) => e.template === "reminder_register"));

  await admin.call("oc_admin_set_setting", "price_cents", 1500);
  assert.equal((await admin.me()).settings.price_cents, 1500);
  await assert.rejects(admin.call("oc_admin_set_setting", "price_cents", 5), /between/);
});

test("the email queue hands each message out once", async () => {
  const first = await api.sql("select count(*)::int as n from oc_outbox where sent_at is null");
  const taken = await api.sql("select id from oc_outbox_take(5)");
  assert.equal(taken.length, 5);
  await api.service("oc_outbox_done", taken[0].id, null);
  await api.service("oc_outbox_done", taken[1].id, "mailbox full");
  const after = await api.sql("select count(*)::int as n from oc_outbox where sent_at is null");
  assert.equal(after[0].n, first[0].n - 1);
});
