-- Audit round 3 (24 Nov 2026): the second security, tech and cost audits.

-- 1. Shares hold only what Feta made (security re-audit: the first check
--    could be got round by writing a made-up event into one's own pick set,
--    by changing a share's kind after it was checked, or through fields it
--    didn't look at). Every key is on a list with a length cap, both a
--    share's stops and its options' stops are checked whatever its kind, an
--    event's link must be one Feta found (the shared events cache, which
--    only Feta's server writes), and Feta picks the link's name.
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
      or length(coalesce(part ->> 'title', '')) > 120 or length(coalesce(part ->> 'country', '')) > 3 then
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
      or exists (select 1 from jsonb_object_keys(st) k where k not in ('placeId', 'kind', 'time', 'because', 'fetaNote', 'event'))
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
        or not exists (select 1 from events_cache e where e.events @> jsonb_build_array(jsonb_build_object('url', ev ->> 'url'))) then
        raise exception 'Bad share';
      end if;
    elsif not (coalesce(st ->> 'placeId', '') ~ '^[A-Za-z0-9_.-]+$' and length(st ->> 'placeId') between 10 and 300) then
      raise exception 'Bad share';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists check_share on public.shares;
create trigger check_share before insert or update on public.shares for each row execute function public.check_share();

-- 2. A typed brand stays theirs until Admin approves it, everywhere: the
--    brand itself and where it's sold too (security re-audit: the brand's
--    name, logo and a new country's market showed to everyone). Tags 3
--    people agreed on show to no one until reviewed.
alter table public.brands add column if not exists added_by uuid references auth.users (id) on delete set null;
alter table public.brand_markets add column if not exists added_by uuid references auth.users (id) on delete set null;
drop policy if exists "read brands" on public.brands;
create policy "read brands" on public.brands for select to authenticated using (added_by is null or added_by = auth.uid() or public.is_admin());
drop policy if exists "read brand markets" on public.brand_markets;
create policy "read brand markets" on public.brand_markets for select to authenticated using (added_by is null or added_by = auth.uid() or public.is_admin());
drop policy if exists "read brand styles" on public.brand_styles;
create policy "read brand styles" on public.brand_styles for select to authenticated
  using ((review_status <> 'rejected' and (found_by not in ('lookup', 'people') or review_status = 'approved' or added_by = auth.uid())) or public.is_admin());

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
  insert into brands (name, name_key, website, instagram, origin_country, wears, label_type, added_by)
  values (p_row->>'brand_name', p_row->>'name_key', p_row->>'website', p_row->>'instagram', p_row->>'origin_country', p_row->>'wears', p_row->>'label_type', auth.uid())
  on conflict (name_key) do update set website = coalesce(brands.website, excluded.website)
  returning id into b;
  if p_row->>'presence_type' is not null then
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, checked_date, added_by)
    values (b, p_country, p_row->>'presence_type', coalesce(p_row->>'presence_url', p_row->>'website'), nullif(p_row->>'price_feel', ''), current_date, auth.uid())
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

-- Approving a looked-up brand's style in Admin shows the brand and where
-- it's sold to everyone.
create or replace function public.brand_lookup_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.found_by = 'lookup' and new.review_status = 'approved' and old.review_status is distinct from 'approved' then
    update brands set added_by = null where id = new.brand_id;
    update brand_markets set added_by = null where brand_id = new.brand_id;
  end if;
  return new;
end;
$$;
drop trigger if exists brand_lookup_approved on public.brand_styles;
create trigger brand_lookup_approved after update on public.brand_styles for each row execute function public.brand_lookup_approved();
