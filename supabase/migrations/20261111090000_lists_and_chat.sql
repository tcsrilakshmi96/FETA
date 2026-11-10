-- Lists: a private note on each saved or been place.
alter table public.pick_actions add column note text;

-- Ask Feta: the chat history, private to each person.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Anything the reply showed: mini picks (place IDs and Feta's text only),
  -- profile lines it added, trip context.
  extras jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_user on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

create policy "own chat" on public.chat_messages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
