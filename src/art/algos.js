/* ═══════════════════════════════════════════════════════════════════
   The six generative algorithms. Each is a function*(ctx, W, H, rnd, pal)
   that yields every few hundred iterations so the scheduler can pace it
   against the frame budget. Adding a seventh means adding it to ALGOS and
   ALGO_NAMES here — nothing outside this file counts them.
   ═══════════════════════════════════════════════════════════════════ */
import { h2, mulberry32 } from '../world/seed.js';
import { hexRgb } from './palettes.js';

export const ALGO_NAMES = ['Ink Current','Strange Attractor','Truchet Tiling','Fractured Glass','Composition','Ridgeline'];
export const T_ADJ  = ['Quiet','Gilded','Broken','Winter','Slow','Feral','Hollow','Distant','Patient','Low','Paper','Iron','Salt','Vermilion','Blue','Late'];
export const T_NOUN = ['Field','Procession','Tide','Orchard','Machine','Letter','Garden','Chorus','Meridian','Threshold','Argument','Weather','Harbour','Interval','Reliquary','Signal'];
export const T_MAT  = ['Copper','Ash','Indigo','Bone','Smoke','Ochre','Tin','Velvet','Rust','Chalk'];
export const T_TIME = ['Dusk','Nightfall','First Light','the Blue Hour','Low Tide','Winter Noon'];
export function roman(n){
  const R = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let s = ''; for (const [v,c] of R) while (n >= v){ s += c; n -= v; } return s;
}
export function makeTitle(rnd){
  const pick = (arr)=>arr[Math.floor(rnd()*arr.length)];
  switch (Math.floor(rnd()*8)){
    case 0: return `${pick(T_ADJ)} ${pick(T_NOUN)} No. ${1+Math.floor(rnd()*24)}`;
    case 1: return `Study in ${pick(T_MAT)}`;
    case 2: return `${pick(T_NOUN)} at ${pick(T_TIME)}`;
    case 3: return `Elegy No. ${1+Math.floor(rnd()*12)}`;
    case 4: return `The ${pick(T_ADJ)} ${pick(T_NOUN)}`;
    case 5: return `Variations on ${pick(['a Letter','a Field','the Tide','a Garden','the Weather','a Chorus','a Signal','an Argument'])}`;
    case 6: return `${pick(T_NOUN)} (${roman(1+Math.floor(rnd()*12))})`;
    default: return `${pick(T_ADJ)} ${pick(T_NOUN)}`;
  }
}

/* deterministic value noise (for the flow field) */
export function makeNoise(seed){
  const at = (xi, yi) => h2(xi, yi, seed) / 4294967296;
  return function(x, y){
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x-xi, fy = y-yi;
    const sx = fx*fx*(3-2*fx), sy = fy*fy*(3-2*fy);
    const a = at(xi,yi), b = at(xi+1,yi), c = at(xi,yi+1), d = at(xi+1,yi+1);
    return a + (b-a)*sx + (c-a)*sy + (a-b-c+d)*sx*sy;
  };
}

/* — algorithm 0: ink drawn along invisible currents — */
function* genFlowField(ctx, W, Hh, rnd, pal){
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, Hh);
  const n1 = makeNoise((rnd()*4294967296)>>>0);
  const n2 = makeNoise((rnd()*4294967296)>>>0);
  const sc = 0.0028 + rnd()*0.0042, swirl = 1.5 + rnd()*4.5;
  const bias = rnd()*Math.PI*2;
  const NP = 850 + Math.floor(rnd()*850);
  ctx.lineCap = 'round';
  for (let i = 0; i < NP; i++){
    let x = rnd()*W, y = rnd()*Hh;
    ctx.strokeStyle = pal.inks[Math.floor(Math.pow(rnd(), 1.7)*pal.inks.length)];
    ctx.globalAlpha = 0.10 + rnd()*0.45;
    ctx.lineWidth = rnd() < 0.07 ? 1.6 + rnd()*2.6 : 0.5 + rnd()*0.9;
    const steps = 26 + Math.floor(rnd()*88);
    const sgn = rnd() < 0.5 ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < steps; s++){
      const f = n1(x*sc, y*sc)*0.65 + n2(x*sc*2.6, y*sc*2.6)*0.35;
      const a = bias + f*Math.PI*2*swirl;
      x += Math.cos(a)*2.3*sgn; y += Math.sin(a)*2.3*sgn;
      if (x < -8 || x > W+8 || y < -8 || y > Hh+8) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    if ((i & 7) === 7) yield;
  }
  ctx.globalAlpha = 1;
}

