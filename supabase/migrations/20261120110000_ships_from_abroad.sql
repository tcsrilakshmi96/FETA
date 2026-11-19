-- A brand that only ships into a country from abroad (duties may apply) is
-- kept apart from one that sells there (founder's rule, 19 Nov 2026:
-- "international shipping" is a filter, never the default). The India test
-- counted LoveShackFancy and House of CB as selling in India.
alter table public.brand_markets drop constraint if exists brand_markets_presence_type_check;
alter table public.brand_markets add constraint brand_markets_presence_type_check
  check (presence_type in ('stores', 'own site delivers here', 'official local site', 'ships from abroad'));

-- The India test's brands that only ship in from abroad.
update public.brand_markets set presence_type = 'ships from abroad'
where country = 'IN' and brand_id in (select id from public.brands where name_key in ('loveshackfancy', 'forlovelemons', 'houseofcb', 'needlethread', 'sisterjane'));
