-- Backend audit, 24 Nov 2026. Safe to run more than once.

-- 1. Deleting an account keeps its request log with the person removed, as
--    its cost rows already are, so Admin → Costs' two halves agree.
alter table public.api_hits drop constraint if exists api_hits_user_id_fkey;
alter table public.api_hits add constraint api_hits_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- 2. A day's shared search for a city is claimed by exactly one search:
--    true only when there was no row or the old one had run out.
create or replace function public.claim_events_cache(p_key text, p_cache_key text, p_minutes numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  won boolean;
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into events_cache (key, events, search_html, expires_at)
  values (left(p_cache_key, 300), '[]'::jsonb, '', now() + make_interval(mins => least(greatest(coalesce(p_minutes, 10), 1), 60)::int))
  on conflict (key) do update set events = '[]'::jsonb, search_html = '', expires_at = excluded.expires_at
    where events_cache.expires_at < now()
  returning true into won;
  return coalesce(won, false);
end;
$$;
revoke all on function public.claim_events_cache(text, text, numeric) from public, anon;
grant execute on function public.claim_events_cache(text, text, numeric) to authenticated;

-- 3. Tags: an entry without a list of tags is skipped, never wipes a place's.
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
  where f.place_id = x ->> 'place_id' and jsonb_typeof(x -> 'tags') = 'array' and jsonb_array_length(x -> 'tags') > 0;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.set_place_tags(text, jsonb) from public;
grant execute on function public.set_place_tags(text, jsonb) to anon, authenticated;

-- 4. Searches can't be reset by deleting one's own sets: people may read,
--    add and update theirs, not delete them (deleting the account still does).
drop policy if exists "own pick sets" on public.pick_sets;
drop policy if exists "read own pick sets" on public.pick_sets;
drop policy if exists "add own pick sets" on public.pick_sets;
drop policy if exists "update own pick sets" on public.pick_sets;
create policy "read own pick sets" on public.pick_sets for select to authenticated using (user_id = auth.uid());
create policy "add own pick sets" on public.pick_sets for insert to authenticated with check (user_id = auth.uid());
create policy "update own pick sets" on public.pick_sets for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5. A look's picture can be up to about 4.5 MB (Gemini's PNGs ran close
--    to the old limit, and one refused was made again on the next phone).
alter table public.look_pictures drop constraint if exists look_pictures_image_check;
alter table public.look_pictures add constraint look_pictures_image_check check (length(image) < 6000000);

-- 6. Daily limits: brand lookups count toward the person's own limit (they
--    stay out of the shared pool, which the library has its own cap for);
--    admins are out of every count, searches included.
create or replace function public.budget_today()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with since as (select (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') t),
  me as (select coalesce((select is_test from public.profiles where id = auth.uid()), false) is_test),
  testers as (select id from public.profiles where is_test),
  staff as (select u.id from auth.users u join public.admins a on lower(a.email) = lower(u.email)),
  cost as (
    select c.est_inr, c.user_id, c.is_test test, c.route
    from public.api_costs c
    where c.created_at >= (select t from since)
      and c.route not in ('admin', 'weekend', 'style_research', 'script')
      and (c.user_id is null or c.user_id not in (select id from staff))
  ),
  sets as (
    select s.user_id, coalesce(s.user_id in (select id from testers), false) test
    from public.pick_sets s
    where s.created_at >= (select t from since)
      and s.user_id not in (select id from staff)
  )
  select jsonb_build_object(
    'is_test', (select is_test from me),
    'pool', coalesce((select sum(est_inr) from cost where test = (select is_test from me) and route <> 'style_brand'), 0),
    'mine', case when public.is_admin() then 0 else coalesce((select sum(est_inr) from cost where user_id = auth.uid()), 0) end,
    'searches', (select count(*) from sets where test = (select is_test from me)),
    'searches_mine', case when public.is_admin() then 0 else (select count(*) from sets where user_id = auth.uid()) end
  );
$$;
revoke all on function public.budget_today() from public, anon;
grant execute on function public.budget_today() to authenticated;

create or replace function public.real_spend_today(p_key text)
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
      and c.route not in ('admin', 'weekend', 'style_research', 'style_brand', 'script')
      and not c.is_test
      and (c.user_id is null or c.user_id not in (select u.id from auth.users u join admins a on lower(a.email) = lower(u.email)))
  ), 0);
end;
$$;
revoke all on function public.real_spend_today(text) from public;
grant execute on function public.real_spend_today(text) to anon, authenticated;
