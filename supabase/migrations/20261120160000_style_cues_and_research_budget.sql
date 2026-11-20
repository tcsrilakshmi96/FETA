-- Founder, 20 Nov 2026 ("it feels like a hardcoded thing and AI is not
-- really using any logic"):
-- 1. What Feta saw in their photos, in style words only ("oversized blazer,
--    straight jeans"; never the photos), so brands and outfit ideas are
--    chosen for them, not listed in library order.
-- 2. Building the brand library (Feta's own research and brand lookups) is
--    the founder's investment, like admin work: it no longer counts toward
--    the daily cap that pauses everyone's picks, and has its own daily cap.

alter table public.style_profiles add column if not exists cues text[] not null default '{}';

create or replace function public.spend_today_inr()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(est_inr), 0) from public.api_costs
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and route not in ('admin', 'weekend', 'style_research', 'style_brand');
$$;

create or replace function public.library_spend_today_inr()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(est_inr), 0) from public.api_costs
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and route in ('style_research', 'style_brand');
$$;

revoke all on function public.library_spend_today_inr() from public;
grant execute on function public.library_spend_today_inr() to authenticated;
