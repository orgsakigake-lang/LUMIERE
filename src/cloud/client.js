/* ═══════════════════════════════════════════════════════════════════
   The cloud — Supabase over plain fetch, no SDK.

   This module talks to the network and nothing else. It never touches the
   DOM, the curator's collection, or the render scheduler: the read calls
   return plain data and the caller decides what to do with it. That
   boundary matters more than it looks — it is what lets an archived copy
   of the gallery degrade gracefully when this backend is not there, and
   what makes the layer testable without a live project.

   Auth is a six-digit email code; the session refreshes itself; every
   write is guarded server-side by row level security. When unconfigured
   the whole module stays dormant and the gallery is purely local.
   ═══════════════════════════════════════════════════════════════════ */
import { CLOUD_URL, CLOUD_KEY, PRIVATE_SHARING } from '../config.js';
import { galleryLink, SLUG_SHAPE } from './gallery-link.js';

export const cloud = (() => {
  let url = CLOUD_URL, key = CLOUD_KEY;
  try {
    const o = JSON.parse(localStorage.getItem('lumiere_cloud') || 'null');
    if (o && o.url && o.key){ url = o.url; key = o.key; }
  } catch(e){}
  return { url: url.replace(/\/+$/, ''), key, on: !!(url && key), privateSharing: PRIVATE_SHARING,
           sess: null, viewing: null, slug: null, published: false, shareToken: null, shareLink: null };
})();

/* Injection seam. cfetch used to close over the global fetch, which made the
   whole layer untestable without a live project. */
let _fetch = (...a) => globalThis.fetch(...a);
export function setFetch(fn){ _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function cloudSaveSess(d){
  if (!d){ cloud.sess = null; try { localStorage.removeItem('lumiere_sess'); } catch(e){} return; }
  cloud.sess = {
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600)*1000 - 90000,
    uid: d.user ? d.user.id : cloud.sess && cloud.sess.uid,
    email: d.user ? d.user.email : cloud.sess && cloud.sess.email,
  };
  try { localStorage.setItem('lumiere_sess', JSON.stringify(cloud.sess)); } catch(e){}
}

/* Told when a session is genuinely gone, so the office can stop claiming to be
   signed in. Without this the sign-out is silent: the panel still says "signed
   in · loans open everywhere", every write goes out with the anonymous key,
   row-level security matches nothing, and PostgREST answers 200 — the same
   zero-rows trap, arrived at from the other direction. */
let onAuthLost = null;
export function setAuthLost(fn){ onAuthLost = fn || null; }

async function cloudRefresh(){
  if (!cloud.sess) return false;
  let rs;
  try {
    rs = await _fetch(cloud.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { apikey: cloud.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cloud.sess.refresh_token }),
    });
  } catch(e){
    /* The *network* failed, not the token. Dropping the session here — which is
       what this used to do — signed a visitor out for walking into a tunnel,
       and took the queued writes' only route home with it. Keep it; the next
       attempt can try again. */
    return false;
  }
  if (rs.ok){
    try {
      const d = await rs.json();
      d.user = d.user || { id: cloud.sess.uid, email: cloud.sess.email };
      cloudSaveSess(d);
      return true;
    } catch(e){ return false; }
  }
  /* A refused refresh is the real thing: the token is spent or revoked, and no
     amount of retrying will help. Say so out loud. */
  cloudSaveSess(null);
  if (onAuthLost){ try { onAuthLost(); } catch(e){} }
  return false;
}

/* The single outbound choke point: auth headers, expiry refresh, 401 retry. */
async function cfetch(path, opts = {}, retry = true){
  if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();
  const headers = Object.assign({
    apikey: cloud.key,
    Authorization: 'Bearer ' + (cloud.sess ? cloud.sess.access_token : cloud.key),
  }, opts.headers || {});
  const signal = opts.signal || ((!opts.method || opts.method === 'GET') ? AbortSignal.timeout(15000) : undefined);
  const rs = await _fetch(cloud.url + path, Object.assign({}, opts, { headers, signal }));
  if (rs.status === 401 && cloud.sess && retry && await cloudRefresh())
    return cfetch(path, opts, false);
  return rs;
}

