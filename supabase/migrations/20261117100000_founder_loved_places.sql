-- Places the founder loves in the app (at the start, Saved → Been, the
-- check-in) are Feta Picks too, with her note (founder, 17 Nov 2026). The
-- server adds them, and takes them out again if she changes her mind;
-- places from her own list are never changed. No Google content: the name
-- column is only her label for places she added to the list herself.
alter table public.founder_places alter column name drop not null;
alter table public.founder_places add column if not exists from_app boolean not null default false;
