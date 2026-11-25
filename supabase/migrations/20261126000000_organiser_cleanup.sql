-- OPEN CITY: organiser clean-up tools for the dashboard
--   * delete cancelled or rejected teams (Teams tab)
--   * remove a participant (Participants tab)
--
-- For a database that is already set up: paste this into Supabase's SQL
-- editor and run it once. (A fresh setup gets the same functions from
-- 20261119000000_open_city.sql; running this file afterwards is harmless.)

create or replace function public.oc_admin_delete_team(p_team uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  t oc_teams;
begin
  perform oc_require_admin();
  select * into t from oc_teams where id = p_team for update;
  if not found then raise exception 'Team not found.'; end if;
  if t.status not in ('rejected', 'cancelled') then
    raise exception 'Only cancelled or rejected teams can be deleted. Cancel the team first.';
  end if;
  delete from oc_submissions where team_id = t.id;
  delete from oc_team_members where team_id = t.id;
  delete from oc_teams where id = t.id;
end $$;

create or replace function public.oc_admin_remove_participant(p_user uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  p oc_participants;
  m oc_team_members;
  t oc_teams;
  others int;
begin
  perform oc_require_admin();
  select * into p from oc_participants where user_id = p_user for update;
  if not found then raise exception 'Participant not found.'; end if;

  select * into m from oc_team_members
   where participant_id = p_user and state = 'accepted' for update;
  if found then
    select * into t from oc_teams where id = m.team_id for update;
    if m.role = 'leader' then
      select count(*) into others from oc_team_members
       where team_id = t.id and id <> m.id and state in ('invited', 'accepted');
      if others > 0 then
        raise exception 'They lead team "%". Cancel that team (or remove its other members) first.', t.name;
      end if;
      perform oc_close_team(t.id, 'cancelled');
    else
      update oc_team_members set state = 'removed', responded_at = now() where id = m.id;
      perform oc_recheck_team(t.id);
    end if;
  end if;

  delete from oc_participants where user_id = p_user;
  return p.full_name;
end $$;

revoke all on function public.oc_admin_delete_team(uuid) from public, anon, authenticated;
revoke all on function public.oc_admin_remove_participant(uuid) from public, anon, authenticated;
grant execute on function public.oc_admin_delete_team(uuid), public.oc_admin_remove_participant(uuid) to authenticated;
