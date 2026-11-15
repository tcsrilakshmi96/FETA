-- Feta Favourites (founder, 15 Nov 2026): places Feta users loved and chose
-- to recommend to others. Only the place and a count are ever shared, never
-- who recommended it. Shown to people with a similar taste (a favourite
-- cuisine or interest in common) and counted on every pick ("Loved by 2
-- Feta users"). Removing their data removes their recommendations.

alter table public.pick_actions add column if not exists recommend boolean not null default false;

-- Favourites in a city for a category, most similar first, for the person
-- asking (their own places are left out; they're never new picks anyway).
create or replace function public.feta_favourites(p_city text, p_category text)
returns table (place_id text, lovers int, similar int)
language sql
security definer
set search_path = public
stable
as $$
  with my_yes as (
    select card_id from public.swipes
    where user_id = auth.uid() and verdict = 'yes' and card_id like 'cuisine_%'
  ),
  my_interests as (
    select coalesce((select interests from public.answers where user_id = auth.uid()), '{}'::text[]) as interests
  ),
  alike as (
    select distinct s.user_id from public.swipes s
    where s.verdict = 'yes' and s.card_id in (select card_id from my_yes)
    union
    select a.user_id from public.answers a, my_interests m
    where a.interests && m.interests
  )
  select p.place_id,
         count(distinct p.user_id)::int as lovers,
         count(distinct p.user_id) filter (where p.user_id in (select user_id from alike))::int as similar
  from public.pick_actions p
  where p.action = 'been' and p.verdict = 'loved' and p.recommend
    and p.city_id = p_city
    and (p_category is null or p.category = p_category)
    and p.user_id <> auth.uid()
  group by p.place_id
  order by 3 desc, 2 desc
  limit 30;
$$;

-- How many Feta users recommend each of these places (for the picks shown).
create or replace function public.feta_love_counts(p_place_ids text[])
returns table (place_id text, lovers int)
language sql
security definer
set search_path = public
stable
as $$
  select p.place_id, count(distinct p.user_id)::int
  from public.pick_actions p
  where p.action = 'been' and p.verdict = 'loved' and p.recommend
    and p.place_id = any (p_place_ids[1:40])
  group by p.place_id;
$$;

revoke all on function public.feta_favourites(text, text) from public;
revoke all on function public.feta_love_counts(text[]) from public;
grant execute on function public.feta_favourites(text, text) to authenticated;
grant execute on function public.feta_love_counts(text[]) to authenticated;
