/* ═══════════════════════════════════════════════════════════════════
   LUMIÈRE — The Endless Gallery
   WebGL2 + Canvas2D + WebAudio. No runtime dependencies.
   Authored as modules; esbuild inlines them into one index.html.
   Everything derives from seeds; nothing from timing.
   ═══════════════════════════════════════════════════════════════════ */

import { S, HS, H, WT, DOORW, DOORH, EYE, PR, DOOR_P, FOG_SIGMA, DAY_SIGMA,
         setSigma, FOG,
         BUILD_R, EVICT_R, DPR_CAP, REDUCED, DEV, trace,
         CLOUD_URL, CLOUD_KEY } from './config.js';
import { h2, mulberry32, SALT_EX, SALT_EY, SALT_ROOM, SALT_ART, SALT_WIN,
         WORLD_SEED, setWorldSeed, edgeOpenX, edgeOpenZ } from './world/seed.js';
import { PALETTES, jitterPal } from './art/palettes.js';
import { ALGO_NAMES, ALGOS, makeTitle, finishArt, resetGrain,
         paintArt, scoreArt } from './art/algos.js';
import { mat4, perspective, mulM, mulT, viewMatrix, extractPlanes, boxVisible } from './render/mat4.js';
import { storageOK, persist, savePersist } from './persist.js';
import { flashHint, toggleLegend } from './ui/hint.js';
import { audio, initAudio, bell, footstep, toggleMute, setAudioActive,
         cycleMusic, musicName, setMusic, PIECES } from './audio.js';
import { SPECIAL, rooms, roomKey, getRoom, spotAt, specialAt, RIG } from './world/rooms.js';
import { THEMES, THEME_ORDER, DEFAULT_THEME, theme, themeName, setThemeName,
         nextThemeName } from './world/themes.js';
import { cloud, setFetch, cloudSaveSess, cloudSendCode, cloudVerify, cloudPublicURL,
         cloudPassword, cloudSignUp, cloudAuthSettings,
         cloudUploadBlob, cloudDeleteUpload, cloudUpdateUpload, cloudSetPlacement, cloudDelPlacement,
         cloudClaimSlug, cloudSetPublished, cloudLoadMine, cloudLoadGallery, cloudBoot } from './cloud/client.js';
import { SCHEMES, applyScheme, buildRoomMesh, assembleLights, MAX_LIGHTS } from './world/geometry.js';
import { canvas, gl, compile, program } from './render/gl.js';
import { PERF, dprCap } from './render/perf.js';
import { post, postCaps, wantSamples, setForcedSamples, allocPost, runPost,
         setPostPrograms, setPostTime, uBright, uBlur, uComp, GRADE } from './render/post.js';
import { plasterTex, parquetTex, plasterNrm, parquetNrm, shadowTex, skyTex, makeSurfaceTextures,
         ensureSkyTex, dropSurfaceTextures } from './render/textures.js';
import { player, M_P, M_V, M_MV, M_PV, vpW, vpH, setViewport,
         visited, setVisited, nearRooms, midRooms } from './render/state.js';
import { setLoanProvider, setShadowProgram, releaseSlot, freeAllArtSlots, discardPainted, preemptArtJobs, artJobKey,
         syncArtJobs, pumpArt, updateHudStat, markSeen, paintBasis, makeRoomVAO,
         dropRoomGL, TEX_SIZES, LOAN_SIZES, POOLS, PPOOL, scratch, sctx, pscratch, pctx,
         artState, PB, SHA } from './art/scheduler.js';

import VS_SHADOW from './render/shaders/shadow.vert';
import FS_SHADOW from './render/shaders/shadow.frag';
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
    shadow:gl.getUniformLocation(progArch, 'uShadow'),
    shadowMat:gl.getUniformLocation(progArch, 'uShadowMat'),
    shadowIdx:gl.getUniformLocation(progArch, 'uShadowIdx'),
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
  gl.uniform1i(gl.getUniformLocation(progArch, 'uShadow'), 3);   // per-room baked map
  gl.uniform1i(gl.getUniformLocation(progArch, 'uPlasterN'), 4);
  gl.uniform1i(gl.getUniformLocation(progArch, 'uParquetN'), 5);
  makeSurfaceTextures();
  progPaint = program(VS_PAINT, FS_PAINT);
  uPaint = {};
  for (const nm of ['uMV','uP','uO','uU','uV','uN','uTex','uFog','uSigma','uFade','uEm','uGlaze','uAT','uNL','uLPos','uLDir','uLCol'])
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
  /* The depth-only pass that bakes each room's shadow map. */
  setShadowProgram(program(VS_SHADOW, FS_SHADOW));

  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  /* A wall of pictures is seen at a grazing angle more often than head-on, and
     a pencil line at a grazing angle is precisely what this filter is for. The
     cap was 4 where hardware offers 16. */
  if (aniso) window.__aniso = { ext: aniso, max: Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) };

  const pBright = program(VS_POST, FS_BRIGHT);
  const pBlur   = program(VS_POST, FS_BLUR);
  const pComp   = program(VS_POST, FS_COMP);
  setPostPrograms(pBright, pBlur, pComp);
  uBright.uTex = gl.getUniformLocation(pBright, 'uTex');
  uBlur.uTex = gl.getUniformLocation(pBlur, 'uTex');
  uBlur.uDir = gl.getUniformLocation(pBlur, 'uDir');
  for (const nm of ['uTex','uBloom','uTime','uRes','uExposure','uGrain',
                    'uShadowTint','uLightTint','uVignette'])
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
  gl.texStorage2D(gl.TEXTURE_2D, 8, gl.SRGB8_ALPHA8, 256, 128);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pscratch);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
/* Stand-in for bounced light. It was near-useless while fog set the black point
   — scaling it to 12% moved the frame mean by one code value — so it had been
   tuned down to nothing. With FOG_SIGMA honest it is the lever that lifts the
   ceiling and the dark end of the histogram without flooding the floor, which
   is exactly what real bounce does. */
const AMB_BASE = [0.090, 0.081, 0.067];
/* Lamps off is not lights out. The switch used to drop every light but the sun,
   which left 95% of the night frame under 9/255 — and uniform ambient could not
   rescue it: four times the ambient moved the median from 6 to 10 and only
   greyed the room flat, because ambient has no direction and makes no
   highlights. A closed museum still has low night lighting, and LUMIÈRE already
   draws the candle flames on its chandeliers with the lamps off. So the switch
   now takes the picture lights — which is what makes a gallery read as closed —
   and leaves the room's fill burning at a candle's share, shifted much warmer
   than the electric fixture it replaces. */
const CANDLE = [0.55, 0.399, 0.234];
/* Lights are packed into view space, so the result is good for exactly one
   frame — but it was being recomputed for every pass that drew the room, up to
   68 times a frame for at most 25 distinct answers. Each room now keeps its own
   packed arrays and a serial; the frame loop bumps the serial once. */
