-- Feta onboarding data: profile, consent log, answers, swipes, profile lines,
-- and "Tell me when" interest in uncovered cities.
--
-- Every user starts with an anonymous Supabase account; Google sign-in is
-- linked to the same account later. Row-level security lets each person read
-- and write only their own rows. Deleting the auth user deletes everything.

-- Profile: one row per user, created automatically on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  age_confirmed_at timestamptz,
  consent_location boolean not null default false,
  consent_public_reviews boolean not null default false,
  -- Every user record carries city, country, time zone and currency.
  city_id text,
  country text,
  time_zone text,
  currency text,
  -- Optional, only for the weekend plan on WhatsApp.
  whatsapp_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every consent given or withdrawn, never edited.
create table public.consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('age_18_plus', 'location', 'public_reviews', 'whatsapp')),
  granted boolean not null,
  created_at timestamptz not null default now()
);

-- The 6 onboarding answers. Stable option ids from lib/onboarding.ts.
create table public.answers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  diet text,
  halal boolean not null default false,
  distance text,
  spend text,
  spend_currency text,
  who text[] not null default '{}',
  drinks text,
  interests text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Taste swipes, one row per card.
create table public.swipes (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  verdict text not null check (verdict in ('yes', 'no', 'unsure')),
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- Plain, editable profile lines ("What I think you like"). Removing a line
-- sets removed_at so picks stop using it.
create table public.profile_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  line_key text not null,
  text text not null,
  source text not null check (source in ('answers', 'swipes', 'checkin', 'chat')),
  trip text, -- set for "Only for this trip" lines
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (user_id, line_key)
);

-- "Tell me when you're in {city}" taps.
create table public.city_interest (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  city_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, city_id)
);

-- Row-level security: each person sees and changes only their own rows.
alter table public.profiles enable row level security;
alter table public.consent_log enable row level security;
alter table public.answers enable row level security;
alter table public.swipes enable row level security;
alter table public.profile_lines enable row level security;
alter table public.city_interest enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "read own consent" on public.consent_log
  for select to authenticated using (user_id = auth.uid());
create policy "add own consent" on public.consent_log
  for insert to authenticated with check (user_id = auth.uid());
create policy "own answers" on public.answers
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own swipes" on public.swipes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own profile lines" on public.profile_lines
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own city interest" on public.city_interest
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Create the profile row for every new user, anonymous or not.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-tap "Delete my data": removes the account and, through the cascades
-- above, every row that belongs to it.
create function public.delete_my_data()
returns void
language sql
security definer set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
