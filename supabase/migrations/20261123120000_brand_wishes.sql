-- Brands wanted where Feta has few (founder, 23 Nov 2026): in-app research
-- runs only from the founder's account now, so when someone opens Brands in
-- a country and style with few brands, it's written down here (free) and
-- shows in Admin → Brands, for research with Claude and import.
create table if not exists public.brand_wishes (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  style_id text not null,
  brands int not null default 0, -- how many it had then
  created_at timestamptz not null default now(),
  unique (user_id, country, style_id)
);
alter table public.brand_wishes enable row level security;
create policy "brand_wishes insert own" on public.brand_wishes for insert to authenticated with check (user_id = auth.uid());
create policy "brand_wishes update own" on public.brand_wishes for update to authenticated using (user_id = auth.uid());
create policy "brand_wishes admin read" on public.brand_wishes for select to authenticated using (public.is_admin() or user_id = auth.uid());
