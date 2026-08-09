/* ═══════════════════════════════════════════════════════════════════
   Procedural surfaces: plaster, parquet, the contact-shadow blob, and
   the sky seen through the windows. All generated once from fixed seeds,
   so they cost nothing after boot and survive context loss for free.
   ═══════════════════════════════════════════════════════════════════ */
import { mulberry32 } from '../world/seed.js';
import { gl } from './gl.js';

export let plasterTex = null, parquetTex = null, shadowTex = null;
/* `srgb` distinguishes colour from data. Albedo is authored in sRGB and must be
   decoded to linear before it reaches the lighting maths — uploading it as
   RGBA8 fed gamma-encoded values into linear equations. Masks are not colour
   and must stay untouched. */
function texFromCanvas(c, repeat, srgb = true){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = Math.floor(Math.log2(Math.max(c.width, c.height))) + 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, c.width, c.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  if (window.__aniso)
    gl.texParameterf(gl.TEXTURE_2D, window.__aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, window.__aniso.max);
  return t;
}
export function makeSurfaceTextures(){
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
    shadowTex = texFromCanvas(c, false, false);   // an alpha mask, not colour
  }
}

/* daylight — a single procedural sky, shared by every window */
export let skyTex = null;
export function ensureSkyTex(){
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
  gl.texStorage2D(gl.TEXTURE_2D, 8, gl.SRGB8_ALPHA8, 256, 384);   // sky is colour
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return skyTex;
}

/** Context loss invalidates every texture handle; the next frame rebuilds them
    from the same seeds, so dropping the references is the whole recovery. */
export function dropSurfaceTextures(){
  plasterTex = parquetTex = shadowTex = skyTex = null;
}

