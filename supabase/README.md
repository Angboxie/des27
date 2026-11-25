# OPEN CITY 2027 registration system

Registration, payment checks, teams, the paid-only brief and the organisers'
dashboard for DES OPEN CITY 2027.

- **About the competition:** `/open-city/` on the DES site (public)
- **Sign-up and participant area:** `/open-city/register/`
- **Organisers' dashboard:** `/open-city/admin/`
- **Database and rules:** `migrations/` (one SQL file)
- **Payment and email code:** `functions/`
- **Tests:** `tests/`

Until it is connected (steps below), the sign-up page only says when registration opens.

## How it works

1. A student signs in with an emailed link. That email address is their identity
   everywhere: payment, registration, team invitations.
2. They fill in the registration form and pay through Stripe (1 to 3 entries).
3. Stripe tells our server the payment succeeded. Only then is the entry recorded.
   A redirect back to the site proves nothing and is never trusted.
4. Each paid entry covers one person. Someone who buys three says whose the other
   two are, by email. Buying together does not create a team.
5. A team leader registers the team and names the members. Each member accepts from
   their own sign-in. Nobody can join by knowing a team name or Team ID.
6. The database works out each team's status itself, every time a payment,
   registration or confirmation changes. A team is Approved only when every member
   has registered, confirmed and holds a valid paid entry.
7. Approved entries get an anonymous submission code, separate from the Team ID.

## Setting it up

You need three free accounts. Do everything in Stripe's **test mode** first.

### 1. Supabase (database and sign-in)

1. Create a project at supabase.com. Choose the Sydney region.
2. Open the SQL editor, paste in the whole of
   `migrations/20261119000000_open_city.sql`, and run it once. (The second file in
   that folder is for the Google Sheet, below.)
3. Add the organisers (lower-case email addresses), in the SQL editor:

   ```sql
   insert into oc_admins (email) values ('you@example.com'), ('someone.else@example.com');
   ```

4. In the sign-in (Authentication) settings, set the site URL to the live page,
   e.g. `https://YOUR-SITE/open-city/register/`, and add these as allowed redirect URLs:
   `https://YOUR-SITE/open-city/**` and `http://localhost:8080/open-city/**`.
5. Supabase's built-in email only sends a handful of sign-in emails per hour.
   Before launch, connect your own email sender (step 3) under the custom SMTP setting.
6. From the project's API settings, copy the **project URL** and the **anon public key**
   into `src/_data/opencity.json` (`supabaseUrl`, `supabaseAnonKey`). Both are safe to
   publish. Never put the *service role* key in the website.

### 2. Stripe (payments)

1. Create the Stripe account and copy the **secret key** (starts `sk_test_` in test mode).
2. Add a webhook endpoint pointing at
   `https://YOUR-PROJECT.supabase.co/functions/v1/oc-stripe-webhook`
   listening for these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
   - `charge.dispute.created`
3. Copy that endpoint's **signing secret** (starts `whsec_`).

The entry price is not set in Stripe. It is the "Price per entry" box in the
dashboard, so switching from early bird to standard is one change there.

### 3. Resend (emails)

1. Create an account at resend.com, verify the domain you will send from, and
   create an API key.
2. Decide the from-address, e.g. `DES OPEN CITY <opencity@your-domain>`.

Without this the system still works; emails just wait in a queue.

### 4. Put the server code online

This needs the Supabase command-line tool, run from the repository root:

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF

# copy supabase/.env.example to supabase/.env and fill it in first
npx supabase secrets set --env-file supabase/.env

