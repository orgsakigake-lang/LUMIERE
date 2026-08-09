/* ═══════════════════════════════════════════════════════════════════
   Texture pools and the cooperative art scheduler.
   Generators are pumped under a per-frame time budget the caller sets,
   one GPU upload per frame, into a fixed pool of immutable textures that
   are released as the visitor walks away.
   Also owns room VAOs, since they share the same GL lifetime.
   ═══════════════════════════════════════════════════════════════════ */
import { S, HS, WT, trace } from '../config.js';
import { h2, mulberry32, WORLD_SEED } from '../world/seed.js';
import { rooms, roomKey } from '../world/rooms.js';
import { buildRoomMesh, assembleLights } from '../world/geometry.js';
import { jitterPal } from './palettes.js';
import { ALGO_NAMES, ALGOS, makeTitle, finishArt } from './algos.js';
import { persist, savePersist } from '../persist.js';
import { cloud } from '../cloud/client.js';
import { canvas, gl } from '../render/gl.js';
import { player, visited } from '../render/state.js';

let loans = null;
export function setLoanProvider(p){ loans = p; }

export const TEX_SIZES = { L: [512, 384], P: [384, 512], S: [448, 448], W: [512, 320] };
function makePool(n, w, h){
  return { w, h, slots: Array.from({length: n}, () => ({ tex: null, used: false, A: null, r: null })) };
}
export const POOLS = { L: makePool(24,512,384), P: makePool(24,384,512), S: makePool(24,448,448), W: makePool(24,512,320) };
export const PPOOL = makePool(64, 256, 128);
function acquireSlot(pool, A, r){
  for (const s of pool.slots){
    if (s.used) continue;
    if (!s.tex){
      s.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      const levels = Math.floor(Math.log2(Math.max(pool.w, pool.h))) + 1;
      /* Artwork is colour, authored in sRGB by Canvas2D. */
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, pool.w, pool.h);
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
export function releaseSlot(s){
  if (s.A){ if (s.A.tex === s) s.A.tex = null; if (s.A.ptex === s) s.A.ptex = null; }
  s.used = false; s.A = null; s.r = null;
}
export function releaseOutside(){
  for (const pool of [POOLS.L, POOLS.P, POOLS.S, POOLS.W, PPOOL])
    for (const s of pool.slots)
      if (s.used && s.r &&
          Math.max(Math.abs(s.r.gx - player.gx), Math.abs(s.r.gz - player.gz)) > 1)
        releaseSlot(s);
  if (loans) loans.releaseOutside(player.gx, player.gz, 1);
}
export function freeAllArtSlots(){
  for (const pool of [POOLS.L, POOLS.P, POOLS.S, POOLS.W, PPOOL])
    for (const s of pool.slots) releaseSlot(s);
}

/* scratch canvases (one for paintings, one for placards) */
/* willReadFrequently keeps these CPU-side: stroke raster then lands inside
   the budgeted generator slices instead of one giant flush at upload time */
export const scratch = document.createElement('canvas');
export const sctx = scratch.getContext('2d', { alpha: false, willReadFrequently: true });
export const pscratch = document.createElement('canvas');
pscratch.width = 256; pscratch.height = 128;
export const pctx = pscratch.getContext('2d', { alpha: false, willReadFrequently: true });

export const artState = { jobs: new Map(), queue: [], active: null, uploadReady: null,
                   placards: [], beheld: 0 };
/* park in-flight jobs (they restart cleanly from their seeds) before anything
   else borrows the scratch canvas or the shared attractor accumulator */
export function preemptArtJobs(){
  for (const j of [artState.active, artState.uploadReady]){
    if (!j) continue;
    if (j.slot) releaseSlot(j.slot);
    j.slot = null; j.gen = null; j.ms = 0;
    artState.queue.unshift(j);
  }
  artState.active = null; artState.uploadReady = null;
}
export function artJobKey(r, i){ return r.gx + ',' + r.gz + ':' + i; }

export function syncArtJobs(){
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
        if (loans && loans.apply(r, A, i, k)) return;   // a private loan hangs here
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

export function pumpArt(budgetMs = 3.5){
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
  const deadline = performance.now() + budgetMs;
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

export function updateHudStat(){
  const el = document.getElementById('hud-stat');
  const guest = (typeof cloud !== 'undefined' && cloud.viewing) ? `guest of ${cloud.viewing.slug} · ` : '';
  el.textContent = `${guest}${visited.size} room${visited.size===1?'':'s'} · ${artState.beheld} work${artState.beheld===1?'':'s'}`;
}
export function markSeen(){
  const r = rooms.get(roomKey(player.gx, player.gz));
  if (!r) return;
  let ch = false;
  for (const A of r.artworks)
    if (A.tex && !A.seen){ A.seen = true; artState.beheld++; persist.works = (persist.works|0) + 1; ch = true; }
  if (ch){ updateHudStat(); savePersist(); }
}

/* per-wall painting frame: origin corner + right/up spans (viewer-correct) */
export function paintBasis(A, out, PD = 0.028){
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
export const PB = { o:[0,0,0], u:[0,0,0], v:[0,0,0], n:[0,0,0], pwallC:0 };
export const SHA = { wall:'e', u:0, w:1, h:1, hangY:1.55 };   // scratch for shadow quads

/* adaptive quality: 2 full · 1 lighter DPR · 0 low DPR, no reflections */

export function makeRoomVAO(r, daylight){
  const mesh = buildRoomMesh(r, daylight);
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
  assembleLights(r, daylight);
  trace(`[world] built room (${r.gx},${r.gz}) seed=${r.seed}`);
}
export function dropRoomGL(r){
  if (r.vao){ gl.deleteVertexArray(r.vao); gl.deleteBuffer(r.vbo); gl.deleteBuffer(r.ibo); }
  if (r.flameVAO){ gl.deleteVertexArray(r.flameVAO); gl.deleteBuffer(r.flameVBO); }
  r.vao = r.vbo = r.ibo = null; r.nIdx = 0;
  r.flameVAO = r.flameVBO = null; r.nFlames = 0;
}

