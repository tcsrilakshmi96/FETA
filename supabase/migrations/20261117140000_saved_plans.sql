-- Plan a night from Saved (founder, 17 Nov 2026): the places they ticked,
-- in their order, for a day and a starting time. Google place IDs only;
-- names, hours and locations are read live when the plan is opened. The
-- day after, "How was <day>?" asks about each stop once (checked_at).

create table public.saved_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  start_minute int not null check (start_minute between 0 and 1439),
  place_ids text[] not null check (cardinality(place_ids) between 2 and 6),
  city_id text,
  country text,
  time_zone text,
  currency text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_plans_user on public.saved_plans (user_id, day desc);

alter table public.saved_plans enable row level security;

create policy "own plans" on public.saved_plans
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
