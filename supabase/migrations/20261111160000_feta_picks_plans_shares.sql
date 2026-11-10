-- Feta picks (the founder's own places), a shared events cache, and group
-- shares with yes/no votes that need no sign-up.

-- Who can run the admin screen.
create table public.admins (
  email text primary key
);
alter table public.admins enable row level security;
insert into public.admins (email) values ('tcsrilakshmi96@gmail.com');

create function public.is_admin()
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (select 1 from public.admins where email = auth.jwt() ->> 'email');
$$;

-- The founder's own places. Google place ID only (no Google content), plus
-- her own words. Every place record carries city, country, time zone and
-- currency.
create table public.founder_places (
  id uuid primary key default gen_random_uuid(),
  place_id text not null unique,
  name text not null, -- her label for the admin list, e.g. "Toit"
  kind text not null check (kind in ('EAT', 'DRINK', 'DO')),
  note text not null, -- "Went in March, order the mushroom risotto"
  city_id text not null,
  country text not null,
  time_zone text not null,
  currency text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.founder_places enable row level security;
create policy "everyone reads Feta picks" on public.founder_places
  for select to authenticated using (active or public.is_admin());
create policy "founder adds Feta picks" on public.founder_places
  for insert to authenticated with check (public.is_admin());
create policy "founder edits Feta picks" on public.founder_places
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "founder removes Feta picks" on public.founder_places
  for delete to authenticated using (public.is_admin());

-- This week's events found by web search, shared by everyone in the same
-- area for a few hours so only the first person waits. Public listings only.
create table public.events_cache (
  key text primary key, -- city | area | tonight/weekend | date
  events jsonb not null,
  search_html text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.events_cache enable row level security;
create policy "read fresh events" on public.events_cache
  for select to authenticated using (expires_at > now());
create policy "add events" on public.events_cache
  for insert to authenticated with check (true);
create policy "refresh events" on public.events_cache
  for update to authenticated using (true) with check (true);

-- Send to the group: a pick or a plan as a Feta link. Payload holds place
-- IDs, event links and Feta's own words only (never diet).
create table public.shares (
  slug text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pick', 'plan')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.shares enable row level security;
create policy "own shares" on public.shares
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Friends vote without signing up: a random id kept in their browser.
create table public.share_votes (
  slug text not null references public.shares (slug) on delete cascade,
  voter text not null,
  name text,
  vote text not null check (vote in ('yes', 'no')),
  created_at timestamptz not null default now(),
  primary key (slug, voter)
);

alter table public.share_votes enable row level security;
-- No direct access; only through the functions below.

-- Anyone with the link can read the share (not who made it).
create function public.get_share(share_slug text)
returns table (kind text, payload jsonb, created_at timestamptz)
language sql
security definer set search_path = ''
stable
as $$
  select s.kind, s.payload, s.created_at from public.shares s where s.slug = share_slug;
$$;

-- Anyone with the link can vote once (changing their vote replaces it).
create function public.cast_vote(share_slug text, voter_id text, voter_name text, choice text)
returns void
language sql
security definer set search_path = ''
as $$
  insert into public.share_votes (slug, voter, name, vote)
  values (share_slug, left(voter_id, 64), nullif(left(trim(voter_name), 40), ''), choice)
  on conflict (slug, voter) do update set name = excluded.name, vote = excluded.vote, created_at = now();
$$;

create function public.share_votes_for(share_slug text)
returns table (name text, vote text)
language sql
security definer set search_path = ''
stable
as $$
  select v.name, v.vote from public.share_votes v where v.slug = share_slug order by v.created_at;
$$;

grant execute on function public.get_share(text) to anon, authenticated;
grant execute on function public.cast_vote(text, text, text, text) to anon, authenticated;
grant execute on function public.share_votes_for(text) to anon, authenticated;
