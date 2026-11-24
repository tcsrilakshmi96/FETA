-- Audit round 4 (24 Nov 2026). The three audits kept finding the same
-- kinds of problem; these close them as a kind, not one at a time.

-- 1. A share holds only what Feta made, checked against Feta's own records:
--    every event Feta finds is remembered for good (found_events, written
--    only by the server), so a share of one is checked against it even after
--    the city's search ran again; her note must be her note on her place;
--    the title is a day or a date. Nothing a person types reaches a share page.
create table if not exists public.found_events (
  url text not null,
  title text not null,
  venue_name text not null default '',
  event_date text not null default '',
  found_at timestamptz not null default now(),
  primary key (url, title)
);
alter table public.found_events enable row level security;
insert into public.found_events (url, title, venue_name, event_date)
select left(e ->> 'url', 600), left(coalesce(e ->> 'title', ''), 200), left(coalesce(e ->> 'venueName', ''), 200), left(coalesce(e ->> 'date', ''), 20)
from public.events_cache c, jsonb_array_elements(case when jsonb_typeof(c.events) = 'array' then c.events else '[]'::jsonb end) e
where jsonb_typeof(e) = 'object' and coalesce(e ->> 'url', '') ~ '^https?://' and coalesce(e ->> 'title', '') <> ''
on conflict (url, title) do nothing;

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
  where jsonb_typeof(e) = 'object' and coalesce(e ->> 'url', '') ~ '^https?://' and coalesce(e ->> 'title', '') <> ''
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
      or (st ? 'fetaNote' and coalesce(st ->> 'fetaNote', '') <> '' and not exists (select 1 from founder_places f where f.place_id = st ->> 'placeId' and f.note = st ->> 'fetaNote'))
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
        or not exists (select 1 from found_events f where f.url = ev ->> 'url' and f.title = coalesce(ev ->> 'title', '') and f.venue_name = coalesce(ev ->> 'venueName', '')) then
        raise exception 'Bad share';
      end if;
    elsif not (coalesce(st ->> 'placeId', '') ~ '^[A-Za-z0-9_.-]+$' and length(st ->> 'placeId') between 10 and 300) then
      raise exception 'Bad share';
    end if;
  end loop;
  return new;
end;
$$;

-- 2. A typed brand: private until Admin approves it, even if the person who
--    typed it deletes their account; visible to anyone who has it in their
--    usual brands (a second person typing the same brand broke Brands for
--    them); research that finds it makes it everyone's.
alter table public.brands add column if not exists private boolean not null default false;
alter table public.brand_markets add column if not exists private boolean not null default false;
update public.brands set private = true where added_by is not null;
update public.brand_markets set private = true where added_by is not null;
drop policy if exists "read brands" on public.brands;
create policy "read brands" on public.brands for select to authenticated
  using (not private or added_by = auth.uid() or public.is_admin() or exists (select 1 from public.loved_brands l where l.brand_id = brands.id and l.user_id = auth.uid()));
drop policy if exists "read brand markets" on public.brand_markets;
create policy "read brand markets" on public.brand_markets for select to authenticated
  using (not private or added_by = auth.uid() or public.is_admin());

create or replace function public.save_brand_lookup(p_key text, p_country text, p_row jsonb, p_styles text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid;
  s text;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into brands (name, name_key, website, instagram, origin_country, wears, label_type, added_by, private)
  values (p_row->>'brand_name', p_row->>'name_key', p_row->>'website', p_row->>'instagram', p_row->>'origin_country', p_row->>'wears', p_row->>'label_type', auth.uid(), true)
  on conflict (name_key) do update set website = coalesce(brands.website, excluded.website)
  returning id into b;
  if p_row->>'presence_type' is not null then
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, checked_date, added_by, private)
    values (b, p_country, p_row->>'presence_type', coalesce(p_row->>'presence_url', p_row->>'website'), nullif(p_row->>'price_feel', ''), current_date, auth.uid(), true)
    on conflict (brand_id, country) do nothing;
  end if;
  foreach s in array p_styles loop
    if exists (select 1 from style_lenses where style_id = s) then
      insert into brand_styles (brand_id, style_id, association, visible_cues, collection_url, confidence, found_by, review_status, added_by, checked_date)
      values (b, s, 'adjacent', coalesce(p_row->>'visible_cues', '—'), p_row->>'website', 'written_evidence_only', 'lookup', 'proposed', auth.uid(), current_date)
      on conflict (brand_id, style_id) do nothing;
    end if;
  end loop;
  return b;
end;
$$;

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
    on conflict (brand_id, country) do nothing;
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

create or replace function public.brand_lookup_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.found_by = 'lookup' and new.review_status = 'approved' and old.review_status is distinct from 'approved' then
    update brands set added_by = null, private = false where id = new.brand_id;
    update brand_markets set added_by = null, private = false where brand_id = new.brand_id;
  end if;
  return new;
end;
$$;
