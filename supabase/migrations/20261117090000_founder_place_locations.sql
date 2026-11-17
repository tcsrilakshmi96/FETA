-- Where the founder's places are, so Feta Picks are the ones near the
-- person, not anywhere in the city (founder, 17 Nov 2026). Google allows a
-- place's latitude and longitude to be kept for up to 30 days: Feta looks
-- them up when they're missing or older than 25 days, and forgets any
-- older than 30 days every night. Nothing else from Google is kept.
alter table public.founder_places
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists located_at timestamptz;

-- The server fills in locations it has just looked up, as the signed-in
-- person. Only empty or old ones can be written, so a location can't be
-- changed again until it's due.
create or replace function public.locate_founder_places(p_places jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.founder_places f
  set lat = (x ->> 'lat')::double precision,
      lng = (x ->> 'lng')::double precision,
      located_at = now()
  from jsonb_array_elements(p_places) x
  where f.place_id = x ->> 'place_id'
    and (f.located_at is null or f.located_at < now() - interval '25 days')
    and abs((x ->> 'lat')::double precision) <= 90
    and abs((x ->> 'lng')::double precision) <= 180;
$$;

revoke all on function public.locate_founder_places(jsonb) from public;
grant execute on function public.locate_founder_places(jsonb) to authenticated;

-- Forget locations older than 30 days, every night.
create extension if not exists pg_cron;
select cron.schedule(
  'forget-old-place-locations',
  '30 3 * * *',
  $$update public.founder_places set lat = null, lng = null, located_at = null where located_at < now() - interval '30 days'$$
);
