/* ═══════════════════════════════════════════════════════════════════
   LUMIÈRE — The Endless Gallery
   WebGL2 + Canvas2D + WebAudio. No runtime dependencies.
   Authored as modules; esbuild inlines them into one index.html.
   Everything derives from seeds; nothing from timing.
   ═══════════════════════════════════════════════════════════════════ */

import { S, HS, H, WT, DOORW, DOORH, EYE, PR, DOOR_P, FOG_SIGMA, FOG,
         BUILD_R, EVICT_R, DPR_CAP, REDUCED, DEV, trace,
         CLOUD_URL, CLOUD_KEY } from './config.js';
import { h2, mulberry32, SALT_EX, SALT_EY, SALT_ROOM, SALT_ART, SALT_WIN,
         WORLD_SEED, setWorldSeed, edgeOpenX, edgeOpenZ } from './world/seed.js';
import { PALETTES, jitterPal } from './art/palettes.js';
import { ALGO_NAMES, ALGOS, makeTitle, finishArt, resetGrain } from './art/algos.js';
import { mat4, perspective, mulM, mulT, viewMatrix, extractPlanes, boxVisible } from './render/mat4.js';
import { storageOK, persist, savePersist } from './persist.js';
import { flashHint } from './ui/hint.js';
import { audio, initAudio, bell, footstep, toggleMute, setAudioActive } from './audio.js';
import { SPECIAL, rooms, roomKey, getRoom, spotAt, specialAt } from './world/rooms.js';

import VS_ARCH from './render/shaders/arch.vert';
import FS_ARCH from './render/shaders/arch.frag';
import VS_PAINT from './render/shaders/paint.vert';
import FS_PAINT from './render/shaders/paint.frag';
import VS_SHAFT from './render/shaders/shaft.vert';
import FS_SHAFT from './render/shaders/shaft.frag';
import VS_MOTE from './render/shaders/mote.vert';
import FS_MOTE from './render/shaders/mote.frag';
import VS_FLAME from './render/shaders/flame.vert';
import FS_FLAME from './render/shaders/flame.frag';
import VS_POST from './render/shaders/post.vert';
import FS_BRIGHT from './render/shaders/bright.frag';
import FS_BLUR from './render/shaders/blur.frag';
import FS_COMP from './render/shaders/composite.frag';

/* ————— §3 Geometry: room → interleaved mesh → VAO —————
   Layout: pos(3) nor(3) uv(2) col(3) = 11 floats, stride 44 bytes.
   Room-local coords, origin at room centre, floor y=0.
   Each room owns a slab WT deep on its own side of every border —
   two rooms together make a 2·WT thick museum wall, fully local.  */
const SCHEMES = [
  { wall:[0.166,0.150,0.132], floor:[0.105,0.094,0.082], ceil:[0.070,0.065,0.058], trim:[0.050,0.046,0.040] },
  { wall:[0.300,0.082,0.058], floor:[0.088,0.062,0.050], ceil:[0.078,0.050,0.040], trim:[0.360,0.280,0.140] },
  { wall:[0.190,0.170,0.140], floor:[0.100,0.090,0.078], ceil:[0.068,0.063,0.056], trim:[0.055,0.050,0.043] },
  { wall:[0.058,0.055,0.050], floor:[0.050,0.047,0.043], ceil:[0.040,0.038,0.035], trim:[0.030,0.028,0.025] },
];

function buildRoomMesh(r){
  const V = [], I = [];
  r.colliders.length = 0;              // idempotent rebuild (context restore)
  const SCH = SCHEMES[r.special] || SCHEMES[0];
  const COL = { wall: SCH.wall, floor: SCH.floor, ceil: SCH.ceil };
  let curMat = 0;                      // 0 plaster · 1 parquet · 2 plain
  function quad(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz, nx,ny,nz, col, us,vs){
    const b = V.length / 12;
    V.push(ax,ay,az, nx,ny,nz, 0,  0,  col[0],col[1],col[2], curMat,
           bx,by,bz, nx,ny,nz, us, 0,  col[0],col[1],col[2], curMat,
           cx,cy,cz, nx,ny,nz, us, vs, col[0],col[1],col[2], curMat,
           dx,dy,dz, nx,ny,nz, 0,  vs, col[0],col[1],col[2], curMat);
    I.push(b, b+1, b+2, b, b+2, b+3);
  }
  const IN = HS - WT;              // interior face plane (6.76)
  const DW = DOORW / 2;

  /* ceiling now; the floor is emitted last, in its own index range, so it
     can be drawn semi-transparent over its own reflections */
  quad(-IN,H,-IN,  IN,H,-IN,  IN,H, IN,  -IN,H, IN,  0,-1,0, COL.ceil,  S/2, S/2);
  const d = r.doors;

  /* Wall on one edge. Axis-generic via a tiny frame:
     u = along-wall coord (−HS..HS), face at distance IN from centre.
     mapU(u,y,off) → room-local (x,y,z).  n = inward normal.        */
  function wall(axis /*'e','w','n','s'*/, open){
    const sign = (axis==='e'||axis==='n') ? 1 : -1;
    const horiz = (axis==='e'||axis==='w');       // wall plane ⊥ x
    // p(u, y, depth) — depth 0 at interior face, +WT at border
    function p(u, y, depth){
      const w = sign * (IN + depth);
      return horiz ? [w, y, u] : [u, y, w];
    }
    const n  = horiz ? [-sign,0,0] : [0,0,-sign];  // inward
    function face(u0, u1, y0, y1, col){            // interior face strip
      const a=p(u0,y0,0), b=p(u1,y0,0), c=p(u1,y1,0), dd=p(u0,y1,0);
      quad(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], dd[0],dd[1],dd[2],
           n[0],n[1],n[2], col, Math.abs(u1-u0)/2, (y1-y0)/2);
    }
    if (!open){
      face(-HS, HS, 0, H, COL.wall);
      r.colliders.push(horiz ? {cx:sign*(IN+WT/2), cz:0, hx:WT/2, hz:HS}
                             : {cx:0, cz:sign*(IN+WT/2), hx:HS, hz:WT/2});
      return;
    }
    // open: two flanks + lintel face + jamb sides + lintel underside
    face(-HS, -DW, 0, H, COL.wall);
    face( DW,  HS, 0, H, COL.wall);
    face(-DW,  DW, DOORH, H, COL.wall);
    // jamb inner sides (facing into the doorway tunnel)
    for (const su of [-1, 1]){
      const u = su * DW;
      const jn = horiz ? [0,0,-su] : [-su,0,0];
      const a=p(u,0,0), b=p(u,0,WT), c=p(u,DOORH,WT), dd=p(u,DOORH,0);
      quad(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], dd[0],dd[1],dd[2],
           jn[0],jn[1],jn[2], COL.wall, WT/2, DOORH/2);
    }
    // lintel underside (tunnel ceiling), y = DOORH
    {
      const a=p(-DW,DOORH,0), b=p(DW,DOORH,0), c=p(DW,DOORH,WT), dd=p(-DW,DOORH,WT);
      quad(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], dd[0],dd[1],dd[2],
           0,-1,0, COL.ceil, DOORW/2, WT/2);
    }
    const jc = (DW + HS)/2, jh = (HS - DW)/2;
    if (horiz){
      r.colliders.push({cx:sign*(IN+WT/2), cz:-jc, hx:WT/2, hz:jh},
                       {cx:sign*(IN+WT/2), cz: jc, hx:WT/2, hz:jh});
    } else {
      r.colliders.push({cx:-jc, cz:sign*(IN+WT/2), hx:jh, hz:WT/2},
                       {cx: jc, cz:sign*(IN+WT/2), hx:jh, hz:WT/2});
    }
  }
  wall('e', d.e); wall('w', d.w); wall('n', d.n); wall('s', d.s);

  /* ——— wall-anchored details: trim, frames, placards ———
     wp(wall,u,y,δ): point at along-wall u, height y, δ into the room
     from the interior face. All detail geometry hangs off this frame. */
  function wsign(wall){ return (wall==='e'||wall==='n') ? 1 : -1; }
  function whoriz(wall){ return wall==='e'||wall==='w'; }
  function wp(wall, u, y, dd){
    const w = wsign(wall) * (IN - dd);
    return whoriz(wall) ? [w, y, u] : [u, y, w];
  }
  function q4(a,b,c,dd, n, col, us,vs){
    quad(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], dd[0],dd[1],dd[2],
         n[0],n[1],n[2], col, us, vs);
  }
  function wquad(wall, u0, u1, y0, y1, dd, col){       // wall-facing quad
    const s = wsign(wall);
    const n = whoriz(wall) ? [-s,0,0] : [0,0,-s];
    q4(wp(wall,u0,y0,dd), wp(wall,u1,y0,dd), wp(wall,u1,y1,dd), wp(wall,u0,y1,dd),
       n, col, (u1-u0)/2, (y1-y0)/2);
  }
  function wflat(wall, u0, u1, y, d0, d1, up, col){    // horizontal sliver
    q4(wp(wall,u0,y,d0), wp(wall,u1,y,d0), wp(wall,u1,y,d1), wp(wall,u0,y,d1),
       [0, up?1:-1, 0], col, (u1-u0)/2, .1);
  }
  function wside(wall, u, y0, y1, d0, d1, uSign, col){ // vertical sliver ⊥ wall
    const n = whoriz(wall) ? [0,0,uSign] : [uSign,0,0];
    q4(wp(wall,u,y0,d0), wp(wall,u,y0,d1), wp(wall,u,y1,d1), wp(wall,u,y1,d0),
       n, col, (d1-d0)/2, (y1-y0)/2);
  }

  curMat = 2;                          // everything from here is plain-shaded
  const TRIM = SCH.trim;
  for (const wallId of ['e','w','n','s']){
    const segs = r.doors[wallId] ? [[-HS, -DW], [DW, HS]] : [[-HS, HS]];
    for (const [a, b] of segs){
      wquad(wallId, a, b, 0, 0.11, 0.022, TRIM);
      wflat(wallId, a, b, 0.11, 0.022, 0, true, TRIM);
      wquad(wallId, a, b, H-0.14, H, 0.022, TRIM);
      wflat(wallId, a, b, H-0.14, 0.022, 0, false, TRIM);
    }
  }

  const BW = 0.075, BD = 0.055;                        // frame bar width/depth
  const CANVAS_COL = [0.092, 0.082, 0.070];            // unlit canvas (real art overlays it)
  const PLACARD_COL = [0.295, 0.275, 0.238];
  for (const A of r.artworks){
    const u0 = A.u - A.w/2, u1 = A.u + A.w/2;
    const yc = A.hangY || 1.55;
    const y0 = yc - A.h/2, y1 = yc + A.h/2;
    const F = A.frame;
    // left / right bars (full height incl. corners)
    for (const [ua, ub, outerSign] of [[u0-BW, u0, -1], [u1, u1+BW, 1]]){
      wquad(A.wall, ua, ub, y0-BW, y1+BW, BD, F);
      wside(A.wall, outerSign<0 ? ua : ub, y0-BW, y1+BW, 0, BD, outerSign, F);
      wside(A.wall, outerSign<0 ? ub : ua, y0, y1, 0, BD, -outerSign, F);
    }
    // top / bottom bars
    wquad(A.wall, u0, u1, y1, y1+BW, BD, F);
    wflat(A.wall, u0, u1, y1+BW, 0, BD, true, F);
    wflat(A.wall, u0, u1, y1, 0, BD, false, F);
    wquad(A.wall, u0, u1, y0-BW, y0, BD, F);
    wflat(A.wall, u0, u1, y0, 0, BD, true, F);
    wflat(A.wall, u0, u1, y0-BW, 0, BD, false, F);
    // canvas held proud of the wall (the art pipeline overlays pigment here)
    wquad(A.wall, u0, u1, y0, y1, 0.02, CANVAS_COL);
    // placard beside the frame, toward the roomier side
    const right = (A.segB - (u1+BW)) >= 0.62 || (u0-BW) - A.segA < 0.62;
    const pu = right ? u1 + BW + 0.30 : u0 - BW - 0.30;
    if (!A.mini && pu - 0.13 > A.segA && pu + 0.13 < A.segB){
      A.pu = pu;
      wquad(A.wall, pu-0.13, pu+0.13, 1.235, 1.365, 0.012, PLACARD_COL);
    }
  }

  /* ——— furniture ——— */
  function box(x0,y0,z0, x1,y1,z1, col){
    quad(x0,y1,z0, x1,y1,z0, x1,y1,z1, x0,y1,z1, 0,1,0,  col, (x1-x0)/2, (z1-z0)/2);
    quad(x0,y0,z0, x1,y0,z0, x1,y1,z0, x0,y1,z0, 0,0,-1, col, (x1-x0)/2, (y1-y0)/2);
    quad(x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1, 0,0,1,  col, (x1-x0)/2, (y1-y0)/2);
    quad(x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0, -1,0,0, col, (z1-z0)/2, (y1-y0)/2);
    quad(x1,y0,z0, x1,y0,z1, x1,y1,z1, x1,y1,z0, 1,0,0,  col, (z1-z0)/2, (y1-y0)/2);
  }
  const WOOD = [0.190, 0.140, 0.095], WOOD_D = [0.115, 0.085, 0.058];
  if (r.bench){
    const { x, z, alongZ } = r.bench;
    const hx = alongZ ? 0.24 : 0.90, hz = alongZ ? 0.90 : 0.24;
    box(x-hx, 0.40, z-hz, x+hx, 0.47, z+hz, WOOD);
    if (alongZ){
      box(x-0.18, 0, z-0.72, x+0.18, 0.40, z-0.60, WOOD_D);
      box(x-0.18, 0, z+0.60, x+0.18, 0.40, z+0.72, WOOD_D);
    } else {
      box(x-0.72, 0, z-0.18, x-0.60, 0.40, z+0.18, WOOD_D);
      box(x+0.60, 0, z-0.18, x+0.72, 0.40, z+0.18, WOOD_D);
    }
    r.colliders.push({ cx:x, cz:z, hx, hz });
  }
  if (r.pedestal){
    const { x, z } = r.pedestal;
    const PL = [0.400, 0.385, 0.355];
    box(x-0.23, 0, z-0.23, x+0.23, 1.08, z+0.23, PL);
    box(x-0.27, 1.08, z-0.27, x+0.27, 1.13, z+0.27, PL);
    r.colliders.push({ cx:x, cz:z, hx:0.28, hz:0.28 });
  }

  /* ——— the ceiling: rosette + chandelier ——— */
  r.flames = [];
  function ringFlat(inner, outer, y, col){
    quad(-outer, y, -outer,  outer, y, -outer,  outer, y, -inner,  -outer, y, -inner, 0,-1,0, col, outer, .1);
    quad(-outer, y,  inner,  outer, y,  inner,  outer, y,  outer,  -outer, y,  outer, 0,-1,0, col, outer, .1);
    quad(-outer, y, -inner, -inner, y, -inner, -inner, y,  inner,  -outer, y,  inner, 0,-1,0, col, .2, inner);
    quad( inner, y, -inner,  outer, y, -inner,  outer, y,  inner,   inner, y,  inner, 0,-1,0, col, .2, inner);
  }
  if (r.special !== SPECIAL.DARKROOM){
    const big = r.special === SPECIAL.VERMILION;
    const BR = big ? [0.46, 0.34, 0.15] : [0.36, 0.27, 0.13];
    const IV = [0.55, 0.50, 0.42];
    const arms = big ? 10 : 8, armL = big ? 0.74 : 0.56;
    const hubY = H - 0.62, ringY = H - 0.95;
    ringFlat(0.55, 0.72, H - 0.012, SCH.trim);
    ringFlat(0.20, 0.34, H - 0.012, SCH.trim);
    box(-0.02, hubY, -0.02, 0.02, H, 0.02, BR);
    box(-0.095, hubY - 0.15, -0.095, 0.095, hubY, 0.095, BR);
    for (let a = 0; a < arms; a++){
      const th = a/arms * Math.PI * 2;
      const dx = Math.cos(th), dz = Math.sin(th);
      const pxw = -dz*0.017, pzw = dx*0.017;
      const x0 = dx*0.095, z0 = dz*0.095, x1 = dx*armL, z1 = dz*armL;
      quad(x0+pxw, hubY-0.13, z0+pzw,  x1+pxw, ringY+0.02, z1+pzw,
           x1-pxw, ringY+0.02, z1-pzw, x0-pxw, hubY-0.13, z0-pzw,
           0, 1, 0, BR, .3, .05);
      box(x1-0.03, ringY-0.045, z1-0.03, x1+0.03, ringY+0.01, z1+0.03, BR);
      box(x1-0.015, ringY+0.01, z1-0.015, x1+0.015, ringY+0.13, z1+0.015, IV);
      r.flames.push(x1, ringY + 0.165, z1);
    }
  }

  /* ——— windows (only while the shutters stand open) ——— */
  if (WIN.on){
    const MUL = [0.045, 0.042, 0.038];
    for (const wn of r.windows){
      const u0 = wn.u - wn.w/2, u1 = wn.u + wn.w/2;
      const y0 = wn.cy - wn.h/2, y1 = wn.cy + wn.h/2;
      // casing
      wquad(wn.wall, u0-0.07, u1+0.07, y1, y1+0.07, 0.03, SCH.trim);
      wquad(wn.wall, u0-0.07, u1+0.07, y0-0.07, y0, 0.03, SCH.trim);
      wquad(wn.wall, u0-0.07, u0, y0, y1, 0.03, SCH.trim);
      wquad(wn.wall, u1, u1+0.07, y0, y1, 0.03, SCH.trim);
      // sill
      wflat(wn.wall, u0-0.09, u1+0.09, y0-0.07, 0.0, 0.085, true, SCH.trim);
      // mullions over the glass
      wquad(wn.wall, wn.u-0.022, wn.u+0.022, y0, y1, 0.024, MUL);
      wquad(wn.wall, u0, u1, wn.cy-0.022, wn.cy+0.022, 0.024, MUL);
      wquad(wn.wall, u0, u1, y0 + wn.h*0.78 - 0.02, y0 + wn.h*0.78 + 0.02, 0.024, MUL);
    }
  }

  /* ——— the floor, last: its own range, drawn over the reflections ——— */
  const floorStart = I.length;
  curMat = 1;
  quad(-IN,0, IN,  IN,0, IN,  IN,0,-IN,  -IN,0,-IN,  0,1,0, COL.floor, S/2, S/2);
  if (d.e) quad( IN,0, DW,  HS,0, DW,  HS,0,-DW,   IN,0,-DW,  0,1,0, COL.floor, .3,1);
  if (d.w) quad(-HS,0, DW, -IN,0, DW, -IN,0,-DW,  -HS,0,-DW,  0,1,0, COL.floor, .3,1);
  if (d.n) quad(-DW,0, HS, -DW,0, IN,   DW,0, IN,   DW,0, HS,  0,1,0, COL.floor, .3,1);
  if (d.s) quad(-DW,0,-IN, -DW,0,-HS,   DW,0,-HS,   DW,0,-IN,  0,1,0, COL.floor, .3,1);

  return { verts: new Float32Array(V), idx: new Uint16Array(I), floorStart };
}

