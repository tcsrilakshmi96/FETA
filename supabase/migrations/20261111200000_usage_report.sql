-- Weekly usage numbers for the founder's cost report (built in n8n).
-- Counts only: no names, emails, places, messages or diets.
--
-- The report key lives in n8n and .env.local; only its SHA-256 hash is
-- kept here, in a table no one can read through the API. Add it with:
--   insert into public.report_keys (key_hash) values ('<sha256 hex of the key>');

create table public.report_keys (
  key_hash text primary key,
  created_at timestamptz not null default now()
);

alter table public.report_keys enable row level security;
-- No policies: the table is invisible to the app and the API.

create function public.usage_report(report_key text, days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(days, 1), 92));
begin
  if not exists (
    select 1 from public.report_keys
    where key_hash = encode(sha256(convert_to(report_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;

  return jsonb_build_object(
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
    )
  );
end;
$$;

revoke all on function public.usage_report(text, int) from public;
grant execute on function public.usage_report(text, int) to anon, authenticated;
