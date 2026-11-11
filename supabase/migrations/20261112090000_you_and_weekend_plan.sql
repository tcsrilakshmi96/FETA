-- The new You page, and the weekend plan the founder sends on WhatsApp.

-- Lines the person types on You ("Add something").
alter table public.profile_lines drop constraint profile_lines_source_check;
alter table public.profile_lines add constraint profile_lines_source_check
  check (source in ('answers', 'swipes', 'checkin', 'chat', 'tweaks', 'you'));

-- "This weekend" tick on a saved place: the Saturday it is for. Old ticks
-- simply stop counting once that weekend has passed.
alter table public.pick_actions add column if not exists weekend_for date;

-- Things they want to do this weekend, said in chat or typed in Lists
-- ("pottery with my sister"). Feta's own data, no Google content.
create table public.weekend_wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  for_date date not null, -- the Saturday
  created_at timestamptz not null default now()
);
alter table public.weekend_wishes enable row level security;
create policy "own weekend wishes" on public.weekend_wishes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Which weekend plans the founder has sent (admin only).
create table public.weekend_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  for_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, for_date)
);
alter table public.weekend_sent enable row level security;
create policy "founder marks plans sent" on public.weekend_sent
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admin only: everyone who added a WhatsApp number, with what their draft is
-- built from (place IDs, Feta's own reasons, their wishes and people lines).
-- Never diet.
create function public.weekend_plan_inputs(sat date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', p.id,
      'whatsapp', p.whatsapp_number,
      'cityId', p.city_id,
      'ticked', (
        select coalesce(jsonb_agg(jsonb_build_object('placeId', a.place_id, 'category', a.category, 'because', a.because, 'note', a.note)), '[]'::jsonb)
        from public.pick_actions a
        where a.user_id = p.id and a.action = 'saved' and a.weekend_for = sat
      ),
      'wishes', (
        select coalesce(jsonb_agg(w.text order by w.created_at), '[]'::jsonb)
        from public.weekend_wishes w
        where w.user_id = p.id and w.for_date = sat
      ),
      'picks', (
        select coalesce(jsonb_agg(latest.picks), '[]'::jsonb)
        from (
          select distinct on (ps.category) ps.category, ps.picks
          from public.pick_sets ps
          where ps.user_id = p.id and ps.when_slot = 'weekend' and ps.created_at > now() - interval '7 days'
          order by ps.category, ps.created_at desc
        ) latest
      ),
      'people', (
        select coalesce(jsonb_agg(l.text order by l.created_at), '[]'::jsonb)
        from public.profile_lines l
        where l.user_id = p.id and l.removed_at is null and l.trip is null and l.line_key like 'people:%'
      ),
      'sentAt', (
        select ws.sent_at from public.weekend_sent ws where ws.user_id = p.id and ws.for_date = sat
      )
    ) order by p.created_at)
    from public.profiles p
    where p.whatsapp_number is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.weekend_plan_inputs(date) from public;
grant execute on function public.weekend_plan_inputs(date) to authenticated;
