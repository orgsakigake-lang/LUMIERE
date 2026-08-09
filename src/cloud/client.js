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
import { CLOUD_URL, CLOUD_KEY } from '../config.js';

export const cloud = (() => {
  let url = CLOUD_URL, key = CLOUD_KEY;
  try {
    const o = JSON.parse(localStorage.getItem('lumiere_cloud') || 'null');
    if (o && o.url && o.key){ url = o.url; key = o.key; }
  } catch(e){}
  return { url: url.replace(/\/+$/, ''), key, on: !!(url && key),
           sess: null, viewing: null, slug: null, published: false };
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

async function cloudRefresh(){
  if (!cloud.sess) return false;
  try {
    const rs = await _fetch(cloud.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cloud.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cloud.sess.refresh_token }),
    });
    if (!rs.ok) throw 0;
    const d = await rs.json();
    d.user = d.user || { id: cloud.sess.uid, email: cloud.sess.email };
    cloudSaveSess(d);
    return true;
  } catch(e){ cloudSaveSess(null); return false; }
}

/* The single outbound choke point: auth headers, expiry refresh, 401 retry. */
async function cfetch(path, opts = {}, retry = true){
  if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();
  const headers = Object.assign({
    apikey: cloud.key,
    Authorization: 'Bearer ' + (cloud.sess ? cloud.sess.access_token : cloud.key),
  }, opts.headers || {});
  const rs = await _fetch(cloud.url + path, Object.assign({}, opts, { headers }));
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

export async function cloudUploadBlob(name, blob){
  const id = crypto.randomUUID();
  const path = cloud.sess.uid + '/' + id + '.jpg';
  let rs = await cfetch('/storage/v1/object/loans/' + path, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
  });
  if (!rs.ok) throw new Error('image upload failed');
  rs = await cfetch('/rest/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id, owner: cloud.sess.uid, name, path }),
  });
  if (!rs.ok) throw new Error('could not record the upload');
  return { id, path };
}

/* Deletes report what happened rather than swallowing it. A half-failed
   delete leaves the row and the object disagreeing, and the caller is the
   only one that can decide whether to keep the local record. */
export async function cloudDeleteUpload(rec){
  const [obj, row] = await Promise.allSettled([
    cfetch('/storage/v1/object/loans/' + rec.path, { method: 'DELETE' }),
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
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ published: !!on }),
  });
  if (!rs.ok) throw new Error('could not change who can see this gallery — has supabase-setup.sql been re-run?');
  cloud.published = !!on;
}

export async function cloudClaimSlug(slug){
  const rs = await cfetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: cloud.sess.uid, slug }),
  });
  if (!rs.ok) throw new Error('that name is taken or invalid (a–z, 0–9, dashes)');
  cloud.slug = slug;
}

/* ————— reads —————
   These return data. They used to write straight into the curator's
   collection and then call flashHint, updateHudStat and syncArtJobs — the
   network layer driving the HUD and kicking the render scheduler. */

const asUpload = (row) => ({ id: row.id, name: row.name, path: row.path,
                             url: cloudPublicURL(row.path), cloudRec: true });
const rowsOf = async (rs) => (rs.ok ? rs.json() : []);

/** The signed-in visitor's own collection. */
export async function cloudLoadMine(){
  if (!cloud.sess) return null;
  const [ur, pr, sr] = await Promise.all([
    cfetch('/rest/v1/uploads?owner=eq.' + cloud.sess.uid + '&select=id,name,path&order=created_at'),
    cfetch('/rest/v1/placements?owner=eq.' + cloud.sess.uid + '&select=k,upload_id'),
    cfetch('/rest/v1/profiles?id=eq.' + cloud.sess.uid + '&select=*'),
  ]);
  const me = (await rowsOf(sr))[0];
  cloud.slug = me ? me.slug : null;
  /* Absent before the RLS migration is applied; absent means not published. */
  cloud.published = !!(me && me.published);
  return {
    uploads: (await rowsOf(ur)).map(asUpload),
    placements: (await rowsOf(pr)).map((row) => [row.k, row.upload_id]),
    slug: cloud.slug, published: cloud.published,
  };
}

/** Somebody else's gallery, read-only. Returns null if no such name. */
export async function cloudLoadGallery(slug){
  const rows = await rowsOf(await cfetch(
    '/rest/v1/profiles?slug=eq.' + encodeURIComponent(slug) + '&select=id'));
  if (!rows[0]) return null;
  const owner = rows[0].id;
  const [ur, pr] = await Promise.all([
    cfetch('/rest/v1/uploads?owner=eq.' + owner + '&select=id,name,path'),
    cfetch('/rest/v1/placements?owner=eq.' + owner + '&select=k,upload_id'),
  ]);
  cloud.viewing = { slug, owner };
  return {
    slug, owner,
    uploads: (await rowsOf(ur)).map(asUpload),
    placements: (await rowsOf(pr)).map((row) => [row.k, row.upload_id]),
  };
}

/** Restore a session and load whatever this URL asks for.
 *  Returns {mode, data} — 'guest', 'mine', 'none', or 'missing' when a
 *  ?gallery= name matched nothing. The caller applies it. */
export async function cloudBoot(){
  if (!cloud.on) return { mode: 'off', data: null };
  try { const s = JSON.parse(localStorage.getItem('lumiere_sess') || 'null'); if (s) cloud.sess = s; } catch(e){}
  if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();

  const gallery = new URLSearchParams(location.search).get('gallery');
  if (gallery){
    const data = await cloudLoadGallery(gallery.toLowerCase());
    return data ? { mode: 'guest', data } : { mode: 'missing', data: { slug: gallery.toLowerCase() } };
  }
  if (cloud.sess) return { mode: 'mine', data: await cloudLoadMine() };
  return { mode: 'none', data: null };
}
