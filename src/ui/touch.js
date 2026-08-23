/* ═══════════════════════════════════════════════════════════════════
   The museum in one hand.

   A gallery whose whole point is a link somebody sends you is a gallery
   that gets opened on a phone, and until this file existed that visit
   ended at the door: entering worked, and then nothing did. There is no
   pointer to lock, no WASD to press, and a `mousemove` handler hears
   nothing from a thumb — so a shared collection arrived as a still
   photograph of one wall, with no way to turn around.

   Three gestures, and no more than three:

     drag anywhere    look around        (the same grab as a mouse drag)
     the ring         walk               (analogue — lean it, don't shove it)
     a tap            see the work larger (the reticle says when there is one)

   Everything else on a phone is a switch you can already press. Jumping
   is a tap on the ring, because it has to live somewhere and nothing
   else in a museum needs a second step.

   The listeners install unconditionally. A laptop with a touchscreen is
   an ordinary machine, and asking `(pointer: coarse)` at boot would have
   decided against it for the whole session; the ring and the touch
   legend appear the moment a finger actually lands, and the keyboard
   never stops working. Nothing here runs on a machine nobody touches.
   ═══════════════════════════════════════════════════════════════════ */
import { player } from '../render/state.js';

/* Radians per CSS pixel. A mouse drag is 0.0034 and a thumb has a tenth of
   the room to move in: at this rate one swipe across a 393 px phone is about
   135°, so turning to the wall behind you is one gesture and not four. */
const LOOK_SENS = 0.0062;
/* Of the ring's radius. Under this the ring is at rest — a thumb resting on
   the glass is not a walk, and without a dead zone the visitor drifts. */
const DEAD = 0.14;
/* What separates a tap from a gesture. Travel is the real test — 12 px is
   generous for a thumb on a 3x display and far under any deliberate drag —
   and the clock is only there to rule out a finger that came to rest. Hence
   400 ms rather than the 200-odd a mouse click is judged by: a thumb on glass
   is slower than a finger on a button, and there is no long press here for it
   to be mistaken for. */
const TAP_MS = 400, TAP_PX = 12;

/* The walk, as the frame loop wants it: a screen-space vector, already scaled
   by how far the ring is pushed. `on` is false at rest so the keyboard path
   is untouched — a machine nobody touches never reads anything but zeroes. */
export const touchWalk = { on: false, x: 0, z: 0 };

/** Wire up the three gestures.
 *  `api` is the gallery's side of the contract:
 *    active()  — is the walk accepting input at all (not in a panel, a modal
 *                or an inspect lean)
 *    tap()     — a tap on the world
 *    jump()    — a tap on the ring
 */
export function initTouch(canvas, api){
  const stick = document.getElementById('stick');
  const knob  = document.getElementById('stick-knob');
  if (!stick || !knob) return;

  let look = null;    // {id, x, y, t, moved}   — the finger that is looking
  let walk = null;    // {id, cx, cy, r, t, moved} — the finger on the ring

  /* Touch mode is a fact about this visit, not about this device: it turns on
     when a finger arrives and stays on. It moves the legend to the gestures,
     shows the ring, and relaxes a layout drawn for a desktop corner. Set at
     boot too when the pointer is coarse, so a phone visitor reads the right
     instructions *before* discovering the wrong ones do not work. */
  const markTouch = () => document.body.classList.add('touch');
  if (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) markTouch();

  const rest = () => {
    touchWalk.on = false; touchWalk.x = touchWalk.z = 0;
    knob.style.transform = '';
    stick.classList.remove('live');
  };

  /* Where the ring is leaning, in screen space, with the dead zone rescaled
     away so the first millimetre of travel is a first step rather than a
     lurch to a fifth of walking pace. */
  function lean(dx, dy){
    const d = Math.hypot(dx, dy), r = walk.r;
    walk.moved = Math.max(walk.moved, d);
    const clamp = d > r ? r / d : 1;
    knob.style.transform = `translate(${(dx*clamp).toFixed(1)}px, ${(dy*clamp).toFixed(1)}px)`;
    const mag = Math.min(1, d / r);
    if (mag < DEAD){ touchWalk.on = false; touchWalk.x = touchWalk.z = 0; return; }
    const g = (mag - DEAD) / (1 - DEAD), inv = g / (d || 1);
    touchWalk.on = true;
    touchWalk.x = dx * inv;      // right across the glass — sidestep right
    touchWalk.z = dy * inv;      // down the glass — walk backwards
  }

  stick.addEventListener('touchstart', (e) => {
    markTouch();
    if (walk || !api.active()) return;
    const t = e.changedTouches[0];
    const b = stick.getBoundingClientRect();
    walk = { id: t.identifier, cx: b.left + b.width/2, cy: b.top + b.height/2,
             r: b.width/2, t: performance.now(), moved: 0 };
    stick.classList.add('live');
    lean(t.clientX - walk.cx, t.clientY - walk.cy);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchstart', (e) => {
    markTouch();
    /* preventDefault regardless: it is what stops the double-tap zoom, the
       rubber-band scroll, and the compatibility mouse events that would
       otherwise start a phantom drag-look behind this one. */
    e.preventDefault();
    if (look || !api.active()) return;
    const t = e.changedTouches[0];
    look = { id: t.identifier, x: t.clientX, y: t.clientY,
             t: performance.now(), moved: 0 };
  }, { passive: false });

  /* Move and end are on the window, and dispatched by identifier. A touch
     belongs to whatever it started on for as long as it lasts — a thumb that
     wanders off the ring keeps walking, which is what a thumb does, and the
     look finger keeps looking even when it crosses the ring. Two fingers is
     the ordinary case: walk with one, look with the other. */
  addEventListener('touchmove', (e) => {
    let mine = false;
    for (const t of e.changedTouches){
      if (look && t.identifier === look.id){
        const dx = t.clientX - look.x, dy = t.clientY - look.y;
        look.x = t.clientX; look.y = t.clientY;
        look.moved += Math.abs(dx) + Math.abs(dy);
        player.yaw += dx * LOOK_SENS;
        player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - dy * LOOK_SENS));
        mine = true;
      } else if (walk && t.identifier === walk.id){
        lean(t.clientX - walk.cx, t.clientY - walk.cy);
        mine = true;
      }
    }
    if (mine && e.cancelable) e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches){
      if (look && t.identifier === look.id){
        const quick = performance.now() - look.t < TAP_MS && look.moved < TAP_PX;
        look = null;
        if (quick && api.active()) api.tap();
      } else if (walk && t.identifier === walk.id){
        const quick = performance.now() - walk.t < TAP_MS && walk.moved < TAP_PX;
        walk = null; rest();
        if (quick && api.active()) api.jump();
      }
    }
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);
  /* A panel opening, or the tab going away, must not leave the visitor
     walking into a wall with no finger on the glass. */
  addEventListener('blur', () => { look = null; walk = null; rest(); });

  return { release(){ look = null; walk = null; rest(); } };
}
