-- Test spend stays test spend (founder, 24 Nov 2026: "where has this money
-- gone"). Each cost row and hit now records, when it's written, whether it
-- came from a test account, so deleting a test account afterwards no longer
-- turns its spend into "real people" spend (which also counted against
-- everyone's daily pool). Spend from scripts run outside the app (route
-- 'script', e.g. making Style's library pictures) is logged too, apart from
-- the pools. Safe to run more than once.
alter table public.api_costs add column if not exists is_test boolean not null default false;
alter table public.api_hits add column if not exists is_test boolean not null default false;
update public.api_costs c set is_test = true from public.profiles p where p.id = c.user_id and p.is_test and not c.is_test;
update public.api_hits h set is_test = true from public.profiles p where p.id = h.user_id and p.is_test and not h.is_test;

create or replace function public.mark_cost_test()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_test := coalesce((select is_test from profiles where id = new.user_id), false);
  return new;
end;
$$;
revoke all on function public.mark_cost_test() from public, anon, authenticated;
drop trigger if exists api_costs_mark_test on public.api_costs;
create trigger api_costs_mark_test before insert on public.api_costs for each row execute function public.mark_cost_test();
drop trigger if exists api_hits_mark_test on public.api_hits;
create trigger api_hits_mark_test before insert on public.api_hits for each row execute function public.mark_cost_test();

-- An account marked as a tester later: its rows so far become test rows too.
create or replace function public.mark_test(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from qa_codes where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')) then
    return false;
  end if;
  perform set_config('feta.marking_test', 'yes', true);
  update profiles set is_test = true where id = auth.uid();
  perform set_config('feta.marking_test', '', true);
  update api_costs set is_test = true where user_id = auth.uid();
  update api_hits set is_test = true where user_id = auth.uid();
  return true;
end;
$$;
revoke all on function public.mark_test(text) from public, anon;
grant execute on function public.mark_test(text) to authenticated;

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
  cost as (
    select c.est_inr, c.user_id, c.is_test test
    from public.api_costs c
    where c.created_at >= (select t from since)
      and c.route not in ('admin', 'weekend', 'style_research', 'style_brand', 'script')
  ),
  sets as (
    select s.user_id, coalesce(s.user_id in (select id from testers), false) test
    from public.pick_sets s
    where s.created_at >= (select t from since)
  )
  select jsonb_build_object(
    'is_test', (select is_test from me),
    'pool', coalesce((select sum(est_inr) from cost where test = (select is_test from me)), 0),
    'mine', case when public.is_admin() then 0 else coalesce((select sum(est_inr) from cost where user_id = auth.uid()), 0) end,
    'searches', (select count(*) from sets where test = (select is_test from me)),
    'searches_mine', (select count(*) from sets where user_id = auth.uid())
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
  ), 0);
end;
$$;
revoke all on function public.real_spend_today(text) from public;
grant execute on function public.real_spend_today(text) to anon, authenticated;

-- Admin → Costs reads the test flag from each row, and shows this month's
-- calls per paid service (for Google's free monthly allowance) and today's
-- spend per bill, everyone together.
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
    'routes', coalesce((select jsonb_agg(r order by r.cost desc) from (
      select route, count(*) as hits, count(*) filter (where cost_inr > 0) as paid,
        round(sum(cost_inr), 2) as cost, round(avg(cost_inr), 2) as avg_cost,
        count(*) filter (where repeat) as repeats, round(sum(cost_inr) filter (where repeat), 2) as repeat_cost,
        count(distinct user_id) as people, round(avg(ms)) as avg_ms
      from h group by route) r), '[]'),
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

revoke all on function public.cost_monitor(int, boolean) from public, anon;
grant execute on function public.cost_monitor(int, boolean) to authenticated;
