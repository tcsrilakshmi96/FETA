-- Trip planner in Ask Feta (founder, 14 Nov 2026): a route of cities with
-- nights and a short story for each (Feta's own words, from Venice), rough
-- getting-around estimates, a hotel budget, and the hotels shown and chosen
-- per city (Google place IDs only, as Google allows). Day plans are built
-- live and not stored.

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  start_date date,
  who text,
  home_currency text,
  cities jsonb not null default '[]',      -- [{name, country, cityId, nights, story, focus}]
  transport jsonb,                         -- {legs: [...], trains, flights, tip, currency}
  hotel_budget text,                       -- "1".."4"
  stays jsonb not null default '{}',       -- {"<city index>": {"shown": [place ids], "chosen": place id | null}}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trips_user on public.trips (user_id, updated_at desc);

alter table public.trips enable row level security;

create policy "own trips" on public.trips
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
