/* ═══════════════════════════════════════════════════════════════════
   Inert stand-in for cloud/client.js, swapped in by `npm run archive`.

   An archival copy is meant to outlive its own infrastructure. Wiring one
   to a Supabase project that will certainly be gone first is incoherent —
   so the archive build has no backend at all. Every seeded work is
   generated locally from the world seed, which is the part worth keeping.

   With cloud.on false the Curator's Office falls back to its local
   passphrase gate and IndexedDB, so private loans still work; they simply
   stay on the visitor's own machine.

   Same export surface as the real client, so main.js needs no build-time
   conditionals. Dropping this in also takes the archive under the 100 KiB
   mark where permanent storage is free — see docs/permanence.md.
   ═══════════════════════════════════════════════════════════════════ */

export const cloud = { url: '', key: '', on: false, sess: null, viewing: null, slug: null, published: false };

export function setFetch(){}
export function cloudSaveSess(){}
export function cloudPublicURL(){ return ''; }

const unreachable = () => { throw new Error('this gallery keeps no cloud'); };
export const cloudSendCode = unreachable;
export const cloudVerify = unreachable;
export const cloudUploadBlob = unreachable;
export const cloudClaimSlug = unreachable;
export const cloudSetPublished = unreachable;

/* Writes report failure rather than throwing: the curator calls these
   fire-and-forget, and an archive copy should stay quiet, not nag. */
export async function cloudDeleteUpload(){ return { ok: false }; }
export async function cloudSetPlacement(){ return { ok: false }; }
export async function cloudDelPlacement(){ return { ok: false }; }

export async function cloudLoadMine(){ return null; }
export async function cloudLoadGallery(){ return null; }
export async function cloudBoot(){ return { mode: 'off', data: null }; }
