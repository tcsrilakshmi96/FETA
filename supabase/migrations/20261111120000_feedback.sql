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
