/* ═══════════════════════════════════════════════════════════════════
   The seed layer. Pure and total: given the same world seed, every
   function here returns the same answer forever, on any machine.
   The whole museum is derived from this file.
   ═══════════════════════════════════════════════════════════════════ */
import { DOOR_P, STAIR_P } from '../config.js';

/* h2: murmur3-finalized 2D lattice hash. Canonical edge hashes — an edge is
   keyed by the room on its west/south side plus an axis salt, so both rooms
   agree on whether there is a door without ever talking to each other. */
export function h2(x, y, salt){
  /* sequential mix (not xor-of-products: that repeats under (x,y)→(−x,−y)
     on diagonals — an infinite museum must not mirror itself) */
  let h = (salt | 0) >>> 0;
  h = Math.imul(h ^ (x|0), 0x9E3779B1) >>> 0; h ^= h >>> 15;
  h = Math.imul(h ^ (y|0), 0x85EBCA6B) >>> 0; h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SALT_EX = 0x51ED270B, SALT_EY = 0x9E1B3C85, SALT_ROOM = 0x3C6EF372,
             SALT_ART = 0x7F4A7C15, SALT_WIN = 0x00517DE1, SALT_STAIR = 0x57A17C0E;

/* A live binding: importers see reassignment through setWorldSeed. */
export let WORLD_SEED = 20260803 >>> 0;
{ const m = /[?&]seed=(\d+)/.exec(location.search); if (m) WORLD_SEED = (+m[1]) >>> 0; }

/** Re-seed the world. Callers must drop every cached room and artwork. */
export function setWorldSeed(n){ WORLD_SEED = n >>> 0; return WORLD_SEED; }

/* Edge openness. Axis 'x': edge between (gx,gz) and (gx+1,gz).
   Axis 'z': edge between (gx,gz) and (gx,gz+1).
   All four edges of the spawn room (0,0) are forced open. */
export function edgeOpenX(gx, gz){
  if ((gx === 0 || gx === -1) && gz === 0) return true;
  return h2(gx, gz, SALT_EX ^ WORLD_SEED) / 4294967296 < DOOR_P;
}
export function edgeOpenZ(gx, gz){
  if (gx === 0 && (gz === 0 || gz === -1)) return true;
  return h2(gx, gz, SALT_EY ^ WORLD_SEED) / 4294967296 < DOOR_P;
}

/* ————— the vertical edge —————
   Whether a stair climbs out of (gx,gz) on floor gy to the room directly
   above it. Keyed the same way the horizontal edges are: the room *below*
   owns the answer, so a floor and the one over it agree about the opening
   between them without consulting each other, and the well in one ceiling is
   the well in the other's floor by construction rather than by bookkeeping.

   Its own salt and its own stream. Nothing about the museum's horizontal
   layout may shift because floors exist — the door mask, the artwork
   segments and therefore every frame key a curator has ever hung a work on
   are all derived above, untouched. A ground floor built by this version is
   the same ground floor as before, hash for hash.

   The entrance hall is the exception, and deliberately so: it carries a
   stair on every floor from the ground up, which makes one grand stairwell
   rising the full height of the museum directly above the door. A visitor
   who wants to go up never has to hunt for the way, and can always come back
   down the way they came. Downward from the ground floor it returns false —
   there is no basement under the entrance, so the spawn room's floor is
   whole and a first step is never a fall. */
export function stairUpAt(gx, gz, gy){
  if (gx === 0 && gz === 0) return (gy | 0) >= 0;
  return h2(gx, gz, (SALT_STAIR ^ WORLD_SEED) + (gy|0) * 0x9E3779B1) / 4294967296 < STAIR_P;
}
