/* ═══════════════════════════════════════════════════════════════════
   Everything synthesized, nothing sampled.

   That is not only a size decision. Music you generate has no licence
   attached to it, cannot be struck from a gallery someone else is
   walking, adds not one byte to a page that ships as a single file, and —
   because it is written by the same seeded generator that paints the
   art — never loops. A visitor who stays an hour hears an hour of music
   that has not happened before.

   Four programmes, plus silence, chosen with `N`. They differ in mode,
   register, pace and voice rather than in melody: what makes a room feel
   calm is mostly how slowly things change and how much space is left
   between them.
   ═══════════════════════════════════════════════════════════════════ */
import { mulberry32 } from './world/seed.js';
import { flashHint } from './ui/hint.js';

export const audio = { ctx: null, master: null, music: null, verb: null, echo: null,
                murmurBus: null, talkers: null,
                muted: false, ok: false, active: false,
                /* `stride` belongs to the walk loop in main.js: distance in
                   metres since the last step. Audio reads the *speed* it is
                   handed and keeps its own left/right flag in `foot` — writing
                   to `stride` from here once turned that loop into an infinite
                   one. See footstep(). */
                stride: 0, foot: 0, steps: 0, arnd: mulberry32(0xA0D10), nextNote: 0,
                stepBuf: null, scuffBuf: null, piece: 1, voices: [] };

/* ————— the programmes —————
   Semitone offsets from the root. Everything is a mode with no minor
   second in it — the interval that makes a chord feel unresolved is the
   one to leave out of music meant to be ignored. */
const MAJOR_PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const MINOR_PENT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const LYDIAN     = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21];

export const PIECES = [
  { name: 'silence',  quiet: true },
  { name: 'Nocturne', root: 220,   scale: MAJOR_PENT, gap: [3.4, 8.0],
    voice: 'bell',  padHz: 55,  padGain: 0.040, padCut: 360, gain: 0.10 },
  { name: 'Glass',    root: 174.6, scale: LYDIAN,     gap: [5.5, 11.0],
    voice: 'bowed', padHz: 43.7, padGain: 0.052, padCut: 300, gain: 0.075 },
  { name: 'Rainfall', root: 349.2, scale: MINOR_PENT, gap: [1.1, 3.2],
    voice: 'pluck', padHz: 65.4, padGain: 0.030, padCut: 420, gain: 0.055 },
  { name: 'Vespers',  root: 130.8, scale: MINOR_PENT, gap: [7.0, 14.0],
    voice: 'reed',  padHz: 32.7, padGain: 0.060, padCut: 240, gain: 0.085 },
];

/** A hall, made out of noise. Four seconds of exponentially decaying
 *  stereo noise is a crude convolution reverb and an entirely convincing
 *  large stone room, which is the one thing every voice here needs to
 *  stop sounding like an oscillator. */
