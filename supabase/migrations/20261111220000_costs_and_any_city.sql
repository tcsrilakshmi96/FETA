-- International from v1 (11 Nov 2026): estimated cost per request, and a
-- daily spending cap. Estimates use Google's standard list prices.

create table public.api_costs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  route text not null, -- picks, ask, details, lists, area, admin
  sku text not null, -- places_nearby, gemini_maps… (see lib/server/costs.ts)
  units int not null check (units between 1 and 100),
  est_inr numeric(10, 2) not null check (est_inr between 0 and 500),
  created_at timestamptz not null default now()
);

create index api_costs_created_at on public.api_costs (created_at);

alter table public.api_costs enable row level security;

-- People can add their own rows (written by Feta's server as them), never read them.
create policy "log own costs" on public.api_costs
  for insert to authenticated with check (user_id = auth.uid());

-- Today's estimated spend across everyone, India time (the budget's day).
create function public.spend_today_inr()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(est_inr), 0) from public.api_costs
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
$$;

revoke all on function public.spend_today_inr() from public;
grant execute on function public.spend_today_inr() to authenticated;

-- Cities are now any city in the world ("gn:<GeoNames id>"); the old
-- city_interest table ("Tell me when you're in…") is no longer written.

-- The weekly report gains estimated spend.
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
    'new_people', (select count(*) from auth.users where created_at >= since),
    'new_people_signed_in_with_google', (select count(*) from auth.users where created_at >= since and not coalesce(is_anonymous, false)),
    'active_people', (
      select count(distinct user_id) from (
        select user_id from public.pick_sets where created_at >= since
        union select user_id from public.chat_messages where created_at >= since
        union select user_id from public.pick_actions where created_at >= since
      ) a
    ),
    'pick_searches', (select count(*) from public.pick_sets where created_at >= since),
    'pick_searches_food', (select count(*) from public.pick_sets where created_at >= since and category = 'food_drinks'),
    'pick_searches_experiences', (select count(*) from public.pick_sets where created_at >= since and category = 'experiences'),
    'event_searches', (select count(*) from public.events_cache where created_at >= since),
    'chat_messages', (select count(*) from public.chat_messages where created_at >= since and role = 'user'),
    'saves', (select count(*) from public.pick_actions where created_at >= since and action = 'saved'),
    'skips', (select count(*) from public.pick_actions where created_at >= since and action = 'skipped'),
    'shares', (select count(*) from public.shares where created_at >= since),
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
    )
  );
  return base;
end;
$$;

-- Feta picks move to the new city ids, and show their city's name.
alter table public.founder_places add column if not exists city_name text;
update public.founder_places set
  city_name = case city_id
    when 'bengaluru' then 'Bengaluru' when 'mumbai' then 'Mumbai' when 'delhi-ncr' then 'Delhi'
    when 'hyderabad' then 'Hyderabad' when 'chennai' then 'Chennai' when 'pune' then 'Pune'
    when 'kolkata' then 'Kolkata' when 'goa' then 'Goa' else city_name end,
  city_id = case city_id
    when 'bengaluru' then 'gn:1277333' when 'mumbai' then 'gn:1275339' when 'delhi-ncr' then 'gn:1273294'
    when 'hyderabad' then 'gn:1269843' when 'chennai' then 'gn:1264527' when 'pune' then 'gn:1259229'
    when 'kolkata' then 'gn:1275004' when 'goa' then 'gn:9000001' else city_id end
where city_id not like 'gn:%';