/* Final light list: own lights + neighbour lights that sit within reach
   of a shared open doorway (their glow should spill through), cap 8. */
function assembleLights(r){
  const L = [];
  if (WIN.on){
    const IN = HS - WT;
    for (const wn of r.windows){
      const sign = (wn.wall==='e'||wn.wall==='n') ? 1 : -1;
      const horiz = (wn.wall==='e'||wn.wall==='w');
      const p = horiz ? [sign*(IN-0.06), 2.15, wn.u] : [wn.u, 2.15, sign*(IN-0.06)];
      const t = horiz ? [sign*(IN) - sign*5.2, 0.35, wn.u*0.35] : [wn.u*0.35, 0.35, sign*IN - sign*5.2];
      const sun = spotAt(p, t, [3.3, 2.95, 2.2], 0.80, 0.44, 10.5);
      sun.sun = true;
      L.push(sun);
    }
  }
  for (const l of r.ownLights){ if (L.length >= 8) break; L.push(l); }
  const doorDefs = [
    ['e',  1,  0, [ HS, 1.5, 0]], ['w', -1,  0, [-HS, 1.5, 0]],
    ['n',  0,  1, [ 0, 1.5,  HS]], ['s',  0, -1, [ 0, 1.5, -HS]],
  ];
  const cand = [];
  for (const [wall, dx, dz, dc] of doorDefs){
    if (!r.doors[wall]) continue;
    const nb = getRoom(r.gx + dx, r.gz + dz);
    for (const nl of nb.ownLights){
      const px = nl.p[0] + dx*S, pz = nl.p[2] + dz*S;
      const dist = Math.hypot(px - dc[0], pz - dc[2]);   // horizontal reach
      if (dist < 2.9) cand.push([dist, { ...nl, p: [px, nl.p[1], pz] }]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, l] of cand){ if (L.length >= 8) break; L.push(l); }
  r.lights = L;
}

/* ————— §4 GL core ————— */
const canvas = document.getElementById('gl');
let gl = null;
try { gl = canvas.getContext('webgl2', { antialias:true, alpha:false, powerPreference:'high-performance' }); }
catch(e){ gl = null; }
if (!gl){
  document.getElementById('nogl').hidden = false;
  document.getElementById('intro').hidden = true;
  console.error('[boot] webgl2 unavailable — museum closed');
} else {
  trace('[boot] gl ok');
}

function compile(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    console.error('[boot] shader error:', gl.getShaderInfoLog(sh), src);
    throw new Error('shader');
  }
  return sh;
}
function program(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.error('[boot] link error:', gl.getProgramInfoLog(p));
    throw new Error('link');
  }
  return p;
}

/* Architecture shader — M2 placeholder lighting (a fixed key light + fog).
   M3 replaces the fragment stage with per-room spotlight arrays.        */
/* Spotlights as parallel uniform arrays (three uniform4fv calls),
   constant-bound loop with early break. Blinn-Phong gloss is keyed to
   upward-facing surfaces so the floor carries the light streaks. */

let progArch = null, uArch = {};
function initPrograms(){
  progArch = program(VS_ARCH, FS_ARCH);
  uArch = {
    mv: gl.getUniformLocation(progArch, 'uMV'),
    p:  gl.getUniformLocation(progArch, 'uP'),
    fog:gl.getUniformLocation(progArch, 'uFog'),
    sig:gl.getUniformLocation(progArch, 'uSigma'),
    alpha:gl.getUniformLocation(progArch, 'uAlpha'),
    amb:gl.getUniformLocation(progArch, 'uAmb'),
    upv:gl.getUniformLocation(progArch, 'uUpV'),
    nl: gl.getUniformLocation(progArch, 'uNL'),
    lpos:gl.getUniformLocation(progArch, 'uLPos'),
    ldir:gl.getUniformLocation(progArch, 'uLDir'),
    lcol:gl.getUniformLocation(progArch, 'uLCol'),
  };
  gl.useProgram(progArch);
  gl.uniform1i(gl.getUniformLocation(progArch, 'uPlaster'), 1);
  gl.uniform1i(gl.getUniformLocation(progArch, 'uParquet'), 2);
  makeSurfaceTextures();
  progPaint = program(VS_PAINT, FS_PAINT);
  uPaint = {};
  for (const nm of ['uMV','uP','uO','uU','uV','uN','uTex','uFog','uSigma','uFade','uEm','uAT','uNL','uLPos','uLDir','uLCol'])
    uPaint[nm] = gl.getUniformLocation(progPaint, nm);
  quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) window.__aniso = { ext: aniso, max: Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) };

  progBright = program(VS_POST, FS_BRIGHT);
  uBright.uTex = gl.getUniformLocation(progBright, 'uTex');
  progBlur = program(VS_POST, FS_BLUR);
  uBlur.uTex = gl.getUniformLocation(progBlur, 'uTex');
  uBlur.uDir = gl.getUniformLocation(progBlur, 'uDir');
  progComp = program(VS_POST, FS_COMP);
  for (const nm of ['uTex','uBloom','uTime','uRes'])
    uComp[nm] = gl.getUniformLocation(progComp, nm);

  progFlame = program(VS_FLAME, FS_FLAME);
  for (const nm of ['uMV','uP','uTime','uCol','uMY'])
    uFlame[nm] = gl.getUniformLocation(progFlame, nm);
  progShaft = program(VS_SHAFT, FS_SHAFT);
  for (const nm of ['uMV','uP','uC','uAxis','uDim','uCol','uTime'])
    uShaft[nm] = gl.getUniformLocation(progShaft, nm);
  progMote = program(VS_MOTE, FS_MOTE);
  for (const nm of ['uMV','uP','uC','uDim','uTime','uCol'])
    uMote[nm] = gl.getUniformLocation(progMote, nm);
  moteVAO = gl.createVertexArray();
  gl.bindVertexArray(moteVAO);
  const mb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mb);
  const mrnd = mulberry32(0x00D57);
  const md = new Float32Array(48*4);
  for (let i = 0; i < 48; i++){ md[i*4]=mrnd(); md[i*4+1]=mrnd(); md[i*4+2]=mrnd(); md[i*4+3]=0.5+mrnd(); }
  gl.bufferData(gl.ARRAY_BUFFER, md, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);

  /* the one placard every museum needs */
  pctx.fillStyle = '#E9E2D2'; pctx.fillRect(0, 0, 256, 128);
  pctx.fillStyle = '#D6CDB8'; pctx.fillRect(0, 0, 256, 3);
  pctx.fillStyle = '#1F1C18'; pctx.font = 'italic 20px Georgia, serif';
  pctx.fillText('Untitled', 14, 42);
  pctx.font = '13px Georgia, serif'; pctx.fillStyle = '#5D574C';
  pctx.fillText('(stolen)', 14, 70);
  pctx.font = '12px Georgia, serif'; pctx.fillStyle = '#837C6E';
  pctx.fillText('its recovery is quietly hoped for', 14, 96);
  stolenTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, stolenTex);
  gl.texStorage2D(gl.TEXTURE_2D, 8, gl.RGBA8, 256, 128);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pscratch);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
const AMB_BASE = [0.058, 0.052, 0.043];
const LPOS = new Float32Array(32), LDIR = new Float32Array(32), LCOL = new Float32Array(32);
/* one packer for both passes; the lamp switch spares only sunlight */
function packLights(r, ox, oz){
  const list = r.lights; let n = 0;
  for (let i = 0; i < list.length && n < 8; i++){
    const l = list[i];
    if (!lightsOn && !l.sun) continue;
    const b = n*4;
    const px = l.p[0]+ox, py = l.p[1], pz = l.p[2]+oz;
    LPOS[b]   = M_V[0]*px + M_V[4]*py + M_V[8]*pz  + M_V[12];
    LPOS[b+1] = M_V[1]*px + M_V[5]*py + M_V[9]*pz  + M_V[13];
    LPOS[b+2] = M_V[2]*px + M_V[6]*py + M_V[10]*pz + M_V[14];
    LPOS[b+3] = l.invR2;
    LDIR[b]   = M_V[0]*l.d[0] + M_V[4]*l.d[1] + M_V[8]*l.d[2];
    LDIR[b+1] = M_V[1]*l.d[0] + M_V[5]*l.d[1] + M_V[9]*l.d[2];
    LDIR[b+2] = M_V[2]*l.d[0] + M_V[6]*l.d[1] + M_V[10]*l.d[2];
    LDIR[b+3] = l.outer;
    LCOL[b] = l.col[0]; LCOL[b+1] = l.col[1]; LCOL[b+2] = l.col[2];
    LCOL[b+3] = l.inner;
    n++;
  }
  return n;
}

/* ————— §5b Art: paint program, texture pools, scheduler ————— */
let progPaint = null, uPaint = {}, quadVAO = null;

/* moon shafts + drifting dust motes (special rooms) — additive pass */
let progShaft = null, uShaft = {}, progMote = null, uMote = {}, moteVAO = null, stolenTex = null;
const MOON = [0.42, 0.52, 0.72];

/* candle flames on the chandeliers — additive points, gentle flicker */
let progFlame = null, uFlame = {};

