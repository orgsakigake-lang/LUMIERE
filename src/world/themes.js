/* ═══════════════════════════════════════════════════════════════════
   Gallery themes.

   A theme is not a colour swap. It is the whole room agreeing to serve
   one kind of work: the temperature and level of the light, what the
   walls are made of, how far the air carries, where the grade puts its
   contrast, and what the mounts are cut from.

   The reasoning is the same one a real installer uses. Light is never
   neutral by accident — a 2700 K tungsten lamp is 1 : 0.80 : 0.55, and
   anything it falls on is told that story. That is right for oil, where
   warmth is half the pigment's character, and wrong for graphite, where
   the whole subject is a neutral grey and any cast turns it to brown.
   The walls matter for the same reason: light bounces off them onto the
   work, so a warm wall is a warm lamp you cannot switch off.

   Themes mutate the live constants — RIG, SCHEMES, FOG, AMB_BASE, GRADE,
   MOUNT — rather than being read at every site. This module stays a leaf
   so anything may import it; main.js owns the applying.
   ═══════════════════════════════════════════════════════════════════ */

export const THEMES = {

  /* ————— for painted work: oil, pastel, gouache —————
     The museum's own voice, and the one the generated collection was
     built for. Tungsten at 2700 K, deep warm walls, a night that flatters
     pigment. Warmth here is not nostalgia: pastel and oil hold their
     chroma under a warm lamp and go chalky under a cool one. */
  salon: {
    label: 'Salon',
    forWhat: 'painted work — oil, pastel, gouache',
    solo: false,
    rig: {
      spot:        [11.9, 9.5,  6.6],
      spotVermil:  [13.7, 9.2,  5.7],
      paper:       [4.83, 4.35, 3.82],
      chandelier:  [15.6, 13.2, 9.9],
      chandUp:     [13.8, 10.8, 6.3],
      darkroom:    [26.0, 21.0, 14.7],
      archive:     [11.0, 8.7,  5.8],
      archiveFill: [13.2, 11.4, 9.0],
      sun:         [22.0, 19.7, 14.7],
    },
    scheme: { wall:[0.166,0.150,0.132], floor:[0.105,0.094,0.082],
              ceil:[0.070,0.065,0.058], trim:[0.050,0.046,0.040] },
    chroma: 1,
    fog: [0.0129, 0.0117, 0.0093], sigma: 0.038, daySigma: 0.030,
    amb: [0.090, 0.081, 0.067],
    grade: { exposure: 1.35, grain: 0.014, vignette: 0.34,
             shadowTint: [0.965, 0.99, 1.065], lightTint: [1.045, 1.0, 0.945] },
    mount: { face:'#EDE7DA', bevel:'#FBF7EE', undercut:'rgba(90,80,64,0.34)' },
  },

  /* ————— for monochrome work on paper: pencil, charcoal, ink —————
     Everything here exists to stop colour reaching the sheet. The lamp is
     near-neutral, the walls are a low-chroma grey rather than the salon's
     warm brown, the fog is grey, and the split-tone that gives the salon
     its film look is flattened to almost nothing — teal shadows and amber
     highlights are precisely the contamination a value study cannot take.

     It is also darker and quieter than the salon, so that white rag is the
     brightest thing in the room, and it is `solo`: nothing is generated,
     so the only lit frames are the ones holding your work. Empty frames
     keep their moulding — you need something to aim at to hang — but
     their lamps stay off, and unlit frames disappear into a dark room. */
  graphite: {
    label: 'Graphite',
    forWhat: 'monochrome work on paper — pencil, charcoal, ink',
    solo: true,
    rig: {
      spot:        [9.30, 8.93, 8.84],
      spotVermil:  [9.30, 8.93, 8.84],
      paper:       [5.10, 5.00, 5.10],
      chandelier:  [11.2, 10.9, 11.1],
      chandUp:     [9.60, 9.40, 9.60],
      darkroom:    [17.5, 17.1, 17.4],
      archive:     [7.90, 7.70, 7.85],
      archiveFill: [9.40, 9.20, 9.40],
      sun:         [19.0, 19.2, 19.8],
    },
    scheme: { wall:[0.140,0.143,0.148], floor:[0.086,0.088,0.093],
              ceil:[0.058,0.060,0.064], trim:[0.042,0.043,0.046] },
    chroma: 0.16,
    fog: [0.0112, 0.0116, 0.0124], sigma: 0.038, daySigma: 0.030,
    amb: [0.082, 0.084, 0.089],
    grade: { exposure: 1.28, grain: 0.008, vignette: 0.40,
             shadowTint: [0.995, 0.998, 1.006], lightTint: [1.004, 1.0, 0.994] },
    mount: { face:'#F0F0EE', bevel:'#FBFBFA', undercut:'rgba(70,72,78,0.34)' },
  },

  /* ————— for digital and contemporary work —————
     The white cube, and for once the cliché is correct: screen-born work
     arrives already saturated and high-key, so the room's job is to hold
     no opinion at all. Pale walls, daylight at about 5200 K, air that
     barely carries, and almost no vignette — a white cube that darkens at
     the edges reads as a mistake rather than as atmosphere.

     Walls jump from 17% to 60% albedo here, which is most of a stop of
     bounce, so the lamps and the exposure come down to meet them. */
  studio: {
    label: 'Studio',
    forWhat: 'digital and contemporary work',
    solo: false,
    rig: {
      spot:        [9.60, 9.60, 9.80],
      spotVermil:  [10.4, 9.90, 9.60],
      paper:       [4.60, 4.60, 4.75],
      chandelier:  [7.80, 7.80, 8.05],
      chandUp:     [7.20, 7.20, 7.45],
      darkroom:    [18.0, 18.0, 18.4],
      archive:     [7.20, 7.20, 7.40],
      archiveFill: [7.60, 7.60, 7.85],
      sun:         [18.0, 18.4, 19.2],
    },
    /* The floor carries the parquet texture, which multiplies it down hard —
       at the salon's value it read almost black against these walls, like a
       different building. Polished concrete, not stained oak. */
    scheme: { wall:[0.600,0.604,0.612], floor:[0.475,0.478,0.488],
              ceil:[0.400,0.404,0.412], trim:[0.170,0.172,0.178] },
    chroma: 0.55,
    fog: [0.0460, 0.0468, 0.0490], sigma: 0.028, daySigma: 0.024,
    amb: [0.098, 0.099, 0.103],
    grade: { exposure: 1.06, grain: 0.006, vignette: 0.16,
             shadowTint: [0.998, 1.0, 1.004], lightTint: [1.002, 1.0, 0.998] },
    mount: { face:'#F4F4F3', bevel:'#FCFCFB', undercut:'rgba(64,66,70,0.30)' },
  },
};

export const THEME_ORDER = ['salon', 'graphite', 'studio'];
export const DEFAULT_THEME = 'salon';

/* The live one. Read `theme.solo` and friends; never reassign this binding —
   `setThemeName` swaps its contents so importers keep a valid reference. */
let current = DEFAULT_THEME;
export function themeName(){ return current; }
export function themeIs(name){ return current === name; }
export function theme(){ return THEMES[current] || THEMES[DEFAULT_THEME]; }
export function setThemeName(name){
  current = THEMES[name] ? name : DEFAULT_THEME;
  return current;
}
export function nextThemeName(){
  const i = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length];
}
