/* ═══════════════════════════════════════════════════════════════════
   The seed layer. Pure and total: given the same world seed, every
   function here returns the same answer forever, on any machine.
   The whole museum is derived from this file.
   ═══════════════════════════════════════════════════════════════════ */
import { DOOR_P } from '../config.js';

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
             SALT_ART = 0x7F4A7C15, SALT_WIN = 0x00517DE1;

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
