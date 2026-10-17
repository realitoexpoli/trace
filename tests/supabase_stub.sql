-- Minimal stand-in for Supabase's auth schema and roles, for testing the migration on plain Postgres.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Like Supabase: pgcrypto is installed in its own "extensions" schema, not in public.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text);
alter table auth.users add column if not exists email_confirmed_at timestamptz default now();
create function auth.uid() returns uuid language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