/* — algorithm 1: strange-attractor density, log-tonemapped — */
/* Shared density accumulator — one buffer, reused, so the GC stays quiet.
   It grows on demand. It used to be fixed at 512², which is exactly the
   largest pooled texture, so the wall never showed the fault: acquire renders
   up to 1024², `subarray` clamped the request silently, every read past
   262144 returned undefined, and `Math.log(1 + undefined)` produced NaN that
   the ramp carried into a Uint8ClampedArray as 0. Every acquired attractor
   was correct for its first 262144/W rows and solid black below. */
let ATTR_ACC = new Float32Array(512 * 512);
function attrAcc(n){
  if (ATTR_ACC.length < n) ATTR_ACC = new Float32Array(n);
  return ATTR_ACC.subarray(0, n);
}
function* genAttractor(ctx, W, Hh, rnd, pal){
  let a=0, b=0, c=0, d=0;
  for (let t = 0; t < 9; t++){
    a = -2 + rnd()*4; b = -2 + rnd()*4; c = -2 + rnd()*4; d = -2 + rnd()*4;
    let x = 0.1, y = 0.1, mnx = 9, mxx = -9, mny = 9, mxy = -9;
    for (let i = 0; i < 900; i++){
      const nx = Math.sin(a*y) + c*Math.cos(a*x);
      y = Math.sin(b*x) + d*Math.cos(b*y); x = nx;
      if (i > 100){ mnx=Math.min(mnx,x); mxx=Math.max(mxx,x); mny=Math.min(mny,y); mxy=Math.max(mxy,y); }
    }
    if (mxx-mnx > 1.5 && mxy-mny > 1.5) break;
  }
  yield;                            // isolate setup cost in its own slice
  const acc = attrAcc(W * Hh); acc.fill(0);
  const rx = 1.15 + Math.abs(c), ry = 1.15 + Math.abs(d);
  let x = 0.05, y = 0.05;
  const TOTAL = 400000;
  for (let i = 0; i < TOTAL; i++){
    const nx = Math.sin(a*y) + c*Math.cos(a*x);
    y = Math.sin(b*x) + d*Math.cos(b*y); x = nx;
    if (i > 60){
      const px = (x/rx*0.5 + 0.5)*(W-2) + 1, py = (y/ry*0.5 + 0.5)*(Hh-2) + 1;
      if (px >= 0 && px < W && py >= 0 && py < Hh) acc[(py|0)*W + (px|0)]++;
    }
    if ((i & 4095) === 4095) yield;
  }
  let mx = 1;
  for (let i0 = 0; i0 < acc.length; i0 += 65536){
    const end = Math.min(acc.length, i0 + 65536);
    for (let i = i0; i < end; i++) if (acc[i] > mx) mx = acc[i];
    yield;
  }
  const P0 = hexRgb(pal.paper), C1 = hexRgb(pal.inks[0]), C2 = hexRgb(pal.inks[3] || pal.inks[1]);
  const img = ctx.createImageData(W, 8);
  const lg = 1/Math.log(1+mx);
  for (let row0 = 0; row0 < Hh; row0 += 8){
    const bh = Math.min(8, Hh - row0);
    for (let row = 0; row < bh; row++){
      for (let col = 0; col < W; col++){
        const idx = (row0+row)*W + col;
        let t = Math.pow(Math.log(1 + acc[idx]) * lg, 0.82);
        let r, g, bl;
        if (t < 0.55){ const u = t/0.55; r = P0[0]+(C1[0]-P0[0])*u; g = P0[1]+(C1[1]-P0[1])*u; bl = P0[2]+(C1[2]-P0[2])*u; }
        else { const u = (t-0.55)/0.45; r = C1[0]+(C2[0]-C1[0])*u; g = C1[1]+(C2[1]-C1[1])*u; bl = C1[2]+(C2[2]-C1[2])*u; }
        const o = (row*W + col)*4;
        img.data[o] = r; img.data[o+1] = g; img.data[o+2] = bl; img.data[o+3] = 255;
      }
    }
    ctx.putImageData(img, 0, row0, 0, 0, W, bh);
    yield;
  }
}

