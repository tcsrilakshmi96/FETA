-- The founder's admin work (checking Instagram places, drafting weekend
-- plans) is still logged, but no longer counts toward the daily spending
-- cap that pauses searches for testers.
create or replace function public.spend_today_inr()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(est_inr), 0) from public.api_costs
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and route not in ('admin', 'weekend');
$$;

select public.spend_today_inr() as counted_today_inr;
