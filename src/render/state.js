/* ═══════════════════════════════════════════════════════════════════
   Shared renderer state: where the visitor is, what the camera is, which
   rooms are near enough to draw.

   Deliberately a leaf — it imports nothing but the matrix helpers. The
   functions that *maintain* this state (resize, refreshNear, ensureBuilt,
   evict, onRoomChanged) stay in main.js, because they call into the art
   scheduler and the HUD, and pulling them here would make this module and
   the scheduler mutually dependent. State can be a leaf; orchestration
   cannot. That distinction is what let this come out at all.
   ═══════════════════════════════════════════════════════════════════ */
import { mat4 } from './mat4.js';

/* Floating origin: the world is addressed by anchor room plus a local offset,
   so coordinates never grow large enough to lose float precision. Walk to
   Wing 100000 and the geometry is still exact. */
/* The vertical axis is the same idea one storey at a time: `gy` names the
   floor, `py` is the height above *that floor's* plane, and climbing past the
   ceiling re-anchors upward exactly as walking past a wall re-anchors sideways.
   Which means a stair needs no special case in the renderer, no second
   coordinate system, and no limit on how tall the museum gets. */
export const player = {
  gx: 0, gz: 0, gy: 0,   // anchor room (also the room the player is in)
  x: 0, z: 0,            // anchor-local position
  yaw: 0, pitch: 0,
  vx: 0, vz: 0,
  py: 0, vy: 0,          // height above this floor's plane, vertical speed
  ground: 0,             // height of whatever is under their feet, this frame
  jumps: 0, lastJumpT: 0,
};

export const M_P = mat4(), M_V = mat4(), M_MV = mat4(), M_PV = mat4();

/* Drawing-buffer size in device pixels. A live binding, so importers see
   resize()'s update without going through a getter every frame. */
export let vpW = 0, vpH = 0;
export function setViewport(w, h){ vpW = w; vpH = h; }

export let visited = new Set();
export function setVisited(s){ visited = s; }

/* Per-anchor room caches — the frame loop must not chase map keys. */
export const nearRooms = [], midRooms = [];