let packSerial = 1;
function packLights(r, ox, oz, force){
  if (!force && r.packSerial === packSerial) return r.packN;
  if (!r.lpos){
    r.lpos = new Float32Array(MAX_LIGHTS*4);
    r.ldir = new Float32Array(MAX_LIGHTS*4);
    r.lcol = new Float32Array(MAX_LIGHTS*4);
  }
  const LPOS = r.lpos, LDIR = r.ldir, LCOL = r.lcol;
  const list = r.lights; let n = 0;
  r.packFillIdx = -1;
  for (let i = 0; i < list.length && n < MAX_LIGHTS; i++){
    const l = list[i];
    if (l.off) continue;                       // a frame with nothing in it
    if (!lightsOn && !l.sun && !l.fill) continue;
    const dim = !lightsOn && l.fill;
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
    LCOL[b]   = dim ? l.col[0]*CANDLE[0] : l.col[0];
    LCOL[b+1] = dim ? l.col[1]*CANDLE[1] : l.col[1];
    LCOL[b+2] = dim ? l.col[2]*CANDLE[2] : l.col[2];
    LCOL[b+3] = l.inner;
    /* The baked map was rendered from this room's own fill light; a neighbour's
       spilling through a doorway is a different light and must not use it. */
    if (l.fill && !l.spill && r.packFillIdx < 0) r.packFillIdx = n;
    n++;
  }
  if (!force){ r.packSerial = packSerial; r.packN = n; }
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
const DAY_FOG = [0.0876, 0.0804, 0.0678];   // see FOG in config.js — same re-tune
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
/* ————— the wing —————
   A curator hangs works wherever they happen to be standing, which in an
   infinite museum can be a dozen halls apart. That is fine for the person who
   walked there and hopeless for a visitor: they arrive in front of one drawing
   with no way to know the rest exist, and in a solo theme the halls between
   are empty and dark. So a collection can be *gathered* — laid out along a
   short walk through adjoining rooms, in the order the works were added.

   The route is a ring spiral from the wing's own room outward, and it only
   steps to rooms the previous one actually opens onto: a wing you cannot walk
   without passing through a wall is not a wing. */
const WING_ORIGIN = [0, 0];
function wingRoute(need){
  const seen = new Set([roomKey(WING_ORIGIN[0], WING_ORIGIN[1])]);
  const route = [{ gx: WING_ORIGIN[0], gz: WING_ORIGIN[1] }];
  let capacity = getRoom(WING_ORIGIN[0], WING_ORIGIN[1]).artworks.length;
  const DIRS = [['e',1,0], ['n',0,1], ['w',-1,0], ['s',0,-1]];
  for (let i = 0; i < route.length && capacity < need && route.length < 40; i++){
    const { gx, gz } = route[i];
    const r = getRoom(gx, gz);
    for (const [wall, dx, dz] of DIRS){
      if (capacity >= need) break;
      if (!r.doors[wall]) continue;                 // must be walkable
      const k = roomKey(gx + dx, gz + dz);
      if (seen.has(k)) continue;
      seen.add(k);
      route.push({ gx: gx + dx, gz: gz + dz });
      capacity += getRoom(gx + dx, gz + dz).artworks.length;
    }
  }
  return route;
}
/** Hang the whole collection along that route, in order. Returns what it did. */
function gatherIntoWing(){
  const works = [...curator.uploads.keys()];
  if (!works.length){ flashHint('the collection is empty'); return null; }
  const route = wingRoute(works.length);
  /* Clear only what this rehang replaces, so a work hung deliberately in some
     far hall is not silently swept up. */
  for (const { gx, gz } of route){
    const r = getRoom(gx, gz);
    for (let i = 0; i < r.artworks.length; i++) curator.placements.delete(artJobKey(r, i));
  }
  let n = 0;
  outer:
  for (const { gx, gz } of route){
    const r = getRoom(gx, gz);
    for (let i = 0; i < r.artworks.length; i++){
      if (n >= works.length) break outer;
      curator.placements.set(artJobKey(r, i), works[n++]);
    }
  }
  savePlacements();
  if (cloud.sess && !cloud.viewing)
    for (const [k, id] of curator.placements)
      enqueue('setPlacement', k, [k, id]);
  rebuildWorld();
  goToRoom(WING_ORIGIN[0], WING_ORIGIN[1], 0);
  const rooms2 = route.length;
  flashHint(`${n} work${n===1?'':'s'} hung across ${rooms2} room${rooms2===1?'':'s'} — this is the wing`);
  return { hung: n, rooms: rooms2, left: works.length - n };
}

function spawnAtCollection(placements){
  /* A visitor arrives at the wing when there is one — its first room is where
     the collection starts, and walking forward is the tour. */
  const originKey = roomKey(WING_ORIGIN[0], WING_ORIGIN[1]);
  for (const k of placements.keys())
    if (k.startsWith(originKey + ':')){
      goToRoom(WING_ORIGIN[0], WING_ORIGIN[1], 0);
      return true;
    }
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
    if (e.code === 'KeyE' || e.code === 'KeyV' || e.code === 'KeyF'
        || e.code === 'Space' || e.key === 'Escape') modal.click();
    return;
  }
  if (!document.getElementById('curator').hidden){
    if (e.code === 'KeyC') curatorToggle();
    return;                              // panel is open — the gallery holds still
  }
  if (e.code === 'KeyF'){ inspect.on ? inspectOff() : inspectOn(); return; }
  /* Both open the same enlarged view. V is what it is *for* — E predates it and
     is in every screenshot and both legends, so it keeps working. Neither
     writes a file: the plate carries its own Save button. */
  if (e.code === 'KeyE' || e.code === 'KeyV'){ viewWork(); return; }
  if (e.code === 'KeyM'){ toggleMute(); return; }
  if (e.code === 'KeyL'){ setLights(!lightsOn); return; }
  if (e.code === 'KeyO'){ setShutters(!WIN.on); return; }
  if (e.code === 'KeyC'){ curatorToggle(); return; }
  if (e.code === 'KeyH'){ curatorHang(); return; }
  if (e.code === 'KeyU'){ curatorUnhang(); return; }
  if (e.code === 'KeyT'){ applyTheme(nextThemeName()); return; }
  if (e.code === 'KeyN'){ const n = cycleMusic(); if (n) { persist.music = n; savePersist(); } return; }
  /* The legend had no way back: it faded after eleven seconds and the first
     notice overwrote it for good. Both keys, because ? needs a shift. */
  if (e.key === '?' || e.code === 'Slash'){ toggleLegend(); return; }
  /* Escape left inspect stuck — the only way out was F or a walk key, neither
     of which is what anyone reaches for. */
  if (e.key === 'Escape' && inspect.on){ inspectOff(); return; }
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
  else {
    /* Bounded on purpose. The most this can legitimately owe is a couple of
       steps of a single frame's travel, so eight is already unreachable — but
       this loop's exit depends on a variable it hands to another module, and
       when audio briefly wrote back to it the tab locked hard on the first
       step. A frame loop should degrade, never hang. */
    let guard = 8;
    while (audio.stride > 0.78 && guard-- > 0){ audio.stride -= 0.78; footstep(spd); }
    if (guard <= 0) audio.stride = 0;
  }
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
/** The loan hanging in this frame, if the frame holds one. */
function loanOf(A){
  return A && A.overrideKey
    ? curator.uploads.get(curator.placements.get(A.overrideKey)) || null
    : null;
}

/** Everything a placard would say about a work, in one place, so the label on
 *  the wall and the enlarged view cannot describe the same thing differently.
 *
 *  A seeded work is described by what made it — the algorithm, the palette and
 *  the seed *are* the artwork, and that pair is reproducible, which is the only
 *  interesting claim it has. A loan is described by whoever hung it: their
 *  title, their words, and no invented provenance. Making up a year and a
 *  medium for somebody's own drawing would be a small lie printed under it. */
function describeWork(A){
  const loan = loanOf(A);
  if (loan){
    return { title: loan.name || 'Untitled', note: (loan.note || '').trim(),
             medium: 'private loan · the curator’s collection', loan };
  }
  const year = 1870 + (h2(A.seed, 0x9999, WORLD_SEED) % 200);
  A.title = A.title || makeTitle(mulberry32(h2(A.seed, 0x717, WORLD_SEED)));
  return { title: A.title, note: '', year, loan: null,
           medium: `${ALGO_NAMES[A.algo % ALGOS.length]}, ${year} · `
                 + `${PALETTES[A.pal % PALETTES.length].name} · seed ${A.seed} · 1/1` };
}

/** Write a description into a `.t` / `.m` / `.d` block. The description hides
 *  itself when there is nothing to say, rather than leaving an empty gap. */
function fillCaption(root, d){
  root.querySelector('.t').textContent = d.title;
  root.querySelector('.m').textContent = d.medium;
  const note = root.querySelector('.d');
  if (note){ note.textContent = d.note; note.hidden = !d.note; }
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
  fillCaption(document.getElementById('lt'), describeWork(A));
  document.getElementById('lt').classList.add('show');
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
/* Standing in front of a work and wanting to *see* it is the ordinary case; a
   frame two metres up a wall, lit for a room, is not how anyone reads a
   drawing. This renders the work at four times the pooled resolution — the
   loan from its own file, a seeded work by re-running its generator — and puts
   the title and whatever the artist wrote beside it. Saving stays a separate,
   deliberate button, because it writes to somebody's disk. */
function viewWork(){
  const target = (inspect.on && inspect.A) ? { A: inspect.A } : facedArtwork();
  if (!target){ flashHint('stand before a work to see it closer'); return; }
  const A = target.A;
  const modal = document.getElementById('modal');
  const d = describeWork(A);
  fillCaption(modal.querySelector('.cap'), d);
  modal.querySelector('.cap .m').textContent = 'bringing it closer…';
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
  runAcquire(A, bw, bh, d);
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
async function runAcquire(A, bw, bh, desc){
  const modal = document.getElementById('modal');
  const cap = modal.querySelector('.cap .m');
  preemptArtJobs();
  acqCanvas.width = bw; acqCanvas.height = bh;

  const loanRec = desc.loan;
  if (loanRec){
    /* The same mount the sheet hangs in, at acquire resolution. This used to
       cover-crop, which is the defect the mount exists to fix — it would have
       been perverse to take a drawing down off the wall uncropped and then
       hand the visitor a cropped copy of it. */
    const bmp = loanRec.bmp || (loanRec.bmp = await createImageBitmap(loanRec.blob));
    mountWork(acqCtx, bmp, bw, bh, fillOf(loanRec.id));
  } else {
    /* A.gateSeed is what the painter settled on. Re-running the gate here
       would judge a 1024² render and could pick a different seed, handing the
       visitor a copy of a work that is not the one on the wall. */
    const rnd = mulberry32(A.gateSeed || A.seed);
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
      cap.textContent = 'bringing it closer' + '.'.repeat(1 + (slices++ >> 1) % 3);
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
    /* Re-stated rather than left as the progress line, and re-read from the
       record: a title edited in the Curator's Office while this was rendering
       should be the one under the picture. */
    fillCaption(modal.querySelector('.cap'), describeWork(A));
    const save = document.getElementById('modal-save');
    save.hidden = false;
    save.dataset.name =
      `lumiere_${(desc.title||'untitled').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`
      + `_${loanRec ? loanRec.id : A.seed}.png`;
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
  fills: new Map(),          // upload id → 'mount' | 'bleed'
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
  loadFills();
  /* Anything that did not reach the cloud last time is still owed. */
  outboxLoad(); outboxUI();
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
/* ————— what gets stored —————
   The old path was original → 1280 px JPEG q0.88 → cover-crop → 512 px texture:
   three lossy steps, the first of them JPEG, whose ringing artefacts cluster
   exactly around hard dark strokes on white. That is the classic way to ruin a
   pencil or ink drawing.

   Line art now goes to PNG at 2048 px and stays lossless all the way to the
   GPU. Photographs do not benefit from that and would cost tens of megabytes,
   so they keep a JPEG — at a higher quality and twice the resolution. The test
   is inkiness: a drawing is mostly bare paper and nearly colourless, and both
   of those are cheap to measure on a downsample. PNG that comes out
   unexpectedly huge falls back rather than failing the bucket's size limit. */
const UPLOAD_LONG = 2048, PNG_CEILING = 10 * 1024 * 1024;
/* ————— the limits, on this side of the network —————
   supabase-setup.sql enforces all three, and a policy violation comes back as
   a bare 403 with nothing a visitor could act on. Checking here first means
   the gallery can say which limit was reached and what to do about it; the
   SQL stays the authority, because a client check is a courtesy and not a
   guarantee. Keep these in step with the policies. */
const MAX_UPLOADS = 500, MAX_PLACEMENTS = 2000, MAX_BYTES = 12 * 1024 * 1024;
function quotaRefusal(blob){
  if (blob && blob.size > MAX_BYTES)
    return `that file is ${(blob.size/1048576).toFixed(1)} MB — the gallery accepts up to 12`;
  if (curator.uploads.size >= MAX_UPLOADS)
    return `the collection holds ${MAX_UPLOADS} works, which is the limit — remove one to add one`;
  return null;
}
function looksLikeLineArt(bmp){
  const n = 96;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  let pale = 0, colourful = 0;
  for (let i = 0; i < n*n; i++){
    const r = d[i*4], gg = d[i*4+1], b = d[i*4+2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx > 228) pale++;
    if (mx - mn > 34) colourful++;
  }
  return pale/(n*n) > 0.45 && colourful/(n*n) < 0.10;
}
async function encodeUpload(bmp, lineArt){
  if (lineArt === undefined) lineArt = looksLikeLineArt(bmp);
  const long = Math.max(bmp.width, bmp.height);
  const sc = Math.min(1, UPLOAD_LONG/long);
  const cw = Math.max(1, Math.round(bmp.width*sc)), ch = Math.max(1, Math.round(bmp.height*sc));
  const cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
  const g = cc.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, cw, ch);
  if (lineArt){
    const png = await new Promise(r => cc.toBlob(r, 'image/png'));
    if (png && png.size <= PNG_CEILING) return png;
    trace(`[curator] png ${(png ? png.size/1048576 : 0).toFixed(1)}MB over ceiling — jpeg instead`);
  }
  return new Promise(r => cc.toBlob(r, 'image/jpeg', 0.94));
}
/* ————— how each work meets its frame —————
   Two honest answers, and which one is right depends on the work rather than
   on the gallery. A sheet of paper is a whole object: crop it and you have
   damaged it, so it is mounted at its own proportions. A photograph or a
   screen-born image is already a crop of something larger, so filling the
   frame costs it nothing it minds losing.

   The prompt asks, but it asks with an answer already filled in, because forty
   uploads should not be forty decisions. Line art is always mounted — that is
   the whole point of the works-on-paper treatment. Anything else fills the
   frame when the nearest frame shape is close enough that filling it crops
   almost nothing, and is mounted when it would cut in deep. */
const FRAME_ASPECTS = [1.87/1.40, 1.14/1.52, 1.35/1.35, 2.24/1.40];   // L P S W
const BLEED_TOLERANCE = 0.08;
function suggestFill(w, h, lineArt){
  if (lineArt) return 'mount';
  const a = w / h;
  let closest = Infinity;
  for (const fa of FRAME_ASPECTS){
    const off = Math.max(a/fa, fa/a);
    if (off < closest) closest = off;
  }
  return (1 - 1/closest) < BLEED_TOLERANCE ? 'bleed' : 'mount';
}
function orientationOf(w, h){
  const a = w / h;
  return a > 1.15 ? 'landscape' : a < 0.87 ? 'portrait' : 'square';
}
/** How a work fills its frame. Kept beside the collection rather than in it,
 *  so it survives without a schema change on the cloud `uploads` table. */
function loadFills(){
  if (!storageOK) return;
  try {
    for (const [id, f] of JSON.parse(localStorage.getItem('lumiere_fills') || '[]'))
      curator.fills.set(id, f);
  } catch(e){}
}
function saveFills(){
  if (!storageOK) return;
  try { localStorage.setItem('lumiere_fills', JSON.stringify([...curator.fills])); } catch(e){}
}
const fillOf = (id) => curator.fills.get(id) || 'mount';

/** Re-draw anything already hanging whose fill just changed. The placement
 *  stays; only the texture is wrong, so drop it and let syncArtJobs rebuild. */
function refreshHung(ids){
  let touched = false;
  for (const [k, o] of [...curator.overrides]){
    if (!ids.has(curator.placements.get(k))) continue;
    gl.deleteTexture(o.tex);
    o.A.override = null;
    curator.overrides.delete(k);
    touched = true;
  }
  if (touched) syncArtJobs();
}

/** The review sheet: one screen for the whole batch, each row pre-filled. */
function curatorReview(recs){
  const box = document.getElementById('cur-review');
  if (!box) return;
  if (!recs.length){ box.hidden = true; box.textContent = ''; return; }
  box.textContent = ''; box.hidden = false;
  const dirty = new Set();

  const head = document.createElement('div');
  head.className = 'rv-head';
  head.textContent = `Added ${recs.length} work${recs.length === 1 ? '' : 's'} — how ${recs.length === 1 ? 'it hangs' : 'they hang'}, and what ${recs.length === 1 ? 'it says' : 'they say'}`;
  const list = document.createElement('div');
  list.className = 'rv-list';

  const rows = [];
  for (const rec of recs){
    const row = document.createElement('div');
    row.className = 'rv-row';
    const im = document.createElement('img'); im.src = rec.url; im.alt = '';

    /* The title starts as the filename because that is the only thing known
       about the work, not because it is a good title. It is an editable field
       rather than a caption for exactly that reason — "IMG_4471" is what a
       camera called it, and it is what the placard will say otherwise. */
    const fields = document.createElement('div'); fields.className = 'rv-fields';
    const tIn = document.createElement('input');
    tIn.type = 'text'; tIn.className = 'rv-title'; tIn.maxLength = 120;
    tIn.value = rec.name || ''; tIn.placeholder = 'Title';
    tIn.setAttribute('aria-label', 'Title');
    const dIn = document.createElement('textarea');
    dIn.className = 'rv-desc'; dIn.rows = 2; dIn.maxLength = 600;
    dIn.value = rec.note || '';
    dIn.placeholder = 'A note beside it — medium, year, what it is (optional)';
    dIn.setAttribute('aria-label', 'Description');
    /* Typed into, not submitted: there is no save button on a row, so the
       value has to be taken as it changes or a visitor who types a title and
       walks away loses it. */
    tIn.addEventListener('input', () => { rec.name = tIn.value; dirty.add(rec); });
    dIn.addEventListener('input', () => { rec.note = dIn.value; dirty.add(rec); });
    /* WASD must not walk the gallery while somebody is naming a drawing. */
    for (const el of [tIn, dIn]) el.addEventListener('keydown', (e) => e.stopPropagation());
    fields.append(tIn, dIn);

    const or = document.createElement('div'); or.className = 'rv-or';
    or.textContent = rec.orientation;
    const seg = document.createElement('div'); seg.className = 'rv-seg';
    const mk = (mode, label) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rv-opt'; b.textContent = label;
      b.addEventListener('click', () => { curator.fills.set(rec.id, mode); paint(); });
      return b;
    };
    const bMount = mk('mount', 'Mounted'), bBleed = mk('bleed', 'Full bleed');
    seg.append(bMount, bBleed);
    row.append(im, fields, or, seg);
    list.append(row);
    rows.push({ rec, bMount, bBleed });
  }
  function paint(){
    for (const { rec, bMount, bBleed } of rows){
      const f = fillOf(rec.id);
      bMount.setAttribute('aria-pressed', String(f === 'mount'));
      bBleed.setAttribute('aria-pressed', String(f === 'bleed'));
    }
  }

  const foot = document.createElement('div');
  foot.className = 'rv-foot';
  const all = (mode, label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => { for (const r of recs) curator.fills.set(r.id, mode); paint(); });
    return b;
  };
  const done = document.createElement('button');
  done.type = 'button'; done.className = 'btn'; done.textContent = 'Done';
  done.addEventListener('click', () => {
    saveFills();
    for (const rec of dirty) saveWorkText(rec);
    refreshHung(new Set(recs.map(r => r.id)));
    box.hidden = true; box.textContent = '';
    curatorGrid();
  });
  foot.append(all('mount', 'All mounted'), all('bleed', 'All full bleed'), done);

  box.append(head, list, foot);
  paint();
}

async function curatorAddFiles(files){
  const added = [];
  for (const f of files){
    if (!f.type.startsWith('image/')) continue;
    try {
      const bmp = await createImageBitmap(f);
      const lineArt = looksLikeLineArt(bmp);
      const shape = { w: bmp.width, h: bmp.height, lineArt };
      const blob = await encodeUpload(bmp, lineArt);
      bmp.close();
      if (!blob) continue;
      const refused = quotaRefusal(blob);
      if (refused){ flashHint(refused); break; }
      const name = f.name.replace(/\.[^.]+$/, '');
      /* Uploaded with the filename as its title and nothing said about it. The
         review sheet is where both get answered; this only has to make sure
         there is a row to answer about, since an upload that failed because
         the visitor had not written a description yet would be absurd. */
      if (cloud.on && cloud.sess){
        const { id, path } = await cloudUploadBlob(name, blob, '');
        const rec = { id, name, note: '', blob, path, cloudRec: true, url: URL.createObjectURL(blob) };
        curator.uploads.set(id, rec);
        noteShape(rec, shape); added.push(rec);
      } else {
        const id = 'u' + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);
        const rec = { id, name, note: '', blob, url: URL.createObjectURL(blob) };
        curator.uploads.set(id, rec);
        noteShape(rec, shape); added.push(rec);
        if (curator.db){
          try { curator.db.transaction('images', 'readwrite').objectStore('images')
                  .put({ id, name: rec.name, note: '', blob }); } catch(e){}
        }
      }
    } catch(e){ console.warn('[curator] could not add image', f.name, e); flashHint('that image could not be added'); }
  }
  curatorGrid();
  curatorReview(added);
}
/** Persist a work's title and description wherever that work lives.
 *  Local collections write straight to IndexedDB; cloud collections go through
 *  the outbox, keyed by id, so editing a title twenty times sends once and a
 *  dropped connection does not lose the words. */
function saveWorkText(rec){
  if (rec.cloudRec && cloud.sess){
    enqueue('updateUpload', rec.id, [rec.id, { name: rec.name, note: rec.note || '' }]);
  } else if (curator.db){
    try { curator.db.transaction('images', 'readwrite').objectStore('images')
            .put({ id: rec.id, name: rec.name, note: rec.note || '', blob: rec.blob }); } catch(e){}
  }
  /* A work already on a wall keeps its placard in sync with the sheet. The old
     plaque texture has to go back to the pool first, or the frame keeps
     rendering the filename it was hung under. */
  for (const A of artState.placards) if (A.overrideKey
      && curator.placements.get(A.overrideKey) === rec.id){
    A.title = rec.name;
    if (A.ptex){ releaseSlot(A.ptex); A.ptex = null; }
    if (!A.mini) A.ptexWanted = true;
  }
}

/** Record what an upload's own proportions imply, and pre-fill its answer. */
function noteShape(rec, shape){
  rec.orientation = orientationOf(shape.w, shape.h);
  if (!curator.fills.has(rec.id))
    curator.fills.set(rec.id, suggestFill(shape.w, shape.h, shape.lineArt));
  saveFills();
}
function curatorRemove(id){
  const rec = curator.uploads.get(id);
  if (!rec) return;
  for (const [k, uid] of [...curator.placements]) if (uid === id) curatorClearPlacement(k);
  if (rec.url && !rec.cloudRec) URL.revokeObjectURL(rec.url);
  curator.uploads.delete(id);
  if (rec.cloudRec && cloud.sess)
    enqueue('deleteUpload', rec.id, [rec]);
  else if (curator.db){
    try { curator.db.transaction('images', 'readwrite').objectStore('images').delete(id); } catch(e){}
  }
  if (curator.sel === id) curator.sel = null;
  curator.fills.delete(id); saveFills();
  savePlacements();
  curatorGrid();
}
function curatorClearPlacement(k){
  curator.placements.delete(k);
  if (cloud.sess && !cloud.viewing)
    enqueue('delPlacement', k, [k]);
  const o = curator.overrides.get(k);
  if (o){
    gl.deleteTexture(o.tex);
    o.A.override = null; o.A.overrideName = false; o.A.overrideKey = null;
    o.A.title = null;                             // the seeded title returns
    if (o.A.ptex){ releaseSlot(o.A.ptex); o.A.ptex = null; }
    if (!o.A.mini){ o.A.ptexWanted = true; artState.placards.push(o.A); }
    const idx = o.r.artworks.indexOf(o.A);
    if (idx >= 0) setFixture(o.r, idx, false);    // the tungsten fixture returns with the painting
    curator.overrides.delete(k);
  }
  savePlacements();
  syncArtJobs();                                  // regenerate the seeded work if needed
}
/* ————— themes —————
   Everything a theme touches is a live, mutable structure, so applying one is
   an overwrite followed by a full rebuild. */
function rebuildWorld(){
  /* genLights runs once, inside getRoom, and rooms are cached — so rebuilding
     the meshes alone reuses the old ownLights and any patch appears to do
     nothing. The cache has to go. Releasing the art slots is not optional
     either: they are keyed to the room objects being discarded, and leaving
     them held starves every new job forever, since startJob re-queues rather
     than failing. Shared by DBG.relight, DBG.seed and applyTheme, because
     getting this teardown half-right is exactly how the pools got starved. */
  freeAllArtSlots();
  artState.jobs.clear(); artState.queue.length = 0;
  artState.active = null; artState.uploadReady = null;
  artState.placards.length = 0;
  discardPainted();
  for (const [, o] of curator.overrides){ gl.deleteTexture(o.tex); o.A.override = null; }
  curator.overrides.clear();
  for (const [, r] of rooms) dropRoomGL(r);
  rooms.clear();
  onRoomChanged();
}
/** Write the active theme into every live constant. Safe before any room
 *  exists — boot calls it so the first meshes are cut from the right schemes
 *  and genLights reads the right rig. */
function applyThemeConstants(){
  const t = theme();
  for (const k in t.rig) if (RIG[k]) RIG[k].col = t.rig[k].slice();
  applyScheme(t.scheme, t.chroma);
  for (let i = 0; i < 3; i++){ FOG[i] = t.fog[i]; AMB_BASE[i] = t.amb[i]; }
  setSigma(t.sigma, t.daySigma);
  GRADE.exposure = t.grade.exposure;
  GRADE.grain = t.grade.grain;
  GRADE.vignette = t.grade.vignette;
  GRADE.shadowTint = t.grade.shadowTint.slice();
  GRADE.lightTint  = t.grade.lightTint.slice();
  Object.assign(MOUNT, t.mount);
}
/** The theme picker in the Curator's Office. Rebuilt rather than patched: it is
 *  three buttons, and the alternative is keeping DOM and state in step by hand. */
function themeUI(){
  const box = document.getElementById('cur-themes');
  if (!box) return;
  box.textContent = '';
  for (const name of THEME_ORDER){
    const t = THEMES[name];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cur-theme';
    b.setAttribute('aria-pressed', String(name === themeName()));
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.label;
    const fw = document.createElement('span'); fw.className = 'fw'; fw.textContent = t.forWhat;
    b.append(nm, fw);
    b.addEventListener('click', () => { if (name !== themeName()) applyTheme(name); });
    box.append(b);
  }
}
function applyTheme(name, quiet){
  setThemeName(name);
  applyThemeConstants();
  persist.theme = themeName(); savePersist();
  rebuildWorld();
  themeUI();
  if (!quiet) flashHint(`<b>${theme().label}</b> — ${theme().forWhat}`);
  return themeName();
}

/* ————— the window mount —————
   A drawing used to be cover-cropped to whatever frame it was hung in, so a
   portrait sheet in a landscape frame simply lost its top and bottom. A mount
   is not a workaround for that, it is what a museum actually does: the sheet
   sits at its true proportions and rag board fills the rest. Margins are a
   minimum, not a fixed border — the sheet is drawn as large as it can be
   inside them, so a matched aspect gets a slim mount and a mismatched one gets
   a generous margin on two sides instead of losing its edges.

   The bottom margin is wider than the top. That is standard framing practice,
   not a mistake: an optically centred sheet reads as centred, a mathematically
   centred one reads as sagging. */
const MOUNT = { face: '#EDE7DA', bevel: '#FBF7EE', undercut: 'rgba(90,80,64,0.34)' };
/* Swap the one fixture that lights work `i` — neutral and dim for paper, the
   room's own tungsten for a painting — and rebuild the room's light list so the
   change reaches the packer. The lights beside it are untouched. */
function setFixture(r, i, paper){
  const L = r.ownLights.find(l => l.forArt === i);
  if (!L) return false;
  const F = paper ? RIG.paper
          : r.special === SPECIAL.VERMILION ? RIG.spotVermil : RIG.spot;
  L.col = F.col; L.inner = F.inner; L.outer = F.outer; L.invR2 = 1/(F.range*F.range);
  /* A solo theme generates nothing, so taking a drawing down leaves the frame
     genuinely empty — and an empty frame gets no lamp. */
  L.off = !paper && theme().solo;
  assembleLights(r, WIN.on);
  return true;
}
function mountRect(sw, sh, tw, th){
  const m  = Math.round(Math.min(tw, th) * 0.085);
  const mb = Math.round(m * 1.18);
  const availW = tw - 2*m, availH = th - m - mb;
  const s = Math.min(availW/sw, availH/sh);                  // contain, never crop
  const dw = Math.max(1, Math.round(sw*s)), dh = Math.max(1, Math.round(sh*s));
  return { tw, th, m, mb, dw, dh,
           dx: Math.round((tw - dw)/2), dy: Math.round(m + (availH - dh)/2) };
}
function mountWork(g, bmp, tw, th, fill){
  if (fill === 'bleed'){
    /* Edge to edge, and whatever does not fit is lost. Right for a photograph
       or a screen-born image, where the frame is a crop and not a mount; wrong
       for a sheet of paper, which is why it is never the default for one. */
    const s = Math.max(tw/bmp.width, th/bmp.height);
    const dw = bmp.width*s, dh = bmp.height*s;
    g.drawImage(bmp, (tw-dw)/2, (th-dh)/2, dw, dh);
    return;
  }
  const { dx, dy, dw, dh } = mountRect(bmp.width, bmp.height, tw, th);
  g.fillStyle = MOUNT.face; g.fillRect(0, 0, tw, th);
  /* The bevel: rag board is cut at 45°, so the exposed core is a bright line on
     the two edges facing the light and a soft shadow where it meets the sheet. */
  const bw = Math.max(2, Math.round(Math.min(tw, th) * 0.008));
  g.fillStyle = MOUNT.bevel;
  g.fillRect(dx - bw, dy - bw, dw + 2*bw, dh + 2*bw);
  g.fillStyle = MOUNT.undercut;
  g.fillRect(dx - 1, dy - 1, dw + 2, 1);
  g.fillRect(dx - 1, dy - 1, 1, dh + 2);
  g.drawImage(bmp, dx, dy, dw, dh);
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
    const [tw, th] = LOAN_SIZES[A.asp];
    const cc = document.createElement('canvas'); cc.width = tw; cc.height = th;
    const g = cc.getContext('2d');
    mountWork(g, bmp, tw, th, fillOf(rec.id));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(tw, th))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, tw, th);   // a visitor's own image
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cc);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (window.__aniso)
      gl.texParameterf(gl.TEXTURE_2D, window.__aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, window.__aniso.max);
    A.override = tex; A.overrideKey = k; A.overrideName = true;
    A.title = rec.name; A.fadeAt = performance.now();
    setFixture(r, i, true);
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
  if (curator.placements.size >= MAX_PLACEMENTS){
    flashHint(`${MAX_PLACEMENTS} works are already hung — take one down first`);
    return;
  }
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
    enqueue('setPlacement', k, [k, curator.sel]);
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
/* ————— saying what actually went wrong —————
   Supabase's auth errors are written for whoever wired the project up, not for
   whoever is standing in front of it, and the commonest one here — "Email not
   confirmed" — is indistinguishable from "the gallery is broken" if you do not
   already know that a mailer is involved. Each of these names the thing the
   reader can go and do. Anything unrecognised passes through untouched, since
   a wrong guess is worse than the original text. */
