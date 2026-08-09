/* ═══════════════════════════════════════════════════════════════════
   Everything synthesized, nothing sampled: distant bells on a seeded
   scheduler and a filtered-noise footstep revoiced per step.
   Call setActive(true) once the visitor is inside — the tab-focus
   handler needs to know whether resuming the context is wanted.
   ═══════════════════════════════════════════════════════════════════ */
import { mulberry32 } from './world/seed.js';
import { flashHint } from './ui/hint.js';

export const audio = { ctx: null, master: null, muted: false, ok: false, active: false,
                stride: 0, arnd: mulberry32(0xA0D10), nextBell: 0, stepBuf: null };
export function initAudio(){
  if (audio.ctx){ audio.ctx.resume().catch(()=>{}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    audio.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.ratio.value = 8; comp.knee.value = 18;
    const master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    audio.master = master;
    /* pad: two detuned saws through a slow-breathing lowpass */
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 360; padF.Q.value = 0.7;
    const padG = ctx.createGain(); padG.gain.value = 0.040;
    padF.connect(padG); padG.connect(master);
    for (const det of [-6, 5]){
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 55; o.detune.value = det;
      o.connect(padF); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain(); lfoG.gain.value = 120;
    lfo.connect(lfoG); lfoG.connect(padF.frequency); lfo.start();
    /* room tone: looped brown noise, well below attention */
    const len = (ctx.sampleRate * 2) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dch = buf.getChannelData(0);
    let lv = 0; const nr = mulberry32(0xB00);
    for (let i = 0; i < len; i++){ lv = (lv + (nr()*2 - 1)*0.02) * 0.997; dch[i] = lv * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 220;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    src.connect(nf); nf.connect(ng); ng.connect(master); src.start();
    /* one footstep grain, revoiced per step */
    const sl = (ctx.sampleRate * 0.075) | 0;
    const sb = ctx.createBuffer(1, sl, ctx.sampleRate);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sl; i++) sd[i] = (nr()*2 - 1) * Math.pow(1 - i/sl, 2.3);
    audio.stepBuf = sb;
    audio.ok = true;
    audio.nextBell = ctx.currentTime + 2.5;
    setInterval(bellScheduler, 100);        // lookahead scheduler, ≥200 ms ahead
  } catch(e){ /* a silent museum is still a museum */ }
}
const BELL_FREQS = [220, 261.63, 293.66, 329.63, 392.00, 440, 523.25, 587.33];
function bellScheduler(){
  if (!audio.ok) return;
  const ctx = audio.ctx;
  while (audio.nextBell < ctx.currentTime + 0.25){
    const t = Math.max(audio.nextBell, ctx.currentTime + 0.02);
    if (!audio.muted) bell(t, BELL_FREQS[Math.floor(audio.arnd()*BELL_FREQS.length)]);
    audio.nextBell += 4 + audio.arnd()*5;
  }
}
export function bell(t, f){
  const ctx = audio.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.10, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 4.2);
  g.connect(audio.master);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  o.connect(g); o.start(t); o.stop(t + 4.4);
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.005;
  o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + 4.4);
}
export function footstep(speed){
  if (!audio.ok || audio.muted) return;
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.stepBuf;
  src.playbackRate.value = 0.8 + audio.arnd()*0.45;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 150 + audio.arnd()*90; bp.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.value = Math.min(0.35, 0.13 + speed*0.045);
  src.connect(bp); bp.connect(g); g.connect(audio.master);
  src.start();
}
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend().catch(()=>{});
  else if (audio.active && !audio.muted) audio.ctx.resume().catch(()=>{});
});
export function toggleMute(){
  if (!audio.ok){ flashHint('this browser keeps the museum silent'); return; }
  audio.muted = !audio.muted;
  audio.master.gain.value = audio.muted ? 0 : 0.9;
  flashHint(audio.muted ? 'sound off' : 'sound on');
}


/** The visitor has entered (or left); gates audio resume on tab focus. */
export function setAudioActive(v){ audio.active = !!v; }
