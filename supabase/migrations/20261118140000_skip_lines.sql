-- Not my vibe (18 Nov 2026): what a skip taught Feta ("Not into brewpubs",
-- "Prefers quieter places") is a line in You like any other, from "skips".
alter table public.profile_lines drop constraint profile_lines_source_check;
alter table public.profile_lines add constraint profile_lines_source_check
  check (source in ('answers', 'swipes', 'checkin', 'chat', 'tweaks', 'you', 'skips'));
