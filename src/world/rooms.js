/* ═══════════════════════════════════════════════════════════════════
   Rooms: what exists at (gx,gz), derived entirely from the world seed.
   Doors, special rooms, which works hang where, and the lights that aim
   at them. No GL here — buildRoomMesh turns this into geometry.
   ═══════════════════════════════════════════════════════════════════ */
import { S, HS, H, WT, DOORW } from '../config.js';
import { h2, mulberry32, SALT_ROOM, SALT_ART, SALT_WIN, WORLD_SEED,
         edgeOpenX, edgeOpenZ } from './seed.js';
import { PALETTES } from '../art/palettes.js';
import { ALGOS } from '../art/algos.js';

export const SPECIAL = { NONE:0, VERMILION:1, ARCHIVE:2, DARKROOM:3 };
export const rooms = new Map();   // "gx,gz" → room record

export function roomKey(gx, gz){ return gx + ',' + gz; }

/** The odds, in one place. Three specials at 1/64 each; the spawn room is
 *  always ordinary. Anything that wants to know what a room is must go
 *  through here — a second copy of these thresholds silently disagrees the
 *  moment one of them is tuned. */
export function classifySpecial(roll){
  if (roll < 1/64) return SPECIAL.VERMILION;
  if (roll < 2/64) return SPECIAL.ARCHIVE;
  if (roll < 3/64) return SPECIAL.DARKROOM;
  return SPECIAL.NONE;
}

/** What kind of room sits at (gx,gz), without building it. */
export function specialAt(gx, gz){
  if (gx === 0 && gz === 0) return SPECIAL.NONE;
  return classifySpecial(mulberry32(h2(gx, gz, SALT_ROOM ^ WORLD_SEED))());
}

export function getRoom(gx, gz){
  const k = roomKey(gx, gz);
  let r = rooms.get(k);
  if (r) return r;
  const seed = h2(gx, gz, SALT_ROOM ^ WORLD_SEED);
  const rnd = mulberry32(seed);
  /* draw unconditionally — the spawn room must consume it too, or every
     downstream value in its stream shifts */
  const sroll = rnd();
  const special = (gx !== 0 || gz !== 0) ? classifySpecial(sroll) : SPECIAL.NONE;
  r = {
    gx, gz, seed, special,
    doors: {                       // e:+x  w:−x  n:+z  s:−z
      e: edgeOpenX(gx, gz),
      w: edgeOpenX(gx - 1, gz),
      n: edgeOpenZ(gx, gz),
      s: edgeOpenZ(gx, gz - 1),
    },
    mood: [0, 0, 0],
    artworks: [],                  // {wall,u,asp,w,h,frame,algo,seed,pal}
    ownLights: [],                 // room-local {p:[x,y,z], d:[x,y,z], col:[r,g,b], inner, outer, invR2}
    lights: null,                  // final list incl. neighbour spill (assembled at VAO build)
    vao: null, vbo: null, ibo: null, nIdx: 0,
    colliders: [],                 // room-local {cx,cz,hx,hz}
  };
  const ar = mulberry32(h2(gx, gz, SALT_ART ^ WORLD_SEED));
  r.mood = [(ar()-.5)*.02, (ar()-.5)*.016, (ar()-.5)*.02];
  genArtworks(r, ar);
  genLights(r, ar);
  r.ambScale = r.special === SPECIAL.DARKROOM ? 0.30
             : r.special === SPECIAL.VERMILION ? 1.12 : 1;
  if (r.special === SPECIAL.DARKROOM && r.artworks[0]){
    const A = r.artworks[0];
    const sign = (A.wall==='e'||A.wall==='n') ? 1 : -1;
    const horiz = (A.wall==='e'||A.wall==='w');
    const back = sign * (HS - WT - 3.4);
    r.bench = horiz ? { x: back, z: A.u, alongZ: true } : { x: A.u, z: back, alongZ: false };
  } else if (!r.special){
    const b1 = ar(), b2 = ar(), b3 = ar(), b4 = ar();
    if (b1 < 0.30) r.bench = { x: (b2-.5)*2.2, z: (b3-.5)*2.2, alongZ: b4 < 0.5 };
    else if (b2 < 0.13) r.pedestal = { x: (b3-.5)*3, z: (b4-.5)*3 };
  }
  if (r.special === SPECIAL.VERMILION || r.special === SPECIAL.ARCHIVE){
    r.shaft = { x: (ar()<.5?-1:1)*(1.6+ar()*1.5), z: (ar()<.5?-1:1)*(1.6+ar()*1.5) };
  }
  /* window slots — computed always so the world stays deterministic;
     glass and sunlight only materialise while the shutters are open */
  r.windows = [];
  if (r.special !== SPECIAL.DARKROOM){
    const wr = mulberry32(h2(gx, gz, SALT_WIN ^ WORLD_SEED));
    const walls = ['e','w','n','s'].filter(w => !r.doors[w]);
    for (let i = walls.length-1; i > 0; i--){
      const j = Math.floor(wr()*(i+1)); const t = walls[i]; walls[i] = walls[j]; walls[j] = t;
    }
    for (const wall of walls){
      if (r.windows.length >= 2) break;
      const spans = r.artworks.filter(A => A.wall === wall)
        .map(A => [A.u - A.w/2 - 0.62, A.u + A.w/2 + 0.62])
        .sort((a, b) => a[0] - b[0]);
      let cur = -HS + 1.0; const gaps = [];
      for (const [a, b] of spans){
        if (a - cur >= 1.75) gaps.push([cur, a]);
        cur = Math.max(cur, b);
      }
      if (HS - 1.0 - cur >= 1.75) gaps.push([cur, HS - 1.0]);
      if (!gaps.length) continue;
      const g = gaps[Math.floor(wr()*gaps.length)];
      const u = (g[0]+g[1])/2 + (wr()-.5)*Math.max(0, g[1]-g[0]-1.75)*0.4;
      r.windows.push({ wall, u, w: 1.3, h: 2.3, cy: 1.78 });
    }
  }
  rooms.set(k, r);
  return r;
}