/* ————— surface grain: plaster + walnut parquet, generated once ————— */
let plasterTex = null, parquetTex = null, shadowTex = null;
function texFromCanvas(c, repeat){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = Math.floor(Math.log2(Math.max(c.width, c.height))) + 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, c.width, c.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  if (window.__aniso)
    gl.texParameterf(gl.TEXTURE_2D, window.__aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, window.__aniso.max);
  return t;
}
function makeSurfaceTextures(){
  const rnd = mulberry32(0x7E47);
  /* plaster: near-flat fine grain with soft blotches */
  {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 256, 256);
    const img = g.getImageData(0, 0, 256, 256);
    for (let i = 0; i < 256*256; i++){
      const v = 246 + rnd()*10 - 5 + Math.sin(i*0.31)*1.5;
      img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.026;
    for (let b = 0; b < 40; b++){
      g.fillStyle = rnd() < 0.5 ? '#000000' : '#FFFFFF';
      g.beginPath();
      g.arc(rnd()*256, rnd()*256, 22 + rnd()*50, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    plasterTex = texFromCanvas(c, true);
  }
  /* parquet: 8 staggered planks per 2 m tile, grain and seams */
  {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#C9C2B8'; g.fillRect(0, 0, 512, 512);
    const PL = 512/8;
    for (let p = 0; p < 8; p++){
      const y0 = p*PL;
      const base = 188 + (rnd()-0.5)*46;
      g.fillStyle = `rgb(${base|0},${(base*0.965)|0},${(base*0.92)|0})`;
      g.fillRect(0, y0, 512, PL);
      /* lengthwise grain */
      for (let s = 0; s < 26; s++){
        const gy = y0 + rnd()*PL;
        g.strokeStyle = `rgba(${rnd()<0.5?30:236},${rnd()<0.5?24:230},${20},${0.05 + rnd()*0.07})`;
        g.lineWidth = 0.7 + rnd()*1.4;
        g.beginPath();
        g.moveTo(-8, gy);
        for (let x = 0; x <= 512; x += 64) g.lineTo(x, gy + Math.sin(x*0.02 + s)*1.6);
        g.stroke();
      }
      /* butt joints, staggered */
      g.fillStyle = 'rgba(18,14,10,0.55)';
      const off = (p*197) % 512;
      g.fillRect(off, y0, 2, PL);
      g.fillRect((off + 256) % 512, y0, 2, PL);
      /* seam between planks */
      g.fillRect(0, y0, 512, 1.6);
      /* the odd knot */
      if (rnd() < 0.4){
        g.fillStyle = 'rgba(40,28,18,0.5)';
        g.beginPath(); g.arc(rnd()*512, y0 + rnd()*PL, 2.2 + rnd()*2.6, 0, 7); g.fill();
      }
    }
    parquetTex = texFromCanvas(c, true);
  }
  /* a soft dark rectangle for contact shadows (alpha in .a) */
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    const rg = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    rg.addColorStop(0, 'rgba(0,0,0,0.62)');
    rg.addColorStop(0.55, 'rgba(0,0,0,0.34)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    shadowTex = texFromCanvas(c, false);
  }
}

/* daylight — a single procedural sky, shared by every window */
let skyTex = null;
function ensureSkyTex(){
  if (skyTex) return skyTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 384;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, '#FDF6E3'); grad.addColorStop(0.55, '#FBE9C4'); grad.addColorStop(1, '#F2D49B');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 384);
  const sun = g.createRadialGradient(176, 118, 6, 176, 118, 130);
  sun.addColorStop(0, 'rgba(255,253,244,0.95)'); sun.addColorStop(0.25, 'rgba(255,244,214,0.45)');
  sun.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 256, 384);
  skyTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.texStorage2D(gl.TEXTURE_2D, 8, gl.RGBA8, 256, 384);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return skyTex;
}

/* the two wall switches */
const WIN = { on: false };
let lightsOn = true;
const DAY_FOG = [0.292, 0.268, 0.226];
function swUI(){
  document.getElementById('sw-lights').classList.toggle('on', lightsOn);
  document.getElementById('sw-shutters').classList.toggle('on', WIN.on);
}
function setLights(on, quiet){
  lightsOn = !!on; swUI();
  persist.lightsOn = lightsOn; savePersist();
  if (!quiet) flashHint(lightsOn ? 'the lamps are lit' : 'the lamps are out');
}
function rebuildRooms(){
  for (const [, r] of rooms){ dropRoomGL(r); r.lights = null; }
  ensureBuilt(); refreshNear();
}
function setShutters(on, quiet){
  WIN.on = !!on; swUI();
  persist.shutters = WIN.on; savePersist();
  rebuildRooms();
  if (!quiet) flashHint(WIN.on ? 'shutters open — let there be daylight' : 'shutters closed — the night returns');
}

/* ————— §9 Post stack: bloom → filmic tonemap → vignette → grain ————— */
let progBright, progBlur, progComp, uBright = {}, uBlur = {}, uComp = {};
const post = { on: true, ready: false, w: 0, h: 0, qw: 0, qh: 0,
               fboScene: null, texScene: null, depthRb: null,
               fboA: null, texA: null, fboB: null, texB: null,
               pendingAt: 0 };
function makePostTex(w, h){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function allocPost(){
  for (const k of ['texScene','texA','texB']) if (post[k]) gl.deleteTexture(post[k]);
  for (const k of ['fboScene','fboA','fboB']) if (post[k]) gl.deleteFramebuffer(post[k]);
  if (post.depthRb) gl.deleteRenderbuffer(post.depthRb);
  post.w = vpW; post.h = vpH;
  post.qw = Math.max(1, vpW >> 2); post.qh = Math.max(1, vpH >> 2);
  post.texScene = makePostTex(post.w, post.h);
  post.depthRb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, post.depthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, post.w, post.h);
  post.fboScene = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboScene);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texScene, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, post.depthRb);
  post.texA = makePostTex(post.qw, post.qh);
  post.fboA = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texA, 0);
  post.texB = makePostTex(post.qw, post.qh);
  post.fboB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texB, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  post.ready = true;
}
function runPost(){
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(quadVAO);
  gl.activeTexture(gl.TEXTURE0);
  /* bright pass → quarter res */
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboA);
  gl.viewport(0, 0, post.qw, post.qh);
  gl.useProgram(progBright);
  gl.uniform1i(uBright.uTex, 0);
  gl.bindTexture(gl.TEXTURE_2D, post.texScene);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  /* two separable blur rounds */
  gl.useProgram(progBlur);
  gl.uniform1i(uBlur.uTex, 0);
  for (let i = 0; i < 2; i++){
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboB);
    gl.bindTexture(gl.TEXTURE_2D, post.texA);
    gl.uniform2f(uBlur.uDir, 1/post.qw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboA);
    gl.bindTexture(gl.TEXTURE_2D, post.texB);
    gl.uniform2f(uBlur.uDir, 0, 1/post.qh);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  /* composite to canvas */
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, vpW, vpH);
  gl.useProgram(progComp);
  gl.uniform1i(uComp.uTex, 0);
  gl.uniform1i(uComp.uBloom, 1);
  gl.uniform1f(uComp.uTime, (performance.now() % 300000)/1000);
  gl.uniform2f(uComp.uRes, vpW, vpH);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, post.texScene);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, post.texA);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
}

const TEX_SIZES = { L: [512, 384], P: [384, 512], S: [448, 448], W: [512, 320] };
function makePool(n, w, h){
  return { w, h, slots: Array.from({length: n}, () => ({ tex: null, used: false, A: null, r: null })) };
}
const POOLS = { L: makePool(24,512,384), P: makePool(24,384,512), S: makePool(24,448,448), W: makePool(24,512,320) };
const PPOOL = makePool(64, 256, 128);
function acquireSlot(pool, A, r){
  for (const s of pool.slots){
    if (s.used) continue;
    if (!s.tex){
      s.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      const levels = Math.floor(Math.log2(Math.max(pool.w, pool.h))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, pool.w, pool.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (window.__aniso)
        gl.texParameterf(gl.TEXTURE_2D, window.__aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, window.__aniso.max);
    }
    s.used = true; s.A = A; s.r = r;
    return s;
  }
  return null;
}
function releaseSlot(s){
  if (s.A){ if (s.A.tex === s) s.A.tex = null; if (s.A.ptex === s) s.A.ptex = null; }
  s.used = false; s.A = null; s.r = null;
}
function releaseOutside(){
  for (const pool of [POOLS.L, POOLS.P, POOLS.S, POOLS.W, PPOOL])
    for (const s of pool.slots)
      if (s.used && s.r &&
          Math.max(Math.abs(s.r.gx - player.gx), Math.abs(s.r.gz - player.gz)) > 1)
        releaseSlot(s);
  for (const [k, o] of curator.overrides)
    if (Math.max(Math.abs(o.r.gx - player.gx), Math.abs(o.r.gz - player.gz)) > 1){
      gl.deleteTexture(o.tex);
      o.A.override = null;                 // reapplied from the blob on return
      curator.overrides.delete(k);
    }
}
function freeAllArtSlots(){
  for (const pool of [POOLS.L, POOLS.P, POOLS.S, POOLS.W, PPOOL])
    for (const s of pool.slots) releaseSlot(s);
}

/* scratch canvases (one for paintings, one for placards) */
/* willReadFrequently keeps these CPU-side: stroke raster then lands inside
   the budgeted generator slices instead of one giant flush at upload time */
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { alpha: false, willReadFrequently: true });
const pscratch = document.createElement('canvas');
pscratch.width = 256; pscratch.height = 128;
const pctx = pscratch.getContext('2d', { alpha: false, willReadFrequently: true });

const artState = { jobs: new Map(), queue: [], active: null, uploadReady: null,
                   placards: [], beheld: 0 };
/* park in-flight jobs (they restart cleanly from their seeds) before anything
   else borrows the scratch canvas or the shared attractor accumulator */
function preemptArtJobs(){
  for (const j of [artState.active, artState.uploadReady]){
    if (!j) continue;
    if (j.slot) releaseSlot(j.slot);
    j.slot = null; j.gen = null; j.ms = 0;
    artState.queue.unshift(j);
  }
  artState.active = null; artState.uploadReady = null;
}
function artJobKey(r, i){ return r.gx + ',' + r.gz + ':' + i; }

function syncArtJobs(){
  releaseOutside();
  const want = new Set();
  for (let dj=-1; dj<=1; dj++)
    for (let di=-1; di<=1; di++){
      const r = rooms.get(roomKey(player.gx + di, player.gz + dj));
      if (!r) continue;
      const prio = Math.max(Math.abs(di), Math.abs(dj));
      r.artworks.forEach((A, i) => {
        const k = artJobKey(r, i);
        want.add(k);
        if (curator.placements.has(k)){ applyPlacement(r, A, i); return; }
        if (A.tex) return;
        let job = artState.jobs.get(k);
        if (!job){
          job = { k, r, A, i, prio, gen: null, slot: null, ms: 0 };
          artState.jobs.set(k, job);
          artState.queue.push(job);
        } else job.prio = prio;
      });
    }
  for (const [k, job] of artState.jobs){
    if (want.has(k)) continue;
    if (job.slot) releaseSlot(job.slot);
    if (artState.active === job) artState.active = null;
    if (artState.uploadReady === job) artState.uploadReady = null;
    artState.jobs.delete(k);
    const qi = artState.queue.indexOf(job);
    if (qi >= 0) artState.queue.splice(qi, 1);
  }
  artState.queue.sort((a, b) => a.prio - b.prio);
  artState.placards = artState.placards.filter(A => A.ptexWanted);
}

function startJob(job){
  const A = job.A;
  const [w, h] = TEX_SIZES[A.asp];
  job.slot = acquireSlot(POOLS[A.asp], A, job.r);
  if (!job.slot){ artState.queue.push(job); return false; }   // pool full — retry later
  scratch.width = w; scratch.height = h;
  const rnd = mulberry32(A.seed);
  A.title = A.title || makeTitle(mulberry32(h2(A.seed, 0x717, WORLD_SEED)));
  const effAlgo = A.algo % ALGOS.length;
  job.effAlgo = effAlgo;
  job.gen = ALGOS[effAlgo](sctx, w, h, rnd, jitterPal(A.pal, rnd));
  return true;
}

function renderPlacard(A){
  const g = pctx;
  g.fillStyle = '#E9E2D2'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#D6CDB8'; g.fillRect(0, 0, 256, 3);
  g.fillStyle = '#1F1C18';
  g.font = 'italic 20px Georgia, serif'; g.textBaseline = 'alphabetic';
  let title = A.title || 'Untitled';
  if (g.measureText(title).width > 230){
    while (g.measureText(title + '…').width > 230 && title.length > 4) title = title.slice(0, -1);
    title += '…';
  }
  g.fillText(title, 14, 38);
  g.font = '13px Georgia, serif'; g.fillStyle = '#5D574C';
  if (A.overrideName){
    g.fillText('private loan', 14, 66);
    g.font = '12px Georgia, serif'; g.fillStyle = '#837C6E';
    g.fillText('the curator’s collection', 14, 90);
    g.fillText('on generous terms', 14, 110);
  } else {
    const year = 1870 + (h2(A.seed, 0x9999, WORLD_SEED) % 200);
    g.fillText(`${ALGO_NAMES[A.algo % ALGOS.length]}, ${year}`, 14, 66);
    g.font = '12px Georgia, serif'; g.fillStyle = '#837C6E';
    g.fillText(`algorithm & seed ${A.seed}`, 14, 90);
    g.fillText('edition 1 of 1', 14, 110);
  }
}

