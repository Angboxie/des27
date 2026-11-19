-- DES OPEN CITY 2027 - feed for the DES Google Sheet
--
-- The sheet's script reads the registrations through oc_sheet_feed, which
-- needs a long secret that only the sheet holds. It is read-only: the sheet
-- can never change a registration. Running this file prints the secret once
-- at the end; paste it into the sheet (menu OPEN CITY > Connect).
--
-- To cut off a sheet (e.g. it was shared too widely), run:
--   delete from oc_private where key = 'sheet_token';
-- and then run this file again for a new secret.

create table if not exists public.oc_private (
  key   text primary key,
  value text not null
);
alter table public.oc_private enable row level security;
revoke all on public.oc_private from anon, authenticated;

create or replace function public.oc_sheet_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare expected text;
begin
  select value into expected from oc_private where key = 'sheet_token';
  if expected is null or p_token is null or length(p_token) < 40 or p_token <> expected then
    raise exception 'Not allowed.';
  end if;
  return oc_sheet_export();
end $$;

revoke all on function public.oc_sheet_feed(text) from public, authenticated;
grant execute on function public.oc_sheet_feed(text) to anon;

insert into public.oc_private (key, value)
values ('sheet_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

select value as "Secret for the Google Sheet (copy this)" from public.oc_private where key = 'sheet_token';
