-- The last step of audit round 2 (24 Nov 2026): the live app writes with
-- its own key (FETA_WRITE_KEY), so the n8n report key no longer works for
-- any write. The n8n reports keep checking the report key themselves.
create or replace function public.server_key_ok(p_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from write_keys where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'));
$$;
revoke all on function public.server_key_ok(text) from public, anon, authenticated;
