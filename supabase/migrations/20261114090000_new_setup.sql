-- New setup (14 Nov 2026, founder and Anj's flow): an optional first name
-- (asked before sign-in, so testers' feedback has a name), what they want
-- from Feta (food, things to do, style, trips), and foods they skip though
-- they eat meat ("No beef", "No pork"). The feedback sheet gets the name.

alter table public.profiles
  add column if not exists first_name text check (char_length(first_name) <= 40),
  add column if not exists wants text[] not null default '{}';

alter table public.answers
  add column if not exists avoid text[] not null default '{}';

create or replace function public.feedback_since(report_key text, since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.report_keys
    where key_hash = encode(sha256(convert_to(report_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'sent_at', to_char(f.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'),
      'screen', coalesce(f.screen, ''),
      'phone', case
        when f.user_agent ~ '(iPhone|iPad)' then 'iPhone'
        when f.user_agent ~ 'Android' then 'Android'
        else 'Computer' end,
      'message', f.message,
      'screenshot', case when f.screenshot is not null then 'https://feta-beige.vercel.app/admin?f=' || f.id else '' end,
      'name', coalesce(p.first_name, '')
    ) order by f.created_at)
    from public.feedback f
    left join public.profiles p on p.id = f.user_id
    where f.created_at >= since
  ), '[]'::jsonb);
end;
$$;
