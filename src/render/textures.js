/* ═══════════════════════════════════════════════════════════════════
   Procedural surfaces: plaster, parquet, the contact-shadow blob, and
   the sky seen through the windows. All generated once from fixed seeds,
   so they cost nothing after boot and survive context loss for free.
   ═══════════════════════════════════════════════════════════════════ */
import { mulberry32 } from '../world/seed.js';
import { gl } from './gl.js';

export let plasterTex = null, parquetTex = null, shadowTex = null;
export let plasterNrm = null, parquetNrm = null;

/* ————— normals from the albedo —————
   These surfaces already carry their own relief in their brightness: plaster
   blotches are shallow dents, a plank's grain and its butt joints are grooves.
   So the height field is the luminance, and a Sobel over it gives the normal
   — no second authoring pass, and the bumps line up with the marks by
   construction. Uploaded as data, never as colour: a normal map decoded
   through sRGB points the wrong way. */
function normalFromCanvas(src, strength){
  const n = src.width;
  const sd = src.getContext('2d').getImageData(0, 0, n, n).data;
  const out = document.createElement('canvas'); out.width = out.height = n;
  const oc = out.getContext('2d'), oi = oc.createImageData(n, n);
  const L = (x, y) => {
    const i = (((y + n) % n) * n + ((x + n) % n)) * 4;   // wrap: these tile
    return (0.2126*sd[i] + 0.7152*sd[i+1] + 0.0722*sd[i+2]) / 255;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++){
      const dx = (L(x+1,y-1) + 2*L(x+1,y) + L(x+1,y+1))
               - (L(x-1,y-1) + 2*L(x-1,y) + L(x-1,y+1));
      const dy = (L(x-1,y+1) + 2*L(x,y+1) + L(x+1,y+1))
               - (L(x-1,y-1) + 2*L(x,y-1) + L(x+1,y-1));
      let vx = -dx * strength, vy = -dy * strength, vz = 1;
      const il = 1 / Math.hypot(vx, vy, vz);
      const o = (y*n + x)*4;
      oi.data[o]   = (vx*il * 0.5 + 0.5) * 255;
      oi.data[o+1] = (vy*il * 0.5 + 0.5) * 255;
      oi.data[o+2] = (vz*il * 0.5 + 0.5) * 255;
      oi.data[o+3] = 255;
    }
  oc.putImageData(oi, 0, 0);
  return texFromCanvas(out, true, false);
}
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
    plasterNrm = normalFromCanvas(c, 1.5);      // shallow — it is a flat wall
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
    parquetNrm = normalFromCanvas(c, 2.3);      // grain and joints are grooves, not corrugation
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

/* daylight — one town in three painted strips, shared by every window.
   Each strip is a 1024-wide panorama a pane samples a slice of: the sky, a
   far skyline, and a nearer row of roofs. The paint shader continues the
   view ray through the glass to each strip's depth, so the layers slide
   against each other and against the mullions as the visitor walks — which
   is all a real window does. The strips wrap in u (REPEAT), so a slice may
   start anywhere; the sun is painted once into the sky strip, and only the
   panes whose slice faces it get it. Seeded, so every gallery shows the
   same town — variety comes from which slice each wall sees. */
