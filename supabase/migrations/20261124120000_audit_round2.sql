-- Audit round 2 (24 Nov 2026): tech, cost and security audits.

-- 1. Writes only Feta's server makes have their own key (security audit:
--    the n8n report key could also write the events cache, whose Google
--    chip every phone shows, the cost log, tags and the brand library).
--    Until the app has FETA_WRITE_KEY on Vercel, the report key still works
--    here; the last step of the round removes that (see the end).
create table if not exists public.write_keys (
  key_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.write_keys enable row level security;
insert into public.write_keys (key_hash) values ('bf4fba11c7eadd0e0cb8b85819d2e5f9dffd167aa0ca37d682c96a86b27342f9') on conflict do nothing;

create or replace function public.server_key_ok(p_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from write_keys where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'))
    or exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'));
$$;
revoke all on function public.server_key_ok(text) from public, anon, authenticated;

-- The functions that checked the report key themselves now use the same check.
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
    on conflict (name_key) do update set website = coalesce(brands.website, excluded.website), instagram = coalesce(brands.instagram, excluded.instagram)
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
create or replace function public.start_style_research(p_key text, p_country text, p_style text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into style_research (country, style_id, found, done, started_at) values (p_country, p_style, 0, false, now())
  on conflict (country, style_id) do update set started_at = now(), done = false
    where (style_research.done and style_research.researched_at < now() - interval '120 days')
       or (not style_research.done and (style_research.started_at is null or style_research.started_at < now() - interval '15 minutes'));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
create or replace function public.start_style_research_more(p_key text, p_country text, p_style text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into style_research (country, style_id, found, done, started_at) values (p_country, p_style, 0, false, now())
  on conflict (country, style_id) do update set started_at = now(), done = false
    where (style_research.done and style_research.researched_at < now() - interval '1 hour')
       or (not style_research.done and (style_research.started_at is null or style_research.started_at < now() - interval '15 minutes'));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- 2. A brand someone typed shows only to them until Admin approves it
--    (security audit: a crafted name added a brand for everyone).
alter table public.brand_styles add column if not exists added_by uuid references auth.users (id) on delete set null;
alter table public.brand_styles drop constraint if exists brand_styles_found_by_check;
alter table public.brand_styles add constraint brand_styles_found_by_check check (found_by in ('import', 'feta', 'lookup'));
drop policy if exists "read brand styles" on public.brand_styles;
create policy "read brand styles" on public.brand_styles for select to authenticated
  using ((review_status <> 'rejected' and (found_by <> 'lookup' or review_status = 'approved' or added_by = auth.uid())) or public.is_admin());
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
  insert into brands (name, name_key, website, instagram, origin_country, wears, label_type)
  values (p_row->>'brand_name', p_row->>'name_key', p_row->>'website', p_row->>'instagram', p_row->>'origin_country', p_row->>'wears', p_row->>'label_type')
  on conflict (name_key) do update set website = coalesce(brands.website, excluded.website)
  returning id into b;
  if p_row->>'presence_type' is not null then
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, checked_date)
    values (b, p_country, p_row->>'presence_type', coalesce(p_row->>'presence_url', p_row->>'website'), nullif(p_row->>'price_feel', ''), current_date)
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

-- 3. A place of hers Google can't find is tried again the next day, not on
--    every search (cost audit); a found one is kept as before.
create or replace function public.locate_founder_places(p_key text, p_places jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  update public.founder_places f
  set lat = (x ->> 'lat')::double precision,
      lng = (x ->> 'lng')::double precision,
      located_at = now()
  from jsonb_array_elements(p_places) x
  where f.place_id = x ->> 'place_id'
    and x ? 'lat'
    and (f.lat is null or f.located_at is null or f.located_at < now() - interval '25 days')
    and abs((x ->> 'lat')::double precision) <= 90
    and abs((x ->> 'lng')::double precision) <= 180;
  update public.founder_places f
  set located_at = now()
  from jsonb_array_elements(p_places) x
  where f.place_id = x ->> 'place_id' and not (x ? 'lat') and f.lat is null;
end;
$$;
revoke all on function public.locate_founder_places(text, jsonb) from public, anon;
grant execute on function public.locate_founder_places(text, jsonb) to authenticated;

-- 4. An event venue's place ID is kept for a month for everyone (cost audit).
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
end;
$$;

-- 5. "Loved by N Feta users" counts only people signed in with Google, never
--    test accounts (security audit: throwaway accounts could fake it), as
--    brand tag votes already do.
create or replace view public.real_people as
  select u.id from auth.users u
  left join public.profiles p on p.id = u.id
  where not coalesce(u.is_anonymous, false) and not coalesce(p.is_test, false);
revoke all on public.real_people from public, anon, authenticated;

create or replace function public.feta_favourites(p_city text, p_category text)
returns table (place_id text, lovers int, similar int)
language sql
security definer
set search_path = public
stable
as $$
  with my_yes as (
    select card_id from public.swipes
    where user_id = auth.uid() and verdict = 'yes' and card_id like 'cuisine_%'
  ),
  my_interests as (
    select coalesce((select interests from public.answers where user_id = auth.uid()), '{}'::text[]) as interests
  ),
  alike as (
    select distinct s.user_id from public.swipes s
    where s.verdict = 'yes' and s.card_id in (select card_id from my_yes)
    union
    select a.user_id from public.answers a, my_interests m
    where a.interests && m.interests
  )
  select p.place_id,
         count(distinct p.user_id)::int as lovers,
         count(distinct p.user_id) filter (where p.user_id in (select user_id from alike))::int as similar
  from public.pick_actions p
  where p.action = 'been' and p.verdict = 'loved' and p.recommend
    and p.city_id = p_city
    and (p_category is null or p.category = p_category)
    and p.user_id <> auth.uid()
    and p.user_id in (select id from public.real_people)
  group by p.place_id
  order by 3 desc, 2 desc
  limit 30;
$$;

create or replace function public.feta_love_counts(p_place_ids text[])
returns table (place_id text, lovers int)
language sql
security definer
set search_path = public
stable
as $$
  select p.place_id, count(distinct p.user_id)::int
  from public.pick_actions p
  where p.action = 'been' and p.verdict = 'loved' and p.recommend
    and p.place_id = any (p_place_ids[1:40])
    and p.user_id in (select id from public.real_people)
  group by p.place_id;
$$;

create or replace function public.brand_love(p_brand_ids uuid[])
returns table (brand_id uuid, feta_pick boolean, note text, lovers int)
language sql
security definer
set search_path = public
stable
as $$
  with me as (select coalesce((select styles from style_profiles where user_id = auth.uid()), '{}') as styles)
  select l.brand_id,
    bool_or(a.email is not null) as feta_pick,
    max(case when a.email is not null then l.note end) as note,
    (count(distinct l.user_id) filter (
      where a.email is null and l.recommend and l.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
        and l.user_id in (select id from public.real_people)
        and ((select styles from me) = '{}' or exists (select 1 from style_profiles p where p.user_id = l.user_id and p.styles && (select styles from me)))
    ))::int as lovers
  from public.loved_brands l
  join auth.users u on u.id = l.user_id
  left join public.admins a on a.email = u.email
  where l.brand_id = any (p_brand_ids[1:300])
  group by l.brand_id;
$$;

-- 6. Share links hold only what Feta made (security audit: any text and
--    links could be put on an askfeta.com page): short words, place IDs,
--    and event links found in the sharer's own lists. Votes are capped.
create or replace function public.check_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  stops jsonb;
begin
  if pg_column_size(new.payload) > 20000 then raise exception 'Share too big'; end if;
  if length(coalesce(new.payload ->> 'title', '')) > 60 then raise exception 'Bad share'; end if;
  stops := case when new.kind = 'choice'
    then (select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(coalesce(new.payload -> 'options', '[]'::jsonb)) o, jsonb_array_elements(coalesce(o -> 'stops', '[]'::jsonb)) s)
    else coalesce(new.payload -> 'stops', '[]'::jsonb) end;
  if jsonb_array_length(stops) > 18 or jsonb_array_length(coalesce(new.payload -> 'options', '[]'::jsonb)) > 3 then raise exception 'Bad share'; end if;
  for st in select * from jsonb_array_elements(stops) loop
    if coalesce(st ->> 'placeId', '') !~ '^(event:https?://.{1,500}|[A-Za-z0-9_.-]{10,300})$'
      or length(coalesce(st ->> 'because', '')) > 200 or length(coalesce(st ->> 'fetaNote', '')) > 1000 then
      raise exception 'Bad share';
    end if;
    if st ? 'event' then
      if coalesce(st #>> '{event,url}', '') !~ '^https?://' or length(coalesce(st #>> '{event,title}', '')) > 200
        or not exists (select 1 from pick_sets p where p.user_id = new.user_id and p.picks @> jsonb_build_array(jsonb_build_object('placeId', 'event:' || (st #>> '{event,url}')))) then
        raise exception 'Bad share';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists check_share on public.shares;
create trigger check_share before insert or update of payload on public.shares for each row execute function public.check_share();

create or replace function public.cast_vote(share_slug text, voter_id text, voter_name text, choice text)
returns void
language sql
security definer set search_path = ''
as $$
  insert into public.share_votes (slug, voter, name, vote)
  select share_slug, left(voter_id, 64), nullif(left(trim(voter_name), 40), ''), choice
  where exists (select 1 from public.share_votes v where v.slug = share_slug and v.voter = left(voter_id, 64))
     or (select count(*) from public.share_votes v where v.slug = share_slug) < 30
  on conflict (slug, voter) do update set name = excluded.name, vote = excluded.vote, created_at = now();
$$;

-- 7. A pick set's search count can't be reset by changing its date (security
--    audit); only its places change after it's made (late events).
create or replace function public.keep_pick_set()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id; new.user_id := old.user_id; new.created_at := old.created_at; new.expires_at := old.expires_at;
  new.category := old.category; new.when_slot := old.when_slot; new.origin_key := old.origin_key; new.searched := old.searched;
  return new;
end;
$$;
drop trigger if exists keep_pick_set on public.pick_sets;
create trigger keep_pick_set before update on public.pick_sets for each row execute function public.keep_pick_set();

-- 8. A visit is for today (security audit: past days could be added).
create or replace function public.visit_today()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.day := (now() at time zone 'utc')::date;
  return new;
end;
$$;
drop trigger if exists visit_today on public.visits;
create trigger visit_today before insert on public.visits for each row execute function public.visit_today();

-- 9. What friends opening shared links with no account spent today, for
--    their own small budget (security audit).
create or replace function public.lookup_spend_today(p_key text)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select sum(c.est_inr) from api_costs c
    where c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      and c.route = 'place' and c.user_id is null
  ), 0);
end;
$$;
revoke all on function public.lookup_spend_today(text) from public;
grant execute on function public.lookup_spend_today(text) to anon, authenticated;

-- 10. A deleted account's requests keep no trace of what was asked.
create or replace function public.forget_hit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is null and old.user_id is not null then
    new.fingerprint := null;
    new.label := null;
  end if;
  return new;
end;
$$;
drop trigger if exists forget_hit on public.api_hits;
create trigger forget_hit before update on public.api_hits for each row execute function public.forget_hit();

-- 11. Admin → Costs: per-route spend from every cost row.
create or replace function public.cost_monitor(days int default 7, real_only boolean default true)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(days, 60)));
  out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  with h as (
    select x.*,
      exists (
        select 1 from public.api_hits y
        where y.user_id = x.user_id and y.route = x.route and y.fingerprint = x.fingerprint
          and y.created_at < x.created_at and y.created_at > x.created_at - interval '30 minutes'
      ) as repeat
    from public.api_hits x
    where x.created_at >= since and x.fingerprint is not null
      and (not real_only or not x.is_test)
    union all
    select x.*, false
    from public.api_hits x
    where x.created_at >= since and x.fingerprint is null
      and (not real_only or not x.is_test)
  ), c as (
    select a.* from public.api_costs a
    where a.created_at >= since and (not real_only or not a.is_test)
  )
  select jsonb_build_object(
    'since', since,
    -- Spend per route from every cost row, so work finishing after the reply
    -- counts with its route (audit, 24 Nov 2026: the routes didn't add up
    -- to the total).
    'routes', coalesce((select jsonb_agg(r order by r.cost desc) from (
      select hh.route, hh.hits, hh.paid,
        round(coalesce(cc.cost, hh.cost), 2) as cost, round(coalesce(cc.cost, hh.cost) / greatest(hh.hits, 1), 2) as avg_cost,
        hh.repeats, hh.repeat_cost, hh.people, hh.avg_ms
      from (
        select route, count(*) as hits, count(*) filter (where cost_inr > 0) as paid, sum(cost_inr) as cost,
          count(*) filter (where repeat) as repeats, round(sum(cost_inr) filter (where repeat), 2) as repeat_cost,
          count(distinct user_id) as people, round(avg(ms)) as avg_ms
        from h group by route) hh
      left join (select route, sum(est_inr) as cost from c group by route) cc on cc.route = hh.route) r), '[]'),
    'services', coalesce((select jsonb_agg(s order by s.cost desc) from (
      select sku, sum(units) as calls, round(sum(est_inr), 2) as cost, count(distinct route) as routes,
        (select string_agg(distinct c2.route, ', ') from c c2 where c2.sku = c.sku) as used_by
      from c group by sku) s), '[]'),
    'repeated', coalesce((select jsonb_agg(t order by t.times desc) from (
      select route, coalesce(max(label), '—') as label, count(*) as times, count(distinct user_id) as people,
        round(sum(cost_inr), 2) as cost
      from h where fingerprint is not null
      group by route, fingerprint having count(*) > 1
      order by count(*) desc limit 25) t), '[]'),
    'total', (select round(coalesce(sum(est_inr), 0), 2) from c),
    -- This calendar month (Google bills by month), everyone together: tests,
    -- admin and scripts too, as the bill counts them all.
    'month', coalesce((select jsonb_agg(m) from (
      select sku, sum(units) as calls, round(sum(est_inr), 2) as cost,
        round(coalesce(sum(est_inr) filter (where is_test), 0), 2) as test_cost
      from public.api_costs
      where created_at >= date_trunc('month', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'
      group by sku) m), '[]'),
    'today', coalesce((select jsonb_agg(d) from (
      select case when sku like 'gemini%' then 'gemini' when sku like 'venice%' then 'venice' else 'maps' end as bill,
        round(sum(est_inr), 2) as cost
      from public.api_costs
      where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      group by 1) d), '[]'),
    'repeat_cost', (select round(coalesce(sum(cost_inr) filter (where repeat), 0), 2) from h)
  ) into out;
  return out;
end;
$$;

-- 12. Nothing here for visitors with no account (security audit: Supabase
--     grants them every function unless taken away).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['spend_today_inr', 'library_spend_today_inr', 'feta_love_counts', 'city_coverage', 'schema_objects', 'weekend_plan_inputs', 'save_brand_lookup', 'save_style_research', 'start_style_research', 'start_style_research_more', 'locate_founder_places', 'feta_favourites', 'brand_love', 'cost_monitor'])
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;
