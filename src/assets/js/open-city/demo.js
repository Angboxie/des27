// OPEN CITY demo pages (/open-city/demo/). Lets organisers try the whole
// registration journey on the live site before any accounts exist.
//
// It stands in for Supabase with a private Postgres database that runs inside
// the visitor's own browser (PGlite) and is loaded with the real rules from
// supabase/migrations. So registration, teams, verification and the dashboard
// behave exactly as they will for real, but:
//   - nothing leaves the browser and nobody else can see it
//   - sign-in is instant, with no email
//   - "Pay now" records a pretend payment straight away; no money moves
// The real pages (/open-city/register/, /open-city/admin/) never load this file.

(() => {
  const PGLITE = "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js";
  const STORE = "idb://des-open-city-demo";
  const WHO = "oc-demo-person";
  const ORGANISER = "organiser@demo.example";
  const linkTo = (name) => (document.querySelector(`[data-oc-link="${name}"]`) || {}).href;

  // The few Supabase pieces the rules rely on
  const SUPABASE_STUB = `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `;

  const person = () => { try { return localStorage.getItem(WHO) || ""; } catch (e) { return ""; } };
  const setPerson = (email) => { try { email ? localStorage.setItem(WHO, email) : localStorage.removeItem(WHO); } catch (e) { /* private mode */ } };

  async function open() {
    const { PGlite } = await import(PGLITE);
    const schema = await (await fetch(linkTo("schema"))).text();
    const stamp = String(schema.length);

    // a newer version of the rules than the one this browser has stored: start clean
    try {
      if (localStorage.getItem("oc-demo-schema") !== stamp) {
        await wipe();
        localStorage.setItem("oc-demo-schema", stamp);
      }
    } catch (e) { /* private mode */ }

    let db;
    try {
      db = await PGlite.create(STORE);
    } catch (error) {
      db = await PGlite.create();   // no storage allowed (private window): keep it in memory
    }

    const ready = await db.query("select to_regclass('public.oc_settings') as found");
    if (!ready.rows[0].found) {
      await db.exec(SUPABASE_STUB);
      await db.exec(schema);
      await db.exec(`
        update public.oc_settings set value = 'true' where key = 'registration_open';
        insert into public.oc_admins (email) values ('${ORGANISER}');
      `);
    }
    return db;
  }

  async function wipe() {
    if (!indexedDB.databases) return;
    for (const item of await indexedDB.databases()) {
      if (item.name && item.name.includes("des-open-city-demo")) {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(item.name);
          request.onsuccess = request.onerror = request.onblocked = resolve;
        });
      }
    }
  }

  const database = open();
  database.catch((error) => {
    console.error("OPEN CITY demo", error);
    const app = document.getElementById("oc-app");
    if (app) app.innerHTML = `<p class="oc-card oc-alert" data-tone="bad">The demo couldn't start in this browser. Try the latest Chrome, Edge, Safari or Firefox.</p>`;
  });

  // One statement at a time, each as the right role - like the real API does
  let queue = Promise.resolve();
  function run(role, userId, sql, params) {
    const job = queue.then(async () => {
      const db = await database;
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
        await db.exec(`set local role ${role}`);
        const result = await db.query(sql, params || []);
        await db.exec("commit");
        return result.rows;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  async function userId(email) {
    if (!email) return null;
    const db = await database;
    const rows = (await db.query(
      "insert into auth.users (email) values ($1) on conflict (email) do update set email = excluded.email returning id", [email])).rows;
    return rows[0].id;
  }

  const call = (fn, args) => {
    const names = Object.keys(args || {});
    return `select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(", ")}) as result`;
  };

  // The parts of the Supabase client that the pages use
  const client = {
    async rpc(fn, args) {
      try {
        if (!/^oc_[a-z_]+$/.test(fn)) throw new Error("unknown function");
        const id = await userId(person());
        const rows = await run(id ? "authenticated" : "anon", id, call(fn, args), Object.values(args || {}));
        return { data: rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code || "XX000", message: error.message } };
      }
    },

    functions: {
      async invoke(name, options) {
        if (name !== "oc-checkout") return { data: { sent: 0 }, error: null };   // oc-mail: nothing to send
        const email = person();
        const id = await userId(email);
        const quantity = Number(options && options.body && options.body.quantity) || 1;
        const price = (await run("service_role", null, "select public.oc_setting('price_cents') as result"))[0].result;
        const reference = (window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()));
        // what the Stripe webhook does once a real payment succeeds
        await run("service_role", null,
          "select public.oc_record_payment($1, $2, $3, $4, $5, $6, 'aud')",
          ["demo_session_" + reference, "demo_payment_" + reference, id, email, quantity, Number(price) * quantity]);
        return { data: { url: linkTo("portal") + "?paid=1" }, error: null };
      },
    },

    auth: {
      async getSession() {
        await database;
        const email = person();
        return { data: { session: email ? { user: { email } } : null }, error: null };
      },
      async signInWithOtp({ email }) {
        setPerson(String(email || "").trim().toLowerCase());
        window.location.reload();
        return new Promise(() => {});   // the page is reloading
      },
      async signOut() { setPerson(""); return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };

  window.supabase = { createClient: () => client };

  // The yellow demo bar: switch person, start over
  document.addEventListener("DOMContentLoaded", () => {
    const picker = document.querySelector("[data-demo-person]");
    if (picker) {
      const current = person();
      if (current && !Array.from(picker.options).some((option) => option.value === current)) {
        picker.add(new Option(current, current));
      }
      picker.value = current;
      picker.addEventListener("change", () => {
        setPerson(picker.value);
        // organisers land on the dashboard, everyone else on the participant page
        const target = picker.value === ORGANISER ? linkTo("admin") : linkTo("portal");
        window.location.assign(target);
      });
    }

    const reset = document.querySelector("[data-demo-reset]");
    if (reset) {
      reset.addEventListener("click", async () => {
        if (!window.confirm("Clear the demo and start over?")) return;
        setPerson("");
        try { (await database).close(); } catch (e) { /* already closed */ }
        await wipe();
        window.location.assign(linkTo("portal"));
      });
    }
  });
})();
