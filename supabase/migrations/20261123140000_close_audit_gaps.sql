-- The audit's smaller gaps, closed (founder, 23 Nov 2026: "I want all of
-- them closed"). Safe to run more than once.

-- 1. Only someone with the tester code can mark their account as a test
-- one (test accounts have their own budget pool). Before, ?qa=1 let anyone
-- move themselves into it. The code is kept in .env.local as
-- QA_CODE; only its hash is here.
create table if not exists public.qa_codes (code_hash text primary key);
alter table public.qa_codes enable row level security;
insert into public.qa_codes (code_hash) values ('d8c32467c626d05880964ba5a96b2131f23b57b6c9ce1dcb48ab283d7aa99f0f') on conflict do nothing;

create or replace function public.guard_is_test()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('feta.marking_test', true), '') <> 'yes' then
    if tg_op = 'INSERT' then
      new.is_test := false;
    else
      new.is_test := old.is_test;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_is_test on public.profiles;
create trigger profiles_guard_is_test before insert or update on public.profiles
  for each row execute function public.guard_is_test();

create or replace function public.mark_test(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from qa_codes where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')) then
    return false;
  end if;
  perform set_config('feta.marking_test', 'yes', true);
  update profiles set is_test = true where id = auth.uid();
  perform set_config('feta.marking_test', '', true);
  return true;
end;
$$;
revoke all on function public.mark_test(text) from public, anon;
grant execute on function public.mark_test(text) to authenticated;

-- 2. Brand style tags: votes never decide for everyone on their own. Only
-- people signed in with Google (not test accounts) count, it takes 3, and
-- what they agree on goes to Admin → Brands as "to review" (a new tag), or
-- back to review (a tag they say is wrong); nothing Admin rejected comes
-- back. Each person's own change still shows for them at once.
create or replace function public.apply_tag_votes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid := coalesce(new.brand_id, old.brand_id);
  s text := coalesce(new.style_id, old.style_id);
  net int;
begin
  select coalesce(sum(v.vote), 0) into net
  from brand_tag_votes v
  join auth.users u on u.id = v.user_id
  left join profiles p on p.id = v.user_id
  where v.brand_id = b and v.style_id = s and not coalesce(u.is_anonymous, false) and not coalesce(p.is_test, false);
  if net >= 3 then
    insert into brand_styles (brand_id, style_id, association, visible_cues, confidence, found_by, review_status, checked_date)
    values (b, s, 'adjacent', 'Tagged by Feta users', 'written_evidence_only', 'people', 'proposed', current_date)
    on conflict (brand_id, style_id) do nothing;
  elsif net <= -3 then
    update brand_styles set review_status = 'proposed'
    where brand_id = b and style_id = s and found_by <> 'founder' and review_status = 'approved';
  end if;
  return null;
end;
$$;

-- 3. Totals that need no sign-in to read no longer answer signed-out visitors.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('brand_love', 'spend_today_inr', 'library_spend_today_inr', 'feta_love_counts', 'my_share_replies')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end;
$$;