/* — algorithm 2: multi-scale Truchet quadtree — */
function* genTruchet(ctx, W, Hh, rnd, pal){
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, Hh);
  const leaves = [];
  const stack = [[0, 0, Math.max(W, Hh), 0]];
  while (stack.length){
    const [x, y, s, depth] = stack.pop();
    if (x > W || y > Hh) continue;
    if (depth < 6 && s > 24 && rnd() < 0.78 - depth*0.075){
      const h2s = s/2;
      stack.push([x,y,h2s,depth+1], [x+h2s,y,h2s,depth+1], [x,y+h2s,h2s,depth+1], [x+h2s,y+h2s,h2s,depth+1]);
    } else leaves.push([x, y, s]);
  }
  ctx.lineCap = 'butt';
  let i = 0;
  for (const [x, y, s] of leaves){
    const ink = pal.inks[Math.floor(Math.pow(rnd(), 2.2)*pal.inks.length)];
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.9, Math.min(6, s*0.075));
    ctx.globalAlpha = 0.9;
    if (rnd() < 0.5){
      ctx.beginPath(); ctx.arc(x,     y,     s/2, 0, Math.PI/2);            ctx.stroke();
      ctx.beginPath(); ctx.arc(x+s,   y+s,   s/2, Math.PI, Math.PI*1.5);    ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x+s,   y,     s/2, Math.PI/2, Math.PI);      ctx.stroke();
      ctx.beginPath(); ctx.arc(x,     y+s,   s/2, Math.PI*1.5, Math.PI*2);  ctx.stroke();
    }
    if (rnd() < 0.045){
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = pal.inks[Math.floor(rnd()*pal.inks.length)];
      ctx.beginPath(); ctx.arc(x+s/2, y+s/2, Math.max(1.5, s*0.09), 0, Math.PI*2); ctx.fill();
    }
    if ((++i & 63) === 63) yield;
  }
  ctx.globalAlpha = 1;
}

/* — algorithm 3: relaxed-Voronoi stained glass — */
function* genVoronoi(ctx, W, Hh, rnd, pal){
  const N = 26 + Math.floor(rnd()*46);
  const sx = new Float32Array(N), sy = new Float32Array(N);
  for (let i = 0; i < N; i++){ sx[i] = rnd()*W; sy[i] = rnd()*Hh; }
  yield;
  /* two Lloyd relaxations on a quarter-res sampling grid */
  const GW = W>>2, GH = Hh>>2;
  const cx = new Float32Array(N), cy = new Float32Array(N), cn = new Float32Array(N);
  for (let it = 0; it < 2; it++){
    cx.fill(0); cy.fill(0); cn.fill(0);
    for (let gy = 0; gy < GH; gy++){
      const py = gy*4 + 2;
      for (let gx2 = 0; gx2 < GW; gx2++){
        const px = gx2*4 + 2;
        let best = 0, bd = 1e12;
        for (let i = 0; i < N; i++){
          const dx = px-sx[i], dy = py-sy[i], d = dx*dx + dy*dy;
          if (d < bd){ bd = d; best = i; }
        }
        cx[best] += px; cy[best] += py; cn[best]++;
      }
      if ((gy & 15) === 15) yield;
    }
    for (let i = 0; i < N; i++) if (cn[i] > 0){ sx[i] = cx[i]/cn[i]; sy[i] = cy[i]/cn[i]; }
  }
  const glass = [];
  const paperRgb = hexRgb(pal.paper);
  const darkGround = (paperRgb[0]+paperRgb[1]+paperRgb[2])/3 < 96;
  for (let i = 0; i < N; i++){
    const src = rnd() < 0.16 ? paperRgb : hexRgb(pal.inks[Math.floor(Math.pow(rnd(),1.3)*pal.inks.length)]);
    const br = 0.72 + rnd()*0.5;
    glass.push([src[0]*br, src[1]*br, src[2]*br]);
  }
  const lead = darkGround ? [14,11,9] : [26,22,18];
  const img = ctx.createImageData(W, 4);
  const ccx = W/2, ccy = Hh/2, maxR = Math.hypot(ccx, ccy);
  for (let row0 = 0; row0 < Hh; row0 += 4){
    const bh = Math.min(4, Hh - row0);
    for (let row = 0; row < bh; row++){
      const py = row0 + row;
      for (let px = 0; px < W; px++){
        let d1 = 1e12, d2 = 1e12, i1 = 0;
        for (let i = 0; i < N; i++){
          const dx = px-sx[i], dy = py-sy[i], d = dx*dx + dy*dy;
          if (d < d1){ d2 = d1; d1 = d; i1 = i; }
          else if (d < d2) d2 = d;
        }
        const t = Math.sqrt(d2) - Math.sqrt(d1);
        const o = (row*W + px)*4;
        if (t < 2.3){
          img.data[o] = lead[0]; img.data[o+1] = lead[1]; img.data[o+2] = lead[2];
        } else {
          const g = glass[i1];
          const glow = 0.82 + 0.30*(1 - Math.hypot(px-ccx, py-ccy)/maxR);
          const inner = 1.06 - 0.22*Math.min(1, Math.sqrt(d1)/52);
          img.data[o] = g[0]*glow*inner; img.data[o+1] = g[1]*glow*inner; img.data[o+2] = g[2]*glow*inner;
        }
        img.data[o+3] = 255;
      }
    }
    ctx.putImageData(img, 0, row0, 0, 0, W, bh);
    yield;
  }
}

