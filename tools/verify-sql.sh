#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Apply supabase-setup.sql to a throwaway PostgreSQL and assert that
#  the row-level-security policies actually behave.
#
#  This exists because the setup script once shipped with a single `$`
#  where `$$` was required. The Supabase editor parses the whole file
#  before executing any of it, so the script aborted and applied
#  NOTHING — while the app, the docs and the release notes all claimed
#  galleries were private. Nobody caught it because nobody ran it.
#
#  Usage:  ./tools/verify-sql.sh        (needs docker)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

C=lumiere-sqlverify
IMG=postgres:16-alpine
fail=0

cleanup(){ docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=x -e POSTGRES_DB=lumiere "$IMG" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$C" psql -U postgres -d lumiere -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

psql_q(){ docker exec -i "$C" psql -U postgres -d lumiere -qtA "$@"; }

echo "→ applying shim"
docker exec -i "$C" psql -U postgres -d lumiere -v ON_ERROR_STOP=1 -q < tools/supabase-shim.sql

echo "→ creating anon / authenticated roles"
psql_q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, storage, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
SQL

echo "→ applying supabase-setup.sql (single transaction, as the Supabase editor does)"
if ! docker exec -i "$C" psql -U postgres -d lumiere -v ON_ERROR_STOP=1 --single-transaction -q \
      < supabase-setup.sql 2>&1 | grep -v '^NOTICE:'; then :; fi
docker exec -i "$C" psql -U postgres -d lumiere -v ON_ERROR_STOP=1 --single-transaction -q \
      < supabase-setup.sql >/dev/null 2>&1 || { echo "✗ setup script FAILED to apply"; exit 1; }

psql_q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
grant all on all tables in schema public to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
SQL

echo "→ seeding two users: one unpublished, one published"
psql_q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','private@x'),
  ('22222222-2222-2222-2222-222222222222','public@x');
insert into public.profiles (id, slug, published) values
  ('11111111-1111-1111-1111-111111111111','hidden-room', false),
  ('22222222-2222-2222-2222-222222222222','open-room',   true);
insert into public.uploads (id, owner, name, path) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','secret sketch','11111111-1111-1111-1111-111111111111/a.jpg'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','shown sketch','22222222-2222-2222-2222-222222222222/b.jpg');
insert into storage.buckets (id,name,public) values ('loans','loans',true) on conflict do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('loans','11111111-1111-1111-1111-111111111111/a.jpg','11111111-1111-1111-1111-111111111111'),
  ('loans','22222222-2222-2222-2222-222222222222/b.jpg','22222222-2222-2222-2222-222222222222');
SQL

# as_anon / as_user run a scalar query under RLS with the given identity
as_anon(){ psql_q -c "set role anon; select $1;"; }
as_user(){ psql_q -c "set role authenticated; set request.jwt.claim.sub = '$2'; select $1;"; }

# try_insert "<table+values>" <uid> → t if the insert succeeded, f if RLS blocked it
try_insert(){
  psql_q -c "set role authenticated; set request.jwt.claim.sub='$2'; insert into $1;" \
    >/dev/null 2>&1 && echo t || echo f
}

# rows_changed "<statement>" <uid|anon> → how many rows the write actually
# touched. RLS does not error on a blocked UPDATE or DELETE; it silently
# matches nothing, which is why "it returned 204" proves precisely nothing and
# the count is the only honest measure.
rows_changed(){
  local who="$2" pre=""
  if [ "$who" = anon ]; then pre="set role anon;"
  else pre="set role authenticated; set request.jwt.claim.sub='$who';"; fi
  psql_q -c "$pre with c as ($1 returning 1) select count(*) from c;" 2>/dev/null || echo ERR
}

check(){ # name expected actual
  if [ "$2" = "$3" ]; then printf '  ✓ %s\n' "$1"
  else printf '  ✗ %s — expected %s, got %s\n' "$1" "$2" "$3"; fail=1; fi
}

echo
echo "storage — the enumeration hole"
check "anon cannot list ANY object"              0 "$(as_anon "count(*) from storage.objects")"
check "owner lists only their own"               1 "$(as_user "count(*) from storage.objects" 11111111-1111-1111-1111-111111111111)"

echo
echo "uploads — metadata privacy"
check "anon sees only the published owner's"     1 "$(as_anon "count(*) from public.uploads")"
check "anon cannot see the unpublished upload"   0 "$(as_anon "count(*) from public.uploads where owner='11111111-1111-1111-1111-111111111111'")"
check "owner sees their own unpublished"         1 "$(as_user "count(*) from public.uploads where owner='11111111-1111-1111-1111-111111111111'" 11111111-1111-1111-1111-111111111111)"
# ...and published galleries stay visible to signed-in visitors too, which is
# what "published" means. Own (1) + the published owner's (1).
check "owner also sees published galleries"      2 "$(as_user "count(*) from public.uploads" 11111111-1111-1111-1111-111111111111)"