function authAdvice(msg){
  const m = String(msg || '').toLowerCase();
  if (m.includes('not confirmed'))
    return 'This account exists, but the project is holding it until an email is '
         + 'confirmed — and Supabase’s built-in sender is rate-limited to about two an '
         + 'hour and often delivers nothing, so that mail may never arrive. Turn off '
         + '“Confirm email” under Authentication → Sign In / Providers → Email in your '
         + 'Supabase dashboard, then press Sign in here. Nothing needs re-creating.';
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return 'That email and password did not match. If you have not made an account here '
         + 'yet, use “Create account” instead.';
  if (m.includes('already registered') || m.includes('already been registered')
      || m.includes('user already'))
    return 'That account already exists — use “Sign in”.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('over_email_send'))
    return 'Supabase is rate-limiting its own mailer — about two an hour on a free '
         + 'project. Waiting will not help much; turning off “Confirm email” in the '
         + 'dashboard removes the need for mail entirely.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'This project has sign-ups switched off. Turn them on under Authentication → '
         + 'Sign In / Providers → Email.';
  return msg;
}

/* Read the project's auth settings the first time the sign-in panel is shown,
   so the visitor is told what will happen *before* they wait on an email that
   is not coming. Module scope on purpose — curatorRefresh is what knows the
   panel just opened, and it lives out here. Cheap, asked once, and silent when
   the answer is the good one. */
