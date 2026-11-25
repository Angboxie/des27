// OPEN CITY organisers' dashboard. The database only answers these calls for
// email addresses listed in the oc_admins table; everyone else gets an error.

(() => {
  const { app, configured, sb, content, esc, categoryLabel, money, date, statusPill, STATUS, rpc, sendMail, downloadCsv } = window.OC;
  if (!app) return;

  let data = null;
  let tab = "overview";
  let filter = "";
  let notice = null;

  const TABS = [["overview", "Overview"], ["participants", "Participants"], ["teams", "Teams"], ["payments", "Payments"], ["submissions", "Submissions"], ["content", "Brief & settings"]];
  const count = (list, test) => list.filter(test).length;
  const matches = (...values) => !filter || values.join(" ").toLowerCase().includes(filter.toLowerCase());
  const yesNo = (ok, yes, no) => `<span class="oc-tick ${ok ? "is-ok" : ""}">${esc(ok ? yes : no)}</span>`;

  /* ---------- Tabs ---------- */

  function overview() {
    const { participants, teams, payments, unregistered, emails } = data;
    const live = teams.filter((t) => !["cancelled", "rejected"].includes(t.status));
    const validEntries = payments.flatMap((p) => p.entries).filter((e) => e.status === "valid");
    const tally = (items, key) => {
      const totals = {};
      items.forEach((item) => { totals[key(item)] = (totals[key(item)] || 0) + 1; });
      return Object.entries(totals).sort((a, b) => b[1] - a[1]);
    };
    const stat = (label, value, note) => `<div class="oc-stat"><strong>${esc(value)}</strong><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
    const table = (title, rows) => `
      <div class="oc-card"><h3>${esc(title)}</h3>
        <table class="oc-table"><tbody>${rows.map(([label, n]) => `<tr><td>${esc(label)}</td><td class="oc-num">${n}</td></tr>`).join("") || `<tr><td>Nothing yet</td><td></td></tr>`}</tbody></table>
      </div>`;

    return `
      <div class="oc-stats">
        ${stat("Paid participants", count(participants, (p) => p.paid), `${validEntries.length} valid entries sold`)}
        ${stat("Registrations complete", participants.length)}
        ${stat("Approved entries", count(live, (t) => t.status === "approved"))}
        ${stat("Waiting on something", count(live, (t) => t.status !== "approved"))}
        ${stat("Individual entries", count(live, (t) => t.solo))}
        ${stat("Teams of 2", count(live, (t) => !t.solo && t.size === 2))}
        ${stat("Teams of 3", count(live, (t) => !t.solo && t.size === 3))}
        ${stat("Looking for teammates", count(participants, (p) => !p.team && p.path === "looking"))}
      </div>
      <div class="oc-columns">
        ${table("Teams by status", tally(live, (t) => (STATUS[t.status] || [t.status])[0]))}
        ${table("Registrations by category", tally(participants, (p) => categoryLabel(p.category)))}
        ${table("Registrations by institution", tally(participants, (p) => p.institution))}
      </div>
      <div class="oc-card">
        <h3>Needs chasing</h3>
        <ul class="oc-plain">
          <li><strong>${unregistered.length}</strong> paid but haven't filled in the registration form${unregistered.length ? ": " + esc(unregistered.map((u) => u.email).join(", ")) : ""}</li>
          <li><strong>${count(participants, (p) => !p.paid)}</strong> registered without a paid entry</li>
          <li><strong>${count(participants, (p) => !p.team)}</strong> registered but not in any entry yet</li>
          <li><strong>${count(live, (t) => t.status === "pending_review")}</strong> teams held for review</li>
        </ul>
        <div class="oc-actions">
          <button class="oc-btn" type="button" data-action="reminders">Email reminders to everyone incomplete</button>
          <span class="oc-hint">Emails: ${emails.sent} sent, ${emails.waiting} waiting, ${emails.failed} failed.</span>
        </div>
      </div>`;
  }

  function participants() {
    const rows = data.participants.filter((p) => matches(p.name, p.email, p.institution, p.discord, p.team && p.team.name, p.team && p.team.code));
    return `
      <div class="oc-toolbar">
        <input type="search" placeholder="Search name, email, university, team" value="${esc(filter)}" data-filter aria-label="Search participants">
        <button class="oc-btn oc-btn--line" type="button" data-action="csv-participants">Download CSV</button>
      </div>
      <div class="oc-scroll"><table class="oc-table">
        <thead><tr><th>Name</th><th>Institution</th><th>Category</th><th>Discord</th><th>Payment</th><th>Entry</th><th>Registered</th></tr></thead>
        <tbody>${rows.map((p) => `<tr>
          <td><strong>${esc(p.name)}</strong><small>${esc(p.email)}${p.phone ? " &middot; " + esc(p.phone) : ""}</small></td>
          <td>${esc(p.institution)}</td>
          <td>${esc(categoryLabel(p.category))}</td>
          <td>${esc(p.discord)}</td>
          <td>${yesNo(p.paid, "Paid", "Not paid")}</td>
          <td>${p.team ? `${esc(p.team.solo ? "Individual" : p.team.name)} <small><code>${esc(p.team.code)}</code></small> ${statusPill(p.team.status)}` : `<span class="oc-tick">${p.path === "looking" ? "Looking for teammates" : "No team yet"}</span>`}</td>
          <td>${esc(date(p.registered_at))}</td>
        </tr>`).join("") || `<tr><td colspan="7">No one matches.</td></tr>`}</tbody>
      </table></div>`;
  }

  function teams() {
    const rows = data.teams.filter((t) => matches(t.name, t.code, t.status, t.members.map((m) => m.name + " " + m.email).join(" ")));
    const closedCount = count(data.teams, (t) => ["cancelled", "rejected"].includes(t.status));
    return `
      <div class="oc-toolbar">
        <input type="search" placeholder="Search team, Team ID, member" value="${esc(filter)}" data-filter aria-label="Search teams">
        <button class="oc-btn oc-btn--line" type="button" data-action="csv-teams">Download CSV</button>
        ${closedCount ? `<button class="oc-btn oc-btn--line" type="button" data-action="delete-closed-teams">Delete all ${closedCount} cancelled / rejected</button>` : ""}
      </div>
      <div class="oc-alert" data-alert hidden></div>
      ${rows.map((t) => {
        const closed = ["cancelled", "rejected"].includes(t.status);
        return `
        <div class="oc-card oc-team" data-team="${esc(t.id)}">
          <div class="oc-card__head">
            <h3>${esc(t.name)} <small><code>${esc(t.code)}</code> &middot; ${esc(categoryLabel(t.category))} &middot; ${t.solo ? "individual" : "team of " + t.size}</small></h3>
            ${statusPill(t.status)}
          </div>
          ${t.review_reason ? `<p class="oc-alert" data-tone="hold">${esc(t.review_reason)}</p>` : ""}
          ${t.admin_note ? `<p class="oc-hint">Note: ${esc(t.admin_note)}</p>` : ""}
          <ul class="oc-list oc-members">${t.members.map((m) => `<li>
            <span><strong>${esc(m.name)}</strong><small>${esc(m.email)}${m.role === "leader" ? " &middot; leader" : ""}</small></span>
            <span class="oc-ticks">${yesNo(m.state === "accepted", "Confirmed", "Invited")}${yesNo(m.registered, "Registered", "Not registered")}${yesNo(m.paid, "Paid", "Not paid")}</span>
            ${m.role !== "leader" && !closed ? `<button class="oc-link" type="button" data-action="remove-member" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>` : ""}
          </li>`).join("")}</ul>
          ${closed ? `
            <div class="oc-actions">
              <button class="oc-btn oc-btn--line" type="button" data-action="delete-team" data-name="${esc(t.name)}">Delete team</button>
            </div>
            <div class="oc-alert" data-alert hidden></div>` : `
            <div class="oc-actions">
              ${t.status === "pending_review"
                ? `<button class="oc-btn" type="button" data-action="team" data-do="recheck">Clear hold and re-check</button>`
                : `<button class="oc-btn oc-btn--line" type="button" data-action="team" data-do="recheck">Re-check</button>
                   <button class="oc-btn oc-btn--line" type="button" data-action="team" data-do="hold">Hold for review</button>`}
              <button class="oc-btn oc-btn--line" type="button" data-action="team" data-do="reject">Reject</button>
              <button class="oc-btn oc-btn--line" type="button" data-action="team" data-do="cancel">Cancel</button>
              ${!t.solo && t.members.length < 3 ? `<button class="oc-btn oc-btn--line" type="button" data-action="add-member">Add member</button>` : ""}
            </div>
            <div class="oc-alert" data-alert hidden></div>`}
        </div>`;
      }).join("") || `<p class="oc-card">No teams match.</p>`}`;
  }

  function payments() {
    const rows = data.payments.filter((p) => matches(p.purchaser, p.reference, p.status, p.entries.map((e) => (e.holder || "") + " " + (e.holder_email || "") + " " + (e.assigned_email || "")).join(" ")));
    const tone = { paid: "ok", refunded: "bad", partially_refunded: "hold", disputed: "hold" };
    return `
      <div class="oc-toolbar">
        <input type="search" placeholder="Search buyer, holder, reference" value="${esc(filter)}" data-filter aria-label="Search payments">
      </div>
      <form class="oc-card oc-inline" data-form="grant">
        <label class="oc-field"><span>Grant an entry without Stripe (e.g. sponsored place)</span><input type="email" name="email" required placeholder="their email address"></label>
        <label class="oc-field"><span>Reason (kept on record)</span><input name="note" required maxlength="200"></label>
        <button class="oc-btn oc-btn--line" type="submit">Grant entry</button>
        <div class="oc-alert" data-alert hidden></div>
      </form>
      <div class="oc-scroll"><table class="oc-table">
        <thead><tr><th>Paid by</th><th>Amount</th><th>Status</th><th>Entries and who each one covers</th><th>Date</th></tr></thead>
        <tbody>${rows.map((p) => `<tr>
          <td><strong>${esc(p.purchaser)}</strong><small>${esc(p.provider === "manual" ? "Granted by DES: " + (p.note || "") : p.reference || "")}</small></td>
          <td class="oc-num">${esc(money(p.amount_cents))}${p.refunded_cents ? `<small>refunded ${esc(money(p.refunded_cents))}</small>` : ""}<small>${p.quantity} &times;</small></td>
          <td><span class="oc-pill oc-pill--${tone[p.status] || "wait"}">${esc(p.status.replace("_", " "))}</span></td>
          <td><ul class="oc-plain">${p.entries.map((e) => `<li>
              ${e.status === "void" ? `<s>${esc(e.holder || e.holder_email || e.assigned_email || "unassigned")}</s> <span class="oc-tick">void</span>`
                : e.holder_email ? `${esc(e.holder || "Not registered yet")} <small>${esc(e.holder_email)}</small>`
                : e.assigned_email ? `<span class="oc-tick">set aside for ${esc(e.assigned_email)}</span>`
                : `<span class="oc-tick">not assigned to anyone yet</span>`}
              ${e.status === "valid" ? `<button class="oc-link" type="button" data-action="void-entry" data-id="${esc(e.id)}">Void</button>` : ""}
            </li>`).join("")}</ul></td>
          <td>${esc(date(p.created_at))}</td>
        </tr>`).join("") || `<tr><td colspan="5">No payments yet.</td></tr>`}</tbody>
      </table></div>`;
  }

  function submissions() {
    const rows = data.submissions.filter((s) => matches(s.anon_code, s.team, s.team_code, s.category));
    return `
      <p class="oc-card oc-alert" data-tone="hold">Confidential. This table links anonymous codes to teams. Give judges the judging sheet instead: it has the code, category and work only.</p>
      <div class="oc-toolbar">
        <input type="search" placeholder="Search code or team" value="${esc(filter)}" data-filter aria-label="Search submissions">
        <button class="oc-btn" type="button" data-action="csv-judging">Download judging sheet (anonymous)</button>
        <button class="oc-btn oc-btn--line" type="button" data-action="csv-key">Download code key (confidential)</button>
      </div>
      <div class="oc-scroll"><table class="oc-table">
        <thead><tr><th>Anonymous code</th><th>Category</th><th>Team</th><th>Entry status</th><th>Submission</th></tr></thead>
        <tbody>${rows.map((s) => `<tr>
          <td><code>${esc(s.anon_code)}</code></td>
          <td>${esc(categoryLabel(s.category))}</td>
          <td>${esc(s.team)} <small><code>${esc(s.team_code)}</code></small></td>
          <td>${statusPill(s.status)}</td>
          <td>${/^https:\/\//.test(s.link || "") ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">Open</a> <small>${esc(date(s.submitted_at))}${s.notes ? " &middot; " + esc(s.notes) : ""}</small>` : `<span class="oc-tick">Not lodged</span>`}</td>
        </tr>`).join("") || `<tr><td colspan="5">Codes are issued when an entry is approved.</td></tr>`}</tbody>
      </table></div>`;
  }

  function contentTab() {
    const s = data.settings;
    const toggle = (key, label, help) => `
      <label class="oc-check"><input type="checkbox" data-setting="${key}" ${s[key] === true ? "checked" : ""}><span><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`;
    const KINDS = [["brief", "Brief"], ["challenge", "Category challenge"], ["rules", "Rules and guidelines"], ["submission", "Submission requirements"], ["resource", "Resource"]];
    const resourceForm = (r) => `
      <form class="oc-card oc-resource" data-form="resource" data-id="${esc(r.id || "")}">
        <div class="oc-grid">
          <label class="oc-field"><span>Title</span><input name="title" required value="${esc(r.title)}"></label>
          <label class="oc-field"><span>Type</span><select name="kind">${KINDS.map(([id, label]) => `<option value="${id}"${id === (r.kind || "resource") ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
          <label class="oc-field"><span>Category</span><select name="category"><option value="">All categories</option>${(content.categories || []).map((c) => `<option value="${esc(c.id)}"${c.id === r.category ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
          <label class="oc-field"><span>Order</span><input name="sort" type="number" value="${esc(r.sort == null ? 50 : r.sort)}"></label>
        </div>
        <label class="oc-field"><span>Text (leave a blank line between paragraphs)</span><textarea name="body" rows="5">${esc(r.body)}</textarea></label>
        <label class="oc-field"><span>Link, e.g. a PDF <em>(optional, https://)</em></span><input name="url" type="url" value="${esc(r.url)}"></label>
        <label class="oc-check"><input type="checkbox" name="published" ${r.published === false ? "" : "checked"}><span>Visible to paid participants</span></label>
        <div class="oc-alert" data-alert hidden></div>
        <div class="oc-actions">
          <button class="oc-btn" type="submit">${r.id ? "Save" : "Add"}</button>
          ${r.id ? `<button class="oc-link" type="button" data-action="delete-resource" data-id="${esc(r.id)}">Delete</button>` : ""}
        </div>
      </form>`;

    return `
      <div class="oc-card" data-settings>
        <h3>Switches</h3>
        ${toggle("registration_open", "Registration is open", "People can register and pay.")}
        ${toggle("team_changes_open", "Team changes are open", "Participants can create, join, leave and change teams. Turn off at the team deadline.")}
        ${toggle("submissions_open", "Submissions are open", "Leaders of approved entries can lodge their submission link.")}
        <form class="oc-inline" data-form="settings">
          <label class="oc-field"><span>Price per entry (AUD)</span><input name="price" type="number" min="1" step="0.5" required value="${esc(Number(s.price_cents) / 100)}"></label>
          <label class="oc-field"><span>Discord invitation link</span><input name="discord_invite" type="url" placeholder="https://discord.gg/..." value="${esc(s.discord_invite)}"></label>
          <label class="oc-field"><span>Team-finder forum link</span><input name="team_finder_url" type="url" placeholder="https://discord.com/channels/..." value="${esc(s.team_finder_url)}"></label>
          <button class="oc-btn oc-btn--line" type="submit">Save</button>
        </form>
        <div class="oc-alert" data-alert hidden></div>
        <p class="oc-hint">Organisers with access: ${esc(data.admins.join(", "))}. Add or remove organisers in Supabase (table oc_admins).</p>
      </div>
      <h3 class="oc-subhead">Paid-only material</h3>
      <p class="oc-hint">Only participants with a verified payment can read these. They are never part of the public website.</p>
      ${data.resources.map(resourceForm).join("")}
      <h3 class="oc-subhead">Add something</h3>
      ${resourceForm({})}`;
  }

  /* ---------- Drawing ---------- */

  function render() {
    const views = { overview, participants, teams, payments, submissions, content: contentTab };
    app.innerHTML = `
      <div class="oc-bar">
        <span>Organiser: <strong>${esc(data.me)}</strong></span>
        <span><a class="oc-link" href="${esc(window.OC.link("portal"))}">My own entry</a> &middot; <button class="oc-link" type="button" data-action="signout">Sign out</button></span>
      </div>
      <div class="oc-tabs" role="tablist">
        ${TABS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === tab}" data-tab="${id}">${esc(label)}</button>`).join("")}
        <button class="oc-link" type="button" data-action="reload">Refresh</button>
      </div>
      ${notice ? `<p class="oc-alert" data-tone="${esc(notice[1])}" role="status">${esc(notice[0])}</p>` : ""}
      <div role="tabpanel">${views[tab]()}</div>`;
  }

  async function load() {
    const [email, all] = await Promise.all([rpc("oc_me").then((me) => me.email), rpc("oc_admin_data")]);
    data = { ...all, me: email };
    render();
  }

  async function act(scope, work, done) {
    window.OC.setBusy(scope, true);
    try {
      const said = await work();
      sendMail();
      notice = done ? [done, "ok"] : typeof said === "string" ? [said, "ok"] : null;
      await load();
    } catch (error) {
      window.OC.setBusy(scope, false);
      window.OC.alertIn(scope, error.message);
    }
  }

  /* ---------- Actions ---------- */

  const exportsCsv = {
    "csv-participants": () => downloadCsv("open-city-participants.csv", [
      ["Name", "Email", "Phone", "Institution", "Category", "Discord", "Taking part", "Paid", "Team", "Team ID", "Team status", "Registered", "Heard from"],
      ...data.participants.map((p) => [p.name, p.email, p.phone, p.institution, categoryLabel(p.category), p.discord, p.path, p.paid ? "yes" : "no", p.team ? p.team.name : "", p.team ? p.team.code : "", p.team ? p.team.status : "", p.registered_at, p.heard_from]),
    ]),
    "csv-teams": () => downloadCsv("open-city-teams.csv", [
      ["Team ID", "Team", "Category", "Type", "Size", "Status", "Member", "Email", "Role", "Confirmed", "Registered", "Paid"],
      ...data.teams.flatMap((t) => t.members.map((m) => [t.code, t.name, categoryLabel(t.category), t.solo ? "individual" : "team", t.size, t.status, m.name, m.email, m.role, m.state === "accepted" ? "yes" : "no", m.registered ? "yes" : "no", m.paid ? "yes" : "no"])),
    ]),
    "csv-key": () => downloadCsv("open-city-code-key-CONFIDENTIAL.csv", [
      ["Anonymous code", "Team ID", "Team", "Category", "Status", "Link"],
      ...data.submissions.map((s) => [s.anon_code, s.team_code, s.team, categoryLabel(s.category), s.status, s.link]),
    ]),
    "csv-judging": async () => {
      const sheet = await rpc("oc_admin_judging_sheet");
      downloadCsv("open-city-judging-sheet.csv", [["Code", "Category", "Submission", "Notes"], ...sheet.map((s) => [s.anon_code, categoryLabel(s.category), s.link, s.notes])]);
    },
  };

  const actions = {
    ...exportsCsv,
    reload() { notice = null; load(); },
    async signout() { await sb.auth.signOut(); window.location.reload(); },
    reminders(button) {
      if (!window.confirm("Email a reminder to everyone whose registration or team is incomplete?")) return;
      act(button.closest(".oc-card"), async () => `${await rpc("oc_admin_send_reminders")} reminders queued.`);
    },
    team(button) {
      const card = button.closest("[data-team]");
      const action = button.dataset.do;
      let note = null;
      if (action !== "recheck") {
        note = window.prompt({ hold: "Why is this team being held? (Shown to the team.)", reject: "Why is this team rejected? (Emailed to the team.)", cancel: "Reason for cancelling? (Emailed to the team.)" }[action]);
        if (note === null) return;
      }
      act(card, () => rpc("oc_admin_set_team", { p_team: card.dataset.team, p_action: action, p_note: note }), "Team updated.");
    },
    "add-member"(button) {
      const card = button.closest("[data-team]");
      const email = window.prompt("Email address of the person to add (they still have to accept):");
      if (!email) return;
      const name = window.prompt("Their name:") || email;
      act(card, () => rpc("oc_admin_add_member", { p_team: card.dataset.team, p_name: name, p_email: email }), "Invitation sent.");
    },
    "delete-team"(button) {
      const card = button.closest("[data-team]");
      if (!window.confirm(`Delete "${button.dataset.name}" for good? It is already closed; this only removes it from the list. Payments are kept.`)) return;
      act(card, () => rpc("oc_admin_delete_team", { p_team: card.dataset.team }), "Team deleted.");
    },
    "delete-closed-teams"(button) {
      const closed = data.teams.filter((t) => ["cancelled", "rejected"].includes(t.status));
      if (!window.confirm(`Delete all ${closed.length} cancelled or rejected teams for good? Payments are kept.`)) return;
      act(button.closest(".oc-toolbar").parentElement, async () => {
        for (const t of closed) await rpc("oc_admin_delete_team", { p_team: t.id });
      }, `${closed.length} closed teams deleted.`);
    },
    "remove-member"(button) {
      if (!window.confirm(`Remove ${button.dataset.name} from this team?`)) return;
      act(button.closest("[data-team]"), () => rpc("oc_admin_remove_member", { p_member: button.dataset.id }), "Member removed.");
    },
    "void-entry"(button) {
      if (!window.confirm("Void this entry? The person it covers loses access and their team is re-checked.")) return;
      act(button.closest("tr"), () => rpc("oc_admin_void_entry", { p_entry: button.dataset.id }), "Entry voided.");
    },
    "delete-resource"(button) {
      if (!window.confirm("Delete this item?")) return;
      act(button.closest("form"), () => rpc("oc_admin_delete_resource", { p_id: button.dataset.id }), "Deleted.");
    },
  };

  const forms = {
    async signin(form) {
      window.OC.setBusy(form, true);
      try {
        await window.OC.signIn(form.email.value.trim());
        window.OC.showEmailSent(form, form.email.value.trim());
      } catch (error) {
        window.OC.setBusy(form, false);
        window.OC.alertIn(form, error.message);
      }
    },
    grant(form) {
      act(form, () => rpc("oc_admin_grant_entry", { p_email: form.email.value, p_note: form.note.value }), "Entry granted.");
    },
    settings(form) {
      act(form.closest("[data-settings]"), async () => {
        await rpc("oc_admin_set_setting", { p_key: "price_cents", p_value: Math.round(Number(form.price.value) * 100) });
        await rpc("oc_admin_set_setting", { p_key: "discord_invite", p_value: form.discord_invite.value.trim() || null });
        await rpc("oc_admin_set_setting", { p_key: "team_finder_url", p_value: form.team_finder_url.value.trim() || null });
      }, "Settings saved.");
    },
    resource(form) {
      const values = Object.fromEntries(new FormData(form));
      values.id = form.dataset.id || null;
      values.published = form.published.checked;
      act(form, () => rpc("oc_admin_save_resource", { p: values }), "Saved.");
    },
  };

  app.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) { tab = tabButton.dataset.tab; filter = ""; notice = null; return render(); }
    const button = event.target.closest("[data-action]");
    if (button && actions[button.dataset.action]) actions[button.dataset.action](button);
  });

  app.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form]");
    if (!form || !forms[form.dataset.form]) return;
    event.preventDefault();
    forms[form.dataset.form](form);
  });

  app.addEventListener("change", (event) => {
    const box = event.target.closest("[data-setting]");
    if (box) act(box.closest("[data-settings]"), () => rpc("oc_admin_set_setting", { p_key: box.dataset.setting, p_value: box.checked }), "Saved.");
  });

  // Search boxes: redraw, then put the cursor back where it was
  app.addEventListener("input", (event) => {
    if (!event.target.matches("[data-filter]")) return;
    filter = event.target.value;
    render();
    const input = app.querySelector("[data-filter]");
    input.focus();
    input.setSelectionRange(filter.length, filter.length);
  });

  async function start() {
    if (!configured) { app.innerHTML = window.OC.notOpenCard(); return; }
    const { data: auth } = await sb.auth.getSession();
    if (!auth.session) {
      app.innerHTML = window.OC.signInCard("Organiser sign-in", "Sign in with your DES organiser email address.");
      return;
    }
    try {
      await load();
      sendMail();   // send any emails still waiting
    } catch (error) {
      app.innerHTML = `<div class="oc-card"><p class="oc-alert" data-tone="bad">${esc(error.message)}</p><p><a class="oc-btn oc-btn--line" href="${esc(window.OC.link("portal"))}">Go to my entry</a> <button class="oc-link" type="button" data-action="signout">Sign out</button></p></div>`;
    }
  }

  start();
})();
