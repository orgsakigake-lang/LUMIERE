-- LUMIÈRE — additive migration for revocable bearer links.
-- This is intentionally separate from supabase-setup.sql. It creates no live
-- link and does not change existing public galleries or their object paths.

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz
);
create index if not exists share_links_owner_idx on public.share_links(owner);
create unique index if not exists one_active_share_link_per_owner
  on public.share_links(owner) where revoked_at is null;

alter table public.uploads add column if not exists bucket text not null default 'loans';
alter table public.uploads drop constraint if exists uploads_bucket_check;
alter table public.uploads add constraint uploads_bucket_check check (bucket in ('loans', 'private_loans'));

-- Publication of an old public gallery must not disclose new private metadata.
drop policy if exists "uploads read" on public.uploads;
create policy "uploads read" on public.uploads for select
  using (auth.uid() = owner or (bucket = 'loans' and public.is_published(owner)));
drop policy if exists "uploads update" on public.uploads;
create policy "uploads update" on public.uploads for update
  using (auth.uid() = owner)
  with check (auth.uid() = owner and path like (auth.uid()::text || '/%'));
drop policy if exists "placements read" on public.placements;
create policy "placements read" on public.placements for select
  using (auth.uid() = owner or (public.is_published(owner) and exists (
    select 1 from public.uploads u where u.id = upload_id and u.bucket = 'loans'
  )));

alter table public.share_links enable row level security;
drop policy if exists "share links owner read" on public.share_links;
drop policy if exists "share links owner write" on public.share_links;
drop policy if exists "share links owner update" on public.share_links;
create policy "share links owner read" on public.share_links
  for select using (auth.uid() = owner);
create policy "share links owner write" on public.share_links
  for insert with check (auth.uid() = owner);
create policy "share links owner update" on public.share_links
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- One transaction preserves the old working link if creation fails. Locking
-- the owner row also serializes simultaneous rotations for that account.
create or replace function public.rotate_gallery_share_link(owner_id uuid, new_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id = owner_id for update;
  if not found then raise exception 'unknown owner'; end if;
  update public.share_links set revoked_at = now()
    where owner = owner_id and revoked_at is null;
  insert into public.share_links (owner, token_hash) values (owner_id, new_token_hash);
end;
$$;
revoke all on function public.rotate_gallery_share_link(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_gallery_share_link(uuid, text) to service_role;

-- New private uploads belong in this bucket. Existing `loans` is deliberately
-- left untouched until each curator approves an object-by-object conversion.
insert into storage.buckets (id, name, public, file_size_limit,
  allowed_mime_types)
values ('private_loans', 'private_loans', false, 12582912,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "private loans owner read" on storage.objects;
drop policy if exists "private loans owner write" on storage.objects;
drop policy if exists "private loans owner delete" on storage.objects;
create policy "private loans owner read" on storage.objects for select
  using (bucket_id = 'private_loans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "private loans owner write" on storage.objects for insert
  with check (bucket_id = 'private_loans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "private loans owner delete" on storage.objects for delete
  using (bucket_id = 'private_loans' and (storage.foldername(name))[1] = auth.uid()::text);