/* ————— auth ————— */

export async function cloudSendCode(email){
  const rs = await cfetch('/auth/v1/otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!rs.ok) throw new Error((await rs.json().catch(()=>({}))).msg || 'could not send the code');
}

/* ————— password sign-in —————
   The OTP flow depends on Supabase actually delivering an email, and its
   built-in mailer is rate-limited to a couple an hour and explicitly not for
   production — and its default templates send a confirmation *link* rather
   than the code this flow needs, so a fresh project cannot sign anyone in
   until someone edits a template.

   For a gallery with one curator that is a lot of moving parts between a
   person and their own drawings. A password needs no mail server, no
   template, and no rate limit. Row-level security is unchanged either way:
   the session is what it is, and the policies decide what it can do. */
export async function cloudPassword(email, password){
  const rs = await cfetch('/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await rs.json().catch(() => ({}));
  if (!rs.ok || !d.access_token)
    throw new Error(d.msg || d.error_description || d.error || 'that did not sign you in');
  cloudSaveSess(d);
}
/** Create the account, then sign in with it. Supabase returns a session
 *  directly when email confirmation is off, and nothing when it is on. */
export async function cloudSignUp(email, password){
  const rs = await cfetch('/auth/v1/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await rs.json().catch(() => ({}));
  if (!rs.ok) throw new Error(d.msg || d.error_description || d.error || 'could not create that account');
  if (d.access_token){ cloudSaveSess(d); return 'signed-in'; }
  return 'confirm';                 // a confirmation mail was sent instead
}

/** What this project will actually do when somebody tries to sign up. Readable
 *  with the publishable key, and worth reading *before* the visitor finds out
 *  the slow way.
 *
 *  `mailer_autoconfirm: false` means every new account waits on a confirmation
 *  email — and Supabase's built-in sender is rate-limited to a couple an hour
 *  and explicitly not for production, so on a fresh project that mail very
 *  often simply never arrives. The account exists, the password is right, and
 *  every sign-in fails with "Email not confirmed" forever. Nothing in the
 *  gallery can fix that; it is one toggle in their dashboard. But the gallery
 *  can at least say so instead of showing a spinner and a lie. */
export async function cloudAuthSettings(){
  try {
    const rs = await cfetch('/auth/v1/settings');
    if (!rs.ok) return null;
    const d = await rs.json();
    const ext = d.external || {};
    return { autoconfirm: !!d.mailer_autoconfirm,
             signupDisabled: !!d.disable_signup,
             emailEnabled: !!ext.email, google: !!ext.google, github: !!ext.github };
  } catch(e){ return null; }
}

/* ————— signing in with somebody else's account —————
   No SDK, so this is the bare OAuth redirect: hand the visitor to Supabase,
   which hands them to Google, which hands them back here with the session in
   the URL *fragment*. The fragment is deliberate on Supabase's part — it never
   reaches a server, not ours and not GitHub's, so the token cannot end up in
   an access log. It does end up in the address bar, which is why takeHashSession
   below erases it the moment it has been read.

   This is the same mechanism behind the confirmation link that once arrived
   pointing at `localhost:3000/#access_token=…`: not a broken link, a correct
   one aimed at a redirect URL nobody had configured. Which is the whole risk
   here — the provider has to be enabled in Supabase *and* this exact origin
   listed under URL Configuration, or the round trip ends on an error page. */
export function cloudOAuthURL(provider, returnTo){
  const back = returnTo || (location.origin + location.pathname + location.search);
  return cloud.url + '/auth/v1/authorize?provider=' + encodeURIComponent(provider)
       + '&redirect_to=' + encodeURIComponent(back);
}
export function cloudOAuth(provider){ location.href = cloudOAuthURL(provider); }

/** Read a session out of the URL fragment on the way back in, and take the
 *  fragment out of the address bar. Returns true if one was found. */
export function takeHashSession(){
  const h = (location.hash || '').replace(/^#/, '');
  if (!h || h.indexOf('access_token=') < 0) return false;
  const p = new URLSearchParams(h);
  const access_token = p.get('access_token');
  if (!access_token) return false;
  cloudSaveSess({
    access_token,
    refresh_token: p.get('refresh_token'),
    expires_in: +(p.get('expires_in') || 3600),
    /* No user object comes back in the fragment; uid is read from the token
       itself. It is a JWT, and `sub` is the id every RLS policy compares
       against — so getting this wrong means every read returns nothing. */
    user: { id: jwtSub(access_token), email: null },
  });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch(e){ location.hash = ''; }
  return true;
}
/* Decode only. Nothing here trusts the contents — the server verifies the
   signature on every request; this just needs the id to ask about. */
function jwtSub(tok){
  try {
    const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '==='.slice((b.length + 3) % 4))).sub || null;
  } catch(e){ return null; }
}

export async function cloudVerify(email, token){
  const rs = await cfetch('/auth/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', email, token }),
  });
  const d = await rs.json().catch(() => ({}));
  if (!rs.ok || !d.access_token) throw new Error(d.msg || d.error_description || 'that code was not accepted');
  cloudSaveSess(d);
}

