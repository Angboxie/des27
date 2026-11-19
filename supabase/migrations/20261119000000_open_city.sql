-- DES OPEN CITY 2027 - registration system
--
-- How it fits together
--   * People sign in with an emailed link (Supabase Auth). The address they
--     sign in with is the only identity the system trusts.
--   * Tables are locked (row level security on, no policies). The website can
--     only call the oc_* functions below, and each one checks who is asking.
--   * Payments are written by the Stripe webhook only (oc_record_payment etc.).
--     Each paid entry is one row in oc_entries and covers one person.
--   * A team's status is never set by a participant. oc_recheck_team works it
--     out from payments, registrations and confirmations every time one changes.
--   * Emails are queued in oc_outbox and sent by the oc-mail function.

-- ---------------------------------------------------------------- tables --

create table public.oc_settings (
  key   text primary key,
  value jsonb not null
);

insert into public.oc_settings (key, value) values
  ('registration_open',  'true'),    -- Register / pay buttons work (switch off in the dashboard)
  ('price_cents',        '1000'),    -- price of one entry, in cents
  ('currency',           '"aud"'),
  ('team_changes_open',  'true'),    -- participants can still form / change teams
  ('submissions_open',   'false'),   -- approved entries can lodge their submission link
  ('discord_invite',     '"https://discord.gg/JAarUc9HZ"'),   -- shown to paid participants only
  ('team_finder_url',    'null');    -- Discord team-finder forum, paid participants only

-- DES organisers who can open the admin dashboard (lower-case email addresses)
create table public.oc_admins (
  email text primary key check (email = lower(email))
);

