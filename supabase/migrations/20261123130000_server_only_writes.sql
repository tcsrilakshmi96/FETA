-- Only Feta's server writes what everyone shares (backend audit, 23 Nov
-- 2026). Before this, any signed-in account could write the shared events
-- cache (whose Google Search chip is shown as given, so a planted row could
-- run a script for everyone in a city) and add rows to the cost log (enough
-- of them stop picks for everyone for the day). Both now go through
-- functions that check Feta's server key (the report key, kept in Vercel),
-- like save_brand_lookup. Safe to run more than once.

drop policy if exists "add events" on public.events_cache;
drop policy if exists "refresh events" on public.events_cache;
drop policy if exists "log own costs" on public.api_costs;
drop policy if exists "add own hits" on public.api_hits;

create or replace function public.server_key_ok(p_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'));
$$;
revoke all on function public.server_key_ok(text) from public, anon, authenticated;

-- A day's events, guide posts or Featured in places for a city, kept for
-- at most 48 hours.
create or replace function public.save_events_cache(p_key text, p_cache_key text, p_events jsonb, p_html text, p_hours numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into events_cache (key, events, search_html, expires_at)
  values (left(p_cache_key, 300), coalesce(p_events, '[]'::jsonb), coalesce(p_html, ''), now() + make_interval(secs => (least(greatest(coalesce(p_hours, 0), 0), 48) * 3600)::double precision))
  on conflict (key) do update set events = excluded.events, search_html = excluded.search_html, expires_at = excluded.expires_at;
end;
$$;
revoke all on function public.save_events_cache(text, text, jsonb, text, numeric) from public, anon;
grant execute on function public.save_events_cache(text, text, jsonb, text, numeric) to authenticated;

-- What one request spent, as the person who asked (none for a friend
-- opening a shared place, which counts toward everyone's day).
create or replace function public.log_costs(p_key text, p_costs jsonb, p_hit jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  insert into api_costs (user_id, route, sku, units, est_inr)
  select auth.uid(), left(c->>'route', 40), left(c->>'sku', 60), least(greatest((c->>'units')::int, 1), 100), least(greatest((c->>'est_inr')::numeric, 0), 500)
  from jsonb_array_elements(coalesce(p_costs, '[]'::jsonb)) c;
  if p_hit is not null then
    insert into api_hits (user_id, route, fingerprint, label, cost_inr, services, ms)
    values (auth.uid(), left(p_hit->>'route', 40), left(p_hit->>'fingerprint', 40), left(p_hit->>'label', 80), least(greatest(coalesce((p_hit->>'cost_inr')::numeric, 0), 0), 99999), coalesce(p_hit->'services', '{}'::jsonb), (p_hit->>'ms')::int);
  end if;
end;
$$;
revoke all on function public.log_costs(text, jsonb, jsonb) from public;
grant execute on function public.log_costs(text, jsonb, jsonb) to anon, authenticated;

-- Today's spend by real people and shared-place visitors (India time), for
-- a lookup with no account (a friend opening a shared place).
create or replace function public.real_spend_today(p_key text)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.server_key_ok(p_key) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select sum(c.est_inr) from api_costs c
    where c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      and c.route not in ('admin', 'weekend', 'style_research', 'style_brand')
      and (c.user_id is null or c.user_id not in (select id from profiles where is_test))
  ), 0);
end;
$$;
revoke all on function public.real_spend_today(text) from public;
grant execute on function public.real_spend_today(text) to anon, authenticated;