function pumpArt(){
  /* one finished texture reaches the GPU per frame */
  if (artState.uploadReady){
    const job = artState.uploadReady; artState.uploadReady = null;
    const A = job.A;
    gl.bindTexture(gl.TEXTURE_2D, job.slot.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    gl.generateMipmap(gl.TEXTURE_2D);
    A.tex = job.slot;
    A.fadeAt = performance.now();
    if (!A.mini){ A.ptexWanted = true; artState.placards.push(A); }
    artState.jobs.delete(job.k);
    if (job.r.gx === player.gx && job.r.gz === player.gz && !A.seen){
      A.seen = true; artState.beheld++; updateHudStat();
    }
    trace(`[gen] art (${job.r.gx},${job.r.gz},${job.i}) ${job.ms|0}ms algo=${job.effAlgo} seed=${A.seed}`);
  } else if (artState.placards.length){
    /* placards are tiny — one per otherwise-idle upload window */
    const A = artState.placards.shift();
    if (A.ptexWanted && A.tex && A.tex.r){
      const slot = acquireSlot(PPOOL, A, A.tex.r);
      if (slot){
        renderPlacard(A);
        gl.bindTexture(gl.TEXTURE_2D, slot.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pscratch);
        gl.generateMipmap(gl.TEXTURE_2D);
        A.ptex = slot;
      } else artState.placards.push(A);
    }
  }
  /* generation under a hard time budget — generous while the intro holds
     the visitor, so the first wing hangs before they step in */
  const deadline = performance.now() + (entered ? 3.5 : 9);
  while (performance.now() < deadline){
    if (!artState.active){
      let next = artState.queue.shift();
      while (next && (next.A.tex || !artState.jobs.has(next.k))) next = artState.queue.shift();
      if (!next) break;
      if (!startJob(next)) break;
      artState.active = next;
    }
    const job = artState.active;
    const t1 = performance.now();
    const { done } = job.gen.next();
    const el = performance.now() - t1;
    job.ms += el;
    if (el > 6) console.warn(`[gen] slice ${el.toFixed(1)}ms > 6ms budget (algo ${job.effAlgo})`);
    if (done){
      finishArt(sctx, scratch.width, scratch.height);
      artState.uploadReady = job;
      artState.active = null;
      break;                       // the upload happens next frame
    }
  }
}

function updateHudStat(){
  const el = document.getElementById('hud-stat');
  const guest = (typeof cloud !== 'undefined' && cloud.viewing) ? `guest of ${cloud.viewing.slug} · ` : '';
  el.textContent = `${guest}${visited.size} room${visited.size===1?'':'s'} · ${artState.beheld} work${artState.beheld===1?'':'s'}`;
}
function markSeen(){
  const r = rooms.get(roomKey(player.gx, player.gz));
  if (!r) return;
  let ch = false;
  for (const A of r.artworks)
    if (A.tex && !A.seen){ A.seen = true; artState.beheld++; persist.works = (persist.works|0) + 1; ch = true; }
  if (ch){ updateHudStat(); savePersist(); }
}

/* per-wall painting frame: origin corner + right/up spans (viewer-correct) */
function paintBasis(A, out, PD = 0.028){
  const IN2 = HS - WT, PPD = 0.016;
  const y0 = (A.hangY || 1.55) - A.h/2;
  const horiz = (A.wall==='e'||A.wall==='w');
  const sign = (A.wall==='e'||A.wall==='n') ? 1 : -1;
  const flip = (A.wall==='w'||A.wall==='n') ? -1 : 1;
  const u0 = flip > 0 ? A.u - A.w/2 : A.u + A.w/2;
  const wallC = sign * (IN2 - PD);
  if (horiz){ out.o[0]=wallC; out.o[1]=y0; out.o[2]=u0; out.u[0]=0; out.u[1]=0; out.u[2]=flip*A.w; out.n[0]=-sign; out.n[1]=0; out.n[2]=0; }
  else      { out.o[0]=u0; out.o[1]=y0; out.o[2]=wallC; out.u[0]=flip*A.w; out.u[1]=0; out.u[2]=0; out.n[0]=0; out.n[1]=0; out.n[2]=-sign; }
  out.v[0]=0; out.v[1]=A.h; out.v[2]=0;
  out.pwallC = sign * (IN2 - PPD);
  return out;
}
const PB = { o:[0,0,0], u:[0,0,0], v:[0,0,0], n:[0,0,0], pwallC:0 };
const SHA = { wall:'e', u:0, w:1, h:1, hangY:1.55 };   // scratch for shadow quads

/* adaptive quality: 2 full · 1 lighter DPR · 0 low DPR, no reflections */
const PERF = { q: 2, lastDrop: 0 };
function dprCap(){ return PERF.q === 2 ? DPR_CAP : PERF.q === 1 ? 1.25 : 1.0; }

function makeRoomVAO(r){
  const mesh = buildRoomMesh(r);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
  const ST = 48;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, ST, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, ST, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, ST, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, ST, 32);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, ST, 44);
  gl.bindVertexArray(null);
  r.vao = vao; r.vbo = vbo; r.ibo = ibo; r.nIdx = mesh.idx.length;
  r.floorStart = mesh.floorStart;
  if (r.flames && r.flames.length){
    r.flameVAO = gl.createVertexArray();
    gl.bindVertexArray(r.flameVAO);
    r.flameVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, r.flameVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(r.flames), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    r.nFlames = r.flames.length / 3;
  }
  assembleLights(r);
  trace(`[world] built room (${r.gx},${r.gz}) seed=${r.seed}`);
}
function dropRoomGL(r){
  if (r.vao){ gl.deleteVertexArray(r.vao); gl.deleteBuffer(r.vbo); gl.deleteBuffer(r.ibo); }
  if (r.flameVAO){ gl.deleteVertexArray(r.flameVAO); gl.deleteBuffer(r.flameVBO); }
  r.vao = r.vbo = r.ibo = null; r.nIdx = 0;
  r.flameVAO = r.flameVBO = null; r.nFlames = 0;
}

/* ————— §7 Renderer state / floating origin ————— */
const player = {
  gx: 0, gz: 0,          // anchor room (also the room the player is in)
  x: 0, z: 0,            // anchor-local position
  yaw: 0, pitch: 0,
  vx: 0, vz: 0,
  py: 0, vy: 0,          // height above the floor, vertical speed
  jumps: 0, lastJumpT: 0,
};
const M_P = mat4(), M_V = mat4(), M_MV = mat4(), M_PV = mat4();
let vpW = 0, vpH = 0;

function resize(){
  const dpr = Math.min(devicePixelRatio || 1, dprCap());
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (w !== vpW || h !== vpH){
    vpW = w; vpH = h;
    canvas.width = w; canvas.height = h;
  }
}
addEventListener('resize', resize);

let visited = new Set();
/* per-anchor room caches — the frame loop must not chase map keys */
const nearRooms = [], midRooms = [];
function refreshNear(){
  nearRooms.length = 0; midRooms.length = 0;
  for (let dj=-BUILD_R; dj<=BUILD_R; dj++)
    for (let di=-BUILD_R; di<=BUILD_R; di++){
      const r = rooms.get(roomKey(player.gx + di, player.gz + dj));
      if (!r) continue;
      const e = { r, ox: di*S, oz: dj*S };
      nearRooms.push(e);
      if (Math.abs(di) <= 1 && Math.abs(dj) <= 1) midRooms.push(e);
    }
}
function onRoomChanged(){
  const k0 = roomKey(player.gx, player.gz);
  if (!visited.has(k0)){ persist.rooms = (persist.rooms|0) + 1; savePersist(); }
  visited.add(k0);
  const hudLoc = document.getElementById('hud-loc');
  const f = (n)=> (n < 0 ? '−' + (-n) : '' + n);
  hudLoc.textContent = `Wing ${f(player.gx)} · Hall ${f(player.gz)}`;
  updateHudStat();
  ensureBuilt(); evict(); syncArtJobs(); markSeen(); refreshNear();
}
function ensureBuilt(){
  for (let dj=-BUILD_R; dj<=BUILD_R; dj++)
    for (let di=-BUILD_R; di<=BUILD_R; di++){
      const r = getRoom(player.gx + di, player.gz + dj);
      if (!r.vao) makeRoomVAO(r);
    }
}
function evict(){
  for (const [k, r] of rooms){
    if (Math.max(Math.abs(r.gx - player.gx), Math.abs(r.gz - player.gz)) > EVICT_R){
      dropRoomGL(r);
      rooms.delete(k);
    }
  }
}

/* ————— §8 Controls & collision ————— */
const keys = new Set();
let entered = false, locked = false, dragging = false, lastMX = 0, lastMY = 0;

addEventListener('keydown', (e)=>{
  if (!entered || e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  const modal = document.getElementById('modal');
  if (!modal.hidden){
    if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Space' || e.key === 'Escape') modal.click();
    return;
  }
  if (!document.getElementById('curator').hidden){
    if (e.code === 'KeyC') curatorToggle();
    return;                              // panel is open — the gallery holds still
  }
  if (e.code === 'KeyF'){ inspect.on ? inspectOff() : inspectOn(); return; }
  if (e.code === 'KeyE'){ acquire(); return; }
  if (e.code === 'KeyM'){ toggleMute(); return; }
  if (e.code === 'KeyL'){ setLights(!lightsOn); return; }
  if (e.code === 'KeyO'){ setShutters(!WIN.on); return; }
  if (e.code === 'KeyC'){ curatorToggle(); return; }
  if (e.code === 'KeyH'){ curatorHang(); return; }
  if (e.code === 'KeyU'){ curatorUnhang(); return; }
  if (e.code === 'Space'){ doJump(); return; }
  if (inspect.on && ['KeyW','KeyA','KeyS','KeyD'].includes(e.code)) inspectOff();
  keys.add(e.code);
});
/* one press — one jump; a quick second press — the impossible second step */
function doJump(){
  if (inspect.on || !entered) return;
  const now = performance.now();
  if (player.py <= 0.0001 && player.jumps === 0){
    player.vy = 4.6; player.jumps = 1; player.lastJumpT = now;
    footstep(2.2);
  } else if (player.jumps === 1 && now - player.lastJumpT < 520){
    player.vy = 4.25; player.jumps = 2;
    if (audio.ok && !audio.muted) bell(audio.ctx.currentTime + 0.01, 659.26);
  }
}
addEventListener('keyup', (e)=>{ keys.delete(e.code); });
addEventListener('blur', ()=>{ keys.clear(); dragging = false; });

document.addEventListener('pointerlockchange', ()=>{
  locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
});
canvas.addEventListener('mousedown', (e)=>{
  if (!entered) return;
  if (e.button === 0){ dragging = true; lastMX = e.clientX; lastMY = e.clientY; }
  if (e.button === 2){ inspect.on ? inspectOff() : inspectOn(); }
});
canvas.addEventListener('contextmenu', (e)=>{ if (entered) e.preventDefault(); });
addEventListener('mouseup', ()=>{ dragging = false; });
addEventListener('mousemove', (e)=>{
  if (!entered || inspect.on) return;
  let dx = 0, dy = 0;
  if (locked){ dx = e.movementX; dy = e.movementY; }
  else if (dragging){ dx = e.clientX - lastMX; dy = e.clientY - lastMY; lastMX = e.clientX; lastMY = e.clientY; }
  else return;
  const sens = locked ? 0.0022 : 0.0034;
  player.yaw += dx * sens;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - dy * sens));
});
function tryPointerLock(){
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(()=>{});
  } catch(e){ /* drag-look remains */ }
}
canvas.addEventListener('click', ()=>{ if (entered && !locked) tryPointerLock(); });

/* collider gather: 3×3 rooms → anchor-local AABBs (preallocated) */
const colBuf = new Float32Array(4 * 128);
let colN = 0;
function gatherColliders(){
  colN = 0;
  for (let ri = 0; ri < midRooms.length; ri++){
    const { r, ox, oz } = midRooms[ri];
    const cs = r.colliders;
    for (let i = 0; i < cs.length; i++){
      if (colN >= 128) break;
      const c = cs[i], b = colN * 4;
      colBuf[b] = c.cx + ox; colBuf[b+1] = c.cz + oz;
      colBuf[b+2] = c.hx;    colBuf[b+3] = c.hz;
      colN++;
    }
  }
}
function collide(){
  for (let pass=0; pass<3; pass++){
    for (let i=0; i<colN; i++){
      const b = i*4, cx = colBuf[b], cz = colBuf[b+1], hx = colBuf[b+2], hz = colBuf[b+3];
      const nx = Math.max(cx-hx, Math.min(player.x, cx+hx));
      const nz = Math.max(cz-hz, Math.min(player.z, cz+hz));
      let dx = player.x - nx, dz = player.z - nz;
      const d2 = dx*dx + dz*dz;
      if (d2 >= PR*PR) continue;
      if (d2 > 1e-12){
        const dInv = 1/Math.sqrt(d2), push = PR - Math.sqrt(d2);
        player.x += dx * dInv * push;
        player.z += dz * dInv * push;
      } else {
        // centre inside the box (or exactly on a corner): push along least penetration
        const pxr = (hx + PR) - Math.abs(player.x - cx);
        const pzr = (hz + PR) - Math.abs(player.z - cz);
        if (pxr < pzr) player.x += (player.x >= cx ? 1 : -1) * pxr;
        else           player.z += (player.z >= cz ? 1 : -1) * pzr;
      }
    }
  }
}

/* autopilot: drift from room centre to room centre through open doors */
const auto = { on: false, rnd: mulberry32(0xA070), wp: null, lastDx: 0, lastDz: 0, stallT: 0 };
function autoPick(){
  const r = rooms.get(roomKey(player.gx, player.gz));
  if (!r) return;
  const opts = [];
  if (r.doors.e) opts.push([ 1, 0]);
  if (r.doors.w) opts.push([-1, 0]);
  if (r.doors.n) opts.push([ 0, 1]);
  if (r.doors.s) opts.push([ 0,-1]);
  let pick = opts[Math.floor(auto.rnd()*opts.length)] || [0, 0];
  if (opts.length > 1 && pick[0] === -auto.lastDx && pick[1] === -auto.lastDz && auto.rnd() < 0.75){
    pick = opts[Math.floor(auto.rnd()*opts.length)];
  }
  auto.lastDx = pick[0]; auto.lastDz = pick[1];
  auto.wp = { gx: player.gx + pick[0], gz: player.gz + pick[1],
              ox: (auto.rnd()-0.5)*2.0, oz: (auto.rnd()-0.5)*2.0 };
  auto.lastD = Infinity; auto.progT = 0;
}
function step(dt){
  if (inspect.on){ player.vx = player.vz = 0; return; }
  const fwdX = Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const rgtX = Math.cos(player.yaw), rgtZ = Math.sin(player.yaw);
  let mx = 0, mz = 0;
  if (keys.has('KeyW')) { mx += fwdX; mz += fwdZ; }
  if (keys.has('KeyS')) { mx -= fwdX; mz -= fwdZ; }
  if (keys.has('KeyD')) { mx += rgtX; mz += rgtZ; }
  if (keys.has('KeyA')) { mx -= rgtX; mz -= rgtZ; }
  let mlen = Math.hypot(mx, mz);
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 3.6 : 2.0;
  if (mlen > 0){ mx = mx/mlen*speed; mz = mz/mlen*speed; }
  if (auto.on){
    if (!auto.wp) autoPick();
    const ax = (auto.wp.gx - player.gx)*S + auto.wp.ox - player.x;
    const az = (auto.wp.gz - player.gz)*S + auto.wp.oz - player.z;
    const ad = Math.hypot(ax, az) || 1;
    if (ad < 0.8) autoPick();
    else {
      mx = ax/ad * 2.6; mz = az/ad * 2.6; mlen = 1;
      player.yaw = lerpAngle(player.yaw, Math.atan2(mx, -mz), Math.min(1, dt*3));
      auto.progT += dt;
      if (auto.progT > 1.5){                    // progress, not velocity
        if (auto.lastD - ad < 0.2) autoPick();
        else auto.lastD = ad;
        auto.progT = 0;
      }
    }
  }
  // critically-damped-ish approach for a touch of glide
  const k = 1 - Math.exp(-dt * 12);
  player.vx += (mx - player.vx) * k;
  player.vz += (mz - player.vz) * k;

  let remaining = dt;
  const MAXSTEP = PR / 2;
  gatherColliders();
  while (remaining > 1e-6){
    const sp = Math.hypot(player.vx, player.vz);
    let h = remaining;
    if (sp > 1e-6) h = Math.min(remaining, MAXSTEP / sp);
    player.x += player.vx * h;
    player.z += player.vz * h;
    collide();
    remaining -= h;
    audio.stride += sp * h;
  }
  /* vertical: gravity, landing, ceiling clamp */
  if (player.py > 0 || player.vy !== 0){
    player.vy -= 12.5 * dt;
    player.py += player.vy * dt;
    const maxPy = H - EYE - 0.32;
    if (player.py > maxPy){ player.py = maxPy; if (player.vy > 0) player.vy = 0; }
    if (player.py <= 0){
      player.py = 0; player.vy = 0;
      if (player.jumps) footstep(2.0);
      player.jumps = 0;
    }
  }
  const spd = Math.hypot(player.vx, player.vz);
  if (spd < 0.2 || player.py > 0) audio.stride = 0;
  else while (audio.stride > 0.78){ audio.stride -= 0.78; footstep(spd); }
  if (!isFinite(player.x) || !isFinite(player.z)){
    console.warn('[guard] non-finite position — resetting to room centre');
    player.x = player.z = player.vx = player.vz = 0;
  }
  // floating origin: crossing the border re-anchors and shifts local coords
  let moved = false;
  while (player.x >  HS){ player.x -= S; player.gx++; moved = true; }
  while (player.x < -HS){ player.x += S; player.gx--; moved = true; }
  while (player.z >  HS){ player.z -= S; player.gz++; moved = true; }
  while (player.z < -HS){ player.z += S; player.gz--; moved = true; }
  if (moved) onRoomChanged();
}