function makeHall(ctx){
  const len = (ctx.sampleRate * 3.2) | 0;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = mulberry32(0x5EA7);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++){
      const t = i / len;
      /* A little pre-delay of near-silence, then a tail that falls away. */
      const env = t < 0.012 ? t / 0.012 : Math.pow(1 - t, 2.6);
      d[i] = (r()*2 - 1) * env * 0.45;
    }
  }
  const cv = ctx.createConvolver(); cv.buffer = buf;
  return cv;
}

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

    /* Everything with a pitch goes through the hall; the room tone and the
       footsteps mostly do not, or the floor turns to soup. */
    const hall = makeHall(ctx);
    const hallG = ctx.createGain(); hallG.gain.value = 0.42;
    hall.connect(hallG); hallG.connect(master);
    audio.verb = hall;

    /* ————— the room answering —————
       A convolution tail alone reads as "somewhere reverberant". What makes a
       hall sound like *stone*, and like a particular size, is the first
       distinct reflection arriving before the tail does. This room is 14 m
       across, so a wall sits 6.76 m away: 13.5 m there and back at 343 m/s is
       39 ms. The second bounce is the far wall — near enough to twice that.

       Both are rolled off, because a real reflection loses its top end to the
       plaster on the way, and a bright echo sounds like a canyon rather than
       a gallery. The feedback is deliberately small: this should read as a
       room, not as an effect, and it has to survive an hour of walking. */
    const echo = ctx.createGain();
    const d1 = ctx.createDelay(0.5); d1.delayTime.value = 0.039;
    const d2 = ctx.createDelay(0.5); d2.delayTime.value = 0.081;
    const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 2600;
    const g1 = ctx.createGain(); g1.gain.value = 0.42;
    const g2 = ctx.createGain(); g2.gain.value = 0.26;
    const fb = ctx.createGain(); fb.gain.value = 0.22;
    echo.connect(d1); echo.connect(d2);
    d1.connect(g1); d2.connect(g2);
    g1.connect(eLP); g2.connect(eLP);
    eLP.connect(master);
    eLP.connect(fb); fb.connect(d2);            // one more bounce, then gone
    eLP.connect(hall);                          // and the tail behind it
    audio.echo = echo;

    /* The music bus, so a programme can be swapped without touching the rest. */
    const music = ctx.createGain(); music.gain.value = 1;
    music.connect(master);
    audio.music = music;

    /* room tone: looped brown noise, well below attention */
    const nr = mulberry32(0xB00);
    const len = (ctx.sampleRate * 2) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dch = buf.getChannelData(0);
    let lv = 0;
    for (let i = 0; i < len; i++){ lv = (lv + (nr()*2 - 1)*0.02) * 0.997; dch[i] = lv * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 220;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    src.connect(nf); nf.connect(ng); ng.connect(master); src.start();

    /* ————— footsteps —————
       One noise burst through a bandpass read as a knock on a door. A shoe
       on a waxed board is two sounds a few milliseconds apart: the weight
       landing, low and short, and the sole brushing the wood, quiet and
       bright. Splitting them is most of the difference. */
    const bl = (ctx.sampleRate * 0.10) | 0;
    const bb = ctx.createBuffer(1, bl, ctx.sampleRate);
    const bd = bb.getChannelData(0);
    for (let i = 0; i < bl; i++){
      const t = i / bl;
      bd[i] = (nr()*2 - 1) * Math.pow(1 - t, 5.5);      // fast, soft thud
    }
    audio.stepBuf = bb;
    const sl = (ctx.sampleRate * 0.055) | 0;
    const sb = ctx.createBuffer(1, sl, ctx.sampleRate);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sl; i++){
      const t = i / sl;
      sd[i] = (nr()*2 - 1) * Math.pow(1 - t, 2.0) * Math.min(1, t*14);
    }
    audio.scuffBuf = sb;

    /* ————— other visitors —————
       Two halls away, through a doorway and a wall. You do not hear words at
       that distance — plaster and air take the consonants first, and what
       arrives is the *rhythm* of speech with the meaning filtered out. So this
       is not an attempt at voices: it is noise shaped by two formant bands,
       opened and closed at a syllable rate, and then rolled off hard enough
       that only the vowel energy survives the journey. Nothing sampled, so no
       one is recorded and nothing is licensed.

       Kept far below the footsteps on purpose. It should be the thing you
       notice you have been hearing, rather than the thing you hear. */
    const murmur = ctx.createGain(); murmur.gain.value = 0.030;
    const mLP = ctx.createBiquadFilter(); mLP.type = 'lowpass';
    mLP.frequency.value = 620; mLP.Q.value = 0.5;      // a wall's worth of loss
    murmur.connect(mLP); mLP.connect(master);
    const mSend = ctx.createGain(); mSend.gain.value = 0.8;
    mLP.connect(mSend); mSend.connect(hall);           // and it arrives with the room on it
    audio.murmurBus = murmur;

    const src2 = ctx.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.start();
    audio.talkers = [];
    for (let v = 0; v < 3; v++){
      /* Each talker is one noise source through a pair of resonances. Different
         fundamentals so the group does not sound like one person. */
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass';
      f1.frequency.value = 380 + v*95; f1.Q.value = 5.5;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass';
      f2.frequency.value = 1050 + v*260; f2.Q.value = 4.0;
      const vg = ctx.createGain(); vg.gain.value = 0;
      src2.connect(f1); src2.connect(f2);
      f1.connect(vg); f2.connect(vg); vg.connect(murmur);
      audio.talkers.push({ g: vg, next: ctx.currentTime + 2 + v*7 });
    }

    audio.ok = true;
    startPiece(audio.piece);
    setInterval(noteScheduler, 120);        // lookahead scheduler
    setInterval(murmurScheduler, 250);
  } catch(e){ /* a silent museum is still a museum */ }
}

