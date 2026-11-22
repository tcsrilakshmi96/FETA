-- Cost monitor (founder, 23 Nov 2026: "which end points are costing a lot
-- and which is being hit again and again… where the search is being
-- duplicated"). One row per request on a route that can spend money: what it
-- was for (a fingerprint, plus a short label with no personal words), what it
-- spent and on which services, and how long it took. The same person asking
-- the same route for the same thing within 30 minutes is a repeat.

create table if not exists public.api_hits (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  route text not null,
  fingerprint text, -- a hash of what was asked (same ask, same fingerprint)
  label text, -- e.g. "tonight · food · Bengaluru"; never what someone typed
  cost_inr numeric(10, 2) not null default 0,
  services jsonb not null default '{}', -- {sku: units}
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists api_hits_created on public.api_hits (created_at);
create index if not exists api_hits_repeat on public.api_hits (user_id, route, fingerprint, created_at);

alter table public.api_hits enable row level security;
-- Written by Feta's server as the person, never read by them.
drop policy if exists "add own hits" on public.api_hits;
create policy "add own hits" on public.api_hits for insert to authenticated with check (user_id = auth.uid());

-- Admin → Costs: per route, per service, and the asks repeated most.
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
    left join public.profiles p on p.id = x.user_id
    where x.created_at >= since and x.fingerprint is not null
      and (not real_only or not coalesce(p.is_test, false))
    union all
    select x.*, false
    from public.api_hits x
    left join public.profiles p on p.id = x.user_id
    where x.created_at >= since and x.fingerprint is null
      and (not real_only or not coalesce(p.is_test, false))
  ), c as (
    select a.* from public.api_costs a
    left join public.profiles p on p.id = a.user_id
    where a.created_at >= since and (not real_only or not coalesce(p.is_test, false))
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
    'repeat_cost', (select round(coalesce(sum(cost_inr) filter (where repeat), 0), 2) from h)
  ) into out;
  return out;
end;
$$;

revoke all on function public.cost_monitor(int, boolean) from public, anon;
grant execute on function public.cost_monitor(int, boolean) to authenticated;