/* — algorithm 4: Bauhaus / constructivist composition — */
function* genBauhaus(ctx, W, Hh, rnd, pal){
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, Hh);
  const inks = pal.inks;
  const pick = () => inks[Math.floor(Math.pow(rnd(), 1.25)*inks.length)];
  const gxs = [0.12, 0.33, 0.5, 0.67, 0.88], snap = v => (gxs[Math.floor(v*gxs.length)] + (rnd()-.5)*0.05);
  /* one dominant anchor */
  ctx.globalAlpha = 1;
  const anchor = rnd();
  if (anchor < 0.4){
    ctx.fillStyle = pick();
    const r0 = W*(0.16 + rnd()*0.15);
    ctx.beginPath(); ctx.arc(W*snap(rnd()), Hh*snap(rnd()), r0, 0, Math.PI*2); ctx.fill();
  } else if (anchor < 0.75){
    ctx.fillStyle = pick();
    const rw = W*(0.24 + rnd()*0.3), rh = Hh*(0.14 + rnd()*0.3);
    ctx.fillRect(W*snap(rnd()) - rw/2, Hh*snap(rnd()) - rh/2, rw, rh);
  } else {
    ctx.fillStyle = pick();
    const r0 = W*(0.2 + rnd()*0.2), a0 = Math.floor(rnd()*4)*Math.PI/2;
    ctx.beginPath(); ctx.moveTo(W*snap(rnd()), Hh*snap(rnd()));
    ctx.arc(W*snap(rnd()), Hh*snap(rnd()), r0, a0, a0 + Math.PI/2); ctx.closePath(); ctx.fill();
  }
  yield;
  const NS = 8 + Math.floor(rnd()*8);
  for (let s = 0; s < NS; s++){
    const kind = rnd();
    const x = W*snap(rnd()), y = Hh*snap(rnd());
    ctx.globalAlpha = rnd() < 0.25 ? 0.82 : 1;
    const prevOp = ctx.globalCompositeOperation;
    if (rnd() < 0.3) ctx.globalCompositeOperation = 'multiply';
    if (kind < 0.28){                       // bar (one may be diagonal)
      ctx.fillStyle = pick();
      const len = W*(0.2 + rnd()*0.5), th = 4 + rnd()*W*0.05;
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(s === 0 && rnd() < 0.8 ? -Math.PI/4 : (rnd() < 0.5 ? 0 : Math.PI/2));
      ctx.fillRect(-len/2, -th/2, len, th); ctx.restore();
    } else if (kind < 0.48){                // ring
      ctx.strokeStyle = pick(); ctx.lineWidth = 3 + rnd()*W*0.03;
      ctx.beginPath(); ctx.arc(x, y, W*(0.05 + rnd()*0.13), 0, Math.PI*2); ctx.stroke();
    } else if (kind < 0.66){                // disc / semicircle
      ctx.fillStyle = pick();
      const r0 = W*(0.04 + rnd()*0.1);
      ctx.beginPath();
      if (rnd() < 0.5) ctx.arc(x, y, r0, 0, Math.PI*2);
      else { const a0 = Math.floor(rnd()*4)*Math.PI/2; ctx.arc(x, y, r0, a0, a0+Math.PI); }
      ctx.fill();
    } else if (kind < 0.84){                // rule set
      ctx.strokeStyle = pick(); ctx.lineWidth = 1 + rnd()*2;
      const nL = 3 + Math.floor(rnd()*5), gap = 5 + rnd()*10, len = W*(0.14 + rnd()*0.3);
      const vert = rnd() < 0.5;
      ctx.beginPath();
      for (let li = 0; li < nL; li++){
        if (vert){ ctx.moveTo(x + li*gap, y - len/2); ctx.lineTo(x + li*gap, y + len/2); }
        else     { ctx.moveTo(x - len/2, y + li*gap); ctx.lineTo(x + len/2, y + li*gap); }
      }
      ctx.stroke();
    } else {                                // halftone dot grid
      ctx.fillStyle = pick();
      const nD = 4 + Math.floor(rnd()*4), gap = 8 + rnd()*10, r0 = 1.5 + rnd()*2.5;
      for (let dy = 0; dy < nD; dy++)
        for (let dx = 0; dx < nD; dx++){
          ctx.beginPath(); ctx.arc(x + dx*gap, y + dy*gap, r0, 0, Math.PI*2); ctx.fill();
        }
    }
    ctx.globalCompositeOperation = prevOp;
    if ((s & 1) === 1) yield;
  }
  ctx.globalAlpha = 1;
}