/* Artwork placement: hangable segments per wall (doors carve flanks),
   seed-shuffled, up to 6 works per room. Real pigment arrives with the
   art pipeline; geometry (frames, placards) hangs from these records. */
const ASPECTS = [
  ['L', 1.87, 1.40, .30], ['P', 1.14, 1.52, .28],
  ['S', 1.35, 1.35, .22], ['W', 2.24, 1.40, .20],
];
const FRAME_COLS = [
  [[0.196,0.132,0.088], .45],   // walnut
  [[0.055,0.052,0.048], .25],   // black lacquer
  [[0.470,0.360,0.190], .15],   // brass
  [[0.300,0.230,0.150], .15],   // oak
];
function pickW(rnd, table){
  let t = rnd(), acc = 0;
  for (const row of table){ acc += row[row.length-1]; if (t < acc) return row; }
  return table[table.length-1];
}
function genArtworks(r, rnd){
  const IN = HS - WT, DW = DOORW/2;
  if (r.special === SPECIAL.DARKROOM){
    /* one painting, one light, nothing else */
    const walls = ['e','w','n','s'].filter(w => !r.doors[w]);
    const wall = walls.length ? walls[Math.floor(rnd()*walls.length)]
                              : ['e','w','n','s'][Math.floor(rnd()*4)];
    const [asp, w, h] = pickW(rnd, ASPECTS);
    r.artworks.push({
      wall, u: (rnd()-.5)*1.5, asp, w, h, frame: FRAME_COLS[1][0],
      segA: -HS+1, segB: HS-1,
      algo: Math.floor(rnd()*ALGOS.length), seed: (rnd()*4294967296)>>>0, pal: Math.floor(rnd()*PALETTES.length),
    });
    return;
  }
  if (r.special === SPECIAL.ARCHIVE){
    /* salon-hung grids of miniatures on the closed walls */
    const walls = ['e','w','n','s'].filter(w => !r.doors[w]);
    for (const wall of (walls.length ? walls : ['e'])){
      if (r.artworks.length >= 12) break;
      const cols = 3 + (rnd() < 0.5 ? 1 : 0);
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < cols; col++){
          if (r.artworks.length >= 12) break;
          const u = -HS + 2 + (col + 0.5)*((2*HS - 4)/cols) + (rnd()-.5)*0.2;
          r.artworks.push({
            wall, u, asp: 'S', w: 0.62, h: 0.62, mini: true, hangY: 1.15 + row*0.95,
            frame: FRAME_COLS[1][0], segA: -HS+0.5, segB: HS-0.5,
            algo: Math.floor(rnd()*ALGOS.length), seed: (rnd()*4294967296)>>>0, pal: Math.floor(rnd()*PALETTES.length),
          });
        }
    }
    return;
  }
  const segs = [];
  for (const wall of ['e','w','n','s']){
    if (r.doors[wall]){
      segs.push([wall, -HS+0.5, -DW-0.4], [wall, DW+0.4, HS-0.5]);
    } else {
      segs.push([wall, -HS+0.6, HS-0.6]);
    }
  }
  for (let i = segs.length-1; i > 0; i--){       // seed-shuffle
    const j = Math.floor(rnd() * (i+1));
    const t = segs[i]; segs[i] = segs[j]; segs[j] = t;
  }
  for (const [wall, a, b] of segs){
    if (r.artworks.length >= 6) break;
    const len = b - a;
    if (len < 2.2) continue;
    const two = len > 5.6 && rnd() < 0.45 && r.artworks.length <= 4;
    const centers = two ? [a + len*(0.26 + (rnd()-.5)*0.06), a + len*(0.74 + (rnd()-.5)*0.06)]
                        : [a + len*(0.40 + rnd()*0.20)];
    for (const c0 of centers){
      const [asp, w, h] = pickW(rnd, ASPECTS);
      const c = Math.max(a + w/2 + 0.3, Math.min(b - w/2 - 0.3, c0));
      const [frame] = pickW(rnd, FRAME_COLS);
      r.artworks.push({
        wall, u: c, asp, w, h,
        frame: r.special === SPECIAL.VERMILION ? FRAME_COLS[2][0] : frame,
        segA: a, segB: b,
        algo: Math.floor(rnd()*ALGOS.length),
        seed: (rnd() * 4294967296) >>> 0,
        pal: Math.floor(rnd()*PALETTES.length),
      });
    }
  }
}
/* One tungsten spot per artwork; a soft centre downlight when there is
   headroom. Neighbour spill (through open doors) joins at VAO build. */
