// Anonymous read boundary for revocable bearer links.
// Deploy separately after applying supabase-secret-links.sql. The browser never
// receives a service key; this function is the only place that may mint asset URLs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { isOwnedAsset } from '../_shared/asset-path.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(supabaseUrl, serviceKey);
const maxAge = 60;

async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

Deno.serve(async request => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body: { token?: unknown; ids?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!validToken(body.token)) return json({ error: 'unavailable' }, 404);
  const digest = await tokenHash(body.token);
  const { data: link, error: linkError } = await admin.from('share_links').select('owner,expires_at,revoked_at')
    .eq('token_hash', digest).is('revoked_at', null).maybeSingle();
  if (linkError) return json({ error: 'collection_unavailable' }, 503);
  if (!link || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) return json({ error: 'unavailable' }, 404);

  const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string').slice(0, 100) : null;
  const { data: profile, error: profileError } = await admin.from('profiles').select('slug,theme').eq('id', link.owner).maybeSingle();
  let uploadsQuery = admin.from('uploads').select('id,name,note,path,bucket').eq('owner', link.owner);
  if (ids?.length) uploadsQuery = uploadsQuery.in('id', ids);
  const { data: uploads, error: uploadsError } = await uploadsQuery;
  const { data: placements, error: placementsError } = await admin.from('placements').select('k,upload_id').eq('owner', link.owner);
  if (profileError || uploadsError || placementsError) return json({ error: 'collection_unavailable' }, 503);
  const visible = uploads ?? [];
  if (visible.some(upload => !isOwnedAsset(link.owner, upload))) return json({ error: 'artwork_unavailable' }, 503);
  const withUrls = await Promise.all(visible.map(async upload => {
    if (upload.bucket === 'loans') {
      return { ...upload, url: `${supabaseUrl}/storage/v1/object/public/loans/${upload.path}` };
    }
    const { data } = await admin.storage.from('private_loans').createSignedUrl(upload.path, maxAge);
    return { ...upload, url: data?.signedUrl ?? null };
  }));
  if (withUrls.some(upload => !upload.url)) return json({ error: 'artwork_unavailable' }, 503);
  return json({ gallery: { slug: profile?.slug ?? null, theme: profile?.theme ?? null,
    uploads: withUrls, placements: placements ?? [] }, expiresIn: maxAge });
});
