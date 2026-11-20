-- Founder, 20 Nov 2026:
-- 1. A 37th style, Basics: everyday plain tees, regular jeans and simple
--    layers (Spykar, Flying Machine, Jack & Jones fit somewhere). Styles
--    overlap, so a brand may sit under several.
-- 2. Feta researches every style in a country when someone there asks:
--    one style at a time, each claimed first so two phones never research
--    the same one, redone after 120 days.
-- 3. (Same as 20261120110000, safe to run again) brands that only ship in
--    from abroad are kept apart.

insert into public.style_lenses (style_id, name, family, label_type, definition, visible_signals, keep_separate)
values (
  'basics',
  'Everyday basics',
  'Restraint and polish',
  'Everyday wardrobe lens',
  'Plain, easy everyday clothes worn as they are: tees, regular jeans, simple shirts, hoodies and sneakers, chosen for comfort and ease rather than a look.',
  'Plain or small-logo tees, regular or straight jeans, chinos, simple shirts and polos, plain hoodies and sweatshirts, everyday dresses, white or simple sneakers; few prints, no statement pieces.',
  'Not minimalist (which is deliberate, refined and pared back) and not streetwear (oversized, graphic, sneaker culture). Plain denim alone fits here.'
)
on conflict (style_id) do update set name = excluded.name, definition = excluded.definition, visible_signals = excluded.visible_signals, keep_separate = excluded.keep_separate;

alter table public.style_research add column if not exists started_at timestamptz;
alter table public.style_research add column if not exists done boolean not null default true;

-- Claims one style in one country for research; false if it was researched
-- in the last 120 days or someone started it in the last 15 minutes.
create or replace function public.start_style_research(p_key text, p_country text, p_style text)
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
    where (style_research.done and style_research.researched_at < now() - interval '120 days')
       or (not style_research.done and (style_research.started_at is null or style_research.started_at < now() - interval '15 minutes'));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.start_style_research(text, text, text) from public;
grant execute on function public.start_style_research(text, text, text) to authenticated;

create or replace function public.save_style_research(p_key text, p_country text, p_style text, p_rows jsonb, p_search_html text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  b uuid;
  n int := 0;
begin
  if not exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'Not allowed';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into brands (name, name_key, website, instagram, origin_country, wears, label_type)
    values (r->>'brand_name', r->>'name_key', r->>'website', r->>'instagram', r->>'origin_country', r->>'wears', r->>'label_type')
    on conflict (name_key) do update set website = coalesce(brands.website, excluded.website), instagram = coalesce(brands.instagram, excluded.instagram)
    returning id into b;
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, sample_price, sample_currency, sample_item, checked_date)
    values (b, p_country, r->>'presence_type', r->>'presence_url', nullif(r->>'price_feel', ''), (r->>'sample_price')::numeric, r->>'sample_currency', r->>'sample_item', current_date)
    on conflict (brand_id, country) do nothing;
    insert into brand_styles (brand_id, style_id, association, visible_cues, collection_url, editorial_url, similar_reference, confidence, found_by, checked_date)
    values (b, p_style, r->>'association', r->>'visible_cues', r->>'collection_url', r->>'editorial_url', r->>'similar_reference', r->>'confidence', 'feta', current_date)
    on conflict (brand_id, style_id) do update set visible_cues = excluded.visible_cues, collection_url = excluded.collection_url, checked_date = excluded.checked_date
      where brand_styles.review_status = 'proposed';
    n := n + 1;
  end loop;
  insert into style_research (country, style_id, found, search_html, done) values (p_country, p_style, n, p_search_html, true)
  on conflict (country, style_id) do update set researched_at = now(), found = excluded.found, search_html = excluded.search_html, done = true;
  return n;
end;
$$;

alter table public.brand_markets drop constraint if exists brand_markets_presence_type_check;
alter table public.brand_markets add constraint brand_markets_presence_type_check
  check (presence_type in ('stores', 'own site delivers here', 'official local site', 'ships from abroad'));
update public.brand_markets set presence_type = 'ships from abroad'
where country = 'IN' and brand_id in (select id from public.brands where name_key in ('loveshackfancy', 'forlovelemons', 'houseofcb', 'needlethread', 'sisterjane'));
