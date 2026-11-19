-- Local favourites (founder, 19 Nov 2026): places locals recommend, from the
-- founder's research, kept with her own places: Google place ID, name, kind
-- and city only (no note, nothing from where the list came from). Where they
-- are is kept for up to 30 days, like hers. They come before Google's places
-- when they fit, show as "Local favourite", and never appear in the ★ Feta
-- Picks sheet, the Admin list or the "★ Feta Picks in <city>" count.
alter table public.founder_places add column if not exists source text not null default 'founder';
alter table public.founder_places drop constraint if exists founder_places_source_check;
alter table public.founder_places add constraint founder_places_source_check check (source in ('founder', 'local'));
create index if not exists founder_places_city on public.founder_places (city_id, source) where active;