npx supabase functions deploy
```

`supabase/.env` holds the secret keys. Git ignores it: keep it that way, and don't
paste its contents into chat or email. `SITE_URLS` is the address of the DES site (no `/open-city/` on the end). The first
one listed is used in emails. People are only ever sent back to an address on this list.

### 5. Try it, then open it

1. Sign in at `/open-city/admin/` with an organiser address. In **Brief & settings**:
   replace the placeholder brief, add the Discord links, set the price, and turn on
   **Registration is open**.
2. Run a full test in Stripe test mode with card `4242 4242 4242 4242`: register,
   pay, create a team, accept an invitation from a second address, refund the
   payment in Stripe and watch the team lose its approval.
3. For launch, swap in the live Stripe keys (`sk_live_`, plus a live webhook
   endpoint and its `whsec_`), run `secrets set` again, and in
   `src/_data/events.json` change OPEN CITY's `registration.status` to `"open"` so
   the Register button appears on the event page.

## The DES Google Sheet

The sheet is a live, read-only copy of the registrations: tabs for Summary,
Participants, Teams and Payments (one row per entry, showing who paid and who
each entry covers), refreshed every five minutes.

1. In Supabase's SQL editor, paste in `migrations/20261119010000_sheet_feed.sql` and
   run it. The result is one line: the secret for the sheet. Copy it.
2. In the Google Sheet: Extensions > Apps Script. Paste in
   `google-sheet/Code.gs`, save, and reload the sheet.
3. Use the new menu **OPEN CITY > Connect** and paste the secret.

Those four tabs are overwritten on each refresh, so keep your own notes, charts
and formulas on other tabs. Changes are made in the dashboard, not the sheet.
Anyone who can open the sheet can see every participant's details, so share it
with organisers only. Anonymous judging codes are deliberately not in it.

## Day to day

Everything is in the dashboard: who has paid, who hasn't registered, which teams
are waiting and on whom, reminders, holds, authorised team changes, sponsored
entries, CSV exports, and the anonymous judging sheet.

- **Refunds:** refund in Stripe. A full refund cancels the entries it paid for and
  re-checks the teams. A part refund holds the team for review, because Stripe can't
  say which entry it was for: void the right entry in the Payments tab, then clear the hold.
- **Clearing out closed teams:** cancelled and rejected teams have a **Delete team**
  button in the Teams tab, and **Delete all cancelled / rejected** clears them in one
  go. It only removes the team from the list: its members were already freed, and
  payments and entries are kept.
- **Removing a participant:** **Remove** in the Participants tab takes them out of
  their team (which is re-checked) and deletes their registration. Their payment and
  entry are kept, so they then show as "paid but not registered": void the entry in
  Payments if they shouldn't take part. Someone leading a team with other members
  can't be removed until that team is cancelled.
- (On a database set up before 26 Nov 2026, run
  `migrations/20261126000000_organiser_cleanup.sql` once in the SQL editor to turn on
  the two items above.)
- **Team deadline:** turn off **Team changes are open**.
- **Judging:** give judges the *judging sheet* download only. The *code key* links
  codes to teams and stays with DES.

## Tests

```bash
cd supabase/tests
npm install
npm test
```

These run the real SQL file in an in-memory Postgres and cover the rules in the
spec: one paid entry per person, three members at most, invitation-only joining,
one team per person, refunds, the locked brief, organiser-only data, and the
Stripe signature check. Run them after any change to the SQL or functions.

The three `index.ts` files that wrap this logic for Supabase's servers can only be
exercised once deployed (step 5).

## Faster sign-in (optional)

People stay signed in on the browser they used, so the sign-in email is only needed
on a new device. Two switches in `src/_data/opencity.json` (`signIn`) make that first
sign-in quicker. Turn each on only after its setup below is done.

**`emailCode`: a 6-digit code as well as the link.** In Supabase, open the sign-in
(Authentication) email templates, choose the magic link template, and paste in
`email-templates/sign-in-link.html` (it now includes `{{ .Token }}`). Then set
`"emailCode": true`. The sign-in page shows a box for the code, so the person is
signed in on the page they started from, whichever app opened the email.

**`google`: a "Continue with Google" button.** Create an OAuth client in Google Cloud
(type: web application) with the redirect address
`https://YOUR-PROJECT.supabase.co/auth/v1/callback`, then paste its client ID and
secret into Supabase under the Google sign-in provider and switch the provider on.
Then set `"google": true`. Someone who signs in with Google is the same entrant as
the one who used the email link, as long as the email address is the same.
