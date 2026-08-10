/* ═══════════════════════════════════════════════════════════════════
   Post stack: bright pass → separable blur → composite.
   The scene renders into a multisampled RGBA16F target and is blitted
   into a sampleable texture here before any of it is read.
   Takes its dimensions and the fullscreen VAO as arguments rather than
   reaching into renderer state, which is what let it move out at all.
   ═══════════════════════════════════════════════════════════════════ */
import { trace } from '../config.js';
import { gl } from './gl.js';
import { PERF } from './perf.js';

/* The grade, live-tunable. These are the numbers that were hand-fitted around
   a broken colour pipeline: with no sRGB encode the whole frame was displayed
   at L^2.2, so exposure and grain were compensating for a crush rather than
   describing an intent. Now that the encode is correct they mean what they say.
   DBG.grade({...}) adjusts them without a rebuild. */
/* The live grade. Themes overwrite these — see world/themes.js. */
export const GRADE = {
  exposure: 1.35,   // scene-linear multiplier before ACES
  grain: 0.014,     // display-space dither, applied after the sRGB encode
  vignette: 0.34,
  shadowTint: [0.965, 0.99, 1.065],
  lightTint:  [1.045, 1.0,  0.945],
};

/* Overridable so DBG.freeze can pin the grain along with everything else. */
let timeFn = () => (performance.now() % 300000)/1000;
export function setPostTime(fn){ timeFn = fn || (() => (performance.now() % 300000)/1000); }
function postTime(){ return timeFn(); }

export let progBright, progBlur, progComp;
export const uBright = {}, uBlur = {}, uComp = {};
export const post = { on: true, ready: false, w: 0, h: 0, qw: 0, qh: 0,
               fboScene: null, texScene: null, depthRb: null,
               fboMS: null, msColor: null, msDepth: null,
               samples: 0, hdr: false,
               fboA: null, texA: null, fboB: null, texB: null,
               pendingAt: 0 };

/* Two capabilities decide how the scene buffer is built. Probed once, because
   getExtension allocates on first call and this runs on every resize. */
let CAPS = null;
export function postCaps(){
  if (CAPS) return CAPS;
  CAPS = {
    /* Without this, RGBA16F is not colour-renderable and everything above 1.0
       is clipped by the framebuffer before the tonemapper ever sees it —
       which is what made the ACES curve decorative for so long. */
    hdr: !!gl.getExtension('EXT_color_buffer_float'),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES) | 0,
  };
  trace(`[post] hdr=${CAPS.hdr} maxSamples=${CAPS.maxSamples}`);
  return CAPS;
}

/* The context is created with antialias:true, but that only ever applied to
   the default framebuffer — and the only thing drawn there is the fullscreen
   composite triangle, which has no interior edges. Every frame bar, cornice
   and chandelier arm was hard-aliased. MSAA has to live on the scene FBO. */
let forceSamples = null;          // DBG override, for A/B measurement
export function wantSamples(){
  const max = postCaps().maxSamples;
  if (max < 2) return 0;
  if (forceSamples !== null) return Math.min(forceSamples, max);
  return PERF.q >= 2 ? Math.min(4, max) : PERF.q === 1 ? Math.min(2, max) : 0;
}
export function setForcedSamples(n){ forceSamples = (n === null || n === undefined) ? null : (n | 0); }

function makePostTex(w, h, float){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
                float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function freePost(){
  for (const k of ['texScene','texA','texB']) if (post[k]){ gl.deleteTexture(post[k]); post[k] = null; }
  for (const k of ['fboScene','fboA','fboB','fboMS']) if (post[k]){ gl.deleteFramebuffer(post[k]); post[k] = null; }
  for (const k of ['depthRb','msColor','msDepth']) if (post[k]){ gl.deleteRenderbuffer(post[k]); post[k] = null; }
}

export function allocPost(w = post.w, h = post.h){
  freePost();
  const caps = postCaps();
  post.w = w; post.h = h;
  post.qw = Math.max(1, w >> 2); post.qh = Math.max(1, h >> 2);
  post.hdr = caps.hdr;
  post.samples = wantSamples();
  const colorFmt = post.hdr ? gl.RGBA16F : gl.RGBA8;

  /* The resolve target: a plain texture, because post-processing has to sample
     it and you cannot sample a multisampled renderbuffer. */
  post.texScene = makePostTex(post.w, post.h, post.hdr);
  post.fboScene = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboScene);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texScene, 0);

  if (post.samples > 0){
    post.msColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, post.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, post.samples, colorFmt, post.w, post.h);
    post.msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, post.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, post.samples, gl.DEPTH_COMPONENT24, post.w, post.h);
    post.fboMS = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboMS);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, post.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, post.msDepth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE){
      console.warn('[post] multisample target incomplete — falling back to 1 sample');
      gl.deleteFramebuffer(post.fboMS); post.fboMS = null;
      gl.deleteRenderbuffer(post.msColor); post.msColor = null;
      gl.deleteRenderbuffer(post.msDepth); post.msDepth = null;
      post.samples = 0;
    }
  }
  if (post.samples === 0){
    /* No MSAA: depth hangs off the resolve FBO and the scene renders straight
       into it, exactly as before. */
    post.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, post.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, post.w, post.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboScene);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, post.depthRb);
  }

  /* Bloom targets are float too. The bright pass exists to isolate values the
     display cannot show; rounding them to 8 bits on the way into the blur
     throws away the very range that makes a highlight bloom. */
  post.texA = makePostTex(post.qw, post.qh, post.hdr);
  post.fboA = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texA, 0);
  post.texB = makePostTex(post.qw, post.qh, post.hdr);
  post.fboB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, post.fboB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, post.texB, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  post.ready = true;
  trace(`[post] ${post.w}×${post.h} ${post.hdr ? 'RGBA16F' : 'RGBA8'} ${post.samples || 1}× samples`);
}

/** Resolve the multisampled target into the sampleable one. No-op without MSAA. */
function resolveScene(){
  if (!post.fboMS) return;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.fboMS);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.fboScene);
  /* Same rectangle and NEAREST — both are required for a multisample resolve. */
  gl.blitFramebuffer(0, 0, post.w, post.h, 0, 0, post.w, post.h,
                     gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}
export function runPost(quadVAO){
  resolveScene();
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
  gl.viewport(0, 0, post.w, post.h);
  gl.useProgram(progComp);
  gl.uniform1i(uComp.uTex, 0);
  gl.uniform1i(uComp.uBloom, 1);
  gl.uniform1f(uComp.uTime, postTime());
  gl.uniform2f(uComp.uRes, post.w, post.h);
  gl.uniform1f(uComp.uExposure, GRADE.exposure);
  gl.uniform1f(uComp.uGrain, GRADE.grain);
  gl.uniform3fv(uComp.uShadowTint, GRADE.shadowTint);
  gl.uniform3fv(uComp.uLightTint, GRADE.lightTint);
  gl.uniform1f(uComp.uVignette, GRADE.vignette);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, post.texScene);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, post.texA);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
}
/** initPrograms owns program creation; a live binding cannot be assigned from
    the importing module, so it hands the compiled programs back through here. */
export function setPostPrograms(bright, blur, comp){
  progBright = bright; progBlur = blur; progComp = comp;
  /* Also the moment after a lost context, and an extension object does not
     survive one — it has to be requested again on the restored context. The
     memoised CAPS said hdr was still available, allocPost built an RGBA16F
     attachment the new context could not render to, and the museum came back
     as a black screen with "Attachment is not renderable" on every draw. */
  CAPS = null;
}

