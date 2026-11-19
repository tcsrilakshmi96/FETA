-- What each set searched for (founder, 19 Nov 2026: changes in You didn't
-- seem to change the picks). The ids of the choices searched (cuisine_korean,
-- interest_comedy…), so the next set searches first what was never searched
-- or searched longest ago: a choice just added in You comes straight away.
alter table public.pick_sets add column if not exists searched text[] not null default '{}';
