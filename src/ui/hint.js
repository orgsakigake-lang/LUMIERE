/* ═══════════════════════════════════════════════════════════════════
   Two separate things that had been sharing one element.

   The controls legend is reference: it should be recallable for as long
   as the visitor is learning the gallery. A notice is transient. They
   used to be the same <div>, so the first notice overwrote the legend
   permanently — press L in your first ten seconds and you could never
   read the controls again, because nothing brings them back.

   They are now two elements, and the legend has a key.
   ═══════════════════════════════════════════════════════════════════ */

let hideAt = 0, raf = 0;

export function flashHint(msg){
  const el = document.getElementById('hud-toast');
  if (!el) return;
  el.innerHTML = msg;
  el.classList.add('show');
  /* A deadline rather than a timeout: a second notice during the first one
     extends the reading time instead of restarting a fade mid-way. The old
     2.6 s timeout also fought a 2 s CSS fade, so a notice was fully legible
     for about half a second. */
  hideAt = performance.now() + 3400;
  if (raf) return;
  const tick = () => {
    if (performance.now() >= hideAt){ el.classList.remove('show'); raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** The controls legend, on demand. `?` or `/` toggles it; it also shows itself
 *  for the first few moments of a visit and then gets out of the way. */
export function toggleLegend(force){
  const el = document.getElementById('hud-legend');
  if (!el) return false;
  const show = force === undefined ? !el.classList.contains('show') : !!force;
  el.classList.toggle('show', show);
  return show;
}