create table public.oc_participants (
  user_id           uuid primary key references auth.users (id),
  email             text not null,
  full_name         text not null,
  institution       text not null,
  category          text not null check (category in ('architecture', 'uiux', 'graphic')),
  discord           text not null,
  phone             text,
  heard_from        text,
  path              text not null check (path in ('solo', 'team', 'looking')),
  rules_accepted_at timestamptz not null,
  registered_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per successful checkout (or manual grant by an organiser)
create table public.oc_payments (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null check (provider in ('stripe', 'manual')),
  session_id      text unique,
  payment_intent  text unique,
  purchaser_id    uuid references auth.users (id),
  purchaser_email text not null,
  quantity        int  not null check (quantity between 1 and 3),
  amount_cents    int  not null default 0,
  refunded_cents  int  not null default 0,
  currency        text not null default 'aud',
  status          text not null default 'paid'
                  check (status in ('paid', 'partially_refunded', 'refunded', 'disputed')),
  note            text,
  created_at      timestamptz not null default now()
);

-- One row per purchased entry. An entry covers exactly one person.
create table public.oc_entries (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.oc_payments (id),
  seq            int  not null,
  status         text not null default 'valid' check (status in ('valid', 'void')),
  assigned_email text check (assigned_email = lower(assigned_email)),
  participant_id uuid references auth.users (id),
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (payment_id, seq)
);

-- a person can hold only one valid entry, and an entry only one person
create unique index oc_entries_one_per_person
  on public.oc_entries (participant_id) where status = 'valid' and participant_id is not null;
-- an address can only be waiting on one unclaimed entry
create unique index oc_entries_one_waiting_per_email
  on public.oc_entries (assigned_email) where status = 'valid' and participant_id is null and assigned_email is not null;

create table public.oc_teams (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- public Team ID, e.g. OC27-7KQ2M
  name          text not null,
  category      text not null check (category in ('architecture', 'uiux', 'graphic')),
  solo          boolean not null default false, -- a one-person entry
  size          int not null default 1 check (size between 0 and 3),
  leader_id     uuid not null references auth.users (id),
  status        text not null default 'draft'
                check (status in ('draft', 'pending_payment', 'pending_confirmation',
                                  'pending_review', 'approved', 'rejected', 'cancelled')),
  review_reason text,   -- set => the team waits in "pending review" for an organiser
  admin_note    text,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.oc_team_members (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,   -- the order people were added in
  team_id        uuid not null references public.oc_teams (id),
  role           text not null default 'member' check (role in ('leader', 'member')),
  invite_name    text not null,
  invite_email   text not null check (invite_email = lower(invite_email)),
  participant_id uuid references auth.users (id),
  state          text not null default 'invited'
                 check (state in ('invited', 'accepted', 'declined', 'removed')),
  invited_at     timestamptz not null default now(),
  responded_at   timestamptz
);

-- nobody can be a confirmed member of two teams at once
create unique index oc_members_one_team_per_person
  on public.oc_team_members (participant_id) where state = 'accepted';
-- nobody is listed twice in the same team
create unique index oc_members_once_per_team
  on public.oc_team_members (team_id, invite_email) where state in ('invited', 'accepted');
create index oc_members_by_email on public.oc_team_members (invite_email);

-- Anonymous code for judging, issued when an entry is approved. Kept apart
-- from the Team ID so judges never see who made a submission.
create table public.oc_submissions (
  team_id      uuid primary key references public.oc_teams (id),
  anon_code    text not null unique,            -- e.g. S-4HX9QT
  link         text,
  notes        text,
  submitted_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Paid-only material: the brief, category challenges, rules, resources
create table public.oc_resources (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null check (kind in ('brief', 'challenge', 'rules', 'submission', 'resource')),
  category  text check (category in ('architecture', 'uiux', 'graphic')),
  title     text not null,
  body      text,
  url       text,
  sort      int not null default 0,
  published boolean not null default true
);

create table public.oc_outbox (
  id         bigint generated always as identity primary key,
  to_email   text not null,
  template   text not null,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  attempts   int not null default 0,
  tried_at   timestamptz,
  sent_at    timestamptz,
  error      text
);

alter table public.oc_settings     enable row level security;
alter table public.oc_admins       enable row level security;
alter table public.oc_participants enable row level security;
alter table public.oc_payments     enable row level security;
alter table public.oc_entries      enable row level security;
alter table public.oc_teams        enable row level security;
alter table public.oc_team_members enable row level security;
alter table public.oc_submissions  enable row level security;
alter table public.oc_resources    enable row level security;
alter table public.oc_outbox       enable row level security;

revoke all on public.oc_settings, public.oc_admins, public.oc_participants, public.oc_payments,
  public.oc_entries, public.oc_teams, public.oc_team_members, public.oc_submissions,
  public.oc_resources, public.oc_outbox from anon, authenticated;


-- --------------------------------------------------------------- helpers --

-- The signed-in person's verified email address, lower case (null if signed out)
create function public.oc_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create function public.oc_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from oc_admins a where a.email = oc_email())
$$;

create function public.oc_require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or oc_email() is null then
    raise exception 'Please sign in first.';
  end if;
  return auth.uid();
end $$;

create function public.oc_require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform oc_require_user();
  if not oc_is_admin() then
    raise exception 'Only DES organisers can do that.';
  end if;
end $$;

create function public.oc_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from oc_settings where key = p_key
$$;

create function public.oc_flag(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from oc_settings where key = p_key), false)
$$;

-- Random code without look-alike characters (no 0/O, 1/I/L)
create function public.oc_random_code(p_len int) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
begin
  for i in 1..p_len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end $$;

create function public.oc_new_team_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare candidate text;
begin
  loop
    candidate := 'OC27-' || oc_random_code(5);
    exit when not exists (select 1 from oc_teams where code = candidate);
  end loop;
  return candidate;
end $$;

create function public.oc_new_anon_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare candidate text;
begin
  loop
    candidate := 'S-' || oc_random_code(6);
    exit when not exists (select 1 from oc_submissions where anon_code = candidate);
  end loop;
  return candidate;
end $$;

create function public.oc_clean_email(p_email text) returns text
language plpgsql immutable as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 254 then
    raise exception 'That email address doesn''t look right: %', coalesce(nullif(e, ''), '(empty)');
  end if;
  return e;
end $$;

create function public.oc_queue_email(p_to text, p_template text, p_data jsonb default '{}') returns void
language sql volatile security definer set search_path = public as $$
  insert into oc_outbox (to_email, template, data) values (lower(p_to), p_template, coalesce(p_data, '{}'))
$$;

-- Does this person hold a valid paid entry?
create function public.oc_has_entry(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from oc_entries e where e.participant_id = p_user and e.status = 'valid')
$$;

-- Is this address covered by a valid entry (claimed, or waiting to be claimed)?
create function public.oc_email_paid(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from oc_entries e
    where e.status = 'valid'
      and ((e.participant_id is null and e.assigned_email = lower(p_email))
        or e.participant_id in (select u.id from auth.users u where lower(u.email) = lower(p_email)))
  )
$$;

-- Keep teams to three people even if something slips past the functions
create function public.oc_members_limit() returns trigger
language plpgsql as $$
begin
  if new.state in ('invited', 'accepted') and (
       select count(*) from public.oc_team_members m
       where m.team_id = new.team_id and m.id <> new.id and m.state in ('invited', 'accepted')
     ) >= 3 then
    raise exception 'A team can have at most three members.';
  end if;
  return new;
end $$;

create trigger oc_members_limit before insert or update on public.oc_team_members
  for each row execute function public.oc_members_limit();


-- ---------------------------------------------------- team verification --

-- Work out a team's status from the facts, and act on a new approval.
create function public.oc_recheck_team(p_team uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  t             oc_teams;
  n_active      int;
  n_unpaid      int;
  n_unconfirmed int;
  new_status    text;
  anon          text;
begin
  select * into t from oc_teams where id = p_team for update;
  if not found then return null; end if;
  if t.status in ('rejected', 'cancelled') then return t.status; end if;

  select count(*),
         count(*) filter (where not (case when m.participant_id is not null
                                          then oc_has_entry(m.participant_id)
                                          else oc_email_paid(m.invite_email) end)),
         count(*) filter (where m.state <> 'accepted'
                             or not exists (select 1 from oc_participants p where p.user_id = m.participant_id))
    into n_active, n_unpaid, n_unconfirmed
  from oc_team_members m
  where m.team_id = p_team and m.state in ('invited', 'accepted');

  new_status := case
    when t.review_reason is not null       then 'pending_review'
    when n_active < 1 or n_active > 3      then 'pending_review'
    when n_active = 1 and not t.solo       then 'draft'              -- a team needs at least two people
    when n_unpaid > 0                      then 'pending_payment'
    when n_unconfirmed > 0                 then 'pending_confirmation'
    else 'approved'
  end;

  update oc_teams
     set status = new_status,
         size = n_active,
         approved_at = case when new_status = 'approved' then coalesce(approved_at, now()) else approved_at end,
         updated_at = now()
   where id = p_team;

  if new_status = 'approved' then
    insert into oc_submissions (team_id, anon_code) values (p_team, oc_new_anon_code())
    on conflict (team_id) do nothing;

    -- tell the team when it is first approved, or approved again after
    -- dropping out (not when an organiser merely lifts a hold)
    if t.status <> 'approved' and (t.approved_at is null or t.status <> 'pending_review') then
      select anon_code into anon from oc_submissions where team_id = p_team;
      perform oc_queue_email(m.invite_email, 'team_approved',
                jsonb_build_object('team', t.name, 'code', t.code, 'solo', t.solo, 'submission_code', anon))
      from oc_team_members m where m.team_id = p_team and m.state = 'accepted';
    end if;
  end if;

  return new_status;
end $$;

-- Recheck every open team this person (or address) is part of
create function public.oc_recheck_person(p_user uuid, p_email text) returns void
language sql volatile security definer set search_path = public as $$
  select oc_recheck_team(team_id) from (
    select distinct m.team_id
    from oc_team_members m
    where m.state in ('invited', 'accepted')
      and ((p_user is not null and m.participant_id = p_user)
        or (p_email is not null and m.invite_email = lower(p_email)))
  ) teams
$$;

-- If an entry was bought for this address, attach it to the person
create function public.oc_claim_entry(p_user uuid, p_email text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare claimed uuid;
begin
  if oc_has_entry(p_user) then return false; end if;
  update oc_entries set participant_id = p_user, claimed_at = now()
   where id = (select e.id from oc_entries e
               where e.status = 'valid' and e.participant_id is null and e.assigned_email = lower(p_email)
               order by e.created_at limit 1 for update skip locked)
  returning id into claimed;
  return claimed is not null;
end $$;

-- Close a team and free its members to join another
create function public.oc_close_team(p_team uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update oc_teams set status = p_status, size = 0, updated_at = now() where id = p_team;
  update oc_team_members set state = 'removed', responded_at = now()
   where team_id = p_team and state in ('invited', 'accepted');
end $$;

-- The team this person is a confirmed member of (null if none)
create function public.oc_my_team_id(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.team_id from oc_team_members m where m.participant_id = p_user and m.state = 'accepted'
$$;

create function public.oc_require_team_changes() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not oc_flag('team_changes_open') then
    raise exception 'Team changes are closed. Email DES if something needs fixing.';
  end if;
end $$;

-- Leaving a one-person entry behind (to start or join a team)
create function public.oc_drop_solo(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare t oc_teams;
begin
  select tm.* into t from oc_teams tm where tm.id = oc_my_team_id(p_user);
  if not found then return; end if;
  if not t.solo then
    raise exception 'You are already in team "%". Leave it before joining another.', t.name;
  end if;
  if exists (select 1 from oc_submissions s where s.team_id = t.id and s.link is not null) then
    raise exception 'Your individual entry already has a submission. Email DES to change it.';
  end if;
  perform oc_close_team(t.id, 'cancelled');
end $$;

create function public.oc_make_solo(p_user uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare p oc_participants; new_id uuid;
begin
  select * into p from oc_participants where user_id = p_user;
  insert into oc_teams (code, name, category, solo, size, leader_id)
  values (oc_new_team_code(), p.full_name, p.category, true, 1, p_user)
  returning id into new_id;
  insert into oc_team_members (team_id, role, invite_name, invite_email, participant_id, state, responded_at)
  values (new_id, 'leader', p.full_name, p.email, p_user, 'accepted', now());
  perform oc_recheck_team(new_id);
  return new_id;
end $$;


-- ------------------------------------------------ participant functions --

-- Everything the participant area needs, in one call
create function public.oc_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid   uuid := oc_require_user();
  mail  text := oc_email();
  paid  boolean;
  team  uuid;
begin
  if oc_claim_entry(uid, mail) then
    perform oc_recheck_person(uid, mail);
  end if;
  paid := oc_has_entry(uid);
  team := oc_my_team_id(uid);

  return jsonb_build_object(
    'email', mail,
    'is_admin', oc_is_admin(),
    'paid', paid,
    'settings', jsonb_build_object(
      'registration_open', oc_flag('registration_open'),
      'team_changes_open', oc_flag('team_changes_open'),
      'submissions_open', oc_flag('submissions_open'),
      'price_cents', oc_setting('price_cents'),
      'currency', oc_setting('currency'),
      'discord_invite', case when paid or oc_is_admin() then oc_setting('discord_invite') end,
      'team_finder_url', case when paid or oc_is_admin() then oc_setting('team_finder_url') end),
    'participant', (select to_jsonb(p) - 'user_id' from oc_participants p where p.user_id = uid),
    'entry', (select jsonb_build_object('id', e.id, 'payment_status', pay.status,
                                        'bought_by', pay.purchaser_email, 'claimed_at', e.claimed_at)
              from oc_entries e join oc_payments pay on pay.id = e.payment_id
              where e.participant_id = uid and e.status = 'valid'),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pay.id, 'status', pay.status, 'quantity', pay.quantity,
               'amount_cents', pay.amount_cents, 'created_at', pay.created_at,
               'entries', (select jsonb_agg(jsonb_build_object(
                             'id', e.id, 'status', e.status, 'assigned_email', e.assigned_email,
                             'claimed', e.participant_id is not null, 'mine', e.participant_id = uid,
                             'name', (select p.full_name from oc_participants p where p.user_id = e.participant_id))
                           order by e.seq)
                           from oc_entries e where e.payment_id = pay.id))
             order by pay.created_at)
      from oc_payments pay where pay.purchaser_id = uid), '[]'::jsonb),
    'team', (
      select jsonb_build_object(
        'id', t.id, 'code', t.code, 'name', t.name, 'category', t.category, 'solo', t.solo,
        'status', t.status, 'review_reason', t.review_reason, 'is_leader', t.leader_id = uid,
        'submission', case when t.status = 'approved' then
            (select jsonb_build_object('code', s.anon_code, 'link', s.link, 'notes', s.notes, 'submitted_at', s.submitted_at)
             from oc_submissions s where s.team_id = t.id) end,
        'members', (select jsonb_agg(jsonb_build_object(
                      'id', m.id, 'name', coalesce(p.full_name, m.invite_name), 'email', m.invite_email,
                      'role', m.role, 'state', m.state, 'me', m.participant_id = uid,
                      'registered', p.user_id is not null,
                      'paid', case when m.participant_id is not null then oc_has_entry(m.participant_id)
                                   else oc_email_paid(m.invite_email) end)
                    order by (m.role = 'leader') desc, m.seq)
                    from oc_team_members m left join oc_participants p on p.user_id = m.participant_id
                    where m.team_id = t.id and m.state in ('invited', 'accepted')))
      from oc_teams t where t.id = team),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'team', t.name, 'code', t.code, 'category', t.category, 'size', t.size,
               'leader', (select p.full_name from oc_participants p where p.user_id = t.leader_id))
             order by m.invited_at)
      from oc_team_members m join oc_teams t on t.id = m.team_id
      where m.invite_email = mail and m.state = 'invited' and t.status not in ('rejected', 'cancelled')), '[]'::jsonb)
  );
