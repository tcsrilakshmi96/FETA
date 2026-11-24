-- Audit round 5 (24 Nov 2026): what the fourth audits left.

-- 1. A share's "★ Feta pick" only on her own places; an event's day as Feta
--    found it; an event stop's id is its own link.
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

-- 2. Research that finds a brand someone typed makes it everyone's in that
--    country too (the market row from the lookup stayed private).
create or replace function public.save_style_research(p_key text, p_country text, p_style text, p_rows jsonb, p_search_html text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  b uuid;
  n int := 0;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into brands (name, name_key, website, instagram, origin_country, wears, label_type)
    values (r->>'brand_name', r->>'name_key', r->>'website', r->>'instagram', r->>'origin_country', r->>'wears', r->>'label_type')
    on conflict (name_key) do update set private = false, added_by = null, website = coalesce(brands.website, excluded.website), instagram = coalesce(brands.instagram, excluded.instagram)
    returning id into b;
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, sample_price, sample_currency, sample_item, checked_date)
    values (b, p_country, r->>'presence_type', r->>'presence_url', nullif(r->>'price_feel', ''), (r->>'sample_price')::numeric, r->>'sample_currency', r->>'sample_item', current_date)
    on conflict (brand_id, country) do update set private = false, added_by = null;
    insert into brand_styles (brand_id, style_id, association, visible_cues, collection_url, editorial_url, similar_reference, confidence, found_by, checked_date)
    values (b, p_style, r->>'association', r->>'visible_cues', r->>'collection_url', r->>'editorial_url', r->>'similar_reference', r->>'confidence', 'feta', current_date)
    on conflict (brand_id, style_id) do update set visible_cues = excluded.visible_cues, collection_url = excluded.collection_url, checked_date = excluded.checked_date
      where brand_styles.review_status = 'proposed';
    n := n + 1;
  end loop;
  insert into style_research (country, style_id, found, search_html, done) values (p_country, p_style, n, p_search_html, true)
  on conflict (country, style_id) do update set researched_at = now(), found = excluded.found, search_html = excluded.search_html, done = true;
  return n;
end;
$$;

-- 3. The share functions friends use without an account: given to exactly
--    those who use them, not to every role by default.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_share', 'cast_vote', 'share_votes_for', 'my_share_replies')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
