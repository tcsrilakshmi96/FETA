-- 1. "Let the group choose": a share with 2-3 plans; friends vote for one
--    (votes '1', '2', '3'), still with no sign-up.
alter table public.shares drop constraint if exists shares_kind_check;
alter table public.shares add constraint shares_kind_check check (kind in ('pick', 'plan', 'choice'));
alter table public.share_votes drop constraint if exists share_votes_vote_check;
alter table public.share_votes add constraint share_votes_vote_check check (vote in ('yes', 'no', '1', '2', '3'));

-- 2. "Acted on a pick": directions, booking, Google Maps, website, sending to
--    the group, a check-in. For retention numbers (investor: week-4
--    retention of people who acted on a pick). Place IDs only.
create table public.pick_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id text,
  kind text not null check (kind in ('directions', 'book', 'maps', 'website', 'share', 'plan_share', 'choice_share', 'plan_directions', 'checkin')),
  city_id text,
  created_at timestamptz not null default now()
);
alter table public.pick_events enable row level security;
create policy "log own events" on public.pick_events
  for insert to authenticated with check (user_id = auth.uid());
create index pick_events_user on public.pick_events (user_id, created_at);

-- For the founder's reports (same private key as the weekly report):
-- people who acted on a pick, by week since they joined, and what they did.
create function public.acted_report(report_key text, days int default 28)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(days, 1), 120));
begin
  if not exists (
    select 1 from public.report_keys
    where key_hash = encode(sha256(convert_to(report_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object(
    'from', since,
    'people_who_acted', (select count(distinct user_id) from public.pick_events where created_at >= since),
    'actions_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.pick_events where created_at >= since group by kind) k),
    -- Of the people who joined in each week and acted that first week, how
    -- many acted again in a later week.
    'weekly_cohorts', (
      select coalesce(jsonb_agg(row_to_json(c) order by c.joined_week), '[]'::jsonb) from (
        select date_trunc('week', u.created_at)::date as joined_week,
          count(distinct u.id) as joined,
          count(distinct e1.user_id) as acted_first_week,
          count(distinct e2.user_id) as acted_again_later
        from auth.users u
        left join public.pick_events e1 on e1.user_id = u.id and e1.created_at < u.created_at + interval '7 days'
        left join public.pick_events e2 on e2.user_id = e1.user_id and e2.created_at >= u.created_at + interval '7 days'
        where u.created_at >= since
        group by 1
      ) c
    )
  );
end;
$$;
revoke all on function public.acted_report(text, int) from public;
grant execute on function public.acted_report(text, int) to anon, authenticated;
