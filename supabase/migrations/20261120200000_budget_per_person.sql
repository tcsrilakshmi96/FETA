-- Audit, 20 Nov 2026.
-- 1. One person can't use up the whole day's budget: today's spend for the
--    person asking (admins count as 0, so the founder's testing never stops).
-- 2. Only the server can set where the founder's places are (it signs with
--    the report key); before, any signed-in person could move them.

create or replace function public.spend_today_inr_mine()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select case when public.is_admin() then 0 else coalesce((
    select sum(est_inr) from public.api_costs
    where user_id = auth.uid()
      and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      and route not in ('admin', 'weekend', 'style_research', 'style_brand')
  ), 0) end;
$$;

revoke all on function public.spend_today_inr_mine() from public;
grant execute on function public.spend_today_inr_mine() to authenticated;

drop function if exists public.locate_founder_places(jsonb);

create or replace function public.locate_founder_places(p_key text, p_places jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'Not allowed';
  end if;
  update public.founder_places f
  set lat = (x ->> 'lat')::double precision,
      lng = (x ->> 'lng')::double precision,
      located_at = now()
  from jsonb_array_elements(p_places) x
  where f.place_id = x ->> 'place_id'
    and (f.located_at is null or f.located_at < now() - interval '25 days')
    and abs((x ->> 'lat')::double precision) <= 90
    and abs((x ->> 'lng')::double precision) <= 180;
end;
$$;

revoke all on function public.locate_founder_places(text, jsonb) from public;
grant execute on function public.locate_founder_places(text, jsonb) to authenticated;
