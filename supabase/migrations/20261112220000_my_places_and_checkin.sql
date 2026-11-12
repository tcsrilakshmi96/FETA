-- "My places" and check-in (founder, 12 Nov 2026): places people add
-- themselves or tell Feta about after an outing. Place IDs and their own
-- words only (no Google content).

-- On a "been" row: how often they go, how it was, and (for Jain, vegan or
-- halal users) whether it worked for their diet.
alter table public.pick_actions add column if not exists visits text
  check (visits in ('once', 'few', 'regular'));
alter table public.pick_actions add column if not exists verdict text
  check (verdict in ('loved', 'fine', 'not_for_me'));
alter table public.pick_actions add column if not exists diet_ok boolean;
-- On a "saved" row: when Feta last asked "How was it?", so it asks once.
alter table public.pick_actions add column if not exists checkin_asked_at timestamptz;
