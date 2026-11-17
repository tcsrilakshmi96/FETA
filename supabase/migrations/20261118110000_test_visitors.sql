-- Test visitors (founder, 18 Nov 2026): AI QA runs open Feta with ?qa=1,
-- which marks their account as a test. Every admin number leaves them out
-- by default; the Usage tab's "Real people only" switch can show them.

alter table public.profiles add column is_test boolean not null default false;

drop function public.usage_dashboard(int);
drop function public.usage_numbers(int);
drop function public.usage_cohorts(boolean);
drop function public.usage_people();

-- People who count (not admins; not tests unless asked), when they
-- joined, and whether they've signed in with Google.
create function public.usage_people(real_only boolean)
returns table (id uuid, joined date, google boolean)
language sql
stable
security definer set search_path = ''
as $$
  select u.id, (u.created_at at time zone 'utc')::date, not coalesce(u.is_anonymous, false)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where coalesce(u.email, '') not in (select a.email from public.admins a)
    and (not real_only or not coalesce(p.is_test, false));
$$;

create function public.usage_cohorts(only_google boolean, real_only boolean)
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
  with today as (select (now() at time zone 'utc')::date d),
  people as (select * from public.usage_people(real_only) p where not only_google or p.google),
  act as (select a.* from public.usage_active_days() a join people p on p.id = a.user_id),
  per as (
    select p.id, date_trunc('week', p.joined)::date week, p.joined,
      exists (select 1 from act a where a.user_id = p.id and a.day = p.joined + 1) d1,
      exists (select 1 from act a where a.user_id = p.id and a.day between p.joined + 1 and p.joined + 7) d7,
      exists (select 1 from act a where a.user_id = p.id and a.day between p.joined + 1 and p.joined + 30) d30
    from people p
    where p.joined >= (select d from today) - 56
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'week', week,
    'people', n,
    'd1', case when week + 7 < (select d from today) then d1 end,
    'd7', case when week + 13 < (select d from today) then d7 end,
    'd30', case when week + 36 < (select d from today) then d30 end
  ) order by week), '[]'::jsonb)
  from (select week, count(*) n, count(*) filter (where d1) d1, count(*) filter (where d7) d7, count(*) filter (where d30) d30 from per group by week) w;
$$;

create function public.usage_numbers(days int, real_only boolean)
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
  with n as (select least(greatest(days, 1), 3650) n),
  today as (select (now() at time zone 'utc')::date d),
  since as (select (select d from today) - (select n from n) + 1 d),
  people as (select * from public.usage_people(real_only)),
  act as (select a.* from public.usage_active_days() a join people p on p.id = a.user_id),
  inrange as (select * from act where day >= (select d from since)),
  before as (select * from act where day >= (select d from since) - (select n from n) and day < (select d from since)),
  fresh as (select * from people where joined >= (select d from since))
  select jsonb_build_object(
    'days', (select n from n),
    'real_only', real_only,
    'test_people', (select count(*) from public.profiles p where p.is_test and p.id in (select a.user_id from public.usage_active_days() a where a.day >= (select d from since))),
    'unique_people', (select count(distinct user_id) from inrange),
    'unique_people_before', (select count(distinct user_id) from before),
    'new_people', (select count(*) from fresh),
    'new_people_google', (select count(*) from fresh where google),
    'active_today', (select count(distinct user_id) from act where day = (select d from today)),
    'days_per_week', case when (select n from n) >= 7 then (
      select round(avg(c) * 7.0 / (select n from n), 1) from (select count(*) c from inrange group by user_id) x
    ) end,
    'funnel', jsonb_build_object(
      'opened', (select count(*) from fresh),
      'answered', (select count(*) from fresh f where exists (select 1 from public.answers a where a.user_id = f.id)),
      'saw_picks', (select count(*) from fresh f where exists (select 1 from public.pick_sets s where s.user_id = f.id)),
      'did_something', (select count(*) from fresh f where exists (select 1 from public.pick_actions a where a.user_id = f.id and a.action in ('saved', 'been'))
        or exists (select 1 from public.shares h where h.user_id = f.id) or exists (select 1 from public.saved_plans s where s.user_id = f.id)),
      'came_back', (select count(*) from fresh f where exists (select 1 from act a where a.user_id = f.id and a.day > f.joined))
    ),
    'retention', public.usage_cohorts(false, real_only),
    'retention_google', public.usage_cohorts(true, real_only)
  );
