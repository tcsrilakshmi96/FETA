-- Who's in (founder, 17 Nov 2026): the person who shared a plan sees their
-- friends' In / Out replies in the app (Home pill, Saved → Plans), not only
-- by opening their own link. A share can belong to a saved plan, and
-- replies newer than replies_seen_at count as new. Friends' names are only
-- what they typed when they replied.

alter table public.shares add column plan_id uuid references public.saved_plans (id) on delete set null;
alter table public.shares add column replies_seen_at timestamptz;

create index shares_user on public.shares (user_id, created_at desc);

-- Replies to my own shares, in one call.
create function public.my_share_replies()
returns table (slug text, name text, vote text, replied_at timestamptz)
language sql
security definer set search_path = ''
stable
as $$
  select v.slug, v.name, v.vote, v.created_at
  from public.share_votes v
  join public.shares s on s.slug = v.slug
  where s.user_id = auth.uid()
  order by v.created_at;
$$;

grant execute on function public.my_share_replies() to authenticated;
