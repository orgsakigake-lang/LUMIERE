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
-- Galleries are meant to be walked: reads are public (that is the share
-- feature); writes are strictly owner-only. Do not weaken the checks.
alter table public.profiles   enable row level security;
alter table public.uploads    enable row level security;
alter table public.placements enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles write"  on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (true);
create policy "profiles write"  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "uploads read"   on public.uploads;
drop policy if exists "uploads write"  on public.uploads;
drop policy if exists "uploads delete" on public.uploads;
create policy "uploads read"   on public.uploads for select using (true);
create policy "uploads write"  on public.uploads for insert with check (auth.uid() = owner);
create policy "uploads delete" on public.uploads for delete using (auth.uid() = owner);

drop policy if exists "placements read"   on public.placements;
drop policy if exists "placements upsert" on public.placements;
drop policy if exists "placements update" on public.placements;
drop policy if exists "placements delete" on public.placements;
create policy "placements read"   on public.placements for select using (true);
create policy "placements upsert" on public.placements for insert with check (auth.uid() = owner);
create policy "placements update" on public.placements for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "placements delete" on public.placements for delete using (auth.uid() = owner);

-- ————— storage: one public-read bucket, owner-scoped writes —————
insert into storage.buckets (id, name, public)
  values ('loans', 'loans', true)
  on conflict (id) do update set public = true;

drop policy if exists "loans public read" on storage.objects;
drop policy if exists "loans own write"   on storage.objects;
drop policy if exists "loans own delete"  on storage.objects;
create policy "loans public read" on storage.objects
  for select using (bucket_id = 'loans');
create policy "loans own write" on storage.objects
  for insert with check (bucket_id = 'loans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "loans own delete" on storage.objects
  for delete using (bucket_id = 'loans' and (storage.foldername(name))[1] = auth.uid()::text);
