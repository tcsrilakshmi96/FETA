-- Database health check (18 Nov 2026): what the live database has, for
-- Admin to compare with what the code expects (lib/schema-expected.json),
-- so a migration that never ran is named the same day. Admins only; names
-- of functions, tables and columns, never data.

create or replace function public.schema_objects()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object(
    'functions', (select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
    'tables', (select coalesce(jsonb_agg(table_name), '[]'::jsonb) from information_schema.tables where table_schema = 'public'),
    'columns', (select coalesce(jsonb_agg(table_name || '.' || column_name), '[]'::jsonb) from information_schema.columns where table_schema = 'public')
  );
end;
$$;

revoke all on function public.schema_objects() from public;
grant execute on function public.schema_objects() to authenticated;
