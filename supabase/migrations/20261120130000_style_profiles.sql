-- Each person's style (founder, 20 Nov 2026): what they shop for, the styles
-- Feta read from their inspiration photos (or they picked), their clothes
-- budget, "Homegrown only", and what they thought of outfit ideas. Their
-- photos are never stored, only the style words. Likes and skips here never
-- change a brand's style tags. Saved brands go in Saved → Brands.

create table public.style_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wears text not null check (wears in ('women', 'men', 'both')),
  styles text[] not null default '{}', -- style_lenses ids, strongest first
  read_from_photos int not null default 0, -- how many photos Feta read (the photos themselves are never kept)
  budget text[] not null default '{}', -- clothes budget levels ticked: c1…c4
  homegrown_only boolean not null default false,
  on_you boolean not null default false, -- drawn as themselves (the drawings stay on their phone)
  outfit_votes jsonb not null default '[]', -- [{look, verdict: "love" | "not_me", at}]
  city_id text,
  country text,
  time_zone text,
  currency text,
  updated_at timestamptz not null default now()
);

create table public.saved_brands (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  style_id text,
  country text,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);

alter table public.style_profiles enable row level security;
alter table public.saved_brands enable row level security;

create policy "own style profile" on public.style_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved brands" on public.saved_brands
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