/* ————— storage and rows ————— */

export function cloudPublicURL(path){
  return cloud.url + '/storage/v1/object/public/loans/' + path;
}

async function cloudPrivateURL(path){
  const rs = await cfetch('/storage/v1/object/sign/private_loans/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  const data = await rs.json().catch(() => ({}));
  if (!rs.ok || typeof data.signedURL !== 'string') throw new Error('could not load private artwork');
  return data.signedURL.startsWith('http') ? data.signedURL
    : cloud.url + (data.signedURL.startsWith('/storage/v1/') ? '' : '/storage/v1') + data.signedURL;
}

/* `note` is newer than some galleries. A project whose owner has not re-run
   supabase-setup.sql has no such column, and PostgREST rejects the whole write
   rather than ignoring the field — which would turn "your description did not
   save" into "your image did not upload". So a rejected write is retried
   without it: the drawing lands either way, and the words follow once the
   migration is applied. */
async function writeUpload(path, body, method = 'POST', extra = null){
  const send = (b) => cfetch(path, {
    method,
    headers: Object.assign(
      { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, extra),
    body: JSON.stringify(b),
  });
  let rs = await send(body);
  if (!rs.ok && 'note' in body){
    const { note, ...rest } = body;
    if (Object.keys(rest).length) rs = await send(rest);
  }
  return rs;
}

export async function cloudUploadBlob(name, blob, note = ''){
  const id = crypto.randomUUID();
  const path = cloud.sess.uid + '/' + id + '.jpg';
  /* A year, and immutable, because these objects genuinely are: the path is a
     UUID minted here and nothing ever writes to it again — a change is a new
     row with a new path. Supabase defaults to an hour, which for a gallery
     somebody shares is the difference between a visitor paying the egress once
     and paying it every time they come back. The free tier is 5 GB a month and
     a collection of lossless drawings is tens of megabytes a visit, so this is
     most of the arithmetic. */
  const bucket = cloud.privateSharing ? 'private_loans' : 'loans';
  const rs0 = await cfetch('/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg',
               'cache-control': 'max-age=31536000, immutable' },
    body: blob,
  });
  if (!rs0.ok) throw new Error('image upload failed');
  const rs = await writeUpload('/rest/v1/uploads',
    { id, owner: cloud.sess.uid, name, path, note, ...(cloud.privateSharing ? { bucket } : {}) });
  if (!rs.ok) {
    await cfetch('/storage/v1/object/' + bucket + '/' + path, { method: 'DELETE' }).catch(() => {});
    throw new Error('could not record the upload');
  }
  return { id, path, bucket };
}

