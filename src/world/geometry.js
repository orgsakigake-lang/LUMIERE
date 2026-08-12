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

  /* ————— swept profiles —————
     Three things here were drawn as the cheapest shape that occupied roughly
     the right space: picture frames as twelve flat quads, ceiling rosettes as
     *square* annuli, and chandelier arms as single quads with no thickness at
     all — visible as a hairline from the side and gone entirely edge-on. One
     profile swept along a path fixes all three, and at this scale a faceted
     sweep is what moulding actually looks like anyway. */

  /** Revolve a [radius, y] profile about a vertical axis. Rosettes, hubs. */
  function revolveY(cx, cz, prof, seg, col){
    for (let i = 0; i < prof.length - 1; i++){
      const [r0, y0] = prof[i], [r1, y1] = prof[i+1];
      /* Normal from the profile segment, rotated outward. */
      const dr = r1 - r0, dy = y1 - y0;
      const nl = Math.hypot(dr, dy) || 1;
      const nr = dy / nl, ny = -dr / nl;
      for (let s2 = 0; s2 < seg; s2++){
        const a0 = s2/seg * Math.PI*2, a1 = (s2+1)/seg * Math.PI*2;
        const c0 = Math.cos(a0), n0 = Math.sin(a0), c1 = Math.cos(a1), n1 = Math.sin(a1);
        const mc = Math.cos((a0+a1)/2), mn = Math.sin((a0+a1)/2);
        quad(cx + c0*r0, y0, cz + n0*r0,  cx + c1*r0, y0, cz + n1*r0,
             cx + c1*r1, y1, cz + n1*r1,  cx + c0*r1, y1, cz + n0*r1,
             mc*nr, ny, mn*nr, col, 0.35, 0.35);
      }
    }
  }

  /** A round bar between two points. Chandelier arms and stems. */
  function tube(ax, ay, az, bx, by, bz, rad, sides, col){
    let dx = bx-ax, dy = by-ay, dz = bz-az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    /* Any vector not parallel to the axis gives a frame to spin around. */
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.94){ ux = 1; uy = 0; }
    let px = uy*dz - uz*dy, py = uz*dx - ux*dz, pz = ux*dy - uy*dx;
    const pl = Math.hypot(px, py, pz) || 1; px/=pl; py/=pl; pz/=pl;
    const qx = dy*pz - dz*py, qy = dz*px - dx*pz, qz = dx*py - dy*px;
    for (let i = 0; i < sides; i++){
      const a0 = i/sides * Math.PI*2, a1 = (i+1)/sides * Math.PI*2;
      const e = (a, k) => [Math.cos(a)*px*rad + Math.sin(a)*qx*rad,
                           Math.cos(a)*py*rad + Math.sin(a)*qy*rad,
                           Math.cos(a)*pz*rad + Math.sin(a)*qz*rad];
      const o0 = e(a0), o1 = e(a1);
      const am = (a0+a1)/2;
      const nx = Math.cos(am)*px + Math.sin(am)*qx;
      const ny = Math.cos(am)*py + Math.sin(am)*qy;
      const nz = Math.cos(am)*pz + Math.sin(am)*qz;
      quad(ax+o0[0], ay+o0[1], az+o0[2],  ax+o1[0], ay+o1[1], az+o1[2],
           bx+o1[0], by+o1[1], bz+o1[2],  bx+o0[0], by+o0[1], bz+o0[2],
           nx, ny, nz, col, 0.3, 0.3);
    }
  }

  /** Sweep a moulding profile around a picture frame. `prof` is a list of
   *  [out, proud]: how far the section stands outside the sight edge, and how
   *  far it stands off the wall. Successive rings are joined side by side, so
   *  the corners mitre for free. */
  function mouldFrame(wall, u0, u1, y0, y1, prof, col){
    const s = wsign(wall), horiz = whoriz(wall);
    for (let i = 0; i < prof.length - 1; i++){
      const [o0, p0] = prof[i], [o1, p1] = prof[i+1];
      /* wp's depth is measured *into the room* from the interior face, so proud
         maps straight through. Negating it buried the whole moulding inside the
         wall slab, where it rendered perfectly and could not be seen. */
      const d0 = p0, d1 = p1;
      /* Section normal, rotated a quarter turn off the profile direction. */
      const dO = o1 - o0, dP = p1 - p0;
      const nl = Math.hypot(dO, dP) || 1;
      const nOut = -dP/nl, nPro = dO/nl;
      const wn = horiz ? [-s, 0, 0] : [0, 0, -s];     // toward the room
      /* left, right, top, bottom — each with its own outward direction */
      const sides = [
        { a:[u0-o0, y0-o0], b:[u0-o0, y1+o0], c:[u0-o1, y1+o1], d:[u0-o1, y0-o1], ou:-1, oy:0 },
        { a:[u1+o0, y1+o0], b:[u1+o0, y0-o0], c:[u1+o1, y0-o1], d:[u1+o1, y1+o1], ou:+1, oy:0 },
        { a:[u0-o0, y1+o0], b:[u1+o0, y1+o0], c:[u1+o1, y1+o1], d:[u0-o1, y1+o1], ou:0, oy:+1 },
        { a:[u1+o0, y0-o0], b:[u0-o0, y0-o0], c:[u0-o1, y0-o1], d:[u1+o1, y0-o1], ou:0, oy:-1 },
      ];
      for (const sd of sides){
        /* `out` runs along the wall for the stiles and vertically for the
           rails; wp maps u to z on the east/west walls and to x on north/south,
           with no sign flip either way. */
        const n3 = horiz ? [wn[0]*nPro, sd.oy*nOut, sd.ou*nOut]
                         : [sd.ou*nOut, sd.oy*nOut, wn[2]*nPro];
        q4(wp(wall, sd.a[0], sd.a[1], d0), wp(wall, sd.b[0], sd.b[1], d0),
           wp(wall, sd.c[0], sd.c[1], d1), wp(wall, sd.d[0], sd.d[1], d1),
           n3, col, 0.3, 0.3);
      }
    }
  }
  /* A gallery moulding: a step off the wall, a crest, an ogee fall to the
     sight edge. Six points is enough to catch a highlight and throw a shadow. */
  const FRAME_PROFILE = [
    [0.000, 0.030], [0.014, 0.058], [0.032, 0.066],
    [0.052, 0.052], [0.068, 0.032], [0.075, 0.004],
  ];

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
    mouldFrame(A.wall, u0, u1, y0, y1, FRAME_PROFILE, F);
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
  /* The sculpture materials, shared by whatever stands on plinth or floor. */
  /* Alabaster sits under the chandelier's pool at head height, where 0.46
     albedo bloomed into a halo that ate the silhouette — 0.41 still reads
     as pale stone and keeps its edges. */
  const STONE = [[0.105, 0.082, 0.056],    // dark bronze
                 [0.245, 0.158, 0.112],    // terracotta
                 [0.415, 0.398, 0.370]];   // alabaster
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
    const { x, z, kind = 0, tone = 0, form = [0.5, 0.5, 0.5] } = r.pedestal;
    const PL = [0.400, 0.385, 0.355];
    box(x-0.23, 0, z-0.23, x+0.23, 1.08, z+0.23, PL);
    box(x-0.27, 1.08, z-0.27, x+0.27, 1.13, z+0.27, PL);
    r.colliders.push({ cx:x, cz:z, hx:0.28, hz:0.28 });
    /* Something to stand for: these were empty plinths for a whole version —
       furniture waiting for a sculptor. A small form from the pedestal's own
       seeded parameters, in one of three materials. */
    const col = STONE[tone % 3];
    const y0 = 1.13, h = 0.42 + form[0]*0.25;
    if (kind === 0){
      /* an amphora — foot, belly, shoulder, neck, lip */
      const rb = 0.13 + form[1]*0.06, rn = 0.045 + form[2]*0.02;
      revolveY(x, z, [
        [0.070, y0], [0.095, y0+0.02], [rb*0.75, y0+h*0.22],
        [rb, y0+h*0.45], [rb*0.72, y0+h*0.72], [rn, y0+h*0.88],
        [rn+0.012, y0+h*0.97], [rn+0.020, y0+h], [0.001, y0+h],
      ], 12, col);
    } else if (kind === 1){
      /* a cairn of three worn stones, each resting on the last */
      let cy = y0, rr = 0.115 + form[1]*0.045;
      for (let i = 0; i < 3; i++){
        const hh = rr*1.35;
        revolveY(x, z, [
          [0.001, cy], [rr*0.82, cy+hh*0.18], [rr, cy+hh*0.5],
          [rr*0.78, cy+hh*0.84], [0.001, cy+hh],
        ], 10, col);
        cy += hh*0.88; rr *= 0.68 + form[2]*0.1;
      }
    } else if (kind === 2){
      /* a slender spire with a sphere at rest on its tip */
      const rs = 0.055 + form[1]*0.025;
      revolveY(x, z, [
        [0.085, y0], [0.070, y0+0.03], [0.028, y0+h*0.85], [0.022, y0+h],
      ], 10, col);
      const cy = y0 + h + rs*0.8;
      revolveY(x, z, [
        [0.001, cy-rs], [rs*0.71, cy-rs*0.71], [rs, cy],
        [rs*0.71, cy+rs*0.71], [0.001, cy+rs],
      ], 12, col);
    } else {
      /* a bust — Cycladic economy: shoulders, a neck, an egg of a head, and
         one ridge of a nose, which at this scale is the entire face. Boxes
         are axis-aligned, so it gazes down whichever axis points it nearest
         the middle of its hall. */
      const fx = Math.abs(x) > Math.abs(z) ? -Math.sign(x) : 0;
      const fz = fx === 0 ? (-Math.sign(z) || 1) : 0;
      /* Shoulders as a trapezoid prism, not stacked boxes — boxes read as more
         plinth. `u` runs along the shoulder line, `w` along the gaze. */
      const P = (u, y, w) => fx ? [x + w*fx, y, z + u] : [x + u, y, z + w*fz];
      const sw = 0.17 + form[1]*0.03, tw = 0.06;         // half-span at base, at neck
      const d = 0.095, yT = y0 + 0.27;                   // chest depth, shoulder top
      const T = (a, b, c, e, n) => quad(...P(...a), ...P(...b), ...P(...c), ...P(...e), ...n, col, 0.1, 0.1);
      const gaze = fx ? [fx, 0, 0] : [0, 0, fz];
      T([-sw, y0,  d], [ sw, y0,  d], [ tw, yT,  d], [-tw, yT,  d], gaze);
      T([-sw, y0, -d], [ sw, y0, -d], [ tw, yT, -d], [-tw, yT, -d], gaze.map(v => -v));
      { const sl = Math.hypot(yT - y0, sw - tw), nu = (yT - y0)/sl, ny = (sw - tw)/sl;
        const N = (s) => fx ? [0, ny, s*nu] : [s*nu, ny, 0];
        T([ sw, y0,  d], [ sw, y0, -d], [ tw, yT, -d], [ tw, yT,  d], N(1));
        T([-sw, y0,  d], [-sw, y0, -d], [-tw, yT, -d], [-tw, yT,  d], N(-1)); }
      revolveY(x, z, [[0.052, y0+0.24], [0.044, y0+0.34]], 8, col);
      const hy = y0 + 0.34, hr = 0.070 + form[2]*0.012;
      revolveY(x, z, [
        [0.001, hy], [hr*0.80, hy+0.020], [hr, hy+0.075], [hr*0.96, hy+0.125],
        [hr*0.70, hy+0.180], [0.001, hy+0.215],
      ], 10, col);
      const nx = x + fx*hr*0.92, nz = z + fz*hr*0.92;
      box(nx - (fx ? 0.020 : 0.011), hy+0.060, nz - (fz ? 0.020 : 0.011),
          nx + (fx ? 0.020 : 0.011), hy+0.115, nz + (fz ? 0.020 : 0.011), col);
    }
  }
  if (r.statue){
    /* A standing figure on the floor, robed — drape is what a lathe can
       carve, and a lathe is the one sculptor this renderer employs. Hem,
       waist, a swell of shoulder, and the same egg of a head as the busts;
       an archaic kore at about two-thirds life size. ~350 triangles. */
    const { x, z, tone = 0, form = [0.5, 0.5, 0.5, 0.5] } = r.statue;
    const col = STONE[tone % 3];
    revolveY(x, z, [[0.34, 0], [0.30, 0.07], [0.001, 0.07]], 12, [0.400, 0.385, 0.355]);
    const h = 1.34 + form[0]*0.24;
    const hem = 0.20 + form[1]*0.05;
    const waist = hem*(0.52 + form[2]*0.16);
    const sh = waist + 0.05;
    const y1 = 0.07;
    revolveY(x, z, [
      [hem, y1], [hem*0.92, y1 + h*0.06], [waist, y1 + h*0.55],
      [sh, y1 + h*0.72], [sh*0.85, y1 + h*0.80], [0.045, y1 + h*0.84],
    ], 12, col);
    const hy = y1 + h*0.84, hr = 0.075;
    revolveY(x, z, [
      [0.001, hy], [hr*0.82, hy+0.02], [hr, hy+0.08], [hr*0.94, hy+0.13],
      [hr*0.66, hy+0.185], [0.001, hy+0.22],
    ], 10, col);
    r.colliders.push({ cx: x, cz: z, hx: 0.36, hz: 0.36 });
  }
  /* Potted plants: a thrown pot (one revolved profile, soil disc included),
     and a fan of arcing two-quad leaves. ~120 triangles a plant, part of the
     room's one VAO — decor at the price of a picture frame. */
  if (r.plants){
    /* Albedo from the theme — Graphite lightens the leaves a stop so they
       hold their own against its dark grey walls; meshes rebuild on every
       theme switch, so reading the live theme here is safe. */
    const TP = theme().plant || {};
    const POT = TP.pot || [0.235, 0.150, 0.105], SOIL = [0.060, 0.045, 0.035];
    const LEAF = TP.leaf || [0.110, 0.185, 0.095], LEAF_D = TP.leafD || [0.075, 0.135, 0.075];
    for (const pl of r.plants){
      const { x, z, s, leaves, ph } = pl;
      revolveY(x, z, [
        [0.115*s, 0], [0.150*s, 0.30*s], [0.165*s, 0.42*s],
        [0.150*s, 0.44*s], [0.120*s, 0.44*s],
      ], 10, POT);
      revolveY(x, z, [[0.118*s, 0.405*s], [0.001, 0.405*s]], 10, SOIL);
      const y0 = 0.41 * s;
      for (let i = 0; i < leaves; i++){
        const a = ph + (i / leaves) * Math.PI * 2 + (i % 3) * 0.21;
        const ca = Math.cos(a), sa = Math.sin(a);
        const t = (i * 0.618) % 1;
        const L = (0.55 + 0.35 * t) * s;
        const bx = x + ca * 0.05 * s, bz = z + sa * 0.05 * s;
        const mx = bx + ca * 0.16 * L, my = y0 + 0.58 * L, mz = bz + sa * 0.16 * L;
        const tx = bx + ca * 0.42 * L, ty = y0 + 0.94 * L, tz = bz + sa * 0.42 * L;
        const w0 = 0.055 * s, w1 = 0.035 * s;
        const px2 = -sa, pz2 = ca;
        const col = (i % 2) ? LEAF : LEAF_D;
        quad(bx - px2*w0, y0, bz - pz2*w0,  bx + px2*w0, y0, bz + pz2*w0,
             mx + px2*w1, my, mz + pz2*w1,  mx - px2*w1, my, mz - pz2*w1,
             ca*0.85, 0.30, sa*0.85, col, 0.1, 0.1);
        quad(mx - px2*w1, my, mz - pz2*w1,  mx + px2*w1, my, mz + pz2*w1,
             tx, ty, tz,  tx, ty, tz,
             ca*0.70, 0.55, sa*0.70, col, 0.1, 0.1);
      }
      r.colliders.push({ cx: x, cz: z, hx: 0.18*s, hz: 0.18*s });
    }
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
    /* Circular, and with a section. They were square annuli lying flat on the
       ceiling — from directly below, a plaster rosette shaped like a picture
       frame. */
    revolveY(0, 0, [[0.72, H-0.006], [0.66, H-0.034], [0.58, H-0.046],
                    [0.52, H-0.028], [0.50, H-0.004]], 22, SCH.trim);
    revolveY(0, 0, [[0.34, H-0.006], [0.30, H-0.040], [0.24, H-0.052],
                    [0.20, H-0.030], [0.18, H-0.004]], 18, SCH.trim);
    tube(0, hubY, 0, 0, H, 0, 0.018, 6, BR);
    revolveY(0, 0, [[0.02, hubY], [0.085, hubY-0.045], [0.095, hubY-0.095],
                    [0.06, hubY-0.15], [0, hubY-0.165]], 14, BR);
    for (let a = 0; a < arms; a++){
      const th = a/arms * Math.PI * 2;
      const dx = Math.cos(th), dz = Math.sin(th);
      const x0 = dx*0.085, z0 = dz*0.085, x1 = dx*armL, z1 = dz*armL;
      /* Was a single quad with no thickness: a hairline from the side, and
         from directly below it vanished. */
      tube(x0, hubY-0.13, z0, x1, ringY+0.02, z1, 0.014, 5, BR);
      revolveY(x1, z1, [[0.008, ringY-0.05], [0.038, ringY-0.03],
                        [0.034, ringY+0.008], [0.016, ringY+0.02]], 10, BR);
      tube(x1, ringY+0.01, z1, x1, ringY+0.13, z1, 0.013, 6, IV);
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
      if (dist < 2.9) cand.push([dist, { ...nl, p: [px, nl.p[1], pz], spill: true }]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, l] of cand){ if (L.length >= MAX_LIGHTS) break; L.push(l); }
  r.lights = L;
}

