-- A share can only point at the sharer's own saved plan (security audit,
-- 26 Nov 2026: shares.plan_id wasn't checked; Plan my evening now saves plans).
create or replace function public.check_share_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_id is not null and not exists (
    select 1 from public.saved_plans p where p.id = new.plan_id and p.user_id = new.user_id
  ) then
    raise exception 'That plan is not yours to share';
  end if;
  return new;
end;
$$;

drop trigger if exists share_plan_owner on public.shares;
create trigger share_plan_owner
  before insert or update of plan_id, user_id on public.shares
  for each row execute function public.check_share_plan();