let authChecked = false;
async function warnAboutConfirmation(){
  if (authChecked || !cloud.on || cloud.sess) return;
  authChecked = true;
  const s = await cloudAuthSettings();
  if (!s || s.autoconfirm) return;                 // nothing to warn about
  const note = document.getElementById('cur-cloud-note');
  if (!note || note.textContent) return;           // never talk over a live message
  note.innerHTML =
    'Heads up — this project has <b>Confirm email</b> switched on, so a new account '
    + 'waits on a confirmation mail, and Supabase’s built-in sender is rate-limited to '
    + 'about two an hour and often does not deliver at all. If nothing arrives, turn '
    + 'that toggle off under <b>Authentication → Sign In / Providers → Email</b> and '
    + 'press Sign in — an account you already made will start working, with no mail '
    + 'involved.';
}

function curatorRefresh(){
  const guest = !!cloud.viewing;
  const open = !guest && (cloud.on ? !!cloud.sess : curator.unlocked);
  document.getElementById('cur-lock').hidden = open || guest || cloud.on ? true : false;
  const showCloudLock = cloud.on && !open && !guest;
  document.getElementById('cur-cloud-lock').hidden = !showCloudLock;
  /* Ask the project what it will do before the visitor finds out by waiting. */
  if (showCloudLock) warnAboutConfirmation();
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
  document.getElementById('cur-gather').addEventListener('click', () => {
    if (!curatorCanEdit()) return;
    if (gatherIntoWing()) curatorToggle();     // step out and look at it
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
  const pwIn = document.getElementById('cur-pw');
  emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwIn.focus(); e.stopPropagation(); });
  pwIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('cur-signin').click(); e.stopPropagation(); });
  /** Shared tail of every way in. */
  async function afterSignIn(){
    cloudNote.textContent = '';
    await loadMyCollection();
    curatorRefresh();
    flashHint('welcome, curator — your loans follow you now');
  }
  const creds = () => {
    const email = emailIn.value.trim(), pw = pwIn.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ cloudNote.textContent = 'that does not read like an email address'; return null; }
    if (pw.length < 6){ cloudNote.textContent = 'the password needs at least six characters'; return null; }
    return { email, pw };
  };
  document.getElementById('cur-signin').addEventListener('click', async () => {
    const c = creds(); if (!c) return;
    cloudNote.textContent = 'signing in…';
    try { await cloudPassword(c.email, c.pw); await afterSignIn(); }
    catch(e){ cloudNote.textContent = authAdvice(e.message || e); }
  });
  document.getElementById('cur-signup').addEventListener('click', async () => {
    const c = creds(); if (!c) return;
    cloudNote.textContent = 'creating the account…';
    try {
      const r = await cloudSignUp(c.email, c.pw);
      if (r === 'signed-in'){ await afterSignIn(); return; }
      /* The account was made and a confirmation mail was *attempted*. Saying
         "check your email" and stopping is the dead end that prompted all of
         this — on a fresh project that mail commonly never lands, and the
         reader is left with an account they cannot use and no idea why. */
      cloudNote.innerHTML =
        'The account is made. This project has <b>Confirm email</b> on, so it has sent '
        + 'a confirmation mail — but Supabase’s built-in sender is rate-limited to about '
        + 'two an hour and often does not deliver at all.<br><br>'
        + 'If it does not arrive: open your Supabase dashboard → <b>Authentication → '
        + 'Sign In / Providers → Email</b>, turn <b>“Confirm email”</b> off, and press '
        + '<b>Sign in</b> here. The account you just made will work immediately. You do '
        + 'not need to create it again.';
    } catch(e){ cloudNote.textContent = authAdvice(e.message || e); }
  });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('cur-verify').click(); e.stopPropagation(); });
  document.getElementById('cur-send').addEventListener('click', async () => {
    const email = emailIn.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ cloudNote.textContent = 'that does not read like an email address'; return; }
    cloudNote.textContent = 'sending…';
    try {
      await cloudSendCode(email);
      document.getElementById('cur-code-row').hidden = false;
      /* Not "a six-digit code is on its way", which was a promise this could
         not keep twice over: the default Supabase template sends a confirmation
         *link* rather than a code, and the sender is rate-limited besides. Say
         what was asked for and what to do when it does not turn up. */
      cloudNote.innerHTML =
        'Asked Supabase to mail ' + email + '.<br><br>'
        + 'Two things commonly go wrong, neither of them here: the built-in sender is '
        + 'rate-limited to about two an hour, and the default template sends a '
        + '<em>link</em> rather than the six-digit code this box wants — a link that '
        + 'points at localhost and will not open. Password sign-in above needs no mail '
        + 'at all, and is the way in that always works.';
      codeIn.focus();
    } catch(e){ cloudNote.textContent = authAdvice(e.message || e); }
  });
  document.getElementById('cur-verify').addEventListener('click', async () => {
    cloudNote.textContent = 'checking…';
    try {
      await cloudVerify(emailIn.value.trim(), codeIn.value.trim());
      cloudNote.textContent = '';
      await loadMyCollection();
      curatorRefresh();
      flashHint('welcome, curator — your loans follow you now');
    } catch(e){ cloudNote.textContent = authAdvice(e.message || e); }
  });
  document.getElementById('cur-signout').addEventListener('click', () => {
    cloudSaveSess(null);
    location.reload();               // cleanest way back to the local collection
  });
  document.getElementById('cur-slug-save').addEventListener('click', async () => {
    const slug = document.getElementById('cur-slug').value.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(slug)){ flashHint('names are 3–32 letters, digits, dashes'); return; }
    try { await cloudClaimSlug(slug); curatorRefresh(); flashHint('the gallery answers to <b>' + slug + '</b> now'); enqueue.claimed = slug; }
    catch(e){ flashHint(String(e.message || e)); }
  });
  document.getElementById('cur-publish').addEventListener('click', async () => {
    if (!cloud.sess || !cloud.slug) return;
    const next = !cloud.published;
    /* Tried inline, because the visitor is watching this one and wants an
       answer — but a failure enqueues rather than being swallowed. Whether a
       gallery is public is the last piece of state that should be allowed to
       disagree with the cloud. */
    let ok = false;
    try { const r = await cloudSetPublished(next); ok = !r || r.ok !== false; }
    catch(e){ ok = false; }
    if (ok){
      curatorRefresh();
      flashHint(next ? 'published — anyone with the link can walk your gallery'
                     : 'unpublished — the gallery is yours alone again');
    } else {
      enqueue('setPublished', 'published', [next]);
      flashHint(next ? 'the cloud did not answer — publishing when it does'
                     : 'the cloud did not answer — <b>still public</b> until it does');
    }
  });
  document.getElementById('cur-migrate').addEventListener('click', async () => {
    if (!cloud.sess) return;
    const btn = document.getElementById('cur-migrate');
    btn.textContent = 'Sending…';
    let moved = 0;
    for (const [oldId, rec] of [...curator.uploads]){
      if (rec.cloudRec || !rec.blob) continue;
      try {
        const { id, path } = await cloudUploadBlob(rec.name, rec.blob, rec.note || '');
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
/* ————— the outbox —————
   Every cloud write used to be fire-and-forget with a hint on failure. The
   local change had already happened, so a write that did not land left the
   gallery and the cloud quietly disagreeing until the next reload — at which
   point the cloud's version won and the visitor's change vanished with no
   explanation. Losing a hanging to a dropped connection is not acceptable
   behaviour for something a person spent an evening arranging.

   So writes go through a queue that outlives the attempt, and the failure
   mode becomes "not saved yet" instead of "silently lost".

   Every write here is idempotent and keyed — set or delete a placement, set
   published, claim a slug — so a retry is always safe and a later write to
   the same key can simply replace an earlier one. That is what keeps the
   queue bounded when somebody toggles a switch twenty times. */
const OUTBOX_KEY = 'lumiere_outbox', OUTBOX_MAX = 400;
const outbox = { items: [], timer: 0, tries: 0, sending: false };

function outboxLoad(){
  if (!storageOK) return;
  try { outbox.items = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch(e){}
}
function outboxSave(){
  if (!storageOK) return;
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox.items)); } catch(e){}
}
/** Queue a write. `key` identifies what it is about, so a newer instruction
 *  about the same thing supersedes the older one rather than queueing behind
 *  it — the cloud only ever needs the final answer. */
function enqueue(kind, key, args){
  const i = outbox.items.findIndex((it) => it.kind === kind && it.key === key);
  if (i >= 0) outbox.items.splice(i, 1);
  outbox.items.push({ kind, key, args });
  if (outbox.items.length > OUTBOX_MAX) outbox.items.shift();
  outboxSave();
  outboxUI();
  outboxFlush();
}
const OUTBOX_SEND = {
  setPlacement: ([k, id]) => cloudSetPlacement(k, id),
  delPlacement: ([k])     => cloudDelPlacement(k),
  setPublished: ([on])    => cloudSetPublished(on),
  claimSlug:    ([slug])  => cloudClaimSlug(slug),
  deleteUpload: ([rec])   => cloudDeleteUpload(rec),
  updateUpload: ([id, patch]) => cloudUpdateUpload(id, patch),
};
async function outboxFlush(){
  if (outbox.sending || !outbox.items.length) return;
  if (!cloud.on || !cloud.sess || cloud.viewing) return;   // nothing to talk to
  outbox.sending = true;
  clearTimeout(outbox.timer); outbox.timer = 0;
  try {
    while (outbox.items.length){
      const it = outbox.items[0];
      const send = OUTBOX_SEND[it.kind];
      if (!send){ outbox.items.shift(); continue; }         // unknown: drop it
      let r = null;
      try { r = await send(it.args); } catch(e){ r = null; }
      if (!r || !r.ok){
        /* Back off, and say so once rather than on every attempt. */
        outbox.tries++;
        const wait = Math.min(60000, 1200 * Math.pow(2, Math.min(5, outbox.tries - 1)));
        if (outbox.tries === 1)
          flashHint('the cloud did not answer — your changes are saved here and will be sent');
        outbox.timer = setTimeout(() => { outbox.sending = false; outboxFlush(); }, wait);
        outboxUI();
        return;
      }
      outbox.items.shift();
      outbox.tries = 0;
      outboxSave();
      outboxUI();
    }
    outboxUI();
  } finally {
    if (!outbox.timer) outbox.sending = false;
  }
}
/** What the office says about it. Silence when there is nothing outstanding. */
function outboxUI(){
  const el = document.getElementById('cur-outbox');
  if (!el) return;
  const n = outbox.items.length;
  el.hidden = n === 0;
  if (n) el.textContent = outbox.tries
    ? `${n} change${n===1?'':'s'} not sent yet — retrying`
    : `sending ${n} change${n===1?'':'s'}…`;
}
/* A write worth keeping goes in the outbox; anything else keeps the old
   fire-and-forget behaviour, because retrying it would be meaningless. */
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
  /* A signed-in session is the first moment there is anywhere to send what
     the outbox is holding — including anything left over from a previous
     visit that ended before the network came back. */
  if (cloud.sess) outboxFlush();
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
let stalled = false, badRuns = 0, goodRuns = 0;
/* Per-tier probation: when a tier may next be tried again, and how long the
   next disappointment will cost it. Indexed by tier, so tier 2 failing says
   nothing about tier 1. */
const tierBlock   = [0, 0, 0];
const tierPenalty = [30_000, 30_000, 30_000];
let lastFaced = null, aimEl = null;
let shadowsOn = true;
let probeRequest = null, rafId = 0, forceDt = null;
const probeBuf = new Uint8Array(32*32*4);

let acqModalEl = null;
const acqModalHidden = () =>
  (acqModalEl || (acqModalEl = document.getElementById('modal'))).hidden;

/* ————— portal visibility —————
   The museum is a portal graph and has stored it in `r.doors` since the world
   generator was written; nothing used it to decide what to draw. Frustum
   culling alone kept every one of the 5×5 neighbourhood's twenty-five rooms
   that fell inside the view cone, including rooms sealed off behind a solid
   wall two metres away, and shaded them in full.

   A room is reachable for the eye only through a chain of open doorways, and
   each doorway narrows the screen rectangle everything beyond it can occupy.
   So: flood outward from the visitor's room, intersecting a clip-space
   rectangle at every portal, and stop when it closes. */
const DOOR_DIRS = [['e',1,0], ['w',-1,0], ['n',0,1], ['s',0,-1]];
let portalCull = true;   // DBG.culling('frustum') turns it off for A/B
/* Flames, moon shafts and dust motes animate on the wall clock, and the grain
   is seeded from it too, so no two frames are ever identical. Pinning it is
   what lets a change claim "this did not alter a single pixel" and be checked
   rather than believed. */
let frozenT = null;
const VIS_STACK = [], VIS_BY_KEY = new Map();
const PRECT = [0,0,0,0];
/** Clip-space AABB of a doorway. Returns PRECT, or null when the doorway
 *  straddles the near plane — there the projection flips sign and an AABB is
 *  nonsense, so the caller keeps the parent's rectangle. Returns false when
 *  every corner is behind the camera: that doorway is not a way in.
 *
 *  Treating those two cases alike is what made the first version of this keep
 *  *more* rooms than the frustum did — a door behind your head has all four
 *  corners behind the near plane, and the conservative fallback let the room
 *  beyond it through. */
function portalRect(ox, oz, wall){
  const DW = DOORW/2;
  const horiz = (wall === 'e' || wall === 'w');
  const sgn = (wall === 'e' || wall === 'n') ? 1 : -1;
  const a = horiz ? ox + sgn*HS : ox - DW, b = horiz ? ox + sgn*HS : ox + DW;
  const c = horiz ? oz - DW : oz + sgn*HS, d = horiz ? oz + DW : oz + sgn*HS;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = 0;
  for (let i = 0; i < 4; i++){
    const px = (i & 1) ? b : a, pz = (i & 1) ? d : c;
    const py = (i & 2) ? DOORH : 0;
    const cx = M_PV[0]*px + M_PV[4]*py + M_PV[8]*pz  + M_PV[12];
    const cy = M_PV[1]*px + M_PV[5]*py + M_PV[9]*pz  + M_PV[13];
    const cw = M_PV[3]*px + M_PV[7]*py + M_PV[11]*pz + M_PV[15];
    if (cw <= 1e-4){ behind++; continue; }
    const nx = cx/cw, ny = cy/cw;
    if (nx < x0) x0 = nx; if (nx > x1) x1 = nx;
    if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
  }
  if (behind === 4) return false;      // not a way in
  if (behind) return null;             // straddling — keep the parent rect
  PRECT[0] = x0; PRECT[1] = y0; PRECT[2] = x1; PRECT[3] = y1;
  return PRECT;
}
function computeVisibility(){
  if (!portalCull){
    for (let i = 0; i < nearRooms.length; i++){
      const e = nearRooms[i];
      e.vis = boxVisible(e.ox, H/2, e.oz, HS, H/2, HS);
    }
    return;
  }
  VIS_BY_KEY.clear();
  for (let i = 0; i < nearRooms.length; i++){
    const e = nearRooms[i];
    e.vis = false;
    VIS_BY_KEY.set(roomKey(e.r.gx, e.r.gz), e);
  }
  const start = VIS_BY_KEY.get(roomKey(player.gx, player.gz));
  if (!start){
    /* Mid-teleport the visitor's own room may not be built yet. Fall back to
       the frustum rather than drawing nothing at all. */
    for (let i = 0; i < nearRooms.length; i++){
      const e = nearRooms[i];
      e.vis = boxVisible(e.ox, H/2, e.oz, HS, H/2, HS);
    }
    return;
  }
  start.vis = true; start.x0 = -1; start.y0 = -1; start.x1 = 1; start.y1 = 1;
  VIS_STACK.length = 0; VIS_STACK.push(start);
  /* Reachability and the view frustum are independent facts, and a room has to
     satisfy both. The flood answers "could light get here through the doors";
     the frustum answers "is it in front of me at all". */
  while (VIS_STACK.length){
    const e = VIS_STACK.pop();
    for (let d = 0; d < 4; d++){
      const [wall, dx, dz] = DOOR_DIRS[d];
      if (!e.r.doors[wall]) continue;
      const nb = VIS_BY_KEY.get(roomKey(e.r.gx + dx, e.r.gz + dz));
      if (!nb) continue;
      const p = portalRect(e.ox, e.oz, wall);
      if (p === false) continue;                     // that doorway faces away
      let x0 = e.x0, y0 = e.y0, x1 = e.x1, y1 = e.y1;
      if (p){
        if (p[0] > x0) x0 = p[0]; if (p[1] > y0) y0 = p[1];
        if (p[2] < x1) x1 = p[2]; if (p[3] < y1) y1 = p[3];
        if (x1 <= x0 || y1 <= y0) continue;          // the doorway closed it
      }
      /* A room can be reached down more than one corridor. Keep the union, and
         only walk on when this path actually widened it — otherwise a cycle in
         the door graph would loop forever. */
      if (nb.vis){
        if (x0 >= nb.x0 && y0 >= nb.y0 && x1 <= nb.x1 && y1 <= nb.y1) continue;
        if (nb.x0 < x0) x0 = nb.x0; if (nb.y0 < y0) y0 = nb.y0;
        if (nb.x1 > x1) x1 = nb.x1; if (nb.y1 > y1) y1 = nb.y1;
      }
      nb.vis = true; nb.x0 = x0; nb.y0 = y0; nb.x1 = x1; nb.y1 = y1;
      VIS_STACK.push(nb);
    }
  }
  for (let i = 0; i < nearRooms.length; i++){
    const e = nearRooms[i];
    if (e.vis && e !== start && !boxVisible(e.ox, H/2, e.oz, HS, H/2, HS)) e.vis = false;
  }
}
/* The floor reflections are a second pass over the whole visible world — every
   painting, every pane of glass, every candle flame, drawn again upside down —
   so they are the one effect here whose cost is a fixed share of the scene
   rather than a detail. `null` follows the quality dial; DBG.reflections(bool)
   pins them, which is how that share gets measured rather than guessed at. */
let reflectPin = null;
function reflecting(){ return reflectPin === null ? PERF.q >= 1 : reflectPin; }

/* Every wall fragment walks the room's light list, and that loop is a third of
   the frame: measured on an Intel UHD at 1536×718, ten lights cost 15.3 ms and
   none cost 10.1 — about half a millisecond each.

   Cutting it everywhere is the wrong trade. Each picture light throws a halo on
   the plaster around its painting, and those halos are most of what makes the
   room read as a gallery rather than a corridor. But that argument only holds
   for the room you are standing in. A room two doorways away arrives as a
   sliver through an aperture a metre and a half wide — nobody is reading the
   falloff on its far wall, and four of the five rooms drawn in a typical frame
   are exactly that.

   So the budget follows the distance. Rooms are 14 m, so 10 m keeps the room
   you occupy and the one you are stepping into whole; past 26 m a room is at
   best a bright rectangle at the end of an enfilade. packLights orders fill
   lights first, so what a clamp drops is always the least important light in
   the room, never the one shaping it. */
function lightBudget(ox, oz){
  const dx = ox - player.x, dz = oz - player.z;
  const d2 = dx*dx + dz*dz;
  return d2 < 100 ? MAX_LIGHTS : d2 < 676 ? 6 : 4;
}
let lightCap = MAX_LIGHTS;

/** Frustum test against the room mirrored below the floor, for the reflection
 *  pass. Cheap, and the only visibility that pass can honestly use. */
function computeMirrorVisibility(){
  for (let i = 0; i < nearRooms.length; i++){
    const e = nearRooms[i];
    e.visR = boxVisible(e.ox, -H/2, e.oz, HS, H/2, HS);
  }
}

/** One half-second window's verdict on the quality tier.
 *
 *  The thresholds leave a dead band, and the dead band was a trap. On the
 *  machine this was reported from, tier 1 runs at about 60 fps and tier 2 at
 *  46. Sixty is over the old climb threshold, so after three seconds the dial
 *  went up — and 46 is not under the old 42 fps drop threshold, so it *stayed
 *  there*, at 46 fps, for the rest of the session. It hunted upward into a tier
 *  the machine could not hold and then had no way to read that as failure. A
 *  ratchet with a dead band needs a memory, or the band becomes the place it
 *  gets stuck.
 *
 *  So: drop below 50 rather than 42, because sitting at 46 is the outcome being
 *  avoided, not an acceptable resting place. Climb only above 58, which needs
 *  genuine headroom rather than the top of the band. And a tier abandoned for
 *  being too slow goes on probation — half a minute at first, doubling every
 *  time it disappoints again, to a quarter of an hour. A machine that was
 *  briefly busy gets its quality back; a machine that simply cannot render
 *  tier 2 stops being asked about it every five seconds.
 *
 *  Separate from the frame loop so a test can drive a fps history through the
 *  real logic: this failure only appears over tens of seconds, on hardware
 *  slower than the machine the suite runs on.
 */
let perfClock = 0;
function judgeQuality(fpsAvg, t){
  if (fpsAvg < 50){ badRuns++; goodRuns = 0; }
  else if (fpsAvg > 58){ goodRuns++; badRuns = 0; }
  else { badRuns = 0; goodRuns = 0; }
  const settled = t - PERF.lastChange > 5000;
  const want = PERF.q + 1;
  if (badRuns >= 2 && PERF.q > 0 && settled){
    const left = PERF.q;
    tierBlock[left] = t + tierPenalty[left];
    tierPenalty[left] = Math.min(tierPenalty[left] * 2, 900_000);
    PERF.q--; PERF.lastChange = t; badRuns = 0;
    trace(`[perf] ${fpsAvg.toFixed(0)}fps — easing quality to tier ${PERF.q}`
        + ` (tier ${left} on probation for ${Math.round((tierBlock[left]-t)/1000)}s)`);
  } else if (goodRuns >= 6 && want <= 2 && settled && t >= tierBlock[want]){
    PERF.q = want; PERF.lastChange = t; goodRuns = 0;
    trace(`[perf] ${fpsAvg.toFixed(0)}fps — restoring quality to tier ${PERF.q}`);
  }
}

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

  const rawDt = t - lastT;
  const dt = forceDt !== null ? forceDt : Math.min(50, rawDt) / 1000;
  lastT = t;
  /* A frame that took longer than this is a stall, not a slow machine: a tab
     waking, the compositor stealing the GPU, a long task elsewhere. It used to
     be counted as evidence — and because dt is clamped to 50ms, one such frame
     reads as exactly 20fps, which is the shape of input most likely to trip a
     downgrade that could never be undone. Windows containing one are discarded. */
  if (forceDt === null && rawDt > 120) stalled = true;
  frameCount++; fpsAcc += dt;
  if (fpsAcc > 0.5){
    fpsAvg = frameCount / fpsAcc; frameCount = 0; fpsAcc = 0;
    const judge = entered && forceDt === null && !PERF.pinned && !stalled;
    stalled = false;
    if (judge) judgeQuality(fpsAvg, t);
    else { badRuns = 0; goodRuns = 0; }
  }

  if (entered) step(dt);

  /* The reticle answers when there is a work in front of you — the one piece
     of feedback that tells you F and E will do something. Checked on a slow
     tick and written only when the answer changes, because the frame loop is
     not allowed to touch the DOM every frame and does not need to: this is a
     state transition like any other. */
  if (entered && (frameCount & 7) === 0){
    const faced = inspect.on ? null : facedArtwork();
    const now = faced ? faced.A : null;
    if (now !== lastFaced){
      lastFaced = now;
      const dot = aimEl || (aimEl = document.getElementById('aim'));
      if (dot) dot.classList.toggle('live', !!now);
    }
  }

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
  const sigCur = WIN.on ? DAY_SIGMA : FOG_SIGMA;
  const ambMult = (lightsOn ? 1 : 0.22) * (WIN.on ? 1.25 : 1);
  /* What a hanging surface receives when no lamp reaches it. Paintings and
     placards were drawing with a flat uEm of 0.35 and 0.55 — an emissive term
     that ignored the lamp switch, so with the lights off the room went black
     and the art stayed lit like a cutout floating in a void. Heavy fog used to
     hide it. They are not light sources; they see the same ambient the walls
     see. Windows keep a real uEm: the sky genuinely emits. */
  const ambLum = r => (AMB_BASE[1] + r.mood[1]) * (r.ambScale || 1) * ambMult;
  gl.clearColor(fogCur[0], fogCur[1], fogCur[2], 1);
  gl.enable(gl.DEPTH_TEST);
  /* Stays off, and not by oversight — this was tried and reverted. The premise
     that "every wall is shaded twice" is false: geometry.js `face()` emits one
     quad per wall segment with the inward normal, so the architecture is
     single-sided by construction and there is no back face to skip. Worse,
     `p(u,y,depth)` mirrors handedness between opposite walls — the east wall
     sits at +x with an inward normal of -x, the west at -x with +x — so the two
     wind oppositely as seen from inside, and culling BACK deletes one of every
     opposing pair. Measured: the room visibly opened up at its left and right
     edges, and the frame was no faster (2.30ms culled vs 2.17ms not) because
     there was nothing to cull. Making the winding consistent would be real work
     across an axis-generic emitter, for a saving that only ever existed on the
     handful of closed boxes — benches, frames, chandelier arms. */
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

  /* Visibility, once. The same room box was tested against the frustum in
     seven separate loops — architecture, reflections, art, shadows, flames,
     shafts, motes — for an answer that cannot change within a frame. Rooms in
     nearRooms and midRooms are the same objects, so one pass settles both. */
  packSerial++;
  computeVisibility();
  if (reflecting()) computeMirrorVisibility();

  gl.useProgram(progArch);
  gl.uniformMatrix4fv(uArch.p, false, M_P);
  gl.uniform1f(uArch.sig, sigCur);
  gl.uniform1f(uArch.alpha, 1);
  gl.uniform3f(uArch.upv, M_V[4], M_V[5], M_V[6]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plasterTex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, parquetTex);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, plasterNrm);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, parquetNrm);
  gl.activeTexture(gl.TEXTURE0);

  function archRoomUniforms(r, ox, oz){
    const m = r.mood, as = (r.ambScale || 1) * ambMult;
    gl.uniform3f(uArch.amb,
      (AMB_BASE[0]+m[0])*as, (AMB_BASE[1]+m[1])*as, (AMB_BASE[2]+m[2])*as);
    gl.uniform3f(uArch.fog,
      fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
    const nl = Math.min(packLights(r, ox, oz), lightCap, lightBudget(ox, oz));
    gl.uniform1i(uArch.nl, nl);
    /* Which packed light the baked map belongs to. packLights drops lights the
       switch turned off, so the index has to be found rather than assumed. */
    gl.uniform1i(uArch.shadowIdx, (shadowsOn && r.shadowTex) ? r.packFillIdx : -1);
    if (r.shadowTex){
      gl.uniformMatrix4fv(uArch.shadowMat, false, r.shadowMat);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, r.shadowTex);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform4fv(uArch.lpos, r.lpos);
    gl.uniform4fv(uArch.ldir, r.ldir);
    gl.uniform4fv(uArch.lcol, r.lcol);
    mulT(M_MV, M_V, ox, 0, oz);
    gl.uniformMatrix4fv(uArch.mv, false, M_MV);
  }
  /* pass A — opaque architecture, floors withheld */
  for (let ri = 0; ri < nearRooms.length; ri++){
      const { r, ox, oz, vis } = nearRooms[ri];
      if (!r.vao) continue;
      if (!vis) continue;
      archRoomUniforms(r, ox, oz);
      gl.bindVertexArray(r.vao);
      gl.drawElements(gl.TRIANGLES, r.floorStart, gl.UNSIGNED_SHORT, 0);
    }

  /* pass B — the world below the floor: mirrored paintings, glass, flames.
     These use visR, not vis. A doorway aperture bounds where a room can be seen
     *directly*; the mirror image of that room lands in the floor at your feet,
     which the aperture says nothing about. Portal-culling this pass dropped the
     reflections of paintings in neighbouring rooms — 0.6% of the frame, and
     obvious once seen. The mirrored room box is the honest test.
     The floor then covers them at slight transparency: a polished sheen. */
  const nowMs = performance.now();
  if (reflecting()){
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
      const { r, ox, oz, visR } = midRooms[ri];
      if (!r.vao) continue;
      if (!visR) continue;
      const m = r.mood;
      gl.uniform3f(uPaint.uFog, fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
      const nl = packLights(r, ox, oz);
      gl.uniform1i(uPaint.uNL, nl);
      gl.uniform4fv(uPaint.uLPos, r.lpos);
      gl.uniform4fv(uPaint.uLDir, r.ldir);
      gl.uniform4fv(uPaint.uLCol, r.lcol);
      mulT(M_MV, M_V, ox, 0, oz);
      gl.uniformMatrix4fv(uPaint.uMV, false, M_MV);
      for (const A of r.artworks){
        if (!A.tex && !A.override) continue;
        paintBasis(A, PB);
        const nvx = M_V[0]*PB.n[0] + M_V[4]*PB.n[1] + M_V[8]*PB.n[2];
        const nvy = M_V[1]*PB.n[0] + M_V[5]*PB.n[1] + M_V[9]*PB.n[2];
        const nvz = M_V[2]*PB.n[0] + M_V[6]*PB.n[1] + M_V[10]*PB.n[2];
        gl.uniform3f(uPaint.uN, nvx, nvy, nvz);
        const fade = (REDUCED || frozenT !== null) ? 1 : Math.min(1, (nowMs - A.fadeAt) / 1400);
        gl.uniform3f(uPaint.uO, PB.o[0], -PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, 0, -A.h, 0);
        gl.uniform1f(uPaint.uFade, fade * 0.72);
        gl.uniform1f(uPaint.uEm, ambLum(r));
        gl.uniform1f(uPaint.uGlaze, A.override ? 1 : 0);
        gl.bindTexture(gl.TEXTURE_2D, A.override ? A.override : A.tex.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (WIN.on && r.windows.length){
        gl.uniform1i(uPaint.uNL, 0);
        gl.uniform1f(uPaint.uFade, 0.85);
        gl.uniform1f(uPaint.uEm, 1.65);
        gl.uniform1f(uPaint.uGlaze, 0);
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
      gl.uniform1f(uFlame.uTime, frozenT !== null ? frozenT : (performance.now() % 300000)/1000);
      gl.uniform1f(uFlame.uMY, 1);
      gl.uniform3f(uFlame.uCol, 0.34, 0.21, 0.09);
      for (let ri = 0; ri < midRooms.length; ri++){
        const { r, ox, oz, visR } = midRooms[ri];
        if (!r.nFlames || !r.flameVAO) continue;
        if (!visR) continue;
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
  gl.uniform1f(uArch.alpha, reflecting() ? 0.87 : 1.0);
  for (let ri = 0; ri < nearRooms.length; ri++){
      const { r, ox, oz, vis } = nearRooms[ri];
      if (!r.vao) continue;
      if (!vis) continue;
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
      const { r, ox, oz, vis } = midRooms[ri];
      if (!r.vao) continue;
      if (!vis) continue;
      let any = (WIN.on && r.windows.length > 0) || !!r.pedestal;
      if (!any) for (const A of r.artworks) if (A.tex || A.ptex || A.override){ any = true; break; }
      if (!any) continue;
      const m = r.mood;
      gl.uniform3f(uPaint.uFog, fogCur[0]+m[0]*.5, fogCur[1]+m[1]*.5, fogCur[2]+m[2]*.5);
      const nl = packLights(r, ox, oz);
      gl.uniform1i(uPaint.uNL, nl);
      gl.uniform4fv(uPaint.uLPos, r.lpos);
      gl.uniform4fv(uPaint.uLDir, r.ldir);
      gl.uniform4fv(uPaint.uLCol, r.lcol);
      mulT(M_MV, M_V, ox, 0, oz);
      gl.uniformMatrix4fv(uPaint.uMV, false, M_MV);
      /* ————— contact shadows —————
         They used to be centred under whatever cast them and drawn at a fixed
         strength whatever the lamps were doing, which is a smudge rather than
         a shadow: a bench in the corner threw its darkness straight down while
         the only light in the room was overhead at the centre, and every blob
         stayed exactly as dark with the lamps out.

         There is no shadow atlas here and there should not be. The only things
         standing on a floor are one bench and one pedestal, both axis-aligned
         boxes at known positions under a known light — the offset and scale a
         shadow map would compute can be computed directly, for none of the
         cost. What an atlas would add over this is self-shadowing on moulding
         and chandelier arms, which at these sizes is not worth a depth pass
         per room. */
      gl.uniform1f(uPaint.uAT, 1);
      gl.uniform1f(uPaint.uEm, 0);
      gl.uniform1f(uPaint.uGlaze, 0);
      gl.uniform1i(uPaint.uNL, 0);
      gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      /* How much shadow there is to cast at all. With the lamps out only the
         candles burn, and a candle at the ceiling throws almost nothing. */
      const shLit = lightsOn ? 1 : 0.28;
      /* The room's own downlight, which is what grounds anything on the floor.
         Its height above the floor sets how far a shadow is thrown outward. */
      const fill = r.ownLights.find(l => l.fill && !l.off);
      const lx = fill ? fill.p[0] : 0, ly = fill ? fill.p[1] : H - 1.15, lz = fill ? fill.p[2] : 0;
      for (const A of r.artworks){
        SHA.wall = A.wall; SHA.u = A.u; SHA.hangY = A.hangY;
        SHA.w = A.w + 0.44; SHA.h = A.h + 0.44;
        paintBasis(SHA, PB, 0.006);
        /* A picture light hangs above the work and slightly out from the wall,
           so a frame throws downward. It used to be a halo sitting dead centre
           behind the frame. */
        PB.o[1] -= 0.115;
        gl.uniform3f(uPaint.uN,
          M_V[0]*PB.n[0] + M_V[8]*PB.n[2],
          M_V[1]*PB.n[0] + M_V[9]*PB.n[2],
          M_V[2]*PB.n[0] + M_V[10]*PB.n[2]);
        gl.uniform3f(uPaint.uO, PB.o[0], PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, PB.v[0], PB.v[1], PB.v[2]);
        gl.uniform1f(uPaint.uFade, 0.55 * shLit);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.uniform3f(uPaint.uN, M_V[4], M_V[5], M_V[6]);   // floor blobs face up
      /* Where a box of height `top` standing at (x,z) throws its shadow, and
         how much it spreads: straight down beneath the lamp, stretching away
         from it and softening as the object sits further out. */
      function floorBlob(x, z, hx, hz, top, alpha){
        const k = top / Math.max(0.35, ly - top);      // similar triangles
        const cx = x + (x - lx)*k, cz = z + (z - lz)*k;
        const spread = 1 + k*0.9;
        const sx = (hx*2 + 0.42) * spread, sz = (hz*2 + 0.42) * spread;
        /* Thrown further means softer and fainter — a real penumbra widens
           with distance from what casts it. */
        gl.uniform3f(uPaint.uO, cx - sx/2, 0.006, cz - sz/2);
        gl.uniform3f(uPaint.uU, sx, 0, 0);
        gl.uniform3f(uPaint.uV, 0, 0, sz);
        gl.uniform1f(uPaint.uFade, alpha * shLit / (1 + k*1.5));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      /* No floor blobs where the baked map already casts. They used to be the
         only shadow a bench had; stacked on top of a real one they doubled it
         into a black hole. Rooms without a map — a darkroom has no fill light
         — still get the approximation. */
      if (!(shadowsOn && r.shadowTex && r.packFillIdx >= 0)){
        if (r.bench)
          floorBlob(r.bench.x, r.bench.z,
                    r.bench.alongZ ? 0.24 : 0.90, r.bench.alongZ ? 0.90 : 0.24, 0.46, 0.62);
        if (r.pedestal) floorBlob(r.pedestal.x, r.pedestal.z, 0.26, 0.26, 1.05, 0.66);
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
        const fade = (REDUCED || frozenT !== null) ? 1 : Math.min(1, (nowMs - A.fadeAt) / 1400);
        gl.uniform3f(uPaint.uO, PB.o[0], PB.o[1], PB.o[2]);
        gl.uniform3f(uPaint.uU, PB.u[0], PB.u[1], PB.u[2]);
        gl.uniform3f(uPaint.uV, PB.v[0], PB.v[1], PB.v[2]);
        gl.uniform1f(uPaint.uFade, fade);
        gl.uniform1f(uPaint.uEm, ambLum(r));
        gl.uniform1f(uPaint.uGlaze, A.override ? 1 : 0);
        gl.bindTexture(gl.TEXTURE_2D, A.override ? A.override : A.tex.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (A.ptex && A.pu !== undefined){
          const horiz = (A.wall==='e'||A.wall==='w');
          const flip = (A.wall==='w'||A.wall==='n') ? -1 : 1;
          const pu0 = flip > 0 ? A.pu - 0.13 : A.pu + 0.13;
          if (horiz){ gl.uniform3f(uPaint.uO, PB.pwallC, 1.235, pu0); gl.uniform3f(uPaint.uU, 0, 0, flip*0.26); }
          else      { gl.uniform3f(uPaint.uO, pu0, 1.235, PB.pwallC); gl.uniform3f(uPaint.uU, flip*0.26, 0, 0); }
          gl.uniform3f(uPaint.uV, 0, 0.13, 0);
          gl.uniform1f(uPaint.uEm, ambLum(r) * 0.85);
          gl.uniform1f(uPaint.uGlaze, 0);
          gl.bindTexture(gl.TEXTURE_2D, A.ptex.tex);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      if (r.pedestal){
        const px = r.pedestal.x, pz = r.pedestal.z;
        gl.uniform1f(uPaint.uFade, 1);
        gl.uniform1f(uPaint.uEm, ambLum(r) * 0.85);
        gl.uniform1f(uPaint.uGlaze, 0);
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
        gl.uniform1f(uPaint.uGlaze, 0);
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
  const shaderT = frozenT !== null ? frozenT : (performance.now() % 300000) / 1000;
  let addOn = false;
  /* candle flames on the chandeliers */
  if (lightsOn){
    for (let ri = 0; ri < midRooms.length; ri++){
      const { r, ox, oz, vis } = midRooms[ri];
      if (!r.nFlames || !r.flameVAO) continue;
      if (!vis) continue;
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
      const { r, ox, oz, vis } = midRooms[ri];
      if (WIN.on || !r.shaft || !r.vao) continue;
      if (!vis) continue;
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
  /** The work as an image, at exactly the size it is painted for the wall.
   *  artHash proves two renderings are identical; this is for the question it
   *  cannot answer — whether a cheaper size still looks like the painting. */
  artPNG(gx, gz, i){
    const r = DBG.artHash(gx, gz, i);
    if (typeof r === 'string') return r;
    return { ...r, png: scratch.toDataURL('image/png') };
  },
  artHash(gx, gz, i){
    preemptArtJobs();
    const r = getRoom(gx, gz), A = r.artworks[i];
    if (!A) return 'no artwork ' + i;
    const [w, h] = TEX_SIZES[A.asp];
    scratch.width = w; scratch.height = h;
    /* Through the gate, at pool size — the same call the painters make, so the
       hash keeps describing what actually hangs even when the gate re-rolled. */
    const g = paintArt(sctx, w, h, A.algo % ALGOS.length, A.seed, A.pal, jitterPal);
    const d = sctx.getImageData(0, 0, w, h).data;
    let hsh = 2166136261 >>> 0;
    for (let j = 0; j < d.length; j += 17) hsh = Math.imul(hsh ^ d[j], 16777619) >>> 0;
    return { algo: A.algo % ALGOS.length, seed: A.seed, gated: g.seed,
             attempts: g.attempts, score: g.score, w, h, hash: hsh };
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
      paintMs: artState.paintMs ? +artState.paintMs.toFixed(0) : null,
      painters: artState.painters === undefined ? null : artState.painters,
      locked,
      auto: auto.on, post: post.on,
      beheld: artState.beheld, queued: artState.queue.length,
      persist: { ...persist },
    };
  },
  cloudState(){ return { on: cloud.on, signedIn: !!cloud.sess, viewing: cloud.viewing, slug: cloud.slug }; },
  /** Pretend to be signed in, so the outbox has somewhere to send. */
  cloudSessForTest(on){ cloud.sess = on ? { access_token: 'test', user: { id: 'test' } } : null; return !!cloud.sess; },
  /** Put a work into the collection without a file picker, then read back what
   *  the gallery would say about it. `where` is a frame key, so the caption can
   *  be checked on the wall rather than only in the office. */
  loanForTest(id, name, note, where){
    curator.uploads.set(id, { id, name, note, blob: null, url: '' });
    if (where) curator.placements.set(where, id);
    return { uploads: curator.uploads.size, placed: !!where };
  },
  /** The single writer both captions go through, exposed so a test can prove
   *  the wall label and the enlarged view render a description identically. */
  fillCaptionForTest(root, d){ fillCaption(root, d); return true; },
  /** What a placard and the enlarged view would print for a frame. One call,
   *  because the whole point of describeWork is that they cannot disagree. */
  caption(gx, gz, i){
    const r = getRoom(gx, gz);
    const A = r && r.artworks && r.artworks[i];
    if (!A) return null;
    const key = artJobKey(r, i);
    /* A frame only carries overrideKey once the loan has actually been hung,
       which needs GL. For a caption test the placement is the fact that
       matters, so stand in for it when one exists. */
    const had = A.overrideKey;
    if (!had && curator.placements.has(key)) A.overrideKey = key;
    const d = describeWork(A);
    A.overrideKey = had;
    return { title: d.title, note: d.note, medium: d.medium, loan: !!d.loan };
  },
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
             packed: packLights(r, 0, 0, true),   // force: the frame cache is keyed to the real offsets
             sample: r.lights && r.lights[0] ? { p: r.lights[0].p, col: r.lights[0].col } : null,
             lpos0: [+r.lpos[0].toFixed(2), +r.lpos[1].toFixed(2), +r.lpos[2].toFixed(2), +r.lpos[3].toFixed(4)] };
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
  /** Adjust the grade live: DBG.grade({exposure:1.9, grain:0.012}). */
  grade(patch){ if (patch) Object.assign(GRADE, patch); return { ...GRADE }; },
  /** Pin animation time so two renders can be compared pixel for pixel.
   *  DBG.freeze(12.5) to pin, DBG.freeze(null) to let it run again.
   *
   *  Covers the shader clock, the grain, *and* the 1400 ms fade a work makes
   *  as it arrives — that last one runs off the wall clock and is not part of
   *  shaderT, so a frozen comparison still drifted with how recently each work
   *  had finished painting. It cost an hour of chasing a determinism bug in
   *  the art worker that did not exist. */
  freeze(t){
    frozenT = (t === undefined || t === null) ? null : +t;
    setPostTime(frozenT === null ? null : () => frozenT);
    return frozenT;
  },
  /** Luminance histogram of the current frame. The colour pipeline cannot be
   *  asserted by eye in CI, but the crush can: with no sRGB encode the lit
   *  scene put 85% of its pixels in the bottom sixteenth of the code range. */
  histogram(steps = 6){
    /* Steps and reads in one call, deliberately. The default framebuffer's
       contents are undefined once the browser has composited, so a read in a
       later turn comes back all zeros. Keep `steps` small — stepping hundreds
       of frames here is enough to kill the software rasteriser CI runs on. */
    for (let i = 0; i < steps; i++) frame(performance.now());
    const w = vpW, h = vpH;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let lo = 255, hi = 0, sum = 0, cnt = 0, bottom = 0;
    for (let i = 0; i < w * h; i += 3){
      const o = i * 4;
      const L = 0.2126*buf[o] + 0.7152*buf[o+1] + 0.0722*buf[o+2];
      if (L < lo) lo = L; if (L > hi) hi = L;
      if (L < 16) bottom++;
      sum += L; cnt++;
    }
    return { mean: +(sum/cnt).toFixed(1), lo: Math.round(lo), hi: Math.round(hi),
             bottom16th: +(100*bottom/cnt).toFixed(1) };
  },
  /** Patch the lighting rig and rebuild every room: DBG.relight({spot:{col:[20,16,11]}}). */
  relight(patch){
    if (patch) for (const k of Object.keys(patch)) Object.assign(RIG[k], patch[k]);
    rebuildWorld();
    return JSON.parse(JSON.stringify(RIG));
  },
  /** Night and day fog colour — the real floor of the image, since every
   *  distant surface is mixed toward it. DBG.fog([r,g,b], [r,g,b]). */
  fog(night, day){
    if (night) for (let i=0;i<3;i++) FOG[i] = night[i];
    if (day)   for (let i=0;i<3;i++) DAY_FOG[i] = day[i];
    return { night: [...FOG], day: [...DAY_FOG] };
  },
  /** Where a sheet of the given size lands inside its mount, for the frame
   *  aspect `asp`. The point of the mount is that this never crops. */
  mount(sw, sh, asp = 'L'){
    const [tw, th] = LOAN_SIZES[asp] || LOAN_SIZES.L;
    return mountRect(sw, sh, tw, th);
  },
  /** Whether an image would be stored lossless. Takes a canvas or a bitmap. */
  uploadKind(src){ return looksLikeLineArt(src) ? 'png' : 'jpeg'; },
  /** What the upload review would pre-fill for a work of this shape. */
  presentation(w, h, lineArt = false){
    return { orientation: orientationOf(w, h), fill: suggestFill(w, h, lineArt) };
  },
  /** Queue a placement write exactly as hanging one does. */
  enqueueForTest(k, id){ enqueue('setPlacement', k, [k, id]); return outbox.items.length; },
  /** The unsent-writes queue: what it holds, and a way to drive it. */
  outbox(act){
    if (act === 'flush') outboxFlush();
    if (act === 'clear'){ outbox.items.length = 0; outbox.tries = 0; outboxSave(); outboxUI(); }
    return { pending: outbox.items.length, tries: outbox.tries,
             kinds: outbox.items.map((i) => i.kind + ':' + i.key) };
  },
  /** The route a wing would take for n works, without hanging anything. */
  wingRoute(n = 12){ return wingRoute(n).map(({gx, gz}) => [gx, gz]); },
  /** Lay the collection out along one walkable route. Returns what it hung. */
  gather(){ return gatherIntoWing(); },
  /** Whether the distant murmur is running, and how loud it sits. */
  murmur(level){
    if (level !== undefined && audio.murmurBus) audio.murmurBus.gain.value = level;
    return { talkers: audio.talkers ? audio.talkers.length : 0,
             level: audio.murmurBus ? +audio.murmurBus.gain.value.toFixed(3) : null };
  },
  /** How many oscillators the current programme is running. */
  audioVoices(){ return audio.voices.length; },
  /** The walk loop drains `audio.stride` in a `while (stride > 0.78)` and
   *  calls footstep() inside it, so footstep writing to `stride` is not a
   *  tidiness question — it pinned the value above the threshold and hung the
   *  tab on the visitor's first step. Cheap to assert, so it is asserted. */
  strideProbe(){
    const before = 0.79, steps = audio.steps;
    audio.stride = before;
    footstep(1.0);
    const after = audio.stride;
    audio.stride = 0;
    return { before, after, ran: audio.steps > steps, ok: audio.ok, muted: audio.muted };
  },
  /** The music programme: DBG.music('Glass'), or nothing to read it. */
  music(name){ if (name !== undefined) setMusic(name); return { now: musicName(), all: PIECES.map((p) => p.name) }; },
  /** Turn the baked shadow maps off, to see what they are actually doing. */
  shadows(on){ if (on !== undefined) shadowsOn = !!on; return shadowsOn; },
  /** Pin the floor reflections on or off; null hands them back to the quality
   *  dial. Pass B redraws the whole visible world mirrored, so this is the
   *  only way to price it against the rest of the frame. */
  reflections(on){ reflectPin = on === undefined || on === null ? null : !!on; return reflecting(); },
  /** Clamp how many lights a wall fragment walks. The room keeps the ones that
   *  shape it — packLights orders fill first — so this prices the loop. */
  maxLights(n){ if (n !== undefined) lightCap = Math.max(0, Math.min(MAX_LIGHTS, n|0)); return lightCap; },
  /** The quality dial's state, including which tiers are on probation. Drives
   *  a fps history through the real judging code so the trap that parked a
   *  machine at 46 fps can be reproduced without owning that machine. */
  perf(fpsHistory){
    if (Array.isArray(fpsHistory)) for (const f of fpsHistory) judgeQuality(f, perfClock += 600);
    return { q: PERF.q, pinned: PERF.pinned, dprCap: dprCap(),
             block: tierBlock.map((b) => Math.max(0, Math.round((b - perfClock)/1000))),
             penalty: tierPenalty.map((p) => p/1000) };
  },
  /** Triangles in a built room — the phase E budget, checkable. */
  roomTris(gx, gz){ const r = rooms.get(roomKey(gx, gz)); return r && r.nIdx ? r.nIdx/3 : 0; },
  /** How many rooms each strategy keeps, and a way to force one of them.
   *  Portal culling must never change a pixel, only how many rooms are asked
   *  to produce it — DBG.culling('frustum') is how that gets proven. */
  culling(mode){
    if (mode) portalCull = mode !== 'frustum';
    let portal = 0, frustum = 0;
    for (const e of nearRooms){
      if (e.vis) portal++;
      if (boxVisible(e.ox, H/2, e.oz, HS, H/2, HS)) frustum++;
    }
    return { near: nearRooms.length, portal, frustum, mode: portalCull ? 'portal' : 'frustum' };
  },
  /** Per-work paint times reported by the painters, newest last. */
  paintLog(){ return (artState.paintLog || []).slice(); },
  /** Switch or read the gallery theme: DBG.theme('graphite'). */
  theme(name){
    if (name) applyTheme(name, true);
    return { name: themeName(), solo: theme().solo, chroma: theme().chroma,
             order: THEME_ORDER.slice() };
  },
  /** Fog extinction per metre — how fast a surface stops being lit and starts
   *  being fog. Dominates every other lighting control. DBG.sigma(0.038). */
  sigma(night, day){ setSigma(night, day); return { night: FOG_SIGMA, day: DAY_SIGMA }; },
  /** Per-channel share of the room fill that keeps burning with the lamps off. */
  candle(v){ if (v) for (let i=0;i<3;i++) CANDLE[i] = v[i]; return [...CANDLE]; },
  /** Ambient base, the other half of the night mood. */
  ambient(v){ if (v !== undefined){ AMB_BASE[0]=v[0]; AMB_BASE[1]=v[1]; AMB_BASE[2]=v[2]; } return [...AMB_BASE]; },
  cloudFetch(fn){ setFetch(fn); return { stubbed: !!fn }; },
  cloudLoadGallery(slug){ return cloudLoadGallery(slug); },
  cloudUpdateUpload(id, patch){ return cloudUpdateUpload(id, patch); },
  /** The advice shown for a raw Supabase auth error. */
  authAdviceForTest(msg){ return authAdvice(msg); },
  /** Run the pre-flight settings check and return whatever it wrote. */
  async authWarnForTest(reset){
    if (reset) authChecked = false;
    authChecked = false;
    await warnAboutConfirmation();
    return document.getElementById('cur-cloud-note').textContent;
  },
});

/* The browser telling us the network is back is a better trigger than any
   timer, and costs nothing while it is not. */
addEventListener('online', () => outboxFlush());

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
                              r.flameVAO = r.flameVBO = null; r.nFlames = 0;
                              /* The baked shadow map died with the context too.
                                 Leaving the stale handle meant bakeShadow saw a
                                 non-null texture, skipped recreating it, and
                                 every room then sampled a dead map — which
                                 reads as fully occluded, so the whole museum
                                 came back at 14% of its light. */
                              r.shadowTex = null; r.shadowIdx = -1; r.packFillIdx = -1; }
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
  setTimeout(() => toggleLegend(false), 11000);   // ? brings it back
});

if (gl){
  initPrograms();
  resize();
  lightsOn = persist.lightsOn !== false;      // both switches remember their setting
  WIN.on = !!persist.shutters;
  swUI();
  /* Before the first room is built: the theme decides the schemes the meshes
     are cut from and the rig genLights reads. */
  if (persist.music) setMusic(persist.music);
  setThemeName(persist.theme || DEFAULT_THEME);
  applyThemeConstants();
  themeUI();
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
