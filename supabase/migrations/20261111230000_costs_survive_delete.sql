-- "Delete my data" must not erase what Feta spent: cost rows stay, without
-- any link to the person (so the daily cap and reports stay right).
alter table public.api_costs drop constraint api_costs_user_id_fkey;
alter table public.api_costs
  add constraint api_costs_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;
