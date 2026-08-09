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
import { cloud, setFetch, cloudSaveSess, cloudSendCode, cloudVerify, cloudPublicURL,
         cloudUploadBlob, cloudDeleteUpload, cloudSetPlacement, cloudDelPlacement,
         cloudClaimSlug, cloudSetPublished, cloudLoadMine, cloudLoadGallery, cloudBoot } from './cloud/client.js';
import { SCHEMES, buildRoomMesh, assembleLights } from './world/geometry.js';
import { canvas, gl, compile, program } from './render/gl.js';
import { PERF, dprCap } from './render/perf.js';
import { post, postCaps, wantSamples, setForcedSamples, allocPost, runPost,
         setPostPrograms, uBright, uBlur, uComp } from './render/post.js';
import { plasterTex, parquetTex, shadowTex, skyTex, makeSurfaceTextures,
         ensureSkyTex, dropSurfaceTextures } from './render/textures.js';
import { player, M_P, M_V, M_MV, M_PV, vpW, vpH, setViewport,
         visited, setVisited, nearRooms, midRooms } from './render/state.js';
import { setLoanProvider, releaseSlot, freeAllArtSlots, preemptArtJobs, artJobKey,
         syncArtJobs, pumpArt, updateHudStat, markSeen, paintBasis, makeRoomVAO,
         dropRoomGL, TEX_SIZES, POOLS, PPOOL, scratch, sctx, pscratch, pctx,
         artState, PB, SHA } from './art/scheduler.js';

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

/* ————— §4 GL core ————— */

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

  const pBright = program(VS_POST, FS_BRIGHT);
  const pBlur   = program(VS_POST, FS_BLUR);
  const pComp   = program(VS_POST, FS_COMP);
  setPostPrograms(pBright, pBlur, pComp);
  uBright.uTex = gl.getUniformLocation(pBright, 'uTex');
  uBlur.uTex = gl.getUniformLocation(pBlur, 'uTex');
  uBlur.uDir = gl.getUniformLocation(pBlur, 'uDir');
  for (const nm of ['uTex','uBloom','uTime','uRes'])
    uComp[nm] = gl.getUniformLocation(pComp, nm);

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


/* The scheduler must know whether a private loan hangs on a frame, but it
   has no business knowing what a curator is. The Curator's Office registers
   itself here at boot; without one — the archive build, or a guest view —
   the scheduler simply hangs the seeded work. */
/* ————— §7 Renderer state / floating origin ————— */

function resize(){
  const dpr = Math.min(devicePixelRatio || 1, dprCap());
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (w !== vpW || h !== vpH){
    setViewport(w, h);
    canvas.width = w; canvas.height = h;
  }
}
addEventListener('resize', resize);

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
/** Put the visitor at the centre of a room, facing `yaw`, and rebuild around them. */
function goToRoom(gx, gz, yaw = 0){
  player.gx = gx | 0; player.gz = gz | 0;
  player.x = 0; player.z = 0; player.yaw = yaw; player.pitch = 0;
  player.vx = player.vz = 0;
  onRoomChanged();
}

/* Which way to look to face a given wall from the middle of a room.
   Forward is (sin yaw, −cos yaw), so south — the −z wall — is yaw 0. */
const YAW_FACING = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

/** Drop the visitor in front of the nearest hung work. Returns false if the
 *  collection is empty.
 *
 *  A shared gallery's works hang wherever the curator happened to walk — which
 *  can be a dozen rooms out in an infinite museum. Spawning a guest at the
 *  origin and wishing them luck is not showing them anything: they see
 *  generated art, assume that is all there is, and leave. */
