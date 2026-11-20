-- Founder, 20 Nov 2026: "just approve all the brands… users can alter it,
-- they can add or edit the tags associated with the brands".
-- 1. Every brand-style found so far is approved, and new ones (Feta's
--    research, imports, lookups) arrive approved. She can still reject any
--    in Admin → Brands.
-- 2. Cord is maximalist too.
-- 3. People can add or remove a brand's style tags. Their own change shows
--    to them at once; when 2 people agree (and nobody cancels it out), it
--    changes the brand for everyone. A tag added this way is found_by
--    'people'; one removed this way is rejected (Admin can undo either).

update public.brand_styles set review_status = 'approved' where review_status = 'proposed';
alter table public.brand_styles alter column review_status set default 'approved';

alter table public.brand_styles drop constraint if exists brand_styles_found_by_check;
alter table public.brand_styles add constraint brand_styles_found_by_check check (found_by in ('import', 'feta', 'people', 'founder'));

insert into public.brand_styles (brand_id, style_id, association, visible_cues, confidence, found_by, review_status, checked_date)
select id, 'maximalist', 'adjacent', 'Bold prints and folk patterns', 'written_evidence_only', 'founder', 'approved', current_date
from public.brands where name_key = 'cord'
on conflict (brand_id, style_id) do update set review_status = 'approved';

create table public.brand_tag_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  style_id text not null references public.style_lenses (style_id),
  vote smallint not null check (vote in (1, -1)), -- 1 add the tag, -1 remove it
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id, style_id)
);

alter table public.brand_tag_votes enable row level security;
create policy "own tag votes" on public.brand_tag_votes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- When people agree, the brand changes for everyone.
create or replace function public.apply_tag_votes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid := coalesce(new.brand_id, old.brand_id);
  s text := coalesce(new.style_id, old.style_id);
  net int;
begin
  select coalesce(sum(vote), 0) into net from brand_tag_votes where brand_id = b and style_id = s;
  if net >= 2 then
    insert into brand_styles (brand_id, style_id, association, visible_cues, confidence, found_by, review_status, checked_date)
    values (b, s, 'adjacent', 'Tagged by Feta users', 'written_evidence_only', 'people', 'approved', current_date)
    on conflict (brand_id, style_id) do update set review_status = 'approved'
      where brand_styles.found_by = 'people' or brand_styles.review_status = 'rejected';
  elsif net <= -2 then
    update brand_styles set review_status = 'rejected' where brand_id = b and style_id = s and found_by <> 'founder';
  end if;
  return null;
end;
$$;

create trigger brand_tag_votes_apply after insert or update or delete on public.brand_tag_votes
  for each row execute function public.apply_tag_votes();
