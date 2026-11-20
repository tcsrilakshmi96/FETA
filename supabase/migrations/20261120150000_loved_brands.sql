-- Brands people love (founder, 20 Nov 2026: "just like how people add cafes
-- or experience in the beginning we should also let people add some of
-- their favourite brands"). Added in Style setup, Style → Your styles, or
-- "Love it" in Saved → Brands. The founder's loved brands are ★ Feta Pick
-- (with her note); everyone else's, when they chose to recommend them,
-- show to others as "♥ Loved by N Feta users", never who.

create table public.loved_brands (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  recommend boolean not null default true,
  note text, -- shown only for the founder's (★ Feta Pick)
  country text,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);

alter table public.loved_brands enable row level security;
create policy "own loved brands" on public.loved_brands
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- For a set of brands: whether the founder loves it (her note), and how many
-- other people love and recommend it. Never who.
create or replace function public.brand_love(p_brand_ids uuid[])
returns table (brand_id uuid, feta_pick boolean, note text, lovers int)
language sql
security definer
set search_path = public
stable
as $$
  select l.brand_id,
    bool_or(a.email is not null) as feta_pick,
    max(case when a.email is not null then l.note end) as note,
    (count(distinct l.user_id) filter (where a.email is null and l.recommend))::int as lovers
  from public.loved_brands l
  join auth.users u on u.id = l.user_id
  left join public.admins a on a.email = u.email
  where l.brand_id = any (p_brand_ids[1:300])
  group by l.brand_id;
$$;

revoke all on function public.brand_love(uuid[]) from public;
grant execute on function public.brand_love(uuid[]) to authenticated;

-- A brand someone typed that wasn't in the library, looked up by Feta and
-- added as proposed (only Feta's server can call this).
create or replace function public.save_brand_lookup(p_key text, p_country text, p_row jsonb, p_styles text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid;
  s text;
begin
  if not exists (select 1 from report_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'Not allowed';
  end if;
  insert into brands (name, name_key, website, instagram, origin_country, wears, label_type)
  values (p_row->>'brand_name', p_row->>'name_key', p_row->>'website', p_row->>'instagram', p_row->>'origin_country', p_row->>'wears', p_row->>'label_type')
  on conflict (name_key) do update set website = coalesce(brands.website, excluded.website)
  returning id into b;
  if p_row->>'presence_type' is not null then
    insert into brand_markets (brand_id, country, presence_type, presence_url, price_feel, checked_date)
    values (b, p_country, p_row->>'presence_type', coalesce(p_row->>'presence_url', p_row->>'website'), nullif(p_row->>'price_feel', ''), current_date)
    on conflict (brand_id, country) do nothing;
  end if;
  foreach s in array p_styles loop
    if exists (select 1 from style_lenses where style_id = s) then
      insert into brand_styles (brand_id, style_id, association, visible_cues, collection_url, confidence, found_by, checked_date)
      values (b, s, 'adjacent', coalesce(p_row->>'visible_cues', '—'), p_row->>'website', 'written_evidence_only', 'feta', current_date)
      on conflict (brand_id, style_id) do nothing;
    end if;
  end loop;
  return b;
end;
$$;

revoke all on function public.save_brand_lookup(text, text, jsonb, text[]) from public;
grant execute on function public.save_brand_lookup(text, text, jsonb, text[]) to authenticated;