export let skyTex = null;
export function ensureSkyTex(){
  if (skyTex) return skyTex;
  const rnd = (s => () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296))(0xC17F);
  const W = 1024, H = 256;
  const strip = (paint) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    paint(g);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 8, gl.SRGB8_ALPHA8, W, H);   // sky is colour
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);         // a panorama has no ends
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  /* A row of buildings across the whole panorama. Draws from the shared rnd
     stream — order matters, so the strips are painted in a fixed sequence. */
  const roofrow = (g, base, amp, col, lit) => {
    let x = -6 + rnd()*4;
    while (x < W + 4){
      const w = 14 + rnd()*26, h = amp * (0.5 + rnd());
      g.fillStyle = col;
      g.fillRect(x, base - h, w, h + (H - base) + 4);
      if (rnd() < 0.3) g.fillRect(x + w*0.28, base - h - 7, 3, 8);       // a chimney
      if (rnd() < 0.08){                                                 // a spire
        const cx = x + w/2;
        g.beginPath(); g.moveTo(cx - 3.5, base - h);
        g.lineTo(cx, base - h - 15); g.lineTo(cx + 3.5, base - h);
        g.closePath(); g.fill();
      }
      if (lit && rnd() < 0.38){          // a few windows with lamps behind them
        const rows = 1 + (rnd()*2 | 0), cols = 1 + (rnd()*3 | 0);
        g.fillStyle = 'rgba(255,216,150,0.92)';
        for (let ry = 0; ry < rows; ry++)
          for (let cx2 = 0; cx2 < cols; cx2++)
            if (rnd() < 0.7)
              g.fillRect(x + 3 + cx2*((w-6)/Math.max(cols,1)) + rnd()*2,
                         base - h + 6 + ry*9 + rnd()*2, 2.5, 4);
      }
      x += w + 2 + rnd()*8;
    }
  };
  const sky = strip((g) => {
    /* A step deeper than the old #FDF6E3 top: through the emissive and the
       bloom, near-white paint saturated to a flat glare and the clouds
       vanished into it. */
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#F3E4C2'); grad.addColorStop(0.55, '#F2DCAC'); grad.addColorStop(1, '#EBCB8E');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const sun = g.createRadialGradient(672, 74, 6, 672, 74, 110);
    sun.addColorStop(0, 'rgba(255,253,244,0.95)'); sun.addColorStop(0.25, 'rgba(255,244,214,0.45)');
    sun.addColorStop(1, 'rgba(255,244,214,0)');
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    /* Soft cloud banks — without them a sliding sky slides invisibly. Each
       is drawn at x and x±W so a bank straddling the seam wraps cleanly. */
    const bank = (cx, cy, cw) => {
      const cl = g.createRadialGradient(cx, cy, 2, cx, cy, cw);
      cl.addColorStop(0, 'rgba(255,250,236,0.34)'); cl.addColorStop(1, 'rgba(255,250,236,0)');
      g.save(); g.translate(cx, cy); g.scale(1, 0.32); g.translate(-cx, -cy);
      g.fillStyle = cl; g.fillRect(cx - cw, cy - cw, cw*2, cw*2); g.restore();
    };
    for (let i = 0; i < 9; i++){
      const cx = rnd()*W, cy = 26 + rnd()*95, cw = 60 + rnd()*130;
      bank(cx, cy, cw); bank(cx - W, cy, cw); bank(cx + W, cy, cw);
    }
    const hz = g.createLinearGradient(0, H*0.62, 0, H);
    hz.addColorStop(0, 'rgba(233,205,160,0)');
    hz.addColorStop(1, 'rgba(224,194,150,0.6)');
    g.fillStyle = hz; g.fillRect(0, H*0.62, W, H*0.38);
  });
  const town = strip((g) => {          // far: half-dissolved in the haze
    roofrow(g, 168, 18, 'rgba(176,155,148,0.72)', false);
    const hz = g.createLinearGradient(0, 130, 0, H);
    hz.addColorStop(0, 'rgba(233,205,160,0)');
    hz.addColorStop(1, 'rgba(226,196,152,0.55)');
    g.fillStyle = hz; g.fillRect(0, 130, W, H - 130);
  });
  const roofs = strip((g) => {         // nearer: darker, and a few lamps lit
    roofrow(g, 196, 42, 'rgba(124,106,104,0.88)', true);
    const gnd = g.createLinearGradient(0, H - 52, 0, H);
    gnd.addColorStop(0, 'rgba(0,0,0,0)'); gnd.addColorStop(1, 'rgba(210,178,138,0.92)');
    g.fillStyle = gnd; g.fillRect(0, H - 52, W, 52);
  });
  skyTex = [sky, town, roofs];
  return skyTex;
}

/** Context loss invalidates every texture handle; the next frame rebuilds them
    from the same seeds, so dropping the references is the whole recovery. */
export function dropSurfaceTextures(){
  plasterTex = parquetTex = shadowTex = skyTex = null;
  plasterNrm = parquetNrm = null;
}

