-- "Find more brands" (founder, 20 Nov 2026: "why isn't the AI doing research
-- on more brands? and there is no button for me to ask for more"): claims a
-- style in a country for another round even if it was researched before,
-- unless a round started in the last 15 minutes or finished in the last hour.
create or replace function public.start_style_research_more(p_key text, p_country text, p_style text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'Not allowed';
  end if;
  insert into style_research (country, style_id, found, done, started_at) values (p_country, p_style, 0, false, now())
  on conflict (country, style_id) do update set started_at = now(), done = false
    where (style_research.done and style_research.researched_at < now() - interval '1 hour')
       or (not style_research.done and (style_research.started_at is null or style_research.started_at < now() - interval '15 minutes'));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.start_style_research_more(text, text, text) from public;
grant execute on function public.start_style_research_more(text, text, text) to authenticated;
