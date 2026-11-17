-- Spend per person is a range now (founder, 17 Nov 2026: "tick all that
-- are fine"): the levels they ticked. An earlier single answer meant "up
-- to this much", so it becomes every level up to it; "Depends on the day"
-- stays as it is.
alter table public.answers
  alter column spend type text[] using (
    case
      when spend is null then '{}'::text[]
      when spend ~ '^level_[1-5]$' then (select array_agg('level_' || n) from generate_series(1, substring(spend from 7)::int) n)
      else array[spend]
    end
  );
alter table public.answers alter column spend set default '{}'::text[];
