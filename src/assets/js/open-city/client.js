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
      // keep the technical reason visible: it is what DES needs to fix the problem
      const reason = [fn, error.code, error.status, String(error.message || "").slice(0, 200)].filter(Boolean).join(" | ");
      throw new Error("Something went wrong. Please try again, or email DES if it keeps happening. (Details for DES: " + reason + ")");
    }
    return data;
  }

  // Emails are queued by the database; this nudges the sender. Fine if it fails:
  // the next action (or the payment webhook) sends whatever is waiting.
  const sendMail = () => { sb.functions.invoke("oc-mail").catch(() => {}); };

  async function signIn(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    if (error) throw new Error(error.status === 429 ? "Too many requests at the moment. Please try again in a few minutes." : "Couldn't send the email. Check the address and try again.");
  }

  // emails from DES link here with the recipient's address, so it is filled in ready
  const emailFromLink = () => { try { return new URLSearchParams(window.location.search).get("email") || ""; } catch (e) { return ""; } };

  // Optional quicker ways in, switched on in _data/opencity.json (signIn) once Supabase is set up for them
  const withGoogle = config.signinGoogle === "true";
  const withCode = config.signinCode === "true";

  const signInCard = (heading, intro) => `
    <form class="oc-card oc-signin" data-form="signin">
      <h2>${esc(heading)}</h2>
      <p>${esc(intro)}</p>
      ${withGoogle ? `
        <button class="oc-btn oc-google" type="button" data-oc-google>Continue with Google</button>
        <p class="oc-or"><span>or use your email</span></p>` : ""}
      <label class="oc-field">
        <span>Email address</span>
        <input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@student.unimelb.edu.au" value="${esc(emailFromLink())}">
      </label>
      <p class="oc-hint">${withCode ? "We will email you a 6-digit code and a secure link." : "We will email you a secure link to continue."} You stay signed in on this device afterwards. Please use the same email address each time.</p>
      <div class="oc-alert" data-alert hidden></div>
      <button class="oc-btn" type="submit">Continue</button>
    </form>`;

  // After the email has gone: where to type the code (if codes are on), or just what to do next
  function showEmailSent(form, email) {
    form.outerHTML = withCode ? `
      <form class="oc-card oc-signin" data-oc-code data-email="${esc(email)}">
        <h2>Check your email</h2>
        <p>We have sent a 6-digit code to <strong>${esc(email)}</strong>. Type it in here. It may take a minute to arrive; please check your spam folder.</p>
        <label class="oc-field">
          <span>Code from the email</span>
          <input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,12}" maxlength="12" placeholder="123456">
        </label>
        <p class="oc-hint">The email also has a button that signs you in. Use it on this device if you prefer.</p>
        <div class="oc-alert" data-alert hidden></div>
        <button class="oc-btn" type="submit">Sign in</button>
      </form>` : `
      <div class="oc-card oc-signin">
        <h2>Check your email</h2>
        <p>A link has been sent to <strong>${esc(email)}</strong>. Open it on this device to continue. It may take a minute to arrive; please check your spam folder.</p>
      </div>`;
    const input = document.querySelector("[data-oc-code] input");
    if (input) input.focus();
  }

  if (configured) {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-oc-google]");
      if (!button) return;
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
      if (error) alertIn(button.closest("form"), "Google sign-in isn't available right now. Please use your email instead.");
    });

    document.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-oc-code]");
      if (!form) return;
      event.preventDefault();
      setBusy(form, true);
      const { error } = await sb.auth.verifyOtp({ email: form.dataset.email, token: form.code.value.replace(/\D/g, ""), type: "email" });
      if (error) {
        setBusy(form, false);
        return alertIn(form, "That code didn't work. Check it, or go back and request a new one: codes expire after a short while.");
      }
      window.location.replace(window.location.pathname);
    });
  }

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

  return { app, config, configured, sb, content, link, esc, categoryLabel, money, date, statusPill, STATUS, rpc, sendMail, signIn, signInCard, showEmailSent, notOpenCard, alertIn, setBusy, downloadCsv };
})();