/** Replace a work's image with an edited one — same row, same id, so every
 *  placement pointing at it stays put. The objects themselves are immutable
 *  (a year of cache says so, and a CDN believes it), so an edit is a new
 *  object at a fresh path, the row repointed, and only then the old object
 *  deleted. That order is the whole design: fail at any step and the gallery
 *  still renders — either the untouched original, or the finished edit —
 *  never a path with nothing behind it. */
export async function cloudReplaceBlob(id, oldPath, blob, bucket = 'loans'){
  if (!['loans', 'private_loans'].includes(bucket)) throw new Error('unknown artwork bucket');
  const path = cloud.sess.uid + '/' + crypto.randomUUID() + '.jpg';
  const rs0 = await cfetch('/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg',
               'cache-control': 'max-age=31536000, immutable' },
    body: blob,
  });
  if (!rs0.ok) return { ok: false };
  const upd = await cloudUpdateUpload(id, { path });
  if (!upd.ok){
    /* The row still names the old object; the orphan is ours to sweep. */
    cfetch('/storage/v1/object/' + bucket + '/' + path, { method: 'DELETE' }).catch(() => {});
    return { ok: false };
  }
  cfetch('/storage/v1/object/' + bucket + '/' + oldPath, { method: 'DELETE' }).catch(() => {});
  return { ok: true, path };
}

/** Retitle a work, or rewrite what it says. Idempotent and keyed by id, so the
 *  outbox can collapse twenty edits of the same row into the last one.
 *
 *  Asks for the row back and counts it, rather than trusting the status. A
 *  policy that forbids the write does not fail the request — it matches no
 *  rows, and PostgREST answers 200 for having done nothing. That is not a
 *  hypothetical: `uploads` had no UPDATE policy at all when this function was
 *  written, so every edit returned 200 and every edit was discarded, and the
 *  outbox would have marked each one sent. A write that changed nothing is a
 *  write that failed, and the queue is allowed to know. */
export async function cloudUpdateUpload(id, patch){
  const rs = await writeUpload('/rest/v1/uploads?id=eq.' + id, patch, 'PATCH',
                               { Prefer: 'return=representation' });
  if (!rs.ok) return { ok: false };
  const rows = await rs.json().catch(() => null);
  return { ok: Array.isArray(rows) && rows.length > 0, rows: rows ? rows.length : 0 };
}

/* Deletes report what happened rather than swallowing it. A half-failed
   delete leaves the row and the object disagreeing, and the caller is the
   only one that can decide whether to keep the local record. */
export async function cloudDeleteUpload(rec){
  const bucket = rec.bucket || 'loans';
  if (!['loans', 'private_loans'].includes(bucket)) throw new Error('unknown artwork bucket');
  const [obj, row] = await Promise.allSettled([
    cfetch('/storage/v1/object/' + bucket + '/' + rec.path, { method: 'DELETE' }),
    cfetch('/rest/v1/uploads?id=eq.' + rec.id, { method: 'DELETE' }),
  ]);
  const good = (r) => r.status === 'fulfilled' && r.value.ok;
  return { ok: good(obj) && good(row), object: good(obj), row: good(row) };
}

export async function cloudSetPlacement(k, uploadId){
  const rs = await cfetch('/rest/v1/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ owner: cloud.sess.uid, k, upload_id: uploadId }),
  });
  return { ok: rs.ok };
}

/** Insert a placement only if its frame is still empty. Migration uses this
 * instead of the normal upsert so a cloud hanging created on another device
 * can never be overwritten by a stale local snapshot. */
