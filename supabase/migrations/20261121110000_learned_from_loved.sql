-- Founder, 21 Nov 2026: what Feta picked up from the places someone loves
-- ("Burmese", "garden cafés") shows in You under "Learned from places you
-- love", with ✕ to stop searching for it. Kept as profile lines from
-- 'loved' (Feta's own words, never a place's name).
alter table public.profile_lines drop constraint profile_lines_source_check;
alter table public.profile_lines add constraint profile_lines_source_check
  check (source in ('answers', 'swipes', 'checkin', 'chat', 'tweaks', 'you', 'skips', 'loved'));
