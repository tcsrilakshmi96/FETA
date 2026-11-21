-- 21 Nov 2026: spend logged without a person (server work) still counts
-- toward real people's pool, and only signed-in people can read the budget.
create or replace function public.budget_today()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with since as (select (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') t),
  me as (select coalesce((select is_test from public.profiles where id = auth.uid()), false) is_test),
  testers as (select id from public.profiles where is_test),
  cost as (
    select c.est_inr, c.user_id, coalesce(c.user_id in (select id from testers), false) test
    from public.api_costs c
    where c.created_at >= (select t from since)
      and c.route not in ('admin', 'weekend', 'style_research', 'style_brand')
  ),
  sets as (
    select s.user_id, coalesce(s.user_id in (select id from testers), false) test
    from public.pick_sets s
    where s.created_at >= (select t from since)
  )
  select jsonb_build_object(
    'is_test', (select is_test from me),
    'pool', coalesce((select sum(est_inr) from cost where test = (select is_test from me)), 0),
    'mine', case when public.is_admin() then 0 else coalesce((select sum(est_inr) from cost where user_id = auth.uid()), 0) end,
    'searches', (select count(*) from sets where test = (select is_test from me)),
    'searches_mine', (select count(*) from sets where user_id = auth.uid())
  );
$$;

revoke all on function public.budget_today() from public, anon;
grant execute on function public.budget_today() to authenticated;