export async function cloudInsertPlacement(k, uploadId){
  const rs = await cfetch('/rest/v1/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ owner: cloud.sess.uid, k, upload_id: uploadId }),
  });
  return { ok: rs.ok, status: rs.status };
}

export async function cloudDelPlacement(k){
  const rs = await cfetch('/rest/v1/placements?owner=eq.' + cloud.sess.uid +
                          '&k=eq.' + encodeURIComponent(k), { method: 'DELETE' });
  return { ok: rs.ok };
}

/** Publish or unpublish. Claiming a name does not expose anything on its own;
 *  until this is on, the RLS policies hide the collection from everyone else
 *  and the slug does not resolve. */
export async function cloudSetPublished(on){
  const rs = await cfetch('/rest/v1/profiles?id=eq.' + cloud.sess.uid, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ published: !!on }),
  });
  if (!rs.ok) throw new Error('could not change who can see this gallery — has supabase-setup.sql been re-run?');
  const rows = await rs.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== cloud.sess.uid || rows[0].published !== !!on)
    throw new Error('sharing was not saved — check your sign-in and database policies');
  cloud.published = !!on;
  return { ok: true };
}

/** Manage the one active bearer link for the signed-in curator. The raw token
 * is returned only to the caller so it can be copied into a link; it is never
 * persisted by this module. */
export async function cloudManageShareLink(action){
  if (!cloud.privateSharing) throw new Error('private sharing is not enabled on this gallery');
  if (!cloud.sess) throw new Error('sign in before managing a private link');
  if (!['create', 'rotate', 'revoke'].includes(action)) throw new TypeError('invalid share action');
  const rs = await cfetch('/functions/v1/manage-share-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await rs.json().catch(() => ({}));
  if (!rs.ok) throw new Error(data.error || 'could not change the private link');
  return data;
}

/** The gallery theme travels with the profile, so a guest at the shared link
 *  stands in the light the curator hung the work under. A project whose owner
 *  has not re-run supabase-setup.sql has no `theme` column and PostgREST
 *  refuses the whole write — that is a nicety missing, not a loss, so any
 *  4xx is treated as sent rather than clogging the outbox forever. */
export async function cloudSetTheme(name){
  const rs = await cfetch('/rest/v1/profiles?id=eq.' + cloud.sess.uid, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ theme: String(name || '') }),
  });
  return { ok: rs.ok || (rs.status >= 400 && rs.status < 500) };
}

export async function cloudClaimSlug(slug){
  if (!cloud.sess) throw new Error('sign in before claiming a gallery name');
  const rs = await cfetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ id: cloud.sess.uid, slug }),
  });
  let rows = [];
  try { rows = await rs.json(); } catch(e){}
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!rs.ok || !row || row.id !== cloud.sess.uid || row.slug !== slug)
    throw new Error('that name is taken or invalid (a–z, 0–9, dashes)');
  cloud.slug = slug;
  cloud.published = !!row.published;
}

/* ————— reads —————
   These return data. They used to write straight into the curator's
   collection and then call flashHint, updateHudStat and syncArtJobs — the
   network layer driving the HUD and kicking the render scheduler. */

/* `select=*` rather than a column list, for the same reason `profiles` uses it:
   `note` is absent from any project whose owner has not re-run the schema, and
   naming a column PostgREST does not have fails the whole request — which would
   empty a visitor's collection rather than merely omit their descriptions. */
const asUpload = (row, url = null) => ({ id: row.id, name: row.name, path: row.path,
                             note: row.note || '',
                             bucket: row.bucket || 'loans',
                             url: url || row.url || (row.bucket === 'private_loans' ? null : cloudPublicURL(row.path)), cloudRec: true });
const rowsOf = async (rs) => {
  if (!rs.ok) throw new Error(`collection request failed (${rs.status})`);
  const rows = await rs.json();
  if (!Array.isArray(rows)) throw new Error('invalid collection response');
  return rows;
};