echo
echo "profiles — an unpublished slug must not resolve"
check "anon cannot resolve 'hidden-room'"        0 "$(as_anon "count(*) from public.profiles where slug='hidden-room'")"
check "anon can resolve 'open-room'"             1 "$(as_anon "count(*) from public.profiles where slug='open-room'")"

echo
echo "write guards"
check "path outside own folder is rejected"      f "$(try_insert "public.uploads (owner,name,path) values ('11111111-1111-1111-1111-111111111111','evil','22222222-2222-2222-2222-222222222222/steal.jpg')" 11111111-1111-1111-1111-111111111111)"
check "placement key shape is enforced"          f "$(try_insert "public.placements (owner,k,upload_id) values ('11111111-1111-1111-1111-111111111111','not-a-key','aaaaaaaa-0000-0000-0000-000000000001')" 11111111-1111-1111-1111-111111111111)"
check "a well-formed placement is accepted"      t "$(try_insert "public.placements (owner,k,upload_id) values ('11111111-1111-1111-1111-111111111111','3,-4:2','aaaaaaaa-0000-0000-0000-000000000001')" 11111111-1111-1111-1111-111111111111)"

echo
echo "a visitor cannot change anything"
# The realistic threat is not an anonymous reader — signup is open, so anyone
# can hold a valid session. VISITOR is a signed-in stranger: not the owner of
# anything here, which is exactly what a guest walking a published gallery is.
VISITOR=99999999-9999-9999-9999-999999999999
OWNER=11111111-1111-1111-1111-111111111111
check "anon cannot rehang a work"        0 "$(rows_changed "update public.placements set k='0,0:0'" anon)"
check "visitor cannot rehang a work"     0 "$(rows_changed "update public.placements set k='0,0:0'" $VISITOR)"
check "anon cannot unhang a work"        0 "$(rows_changed "delete from public.placements" anon)"
check "visitor cannot unhang a work"     0 "$(rows_changed "delete from public.placements" $VISITOR)"
check "visitor cannot rename a work"     0 "$(rows_changed "update public.uploads set name='defaced'" $VISITOR)"
check "visitor cannot delete a work"     0 "$(rows_changed "delete from public.uploads" $VISITOR)"
check "visitor cannot publish a gallery" 0 "$(rows_changed "update public.profiles set published=true" $VISITOR)"
check "visitor cannot steal a slug"      0 "$(rows_changed "update public.profiles set slug='taken'" $VISITOR)"
check "visitor cannot hang in your wing" f "$(try_insert "public.placements (owner,k,upload_id) values ('$OWNER','5,5:1','aaaaaaaa-0000-0000-0000-000000000001')" $VISITOR)"
check "visitor cannot remove your file"  0 "$(rows_changed "delete from storage.objects where bucket_id='loans'" $VISITOR)"
check "visitor cannot overwrite a file"  0 "$(rows_changed "update storage.objects set name='x.jpg' where bucket_id='loans'" $VISITOR)"
check "the owner still can rehang"       1 "$(rows_changed "update public.placements set k='3,-4:2' where owner='$OWNER'" $OWNER)"

# ————— what a work says —————
# `note` holds the description shown beside a work. It arrived after some
# galleries did, so it is added with `add column if not exists` and the client
# retries without it — which means "the column is missing" and "the column is
# there but unwritable" both degrade quietly, and neither would be noticed.
# Assert it exists, that its owner can write it, and that nobody else can.
check "a work has somewhere to say what it is" 1 \
  "$(psql_q -c "select count(*) from information_schema.columns
                where table_schema='public' and table_name='uploads' and column_name='note';")"
check "the owner can describe their own work"  1 \
  "$(rows_changed "update public.uploads set note='Graphite on cartridge paper.' where owner='$OWNER'" $OWNER)"
check "a visitor cannot rewrite your words"    0 \
  "$(rows_changed "update public.uploads set note='defaced'" $VISITOR)"
check "anon cannot rewrite your words"         0 \
  "$(rows_changed "update public.uploads set note='defaced'" anon)"
# `with check` is a separate clause from `using`, and only this asserts it: an
# owner may edit their row but may not edit it into somebody else's. Postgres
# raises on a with-check violation rather than matching nothing, so ERR is the
# pass — and a policy written with `using` alone would quietly return 1 here.
check "an owner cannot hand a work away"       ERR \
  "$(rows_changed "update public.uploads set owner='$VISITOR' where owner='$OWNER'" $OWNER)"

echo
echo "bucket limits"
check "file size limit is set"                   12582912 "$(psql_q -c "select file_size_limit from storage.buckets where id='loans'")"
check "mime allowlist is set"                    "{image/jpeg,image/png,image/webp}" "$(psql_q -c "select allowed_mime_types from storage.buckets where id='loans'")"

echo
[ "$fail" = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
