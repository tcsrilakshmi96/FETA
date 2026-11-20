-- The brand import read three country names as retired codes (France as FX,
-- the United Kingdom as UK, Serbia as YU), so those brands never showed for
-- people there (cities use FR, GB, RS). Moved to the current codes.
update public.brand_markets m set country = v.new
from (values ('FX', 'FR'), ('UK', 'GB'), ('YU', 'RS')) as v(old, new)
where m.country = v.old
  and not exists (select 1 from public.brand_markets x where x.brand_id = m.brand_id and x.country = v.new);
delete from public.brand_markets where country in ('FX', 'UK', 'YU');
update public.brands set origin_country = case origin_country when 'FX' then 'FR' when 'UK' then 'GB' when 'YU' then 'RS' end
where origin_country in ('FX', 'UK', 'YU');
update public.style_research set country = case country when 'FX' then 'FR' when 'UK' then 'GB' when 'YU' then 'RS' end
where country in ('FX', 'UK', 'YU');
