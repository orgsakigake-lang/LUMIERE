// Authenticated owner lifecycle for revocable bearer links. The raw token is
// returned only on create/rotate and is never stored; the database keeps its
// SHA-256 digest instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, serviceKey);

function token() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body: { action?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const action = body.action;
  if (!['create', 'rotate', 'revoke'].includes(String(action))) return json({ error: 'invalid_action' }, 400);

  if (action === 'revoke') {
    const { error } = await admin.from('share_links').update({ revoked_at: new Date().toISOString() })
      .eq('owner', user.id).is('revoked_at', null);
    if (error) return json({ error: 'could_not_revoke' }, 500);
    return json({ revoked: true });
  }

  const raw = token();
  const { error } = await admin.rpc('rotate_gallery_share_link', {
    owner_id: user.id, new_token_hash: await digest(raw),
  });
  if (error) return json({ error: 'could_not_create' }, 500);
  return json({ token: raw, expiresIn: null });
});