function spawnAtCollection(placements){
  let best = null;
  for (const k of placements.keys()){
    const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(k);
    if (!m) continue;
    const gx = +m[1], gz = +m[2];
    const d = Math.max(Math.abs(gx), Math.abs(gz));   // rooms walked, not metres
    if (!best || d < best.d) best = { gx, gz, i: +m[3], d };
  }
  if (!best) return false;
  const A = getRoom(best.gx, best.gz).artworks[best.i];
  goToRoom(best.gx, best.gz, A ? (YAW_FACING[A.wall] ?? 0) : 0);
  return true;
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
      if (!r.vao) makeRoomVAO(r, WIN.on);
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

/* Drop every held key and any in-progress drag. Anything that steals focus —
   the Curator's Office, a modal — calls this rather than reaching in and
   assigning `dragging` itself, which is how a walk key stayed stuck down
   behind an open panel. */
function releaseInput(){ keys.clear(); dragging = false; }

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
  /* Reserve the plate at the work's true proportions before anything is drawn.
     The frame is width:fit-content around an <img> with no src, so it used to
     collapse to a ~50px square and then snap to full size — a layout jump at
     the moment the interaction is meant to feel considered. */
  const [bw, bh] = BIG_SIZES[A.asp];
  const shot = modal.querySelector('img');
  shot.removeAttribute('src');
  shot.style.aspectRatio = `${bw} / ${bh}`;
  modal.hidden = false;
  runAcquire(A, bw, bh, year);
}

/* Yield to the browser, but never stall on rAF alone: it is paused entirely in
   a background tab, so an rAF-only wait would leave a half-rendered plate
   hanging until the visitor came back. Whichever fires first wins. */
function nextTick(){
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done){ done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, 32);
  });
}

/* Render the acquire-resolution copy across frames instead of in one blocking
   pass. The generators already yield; the old path drained them with
   `while (!gen.next().done){}` at four times the pooled pixel count, which
   froze the tab for one to two seconds — the render loop stopped, the audio
   kept droning, and even the status line could not animate. */
async function runAcquire(A, bw, bh, year){
  const modal = document.getElementById('modal');
  const cap = modal.querySelector('.cap .m');
  preemptArtJobs();
  acqCanvas.width = bw; acqCanvas.height = bh;

  const loanRec = A.overrideKey && curator.uploads.get(curator.placements.get(A.overrideKey));
  if (loanRec){
    const bmp = loanRec.bmp || (loanRec.bmp = await createImageBitmap(loanRec.blob));
    const s = Math.max(bw/bmp.width, bh/bmp.height);
    acqCtx.drawImage(bmp, (bw - bmp.width*s)/2, (bh - bmp.height*s)/2, bmp.width*s, bmp.height*s);
  } else {
    const rnd = mulberry32(A.seed);
    const gen = ALGOS[A.algo % ALGOS.length](acqCtx, bw, bh, rnd, jitterPal(A.pal, rnd));
    let slices = 0;
    for (;;){
      const t0 = performance.now();
      let done = false;
      /* A generous slice, then hand the thread back. The museum is behind a
         modal here, so it does not need sixty frames a second — it needs to
         not be frozen. Too small a budget and Fractured Glass at 1024², the
         most expensive of the six, takes twenty seconds to resolve. */
      while (performance.now() - t0 < 24){ if (gen.next().done){ done = true; break; } }
      if (done) break;
      cap.textContent = 'the gallery is committing it to memory' + '.'.repeat(1 + (slices++ >> 1) % 3);
      if (modal.hidden) return;                       // dismissed mid-render
      await nextTick();
    }
    finishArt(acqCtx, bw, bh);
  }

  acqCanvas.toBlob((blob) => {
    if (!blob || modal.hidden) return;
    if (modalURL) URL.revokeObjectURL(modalURL);
    modalURL = URL.createObjectURL(blob);
    modal.querySelector('img').src = modalURL;
    cap.textContent = loanRec
      ? 'private loan · the curator’s collection'
      : `${ALGO_NAMES[A.algo % ALGOS.length]}, ${year} · acquired, 1 of 1`;
    const save = document.getElementById('modal-save');
    save.hidden = false;
    save.dataset.name =
      `lumiere_${(A.title||'untitled').toLowerCase().replace(/[^a-z0-9]+/g,'-')}_${A.seed}.png`;
    persist.acquired++; savePersist();
  }, 'image/png');
}

/* Saving is a deliberate act. This used to fire a synthetic <a download> the
   moment the render finished — and E sits next to W in the walk cluster, so a
   mis-keypress while moving wrote a PNG to the visitor's disk with no prompt,
   no setting and no undo. */
