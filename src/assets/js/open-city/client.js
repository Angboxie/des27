// Shared by the OPEN CITY participant page and the organisers' dashboard:
// the connection to Supabase, sign-in, and small display helpers.

window.OC = (() => {
  const app = document.getElementById("oc-app");
  const config = app ? app.dataset : {};
  const configured = Boolean(config.supabaseUrl && config.supabaseKey && window.supabase);
  const sb = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey) : null;

  const content = JSON.parse((document.getElementById("oc-content") || {}).textContent || "{}");
  const link = (name) => (document.querySelector(`[data-oc-link="${name}"]`) || {}).href || "/";

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const categoryLabel = (id) => ((content.categories || []).find((c) => c.id === id) || {}).label || id || "";
  const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
  const date = (value) => (value ? new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

  const STATUS = {
    draft: ["Needs teammates", "wait"],
    pending_payment: ["Waiting on payment", "wait"],
    pending_confirmation: ["Waiting on confirmation", "wait"],
    pending_review: ["With DES for review", "hold"],
    approved: ["Approved", "ok"],
    rejected: ["Not accepted", "bad"],
    cancelled: ["Cancelled", "bad"],
  };
  const statusPill = (status) => {
    const [label, tone] = STATUS[status] || [status, "wait"];
    return `<span class="oc-pill oc-pill--${tone}">${esc(label)}</span>`;
  };

  // Ask the database to do something. Messages it raises on purpose (code P0001)
  // are written for participants, so they are shown as they are.
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) {
      if (error.code === "P0001") throw new Error(error.message);
      console.error(fn, error);
      throw new Error("Something went wrong. Please try again, or email DES if it keeps happening.");
    }
    return data;
  }

  // Emails are queued by the database; this nudges the sender. Fine if it fails:
  // the next action (or the payment webhook) sends whatever is waiting.
  const sendMail = () => { sb.functions.invoke("oc-mail").catch(() => {}); };

  async function signIn(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    if (error) throw new Error(error.status === 429 ? "Too many emails just now. Please wait a minute and try again." : "Couldn't send the email. Check the address and try again.");
  }

  const signInCard = (heading, intro) => `
    <form class="oc-card oc-signin" data-form="signin">
      <h2>${esc(heading)}</h2>
      <p>${esc(intro)}</p>
      <label class="oc-field">
        <span>Email address</span>
        <input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@student.unimelb.edu.au">
      </label>
      <p class="oc-hint">We will email you a secure link to continue. Please use the same email address each time.</p>
      <div class="oc-alert" data-alert hidden></div>
      <button class="oc-btn" type="submit">Continue</button>
    </form>`;

  const notOpenCard = () => `
    <div class="oc-card">
      <h2>Not open yet</h2>
      <p>${esc(config.opens || "Registration isn't open yet.")}</p>
      <p><a class="oc-btn oc-btn--line" href="${esc(link("event"))}">About the competition</a></p>
    </div>`;

  // Show a message inside the form or card the action came from
  function alertIn(scope, message, tone = "bad") {
    const box = scope && scope.querySelector("[data-alert]");
    if (!box) return window.alert(message);
    box.textContent = message;
    box.dataset.tone = tone;
    box.hidden = false;
    box.setAttribute("role", tone === "bad" ? "alert" : "status");
  }

  function setBusy(scope, busy) {
    if (!scope) return;
    scope.querySelectorAll("button, input, select, textarea").forEach((el) => {
      if (busy) { el.dataset.wasDisabled = el.disabled ? "1" : ""; el.disabled = true; }
      else if (el.dataset.wasDisabled === "") { el.disabled = false; }
    });
  }

  function downloadCsv(filename, rows) {
    // a leading apostrophe stops spreadsheet apps running a name like "=HYPERLINK(...)" as a formula
    const cell = (value) => {
      const text = String(value == null ? "" : value);
      return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
    };
    const blob = new Blob([rows.map((row) => row.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { app, config, configured, sb, content, link, esc, categoryLabel, money, date, statusPill, STATUS, rpc, sendMail, signIn, signInCard, notOpenCard, alertIn, setBusy, downloadCsv };
})();