end $$;

-- Individual registration (every participant fills this in once; it can be edited later)
create function public.oc_save_registration(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid       uuid := oc_require_user();
  mail      text := oc_email();
  existing  oc_participants;
  my_team   oc_teams;
  v_name    text := btrim(coalesce(p->>'full_name', ''));
  v_inst    text := btrim(coalesce(p->>'institution', ''));
  v_cat     text := p->>'category';
  v_discord text := btrim(coalesce(p->>'discord', ''));
  v_phone   text := nullif(btrim(coalesce(p->>'phone', '')), '');
  v_heard   text := nullif(btrim(coalesce(p->>'heard_from', '')), '');
  v_path    text := p->>'path';
begin
  select * into existing from oc_participants where user_id = uid;
  if existing.user_id is null and not oc_flag('registration_open') and not oc_is_admin() then
    raise exception 'Registration isn''t open yet.';
  end if;

  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Please enter your full name.'; end if;
  if length(v_inst) < 2 or length(v_inst) > 160 then raise exception 'Please enter your university or institution.'; end if;
  if v_cat is null or v_cat not in ('architecture', 'uiux', 'graphic') then raise exception 'Please choose a competition category.'; end if;
  if length(v_discord) < 2 or length(v_discord) > 64 then raise exception 'Please enter your Discord username.'; end if;
  if v_path is null or v_path not in ('solo', 'team', 'looking') then raise exception 'Please choose how you are taking part.'; end if;
  if length(coalesce(v_phone, '')) > 30 then raise exception 'That phone number is too long.'; end if;
  if length(coalesce(v_heard, '')) > 300 then raise exception 'Please shorten "How did you hear about OPEN CITY?".'; end if;
  if existing.user_id is null and coalesce((p->>'rules_accepted')::boolean, false) is not true then
    raise exception 'Please accept the competition rules and privacy notice.';
  end if;

  select * into my_team from oc_teams where id = oc_my_team_id(uid);

  -- in a real team the category follows the team, and you stay on the team path
  if my_team.id is not null and not my_team.solo then
    v_cat := my_team.category;
    v_path := 'team';
  end if;

  insert into oc_participants (user_id, email, full_name, institution, category, discord, phone, heard_from, path, rules_accepted_at)
  values (uid, mail, v_name, v_inst, v_cat, v_discord, v_phone, v_heard, v_path, now())
  on conflict (user_id) do update
    set email = excluded.email, full_name = excluded.full_name, institution = excluded.institution,
        category = excluded.category, discord = excluded.discord, phone = excluded.phone,
        heard_from = excluded.heard_from, path = excluded.path, updated_at = now();

  if my_team.id is not null and my_team.solo then
    if v_path = 'solo' then
      update oc_teams set name = v_name, category = v_cat, updated_at = now() where id = my_team.id;
      update oc_team_members set invite_name = v_name where team_id = my_team.id;
    else
      perform oc_require_team_changes();
      perform oc_drop_solo(uid);          -- no longer entering alone
    end if;
  elsif my_team.id is null and v_path = 'solo' then
    perform oc_require_team_changes();
    perform oc_make_solo(uid);
  end if;

  if existing.user_id is null then
    perform oc_queue_email(mail, 'registration_received', jsonb_build_object('name', v_name, 'path', v_path));
  end if;

  perform oc_claim_entry(uid, mail);
  perform oc_recheck_person(uid, mail);
  return oc_me();
end $$;

-- The buyer of several entries says who each spare entry is for
create function public.oc_assign_entry(p_entry uuid, p_email text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid    uuid := oc_require_user();
  e      oc_entries;
  target text := case when nullif(btrim(coalesce(p_email, '')), '') is null then null else oc_clean_email(p_email) end;
  target_user uuid;
begin
  select en.* into e from oc_entries en join oc_payments pay on pay.id = en.payment_id
   where en.id = p_entry and pay.purchaser_id = uid for update of en;
  if not found then raise exception 'That entry isn''t one you bought.'; end if;
  if e.status <> 'valid' then raise exception 'That entry is no longer valid.'; end if;
  if e.participant_id is not null then
    raise exception 'That entry is already in use. Email DES if it needs to move.';
  end if;

  if target is not null then
    if oc_email_paid(target) then raise exception '% already has a paid entry.', target; end if;
    update oc_entries set assigned_email = target where id = e.id;
    select u.id into target_user from auth.users u where lower(u.email) = target and u.email_confirmed_at is not null;
    if target_user is not null then
      perform oc_claim_entry(target_user, target);
    end if;
    perform oc_queue_email(target, 'entry_assigned', jsonb_build_object('from', oc_email()));
    perform oc_recheck_person(target_user, target);
  else
    update oc_entries set assigned_email = null where id = e.id;
    perform oc_recheck_person(null, e.assigned_email);
  end if;
  return oc_me();
end $$;

-- Path A: the nominated leader registers the team and names the other members
create function public.oc_create_team(p_name text, p_category text, p_members jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid     uuid := oc_require_user();
  me      oc_participants;
  v_name  text := btrim(coalesce(p_name, ''));
  member  jsonb;
  m_name  text;
  m_email text;
  seen    text[] := '{}';
  new_id  uuid;
  new_code text;
begin
  perform oc_require_team_changes();
  select * into me from oc_participants where user_id = uid;
  if not found then raise exception 'Complete your own registration before creating a team.'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please give the team a name (2 to 80 characters).'; end if;
  if p_category is null or p_category not in ('architecture', 'uiux', 'graphic') then raise exception 'Please choose the team''s category.'; end if;
  if jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members) not between 1 and 2 then
    raise exception 'A team has two or three people: add one or two teammates.';
  end if;
  if exists (select 1 from oc_teams t where lower(t.name) = lower(v_name) and t.status not in ('rejected', 'cancelled')) then
    raise exception 'Another team is already called "%". Please pick a different name.', v_name;
  end if;

  perform oc_drop_solo(uid);   -- errors if already in a real team

  new_code := oc_new_team_code();
  insert into oc_teams (code, name, category, solo, size, leader_id)
  values (new_code, v_name, p_category, false, 1, uid) returning id into new_id;
  insert into oc_team_members (team_id, role, invite_name, invite_email, participant_id, state, responded_at)
  values (new_id, 'leader', me.full_name, me.email, uid, 'accepted', now());

  for member in select * from jsonb_array_elements(p_members) loop
    m_name := btrim(coalesce(member->>'name', ''));
    m_email := oc_clean_email(member->>'email');
    if length(m_name) < 2 or length(m_name) > 120 then raise exception 'Please enter each teammate''s name.'; end if;
    if m_email = me.email then raise exception 'You are already in the team as its leader. List only your teammates.'; end if;
    if m_email = any (seen) then raise exception '% is listed twice.', m_email; end if;
    seen := seen || m_email;
    insert into oc_team_members (team_id, invite_name, invite_email) values (new_id, m_name, m_email);
    perform oc_queue_email(m_email, 'team_invite',
              jsonb_build_object('name', m_name, 'team', v_name, 'code', new_code, 'leader', me.full_name));
  end loop;

  update oc_participants set category = p_category, path = 'team', updated_at = now() where user_id = uid;
  perform oc_queue_email(me.email, 'team_created', jsonb_build_object('team', v_name, 'code', new_code, 'invited', to_jsonb(seen)));
  perform oc_recheck_team(new_id);
  return oc_me();
end $$;

-- An invited teammate confirms (or declines). The invitation is tied to their
-- sign-in address, so nobody can join a team just by knowing its name or ID.
create function public.oc_respond_invite(p_member uuid, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid  uuid := oc_require_user();
  mail text := oc_email();
  inv  oc_team_members;
  t    oc_teams;
  me   oc_participants;
begin
  select * into inv from oc_team_members where id = p_member and invite_email = mail and state = 'invited' for update;
  if not found then raise exception 'That invitation isn''t available any more.'; end if;
  select * into t from oc_teams where id = inv.team_id for update;
  if t.status in ('rejected', 'cancelled') then raise exception 'That team is no longer registered.'; end if;
  perform oc_require_team_changes();

  if p_accept then
    select * into me from oc_participants where user_id = uid;
    if not found then raise exception 'Complete your own registration first, then accept the invitation.'; end if;
    perform oc_drop_solo(uid);   -- errors if already in another real team
    update oc_team_members set state = 'accepted', participant_id = uid, invite_name = me.full_name, responded_at = now()
     where id = inv.id;
    update oc_participants set category = t.category, path = 'team', updated_at = now() where user_id = uid;
    perform oc_queue_email((select email from oc_participants where user_id = t.leader_id), 'invite_accepted',
              jsonb_build_object('team', t.name, 'member', me.full_name));
    perform oc_queue_email(mail, 'membership_confirmed', jsonb_build_object('team', t.name, 'code', t.code));
  else
    update oc_team_members set state = 'declined', responded_at = now() where id = inv.id;
    perform oc_queue_email((select email from oc_participants where user_id = t.leader_id), 'invite_declined',
              jsonb_build_object('team', t.name, 'member', inv.invite_name));
  end if;

  perform oc_recheck_team(t.id);
  return oc_me();
end $$;

-- The leader's own team, checked and locked for a change
create function public.oc_leader_team(p_user uuid) returns oc_teams
language plpgsql volatile security definer set search_path = public as $$
declare t oc_teams;
begin
  select * into t from oc_teams where id = oc_my_team_id(p_user) for update;
  if not found or t.leader_id <> p_user then raise exception 'Only the team leader can do that.'; end if;
  return t;
end $$;

create function public.oc_team_invite(p_name text, p_email text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid     uuid := oc_require_user();
  t       oc_teams;
  m_name  text := btrim(coalesce(p_name, ''));
  m_email text := oc_clean_email(p_email);
begin
  perform oc_require_team_changes();
  t := oc_leader_team(uid);
  if t.solo then raise exception 'You are entered individually. Create a team to add teammates.'; end if;
  if t.status = 'approved' then raise exception 'This team is already approved. Email DES to change its members.'; end if;
  if length(m_name) < 2 or length(m_name) > 120 then raise exception 'Please enter your teammate''s name.'; end if;
  if m_email = oc_email() then raise exception 'You are already in the team.'; end if;
  if (select count(*) from oc_team_members where team_id = t.id and state in ('invited', 'accepted')) >= 3 then
    raise exception 'A team can have at most three members.';
  end if;
  if exists (select 1 from oc_team_members where team_id = t.id and invite_email = m_email and state in ('invited', 'accepted')) then
    raise exception '% is already on the team list.', m_email;
  end if;

  insert into oc_team_members (team_id, invite_name, invite_email) values (t.id, m_name, m_email);
  perform oc_queue_email(m_email, 'team_invite',
            jsonb_build_object('name', m_name, 'team', t.name, 'code', t.code,
                               'leader', (select full_name from oc_participants where user_id = uid)));
  perform oc_recheck_team(t.id);
  return oc_me();
end $$;

create function public.oc_team_remove_member(p_member uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := oc_require_user();
  t   oc_teams;
  m   oc_team_members;
begin
  perform oc_require_team_changes();
  t := oc_leader_team(uid);
  if t.status = 'approved' then raise exception 'This team is already approved. Email DES to change its members.'; end if;
  select * into m from oc_team_members where id = p_member and team_id = t.id and state in ('invited', 'accepted');
  if not found or m.role = 'leader' then raise exception 'That person can''t be removed.'; end if;
  update oc_team_members set state = 'removed', responded_at = now() where id = m.id;
  perform oc_queue_email(m.invite_email, 'removed_from_team', jsonb_build_object('team', t.name));
  perform oc_recheck_team(t.id);
  return oc_me();
end $$;

create function public.oc_leave_team() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := oc_require_user();
  t   oc_teams;
begin
  perform oc_require_team_changes();
  select * into t from oc_teams where id = oc_my_team_id(uid) for update;
  if not found then raise exception 'You are not in a team.'; end if;
  if t.leader_id = uid then raise exception 'You lead this team. Cancel the team instead, or email DES to hand it over.'; end if;
  if t.status = 'approved' then raise exception 'This team is already approved. Email DES to change its members.'; end if;
  update oc_team_members set state = 'removed', responded_at = now() where team_id = t.id and participant_id = uid and state = 'accepted';
  update oc_participants set path = 'looking', updated_at = now() where user_id = uid;
  perform oc_queue_email((select email from oc_participants where user_id = t.leader_id), 'member_left',
            jsonb_build_object('team', t.name, 'member', (select full_name from oc_participants where user_id = uid)));
  perform oc_recheck_team(t.id);
  return oc_me();
end $$;

create function public.oc_cancel_team() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := oc_require_user();
  t   oc_teams;
begin
  perform oc_require_team_changes();
  t := oc_leader_team(uid);
  if t.solo then raise exception 'To stop entering individually, change "How are you taking part?" in your registration.'; end if;
  if t.status = 'approved' then raise exception 'This team is already approved. Email DES to withdraw it.'; end if;
  perform oc_queue_email(m.invite_email, 'team_cancelled', jsonb_build_object('team', t.name))
     from oc_team_members m where m.team_id = t.id and m.state in ('invited', 'accepted') and m.role <> 'leader';
  perform oc_close_team(t.id, 'cancelled');
  update oc_participants set path = 'looking', updated_at = now() where user_id = uid;
  return oc_me();
end $$;

-- Paid-only material. The check is the verified entry, not a secret link.
create function public.oc_brief() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := oc_require_user();
begin
  if not (oc_has_entry(uid) or oc_is_admin()) then
    raise exception 'The full brief unlocks once your entry payment is verified.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'category', r.category,
                                        'title', r.title, 'body', r.body, 'url', r.url)
                     order by r.sort, r.title)
    from oc_resources r where r.published), '[]'::jsonb);
end $$;

-- One official submission per approved entry, lodged by its leader
create function public.oc_submit(p_link text, p_notes text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid    uuid := oc_require_user();
  t      oc_teams;
  v_link text := btrim(coalesce(p_link, ''));
begin
  t := oc_leader_team(uid);
  if t.status <> 'approved' then raise exception 'Only approved entries can submit.'; end if;
  if not oc_flag('submissions_open') then raise exception 'Submissions aren''t open right now.'; end if;
  if v_link !~ '^https://\S+$' or length(v_link) > 500 then raise exception 'Please paste a full https:// link to your submission.'; end if;
  update oc_submissions set link = v_link, notes = nullif(left(btrim(coalesce(p_notes, '')), 1000), ''), submitted_at = now()
   where team_id = t.id;
  return oc_me();
end $$;


-- ---------------------------------------------------- payment functions --
-- Called only by the Stripe webhook (service role), never from the website.

create function public.oc_record_payment(
  p_session text, p_intent text, p_user uuid, p_email text,
  p_quantity int, p_amount_cents int, p_currency text
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  pay_id uuid;
  mail   text := lower(p_email);
  qty    int := least(greatest(coalesce(p_quantity, 1), 1), 3);
  give_first boolean;
begin
  -- Stripe can deliver the same event more than once
  select id into pay_id from oc_payments where session_id = p_session;
  if found then return pay_id; end if;

  insert into oc_payments (provider, session_id, payment_intent, purchaser_id, purchaser_email, quantity, amount_cents, currency)
  values ('stripe', p_session, p_intent, p_user, mail, qty, coalesce(p_amount_cents, 0), coalesce(p_currency, 'aud'))
  returning id into pay_id;

  -- the buyer's own entry comes first, unless they are already covered
  give_first := not oc_email_paid(mail);
  insert into oc_entries (payment_id, seq, assigned_email)
  select pay_id, n, case when n = 1 and give_first then mail end from generate_series(1, qty) n;

  if p_user is not null then
    perform oc_claim_entry(p_user, mail);
  end if;
  perform oc_queue_email(mail, 'payment_confirmation',
            jsonb_build_object('quantity', qty, 'amount_cents', coalesce(p_amount_cents, 0), 'spare', qty - (case when give_first then 1 else 0 end)));
  perform oc_recheck_person(p_user, mail);
  return pay_id;
end $$;

-- Hold every team touched by a payment for an organiser to look at
create function public.oc_flag_payment_teams(p_payment uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare team uuid;
begin
  for team in
    select distinct m.team_id
    from oc_entries e join oc_team_members m
      on m.state in ('invited', 'accepted')
     and (m.participant_id = e.participant_id or m.invite_email = e.assigned_email)
    where e.payment_id = p_payment
  loop
    update oc_teams set review_reason = p_reason where id = team and status not in ('rejected', 'cancelled');
    perform oc_recheck_team(team);
  end loop;
end $$;

create function public.oc_record_refund(p_intent text, p_refunded_cents int, p_full boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  pay oc_payments;
  team uuid;
  affected uuid[];
begin
  select * into pay from oc_payments where payment_intent = p_intent for update;
  if not found then return; end if;

  if p_full then
    select array_agg(distinct m.team_id) into affected
    from oc_entries e join oc_team_members m
      on m.state in ('invited', 'accepted')
     and (m.participant_id = e.participant_id or m.invite_email = e.assigned_email)
    where e.payment_id = pay.id and e.status = 'valid';

    update oc_payments set status = 'refunded', refunded_cents = coalesce(p_refunded_cents, amount_cents) where id = pay.id;
    update oc_entries set status = 'void' where payment_id = pay.id;
    foreach team in array coalesce(affected, '{}') loop
      perform oc_recheck_team(team);
    end loop;
  else
    -- part refund: which entry it was for can't be known, so an organiser decides
    update oc_payments set status = 'partially_refunded', refunded_cents = coalesce(p_refunded_cents, 0) where id = pay.id;
    perform oc_flag_payment_teams(pay.id, 'Part of a payment was refunded. Check which entry it covers.');
  end if;
  perform oc_queue_email(pay.purchaser_email, 'payment_refunded', jsonb_build_object('full', p_full));
end $$;

create function public.oc_record_dispute(p_intent text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare pay oc_payments;
begin
  select * into pay from oc_payments where payment_intent = p_intent for update;
  if not found then return; end if;
  update oc_payments set status = 'disputed' where id = pay.id;
  perform oc_flag_payment_teams(pay.id, 'A payment for this team is being disputed with the bank.');
end $$;

-- Email queue, drained by the oc-mail function
create function public.oc_outbox_take(p_limit int default 20) returns setof oc_outbox
language sql volatile security definer set search_path = public as $$
  -- a failed email waits two minutes before its next try (five tries in all)
  update oc_outbox set attempts = attempts + 1, tried_at = now()
   where id in (select id from oc_outbox
                where sent_at is null and attempts < 5
                  and (tried_at is null or tried_at < now() - interval '2 minutes')
                order by id limit p_limit for update skip locked)
  returning *
$$;

create function public.oc_outbox_done(p_id bigint, p_error text default null) returns void
language sql volatile security definer set search_path = public as $$
  update oc_outbox set sent_at = case when p_error is null then now() end, error = p_error where id = p_id
$$;


-- ------------------------------------------------------ admin functions --

create function public.oc_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform oc_require_admin();
  return jsonb_build_object(
    'settings', (select jsonb_object_agg(key, value) from oc_settings),
    'admins', (select coalesce(jsonb_agg(email order by email), '[]'::jsonb) from oc_admins),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', p.full_name, 'email', p.email, 'institution', p.institution,
               'category', p.category, 'discord', p.discord, 'phone', p.phone, 'heard_from', p.heard_from,
               'path', p.path, 'registered_at', p.registered_at, 'paid', oc_has_entry(p.user_id),
               'team', (select jsonb_build_object('code', t.code, 'name', t.name, 'status', t.status, 'solo', t.solo)
                        from oc_teams t where t.id = oc_my_team_id(p.user_id)))
             order by p.registered_at)
      from oc_participants p), '[]'::jsonb),
    -- paid (or covered) but the registration form isn't filled in yet
    'unregistered', coalesce((
      select jsonb_agg(jsonb_build_object('email', x.email, 'signed_up', x.signed_up) order by x.email)
      from (
        select coalesce(e.assigned_email, lower(u.email)) as email, e.participant_id is not null as signed_up
        from oc_entries e left join auth.users u on u.id = e.participant_id
        where e.status = 'valid' and coalesce(e.assigned_email, lower(u.email)) is not null
          and not exists (select 1 from oc_participants p where p.user_id = e.participant_id)
      ) x), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'code', t.code, 'name', t.name, 'category', t.category, 'solo', t.solo,
               'size', t.size, 'status', t.status, 'review_reason', t.review_reason, 'admin_note', t.admin_note,
               'created_at', t.created_at, 'approved_at', t.approved_at,
               'members', (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', m.id, 'name', coalesce(p.full_name, m.invite_name), 'email', m.invite_email,
                             'role', m.role, 'state', m.state, 'registered', p.user_id is not null,
                             'paid', case when m.participant_id is not null then oc_has_entry(m.participant_id)
                                          else oc_email_paid(m.invite_email) end)
                           order by (m.role = 'leader') desc, m.seq), '[]'::jsonb)
                           from oc_team_members m left join oc_participants p on p.user_id = m.participant_id
                           where m.team_id = t.id and m.state in ('invited', 'accepted')))
             order by t.created_at)
      from oc_teams t), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pay.id, 'provider', pay.provider, 'purchaser', pay.purchaser_email, 'quantity', pay.quantity,
               'amount_cents', pay.amount_cents, 'refunded_cents', pay.refunded_cents, 'status', pay.status,
               'reference', coalesce(pay.payment_intent, pay.session_id), 'note', pay.note, 'created_at', pay.created_at,
               'entries', (select jsonb_agg(jsonb_build_object(
                             'id', e.id, 'status', e.status, 'assigned_email', e.assigned_email,
                             'holder', (select p.full_name from oc_participants p where p.user_id = e.participant_id),
                             'holder_email', (select lower(u.email) from auth.users u where u.id = e.participant_id))
                           order by e.seq)
                           from oc_entries e where e.payment_id = pay.id))
             order by pay.created_at)
      from oc_payments pay), '[]'::jsonb),
    -- the confidential link between teams and anonymous judging codes
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'anon_code', s.anon_code, 'team_code', t.code, 'team', t.name, 'category', t.category,
               'link', s.link, 'notes', s.notes, 'submitted_at', s.submitted_at, 'status', t.status)
             order by t.category, s.anon_code)
      from oc_submissions s join oc_teams t on t.id = s.team_id), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(to_jsonb(r) order by r.sort, r.title) from oc_resources r), '[]'::jsonb),
    'emails', jsonb_build_object(
      'waiting', (select count(*) from oc_outbox where sent_at is null and attempts < 5),
      'failed', (select count(*) from oc_outbox where sent_at is null and attempts >= 5),
      'sent', (select count(*) from oc_outbox where sent_at is not null))
  );