/* ————— §10 Inspect & acquire ————— */
const inspect = { on: false, t: 0, A: null, r: null, to: null };
function paintingCenter(A, r){
  const IN2 = HS - WT;
  const sign = (A.wall==='e'||A.wall==='n') ? 1 : -1;
  const horiz = (A.wall==='e'||A.wall==='w');
  const ox = (r.gx - player.gx)*S, oz = (r.gz - player.gz)*S;
  const y = A.hangY || 1.55;
  return horiz
    ? { x: sign*IN2 + ox, y, z: A.u + oz, nx: -sign, nz: 0 }
    : { x: A.u + ox, y, z: sign*IN2 + oz, nx: 0, nz: -sign };
}
function facedArtwork(){
  const fx = Math.sin(player.yaw)*Math.cos(player.pitch);
  const fy = Math.sin(player.pitch);
  const fz = -Math.cos(player.yaw)*Math.cos(player.pitch);
  let best = null, bestCos = 0.955;
  for (let dj=-1; dj<=1; dj++)
    for (let di=-1; di<=1; di++){
      const r = rooms.get(roomKey(player.gx + di, player.gz + dj));
      if (!r) continue;
      for (const A of r.artworks){
        const c = paintingCenter(A, r);
        const dx = c.x - player.x, dy = c.y - (EYE + player.py), dz = c.z - player.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 7.5 || dist < 0.4) continue;
        const cos = (fx*dx + fy*dy + fz*dz) / dist;
        if (cos <= bestCos) continue;
        if ((dx*c.nx + dz*c.nz) / dist > -0.25) continue;   // must stand before it
        bestCos = cos; best = { A, r, c };
      }
    }
  return best;
}
function inspectOn(target){
  target = target || facedArtwork();
  if (!target){ flashHint('stand before a work to inspect it'); return; }
  const { A, r, c } = target;
  const d = Math.max(A.w, A.h)*0.75 + 0.42;
  const y = Math.max(1.15, Math.min(2.1, c.y));
  const px2 = c.x + c.nx*d, pz2 = c.z + c.nz*d;
  const yaw = Math.atan2(-c.nx, c.nz);       // face the wall
  inspect.on = true; inspect.A = A; inspect.r = r;
  inspect.to = { x: px2, z: pz2, y, yaw, pitch: Math.atan2(c.y - y, d) };
  const lt = document.getElementById('lt');
  const year = 1870 + (h2(A.seed, 0x9999, WORLD_SEED) % 200);
  A.title = A.title || makeTitle(mulberry32(h2(A.seed, 0x717, WORLD_SEED)));
  lt.querySelector('.t').textContent = A.title;
  lt.querySelector('.m').textContent =
    `${ALGO_NAMES[A.algo % ALGOS.length]}, ${year} · ${PALETTES[A.pal % PALETTES.length].name} · seed ${A.seed} · 1/1`;
  lt.classList.add('show');
  markSeen();
}
function inspectOff(){
  if (!inspect.on) return;
  inspect.on = false;
  document.getElementById('lt').classList.remove('show');
}
/* shortest-arc yaw interpolation */
function lerpAngle(a, b, t){
  let d = (b - a) % (Math.PI*2);
  if (d > Math.PI) d -= Math.PI*2;
  if (d < -Math.PI) d += Math.PI*2;
  return a + d*t;
}

