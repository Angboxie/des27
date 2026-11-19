-- Diagnostic: tries to save a registration as the most recently signed-in
-- person, the same way the website does, and reports exactly what failed.
-- NOTHING IS SAVED: it always ends with an "error" that carries the report
-- and undoes everything it did.

do $$
declare
  who     record;
  report  text := '';
  path    text;
  detail  text;
begin
  select id, email into who from auth.users order by last_sign_in_at desc nulls last limit 1;
  if who.id is null then raise exception 'No one has signed in yet.'; end if;

  perform set_config('request.jwt.claim.sub', who.id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  foreach path in array array['looking', 'team', 'solo'] loop
    begin
      perform public.oc_save_registration(jsonb_build_object(
        'full_name', 'Diagnostic Test', 'institution', 'RMIT University', 'category', 'architecture',
        'discord', 'diagnostic', 'path', path, 'rules_accepted', true));
      report := report || format(E'\n[%s] OK', path);
    exception when others then
      get stacked diagnostics detail = pg_exception_context;
      report := report || format(E'\n[%s] FAILED %s: %s\n    where: %s', path, sqlstate, sqlerrm, detail);
    end;
  end loop;

  raise exception E'DIAGNOSTIC REPORT for % (nothing was saved):%', who.email, report;
end $$;
