// OPEN CITY participant page: sign in, register, pay, set up a team, read the brief.
// Every rule is enforced by the database; this file only shows what it says
// and sends the participant's choices to it.

(() => {
  const { app, configured, sb, content, config, esc, categoryLabel, money, statusPill, rpc, sendMail } = window.OC;
  if (!app) return;

  let me = null;          // everything the database knows about the signed-in person
  let brief = null;       // paid-only material, loaded once access is confirmed
  let editing = false;    // registration form open for changes
  let notice = null;      // one-off message at the top, e.g. after paying
  let viewing = null;     // a step the person has gone back to look at (null = their current step)
  let lastStep = null;

  const PATHS = {
    solo: ["Entering individually", "Just me. No team to set up."],
    team: ["I already have a team", "One of us (the leader) registers the team and invites the others."],
    looking: ["Looking for teammates", "Register and pay now, find a team on the DES Discord, join it later."],
  };

  /* ---------- What to do next ---------- */

  function nextStep() {
    const p = me.participant;
    const team = me.team;
    if (!p) return ["Complete your registration", "Tell us who you are and how you're taking part. It takes about two minutes.", "#registration"];
    if (!me.paid) return ["Pay for your entry", "Each participant pays for their own entry. The full brief and the Discord are available once payment is confirmed.", "#payment"];
    if (!team && me.invitations.length) return ["Answer your team invitation", `You've been invited to "${me.invitations[0].team}". Accept or decline below.`, "#team"];
    if (!team && p.path === "looking") return ["Find your teammates", "Join the DES Discord and use the team-finder. Once you have a team, one member registers it here and invites the others. You will not need to register again.", "#discord"];
    if (!team) return ["Set up your team", "If you're the team leader, register the team now. Otherwise wait for your leader's invitation: it will appear here.", "#team"];

    const waitingOn = (test) => team.members.filter(test).map((m) => (m.me ? "you" : m.name)).join(", ");
    switch (team.status) {
      case "approved":
        return [team.solo ? "Your entry is confirmed" : "Your team is confirmed", "Your submission code, the competition brief and the Discord link are below.", "#brief", "ok"];
      case "draft":
        return ["Invite a teammate", "A team needs two or three people. Invite someone, or switch to entering individually in your registration.", "#team"];
      case "pending_payment":
        return ["Waiting on payment", "Still without a paid entry: " + waitingOn((m) => !m.paid) + ".", "#team"];
      case "pending_confirmation":
        return ["Waiting on confirmation", "Still to register and accept the invitation: " + waitingOn((m) => m.state !== "accepted" || !m.registered) + ".", "#team"];
      case "pending_review":
        return ["DES is checking your entry", team.review_reason || "An organiser will be in touch.", "#team", "hold"];
      default:
        return ["Your entry needs attention", "Email DES at " + config.contact + ".", "#team", "hold"];
    }
  }

  // The journey is shown one step at a time. This is the step the person is up to.
  const STEPS = ["Your details", "Payment", "Team", "Confirmed"];

  function currentStep() {
    if (!me.participant) return 1;
    if (!me.paid) return 2;
    if (!me.team || me.team.status !== "approved") return 3;
    return 4;
  }

  function stepper(current, shown) {
    const labels = STEPS.slice();
    if (me.participant && me.participant.path === "solo") labels[2] = "Your entry";
    return `<ol class="oc-steps">${labels.map((label, i) => {
      const n = i + 1;
      const state = n < current ? "is-done" : n === current ? "is-current" : "is-later";
      const inner = `<span class="oc-steps__num" aria-hidden="true">${n < current ? "" : n}</span><span>${esc(label)}</span>`;
      // steps already reached can be reopened; later ones can't be skipped to
      return `<li class="${state}${n === shown ? " is-shown" : ""}">${n <= current
        ? `<button type="button" data-action="goto" data-step="${n}"${n === shown ? ' aria-current="step"' : ""}>${inner}</button>`
        : `<span class="oc-steps__later">${inner}</span>`}</li>`;
    }).join("")}</ol>`;
  }

  /* ---------- Sections ---------- */

  function registrationSection() {
    const p = me.participant;
    if (p && !editing) {
      return `
        <section class="oc-card" id="registration">
          <div class="oc-card__head"><h2>My registration</h2><span class="oc-pill oc-pill--ok">Complete</span></div>
          <dl class="oc-facts">
            <div><dt>Name</dt><dd>${esc(p.full_name)}</dd></div>
            <div><dt>Email</dt><dd>${esc(me.email)}</dd></div>
            <div><dt>University / institution</dt><dd>${esc(p.institution)}</dd></div>
            <div><dt>Category</dt><dd>${esc(categoryLabel(p.category))}</dd></div>
            <div><dt>Discord</dt><dd>${esc(p.discord)}</dd></div>
            <div><dt>Taking part</dt><dd>${esc(PATHS[p.path][0])}</dd></div>
          </dl>
          <button class="oc-btn oc-btn--line" type="button" data-action="edit">Edit my details</button>
        </section>`;
    }

    if (!p && !me.settings.registration_open) {
      return `<section class="oc-card" id="registration"><h2>My registration</h2><p>${esc(config.opens)}</p></section>`;
    }

    const v = p || {};
    const inTeam = me.team && !me.team.solo;
    const schools = content.institutions || [];
    const listed = schools.includes(v.institution);
    const option = (list, value) => list.map(([id, label]) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(label)}</option>`).join("");
    return `
      <form class="oc-card" id="registration" data-form="registration">
        <div class="oc-card__head"><h2>My registration</h2></div>
        ${!p && me.invitations.length ? `<p class="oc-alert" data-tone="ok">${esc(me.invitations[0].leader || "A team leader")} has invited you to team "${esc(me.invitations[0].team)}". Finish these details and pay your entry, then you can accept.</p>` : ""}
        <p class="oc-hint">Signed in as ${esc(me.email)}. Everyone registers individually, including each member of a team.</p>
        <div class="oc-grid">
          <label class="oc-field"><span>Full name</span><input name="full_name" required maxlength="120" autocomplete="name" value="${esc(v.full_name)}"></label>
          <label class="oc-field"><span>University / institution</span>
            <select name="institution_choice" required data-institution>
              <option value="">Choose&hellip;</option>${option(schools.map((name) => [name, name]), listed ? v.institution : "")}
              <option value="other"${v.institution && !listed ? " selected" : ""}>Other (type it in)</option>
            </select>
          </label>
          <label class="oc-field" data-institution-other ${v.institution && !listed ? "" : "hidden"}><span>Which university or institution?</span><input name="institution_other" maxlength="160" autocomplete="organization" value="${esc(listed ? "" : v.institution)}"></label>
          <label class="oc-field"><span>Competition category</span>
            <select name="category" required ${inTeam ? "disabled" : ""}>
              <option value="">Choose&hellip;</option>${option((content.categories || []).map((c) => [c.id, c.label]), v.category)}
            </select>
            ${inTeam ? `<small>Set by your team.</small>` : ""}
          </label>
          <label class="oc-field"><span>Discord username</span><input name="discord" required maxlength="64" autocapitalize="none" value="${esc(v.discord)}"></label>
          <label class="oc-field"><span>Phone <em>(optional)</em></span><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(v.phone)}"></label>
          <label class="oc-field"><span>How did you hear about OPEN CITY? <em>(optional)</em></span><input name="heard_from" maxlength="300" value="${esc(v.heard_from)}"></label>
        </div>

        <fieldset class="oc-choice" ${inTeam ? "disabled" : ""}>
          <legend>How are you taking part?</legend>
          ${Object.entries(PATHS).map(([id, [label, help]]) => `
            <label><input type="radio" name="path" value="${id}" required${(inTeam ? "team" : v.path) === id ? " checked" : ""}>
              <span><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`).join("")}
        </fieldset>

        ${p ? "" : `
          <div class="oc-rules">
            <h3>Competition rules</h3>
            <ul>${(content.rules || []).map((rule) => `<li>${esc(rule)}</li>`).join("")}</ul>
            <h3>Privacy</h3>
            <p>${esc(content.privacy)}</p>
            <label class="oc-check"><input type="checkbox" name="rules_accepted" required><span>I have read and accept the competition rules and privacy notice.</span></label>
          </div>`}

        <div class="oc-alert" data-alert hidden></div>
        <div class="oc-actions">
          <button class="oc-btn" type="submit">${p ? "Save changes" : "Save my registration"}</button>
          ${p ? `<button class="oc-btn oc-btn--line" type="button" data-action="cancel-edit">Cancel</button>` : ""}
        </div>
      </form>`;
  }

  // Each participant pays for their own entry. (Entries bought for other
  // people before this rule, or granted by DES, are still listed so they can be assigned.)
  function paymentSection() {
    const price = Number(me.settings.price_cents);
    const team = me.team && !me.team.solo ? me.team : null;
    const spare = me.purchases.flatMap((pay) => (pay.entries || []).filter((e) => e.status === "valid" && !e.mine));
    const troubled = me.purchases.filter((pay) => pay.status !== "paid");
    const unpaid = team ? team.members.filter((m) => !m.paid) : [];

    const status = me.paid
      ? `<p class="oc-good">Your entry is paid and verified${me.entry && me.entry.bought_by !== me.email ? ` (paid for by ${esc(me.entry.bought_by)})` : ""}.</p>`
      : `<p>The entry fee is <strong>${esc(money(price))}</strong> per participant. Each participant pays for their own entry.</p>`;

    const buy = me.paid ? ""
      : !me.settings.registration_open ? `<p class="oc-hint">${esc(config.opens)}</p>`
      : `
      <form class="oc-buy" data-form="buy">
        <input type="hidden" name="quantity" value="1">
        <button class="oc-btn" type="submit">Pay ${esc(money(price))}</button>
        <p class="oc-hint">Payment is taken securely by Stripe. You will return to this page afterwards.</p>
        <div class="oc-alert" data-alert hidden></div>
      </form>`;

    const teamStatus = !team ? "" : `
      <dl class="oc-facts oc-facts--boxed">
        <div><dt>Team members paid</dt><dd><strong>${team.members.length - unpaid.length} of ${team.members.length}</strong></dd></div>
        <div><dt>Still to pay</dt><dd><strong>${unpaid.length ? esc(unpaid.map((m) => (m.me ? "You" : m.name)).join(", ")) : "No one"}</strong></dd></div>
      </dl>
      ${unpaid.some((m) => !m.me) ? `<p class="oc-hint">Each member pays from their own registration page. The team is confirmed once everyone has paid.</p>` : ""}`;

    const spareList = !spare.length ? "" : `
      <div class="oc-sub">
        <h3>Entries you hold for other people</h3>
        <ul class="oc-list">
          ${spare.map((entry) => entry.claimed
            ? `<li><span><strong>${esc(entry.name || entry.assigned_email)}</strong><small>${entry.name ? esc(entry.assigned_email || "") + " &middot; " : ""}in use</small></span></li>`
            : `<li><form class="oc-inline" data-form="assign" data-entry="${esc(entry.id)}">
                 <label class="oc-field"><span>${entry.assigned_email ? "Set aside for" : "Who is this entry for?"}</span>
                   <input type="email" name="email" placeholder="their email address" value="${esc(entry.assigned_email)}" ${entry.assigned_email ? "" : "required"}></label>
                 <button class="oc-btn oc-btn--line" type="submit">${entry.assigned_email ? "Change" : "Assign"}</button>
                 <div class="oc-alert" data-alert hidden></div>
               </form></li>`).join("")}
        </ul>
      </div>`;

    const history = !me.purchases.length ? "" : `
      <div class="oc-sub">
        <h3>Your payments</h3>
        <ul class="oc-list">
          ${me.purchases.map((pay) => `<li>
            <span><strong>${esc(money(pay.amount_cents))}</strong><small>${esc(window.OC.date(pay.created_at))}</small></span>
            <span class="oc-pill oc-pill--${pay.status === "paid" ? "ok" : "hold"}">${esc(pay.status.replace("_", " "))}</span>
          </li>`).join("")}
        </ul>
      </div>`;

    return `
      <section class="oc-card" id="payment">
        <div class="oc-card__head"><h2>Payment</h2>${me.paid ? `<span class="oc-pill oc-pill--ok">Verified</span>` : `<span class="oc-pill oc-pill--wait">Not paid</span>`}</div>
        ${status}
        ${troubled.map((pay) => `<p class="oc-alert" data-tone="bad">A payment of ${esc(money(pay.amount_cents))} was ${esc(pay.status.replace("_", " "))}. Email DES if this was not expected.</p>`).join("")}
        ${buy}
        ${teamStatus}
        ${spareList}
        ${history}
      </section>`;
  }

  function memberRow(member, team) {
    const ticks = [
      [member.state === "accepted", "Confirmed", "Invited"],
      [member.registered, "Registered", "Not registered"],
      [member.paid, "Paid", "Not paid"],
    ].map(([ok, yes, no]) => `<span class="oc-tick ${ok ? "is-ok" : ""}">${esc(ok ? yes : no)}</span>`).join("");
    const canRemove = team.is_leader && member.role !== "leader" && team.status !== "approved" && me.settings.team_changes_open;
    return `<li>
      <span><strong>${esc(member.name)}${member.me ? " (you)" : ""}</strong><small>${esc(member.email)}${member.role === "leader" ? " &middot; leader" : ""}</small></span>
      <span class="oc-ticks">${ticks}</span>
      ${canRemove ? `<button class="oc-link" type="button" data-action="remove-member" data-id="${esc(member.id)}" data-name="${esc(member.name)}">Remove</button>` : ""}
    </li>`;
  }

  function teamSection() {
    const p = me.participant;
    const team = me.team;
    const open = me.settings.team_changes_open;
    let body = "";

    const invitations = me.invitations.map((inv) => `
      <div class="oc-invite" data-invite="${esc(inv.id)}">
        <p><strong>${esc(inv.leader || "A team leader")}</strong> has listed you in team <strong>${esc(inv.team)}</strong> (${esc(categoryLabel(inv.category))}, Team ID ${esc(inv.code)}).</p>
        ${p ? "" : `<p class="oc-hint">Complete your registration above first, then accept.</p>`}
        <div class="oc-actions">
          <button class="oc-btn" type="button" data-action="accept" data-id="${esc(inv.id)}" ${p ? "" : "disabled"}>Accept</button>
          <button class="oc-btn oc-btn--line" type="button" data-action="decline" data-id="${esc(inv.id)}">Decline</button>
        </div>
        <div class="oc-alert" data-alert hidden></div>
      </div>`).join("");

    if (team) {
      const sub = team.submission;
      body = `
        <dl class="oc-facts">
          <div><dt>${team.solo ? "Entry" : "Team"}</dt><dd>${esc(team.name)}</dd></div>
          <div><dt>${team.solo ? "Entry ID" : "Team ID"}</dt><dd><code>${esc(team.code)}</code></dd></div>
          <div><dt>Category</dt><dd>${esc(categoryLabel(team.category))}</dd></div>
        </dl>
        ${team.review_reason ? `<p class="oc-alert" data-tone="hold">${esc(team.review_reason)}</p>` : ""}
        <ul class="oc-list oc-members">${team.members.map((m) => memberRow(m, team)).join("")}</ul>

        ${sub ? `
          <div class="oc-sub">
            <h3>Submission code</h3>
            <p><code class="oc-code">${esc(sub.code)}</code></p>
            <p class="oc-hint">Put this code on your submission instead of your names or university. Judges only ever see the code.</p>
            ${team.is_leader && me.settings.submissions_open ? `
              <form data-form="submit">
                <label class="oc-field"><span>Link to your submission</span><input type="url" name="link" required placeholder="https://" value="${esc(sub.link)}"></label>
                <label class="oc-field"><span>Notes for DES <em>(optional)</em></span><input name="notes" maxlength="1000" value="${esc(sub.notes)}"></label>
                <div class="oc-alert" data-alert hidden></div>
                <button class="oc-btn" type="submit">${sub.link ? "Update submission" : "Lodge submission"}</button>
              </form>` : sub.link ? `<p class="oc-good">Submission lodged.</p>` : ""}
          </div>` : ""}

        ${team.is_leader && !team.solo && team.status !== "approved" && open && team.members.length < 3 ? `
          <form class="oc-sub" data-form="invite">
            <h3>Invite a teammate</h3>
            <div class="oc-grid">
              <label class="oc-field"><span>Their name</span><input name="name" required maxlength="120"></label>
              <label class="oc-field"><span>Their email</span><input type="email" name="email" required></label>
            </div>
            <div class="oc-alert" data-alert hidden></div>
            <button class="oc-btn oc-btn--line" type="submit">Send invitation</button>
          </form>` : ""}

        ${team.status === "approved" && !team.solo ? `<p class="oc-hint">This team is approved. To change its members, email DES at ${esc(config.contact)}.</p>` : ""}
        ${!team.solo && team.status !== "approved" && open ? `
          <div class="oc-actions oc-actions--quiet">
            ${team.is_leader
              ? `<button class="oc-link" type="button" data-action="cancel-team">Cancel this team</button>`
              : `<button class="oc-link" type="button" data-action="leave-team">Leave this team</button>`}
            <div class="oc-alert" data-alert hidden></div>
          </div>` : ""}`;
    } else if (!p) {
      body = `<p>Complete your registration first. Then you can enter individually, create a team or accept an invitation.</p>`;
    } else if (!open) {
      body = `<p>Team changes are closed. Email DES at ${esc(config.contact)} if something needs fixing.</p>`;
    } else {
      const looking = p.path === "looking";
      const finder = [me.settings.team_finder_url, me.settings.discord_invite].find((url) => /^https:\/\//.test(url || ""));
      body = `
        ${looking ? `
          <ol class="oc-howto">
            <li><strong>Join the DES Discord</strong> and post in the team-finder to meet other entrants.</li>
            <li><strong>Agree on a team</strong> of two or three, and choose one member as leader.</li>
            <li><strong>The leader registers the team</strong> below. Everyone else receives an invitation and accepts it on their own page.</li>
          </ol>
          ${finder ? `<p><a class="oc-btn" href="${esc(finder)}" target="_blank" rel="noopener">Open the Discord team-finder</a></p>` : ""}
          <details class="oc-more"><summary>I have a team and I am its leader: register it</summary>`
        : `<p><strong>Only the team leader fills this in.</strong> Everyone else receives an invitation by email and accepts it on their own page.</p>`}
        <form data-form="create-team">
          <div class="oc-grid">
            <label class="oc-field"><span>Team name</span><input name="name" required minlength="2" maxlength="80"></label>
            <label class="oc-field"><span>Category</span>
              <select name="category" required>${(content.categories || []).map((c) => `<option value="${esc(c.id)}"${c.id === p.category ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
            </label>
            <label class="oc-field"><span>Teammate 1 name</span><input name="name1" required maxlength="120"></label>
            <label class="oc-field"><span>Teammate 1 email</span><input type="email" name="email1" required></label>
            <label class="oc-field"><span>Teammate 2 name <em>(optional)</em></span><input name="name2" maxlength="120"></label>
            <label class="oc-field"><span>Teammate 2 email <em>(optional)</em></span><input type="email" name="email2"></label>
          </div>
          <p class="oc-hint">Use the email address each teammate signs in with. They can only join by accepting from that address.</p>
          <div class="oc-alert" data-alert hidden></div>
          <button class="oc-btn" type="submit">Register team and send invitations</button>
        </form>
        ${looking ? "</details>" : ""}`;
    }

    return `
      <section class="oc-card" id="team">
        <div class="oc-card__head"><h2>${team && team.solo ? "My entry" : "My team"}</h2>${team ? statusPill(team.status) : ""}</div>
        ${invitations}
        ${body}
      </section>`;
  }

  function briefSection() {
    if (!me.paid && !me.is_admin) {
      return `
        <section class="oc-card oc-card--locked" id="brief">
          <div class="oc-card__head"><h2>Competition brief</h2><span class="oc-pill oc-pill--wait">Locked</span></div>
          <p>The full brief, the three category challenges, the rules and the submission requirements unlock here as soon as your entry payment is verified.</p>
        </section>`;
    }
    if (!brief) return `<section class="oc-card" id="brief"><h2>Competition brief</h2><p class="oc-loading">Loading the brief&hellip;</p></section>`;

    const mine = me.team ? me.team.category : me.participant && me.participant.category;
    const KIND = { brief: "Brief", challenge: "Category challenge", rules: "Rules and guidelines", submission: "Submission requirements", resource: "Resource" };
    return `
      <section class="oc-card" id="brief">
        <div class="oc-card__head"><h2>Competition brief</h2><span class="oc-pill oc-pill--ok">Unlocked</span></div>
        ${brief.map((item) => `
          <details class="oc-doc"${item.kind === "brief" || item.category === mine ? " open" : ""}>
            <summary><span>${esc(item.title)}</span><small>${esc(KIND[item.kind] || "")}${item.category ? " &middot; " + esc(categoryLabel(item.category)) : ""}${item.category && item.category === mine ? " &middot; yours" : ""}</small></summary>
            ${(item.body || "").split(/\n{2,}/).filter(Boolean).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("")}
            ${/^https:\/\//.test(item.url || "") ? `<p><a class="oc-btn oc-btn--line" href="${esc(item.url)}" target="_blank" rel="noopener">Open ${esc(item.title)}</a></p>` : ""}
          </details>`).join("") || "<p>The brief will appear here shortly.</p>"}
      </section>`;
  }

  function discordSection() {
    const s = me.settings;
    const safe = (url) => (/^https:\/\//.test(url || "") ? url : null);
    if (!me.paid && !me.is_admin) {
      return `<section class="oc-card oc-card--locked" id="discord"><div class="oc-card__head"><h2>Discord</h2><span class="oc-pill oc-pill--wait">Locked</span></div><p>The OPEN CITY Discord (announcements, questions and the team-finder forum) opens to you once your entry is paid.</p></section>`;
    }
    return `
      <section class="oc-card" id="discord">
        <div class="oc-card__head"><h2>Discord</h2></div>
        <p>Announcements, questions and support all happen on the DES Discord. Looking for teammates? Post in the team-finder forum.</p>
        <div class="oc-actions">
          ${safe(s.discord_invite) ? `<a class="oc-btn" href="${esc(s.discord_invite)}" target="_blank" rel="noopener">Join the Discord</a>` : `<span class="oc-hint">The invitation link will appear here soon.</span>`}
          ${safe(s.team_finder_url) ? `<a class="oc-btn oc-btn--line" href="${esc(s.team_finder_url)}" target="_blank" rel="noopener">Team-finder forum</a>` : ""}
        </div>
      </section>`;
  }

  /* ---------- Drawing ---------- */

  function render() {
    if (!me) return;
    const current = currentStep();
    const moved = lastStep !== null && current !== lastStep;
    if (current !== lastStep) { viewing = null; lastStep = current; }   // moved on: show the new step
    const shown = viewing && viewing <= current ? viewing : current;
    const [title, text, , tone] = nextStep();
    const back = shown !== current;

    // one step on screen at a time
    const body = {
      1: () => registrationSection(),
      2: () => paymentSection(),
      3: () => teamSection(),
      4: () => teamSection(),
    }[shown]();

    // once the entry is paid, the brief and Discord sit under the team step
    const unlocked = me.paid && shown >= 3 ? briefSection() + discordSection() : "";
    const teaser = !me.paid && shown === current ? `
      <p class="oc-teaser">
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>
        The full brief, your category challenge and the Discord unlock as soon as your entry is paid.
      </p>` : "";

    app.innerHTML = `
      <div class="oc-bar">
        <span>Signed in as <strong>${esc(me.email)}</strong></span>
        <span>${me.is_admin ? `<a class="oc-link" href="${esc(window.OC.link("admin"))}">Organiser dashboard</a> &middot; ` : ""}<button class="oc-link" type="button" data-action="signout">Sign out</button></span>
      </div>
      ${stepper(current, shown)}
      ${notice ? `<p class="oc-alert" data-tone="${esc(notice[1])}" role="status">${esc(notice[0])}</p>` : ""}
      ${back ? `
        <p class="oc-backto">You're looking back at step ${shown}. <button class="oc-link" type="button" data-action="goto" data-step="${current}">Return to step ${current}: ${esc(title)}</button></p>` : `
        <div class="oc-next oc-next--${tone || "todo"}">
          <p class="oc-next__label">${tone === "ok" ? "Registration complete" : `Step ${current} of 4`}</p>
          <h2>${esc(title)}</h2>
          <p>${esc(text)}</p>
        </div>`}
      ${body}
      ${unlocked}
      ${teaser}`;
    if (moved) window.scrollTo({ top: 0 });
  }

  async function refresh() {
    me = await rpc("oc_me");
    if ((me.paid || me.is_admin) && !brief) {
      rpc("oc_brief").then((items) => { brief = items; render(); }).catch(() => {});
    }
    if (!me.paid && !me.is_admin) brief = null;
    render();
  }

  // Run a change, then redraw from what the database returns
  async function act(scope, work, done) {
    window.OC.setBusy(scope, true);
    try {
      const result = await work();
      if (result && result.email) me = result;
      sendMail();
      notice = done ? [done, "ok"] : null;
      await refresh();
    } catch (error) {
      window.OC.setBusy(scope, false);
      window.OC.alertIn(scope, error.message);
    }
  }

  /* ---------- Actions ---------- */

  const forms = {
    async signin(form) {
      const email = form.email.value.trim();
      window.OC.setBusy(form, true);
      try {
        await window.OC.signIn(email);
        form.innerHTML = `<h2>Check your email</h2><p>A link has been sent to <strong>${esc(email)}</strong>. Open it on this device to continue. It may take a minute to arrive; please check your spam folder.</p>`;
      } catch (error) {
        window.OC.setBusy(form, false);
        window.OC.alertIn(form, error.message);
      }
    },

    registration(form) {
      const data = Object.fromEntries(new FormData(form));
      data.institution = data.institution_choice === "other" ? (data.institution_other || "") : data.institution_choice;
      delete data.institution_choice;
      delete data.institution_other;
      data.rules_accepted = form.rules_accepted ? form.rules_accepted.checked : true;
      // locked fields aren't sent by the browser; the database keeps the team's values
      if (!data.category && me.participant) data.category = me.participant.category;
      if (!data.path && me.participant) data.path = me.participant.path;
      const first = !me.participant;
      act(form, async () => {
        const result = await rpc("oc_save_registration", { p: data });
        editing = false;
        return result;
      }, first ? "Registration saved." : "Details updated.");
    },

    async buy(form) {
      window.OC.setBusy(form, true);
      try {
        const { data, error } = await sb.functions.invoke("oc-checkout", { body: { quantity: Number(form.quantity.value) } });
        let message = data && data.error;
        if (error && error.context && typeof error.context.json === "function") {
          message = ((await error.context.json().catch(() => null)) || {}).error;
        }
        if (error || !data || !data.url) throw new Error(message || "Couldn't start the payment. Please try again in a moment.");
        // remembered so that, back from Stripe, we can tell when the new payment has landed
        try { sessionStorage.setItem("oc-payments-before", String(me.purchases.length)); } catch (e) { /* private mode */ }
        window.location.assign(data.url);   // Stripe's payment page
      } catch (error) {
        window.OC.setBusy(form, false);
        window.OC.alertIn(form, error.message);
      }
    },

    assign(form) {
      const email = form.email.value.trim();
      act(form, () => rpc("oc_assign_entry", { p_entry: form.dataset.entry, p_email: email || null }), email ? `Entry set aside for ${email}.` : "Entry taken back.");
    },

    "create-team"(form) {
      const members = [1, 2]
        .map((n) => ({ name: form[`name${n}`].value.trim(), email: form[`email${n}`].value.trim() }))
        .filter((m) => m.name || m.email);
      act(form, () => rpc("oc_create_team", { p_name: form.name.value, p_category: form.category.value, p_members: members }), "Team registered. Invitations are on their way.");
    },

    invite(form) {
      act(form, () => rpc("oc_team_invite", { p_name: form.name.value, p_email: form.email.value }), "Invitation sent.");
    },

    submit(form) {
      act(form, () => rpc("oc_submit", { p_link: form.link.value, p_notes: form.notes.value }), "Submission lodged.");
    },
  };

  const actions = {
    goto(button) { viewing = Number(button.dataset.step); editing = false; notice = null; render(); window.scrollTo({ top: 0 }); },
    edit() { editing = true; render(); },
    "cancel-edit"() { editing = false; render(); },
    async signout() { await sb.auth.signOut(); window.location.reload(); },
    accept(button) { act(button.closest("[data-invite]"), () => rpc("oc_respond_invite", { p_member: button.dataset.id, p_accept: true }), "You have joined the team."); },
    decline(button) {
      if (!window.confirm("Decline this team invitation?")) return;
      act(button.closest("[data-invite]"), () => rpc("oc_respond_invite", { p_member: button.dataset.id, p_accept: false }), "Invitation declined.");
    },
    "remove-member"(button) {
      if (!window.confirm(`Remove ${button.dataset.name} from the team?`)) return;
      act(button.closest(".oc-card"), () => rpc("oc_team_remove_member", { p_member: button.dataset.id }), "Removed from the team.");
    },
    "leave-team"(button) {
      if (!window.confirm("Leave this team? Your registration and payment stay as they are.")) return;
      act(button.closest(".oc-actions"), () => rpc("oc_leave_team"), "You have left the team.");
    },
    "cancel-team"(button) {
      if (!window.confirm("Cancel this team? Everyone is released and can join or create another team.")) return;
      act(button.closest(".oc-actions"), () => rpc("oc_cancel_team"), "Team cancelled.");
    },
  };

  app.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form]");
    if (!form || !forms[form.dataset.form]) return;
    event.preventDefault();
    forms[form.dataset.form](form);
  });

  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button && actions[button.dataset.action]) actions[button.dataset.action](button);
  });

  // "Other" in the university list opens a box to type the name
  app.addEventListener("change", (event) => {
    if (!event.target.matches("[data-institution]")) return;
    const box = app.querySelector("[data-institution-other]");
    const other = event.target.value === "other";
    box.hidden = !other;
    box.querySelector("input").required = other;
    if (other) box.querySelector("input").focus();
  });

  /* ---------- Start ---------- */

  // Back from Stripe: the payment is confirmed by Stripe's own message to our
  // server, which can land a few seconds after the redirect. Wait for it.
  async function waitForPayment() {
    let before = me.purchases.length;
    try {
      const saved = sessionStorage.getItem("oc-payments-before");
      if (saved !== null) before = Number(saved);
      sessionStorage.removeItem("oc-payments-before");
    } catch (e) { /* private mode */ }

    const verified = () => {
      notice = ["Payment verified. The full brief is unlocked.", "ok"];
      return refresh();
    };
    if (me.purchases.length > before) return verified();

    notice = ["Confirming your payment…", "ok"];
    render();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      me = await rpc("oc_me");
      if (me.purchases.length > before) return verified();
    }
    notice = ["Your payment hasn't been confirmed yet. It can take a few minutes: reload this page shortly. If it still isn't showing, email DES with your Stripe receipt.", "hold"];
    render();
  }

  async function start() {
    if (!configured) {
      app.innerHTML = window.OC.notOpenCard();
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      app.innerHTML = window.OC.signInCard("Registration", "Enter your email address to begin or continue your registration.");
      return;
    }

    try {
      await refresh();
      sendMail();   // send any emails still waiting, e.g. after a problem earlier
    } catch (error) {
      app.innerHTML = `<p class="oc-card oc-alert" data-tone="bad">${esc(error.message)}</p>`;
      return;
    }

    if (params.has("paid") || params.has("cancelled")) {
      window.history.replaceState(null, "", window.location.pathname);
      if (params.has("paid")) waitForPayment();
      else { notice = ["Payment cancelled. Nothing was charged.", "hold"]; render(); }
    }
  }

  if (configured) {
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { me = null; start(); }
    });
  }
  start();
})();
