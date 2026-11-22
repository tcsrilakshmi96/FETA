-- Style remembers (founder, 22–23 Nov 2026, docs/style-spec.md): the day's
-- looks for each outing, the one they chose to wear, their wardrobe ("I have
-- one") and what was off, kept on their account so the look stays put and
-- comes back on any phone. Pictures of looks stay on the phone.

alter table public.style_profiles add column if not exists wardrobe text[] not null default '{}';
alter table public.style_profiles add column if not exists off_notes text[] not null default '{}';

-- One row per set of looks shown for an outing on a day (in the city's time).
create table if not exists public.style_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null, -- the day it's for, in the city's time zone
  for_key text not null, -- "plan:…", "dinner", "else:…"
  for_text text not null, -- "Dinner at Toit, then drinks · 8 pm"
  for_detail jsonb, -- what they said: where, stops, what to avoid… (to make more)
  set_no int not null default 0, -- 0, then 1, 2… after "What's off?" / "3 more"
  looks jsonb not null, -- [{id, style, title, why, pieces: [{slot, name}]}]
  chosen int, -- the look they wore (index), null if none
  chosen_at timestamptz,
  city_id text,
  country text,
  time_zone text,
  currency text,
  created_at timestamptz not null default now(),
  unique (user_id, day, for_key, set_no)
);
create index if not exists style_sets_worn on public.style_sets (user_id, chosen_at desc) where chosen is not null;

alter table public.style_sets enable row level security;
drop policy if exists "own style sets" on public.style_sets;
create policy "own style sets" on public.style_sets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "♥ Loved by N people with your taste" (founder, 23 Nov 2026: brands people
-- shop from, "shown to others with similar taste like a feta pick"): only
-- people who share at least one style with the person asking and chose to
-- recommend count; everyone counts for someone without Style yet. Never who.
create or replace function public.brand_love(p_brand_ids uuid[])
returns table (brand_id uuid, feta_pick boolean, note text, lovers int)
language sql
security definer
set search_path = public
stable
as $$
  with me as (select coalesce((select styles from style_profiles where user_id = auth.uid()), '{}') as styles)
  select l.brand_id,
    bool_or(a.email is not null) as feta_pick,
    max(case when a.email is not null then l.note end) as note,
    (count(distinct l.user_id) filter (
      where a.email is null and l.recommend and l.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
        and ((select styles from me) = '{}' or exists (select 1 from style_profiles p where p.user_id = l.user_id and p.styles && (select styles from me)))
    ))::int as lovers
  from public.loved_brands l
  join auth.users u on u.id = l.user_id
  left join public.admins a on a.email = u.email
  where l.brand_id = any (p_brand_ids[1:300])
  group by l.brand_id;
$$;

revoke all on function public.brand_love(uuid[]) from public;
grant execute on function public.brand_love(uuid[]) to authenticated;