const BIG_SIZES = { L: [1024, 768], P: [768, 1024], S: [1024, 1024], W: [1024, 640] };
const acqCanvas = document.createElement('canvas');
const acqCtx = acqCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
let modalURL = null;
function acquire(){
  const target = (inspect.on && inspect.A) ? { A: inspect.A } : facedArtwork();
  if (!target){ flashHint('stand before a work to acquire it'); return; }
  const A = target.A;
  const modal = document.getElementById('modal');
  const year = 1870 + (h2(A.seed, 0x9999, WORLD_SEED) % 200);
  A.title = A.title || makeTitle(mulberry32(h2(A.seed, 0x717, WORLD_SEED)));
  modal.querySelector('.cap .t').textContent = A.title;
  modal.querySelector('.cap .m').textContent = 'the gallery is committing it to memory…';
  modal.querySelector('img').removeAttribute('src');
  modal.hidden = false;
  setTimeout(async () => {
    preemptArtJobs();
    const [bw, bh] = BIG_SIZES[A.asp];
    acqCanvas.width = bw; acqCanvas.height = bh;
    const loanRec = A.overrideKey && curator.uploads.get(curator.placements.get(A.overrideKey));
    if (loanRec){
      const bmp = loanRec.bmp || (loanRec.bmp = await createImageBitmap(loanRec.blob));
      const s = Math.max(bw/bmp.width, bh/bmp.height);
      acqCtx.drawImage(bmp, (bw - bmp.width*s)/2, (bh - bmp.height*s)/2, bmp.width*s, bmp.height*s);
    } else {
      const rnd = mulberry32(A.seed);
      const gen = ALGOS[A.algo % ALGOS.length](acqCtx, bw, bh, rnd, jitterPal(A.pal, rnd));
      while (!gen.next().done){}
      finishArt(acqCtx, bw, bh);
    }
    acqCanvas.toBlob((blob) => {
      if (!blob || modal.hidden) return;
      if (modalURL) URL.revokeObjectURL(modalURL);
      modalURL = URL.createObjectURL(blob);
      modal.querySelector('img').src = modalURL;
      modal.querySelector('.cap .m').textContent = loanRec
        ? 'private loan · the curator’s collection · returned to you'
        : `${ALGO_NAMES[A.algo % ALGOS.length]}, ${year} · seed ${A.seed} · acquired, 1 of 1 — this exact work will never hang again`;
      try {
        const a = document.createElement('a');
        a.href = modalURL;
        a.download = `lumiere_${(A.title||'untitled').toLowerCase().replace(/[^a-z0-9]+/g,'-')}_${A.seed}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      } catch(e){ /* the modal fallback stays */ }
      persist.acquired++; savePersist();
    }, 'image/png');
  }, 40);
}
document.getElementById('modal').addEventListener('click', () => {
  document.getElementById('modal').hidden = true;
  if (modalURL){ URL.revokeObjectURL(modalURL); modalURL = null; }
});

/* ————— §13 The Curator's Office —————
   Private loans: the visitor's own images, hung anywhere in the endless
   gallery. The key is local to this browser — there is no server, so
   this is a courtesy lock, not a vault. Images live in IndexedDB when
   the embedding allows it; otherwise they last for the visit. */
const curator = {
  unlocked: false, sel: null, rekey: false,
  uploads: new Map(),        // id → {id, name, blob, url, bmp}
  placements: new Map(),     // "gx,gz:i" → uploadId
  overrides: new Map(),      // key → {tex, r, A}
  applying: new Set(),
  db: null, mode: 'memory',
};
function curKey(){ try { return localStorage.getItem('lumiere_key') || 'curator'; } catch(e){ return 'curator'; } }
function idbOpen(){
  return new Promise(res => {
    try {
      const rq = indexedDB.open('lumiere', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('images', { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch(e){ res(null); }
  });
}
async function curatorBoot(){
  curator.db = await idbOpen();
  curator.mode = curator.db ? 'idb' : 'memory';
  /* when a cloud session (or a guest visit) will drive placements,
     the local ones stay parked — the cloud is the source of truth */
  let cloudDriven = false;
  if (cloud.on){
    if (new URLSearchParams(location.search).has('gallery')) cloudDriven = true;
    try { if (localStorage.getItem('lumiere_sess')) cloudDriven = true; } catch(e){}
  }
  if (storageOK && !cloudDriven){
    try {
      const p = JSON.parse(localStorage.getItem('lumiere_placements') || '[]');
      for (const [k, id] of p) curator.placements.set(k, id);
    } catch(e){}
  }
  if (curator.db){
    const tx = curator.db.transaction('images', 'readonly');
    tx.objectStore('images').getAll().onsuccess = (ev) => {
      for (const rec of ev.target.result || []){
        rec.url = URL.createObjectURL(rec.blob);
        curator.uploads.set(rec.id, rec);
      }
      syncArtJobs();           // wake any placements now that images exist
    };
  }
}
function savePlacements(){
  if (!storageOK || cloud.sess || cloud.viewing) return;   // cloud owns its own truth
  try { localStorage.setItem('lumiere_placements', JSON.stringify([...curator.placements])); } catch(e){}
}
async function curatorAddFiles(files){
  for (const f of files){
    if (!f.type.startsWith('image/')) continue;
    try {
      const bmp = await createImageBitmap(f);
      const long = Math.max(bmp.width, bmp.height);
      const sc = Math.min(1, 1280/long);
      const cw = Math.max(1, Math.round(bmp.width*sc)), ch = Math.max(1, Math.round(bmp.height*sc));
      const cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
      cc.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
      const blob = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.88));
      bmp.close();
      if (!blob) continue;
      const name = f.name.replace(/\.[^.]+$/, '');
      if (cloud.on && cloud.sess){
        const { id, path } = await cloudUploadBlob(name, blob);
        curator.uploads.set(id, { id, name, blob, path, cloudRec: true,
                                  url: URL.createObjectURL(blob) });
      } else {
        const id = 'u' + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);
        const rec = { id, name, blob, url: URL.createObjectURL(blob) };
        curator.uploads.set(id, rec);
        if (curator.db){
          try { curator.db.transaction('images', 'readwrite').objectStore('images')
                  .put({ id, name: rec.name, blob }); } catch(e){}
        }
      }
    } catch(e){ console.warn('[curator] could not add image', f.name, e); flashHint('that image could not be added'); }
  }
  curatorGrid();
}
function curatorRemove(id){
  const rec = curator.uploads.get(id);
  if (!rec) return;
  for (const [k, uid] of [...curator.placements]) if (uid === id) curatorClearPlacement(k);
  if (rec.url && !rec.cloudRec) URL.revokeObjectURL(rec.url);
  curator.uploads.delete(id);
  if (rec.cloudRec && cloud.sess) cloudDeleteUpload(rec).catch(()=>{});
  else if (curator.db){
    try { curator.db.transaction('images', 'readwrite').objectStore('images').delete(id); } catch(e){}
  }
  if (curator.sel === id) curator.sel = null;
  savePlacements();
  curatorGrid();
}
function curatorClearPlacement(k){
  curator.placements.delete(k);
  if (cloud.sess && !cloud.viewing) cloudDelPlacement(k).catch(()=>{});
  const o = curator.overrides.get(k);
  if (o){
    gl.deleteTexture(o.tex);
    o.A.override = null; o.A.overrideName = false; o.A.overrideKey = null;
    o.A.title = null;                             // the seeded title returns
    if (o.A.ptex){ releaseSlot(o.A.ptex); o.A.ptex = null; }
    if (!o.A.mini){ o.A.ptexWanted = true; artState.placards.push(o.A); }
    curator.overrides.delete(k);
  }
  savePlacements();
  syncArtJobs();                                  // regenerate the seeded work if needed
}
async function applyPlacement(r, A, i){
  const k = artJobKey(r, i);
  const id = curator.placements.get(k);
  const rec = id && curator.uploads.get(id);
  if (!rec || curator.applying.has(k) || A.override) return;
  curator.applying.add(k);
  try {
    if (!rec.blob && rec.url) rec.blob = await (await fetch(rec.url)).blob();
    const bmp = rec.bmp || (rec.bmp = await createImageBitmap(rec.blob));
    const [tw, th] = TEX_SIZES[A.asp];
    const cc = document.createElement('canvas'); cc.width = tw; cc.height = th;
    const g = cc.getContext('2d');
    const s = Math.max(tw/bmp.width, th/bmp.height);          // cover-crop
    const dw = bmp.width*s, dh = bmp.height*s;
    g.drawImage(bmp, (tw-dw)/2, (th-dh)/2, dw, dh);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(tw, th))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, tw, th);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cc);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (window.__aniso)
      gl.texParameterf(gl.TEXTURE_2D, window.__aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, window.__aniso.max);
    A.override = tex; A.overrideKey = k; A.overrideName = true;
    A.title = rec.name; A.fadeAt = performance.now();
    if (A.ptex){ releaseSlot(A.ptex); A.ptex = null; }
    if (!A.mini){ A.ptexWanted = true; artState.placards.push(A); }
    curator.overrides.set(k, { tex, r, A });
  } catch(e){ console.warn('[curator] hang failed', e); }
  curator.applying.delete(k);
}
function curatorCanEdit(){
  if (cloud.viewing){ flashHint('you are a guest here — this is <b>' + cloud.viewing.slug + '</b>’s hanging'); return false; }
  if (!curator.unlocked && !cloud.sess){ flashHint('the curator’s office is locked — press <b>C</b>'); return false; }
  return true;
}
function curatorHang(){
  if (!curatorCanEdit()) return;
  if (!curator.sel){ flashHint('choose a work in the curator’s office first'); return; }
  const t = (inspect.on && inspect.A) ? { A: inspect.A, r: inspect.r } : facedArtwork();
  if (!t){ flashHint('stand before a frame to hang your work'); return; }
  const i = t.r.artworks.indexOf(t.A);
  const k = artJobKey(t.r, i);
  if (t.A.override){                       // replacing a previous loan
    const o = curator.overrides.get(k);
    if (o){ gl.deleteTexture(o.tex); curator.overrides.delete(k); }
    t.A.override = null;
  }
  curator.placements.set(k, curator.sel);
  savePlacements();
  if (cloud.sess && !cloud.viewing) cloudSetPlacement(k, curator.sel).catch(()=>flashHint('cloud did not answer — the hang is local for now'));
  applyPlacement(t.r, t.A, i);
  flashHint('hung — a private loan to the endless gallery');
}
function curatorUnhang(){
  if (!curatorCanEdit()) return;
  const t = (inspect.on && inspect.A) ? { A: inspect.A, r: inspect.r } : facedArtwork();
  if (!t || !t.A.overrideKey){ flashHint('no loan hangs in this frame'); return; }
  curatorClearPlacement(t.A.overrideKey);
  flashHint('taken down — the seeded work returns');
}
function curatorGrid(){
  const grid = document.getElementById('cur-grid');
  grid.textContent = '';
  for (const rec of curator.uploads.values()){
    const d = document.createElement('div');
    d.className = 'cur-item' + (curator.sel === rec.id ? ' sel' : '');
    const im = document.createElement('img'); im.src = rec.url; im.alt = rec.name;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = rec.name;
    const rm = document.createElement('button'); rm.className = 'rm'; rm.type = 'button';
    rm.setAttribute('aria-label', `Remove ${rec.name} from the collection`);
    rm.addEventListener('click', (e) => { e.stopPropagation(); curatorRemove(rec.id); });
    d.addEventListener('click', () => { curator.sel = rec.id; curatorGrid(); });
    d.append(im, nm, rm);
    grid.append(d);
  }
  if (!curator.uploads.size){
    const empty = document.createElement('div');
    empty.className = 'sub';
    empty.textContent = 'The private collection is empty — add works above.';
    grid.append(empty);
  }
  document.getElementById('cur-store').textContent =
    curator.mode === 'idb' ? 'collection kept in this browser · placements remembered'
                           : 'this embedding cannot keep files — loans last for this visit only';
}
function curatorRefresh(){
  const guest = !!cloud.viewing;
  const open = !guest && (cloud.on ? !!cloud.sess : curator.unlocked);
  document.getElementById('cur-lock').hidden = open || guest || cloud.on ? true : false;
  document.getElementById('cur-cloud-lock').hidden = !(cloud.on && !open && !guest);
  document.getElementById('cur-open').hidden = !open;
  document.getElementById('cur-state').textContent =
    guest ? 'guest of ' + cloud.viewing.slug
    : open ? (cloud.sess ? 'signed in · loans open everywhere' : 'unlocked · loans open')
    : cloud.on ? 'signed out'
    : (curator.rekey ? 'set a new key' : 'locked');
  if (open){
    const acct = document.getElementById('cur-acct');
    const share = document.getElementById('cur-share');
    acct.hidden = !cloud.sess;
    share.hidden = !cloud.sess;
    document.getElementById('cur-rekey').hidden = !!cloud.sess;
    if (cloud.sess){
      document.getElementById('cur-who').textContent = 'signed in as ' + (cloud.sess.email || 'you');
      const slugIn = document.getElementById('cur-slug');
      if (cloud.slug && !slugIn.value) slugIn.value = cloud.slug;
      document.getElementById('cur-share-link').textContent = cloud.slug
        ? 'share: ' + location.origin + location.pathname + '?gallery=' + cloud.slug
        : 'claim a name to get a share link';
      let hasLocal = false;
      for (const rec of curator.uploads.values()) if (!rec.cloudRec && rec.blob){ hasLocal = true; break; }
      document.getElementById('cur-migrate').hidden = !hasLocal;
    }
    curatorGrid();
  }
}
/* Focus whichever gate is actually showing. The old code always reached for
   #cur-pass, which lives inside #cur-lock — permanently hidden whenever cloud
   mode is on — so opening the office focused nothing at all. */
function focusFirstField(){
  const field = [...document.querySelectorAll('#curator input:not([type=file])')]
    .find((el) => el.offsetParent !== null);
  if (field) field.focus();
}
function curatorToggle(){
  const p = document.getElementById('curator');
  p.hidden = !p.hidden;
  if (!p.hidden){
    keys.clear(); dragging = false; inspectOff();
    curatorRefresh();
    if (!curator.unlocked) setTimeout(focusFirstField, 50);
  } else canvas.focus();
}
/* Esc closes the office from anywhere inside it. The text fields stopPropagation
   on keydown so WASD cannot leak into the world — which also means C can never
   reach the window handler once a field has focus, leaving no keyboard way out.
   Capture phase, so this runs before the fields swallow the event. */
document.getElementById('curator').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (!document.getElementById('curator').hidden) curatorToggle();
}, true);
{
  const pass = document.getElementById('cur-pass');
  const tryEnter = () => {
    if (curator.rekey){
      const v = pass.value.trim();
      if (v.length >= 3){
        try { localStorage.setItem('lumiere_key', v); } catch(e){}
        curator.rekey = false; pass.value = '';
        pass.placeholder = 'curator’s key';
        flashHint('the key is changed');
        curatorRefresh();
      }
      return;
    }
    if (pass.value === curKey()){
      curator.unlocked = true; pass.value = '';
      curatorRefresh();
    } else {
      pass.value = '';
      pass.placeholder = 'that is not the key';
    }
  };
  document.getElementById('cur-enter').addEventListener('click', tryEnter);
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryEnter(); e.stopPropagation(); });
  document.getElementById('cur-close').addEventListener('click', curatorToggle);
  document.getElementById('cur-rekey').addEventListener('click', () => {
    curator.rekey = true; curator.unlocked = false;
    document.getElementById('cur-pass').placeholder = 'a new key (3+ characters)';
    curatorRefresh();
    setTimeout(() => document.getElementById('cur-pass').focus(), 50);
  });
  document.getElementById('cur-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) curatorAddFiles([...e.target.files]);
    e.target.value = '';
  });
  document.getElementById('curator').addEventListener('click', (e) => {
    if (e.target === document.getElementById('curator')) curatorToggle();
  });
  /* ——— cloud sign-in ——— */
  const emailIn = document.getElementById('cur-email');
  const codeIn = document.getElementById('cur-code');
  const cloudNote = document.getElementById('cur-cloud-note');
  emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('cur-send').click(); e.stopPropagation(); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('cur-verify').click(); e.stopPropagation(); });
  document.getElementById('cur-send').addEventListener('click', async () => {
    const email = emailIn.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ cloudNote.textContent = 'that does not read like an email address'; return; }
    cloudNote.textContent = 'sending…';
    try {
      await cloudSendCode(email);
      document.getElementById('cur-code-row').hidden = false;
      cloudNote.textContent = 'a six-digit code is on its way to ' + email;
      codeIn.focus();
    } catch(e){ cloudNote.textContent = String(e.message || e); }
  });
  document.getElementById('cur-verify').addEventListener('click', async () => {
    cloudNote.textContent = 'checking…';
    try {
      await cloudVerify(emailIn.value.trim(), codeIn.value.trim());
      cloudNote.textContent = '';
      await cloudLoadMine();
      curatorRefresh();
      flashHint('welcome, curator — your loans follow you now');
    } catch(e){ cloudNote.textContent = String(e.message || e); }
  });
  document.getElementById('cur-signout').addEventListener('click', () => {
    cloudSaveSess(null);
    location.reload();               // cleanest way back to the local collection
  });
  document.getElementById('cur-slug-save').addEventListener('click', async () => {
    const slug = document.getElementById('cur-slug').value.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(slug)){ flashHint('names are 3–32 letters, digits, dashes'); return; }
    try { await cloudClaimSlug(slug); curatorRefresh(); flashHint('the gallery answers to <b>' + slug + '</b> now'); }
    catch(e){ flashHint(String(e.message || e)); }
  });
  document.getElementById('cur-migrate').addEventListener('click', async () => {
    if (!cloud.sess) return;
    const btn = document.getElementById('cur-migrate');
    btn.textContent = 'Sending…';
    let moved = 0;
    for (const [oldId, rec] of [...curator.uploads]){
      if (rec.cloudRec || !rec.blob) continue;
      try {
        const { id, path } = await cloudUploadBlob(rec.name, rec.blob);
        curator.uploads.delete(oldId);
        curator.uploads.set(id, { id, name: rec.name, blob: rec.blob, path,
                                  cloudRec: true, url: rec.url });
        for (const [k, uid] of [...curator.placements])
          if (uid === oldId){
            curator.placements.set(k, id);
            cloudSetPlacement(k, id).catch(()=>{});
          }
        if (curator.sel === oldId) curator.sel = id;
        moved++;
      } catch(e){ console.warn('[curator] migration failed for', rec.name, e); }
    }
    btn.textContent = 'Send local works to the cloud';
    curatorRefresh();
    flashHint(moved ? moved + ' work' + (moved===1?'':'s') + ' now travel with you' : 'nothing needed sending');
  });
}

/* ————— §14 The cloud (Supabase over plain fetch — no SDK) —————
   Auth is a six-digit email code; the session refreshes itself; every
   write is guarded server-side by row level security. When unconfigured
   this whole section stays dormant and the gallery is purely local.  */
const cloud = (() => {
  let url = CLOUD_URL, key = CLOUD_KEY;
  try {
    const o = JSON.parse(localStorage.getItem('lumiere_cloud') || 'null');
    if (o && o.url && o.key){ url = o.url; key = o.key; }
  } catch(e){}
  return { url: url.replace(/\/+$/, ''), key, on: !!(url && key),
           sess: null, viewing: null, slug: null };
})();
function cloudSaveSess(d){
  if (!d){ cloud.sess = null; try { localStorage.removeItem('lumiere_sess'); } catch(e){} return; }
  cloud.sess = {
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600)*1000 - 90000,
    uid: d.user ? d.user.id : cloud.sess && cloud.sess.uid,
    email: d.user ? d.user.email : cloud.sess && cloud.sess.email,
  };
  try { localStorage.setItem('lumiere_sess', JSON.stringify(cloud.sess)); } catch(e){}
}
async function cloudRefresh(){
  if (!cloud.sess) return false;
  try {
    const rs = await fetch(cloud.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cloud.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cloud.sess.refresh_token }),
    });
    if (!rs.ok) throw 0;
    const d = await rs.json();
    d.user = d.user || { id: cloud.sess.uid, email: cloud.sess.email };
    cloudSaveSess(d);
    return true;
  } catch(e){ cloudSaveSess(null); return false; }
}
async function cfetch(path, opts = {}, retry = true){
  if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();
  const headers = Object.assign({
    apikey: cloud.key,
    Authorization: 'Bearer ' + (cloud.sess ? cloud.sess.access_token : cloud.key),
  }, opts.headers || {});
  const rs = await fetch(cloud.url + path, Object.assign({}, opts, { headers }));
  if (rs.status === 401 && cloud.sess && retry && await cloudRefresh())
    return cfetch(path, opts, false);
  return rs;
}
async function cloudSendCode(email){
  const rs = await cfetch('/auth/v1/otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!rs.ok) throw new Error((await rs.json().catch(()=>({}))).msg || 'could not send the code');
}
async function cloudVerify(email, token){
  const rs = await cfetch('/auth/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', email, token }),
  });
  const d = await rs.json().catch(() => ({}));
  if (!rs.ok || !d.access_token) throw new Error(d.msg || d.error_description || 'that code was not accepted');
  cloudSaveSess(d);
}
function cloudPublicURL(path){
  return cloud.url + '/storage/v1/object/public/loans/' + path;
}
async function cloudUploadBlob(name, blob){
  const id = crypto.randomUUID();
  const path = cloud.sess.uid + '/' + id + '.jpg';
  let rs = await cfetch('/storage/v1/object/loans/' + path, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
  });
  if (!rs.ok) throw new Error('image upload failed');
  rs = await cfetch('/rest/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id, owner: cloud.sess.uid, name, path }),
  });
  if (!rs.ok) throw new Error('could not record the upload');
  return { id, path };
}
async function cloudDeleteUpload(rec){
  await cfetch('/storage/v1/object/loans/' + rec.path, { method: 'DELETE' }).catch(()=>{});
  await cfetch('/rest/v1/uploads?id=eq.' + rec.id, { method: 'DELETE' }).catch(()=>{});
}
async function cloudSetPlacement(k, uploadId){
  await cfetch('/rest/v1/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ owner: cloud.sess.uid, k, upload_id: uploadId }),
  });
}
async function cloudDelPlacement(k){
  await cfetch('/rest/v1/placements?owner=eq.' + cloud.sess.uid +
               '&k=eq.' + encodeURIComponent(k), { method: 'DELETE' });
}
async function cloudClaimSlug(slug){
  const rs = await cfetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: cloud.sess.uid, slug }),
  });
  if (!rs.ok) throw new Error('that name is taken or invalid (a–z, 0–9, dashes)');
  cloud.slug = slug;
}
async function cloudLoadMine(){
  if (!cloud.sess) return;
  const [ur, pr, sr] = await Promise.all([
    cfetch('/rest/v1/uploads?owner=eq.' + cloud.sess.uid + '&select=id,name,path&order=created_at'),
    cfetch('/rest/v1/placements?owner=eq.' + cloud.sess.uid + '&select=k,upload_id'),
    cfetch('/rest/v1/profiles?id=eq.' + cloud.sess.uid + '&select=slug'),
  ]);
  if (ur.ok) for (const row of await ur.json()){
    if (!curator.uploads.has(row.id))
      curator.uploads.set(row.id, { id: row.id, name: row.name, path: row.path,
                                    url: cloudPublicURL(row.path), cloudRec: true });
  }
  if (pr.ok) for (const row of await pr.json()) curator.placements.set(row.k, row.upload_id);
  if (sr.ok){ const rows = await sr.json(); cloud.slug = rows[0] ? rows[0].slug : null; }
  syncArtJobs();
}
async function cloudLoadGallery(slug){
  const rr = await cfetch('/rest/v1/profiles?slug=eq.' + encodeURIComponent(slug) + '&select=id');
  const rows = rr.ok ? await rr.json() : [];
  if (!rows[0]){ flashHint('no gallery answers to that name'); return; }
  const owner = rows[0].id;
  const [ur, pr] = await Promise.all([
    cfetch('/rest/v1/uploads?owner=eq.' + owner + '&select=id,name,path'),
    cfetch('/rest/v1/placements?owner=eq.' + owner + '&select=k,upload_id'),
  ]);
  curator.placements.clear();
  if (ur.ok) for (const row of await ur.json())
    curator.uploads.set(row.id, { id: row.id, name: row.name, path: row.path,
                                  url: cloudPublicURL(row.path), cloudRec: true });
  if (pr.ok) for (const row of await pr.json()) curator.placements.set(row.k, row.upload_id);
  cloud.viewing = { slug, owner };
  updateHudStat();
  flashHint('you are walking <b>' + slug + '</b>’s gallery — their loans hang here');
  syncArtJobs();
}
async function cloudBoot(){
  if (!cloud.on) return;
  try { const s = JSON.parse(localStorage.getItem('lumiere_sess') || 'null'); if (s) cloud.sess = s; } catch(e){}
  if (cloud.sess && Date.now() > cloud.sess.expires_at) await cloudRefresh();
  const gallery = new URLSearchParams(location.search).get('gallery');
  if (gallery) await cloudLoadGallery(gallery.toLowerCase());
  else if (cloud.sess) await cloudLoadMine();
  curatorRefresh();
}

/* ————— frame loop ————— */
let lastT = 0, frameCount = 0, fpsAcc = 0, fpsAvg = 0;
let probeRequest = null, rafId = 0, forceDt = null;
const probeBuf = new Uint8Array(32*32*4);

function frame(t){
  if (!gl) return;
  if (gl.isContextLost()){
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    return;
  }
  resize();
  const dt = forceDt !== null ? forceDt : Math.min(50, t - lastT) / 1000;
  lastT = t;
  frameCount++; fpsAcc += dt;
  if (fpsAcc > 0.5){
    fpsAvg = frameCount / fpsAcc; frameCount = 0; fpsAcc = 0;
    /* trade pixels for smoothness on machines that need it */
    if (entered && forceDt === null && fpsAvg < 42 && PERF.q > 0 &&
        t - PERF.lastDrop > 5000){
      PERF.q--; PERF.lastDrop = t;
      trace(`[perf] frame rate ${fpsAvg.toFixed(0)} — easing quality to tier ${PERF.q}`);
    }
  }

  if (entered) step(dt);

  const usePost = post.on;
  if (usePost){
    if (!post.ready) allocPost();
    else if (vpW !== post.w || vpH !== post.h){
      if (!post.pendingAt) post.pendingAt = performance.now();
      if (performance.now() - post.pendingAt > 200){ allocPost(); post.pendingAt = 0; }
    } else post.pendingAt = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboScene);
    gl.viewport(0, 0, post.w, post.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, vpW, vpH);
  }
  const fogCur = WIN.on ? DAY_FOG : FOG;
  const sigCur = WIN.on ? 0.082 : FOG_SIGMA;
  const ambMult = (lightsOn ? 1 : 0.22) * (WIN.on ? 3.2 : 1);
  gl.clearColor(fogCur[0], fogCur[1], fogCur[2], 1);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  perspective(M_P, 66 * Math.PI/180,
    (usePost && post.ready ? post.w / post.h : vpW / vpH), 0.08, 80);
  /* camera: the player's pose, or an eased glide toward an inspected work */
  inspect.t = Math.max(0, Math.min(1, inspect.t + (inspect.on ? dt/0.5 : -dt/0.4)));
  let camX = player.x, camY = EYE + player.py, camZ = player.z, camYaw = player.yaw, camPitch = player.pitch;
  if (inspect.t > 0.0001 && inspect.to){
    const e = REDUCED ? (inspect.on ? 1 : 0)
            : inspect.t < 0.5 ? 2*inspect.t*inspect.t : 1 - Math.pow(-2*inspect.t + 2, 2)/2;
    camX += (inspect.to.x - camX) * e;
    camY += (inspect.to.y - camY) * e;
    camZ += (inspect.to.z - camZ) * e;
    camYaw = lerpAngle(camYaw, inspect.to.yaw, e);
    camPitch += (inspect.to.pitch - camPitch) * e;
  }
  viewMatrix(M_V, camX, camY, camZ, camYaw, camPitch);
  mulM(M_PV, M_P, M_V);
  extractPlanes(M_PV);

  gl.useProgram(progArch);
  gl.uniformMatrix4fv(uArch.p, false, M_P);
  gl.uniform1f(uArch.sig, sigCur);
  gl.uniform1f(uArch.alpha, 1);
  gl.uniform3f(uArch.upv, M_V[4], M_V[5], M_V[6]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plasterTex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, parquetTex);
  gl.activeTexture(gl.TEXTURE0);

  function archRoomUniforms(r, ox, oz){
    const m = r.mood, as = (r.ambScale || 1) * ambMult;
    gl.uniform3f(uArch.amb,
      (AMB_BASE[0]+m[0])*as, (AMB_BASE[1]+m[1])*as, (AMB_BASE[2]+m[2])*as);
    gl.uniform3f(uArch.fog,
      fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
    const nl = packLights(r, ox, oz);
    gl.uniform1i(uArch.nl, nl);
    gl.uniform4fv(uArch.lpos, LPOS);
    gl.uniform4fv(uArch.ldir, LDIR);
    gl.uniform4fv(uArch.lcol, LCOL);
    mulT(M_MV, M_V, ox, 0, oz);
    gl.uniformMatrix4fv(uArch.mv, false, M_MV);
  }
  /* pass A — opaque architecture, floors withheld */
  for (let ri = 0; ri < nearRooms.length; ri++){
      const { r, ox, oz } = nearRooms[ri];
      if (!r.vao) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      archRoomUniforms(r, ox, oz);
      gl.bindVertexArray(r.vao);
      gl.drawElements(gl.TRIANGLES, r.floorStart, gl.UNSIGNED_SHORT, 0);
    }

  /* pass B — the world below the floor: mirrored paintings, glass, flames.
     The floor then covers them at slight transparency: a polished sheen. */
  const nowMs = performance.now();
  if (PERF.q >= 1){
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(progPaint);
    gl.uniformMatrix4fv(uPaint.uP, false, M_P);
    gl.uniform1f(uPaint.uSigma, sigCur);
    gl.uniform1i(uPaint.uTex, 0);
    gl.uniform1f(uPaint.uAT, 0);
    gl.bindVertexArray(quadVAO);
    for (let ri = 0; ri < midRooms.length; ri++){
      const { r, ox, oz } = midRooms[ri];
      if (!r.vao) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      const m = r.mood;
      gl.uniform3f(uPaint.uFog, fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
      const nl = packLights(r, ox, oz);
      gl.uniform1i(uPaint.uNL, nl);
      gl.uniform4fv(uPaint.uLPos, LPOS);
      gl.uniform4fv(uPaint.uLDir, LDIR);
      gl.uniform4fv(uPaint.uLCol, LCOL);
      mulT(M_MV, M_V, ox, 0, oz);
      gl.uniformMatrix4fv(uPaint.uMV, false, M_MV);
      for (const A of r.artworks){
        if (!A.tex && !A.override) continue;
        paintBasis(A, PB);
        const nvx = M_V[0]*PB.n[0] + M_V[4]*PB.n[1] + M_V[8]*PB.n[2];
        const nvy = M_V[1]*PB.n[0] + M_V[5]*PB.n[1] + M_V[9]*PB.n[2];
        const nvz = M_V[2]*PB.n[0] + M_V[6]*PB.n[1] + M_V[10]*PB.n[2];
        gl.uniform3f(uPaint.uN, nvx, nvy, nvz);
        const fade = REDUCED ? 1 : Math.min(1, (nowMs - A.fadeAt) / 1400);
        gl.uniform3f(uPaint.uO, PB.o[0], -PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, 0, -A.h, 0);
        gl.uniform1f(uPaint.uFade, fade * 0.72);
        gl.uniform1f(uPaint.uEm, 0.35);
        gl.bindTexture(gl.TEXTURE_2D, A.override ? A.override : A.tex.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (WIN.on && r.windows.length){
        gl.uniform1i(uPaint.uNL, 0);
        gl.uniform1f(uPaint.uFade, 0.85);
        gl.uniform1f(uPaint.uEm, 1.65);
        gl.bindTexture(gl.TEXTURE_2D, ensureSkyTex());
        const IN2r = HS - WT;
        for (const wn of r.windows){
          const sign = (wn.wall==='e'||wn.wall==='n') ? 1 : -1;
          const horiz = (wn.wall==='e'||wn.wall==='w');
          const flip = (wn.wall==='w'||wn.wall==='n') ? -1 : 1;
          const u0 = flip > 0 ? wn.u - wn.w/2 : wn.u + wn.w/2;
          const wc = sign * (IN2r - 0.012);
          const y0 = wn.cy - wn.h/2;
          if (horiz){
            gl.uniform3f(uPaint.uO, wc, -y0, u0);
            gl.uniform3f(uPaint.uU, 0, 0, flip*wn.w);
            gl.uniform3f(uPaint.uN, -sign*M_V[0], -sign*M_V[1], -sign*M_V[2]);
          } else {
            gl.uniform3f(uPaint.uO, u0, -y0, wc);
            gl.uniform3f(uPaint.uU, flip*wn.w, 0, 0);
            gl.uniform3f(uPaint.uN, -sign*M_V[8], -sign*M_V[9], -sign*M_V[10]);
          }
          gl.uniform3f(uPaint.uV, 0, -wn.h, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
    }
    /* candle flames, mirrored, dimmed */
    if (lightsOn){
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progFlame);
      gl.uniformMatrix4fv(uFlame.uP, false, M_P);
      gl.uniform1f(uFlame.uTime, (performance.now() % 300000)/1000);
      gl.uniform1f(uFlame.uMY, 1);
      gl.uniform3f(uFlame.uCol, 0.34, 0.21, 0.09);
      for (let ri = 0; ri < midRooms.length; ri++){
        const { r, ox, oz } = midRooms[ri];
        if (!r.nFlames || !r.flameVAO) continue;
        if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
        mulT(M_MV, M_V, ox, 0, oz);
        gl.uniformMatrix4fv(uFlame.uMV, false, M_MV);
        gl.bindVertexArray(r.flameVAO);
        gl.drawArrays(gl.POINTS, 0, r.nFlames);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /* pass C — the floors, faintly transparent over their reflections */
  gl.useProgram(progArch);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(uArch.alpha, PERF.q >= 1 ? 0.87 : 1.0);
  for (let ri = 0; ri < nearRooms.length; ri++){
      const { r, ox, oz } = nearRooms[ri];
      if (!r.vao) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      archRoomUniforms(r, ox, oz);
      gl.bindVertexArray(r.vao);
      gl.drawElements(gl.TRIANGLES, r.nIdx - r.floorStart, gl.UNSIGNED_SHORT, r.floorStart * 2);
    }
  gl.uniform1f(uArch.alpha, 1);
  gl.disable(gl.BLEND);

  /* pass 2: pigment — textured paintings + placards, blended over the
     dark placeholder canvases so each work can fade into being */
  gl.useProgram(progPaint);
  gl.uniformMatrix4fv(uPaint.uP, false, M_P);
  gl.uniform1f(uPaint.uSigma, sigCur);
  gl.uniform1i(uPaint.uTex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(uPaint.uAT, 0);
  gl.bindVertexArray(quadVAO);
  for (let ri = 0; ri < midRooms.length; ri++){
      const { r, ox, oz } = midRooms[ri];
      if (!r.vao) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      let any = (WIN.on && r.windows.length > 0) || !!r.pedestal;
      if (!any) for (const A of r.artworks) if (A.tex || A.ptex || A.override){ any = true; break; }
      if (!any) continue;
      const m = r.mood;
      gl.uniform3f(uPaint.uFog, fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
      const nl = packLights(r, ox, oz);
      gl.uniform1i(uPaint.uNL, nl);
      gl.uniform4fv(uPaint.uLPos, LPOS);
      gl.uniform4fv(uPaint.uLDir, LDIR);
      gl.uniform4fv(uPaint.uLCol, LCOL);
      mulT(M_MV, M_V, ox, 0, oz);
      gl.uniformMatrix4fv(uPaint.uMV, false, M_MV);
      /* contact shadows first — they ground the frames and furniture */
      gl.uniform1f(uPaint.uAT, 1);
      gl.uniform1f(uPaint.uEm, 0);
      gl.uniform1i(uPaint.uNL, 0);
      gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      for (const A of r.artworks){
        SHA.wall = A.wall; SHA.u = A.u; SHA.hangY = A.hangY;
        SHA.w = A.w + 0.44; SHA.h = A.h + 0.44;
        paintBasis(SHA, PB, 0.006);
        PB.o[1] -= 0.055;
        gl.uniform3f(uPaint.uN,
          M_V[0]*PB.n[0] + M_V[8]*PB.n[2],
          M_V[1]*PB.n[0] + M_V[9]*PB.n[2],
          M_V[2]*PB.n[0] + M_V[10]*PB.n[2]);
        gl.uniform3f(uPaint.uO, PB.o[0], PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, PB.v[0], PB.v[1], PB.v[2]);
        gl.uniform1f(uPaint.uFade, 0.55);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.uniform3f(uPaint.uN, M_V[4], M_V[5], M_V[6]);   // floor blobs face up
      if (r.bench){
        const sx = (r.bench.alongZ ? 0.24 : 0.90)*2 + 0.5;
        const sz = (r.bench.alongZ ? 0.90 : 0.24)*2 + 0.5;
        gl.uniform3f(uPaint.uO, r.bench.x - sx/2, 0.006, r.bench.z - sz/2);
        gl.uniform3f(uPaint.uU, sx, 0, 0);
        gl.uniform3f(uPaint.uV, 0, 0, sz);
        gl.uniform1f(uPaint.uFade, 0.5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (r.pedestal){
        gl.uniform3f(uPaint.uO, r.pedestal.x - 0.52, 0.006, r.pedestal.z - 0.52);
        gl.uniform3f(uPaint.uU, 1.04, 0, 0);
        gl.uniform3f(uPaint.uV, 0, 0, 1.04);
        gl.uniform1f(uPaint.uFade, 0.5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.uniform1f(uPaint.uAT, 0);
      gl.uniform1i(uPaint.uNL, nl);
      for (const A of r.artworks){
        if (!A.tex && !A.override) continue;
        paintBasis(A, PB);
        const nvx = M_V[0]*PB.n[0] + M_V[4]*PB.n[1] + M_V[8]*PB.n[2];
        const nvy = M_V[1]*PB.n[0] + M_V[5]*PB.n[1] + M_V[9]*PB.n[2];
        const nvz = M_V[2]*PB.n[0] + M_V[6]*PB.n[1] + M_V[10]*PB.n[2];
        gl.uniform3f(uPaint.uN, nvx, nvy, nvz);
        const fade = REDUCED ? 1 : Math.min(1, (nowMs - A.fadeAt) / 1400);
        gl.uniform3f(uPaint.uO, PB.o[0], PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, PB.v[0], PB.v[1], PB.v[2]);
        gl.uniform1f(uPaint.uFade, fade);
        gl.uniform1f(uPaint.uEm, 0.35);
        gl.bindTexture(gl.TEXTURE_2D, A.override ? A.override : A.tex.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (A.ptex && A.pu !== undefined){
          const horiz = (A.wall==='e'||A.wall==='w');
          const flip = (A.wall==='w'||A.wall==='n') ? -1 : 1;
          const pu0 = flip > 0 ? A.pu - 0.13 : A.pu + 0.13;
          if (horiz){ gl.uniform3f(uPaint.uO, PB.pwallC, 1.235, pu0); gl.uniform3f(uPaint.uU, 0, 0, flip*0.26); }
          else      { gl.uniform3f(uPaint.uO, pu0, 1.235, PB.pwallC); gl.uniform3f(uPaint.uU, flip*0.26, 0, 0); }
          gl.uniform3f(uPaint.uV, 0, 0.13, 0);
          gl.uniform1f(uPaint.uEm, 0.55);
          gl.bindTexture(gl.TEXTURE_2D, A.ptex.tex);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      if (r.pedestal){
        const px = r.pedestal.x, pz = r.pedestal.z;
        gl.uniform1f(uPaint.uFade, 1);
        gl.uniform1f(uPaint.uEm, 0.5);
        gl.bindTexture(gl.TEXTURE_2D, stolenTex);
        let nx0, nz0;
        if (Math.abs(px) > Math.abs(pz)){
          const sgn = px > 0 ? -1 : 1;
          gl.uniform3f(uPaint.uO, px + sgn*0.236, 0.80, pz + sgn*0.10);
          gl.uniform3f(uPaint.uU, 0, 0, -sgn*0.20);
          nx0 = sgn; nz0 = 0;
        } else {
          const sgn = pz > 0 ? -1 : 1;
          gl.uniform3f(uPaint.uO, px - sgn*0.10, 0.80, pz + sgn*0.236);
          gl.uniform3f(uPaint.uU, sgn*0.20, 0, 0);
          nx0 = 0; nz0 = sgn;
        }
        gl.uniform3f(uPaint.uN,
          M_V[0]*nx0 + M_V[8]*nz0, M_V[1]*nx0 + M_V[9]*nz0, M_V[2]*nx0 + M_V[10]*nz0);
        gl.uniform3f(uPaint.uV, 0, 0.10, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      /* the glass itself: bright sky quads while the shutters are open */
      if (WIN.on && r.windows.length){
        gl.uniform1i(uPaint.uNL, 0);
        gl.uniform1f(uPaint.uFade, 1);
        gl.uniform1f(uPaint.uEm, 1.65);
        gl.bindTexture(gl.TEXTURE_2D, ensureSkyTex());
        const IN2 = HS - WT;
        for (const wn of r.windows){
          const sign = (wn.wall==='e'||wn.wall==='n') ? 1 : -1;
          const horiz = (wn.wall==='e'||wn.wall==='w');
          const flip = (wn.wall==='w'||wn.wall==='n') ? -1 : 1;
          const u0 = flip > 0 ? wn.u - wn.w/2 : wn.u + wn.w/2;
          const wc = sign * (IN2 - 0.012);
          const y0 = wn.cy - wn.h/2;
          if (horiz){
            gl.uniform3f(uPaint.uO, wc, y0, u0);
            gl.uniform3f(uPaint.uU, 0, 0, flip*wn.w);
            gl.uniform3f(uPaint.uN, -sign*M_V[0], -sign*M_V[1], -sign*M_V[2]);
          } else {
            gl.uniform3f(uPaint.uO, u0, y0, wc);
            gl.uniform3f(uPaint.uU, flip*wn.w, 0, 0);
            gl.uniform3f(uPaint.uN, -sign*M_V[8], -sign*M_V[9], -sign*M_V[10]);
          }
          gl.uniform3f(uPaint.uV, 0, wn.h, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
    }

  /* additive pass: moon shafts + dust motes in the rare rooms */
  const shaderT = (performance.now() % 300000) / 1000;
  let addOn = false;
  /* candle flames on the chandeliers */
  if (lightsOn){
    for (let ri = 0; ri < midRooms.length; ri++){
      const { r, ox, oz } = midRooms[ri];
      if (!r.nFlames || !r.flameVAO) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      if (!addOn){ gl.blendFunc(gl.ONE, gl.ONE); addOn = true; }
      gl.useProgram(progFlame);
      gl.uniformMatrix4fv(uFlame.uP, false, M_P);
      mulT(M_MV, M_V, ox, 0, oz);
      gl.uniformMatrix4fv(uFlame.uMV, false, M_MV);
      gl.uniform1f(uFlame.uTime, shaderT);
      gl.uniform1f(uFlame.uMY, 0);
      gl.uniform3f(uFlame.uCol, 1.25, 0.80, 0.36);
      gl.bindVertexArray(r.flameVAO);
      gl.drawArrays(gl.POINTS, 0, r.nFlames);
    }
  }
  for (let ri = 0; ri < midRooms.length; ri++){
      const { r, ox, oz } = midRooms[ri];
      if (WIN.on || !r.shaft || !r.vao) continue;
      if (!boxVisible(ox, H/2, oz, HS, H/2, HS)) continue;
      if (!addOn){
        gl.blendFunc(gl.ONE, gl.ONE);
        addOn = true;
      }
      mulT(M_MV, M_V, ox, 0, oz);
      gl.useProgram(progShaft);
      gl.uniformMatrix4fv(uShaft.uP, false, M_P);
      gl.uniformMatrix4fv(uShaft.uMV, false, M_MV);
      gl.uniform1f(uShaft.uTime, shaderT);
      gl.uniform3f(uShaft.uC, r.shaft.x, 0, r.shaft.z);
      gl.uniform2f(uShaft.uDim, 1.5, H);
      gl.uniform3f(uShaft.uCol, MOON[0], MOON[1], MOON[2]);
      gl.bindVertexArray(quadVAO);
      gl.uniform2f(uShaft.uAxis, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.uniform2f(uShaft.uAxis, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.useProgram(progMote);
      gl.uniformMatrix4fv(uMote.uP, false, M_P);
      gl.uniformMatrix4fv(uMote.uMV, false, M_MV);
      gl.uniform1f(uMote.uTime, shaderT);
      gl.uniform3f(uMote.uC, r.shaft.x, 0, r.shaft.z);
      gl.uniform2f(uMote.uDim, 1.5, H);
      gl.uniform3f(uMote.uCol, MOON[0], MOON[1], MOON[2]);
      gl.bindVertexArray(moteVAO);
      gl.drawArrays(gl.POINTS, 0, 48);
    }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  if (usePost) runPost();
  pumpArt();

  if (probeRequest){
    gl.readPixels((vpW>>1)-16, (vpH>>1)-16, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf);
    let luma = 0;
    for (let i=0; i<32*32; i++)
      luma += 0.2126*probeBuf[i*4] + 0.7152*probeBuf[i*4+1] + 0.0722*probeBuf[i*4+2];
    luma /= 32*32;
    trace(`[probe] luma=${luma.toFixed(2)}`);
    probeRequest.resolve(luma);
    probeRequest = null;
  }
  cancelAnimationFrame(rafId);          // manual DBG.frame steps must not fork the chain
  rafId = requestAnimationFrame(frame);
}

/* ————— §12 DBG hooks (quiet; for scripted verification) ————— */
window.DBG = {
  tp(gx, gz, yaw = 0){
    player.gx = gx|0; player.gz = gz|0;
    player.x = 0; player.z = 0; player.yaw = yaw; player.pitch = 0;
    player.vx = player.vz = 0;
    onRoomChanged();
    return `room (${player.gx},${player.gz}) yaw=${yaw}`;
  },
  seed(n){
    setWorldSeed(n);
    freeAllArtSlots();
    for (const [, o] of curator.overrides){ gl.deleteTexture(o.tex); o.A.override = null; }
    curator.overrides.clear();
    artState.jobs.clear(); artState.queue.length = 0;
    artState.active = null; artState.uploadReady = null;
    artState.placards.length = 0; artState.beheld = 0;
    for (const [, r] of rooms) dropRoomGL(r);
    rooms.clear();
    visited = new Set([roomKey(player.gx, player.gz)]);
    onRoomChanged();
    return `world seed ${WORLD_SEED}`;
  },
  gen(){
    const used = (p)=>p.slots.filter(s=>s.used).length;
    return { queued: artState.queue.length, active: artState.active ? artState.active.k : null,
             beheld: artState.beheld,
             pools: { L: used(POOLS.L), P: used(POOLS.P), S: used(POOLS.S), W: used(POOLS.W), placards: used(PPOOL) } };
  },
  /* full synchronous render of one artwork → FNV checksum of its pixels.
     Cross-reload equality on the same machine = determinism proof. */
  artHash(gx, gz, i){
    preemptArtJobs();
    const r = getRoom(gx, gz), A = r.artworks[i];
    if (!A) return 'no artwork ' + i;
    const [w, h] = TEX_SIZES[A.asp];
    scratch.width = w; scratch.height = h;
    const rnd = mulberry32(A.seed);
    const gen = ALGOS[A.algo % ALGOS.length](sctx, w, h, rnd, jitterPal(A.pal, rnd));
    while (!gen.next().done){}
    finishArt(sctx, w, h);
    const d = sctx.getImageData(0, 0, w, h).data;
    let hsh = 2166136261 >>> 0;
    for (let j = 0; j < d.length; j += 17) hsh = Math.imul(hsh ^ d[j], 16777619) >>> 0;
    return { algo: A.algo % ALGOS.length, seed: A.seed, w, h, hash: hsh };
  },
  roomSeed(gx, gz){ return h2(gx, gz, SALT_ROOM ^ WORLD_SEED); },
  doors(gx, gz){ const r = getRoom(gx, gz); return {...r.doors}; },
  art(gx, gz){
    return getRoom(gx, gz).artworks.map((A, i) => ({
      i, wall: A.wall, u: +A.u.toFixed(2), asp: A.asp,
      algo: A.algo % ALGOS.length, pal: A.pal % PALETTES.length, seed: A.seed,
      title: A.title || null, ready: !!A.tex }));
  },
  /* the exact pigment a work is painted with — the last input to artHash */
  palette(gx, gz, i){
    const A = getRoom(gx, gz).artworks[i];
    if (!A) return null;
    return jitterPal(A.pal, mulberry32(A.seed));
  },
  pos(x, z, yaw = player.yaw, pitch = 0){
    player.x = x; player.z = z; player.yaw = yaw; player.pitch = pitch;
    player.vx = player.vz = 0;
    return JSON.parse(JSON.stringify(DBG.stats()));
  },
  room(gx, gz){
    const r = getRoom(gx, gz);
    return { special: r.special, bench: r.bench || null, pedestal: r.pedestal || null,
             shaft: r.shaft || null, works: r.artworks.length };
  },
  lightsInfo(){
    const r = rooms.get(roomKey(player.gx, player.gz));
    if (!r) return 'no room';
    return { own: r.ownLights.length, final: r.lights ? r.lights.length : null,
             packed: packLights(r, 0, 0),
             sample: r.lights && r.lights[0] ? { p: r.lights[0].p, col: r.lights[0].col } : null,
             lpos0: [+LPOS[0].toFixed(2), +LPOS[1].toFixed(2), +LPOS[2].toFixed(2), +LPOS[3].toFixed(4)] };
  },
  findSpecial(type = 1, maxR = 48){    // 1 vermilion · 2 archive · 3 dark room
    for (let rad = 1; rad <= maxR; rad++)
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++){
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
          const gx = player.gx + dx, gz = player.gz + dz;
          const sp = specialAt(gx, gz);
          if (sp === type) return { gx, gz, type: sp };
        }
    return null;
  },
  luma(){
    return new Promise(res => {
      probeRequest = { resolve: res };
      setTimeout(() => { if (probeRequest){ probeRequest = null; res(-1); } }, 1500);
    });
  },
  /* step n frames synchronously (works while the tab is hidden and rAF
     is paused) — scripted verification and the M8 soak drive this */
  frame(n = 1, dtMs = 16.7){
    forceDt = dtMs / 1000;
    let acc = 0, mx = 0, worst = -1;
    for (let i = 0; i < n; i++){
      const t0 = performance.now();
      frame(t0);
      const el = performance.now() - t0;
      acc += el; if (el > mx){ mx = el; worst = i; }
    }
    forceDt = null;
    return { stepped: n, avgMs: +(acc/n).toFixed(2), maxMs: +mx.toFixed(1), worstFrame: worst };
  },
  autopilot(on = true){
    auto.on = !!on;
    if (auto.on){ auto.wp = null; inspectOff(); }
    return 'autopilot ' + (auto.on ? 'on' : 'off');
  },
  stats(){
    return {
      room: [player.gx, player.gz],
      pos: [+player.x.toFixed(2), +player.z.toFixed(2)],
      py: +player.py.toFixed(2), jumps: player.jumps,
      lights: lightsOn, shutters: WIN.on,
      yaw: +player.yaw.toFixed(2),
      visited: visited.size,
      cached: rooms.size,
      colliders: colN,
      fps: +fpsAvg.toFixed(1),
      locked,
      auto: auto.on, post: post.on,
      beheld: artState.beheld, queued: artState.queue.length,
      persist: { ...persist },
    };
  },
  post(on = true){ post.on = !!on; return 'post ' + (post.on ? 'on' : 'off'); },
  cloudConfig(url, key){
    try {
      if (!url) localStorage.removeItem('lumiere_cloud');
      else localStorage.setItem('lumiere_cloud', JSON.stringify({ url, key }));
    } catch(e){ return 'storage unavailable'; }
    location.reload();
  },
};

/* ————— boot ————— */
canvas.addEventListener('webglcontextlost', (e)=>{
  e.preventDefault();
  console.warn('[boot] context lost — holding seeds, waiting for restore');
});
canvas.addEventListener('webglcontextrestored', ()=>{
  console.warn('[boot] context restored — rebuilding the museum from seeds');
  /* every GL object is dead; recreate them all — content re-derives from seeds */
  for (const pool of [POOLS.L, POOLS.P, POOLS.S, POOLS.W, PPOOL])
    for (const s of pool.slots){ releaseSlot(s); s.tex = null; }
  artState.jobs.clear(); artState.queue.length = 0;
  artState.active = null; artState.uploadReady = null; artState.placards.length = 0;
  for (const [, r] of rooms){ r.vao = r.vbo = r.ibo = null; r.nIdx = 0;
                              r.flameVAO = r.flameVBO = null; r.nFlames = 0; }
  for (const [, o] of curator.overrides) o.A.override = null;   // stale handles die with the context
  curator.overrides.clear();
  post.ready = false;
  resetGrain();
  skyTex = null;
  initPrograms();
  ensureBuilt(); syncArtJobs(); refreshNear();
});

const introEl = document.getElementById('intro');
{
  const noteEl = document.getElementById('intro-note');
  const noteTimer = setInterval(() => {
    if (introEl.hidden){ clearInterval(noteTimer); return; }
    const g = artState.jobs.size;
    noteEl.textContent =
      g > 0 ? `the first wing is being hung · ${g} work${g===1?'':'s'} remain` :
      (storageOK && persist.visits > 1 ? `the gallery remembers you · visit ${persist.visits}`
                                       : 'the first wing is ready');
  }, 350);
}
document.getElementById('enter').addEventListener('click', ()=>{
  entered = true; setAudioActive(true);
  initAudio();               // inside the gesture — autoplay policy satisfied
  document.body.classList.add('entered');
  introEl.style.transition = REDUCED ? 'none' : 'opacity 1.1s ease';
  introEl.style.opacity = '0';
  setTimeout(()=>{ introEl.hidden = true; }, REDUCED ? 0 : 1100);
  canvas.focus();
  tryPointerLock();          // inside the gesture; drag-look if it declines
  setTimeout(()=>{
    const hint = document.getElementById('hud-hint');
    if (hint) hint.style.opacity = '0';
  }, 9000);
});

if (gl){
  initPrograms();
  resize();
  lightsOn = persist.lightsOn !== false;      // both switches remember their setting
  WIN.on = !!persist.shutters;
  swUI();
  ensureBuilt();
  onRoomChanged();
  curatorBoot().then(cloudBoot);
  requestAnimationFrame((t)=>{ lastT = t; requestAnimationFrame(frame); });
}
document.getElementById('sw-lights').addEventListener('click', () => setLights(!lightsOn));
document.getElementById('sw-shutters').addEventListener('click', () => setShutters(!WIN.on));
document.getElementById('sw-curator').addEventListener('click', () => curatorToggle());
