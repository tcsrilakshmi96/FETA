-- Feedback from the pill on every screen. Private: people can send, only
-- the founder reads them (in the Supabase dashboard).
create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  message text not null,
  screen text, -- which page it was sent from, e.g. /picks
  screenshot text, -- small JPEG of that screen, if the person ticked it
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "send feedback" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());

-- Learning: Feta's own reason for a saved pick, so later picks can build
-- on what people saved (no Google content).
alter table public.pick_actions add column because text;

-- Profile lines can now also come from tweaks ("Likes quieter places").
alter table public.profile_lines drop constraint profile_lines_source_check;
alter table public.profile_lines add constraint profile_lines_source_check
  check (source in ('answers', 'swipes', 'checkin', 'chat', 'tweaks'));

-- Style · coming soon: "Tell me when it's ready" taps.
create table public.style_interest (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.style_interest enable row level security;

create policy "own style interest" on public.style_interest
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
