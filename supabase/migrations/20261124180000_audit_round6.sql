-- Audit round 6 (24 Nov 2026): a share's event link is never one of
-- Google's own addresses (some redirect anywhere), Feta's record of found
-- events keeps only https links that aren't Google's, and an event's date
-- and time on a share are a real date and time.
delete from public.found_events where url !~ '^https://' or url ~* '^https://([^/]*[.@])?(google\.[a-z.]+|vertexaisearch\.cloud\.google\.com)(/|:|$)';

create or replace function public.save_events_cache(p_key text, p_cache_key text, p_events jsonb, p_html text, p_hours numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into events_cache (key, events, search_html, expires_at)
  values (left(p_cache_key, 300), coalesce(p_events, '[]'::jsonb), coalesce(p_html, ''), now() + make_interval(secs => (least(greatest(coalesce(p_hours, 0), 0), case when p_cache_key like '%|venue|%' then 720 else 48 end) * 3600)::double precision))
  on conflict (key) do update set events = excluded.events, search_html = excluded.search_html, expires_at = excluded.expires_at;
  -- Every event Feta finds is remembered for good (a share of it is checked
  -- against this, even after the city's search was run again).
  insert into found_events (url, title, venue_name, event_date)
  select left(e ->> 'url', 600), left(coalesce(e ->> 'title', ''), 200), left(coalesce(e ->> 'venueName', ''), 200), left(coalesce(e ->> 'date', ''), 20)
  from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object' and coalesce(e ->> 'url', '') ~ '^https://' and coalesce(e ->> 'url', '') !~* '^https://([^/]*[.@])?(google\.[a-z.]+|vertexaisearch\.cloud\.google\.com)(/|:|$)' and coalesce(e ->> 'title', '') <> ''
  on conflict (url, title) do nothing;
end;
$$;

create or replace function public.check_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  ev jsonb;
  opt jsonb;
  stops jsonb;
  part jsonb;
begin
  if tg_op = 'INSERT' then
    new.slug := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  else
    new.slug := old.slug;
    new.user_id := old.user_id;
    new.kind := old.kind;
    new.created_at := old.created_at;
    -- Marking replies seen leaves an older share as it was.
    if new.payload is not distinct from old.payload then
      return new;
    end if;
  end if;
  if jsonb_typeof(new.payload) <> 'object' or pg_column_size(new.payload) > 20000 then raise exception 'Bad share'; end if;
  stops := coalesce(new.payload -> 'stops', '[]'::jsonb);
  if jsonb_typeof(stops) <> 'array' or jsonb_typeof(coalesce(new.payload -> 'options', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(new.payload -> 'options', '[]'::jsonb)) > 3 then
    raise exception 'Bad share';
  end if;
  -- The share itself and each of its options: title, stops, travel, country.
  for part in select new.payload union all select * from jsonb_array_elements(coalesce(new.payload -> 'options', '[]'::jsonb)) loop
    if jsonb_typeof(part) <> 'object'
      or exists (select 1 from jsonb_object_keys(part) k where k not in ('title', 'stops', 'travel', 'country', 'options'))
      or (part <> new.payload and part ? 'options')
      -- A day or a date, as the app writes it: short, no links or long numbers.
      or coalesce(part ->> 'title', '') !~ '^[[:alpha:][:digit:] ·,:–''-]{0,40}$' or coalesce(part ->> 'title', '') ~ '[0-9]{5}'
      or coalesce(part ->> 'country', '') !~ '^[A-Z]{0,3}$' then
      raise exception 'Bad share';
    end if;
    if part ? 'travel' and (jsonb_typeof(part -> 'travel') <> 'object'
      or exists (select 1 from jsonb_object_keys(part -> 'travel') k where k not in ('km', 'minutes', 'mode'))
      or coalesce(part #>> '{travel,mode}', 'walk') not in ('walk', 'ride')
      or jsonb_typeof(coalesce(part #> '{travel,km}', '0'::jsonb)) <> 'number' or jsonb_typeof(coalesce(part #> '{travel,minutes}', '0'::jsonb)) <> 'number') then
      raise exception 'Bad share';
    end if;
    if part <> new.payload then
      if jsonb_typeof(coalesce(part -> 'stops', '[]'::jsonb)) <> 'array' then raise exception 'Bad share'; end if;
      stops := stops || coalesce(part -> 'stops', '[]'::jsonb);
    end if;
  end loop;
  if jsonb_array_length(stops) > 18 then raise exception 'Bad share'; end if;
  for st in select * from jsonb_array_elements(stops) loop
    if jsonb_typeof(st) <> 'object'
      or exists (select 1 from jsonb_object_keys(st) k where k not in ('placeId', 'kind', 'time', 'fetaNote', 'event'))
      -- Her note only as she wrote it, on her own place.
      or (st ? 'fetaNote' and not exists (select 1 from founder_places f where f.place_id = st ->> 'placeId' and f.source = 'founder' and (coalesce(st ->> 'fetaNote', '') = '' or f.note = st ->> 'fetaNote')))
      or length(coalesce(st ->> 'kind', '')) > 12 or length(coalesce(st ->> 'time', '')) > 40
      or length(coalesce(st ->> 'because', '')) > 200 or length(coalesce(st ->> 'fetaNote', '')) > 1000 then
      raise exception 'Bad share';
    end if;
    if st ? 'event' then
      ev := st -> 'event';
      if jsonb_typeof(ev) <> 'object'
        or exists (select 1 from jsonb_object_keys(ev) k where k not in ('title', 'venueName', 'date', 'time', 'url', 'site'))
        or coalesce(ev ->> 'url', '') !~ '^https?://' or length(ev ->> 'url') > 600
        or length(coalesce(ev ->> 'title', '')) > 200 or length(coalesce(ev ->> 'venueName', '')) > 200
        or length(coalesce(ev ->> 'date', '')) > 20 or length(coalesce(ev ->> 'time', '')) > 10 or length(coalesce(ev ->> 'site', '')) > 60
        -- A real date and time, never words (security audit, 24 Nov 2026).
        or coalesce(ev ->> 'date', '') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' or coalesce(ev ->> 'time', '') !~ '^([0-9]{2}:[0-9]{2})?$'
        or (ev ->> 'url') ~* '^https?://([^/]*[.@])?(google\.[a-z.]+|vertexaisearch\.cloud\.google\.com)(/|:|$)'
        or coalesce(ev ->> 'site', '') !~ '^[[:alpha:][:digit:] .&''-]{0,60}$'
        -- An event Feta found, as Feta found it (title and venue too).
        or st ->> 'placeId' is distinct from 'event:' || (ev ->> 'url')
        or not exists (select 1 from found_events f where f.url = ev ->> 'url' and f.title = coalesce(ev ->> 'title', '') and f.venue_name = coalesce(ev ->> 'venueName', '')
          and (coalesce(ev ->> 'date', '') = '' or f.event_date = '' or f.event_date = ev ->> 'date')) then
        raise exception 'Bad share';
      end if;
    elsif not (coalesce(st ->> 'placeId', '') ~ '^[A-Za-z0-9_.-]+$' and length(st ->> 'placeId') between 10 and 300) then
      raise exception 'Bad share';
    end if;
  end loop;
  return new;
end;
$$;
