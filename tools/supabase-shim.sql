-- ═══════════════════════════════════════════════════════════════════
-- A minimal stand-in for the Supabase-managed schemas, so
-- supabase-setup.sql can be executed against a plain PostgreSQL and
-- actually verified rather than assumed.
--
-- This shim is NOT part of the deployment. It exists so `npm run
-- verify:sql` can catch what a human reviewer did not: the setup script
-- once shipped with a single `$` where `$$` was required, which aborted
-- the whole file in the Supabase editor and silently applied nothing.
-- ═══════════════════════════════════════════════════════════════════

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

/* Supabase reads the JWT claim; a session variable is enough to exercise
   the policies. Returns NULL when unset, which is the anonymous case. */
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

/* Splits an object path into its segments, as Supabase does. */
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;
