/* ═══════════════════════════════════════════════════════════════════
   The WebGL2 context and the two helpers that build programs from it.

   This is the keystone of the module split: `gl` was a module-scope let in
   main.js, so every GL-touching subsystem — the post stack, the texture
   pools, the room VAOs — was pinned there with it. It lives here now, as a
   live binding, and those can come out one at a time.

   Deliberately does NOT own initPrograms: that function reaches for every
   program in the app and belongs with the things it wires together.
   ═══════════════════════════════════════════════════════════════════ */
import { trace } from '../config.js';

export const canvas = document.getElementById('gl');

/* A live binding. Importers see the assignment below, and would see a
   reassignment after context loss too. */
export let gl = null;
try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }); }
catch(e){ gl = null; }

if (!gl){
  document.getElementById('nogl').hidden = false;
  document.getElementById('intro').hidden = true;
  console.error('[boot] webgl2 unavailable — museum closed');
} else {
  trace('[boot] gl ok');
}

export function compile(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    console.error('[boot] shader error:', gl.getShaderInfoLog(sh), src);
    throw new Error('shader');
  }
  return sh;
}

export function program(vs, fs){
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