/** The signed-in visitor's own collection. */
export async function cloudLoadMine(){
  if (!cloud.sess) return null;
  const [ur, pr, sr] = await Promise.all([
    cfetch('/rest/v1/uploads?owner=eq.' + cloud.sess.uid + '&select=*&order=created_at'),
    cfetch('/rest/v1/placements?owner=eq.' + cloud.sess.uid + '&select=k,upload_id'),
    cfetch('/rest/v1/profiles?id=eq.' + cloud.sess.uid + '&select=*'),
  ]);
  const [uploads, placements, profiles] = await Promise.all([rowsOf(ur), rowsOf(pr), rowsOf(sr)]);
  const me = profiles[0];
  const records = await Promise.all(uploads.map(async row => asUpload(row,
    row.bucket === 'private_loans' ? await cloudPrivateURL(row.path) : null)));
  for (const record of records) if (record.bucket === 'private_loans') record.urlExpiresAt = Date.now() + 3_590_000;
  cloud.slug = me ? me.slug : null;
  /* Absent before the RLS migration is applied; absent means not published. */
  cloud.published = !!(me && me.published);
  return {
    uploads: records,
    placements: placements.map((row) => [row.k, row.upload_id]),
    slug: cloud.slug, published: cloud.published,
    theme: me ? me.theme || null : null,
  };
}

/** Somebody else's gallery, read-only. Returns null if no such name. */
export async function cloudLoadGallery(slug){
  cloud.viewing = null;
  if (!SLUG_SHAPE.test(slug)) return null;
  // Published links must behave identically for every visitor, even when this
  // browser holds an unrelated or expired owner session. Never refresh it here.
  const read = path => _fetch(cloud.url + path, {
    headers: { apikey: cloud.key, Authorization: 'Bearer ' + cloud.key },
    signal: AbortSignal.timeout(15000),
  });
  /* select=* for the same schema-tolerance reason as everywhere else: `theme`
     is newer than some projects, and naming an absent column fails the whole
     request — which would read as "no such gallery". */
  const rows = await rowsOf(await read(
    '/rest/v1/profiles?slug=eq.' + encodeURIComponent(slug) + '&select=*'));
  if (!rows[0]) return null;
  const owner = rows[0].id;
  const [ur, pr] = await Promise.all([
    read('/rest/v1/uploads?owner=eq.' + owner + '&select=*'),
    read('/rest/v1/placements?owner=eq.' + owner + '&select=k,upload_id'),
  ]);
  const [uploads, placements] = await Promise.all([rowsOf(ur), rowsOf(pr)]);
  const publicUploads = uploads.filter(row => !row.bucket || row.bucket === 'loans');
  const publicIds = new Set(publicUploads.map(row => row.id));
  const data = {
    slug, owner, theme: rows[0].theme || null,
    uploads: publicUploads.map(row => asUpload(row)),
    placements: placements.filter(row => publicIds.has(row.upload_id)).map((row) => [row.k, row.upload_id]),
  };
  cloud.viewing = { slug, owner };
  return data;
}

