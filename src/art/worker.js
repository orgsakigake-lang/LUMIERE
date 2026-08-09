/* ═══════════════════════════════════════════════════════════════════
   The painter, off the main thread.

   A generated work costs about 160 ms of Canvas2D on this machine, and a
   fresh neighbourhood is fifty-four of them — nine seconds of main-thread
   time that the renderer was being asked to share, three and a half
   milliseconds at a time, for ten seconds of walking. None of it needs
   the main thread: it is arithmetic and rasterisation into a bitmap.

   So the generators run here instead, to completion in one go — the
   cooperative yielding exists to protect a frame loop this thread does
   not have — and the finished pixels go back as an ImageBitmap, which
   transfers without a copy and uploads straight to a texture.

   Determinism is the whole contract of this museum, so nothing here may
   drift from the main-thread path: same seed, same palette drawn from
   the same stream in the same order, same finishing pass. Verified: an
   OffscreenCanvas and an HTMLCanvasElement rasterise these operations to
   byte-identical pixels, so DBG.artHash still describes what hangs.
   ═══════════════════════════════════════════════════════════════════ */
import { jitterPal } from './palettes.js';
import { paintArt, resetGrain } from './algos.js';

let cv = null, ctx = null;

self.onmessage = (e) => {
  const { id, algo, seed, pal, w, h } = e.data;
  const t0 = performance.now();
  try {
    if (!cv || cv.width !== w || cv.height !== h){
      cv = new OffscreenCanvas(w, h);
      /* willReadFrequently for the same reason as the main thread: several
         generators read back what they have drawn. */
      ctx = cv.getContext('2d', { alpha: false, willReadFrequently: true });
      resetGrain();          // the grain pattern belongs to the old context
    }
    /* paintArt owns the seed, the palette draw order and the gate, so the
       wall, DBG.artHash and an acquired copy cannot disagree about what this
       work is. It reports the seed it settled on: a gated re-roll derives a
       new one, and acquire needs to render that same one later. */
    const r = paintArt(ctx, w, h, algo, seed, pal, jitterPal);
    const bmp = cv.transferToImageBitmap();
    self.postMessage({ id, bmp, seed: r.seed, attempts: r.attempts,
                       ms: Math.round(performance.now() - t0) }, [bmp]);
  } catch (err){
    /* The main thread must hear about every job it dispatched, or the slot it
       reserved is held for the rest of the session. */
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
