-- The Screenshot column in the founder's sheet links straight to that
-- message on /admin (sign-in needed; the screenshot never leaves Feta).
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
      'screenshot', case when f.screenshot is not null then 'https://feta-beige.vercel.app/admin?f=' || f.id else '' end
    ) order by f.created_at)
    from public.feedback f
    where f.created_at >= since
  ), '[]'::jsonb);
end;
$$;