$$;

create function public.usage_dashboard(days int default 7, real_only boolean default true)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  return public.usage_numbers(days, real_only);
end;
$$;

revoke execute on function public.usage_people(boolean) from public, anon, authenticated;
revoke execute on function public.usage_cohorts(boolean, boolean) from public, anon, authenticated;
revoke execute on function public.usage_numbers(int, boolean) from public, anon, authenticated;
grant execute on function public.usage_dashboard(int, boolean) to authenticated;

-- The Monday email: real people only (spend still counts everything).
create or replace function public.usage_report(report_key text, days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(days, 1), 92));
  base jsonb;
begin
  if not exists (
    select 1 from public.report_keys
    where key_hash = encode(sha256(convert_to(report_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;

  base := jsonb_build_object(
    'days', least(greatest(days, 1), 92),
    'from', since,
    'to', now(),
    'new_people', (select count(*) from auth.users u left join public.profiles p on p.id = u.id where u.created_at >= since and not coalesce(p.is_test, false)),
    'new_people_signed_in_with_google', (select count(*) from auth.users u left join public.profiles p on p.id = u.id where u.created_at >= since and not coalesce(u.is_anonymous, false) and not coalesce(p.is_test, false)),
    'active_people', (
      select count(distinct user_id) from (
        select user_id from public.pick_sets where created_at >= since
        union select user_id from public.chat_messages where created_at >= since
        union select user_id from public.pick_actions where created_at >= since
      ) a
      where user_id not in (select id from public.profiles where is_test)
    ),
    'pick_searches', (select count(*) from public.pick_sets where created_at >= since and user_id not in (select id from public.profiles where is_test)),
    'pick_searches_food', (select count(*) from public.pick_sets where created_at >= since and category = 'food_drinks' and user_id not in (select id from public.profiles where is_test)),
    'pick_searches_experiences', (select count(*) from public.pick_sets where created_at >= since and category = 'experiences' and user_id not in (select id from public.profiles where is_test)),
    'event_searches', (select count(*) from public.events_cache where created_at >= since),
    'chat_messages', (select count(*) from public.chat_messages where created_at >= since and role = 'user' and user_id not in (select id from public.profiles where is_test)),
    'saves', (select count(*) from public.pick_actions where created_at >= since and action = 'saved' and user_id not in (select id from public.profiles where is_test)),
    'skips', (select count(*) from public.pick_actions where created_at >= since and action = 'skipped' and user_id not in (select id from public.profiles where is_test)),
    'shares', (select count(*) from public.shares where created_at >= since and user_id not in (select id from public.profiles where is_test)),
    'share_votes', (select count(*) from public.share_votes where created_at >= since),
    'feedback', (select count(*) from public.feedback where created_at >= since),
    'busiest_day', (
      select to_char(d, 'Dy DD Mon') from (
        select date_trunc('day', created_at) d, count(*) n from public.pick_sets
        where created_at >= since group by 1 order by n desc limit 1
      ) b
    ),
    'countries', (
      select coalesce(jsonb_object_agg(country, n), '{}'::jsonb) from (
        select coalesce(p.country, '?') country, count(distinct s.user_id) n
        from public.pick_sets s left join public.profiles p on p.id = s.user_id
        where s.created_at >= since group by 1
      ) c
    ),
    'estimated_spend_inr', (select coalesce(sum(est_inr), 0) from public.api_costs where created_at >= since),
    'estimated_spend_by_kind_inr', (
      select coalesce(jsonb_object_agg(sku, total), '{}'::jsonb) from (
        select sku, sum(est_inr) total from public.api_costs where created_at >= since group by sku order by 2 desc
      ) k
    ),
    'people_and_retention', public.usage_numbers(least(greatest(days, 1), 92), true)
  );
  return base;
end;
$$;