export function spotAt(p, target, col, inner, outer, range){
  const d = [target[0]-p[0], target[1]-p[1], target[2]-p[2]];
  const dl = Math.hypot(d[0], d[1], d[2]);
  return { p, d: [d[0]/dl, d[1]/dl, d[2]/dl], col, inner, outer, invR2: 1/(range*range) };
}
function genLights(r, rnd){
  const IN = HS - WT;
  if (r.special === SPECIAL.DARKROOM){
    const A = r.artworks[0];
    if (A){
      const sign = (A.wall==='e'||A.wall==='n') ? 1 : -1;
      const horiz = (A.wall==='e'||A.wall==='w');
      const back = sign * (IN - 1.8), y = H - 0.2, ty = (A.hangY || 1.55);
      const p = horiz ? [back, y, A.u] : [A.u, y, back];
      const t = horiz ? [sign*IN, ty, A.u] : [A.u, ty, sign*IN];
      r.ownLights.push(spotAt(p, t, [3.1, 2.5, 1.75], 0.965, 0.9, 6.5));
    }
    return;
  }
  if (r.special === SPECIAL.ARCHIVE){
    const walls = new Set(r.artworks.map(A => A.wall));
    for (const wall of walls){
      if (r.ownLights.length >= 5) break;
      const sign = (wall==='e'||wall==='n') ? 1 : -1;
      const horiz = (wall==='e'||wall==='w');
      const back = sign * (IN - 2.3), y = H - 0.2;
      const p = horiz ? [back, y, 0] : [0, y, back];
      const t = horiz ? [sign*IN, 1.6, 0] : [0, 1.6, sign*IN];
      r.ownLights.push(spotAt(p, t, [1.9, 1.5, 1.0], 0.82, 0.5, 7.5));
    }
    r.ownLights.push(spotAt([0, H-0.3, 0], [0, 0, 0], [0.8, 0.7, 0.55], 0.72, 0.4, 8));
    r.ownLights.push(spotAt([0, H-1.6, 0], [0, H, 0], [0.85, 0.66, 0.38], 0.78, 0.30, 4.5));
    return;
  }
  const warm = r.special === SPECIAL.VERMILION ? [2.3, 1.55, 0.95] : [2.0, 1.6, 1.1];
  for (const A of r.artworks){
    if (r.ownLights.length >= 6) break;
    const sign = (A.wall==='e'||A.wall==='n') ? 1 : -1;
    const horiz = (A.wall==='e'||A.wall==='w');
    const back = sign * (IN - 1.55), y = H - 0.22, ty = (A.hangY || 1.5);
    const p = horiz ? [back, y, A.u] : [A.u, y, back];
    const t = horiz ? [sign*IN, ty, A.u] : [A.u, ty, sign*IN];
    r.ownLights.push(spotAt(p, t, warm, 0.92, 0.74, 5.2));
  }
  /* the chandelier always burns at the centre — and lights its own ceiling */
  r.ownLights.push(spotAt([0, H-1.15, 0], [0, 0, 0], [0.95, 0.80, 0.60], 0.70, 0.36, 8.5));
  r.ownLights.push(spotAt([0, H-1.6, 0], [0, H, 0], [0.85, 0.66, 0.38], 0.78, 0.30, 4.5));
}

