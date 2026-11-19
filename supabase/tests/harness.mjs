// Starts an empty Postgres in memory, adds the few Supabase pieces the
// migration relies on (auth.users, auth.uid(), the three roles), then runs
// the real migration file.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase lets every role run new functions unless told otherwise
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function startDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrations).sort()) {
    await db.exec(readFileSync(join(migrations, file), "utf8"));
  }

  // Run one statement as a given role / signed-in person, like the API does
  async function run(role, userId, sql, params = []) {
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
      await db.exec(`set local role ${role}`);
      const result = await db.query(sql, params);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }

  const api = {
    db,

    // A person who has signed in with a verified email address
    async person(email) {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
      const call = async (fn, ...args) => {
        const marks = args.map((_, i) => `$${i + 1}`).join(", ");
        const rows = await run("authenticated", id, `select public.${fn}(${marks}) as result`, args);
        return rows[0].result;
      };
      return { id, email, call, me: () => call("oc_me") };
    },

    // The Stripe webhook / mailer (service role)
    async service(fn, ...args) {
      const marks = args.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await run("service_role", null, `select public.${fn}(${marks}) as result`, args);
      return rows[0].result;
    },

    // Someone with no sign-in at all
    anon: (sql, params) => run("anon", null, sql, params),
    as: (person, sql, params) => run("authenticated", person.id, sql, params),
    sql: async (sql, params) => (await db.query(sql, params)).rows,

    async pay(person, quantity = 1) {
      const session = `cs_${randomUUID()}`;
      const intent = `pi_${randomUUID()}`;
      await api.service("oc_record_payment", session, intent, person.id, person.email, quantity, 1000 * quantity, "aud");
      return { session, intent };
    },

    async emails(to) {
      return (await db.query("select template, data from oc_outbox where to_email = $1 order by id", [to])).rows;
    },
  };

  await db.exec("update public.oc_settings set value = 'true' where key = 'registration_open'");
  return api;
}

export const details = (name, extra = {}) => ({
  full_name: name,
  institution: "University of Melbourne",
  category: "architecture",
  discord: name.toLowerCase().replace(/\s+/g, "") + "#1",
  path: "team",
  rules_accepted: true,
  ...extra,
});
