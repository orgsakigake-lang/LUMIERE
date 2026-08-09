/* ═══════════════════════════════════════════════════════════════════
   Pigment. Twelve palettes, plus the HSL round-trip that jitters each
   hanging slightly so no two works share exact colour.
   ═══════════════════════════════════════════════════════════════════ */

export const PALETTES = [
  { name:'Indigo Tide',     paper:'#101A2B', inks:['#E8E3D5','#7FA8C9','#C9A96A','#3D5A80'] },
  { name:'Bone & Soot',     paper:'#1A1815', inks:['#E5DECF','#A39B8B','#6B6357','#8C4A3C'] },
  { name:'Vermilion Study', paper:'#F2E8D8', inks:['#9E2B25','#1C1A17','#C9A96A','#4A443B'] },
  { name:'Winter Lake',     paper:'#E9EDEA', inks:['#2F4550','#586F7C','#9BC1BC','#1C2321'] },
  { name:'Ochre Field',     paper:'#EFE6CE', inks:['#B7791F','#7A5C2E','#3F3A2F','#A63C22'] },
  { name:'Nocturne',        paper:'#12151B', inks:['#C9CBD1','#6E7B8B','#C9A96A','#4A5468'] },
  { name:'Rose Ash',        paper:'#EFE2DC', inks:['#8C5B62','#4A3F41','#C98F7E','#3E5C59'] },
  { name:'Copper Oxide',    paper:'#13221F', inks:['#57BFA5','#2E7566','#C97F4E','#E3E8E4'] },
  { name:'Ultramarine',     paper:'#EDE9DF', inks:['#274690','#1B264F','#576CA8','#B23A48'] },
  { name:'Moss & Iron',     paper:'#E7E4D8', inks:['#4A5D3A','#2C3626','#8B8F6B','#54442B'] },
  { name:'Midnight Garden', paper:'#0C130E', inks:['#9CC5A1','#49A078','#DCE1DE','#C9A96A'] },
  { name:'Tea & Ink',       paper:'#EAE0CC', inks:['#21201D','#57544C','#8C6A3F','#B5AB94'] },
];
export function hexRgb(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
export function rgbHex(r,g,b){
  const c = (v)=>('0'+Math.max(0,Math.min(255,Math.round(v))).toString(16)).slice(-2);
  return '#'+c(r)+c(g)+c(b);
}
/* small deterministic HSL nudge so no two hangings share exact pigment */
export function jitterHex(hex, rnd, dh = 10, dl = 0.05){
  let [r,g,b] = hexRgb(hex).map(v=>v/255);
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
  let h = 0, s = 0;
  if (mx !== mn){
    const d = mx-mn;
    s = l > .5 ? d/(2-mx-mn) : d/(mx+mn);
    h = mx===r ? ((g-b)/d + (g<b?6:0)) : mx===g ? (b-r)/d + 2 : (r-g)/d + 4;
    h /= 6;
  }
  h = (h + (rnd()-.5)*dh/180 + 1) % 1;
  const l2 = Math.max(0, Math.min(1, l + (rnd()-.5)*dl*2));
  const q = l2 < .5 ? l2*(1+s) : l2 + s - l2*s, p = 2*l2 - q;
  const f = (t)=>{ t = (t+1)%1; return t < 1/6 ? p+(q-p)*6*t : t < .5 ? q : t < 2/3 ? p+(q-p)*(2/3-t)*6 : p; };
  return rgbHex(f(h+1/3)*255, f(h)*255, f(h-1/3)*255);
}
export function jitterPal(pi, rnd){
  const P = PALETTES[pi % PALETTES.length];
  return { name: P.name, paper: jitterHex(P.paper, rnd, 6, .02),
           inks: P.inks.map(i => jitterHex(i, rnd)) };
}

