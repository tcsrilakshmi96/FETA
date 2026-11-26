-- Security audit, 26 Nov 2026: inspiration photos must be pictures (a data:
-- URL of a JPEG, PNG or WebP), at most 8 and about 6 MB in all (the app
-- writes about 1-3 MB); and an account keeps at most 80 outfit pictures
-- (the app keeps the latest 60), so neither can be used to fill the
-- database. Safe to run more than once.
create or replace function public.all_image_urls(p_urls text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(u ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'), true) from unnest(p_urls) as u;
$$;

alter table public.style_inspiration drop constraint if exists style_inspiration_photos_check;
alter table public.style_inspiration add constraint style_inspiration_photos_check
  check (cardinality(photos) between 1 and 8 and length(array_to_string(photos, '')) < 6000000 and public.all_image_urls(photos));

create or replace function public.cap_look_pictures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.look_pictures where user_id = new.user_id) >= 80 then
    raise exception 'Too many outfit pictures kept';
  end if;
  return new;
end;
$$;

drop trigger if exists look_pictures_cap on public.look_pictures;
create trigger look_pictures_cap before insert on public.look_pictures
  for each row execute function public.cap_look_pictures();