async function cloudLoadShare(token, ids){
  const rs = await _fetch(cloud.url + '/functions/v1/share-gallery', {
    method: 'POST',
    headers: { apikey: cloud.key, Authorization: 'Bearer ' + cloud.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...(ids ? { ids } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await rs.json().catch(() => ({}));
  if ([401, 403, 404, 410].includes(rs.status)) return null;
  if (!rs.ok) throw new Error(`private collection request failed (${rs.status})`);
  if (!body.gallery || !Array.isArray(body.gallery.uploads) || !Array.isArray(body.gallery.placements))
    throw new Error('invalid private collection response');
  const gallery = body.gallery;
  const urlExpiresAt = Date.now() + Math.max(0, Math.min(60, Number(body.expiresIn) || 60) - 5) * 1000;
  if (gallery.uploads.some(row => !row || typeof row.url !== 'string' || !/^https?:\/\//.test(row.url)))
    throw new Error('invalid private artwork response');
  const data = {
    slug: gallery.slug || 'private collection', owner: null,
    theme: gallery.theme || null,
    uploads: gallery.uploads.map(row => ({ ...asUpload(row, row.url), urlExpiresAt })),
    placements: (gallery.placements || []).map(row => Array.isArray(row) ? row : [row.k, row.upload_id]),
  };
  cloud.viewing = { slug: data.slug, owner: null, private: true };
  cloud.shareToken = token;
  return data;
}

const renewingArt = new WeakMap();
/** Resolve private assets just before use; no timer or token persistence. */
export async function cloudArtworkURL(record) {
  if (!record.cloudRec && !record.urlExpiresAt || record.url?.startsWith('blob:')) return record.url;
  if (!record.urlExpiresAt || record.urlExpiresAt > Date.now()) return record.url;
  if (renewingArt.has(record)) return renewingArt.get(record);
  const renewal = (async () => {
    if (cloud.shareToken) {
      const data = await cloudLoadShare(cloud.shareToken, [record.id]);
      const fresh = data?.uploads.find(row => row.id === record.id);
      if (!fresh) throw new Error('this artwork is no longer shared');
      record.url = fresh.url; record.urlExpiresAt = fresh.urlExpiresAt;
    } else if (cloud.sess && record.bucket === 'private_loans') {
      record.url = await cloudPrivateURL(record.path);
      record.urlExpiresAt = Date.now() + 3_590_000;
    } else throw new Error('private artwork is unavailable');
    return record.url;
  })();
  renewingArt.set(record, renewal);
  try { return await renewal; } finally { renewingArt.delete(record); }
}

/** Restore a session and load whatever this URL asks for.
 *  Returns {mode, data} — 'guest', 'mine', 'none', 'off', 'missing' when a
 *  ?gallery= name matched nothing, or 'unreachable' when the network failed.
 *  Never throws: the seeded gallery does not need any of this, and an outage
 *  must not stop the Curator's Office from initialising. */
export async function cloudBoot(){
  cloud.viewing = null;
  const link = galleryLink(location.search, location.hash);
  const shareToken = link.private ? link.token : cloud.shareToken;
  if (link.requested && !(link.private ? link.token : link.slug)) return { mode: 'missing', data: { slug: null } };
  if (!cloud.on) return { mode: 'off', data: null };
  if (shareToken){
    cloud.sess = null;
    cloud.shareToken = shareToken;
    try {
      const data = await cloudLoadShare(shareToken);
      try { history.replaceState(null, '', location.pathname + location.search); } catch(e){ location.hash = ''; }
      return data ? { mode: 'guest', data } : { mode: 'missing', data: { slug: null } };
    } catch (error) {
      return { mode: 'unreachable', data: null, error: String(error.message || error) };
    }
  }
  if (link.requested) {
    try {
      const data = await cloudLoadGallery(link.slug);
      return data ? { mode: 'guest', data } : { mode: 'missing', data: { slug: link.slug } };
    } catch (error) {
      return { mode: 'unreachable', data: null, error: String(error.message || error) };
    }
  }
  /* Before the stored session, because a fragment means the visitor has just
     come back from a provider and that is newer than whatever is on disk. */
  const viaRedirect = takeHashSession();
  if (!viaRedirect){
    try { const s = JSON.parse(localStorage.getItem('lumiere_sess') || 'null'); if (s) cloud.sess = s; } catch(e){}
  }

  try {
    if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();

    if (cloud.sess) return { mode: 'mine', data: await cloudLoadMine() };
    return { mode: 'none', data: null };
  } catch (e){
    /* Distinguished from 'missing' deliberately. Telling a visitor "no gallery
       answers to that name" when the project is merely asleep is a lie. */
    return { mode: 'unreachable', data: null, error: String(e && e.message || e) };
  }
}
