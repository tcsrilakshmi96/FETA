-- Picks: each set of 3 shown to a user, and what they did with each place.
--
-- Google rules: only Google place IDs are stored, never names, photos,
-- hours or other Google content. Reasons and verdicts are Feta's own text.

create table public.pick_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('food_drinks', 'experiences')),
  when_slot text not null check (when_slot in ('tonight', 'weekend')),
  -- "gps", or the chosen area / "Anywhere in …". No coordinates are kept.
  origin_key text not null,
  -- Every record carries city, country, time zone and currency.
  city_id text not null,
  country text not null,
  time_zone text not null,
  currency text not null,
  -- [{ placeId, kind, verdict, because }]
  picks jsonb not null,
  banner text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index pick_sets_lookup on public.pick_sets (user_id, category, when_slot, created_at desc);
create index pick_sets_created on public.pick_sets (created_at);

-- Saved, skipped (with an optional reason) or been. Places here are never
-- shown again as new picks.
create table public.pick_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id text not null,
  action text not null check (action in ('saved', 'skipped', 'been')),
  reason text,
  category text,
  city_id text,
  created_at timestamptz not null default now(),
  unique (user_id, place_id, action)
);

alter table public.pick_sets enable row level security;
alter table public.pick_actions enable row level security;

create policy "own pick sets" on public.pick_sets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pick actions" on public.pick_actions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- New searches so far today (India time), across everyone and for the
-- caller, for the daily cost limits. Returns counts only, no user data.
create function public.pick_searches_today()
returns table (everyone bigint, mine bigint)
language sql
security definer set search_path = ''
stable
as $$
  select
    count(*),
    count(*) filter (where user_id = auth.uid())
  from public.pick_sets
  where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

revoke execute on function public.pick_searches_today() from public, anon;
grant execute on function public.pick_searches_today() to authenticated;
