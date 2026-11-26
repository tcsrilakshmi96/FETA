-- Inspiration photos kept on the account (founder, 26 Nov 2026: "I think we
-- should keep the photos"), so they come back after signing out and in, or
-- on another phone. Only the person can read or change them; deleted with
-- the account. Up to 8 photos (data: URLs, shrunk on the phone) and what
-- Feta saw in each. Safe to run more than once.
create table if not exists public.style_inspiration (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  photos text[] not null check (cardinality(photos) between 1 and 8 and length(array_to_string(photos, '')) < 12000000),
  reads jsonb not null default '[]'::jsonb check (jsonb_typeof(reads) = 'array' and length(reads::text) < 20000),
  updated_at timestamptz not null default now()
);
alter table public.style_inspiration enable row level security;
drop policy if exists "own inspiration" on public.style_inspiration;
create policy "own inspiration" on public.style_inspiration
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
