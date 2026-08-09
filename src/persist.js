/* ═══════════════════════════════════════════════════════════════════
   Visit counters in localStorage. Every access is guarded: sandboxed
   embeds throw on property access, not just on write, so the store is
   probed once at load and treated as absent if it objects.
   ═══════════════════════════════════════════════════════════════════ */

export let storageOK = false;
try { localStorage.setItem('rd_probe', '1'); localStorage.removeItem('rd_probe'); storageOK = true; }
catch(e){ storageOK = false; }
export const persist = { visits: 0, rooms: 0, works: 0, acquired: 0 };
if (storageOK){
  try {
    Object.assign(persist, JSON.parse(
      localStorage.getItem('lumiere') || localStorage.getItem('rand-dom') || '{}'));
  } catch(e){}
}
persist.visits = (persist.visits | 0) + 1;
let saveTimer = 0;
export function savePersist(){
  if (!storageOK) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('lumiere', JSON.stringify(persist)); } catch(e){}
  }, 800);
}
savePersist();
addEventListener('beforeunload', () => {
  if (storageOK){ try { localStorage.setItem('lumiere', JSON.stringify(persist)); } catch(e){} }
});
