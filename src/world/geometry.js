/* ═══════════════════════════════════════════════════════════════════
   Room record → interleaved vertex buffer.
   Everything is axis-aligned quads emitted by one quad() helper; the
   floor goes last, into its own index range, so the render loop can draw
   it separately over the mirrored pass.
   Takes daylight as an argument rather than reading the shutter toggle:
   window geometry is baked into the mesh, so the caller owns that choice.
   ═══════════════════════════════════════════════════════════════════ */
import { S, HS, H, WT, DOORW, DOORH } from '../config.js';
import { SPECIAL, spotAt, getRoom, RIG } from './rooms.js';
import { theme } from './themes.js';

/* 0 ordinary · 1 vermilion · 2 archive · 3 dark room. The live values; a theme
   overwrites index 0 outright and pulls the three set-pieces toward their own
   grey by its `chroma`. Pulling rather than replacing is what keeps the
   Vermilion Cabinet recognisably itself in a monochrome hall instead of
   becoming another grey room — it goes quiet, not absent. */
export const SCHEMES = [
  { wall:[0.166,0.150,0.132], floor:[0.105,0.094,0.082], ceil:[0.070,0.065,0.058], trim:[0.050,0.046,0.040] },
  { wall:[0.300,0.082,0.058], floor:[0.088,0.062,0.050], ceil:[0.078,0.050,0.040], trim:[0.360,0.280,0.140] },
  { wall:[0.190,0.170,0.140], floor:[0.100,0.090,0.078], ceil:[0.068,0.063,0.056], trim:[0.055,0.050,0.043] },
  { wall:[0.058,0.055,0.050], floor:[0.050,0.047,0.043], ceil:[0.040,0.038,0.035], trim:[0.030,0.028,0.025] },
];
/* The unthemed originals, so switching themes re-derives from these instead of
   desaturating an already-desaturated set. */
const SCHEMES_BASE = SCHEMES.map(s => {
  const o = {}; for (const k in s) o[k] = s[k].slice(); return o;
});
/** Overwrite the ordinary room's scheme and take the specials `chroma` of the
 *  way to grey. Called by applyTheme; the caller rebuilds the meshes. */
export function applyScheme(scheme, chroma){
  for (const k in SCHEMES[0]) SCHEMES[0][k] = (scheme[k] || SCHEMES_BASE[0][k]).slice();
  for (let i = 1; i < SCHEMES.length; i++)
    for (const k in SCHEMES[i]){
      const b = SCHEMES_BASE[i][k];
      const y = 0.2126*b[0] + 0.7152*b[1] + 0.0722*b[2];
      SCHEMES[i][k] = [0,1,2].map(c => y + (b[c] - y) * chroma);
    }
}

export function buildRoomMesh(r, daylight){
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
  /* Unlit canvas; real art overlays it. In a solo theme most frames stay empty
     for good, so a dark warm rectangle in every one of them reads as a museum
     that failed to load. Empty frames instead take the wall a shade darker and
     recede — with their lamps off too, they are barely there, which is the
     point: you see what you hung. */
  const CANVAS_COL = theme().solo
    ? SCH.wall.map(v => v * 0.86)
    : [0.092, 0.082, 0.070];
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
  if (daylight){
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

/* Final light list: own lights + neighbour lights that sit within reach of a
   shared open doorway (their glow should spill through). The cap was 8, which a
   six-work room filled with its own fixtures alone — so spill never once fired
   in a busy room. At 10 a full room keeps two slots for its neighbours at night;
   in daylight two suns still take them, but there the sun swamps the spill
   anyway. Must match the loop bound in arch.frag / paint.frag and the LPOS
   arrays. */
export const MAX_LIGHTS = 10;

export function assembleLights(r, daylight){
  const L = [];
  if (daylight){
    const IN = HS - WT;
    for (const wn of r.windows){
      const sign = (wn.wall==='e'||wn.wall==='n') ? 1 : -1;
      const horiz = (wn.wall==='e'||wn.wall==='w');
      const p = horiz ? [sign*(IN-0.06), 2.15, wn.u] : [wn.u, 2.15, sign*(IN-0.06)];
      const t = horiz ? [sign*(IN) - sign*5.2, 0.35, wn.u*0.35] : [wn.u*0.35, 0.35, sign*IN - sign*5.2];
      const SU = RIG.sun;
      const sun = spotAt(p, t, SU.col, SU.inner, SU.outer, SU.range);
      sun.sun = true;
      L.push(sun);
    }
  }
  /* Priority, not array order. `ownLights` ends with the two chandelier lights,
     so a six-work room with the shutters open pushed two suns plus six artwork
     spots, hit the cap, and dropped the chandelier entirely — while its candle
     flames carried on burning. A visibly lit fixture that lit nothing.

     The chandelier is the room's fill and the "1" in the 3:1 ratio, so it is
     placed before the spots; the sun already sits ahead of both. */
  const chandeliers = [], spots = [];
  for (const l of r.ownLights) (l.fill ? chandeliers : spots).push(l);
  for (const l of chandeliers){ if (L.length >= MAX_LIGHTS) break; L.push(l); }
  for (const l of spots){ if (L.length >= MAX_LIGHTS) break; L.push(l); }
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
  for (const [, l] of cand){ if (L.length >= MAX_LIGHTS) break; L.push(l); }
  r.lights = L;
}