/* ————— the pad —————
   Two detuned saws under a slowly breathing lowpass: the bed everything
   else sits on. Rebuilt per programme, because its pitch is the root. */
function startPiece(i){
  const ctx = audio.ctx;
  if (!ctx) return;
  for (const v of audio.voices){ try { v.stop ? v.stop() : v.disconnect(); } catch(e){} }
  audio.voices.length = 0;
  audio.piece = i;
  const P = PIECES[i];
  if (!P || P.quiet) return;

  const f = ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.value = P.padCut; f.Q.value = 0.7;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setTargetAtTime(P.padGain, ctx.currentTime, 1.6);   // fade in, never a click
  f.connect(g); g.connect(audio.music);
  for (const det of [-6, 5]){
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = P.padHz; o.detune.value = det;
    o.connect(f); o.start(); audio.voices.push(o);
  }
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
  const lg = ctx.createGain(); lg.gain.value = P.padCut * 0.33;
  lfo.connect(lg); lg.connect(f.frequency); lfo.start(); audio.voices.push(lfo);
  audio.nextNote = ctx.currentTime + 1.5;
}

/* Speech is phrases, not a texture: a few seconds of syllables, then a gap
   while somebody else answers. Scheduling it that way is most of why this
   reads as people rather than as a filter sweep. */
function murmurScheduler(){
  if (!audio.ok || !audio.talkers) return;
  const ctx = audio.ctx, r = audio.arnd;
  for (const t of audio.talkers){
    /* Muted still has to move the clock forward. Returning early left every
       talker's next phrase in the past, so unmuting after a while spent a
       whole mute's worth of scheduling in one pass — a burst of automation
       for speech nobody was going to hear. Silence is a gap, not a debt. */
    if (audio.muted){ t.next = Math.max(t.next, ctx.currentTime + 4 + r()*20); continue; }
    while (t.next < ctx.currentTime + 0.5){
      const start = Math.max(t.next, ctx.currentTime + 0.05);
      const syllables = 3 + Math.floor(r()*7);
      let at = start;
      for (let i = 0; i < syllables; i++){
        const len = 0.11 + r()*0.13;             // ~4 syllables a second
        const peak = 0.5 + r()*0.5;
        t.g.gain.setTargetAtTime(peak, at, 0.045);
        t.g.gain.setTargetAtTime(0.06, at + len*0.62, 0.055);
        at += len + r()*0.05;
      }
      t.g.gain.setTargetAtTime(0, at, 0.14);
      /* Then a long wait. A gallery is mostly quiet. */
      t.next = at + 6 + r()*22;
    }
  }
}

function noteScheduler(){
  if (!audio.ok) return;
  const P = PIECES[audio.piece];
  if (!P || P.quiet) return;
  const ctx = audio.ctx;
  while (audio.nextNote < ctx.currentTime + 0.3){
    const t = Math.max(audio.nextNote, ctx.currentTime + 0.02);
    if (!audio.muted){
      const step = P.scale[Math.floor(audio.arnd() * P.scale.length)];
      note(P, t, P.root * Math.pow(2, step / 12));
    }
    audio.nextNote += P.gap[0] + audio.arnd() * (P.gap[1] - P.gap[0]);
  }
}

/* ————— why every voice is torn down by hand —————
   A WebAudio node is collected only when nothing downstream still holds it.
   A gain still wired to the convolver is wired to the destination, so it
   lives forever however long ago its source stopped — and a visitor walking
   for a minute leaves a few hundred of them feeding a three-second stereo
   convolution. The audio thread saturates, and because it cannot keep up the
   whole page stutters with it. The original three-node footstep hid this;
   ten nodes and two reverb sends did not.

   So every transient chain is disconnected when its source ends. */
function reap(source, nodes, after = 0.2){
  const done = () => { for (const n of nodes){ try { n.disconnect(); } catch(e){} } };
  source.onended = done;
  /* onended does not fire if the context is suspended mid-sound, so belt and
     braces — a timer that cannot leave the graph holding anything. */
  setTimeout(done, (after + 0.5) * 1000);
}

