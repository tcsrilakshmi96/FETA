-- Style brand discovery (founder, 19–20 Nov 2026). Three layers, kept apart:
-- 1. Reference: her workbook (36 style lenses, 93 example brands, their
--    style links, cues, sample prices and sources). Calibration examples
--    that teach the research what fits a style, never answers by themselves.
-- 2. Live library: brands people can buy from in a country, each style tag
--    with the evidence seen in the current collection, proposed until the
--    founder approves it in Admin. Filled from research she runs elsewhere
--    (imported) and from Feta's own research when a country has none.
-- 3. Each person's style profile comes later, with the screens; their likes
--    and skips never change a brand's tags.
-- Everyone signed in can read; only admins change the library. Feta's own
-- research saves through save_style_research().

create table public.style_lenses (
  style_id text primary key,
  name text not null,
  family text not null,
  label_type text,
  definition text not null,
  visible_signals text not null,
  keep_separate text
);

create table public.style_reference_brands (
  brand_id text primary key, -- B001…
  name text not null,
  country text not null,
  region text,
  label_type text,
  sample_category text,
  cues text, -- garment and styling cues that make the matches work
  scope_limits text,
  evidence text, -- inspected imagery and writing, or writing only
  origin_note text,
  prices jsonb not null default '[]', -- [{category, a, b, currency, context, checked}]
  sources jsonb not null default '[]' -- [{id, url, purpose, checked}]
);

create table public.style_reference_links (
  style_id text not null references public.style_lenses (style_id) on delete cascade,
  brand_id text not null references public.style_reference_brands (brand_id) on delete cascade,
  association text not null check (association in ('main', 'adjacent')),
  primary key (style_id, brand_id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null unique, -- lower-case name, letters and digits only
  website text,
  instagram text,
  origin_country text, -- ISO code
  wears text check (wears in ('women', 'men', 'unisex', 'women+men')),
  label_type text,
  logo_url text, -- from the brand's own site; the founder can replace it
  link_ok boolean, -- website answered when last checked
  link_checked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Where a brand sells: one row per country, with the proof.
create table public.brand_markets (
  brand_id uuid not null references public.brands (id) on delete cascade,
  country text not null, -- ISO code
  presence_type text not null check (presence_type in ('stores', 'own site delivers here', 'official local site')),
  presence_url text not null,
  presence_ok boolean,
  price_feel text check (price_feel in ('budget', 'mid', 'premium', 'luxury')),
  sample_price numeric,
  sample_currency text,
  sample_item text,
  checked_date date,
  primary key (brand_id, country)
);

create table public.brand_styles (
  brand_id uuid not null references public.brands (id) on delete cascade,
  style_id text not null references public.style_lenses (style_id),
  association text not null check (association in ('main', 'adjacent')),
  visible_cues text not null,
  collection_url text,
  collection_ok boolean,
  editorial_url text,
  similar_reference text,
  confidence text not null check (confidence in ('verified_collection', 'written_evidence_only', 'unverified_lead')),
  review_status text not null default 'proposed' check (review_status in ('proposed', 'approved', 'rejected')),
  found_by text not null check (found_by in ('import', 'feta')),
  checked_date date,
  primary key (brand_id, style_id)
);
create index brand_styles_style on public.brand_styles (style_id, review_status);

-- When Feta last researched a style in a country itself.
create table public.style_research (
  country text not null,
  style_id text not null references public.style_lenses (style_id),
  researched_at timestamptz not null default now(),
  found int not null default 0,
  search_html text, -- Google's Search chip, shown with brands Feta found
  primary key (country, style_id)
);

alter table public.style_lenses enable row level security;
alter table public.style_reference_brands enable row level security;
alter table public.style_reference_links enable row level security;
alter table public.brands enable row level security;
alter table public.brand_markets enable row level security;
alter table public.brand_styles enable row level security;
alter table public.style_research enable row level security;

create policy "read style lenses" on public.style_lenses for select to authenticated using (true);
create policy "read reference brands" on public.style_reference_brands for select to authenticated using (true);
create policy "read reference links" on public.style_reference_links for select to authenticated using (true);
create policy "read brands" on public.brands for select to authenticated using (true);
create policy "read brand markets" on public.brand_markets for select to authenticated using (true);
create policy "read brand styles" on public.brand_styles for select to authenticated using (review_status <> 'rejected' or public.is_admin());
create policy "read style research" on public.style_research for select to authenticated using (true);

create policy "admins change brands" on public.brands for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins change brand markets" on public.brand_markets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins change brand styles" on public.brand_styles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Feta's own research for one style in one country: brands, where they
-- sell, and the style tag with its evidence, all proposed. A tag the
-- founder already approved or rejected keeps her decision. Only Feta's
-- server can call it (the same private key as the weekly report).
create function public.save_style_research(p_key text, p_country text, p_style text, p_rows jsonb, p_search_html text)
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
  insert into style_research (country, style_id, found, search_html) values (p_country, p_style, n, p_search_html)
  on conflict (country, style_id) do update set researched_at = now(), found = excluded.found, search_html = excluded.search_html;
  return n;
end;
$$;

revoke all on function public.save_style_research(text, text, text, jsonb, text) from public;
grant execute on function public.save_style_research(text, text, text, jsonb, text) to authenticated;