end $$;

-- What judges see: codes and work only, no names, teams or universities
create function public.oc_admin_judging_sheet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform oc_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('anon_code', s.anon_code, 'category', t.category, 'link', s.link, 'notes', s.notes)
                     order by t.category, s.anon_code)
    from oc_submissions s join oc_teams t on t.id = s.team_id
    where t.status = 'approved' and s.link is not null), '[]'::jsonb);
end $$;

-- approve / hold / reject / cancel a team, or clear a hold
create function public.oc_admin_set_team(p_team uuid, p_action text, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  t oc_teams;
  result text;
begin
  perform oc_require_admin();
  select * into t from oc_teams where id = p_team for update;
  if not found then raise exception 'Team not found.'; end if;

  if p_action = 'hold' then
    update oc_teams set review_reason = coalesce(nullif(btrim(p_note), ''), 'Held for review by DES.'), admin_note = p_note where id = t.id;
    result := oc_recheck_team(t.id);
  elsif p_action = 'recheck' then
    -- clears any hold; the team is approved only if every requirement is met
    update oc_teams set review_reason = null, admin_note = coalesce(p_note, admin_note) where id = t.id;
    result := oc_recheck_team(t.id);
  elsif p_action in ('reject', 'cancel') then
    perform oc_queue_email(m.invite_email, case p_action when 'reject' then 'team_rejected' else 'team_cancelled' end,
              jsonb_build_object('team', t.name, 'note', p_note))
       from oc_team_members m where m.team_id = t.id and m.state in ('invited', 'accepted');
    perform oc_close_team(t.id, case p_action when 'reject' then 'rejected' else 'cancelled' end);
    update oc_teams set admin_note = p_note where id = t.id;
    result := case p_action when 'reject' then 'rejected' else 'cancelled' end;
  elsif p_action = 'note' then
    update oc_teams set admin_note = p_note where id = t.id;
    result := t.status;
  else
    raise exception 'Unknown action.';
  end if;
  return result;
end $$;

-- Authorised team changes, including on approved teams
create function public.oc_admin_remove_member(p_member uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare m oc_team_members;
begin
  perform oc_require_admin();
  select * into m from oc_team_members where id = p_member and state in ('invited', 'accepted') for update;
  if not found then raise exception 'Member not found.'; end if;
  if m.role = 'leader' then raise exception 'Remove the other members or cancel the team instead of removing its leader.'; end if;
  update oc_team_members set state = 'removed', responded_at = now() where id = m.id;
  perform oc_queue_email(m.invite_email, 'removed_from_team',
            jsonb_build_object('team', (select name from oc_teams where id = m.team_id)));
  return oc_recheck_team(m.team_id);
end $$;

create function public.oc_admin_add_member(p_team uuid, p_name text, p_email text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  t oc_teams;
  m_email text := oc_clean_email(p_email);
begin
  perform oc_require_admin();
  select * into t from oc_teams where id = p_team for update;
  if not found or t.status in ('rejected', 'cancelled') then raise exception 'Team not found.'; end if;
  if t.solo then raise exception 'That is an individual entry.'; end if;
  if exists (select 1 from oc_team_members where team_id = t.id and invite_email = m_email and state in ('invited', 'accepted')) then
    raise exception '% is already on the team list.', m_email;
  end if;
  insert into oc_team_members (team_id, invite_name, invite_email) values (t.id, btrim(p_name), m_email);
  perform oc_queue_email(m_email, 'team_invite',
            jsonb_build_object('name', btrim(p_name), 'team', t.name, 'code', t.code,
                               'leader', (select full_name from oc_participants where user_id = t.leader_id)));
  return oc_recheck_team(t.id);
end $$;

-- An entry paid outside Stripe (e.g. a sponsored place). Recorded as a manual payment.
create function public.oc_admin_grant_entry(p_email text, p_note text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  mail text := oc_clean_email(p_email);
  pay_id uuid;
  target uuid;
begin
  perform oc_require_admin();
  if oc_email_paid(mail) then raise exception '% already has a paid entry.', mail; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Add a note saying why this entry is being granted.'; end if;
  insert into oc_payments (provider, purchaser_email, quantity, note)
  values ('manual', oc_email(), 1, btrim(p_note)) returning id into pay_id;
  insert into oc_entries (payment_id, seq, assigned_email) values (pay_id, 1, mail);
  select u.id into target from auth.users u where lower(u.email) = mail and u.email_confirmed_at is not null;
  if target is not null then perform oc_claim_entry(target, mail); end if;
  perform oc_queue_email(mail, 'entry_assigned', jsonb_build_object('from', 'DES'));
  perform oc_recheck_person(target, mail);
  return pay_id;
end $$;

-- Cancel one entry (e.g. after a part refund), or move an unused one
create function public.oc_admin_void_entry(p_entry uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare e oc_entries;
begin
  perform oc_require_admin();
  select * into e from oc_entries where id = p_entry for update;
  if not found then raise exception 'Entry not found.'; end if;
  update oc_entries set status = 'void' where id = e.id;
  perform oc_recheck_person(e.participant_id, e.assigned_email);
end $$;

create function public.oc_admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform oc_require_admin();
  if p_key not in ('registration_open', 'price_cents', 'team_changes_open', 'submissions_open', 'discord_invite', 'team_finder_url') then
    raise exception 'Unknown setting.';
  end if;
  if p_key = 'price_cents' and (jsonb_typeof(p_value) <> 'number' or (p_value::text)::numeric not between 100 and 100000) then
    raise exception 'The price must be between $1 and $1000.';
  end if;
  update oc_settings set value = p_value where key = p_key;
end $$;

create function public.oc_admin_save_resource(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare rid uuid := nullif(p->>'id', '')::uuid;
begin
  perform oc_require_admin();
  if nullif(btrim(coalesce(p->>'title', '')), '') is null then raise exception 'Give it a title.'; end if;
  if rid is null then
    insert into oc_resources (kind, category, title, body, url, sort, published)
    values (coalesce(p->>'kind', 'resource'), nullif(p->>'category', ''), btrim(p->>'title'), p->>'body',
            nullif(btrim(coalesce(p->>'url', '')), ''), coalesce((p->>'sort')::int, 0), coalesce((p->>'published')::boolean, true))
    returning id into rid;
  else
    update oc_resources set kind = coalesce(p->>'kind', kind), category = nullif(p->>'category', ''),
           title = btrim(p->>'title'), body = p->>'body', url = nullif(btrim(coalesce(p->>'url', '')), ''),
           sort = coalesce((p->>'sort')::int, sort), published = coalesce((p->>'published')::boolean, published)
     where id = rid;
  end if;
  return rid;
end $$;

create function public.oc_admin_delete_resource(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform oc_require_admin();
  delete from oc_resources where id = p_id;
end $$;

-- Nudge everyone whose registration or team is still incomplete
create function public.oc_admin_send_reminders() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int := 0; k int;
begin
  perform oc_require_admin();

  -- invited but not yet confirmed / not yet paid
  perform oc_queue_email(m.invite_email, 'reminder_team',
            jsonb_build_object('team', t.name, 'code', t.code,
              'needs_payment', not (case when m.participant_id is not null then oc_has_entry(m.participant_id) else oc_email_paid(m.invite_email) end),
              'needs_confirmation', m.state <> 'accepted'))
     from oc_team_members m join oc_teams t on t.id = m.team_id
    where m.state in ('invited', 'accepted') and t.status in ('pending_payment', 'pending_confirmation', 'draft')
      and (m.state <> 'accepted'
           or not (case when m.participant_id is not null then oc_has_entry(m.participant_id) else oc_email_paid(m.invite_email) end));
  get diagnostics k = row_count; n := n + k;

  -- registered, not in any team yet
  perform oc_queue_email(p.email, 'reminder_no_team', jsonb_build_object('name', p.full_name, 'paid', oc_has_entry(p.user_id)))
     from oc_participants p where oc_my_team_id(p.user_id) is null;
  get diagnostics k = row_count; n := n + k;

  -- paid, registration form not filled in
  perform oc_queue_email(coalesce(e.assigned_email, lower(u.email)), 'reminder_register', '{}')
     from oc_entries e left join auth.users u on u.id = e.participant_id
    where e.status = 'valid' and coalesce(e.assigned_email, lower(u.email)) is not null
      and not exists (select 1 from oc_participants p where p.user_id = e.participant_id);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;


-- ------------------------------------------------------ Google Sheet feed --
-- Everything the DES spreadsheet shows, as ready-made rows (first row = headings).
-- Called only by the oc-sheet function. Anonymous judging codes are left out
-- on purpose: the link between codes and teams stays in the dashboard.

create function public.oc_sheet_export() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'Summary', jsonb_build_array(
      jsonb_build_array('OPEN CITY 2027', 'Count'),
      jsonb_build_array('Paid participants', (select count(*) from oc_participants p where oc_has_entry(p.user_id))),
      jsonb_build_array('Valid entries sold', (select count(*) from oc_entries where status = 'valid')),
      jsonb_build_array('Registrations complete', (select count(*) from oc_participants)),
      jsonb_build_array('Registered but not paid', (select count(*) from oc_participants p where not oc_has_entry(p.user_id))),
      jsonb_build_array('Paid but not registered', (select count(*) from oc_entries e where e.status = 'valid' and (e.assigned_email is not null or e.participant_id is not null)
                                                       and not exists (select 1 from oc_participants p where p.user_id = e.participant_id))),
      jsonb_build_array('Looking for teammates', (select count(*) from oc_participants p where p.path = 'looking' and oc_my_team_id(p.user_id) is null)),
      jsonb_build_array('Approved entries', (select count(*) from oc_teams where status = 'approved')),
      jsonb_build_array('Approved: individual', (select count(*) from oc_teams where status = 'approved' and solo)),
      jsonb_build_array('Approved: teams of 2', (select count(*) from oc_teams where status = 'approved' and not solo and size = 2)),
      jsonb_build_array('Approved: teams of 3', (select count(*) from oc_teams where status = 'approved' and not solo and size = 3)),
      jsonb_build_array('Entries still pending', (select count(*) from oc_teams where status in ('draft', 'pending_payment', 'pending_confirmation', 'pending_review')))
    ),
    'Participants', jsonb_build_array(jsonb_build_array(
        'Name', 'Email', 'Phone', 'Institution', 'Category', 'Discord', 'Taking part', 'Paid', 'Paid by',
        'Team', 'Team ID', 'Team status', 'Registered', 'Heard from'))
      || coalesce((
        select jsonb_agg(jsonb_build_array(
                 p.full_name, p.email, coalesce(p.phone, ''), p.institution, p.category, p.discord, p.path,
                 case when oc_has_entry(p.user_id) then 'yes' else 'no' end,
                 coalesce((select pay.purchaser_email from oc_entries e join oc_payments pay on pay.id = e.payment_id
                           where e.participant_id = p.user_id and e.status = 'valid'), ''),
                 coalesce(t.name, ''), coalesce(t.code, ''), coalesce(t.status, ''),
                 to_char(p.registered_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD HH24:MI'), coalesce(p.heard_from, ''))
               order by p.registered_at)
        from oc_participants p left join oc_teams t on t.id = oc_my_team_id(p.user_id)), '[]'::jsonb),
    'Teams', jsonb_build_array(jsonb_build_array(
        'Team ID', 'Team', 'Category', 'Type', 'Status', 'Held because', 'Member', 'Email', 'Role', 'Confirmed', 'Registered', 'Paid'))
      || coalesce((
        select jsonb_agg(jsonb_build_array(
                 t.code, t.name, t.category, case when t.solo then 'individual' else 'team' end, t.status, coalesce(t.review_reason, ''),
                 coalesce(p.full_name, m.invite_name), m.invite_email, m.role,
                 case when m.state = 'accepted' then 'yes' else 'no' end,
                 case when p.user_id is not null then 'yes' else 'no' end,
                 case when (case when m.participant_id is not null then oc_has_entry(m.participant_id) else oc_email_paid(m.invite_email) end) then 'yes' else 'no' end)
               order by t.created_at, (m.role = 'leader') desc, m.seq)
        from oc_teams t join oc_team_members m on m.team_id = t.id and m.state in ('invited', 'accepted')
        left join oc_participants p on p.user_id = m.participant_id), '[]'::jsonb),
    'Payments', jsonb_build_array(jsonb_build_array(
        'Date', 'Paid by', 'Method', 'Entries bought', 'Amount', 'Refunded', 'Payment status', 'Reference',
        'Entry', 'Entry status', 'Covers (name)', 'Covers (email)'))
      || coalesce((
        select jsonb_agg(jsonb_build_array(
                 to_char(pay.created_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD HH24:MI'), pay.purchaser_email, pay.provider, pay.quantity,
                 round(pay.amount_cents / 100.0, 2), round(pay.refunded_cents / 100.0, 2), pay.status,
                 coalesce(pay.payment_intent, pay.session_id, pay.note, ''),
                 e.seq, e.status, coalesce(p.full_name, ''),
                 coalesce(lower(u.email), e.assigned_email, case when e.status = 'valid' then '(not assigned yet)' else '' end))
               order by pay.created_at, e.seq)
        from oc_payments pay join oc_entries e on e.payment_id = pay.id
        left join auth.users u on u.id = e.participant_id
        left join oc_participants p on p.user_id = e.participant_id), '[]'::jsonb)
  )
$$;


-- ----------------------------------------------------------- permissions --

-- Supabase lets every role run new functions by default. Take that away for
-- all of ours (the helpers must never be callable from the website), then
-- hand back only the ones meant for each role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'oc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

-- the website (signed-in people)
grant execute on function
  public.oc_me(), public.oc_save_registration(jsonb), public.oc_assign_entry(uuid, text),
  public.oc_create_team(text, text, jsonb), public.oc_respond_invite(uuid, boolean),
  public.oc_team_invite(text, text), public.oc_team_remove_member(uuid), public.oc_leave_team(),
  public.oc_cancel_team(), public.oc_brief(), public.oc_submit(text, text),
  public.oc_admin_data(), public.oc_admin_judging_sheet(), public.oc_admin_set_team(uuid, text, text),
  public.oc_admin_remove_member(uuid), public.oc_admin_add_member(uuid, text, text),
  public.oc_admin_grant_entry(text, text), public.oc_admin_void_entry(uuid),
  public.oc_admin_set_setting(text, jsonb), public.oc_admin_save_resource(jsonb),
  public.oc_admin_delete_resource(uuid), public.oc_admin_send_reminders()
to authenticated;

-- the Stripe webhook and the mailer
grant execute on function
  public.oc_record_payment(text, text, uuid, text, int, int, text),
  public.oc_record_refund(text, int, boolean), public.oc_record_dispute(text),
  public.oc_outbox_take(int), public.oc_outbox_done(bigint, text),
  public.oc_setting(text), public.oc_flag(text), public.oc_sheet_export()
to service_role;


-- ------------------------------------------------------- starter content --
-- Placeholders so the participant area isn't empty. Replace them in the
-- admin dashboard (Brief tab) before registration opens.

insert into public.oc_resources (kind, category, title, body, sort) values
  ('brief',      null,           'Competition brief',        'Placeholder: the full OPEN CITY 2027 brief goes here.', 10),
  ('challenge',  'architecture', 'Architecture challenge',   'Placeholder: the Architecture design challenge goes here.', 20),
  ('challenge',  'uiux',         'UI/UX Design challenge',   'Placeholder: the UI/UX Design challenge goes here.', 21),
  ('challenge',  'graphic',      'Graphic Design challenge', 'Placeholder: the Graphic Design challenge goes here.', 22),
  ('rules',      null,           'Rules and guidelines',     'Placeholder: the official rules and guidelines go here.', 30),
  ('submission', null,           'Submission requirements',  'Placeholder: what to submit, in what format, and by when.', 40);