/** One note in the current programme's voice. */
function note(P, t, f){
  const ctx = audio.ctx;
  const g = ctx.createGain();
  g.connect(audio.music);
  const send = ctx.createGain(); send.gain.value = 0.55;
  g.connect(send); send.connect(audio.verb);

  let dur = 4.4, type = 'sine', harm = 2.005, harmG = 0.35, attack = 0.008;
  if (P.voice === 'bowed'){ dur = 7.5; type = 'triangle'; harm = 3.01; harmG = 0.16; attack = 1.5; }
  if (P.voice === 'pluck'){ dur = 2.2; type = 'triangle'; harm = 2.01; harmG = 0.22; attack = 0.004; }
  if (P.voice === 'reed'){  dur = 9.0; type = 'sine';     harm = 1.503; harmG = 0.28; attack = 2.2; }

  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(P.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0004, t + dur);

  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  o.connect(g); o.start(t); o.stop(t + dur + 0.2);
  const g2 = ctx.createGain(); g2.gain.value = harmG;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * harm;
  o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + dur + 0.2);
  reap(o, [o, o2, g2, send, g], (t - ctx.currentTime) + dur);
}

/** Kept for the bell the gallery rings on its own account. */
export function bell(t, f){ note(PIECES[1], t, f); }

export function footstep(speed){
  if (!audio.ok || audio.muted) return;
  const ctx = audio.ctx;
  const r = audio.arnd;
  /* Heel and toe are not the same weight, so alternate sides slightly.
     This flag is `foot`, not `stride`, and the distinction is load-bearing:
     `stride` is the walk loop's distance accumulator, and it drains it in a
     `while (stride > 0.78)`. Writing `(stride + 1) & 1` back into it pinned
     the value at 1 — forever above the threshold — so the first footstep
     hung the frame and filled the audio graph until the tab died. */
  audio.foot ^= 1;
  audio.steps++;
  const lean = audio.foot ? 1 : 0.88;
  const vol = Math.min(0.22, 0.075 + speed * 0.026) * lean;

  const body = ctx.createBufferSource(); body.buffer = audio.stepBuf;
  body.playbackRate.value = 0.86 + r()*0.28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 210 + r()*70; lp.Q.value = 0.6;
  const bg = ctx.createGain(); bg.gain.value = vol;
  body.connect(lp); lp.connect(bg); bg.connect(audio.master);
  /* The weight of the step is what the room actually returns to you. */
  const be = ctx.createGain(); be.gain.value = 0.5;
  bg.connect(be); be.connect(audio.echo);
  const bv = ctx.createGain(); bv.gain.value = 0.18;
  bg.connect(bv); bv.connect(audio.verb);
  body.start();
  reap(body, [body, lp, bg, be, bv], 0.15);

  /* The sole brushing the board — quiet, brief, and the part your ear
     actually reads as "wood". */
  const scuff = ctx.createBufferSource(); scuff.buffer = audio.scuffBuf;
  scuff.playbackRate.value = 0.9 + r()*0.5;
  const hp = ctx.createBiquadFilter(); hp.type = 'bandpass';
  hp.frequency.value = 2300 + r()*1400; hp.Q.value = 0.8;
  const sg = ctx.createGain(); sg.gain.value = vol * 0.11;
  scuff.connect(hp); hp.connect(sg); sg.connect(audio.master);
  /* The brush of the sole comes back too, brighter and thinner. */
  const se = ctx.createGain(); se.gain.value = 0.42;
  sg.connect(se); se.connect(audio.echo);
  const sv = ctx.createGain(); sv.gain.value = 0.22;
  sg.connect(sv); sv.connect(audio.verb);
  scuff.start(ctx.currentTime + 0.006 + r()*0.004);
  reap(scuff, [scuff, hp, sg, se, sv], 0.1);
}

/** Step to the next programme. Returns its name. */
export function cycleMusic(){
  if (!audio.ok){ flashHint('this browser keeps the museum silent'); return null; }
  startPiece((audio.piece + 1) % PIECES.length);
  const P = PIECES[audio.piece];
  flashHint(P.quiet ? 'the hall is quiet' : `now playing — <b>${P.name}</b>`);
  return P.name;
}
export function musicName(){ return PIECES[audio.piece]?.name ?? 'silence'; }
/** Choose a programme by name or index, for boot and for tests. */
export function setMusic(which){
  const i = typeof which === 'number'
    ? which
    : PIECES.findIndex((p) => p.name.toLowerCase() === String(which).toLowerCase());
  if (i < 0) return musicName();
  if (audio.ok) startPiece(i); else audio.piece = i;
  return musicName();
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
