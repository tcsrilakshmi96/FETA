-- What each place on Feta's lists is (founder, 24 Nov 2026: Jeremy in New
-- York loved Mexican food and live music, and Tacocina, Birdland and Smalls
-- were never checked, because Feta guessed from the name). Each of her
-- places and each local favourite gets several short tags in Feta's own
-- words ("mexican", "tacos", "live_music", "jazz club"), written by Claude,
-- never Google's words. Feta checks the list places whose tags match what a
-- person wants. Safe to run more than once.
alter table public.founder_places add column if not exists tags text[] not null default '{}';

-- List places, for tagging from Feta's server key (a city, or every city;
-- untagged only unless asked).
create or replace function public.list_places_for_tags(p_key text, p_city text default null, p_all boolean default false)
returns table (place_id text, name text, kind text, source text, city_id text, city_name text, note text, tags text[])
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  return query
    select f.place_id, f.name, f.kind, f.source, f.city_id, f.city_name, f.note, f.tags
    from founder_places f
    where f.active and (p_city is null or f.city_id = p_city) and (p_all or cardinality(f.tags) = 0)
    order by f.city_id, f.name;
end;
$$;
revoke all on function public.list_places_for_tags(text, text, boolean) from public;
grant execute on function public.list_places_for_tags(text, text, boolean) to anon, authenticated;

-- Save tags: [{"place_id": ..., "tags": [...]}], at most 12 short tags each.
create or replace function public.set_place_tags(p_key text, p_places jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  update founder_places f
  set tags = (
    select coalesce(array_agg(distinct lower(left(trim(t), 40))), '{}')
    from (select t from jsonb_array_elements_text(x -> 'tags') t limit 12) s
    where trim(t) <> ''
  )
  from jsonb_array_elements(p_places) x
  where f.place_id = x ->> 'place_id';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.set_place_tags(text, jsonb) from public;
grant execute on function public.set_place_tags(text, jsonb) to anon, authenticated;