document.getElementById('modal-save').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!modalURL) return;
  const a = document.createElement('a');
  a.href = modalURL;
  a.download = e.currentTarget.dataset.name || 'lumiere.png';
  document.body.appendChild(a); a.click(); a.remove();
  flashHint('saved to your downloads');
});
document.getElementById('modal').addEventListener('click', () => {
  const modal = document.getElementById('modal');
  modal.hidden = true;
  document.getElementById('modal-save').hidden = true;
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
  if (rec.cloudRec && cloud.sess)
    reportWrite(cloudDeleteUpload(rec), 'the cloud kept its copy — the work returns on reload');
  else if (curator.db){
    try { curator.db.transaction('images', 'readwrite').objectStore('images').delete(id); } catch(e){}
  }
  if (curator.sel === id) curator.sel = null;
  savePlacements();
  curatorGrid();
}
function curatorClearPlacement(k){
  curator.placements.delete(k);
  if (cloud.sess && !cloud.viewing)
    reportWrite(cloudDelPlacement(k), 'the cloud still holds that hanging — it returns on reload');
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
  if (cloud.sess && !cloud.viewing)
    reportWrite(cloudSetPlacement(k, curator.sel), 'cloud did not answer — the hang is local for now');
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
      /* Claiming a name reserves it; publishing is what actually lets anyone
         else in. Until then the RLS policies hide the collection and the slug
         does not resolve, so the link is yours alone. */
      const pub = document.getElementById('cur-publish');
      pub.hidden = !cloud.slug;
      pub.classList.toggle('on', !!cloud.published);
      pub.textContent = cloud.published ? 'anyone with the link can walk it'
                                        : 'private — only you can see it';
      document.getElementById('cur-share-link').textContent =
        !cloud.slug ? 'claim a name, then decide who can see it'
        : cloud.published ? 'share: ' + location.origin + location.pathname + '?gallery=' + cloud.slug
        : 'not published yet — the link will not open for anyone else';
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
    releaseInput(); inspectOff();
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
      await loadMyCollection();
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
  document.getElementById('cur-publish').addEventListener('click', async () => {
    if (!cloud.sess || !cloud.slug) return;
    const next = !cloud.published;
    try {
      await cloudSetPublished(next);
      curatorRefresh();
      flashHint(next ? 'published — anyone with the link can walk your gallery'
                     : 'unpublished — the gallery is yours alone again');
    } catch(e){ flashHint(String(e.message || e)); }
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


/* cfetch resolves on HTTP errors rather than rejecting, so a write the server
   turned down used to disappear into an empty catch and leave the local Map
   quietly disagreeing with the database until the next reload. Say so. */
function reportWrite(promise, msg){
  promise.then((r) => { if (!r || !r.ok) flashHint(msg); })
         .catch(() => flashHint(msg));
}

/* The Curator's Office answering the scheduler's loan questions. Registered
   rather than imported, so the scheduler stays ignorant of it. */
setLoanProvider({
  releaseOutside(gx, gz, radius){
    for (const [k, o] of curator.overrides)
      if (Math.max(Math.abs(o.r.gx - gx), Math.abs(o.r.gz - gz)) > radius){
        gl.deleteTexture(o.tex);
        o.A.override = null;               // reapplied from the blob on return
        curator.overrides.delete(k);
      }
  },
  apply(r, A, i, k){
    if (!curator.placements.has(k)) return false;
    applyPlacement(r, A, i);
    return true;
  },
});

/* ————— cloud adapters —————
   The cloud module returns data; this is where it becomes state. Keeping the
   direction one-way — network → here → UI, never the reverse — is what lets
   an archived copy with no backend still run: the seeded gallery does not
   depend on any of this. */
function applyCloudUploads(list){
  for (const rec of list) if (!curator.uploads.has(rec.id)) curator.uploads.set(rec.id, rec);
}
function applyCloudPlacements(pairs){
  for (const [k, id] of pairs) curator.placements.set(k, id);
}
async function loadMyCollection(){
  const data = await cloudLoadMine();
  if (!data) return;
  applyCloudUploads(data.uploads);
  applyCloudPlacements(data.placements);
  syncArtJobs();
}
async function bootCloud(){
  const { mode, data } = await cloudBoot();
  if (mode === 'off') return;
  if (mode === 'guest'){
    curator.placements.clear();            // a guest sees only their host's hanging
    applyCloudUploads(data.uploads);
    applyCloudPlacements(data.placements);
    updateHudStat();
    /* Stand them in front of the work rather than at the origin. */
    const placed = spawnAtCollection(curator.placements);
    flashHint(placed
      ? 'you are walking <b>' + data.slug + '</b>’s gallery — their first work hangs before you'
      : '<b>' + data.slug + '</b> has not hung anything yet');
    syncArtJobs();
  } else if (mode === 'missing'){
    flashHint('no gallery answers to that name');
  } else if (mode === 'unreachable'){
    /* Not the same as 'missing'. The seeded museum is entirely local, so this
       is worth saying plainly rather than pretending the gallery is empty. */
    flashHint('the collection is offline — the seeded gallery is all yours tonight');
  } else if (mode === 'mine' && data){
    applyCloudUploads(data.uploads);
    applyCloudPlacements(data.placements);
    syncArtJobs();
  }
  curatorRefresh();
}

/* ————— frame loop ————— */
let lastT = 0, frameCount = 0, fpsAcc = 0, fpsAvg = 0;
let probeRequest = null, rafId = 0, forceDt = null;
const probeBuf = new Uint8Array(32*32*4);

let acqModalEl = null;
const acqModalHidden = () =>
  (acqModalEl || (acqModalEl = document.getElementById('modal'))).hidden;

function frame(t){
  if (!gl) return;
  if (gl.isContextLost()){
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    return;
  }
  resize();

  /* The acquire plate is a full-bleed opaque overlay, so everything below is
     drawing a museum nobody can see — while the acquire-resolution render is
     competing for the same thread. Keep the loop alive, skip the work. Worth
     about half the wall time of an acquire, and it is free. */
  if (!acqModalHidden()){
    lastT = t;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    return;
  }

  const dt = forceDt !== null ? forceDt : Math.min(50, t - lastT) / 1000;
  lastT = t;
  frameCount++; fpsAcc += dt;
  if (fpsAcc > 0.5){
    fpsAvg = frameCount / fpsAcc; frameCount = 0; fpsAcc = 0;
    /* trade pixels for smoothness on machines that need it */
    if (entered && forceDt === null && !PERF.pinned && fpsAvg < 42 && PERF.q > 0 &&
        t - PERF.lastDrop > 5000){
      PERF.q--; PERF.lastDrop = t;
      trace(`[perf] frame rate ${fpsAvg.toFixed(0)} — easing quality to tier ${PERF.q}`);
    }
  }

  if (entered) step(dt);

  const usePost = post.on;
  if (usePost){
    if (!post.ready) allocPost(vpW, vpH);
    else if (vpW !== post.w || vpH !== post.h){
      if (!post.pendingAt) post.pendingAt = performance.now();
      if (performance.now() - post.pendingAt > 200){ allocPost(vpW, vpH); post.pendingAt = 0; }
    } else if (post.samples !== wantSamples()){
      allocPost(vpW, vpH);   // the quality tier moved; rebuild at the new sample count
      post.pendingAt = 0;
    } else post.pendingAt = 0;
    /* Draw into the multisampled target when there is one; runPost resolves it
       into texScene before sampling. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboMS || post.fboScene);
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
  if (usePost) runPost(quadVAO);
  pumpArt(entered ? 3.5 : 9);

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
  /* Render at ACQUIRE resolution and report band luminance top to bottom.
     artHash renders at pool size, which is exactly why it never caught the
     attractor accumulator overflow: the fault only appears above 512², where
     the tail of the image went solid black. Any band reading ~0 while others
     do not means the buffer ran out again. */
  acquireBands(gx, gz, i, bands = 4){
    preemptArtJobs();
    const r = getRoom(gx, gz), A = r.artworks[i];
    if (!A) return null;
    const [w, h] = BIG_SIZES[A.asp];
    acqCanvas.width = w; acqCanvas.height = h;
    const rnd = mulberry32(A.seed);
    const gen = ALGOS[A.algo % ALGOS.length](acqCtx, w, h, rnd, jitterPal(A.pal, rnd));
    while (!gen.next().done){}
    finishArt(acqCtx, w, h);
    const d = acqCtx.getImageData(0, 0, w, h).data;
    const out = [];
    for (let b = 0; b < bands; b++){
      const y0 = Math.floor(h * b / bands), y1 = Math.floor(h * (b + 1) / bands);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += 4) for (let x = 0; x < w; x += 4){
        const o = (y * w + x) * 4;
        sum += 0.2126*d[o] + 0.7152*d[o+1] + 0.0722*d[o+2]; n++;
      }
      out.push(+(sum / n).toFixed(2));
    }
    return { algo: A.algo % ALGOS.length, w, h, bands: out };
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
  cloudState(){ return { on: cloud.on, signedIn: !!cloud.sess, viewing: cloud.viewing, slug: cloud.slug }; },
};

/* The rest of the debug surface exists for the dev harness and the test
   suite. DBG_FULL is a build-time constant: archive builds define it false
   and esbuild drops this whole block, which is what keeps that artifact
   under the 100 KiB free-upload threshold. See docs/permanence.md. */
if (DBG_FULL) Object.assign(window.DBG, {
  tp(gx, gz, yaw = 0){
    goToRoom(gx, gz, yaw);
    return `room (${player.gx},${player.gz}) yaw=${yaw}`;
  },
  /** Register a placement without a backend, so guest arrival is testable. */
  placeForTest(k, uploadId){ curator.placements.set(k, uploadId); return curator.placements.size; },
  /** Where a guest would be dropped — {gx,gz} or null for an empty collection. */
  collectionSpawn(){
    const before = [player.gx, player.gz];
    const found = spawnAtCollection(curator.placements);
    const at = found ? { gx: player.gx, gz: player.gz, yaw: player.yaw } : null;
    if (!found) goToRoom(before[0], before[1]);
    return at;
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
    setVisited(new Set([roomKey(player.gx, player.gz)]));
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
  post(on = true){ post.on = !!on; return 'post ' + (post.on ? 'on' : 'off'); },
  cloudConfig(url, key){
    try {
      if (!url) localStorage.removeItem('lumiere_cloud');
      else localStorage.setItem('lumiere_cloud', JSON.stringify({ url, key }));
    } catch(e){ return 'storage unavailable'; }
    location.reload();
  },
  /* Cloud test seams. The layer returns data instead of writing into the UI,
     so it can be driven against a stubbed transport with no live project.
     Pass null to cloudFetch to restore the real one. */
  /* What the scene buffer actually is, so the renderer's claims are checkable
     rather than assumed — antialias:true was silently doing nothing for months. */
  postInfo(){
    return { on: post.on, ready: post.ready, hdr: post.hdr, samples: post.samples,
             w: post.w, h: post.h, q: PERF.q, caps: postCaps() };
  },
  /** Pin the MSAA sample count (null restores tier control), for A/B tests. */
  samples(n){ setForcedSamples(n); allocPost(vpW, vpH); return DBG.postInfo(); },
  cloudFetch(fn){ setFetch(fn); return { stubbed: !!fn }; },
  cloudLoadGallery(slug){ return cloudLoadGallery(slug); },
});

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
  dropSurfaceTextures();
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
  /* Booting with no network used to throw an unhandled rejection here and
     leave the Curator's Office in its default state, because curatorRefresh()
     sat past the throw. The gallery itself needs nothing from the network. */
  curatorBoot()
    .then(bootCloud)
    .catch((e) => {
      console.warn('[boot] cloud unreachable — the seeded gallery is unaffected', e);
      curatorRefresh();
    });
  requestAnimationFrame((t)=>{ lastT = t; requestAnimationFrame(frame); });
}
document.getElementById('sw-lights').addEventListener('click', () => setLights(!lightsOn));
document.getElementById('sw-shutters').addEventListener('click', () => setShutters(!WIN.on));
document.getElementById('sw-curator').addEventListener('click', () => curatorToggle());
