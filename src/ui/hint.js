/* ═══════════════════════════════════════════════════════════════════
   The one-line notice under the crosshair.
   Known limitation: it borrows #hud-hint, so the first notice replaces
   the controls legend for the rest of the session, and the 2s CSS fade
   fights the 2.6s timeout. Replacing this with a real toast is queued.
   ═══════════════════════════════════════════════════════════════════ */

export function flashHint(msg){
  const el = document.getElementById('hud-hint');
  el.innerHTML = msg;
  el.style.opacity = '1';
  clearTimeout(flashHint.t);
  flashHint.t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}
