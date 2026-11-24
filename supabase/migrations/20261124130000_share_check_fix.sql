-- Shares were all refused (24 Nov 2026): the check's pattern asked for up
-- to 500 characters, and Postgres patterns allow at most 255.
create or replace function public.check_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  stops jsonb;
begin
  if pg_column_size(new.payload) > 20000 then raise exception 'Share too big'; end if;
  if length(coalesce(new.payload ->> 'title', '')) > 60 then raise exception 'Bad share'; end if;
  stops := case when new.kind = 'choice'
    then (select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(coalesce(new.payload -> 'options', '[]'::jsonb)) o, jsonb_array_elements(coalesce(o -> 'stops', '[]'::jsonb)) s)
    else coalesce(new.payload -> 'stops', '[]'::jsonb) end;
  if jsonb_array_length(stops) > 18 or jsonb_array_length(coalesce(new.payload -> 'options', '[]'::jsonb)) > 3 then raise exception 'Bad share'; end if;
  for st in select * from jsonb_array_elements(stops) loop
    -- Lengths are checked apart: Postgres patterns allow at most {255}
    -- (a {1,500} here refused every share, 24 Nov 2026).
    if not ((st ->> 'placeId' ~ '^event:https?://' and length(st ->> 'placeId') <= 520)
            or (coalesce(st ->> 'placeId', '') ~ '^[A-Za-z0-9_.-]+$' and length(st ->> 'placeId') between 10 and 300))
      or length(coalesce(st ->> 'because', '')) > 200 or length(coalesce(st ->> 'fetaNote', '')) > 1000 then
      raise exception 'Bad share';
    end if;
    if st ? 'event' then
      if coalesce(st #>> '{event,url}', '') !~ '^https?://' or length(coalesce(st #>> '{event,title}', '')) > 200
        or not exists (select 1 from pick_sets p where p.user_id = new.user_id and p.picks @> jsonb_build_array(jsonb_build_object('placeId', 'event:' || (st #>> '{event,url}')))) then
        raise exception 'Bad share';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
