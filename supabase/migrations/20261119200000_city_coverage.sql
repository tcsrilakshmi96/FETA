-- City coverage (founder, 19 Nov 2026: Bengaluru had none of her Reddit
-- list and no one noticed): for each city where real people searched in
-- the last 30 days, or that has curated places, how many people searched
-- there and how many of her places and local favourites it has. Admins only.
create function public.city_coverage()
returns table (city_id text, city_name text, people bigint, founder bigint, local bigint)
language sql
stable
security definer set search_path = ''
as $$
  with searched as (
    select s.city_id, count(distinct s.user_id) as people
    from public.pick_sets s
    join public.usage_people(true) u on u.id = s.user_id
    where s.created_at > now() - interval '30 days'
    group by s.city_id
  ), curated as (
    select f.city_id, max(f.city_name) as city_name,
      count(*) filter (where f.source = 'founder') as founder,
      count(*) filter (where f.source = 'local') as local
    from public.founder_places f
    where f.active
    group by f.city_id
  )
  select coalesce(s.city_id, c.city_id), c.city_name, coalesce(s.people, 0), coalesce(c.founder, 0), coalesce(c.local, 0)
  from searched s
  full join curated c on c.city_id = s.city_id
  where public.is_admin()
  order by coalesce(s.people, 0) desc, coalesce(c.founder, 0) + coalesce(c.local, 0) desc;
$$;

revoke all on function public.city_coverage() from public;
grant execute on function public.city_coverage() to authenticated;
