-- Spend per person is a range now (founder, 17 Nov 2026: "tick all that
-- are fine"): the levels they ticked. An earlier single answer meant "up
-- to this much", so it becomes every level up to it; "Depends on the day"
-- stays as it is.
alter table public.answers
  alter column spend type text[] using (
    case spend
      when 'level_1' then array['level_1']
      when 'level_2' then array['level_1', 'level_2']
      when 'level_3' then array['level_1', 'level_2', 'level_3']
      when 'level_4' then array['level_1', 'level_2', 'level_3', 'level_4']
      when 'level_5' then array['level_1', 'level_2', 'level_3', 'level_4', 'level_5']
      else case when spend is null then '{}'::text[] else array[spend] end
    end
  );
alter table public.answers alter column spend set default '{}'::text[];
