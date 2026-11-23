-- Outfit pictures kept on the account (founder, 23 Nov 2026: no sketches;
-- a look without their photo is an outfit board, about ₹4, made once). Only
-- boards with no person in them are kept here; a picture of them stays on
-- their phone. Deleted with the account. Safe to run more than once.
create table if not exists public.look_pictures (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  look_id text not null check (length(look_id) between 1 and 40),
  style_id text not null,
  image text not null check (length(image) < 3000000), -- a data: URL
  spots jsonb, -- where each piece is, as fractions
  created_at timestamptz not null default now(),
  primary key (user_id, look_id)
);
alter table public.look_pictures enable row level security;
drop policy if exists "own look pictures" on public.look_pictures;
create policy "own look pictures" on public.look_pictures
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists look_pictures_recent on public.look_pictures (user_id, created_at desc);