/* — algorithm 5: dithered ridge-line landscape — */
function* genRidge(ctx, W, Hh, rnd, pal){
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, Hh);
  const n1 = makeNoise((rnd()*4294967296)>>>0);
  const n2 = makeNoise((rnd()*4294967296)>>>0);
  const inkA = pal.inks[0], inkB = pal.inks[Math.min(1, pal.inks.length-1)];
  const horizon = Hh*(0.22 + rnd()*0.2);
  if (rnd() < 0.5){                          // a moon behind everything
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = pal.inks[Math.floor(rnd()*pal.inks.length)];
    ctx.beginPath();
    ctx.arc(W*(0.18 + rnd()*0.64), horizon*(0.45 + rnd()*0.4), W*(0.05 + rnd()*0.07), 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const rows = 24 + Math.floor(rnd()*22);
  const f = 0.006 + rnd()*0.007;
  for (let r0 = 0; r0 < rows; r0++){
    const t = r0/(rows-1);
    const yBase = horizon + Math.pow(t, 1.35)*(Hh - horizon - 6);
    const amp = 5 + Math.pow(t, 1.6)*Hh*0.17;
    ctx.beginPath();
    ctx.moveTo(-3, Hh + 3);
    for (let x = -3; x <= W + 3; x += 3){
      const nv = n1(x*f, r0*7.31)*0.68 + n2(x*f*2.43, r0*3.17)*0.32;
      const y = yBase - Math.pow(Math.abs(nv), 1.35)*amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 3, Hh + 3);
    ctx.closePath();
    ctx.fillStyle = pal.paper; ctx.globalAlpha = 0.96; ctx.fill();
    ctx.globalAlpha = 0.35 + t*0.6;
    ctx.strokeStyle = t > 0.8 ? inkB : inkA;
    ctx.lineWidth = 0.8 + t*1.1;
    ctx.stroke();
    /* sparse dither on the forward slope */
    const nD = Math.floor(t*26*rnd());
    ctx.fillStyle = inkA; ctx.globalAlpha = 0.5;
    for (let k = 0; k < nD; k++){
      const dx2 = rnd()*W;
      const nv = n1(dx2*f, r0*7.31)*0.68 + n2(dx2*f*2.43, r0*3.17)*0.32;
      const yy = yBase - Math.pow(Math.abs(nv), 1.35)*amp + 1.5 + rnd()*5;
      ctx.fillRect(dx2, yy, 1.1, 1.1);
    }
    ctx.globalAlpha = 1;
    yield;
  }
}

export const ALGOS = [genFlowField, genAttractor, genTruchet, genVoronoi, genBauhaus, genRidge];

/* unified finishing pass: vignette + paper grain (one static tile) */
let grainPattern = null;
/** Context-loss safety: drop the cached Canvas2D pattern. */
export function resetGrain(){ grainPattern = null; }
export function ensureGrain(ctx){
  if (grainPattern) return grainPattern;
  const gc = document.createElement('canvas'); gc.width = gc.height = 96;
  const gx = gc.getContext('2d');
  const gr = mulberry32(0xBADA55);
  const gi = gx.createImageData(96, 96);
  for (let i = 0; i < 96*96; i++){
    const v = 108 + gr()*40;
    gi.data[i*4] = gi.data[i*4+1] = gi.data[i*4+2] = v; gi.data[i*4+3] = 255;
  }
  gx.putImageData(gi, 0, 0);
  grainPattern = ctx.createPattern(gc, 'repeat');
  return grainPattern;
}
export function finishArt(ctx, W, Hh){
  const g = ctx.createRadialGradient(W/2, Hh/2, Math.min(W,Hh)*0.44, W/2, Hh/2, Math.max(W,Hh)*0.76);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,8,5,0.17)');
  ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16; ctx.fillStyle = ensureGrain(ctx); ctx.fillRect(0, 0, W, Hh);
  ctx.globalCompositeOperation = prevOp; ctx.globalAlpha = 1;
}

