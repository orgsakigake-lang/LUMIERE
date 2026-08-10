-- ═══════════════════════════════════════════════════════════════════
-- LUMIÈRE — cloud gallery schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Everything is idempotent; running it twice is safe.
-- ═══════════════════════════════════════════════════════════════════

-- ————— profiles: one per user, holds the public share slug —————
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  slug       text unique check (slug ~ '^[a-z0-9-]{3,32}$'),
  created_at timestamptz not null default now()
);

-- ————— uploads: metadata for each image in the private collection —————
create table if not exists public.uploads (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'untitled',
  path       text not null,          -- storage object path: <owner>/<id>.jpg
  created_at timestamptz not null default now()
);
create index if not exists uploads_owner_idx on public.uploads(owner);

-- ————— placements: which upload hangs in which frame —————
-- k is the frame key "gx,gz:i" — a coordinate in the infinite gallery.
create table if not exists public.placements (
  owner      uuid not null references auth.users(id) on delete cascade,
  k          text not null,
  upload_id  uuid not null references public.uploads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, k)
);

-- ————— row level security —————
-- Private by default. A gallery is readable by anyone only once its owner
-- has published it; until then the owner is the only one who can see their
-- own rows. Writes are always owner-only. Do not weaken the checks.
--
-- Verify, do not assume: `npm run verify:sql` applies this whole file to a
-- throwaway PostgreSQL and asserts the policies actually behave. This file
-- once shipped with a single `$` where `$$` was required, which aborted the
-- entire script in the Supabase editor and applied nothing at all — while the
-- app and the docs both claimed galleries were private.
alter table public.profiles   enable row level security;
alter table public.uploads    enable row level security;
alter table public.placements enable row level security;

-- Opt-in publishing. Claiming a name no longer exposes the collection; you
-- claim the name, then decide to publish.
alter table public.profiles
  add column if not exists published boolean not null default false;

-- ————— what a work is called, and what it says —————
-- A drawing arrives named after whatever the file was called, which is rarely
-- what the artist would have written on the wall. `name` is the title on the
-- placard; `note` is the paragraph beside it. Added separately from the table
-- definition so a gallery created before this simply gains the column when
-- its owner re-runs this file — and the client reads `select=*` and treats a
-- missing `note` as empty, so nothing breaks in the meantime.
alter table public.uploads
  add column if not exists note text not null default '';

-- Owners can always see themselves. Everyone else sees only published
-- profiles, so an unpublished slug simply does not resolve.
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles write"  on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select
  using (published or auth.uid() = id);
create policy "profiles write"  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Helper so the read policies below stay legible and stay in one place.
create or replace function public.is_published(uid uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $fn$
  select exists (select 1 from public.profiles p where p.id = uid and p.published)
$fn$;

drop policy if exists "uploads read"   on public.uploads;
drop policy if exists "uploads write"  on public.uploads;
drop policy if exists "uploads update" on public.uploads;
drop policy if exists "uploads delete" on public.uploads;
create policy "uploads read"   on public.uploads for select
  using (auth.uid() = owner or public.is_published(owner));
-- Two guards beyond ownership. `path` must live under the owner's own folder,
-- or a row could point at somebody else's object; and a row-count ceiling, so
-- one account cannot fill the bucket. Both are enforceable in SQL — no server.
create policy "uploads write"  on public.uploads for insert with check (
  auth.uid() = owner
  and path like (auth.uid()::text || '/%')
  and (select count(*) from public.uploads u where u.owner = auth.uid()) < 500
);
-- Retitling a work, and writing what it says. This policy was missing until the
-- gallery first had a reason to update an upload — nothing ever did before —
-- and its absence is invisible from the client: with RLS on and no UPDATE
-- policy, *nobody* can update, the owner included. PostgREST then answers 200
-- with zero rows changed, which reads exactly like success. `using` decides
-- which rows may be touched; `with check` decides what they may become, so an
-- owner cannot hand a row to somebody else on the way past.
create policy "uploads update" on public.uploads for update
  using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "uploads delete" on public.uploads for delete using (auth.uid() = owner);

drop policy if exists "placements read"   on public.placements;
drop policy if exists "placements upsert" on public.placements;
drop policy if exists "placements update" on public.placements;
drop policy if exists "placements delete" on public.placements;
create policy "placements read"   on public.placements for select
  using (auth.uid() = owner or public.is_published(owner));
-- `k` is a frame key, "gx,gz:i". Unconstrained text let a script insert
-- millions of rows; bound the shape and the count.
create policy "placements upsert" on public.placements for insert with check (
  auth.uid() = owner
  and k ~ '^-?[0-9]{1,7},-?[0-9]{1,7}:[0-9]{1,2}$'
  and (select count(*) from public.placements p where p.owner = auth.uid()) < 2000
);
create policy "placements update" on public.placements for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "placements delete" on public.placements for delete using (auth.uid() = owner);

-- ————— storage —————
-- Read this before changing any of it; the two endpoints behave differently.
--
--   /storage/v1/object/public/loans/<path>   public bucket, NO auth, RLS bypassed
--   /storage/v1/object/list/loans            governed by SELECT on storage.objects
--   /storage/v1/object/loans/<path>          governed by SELECT on storage.objects
--
-- The bucket must stay public so a guest viewing a published gallery can fetch
-- images — they have no session to sign URLs with, and signing server-side
-- would mean running a server.
--
-- But SELECT was previously `using (bucket_id = 'loans')`, unconditional, which
-- governs the *list* endpoint. Anyone with the publishable key could enumerate
-- every owner folder and every object path, then fetch each one — published or
-- not. Scoping SELECT to the owner closes listing outright while leaving the
-- public fetch path (which never consults RLS) working for guests.
--
-- What remains, stated accurately: an object path is a UUID, and anyone holding
-- that exact string can still fetch it. Paths can no longer be discovered, only
-- shared. That is unguessability, not access control. Genuinely private images
-- need a private bucket plus an Edge Function signing URLs for guests.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('loans', 'loans', true, 12582912,          -- 12 MiB
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set
    public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "loans public read" on storage.objects;   -- the old open one
drop policy if exists "loans read"        on storage.objects;
drop policy if exists "loans own write"   on storage.objects;
drop policy if exists "loans own delete"  on storage.objects;

-- Owner-only. This is what stops enumeration.
create policy "loans read" on storage.objects
  for select using (bucket_id = 'loans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "loans own write" on storage.objects
  for insert with check (bucket_id = 'loans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "loans own delete" on storage.objects
  for delete using (bucket_id = 'loans' and (storage.foldername(name))[1] = auth.uid()::text);
