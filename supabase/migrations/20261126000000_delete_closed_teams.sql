-- OPEN CITY: let organisers delete cancelled or rejected teams.
--
-- For a database that is already set up: paste this into Supabase's SQL
-- editor and run it once. (A fresh setup gets the same function from
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

revoke all on function public.oc_admin_delete_team(uuid) from public, anon, authenticated;
grant execute on function public.oc_admin_delete_team(uuid) to authenticated;
