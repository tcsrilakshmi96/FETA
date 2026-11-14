-- Day plans on a trip are kept (founder, 14 Nov 2026: a saved trip should
-- show everything planned), as place IDs, times and Feta's own words only.
-- Names and photos are fetched live when the trip is opened.
alter table public.trips
  add column if not exists days jsonb not null default '{}'; -- {"<city index>": [{date, label, stops: [{time, slot, placeId, kind, travel}]}]}
