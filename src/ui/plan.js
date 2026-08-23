/* ═══════════════════════════════════════════════════════════════════
   The gallery plan.

   A museum hands you a floor plan at the door. This one did not, which
   was survivable while it was flat and one hall looked much like the
   next, and stopped being survivable the moment it grew storeys:
   "where is the way up" and "how much of this have I walked" are
   questions a building answers with a drawing, not with a coordinate
   readout in the corner.

   Nothing in here builds a room. Every line comes from the seed layer,
   which is pure — the door hashes, the stair hash, what kind of room
   sits at a coordinate — so the plan can draw halls the visitor has
   never been near, and a whole storey they are not standing on,
   without meshing a wall, baking a shadow map, or putting anything in
   the room cache for the evictor to find later. Opening the plan costs
   one Canvas2D pass and no GL at all.

   Drawn the way a building's plan is drawn: walls as lines, doorways
   as the gaps in them, a shut door as a boarded opening, a stair as
   its true footprint with an arrow up the run. What the plan will not
   do is spoil the walk — it knows the *shape* of every hall in range,
   because that is what a plan is, and it says what a hall *is* only
   once you have stood in it.
   ═══════════════════════════════════════════════════════════════════ */
import { S, DOORW, STAIR_W } from '../config.js';
import { edgeOpenX, edgeOpenZ, stairUpAt } from '../world/seed.js';
import { roomKey, specialAt, inBounds, sealedAt, stairPlan, SPECIAL } from '../world/rooms.js';

/* Ink and brass, because that is what the museum is. Two weights of
   everything: a hall you have walked is drawn in the darker line. */
const WALL      = 'rgba(201,169,106,.34)';
const WALL_SEEN = 'rgba(201,169,106,.72)';
const FILL      = 'rgba(237,230,216,.04)';
const FILL_SEEN = 'rgba(201,169,106,.10)';
const SHUT      = 'rgba(201,105,90,.85)';
const BRASS     = '#C9A96A';
const BONE      = '#EDE6D8';
const DIM       = 'rgba(169,159,140,.5)';
/* Only ever painted over a hall already visited — see the header. */
const TINT = {
  [SPECIAL.VERMILION]: 'rgba(158,43,37,.34)',
  [SPECIAL.ARCHIVE]:   'rgba(201,169,106,.18)',
  [SPECIAL.DARKROOM]:  'rgba(0,0,0,.55)',
};

const line = (g, x0, y0, x1, y1) => {
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
};

/** Draw the plan of one storey.
 *
 *  `view`:
 *    cx, cz     the room at the middle of the drawing
 *    cols, rows how many halls across and down — odd, so there *is* a middle
 *    gy         which storey is being drawn
 *    you        {gx, gz, gy, x, z, yaw} — the visitor, wherever they are
 *    visited    Set of room keys already walked
 *    loans      Map of room key → how many works hang there
 *    dpr        device pixels per CSS pixel
 *
 *  Returns what it found, so the caller can say it in words.
 */
export function drawPlan(cv, view){
  const dpr = view.dpr || 1;
  const W = cv.width / dpr, H = cv.height / dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.lineCap = 'butt';
  g.lineJoin = 'miter';

  const { cx, cz, cols, rows, gy, you, visited, loans } = view;
  const PAD = 16;
  const cell = Math.floor(Math.min((W - PAD*2) / cols, (H - PAD*2) / rows));
  if (cell < 6) return { halls: 0, works: 0, seen: 0 };
  const ox = Math.round((W - cell*cols) / 2);
  const oy = Math.round((H - cell*rows) / 2);
  /* North is up, so the top row is the *highest* gz. Every mapping below goes
     through these two, and nothing else may assume a direction. */
  const gx0 = cx - ((cols - 1) >> 1);
  const gz1 = cz + ((rows - 1) >> 1);
  const px = (gx) => ox + (gx - gx0) * cell;
  const py = (gz) => oy + (gz1 - gz) * cell;

  let halls = 0, works = 0, seen = 0;

  /* ————— the floors ————— */
  for (let row = 0; row < rows; row++){
    for (let col = 0; col < cols; col++){
      const gx = gx0 + col, gz = gz1 - row;
      if (!inBounds(gx, gz, gy)) continue;      // beyond the boundary nothing exists
      halls++;
      const k = roomKey(gx, gz, gy);
      const walked = visited.has(k);
      if (walked) seen++;
      g.fillStyle = walked ? FILL_SEEN : FILL;
      g.fillRect(px(gx), py(gz), cell, cell);
      /* A hall's *character* is not on the plan until you have been in it. The
         shape of the building is public; what is hanging in the dark room is
         not, until you have stood in the dark room. */
      if (walked){
        const tint = TINT[specialAt(gx, gz, gy)];
        if (tint){ g.fillStyle = tint; g.fillRect(px(gx), py(gz), cell, cell); }
      }
    }
  }

  /* ————— the walls —————
     Filled rectangles, not strokes. A wall between two halls is 0.48 m of a
     14 m bay — 3.4% — so at this scale it genuinely has thickness, and drawing
     it to that thickness is both truer and far more legible: a 1.8 m doorway
     is 13% of a wall, and a 13% break in a hairline is not a break anyone
     sees. Kept even and on integer coordinates, so every edge lands on whole
     pixels rather than straddling two at half strength. */
  const T = Math.max(2, 2 * Math.round(cell * 0.017));
  const DOOR = DOORW / S;                       // a doorway, as a fraction of a wall
  /* One edge is shared by two halls, so it is drawn once — from the hall on
     its west or south side, which is the same rule the door hashes use. */
  const wall = (x0, y0, x1, y1, open, shut, bright) => {
    const horiz = y0 === y1;
    /* a..b along the edge, t thick, `off` across it. */
    const put = (a, b, t, col, off = 0) => {
      g.fillStyle = col;
      if (horiz) g.fillRect(a, y0 + off - t/2, b - a, t);
      else       g.fillRect(x0 + off - t/2, a, t, b - a);
    };
    const col = bright ? WALL_SEEN : WALL;
    const p0 = horiz ? x0 : y0, p1 = horiz ? x1 : y1;
    if (!open){ put(p0, p1, T, col); return; }
    const gap = (p1 - p0) * DOOR, mid = (p0 + p1) / 2;
    put(p0, mid - gap/2, T, col);
    put(mid + gap/2, p1, T, col);
    if (!shut) return;
    /* Boarded, not bricked. Two thin bars across the opening rather than one
       filled block: a filled gap reads as a wall that was always there, and
       this one was not — the visitor met it as a door and found it shut, and
       the plan should tell the same story the building does. */
    for (const o of [-T*1.6, T*1.6])
      put(mid - gap/2, mid + gap/2, Math.max(1, T/2), SHUT, o);
  };

  /* One extra column to the west and one extra row to the south, because an
     edge belongs to the hall on that side of it and the frame's own left and
     bottom walls belong to halls just outside it. */
  for (let row = 0; row <= rows; row++){
    for (let col = -1; col < cols; col++){
      const gx = gx0 + col, gz = gz1 - row;
      const here = inBounds(gx, gz, gy);
      const lit = here && visited.has(roomKey(gx, gz, gy));
      // the east wall, shared with (gx+1, gz)
      const east = inBounds(gx + 1, gz, gy);
      if (here || east){
        const open = edgeOpenX(gx, gz);
        wall(px(gx) + cell, py(gz), px(gx) + cell, py(gz) + cell, open,
             open && (sealedAt(gx, gz, gy, 'e') || sealedAt(gx + 1, gz, gy, 'w')),
             lit || (east && visited.has(roomKey(gx + 1, gz, gy))));
      }
      // the north wall, shared with (gx, gz+1)
      const north = inBounds(gx, gz + 1, gy);
      if (here || north){
        const open = edgeOpenZ(gx, gz);
        wall(px(gx), py(gz), px(gx) + cell, py(gz), open,
             open && (sealedAt(gx, gz, gy, 'n') || sealedAt(gx, gz + 1, gy, 's')),
             lit || (north && visited.has(roomKey(gx, gz + 1, gy))));
      }
    }
  }

  /* ————— the stairs —————
     Their true footprint, from the same plan the treads are built from, so the
     drawing and the building cannot disagree about where the way up is. */
  const k2px = cell / S;                        // metres → pixels
  const drawFlight = (gx, gz, st, up) => {
    const mx = px(gx) + cell/2, my = py(gz) + cell/2;
    const P = (x, z) => [mx + x*k2px, my - z*k2px];
    const alongX = st.axis === 'x';
    /* (u, v) are along the run and across it; which of x/z each one is depends
       on the axis, and nothing below needs to care again. */
    const at = (u, v) => (alongX ? P(u, st.across + v) : P(st.across + v, u));
    const half = STAIR_W / 2;

    g.strokeStyle = BRASS;
    g.globalAlpha = up ? 0.92 : 0.3;            // the flight going down is the fainter one
    g.lineWidth = 1;
    // the two stringers
    line(g, ...at(st.u0, -half), ...at(st.u1, -half));
    line(g, ...at(st.u0,  half), ...at(st.u1,  half));
    // and the treads
    const n = Math.max(3, Math.min(9, Math.round(cell / 7)));
    for (let i = 0; i <= n; i++){
      const u = st.u0 + (st.u1 - st.u0) * (i / n);
      line(g, ...at(u, -half), ...at(u, half));
    }
    /* The arrow runs the way you climb — the convention on every set of
       building drawings there has ever been, and the answer to the only
       question anyone asks a plan about a stair. */
    const dir = up ? st.dir : -st.dir;
    const tipU = up ? st.u1 : st.u0;
    const tip = at(tipU + dir * 0.9, 0);
    const back = at(tipU - dir * 1.1, 0);
    line(g, ...back, ...tip);
    const bx = at(tipU - dir * 0.1, -half * 0.62), by = at(tipU - dir * 0.1, half * 0.62);
    g.beginPath(); g.moveTo(...tip); g.lineTo(...bx); g.lineTo(...by); g.closePath();
    g.fillStyle = BRASS; g.fill();
    g.globalAlpha = 1;
  };

  for (let row = 0; row < rows; row++){
    for (let col = 0; col < cols; col++){
      const gx = gx0 + col, gz = gz1 - row;
      if (!inBounds(gx, gz, gy)) continue;
      /* A stair that leads out of the boundary was never cut through the
         ceiling, so it is not on the plan either. */
      if (stairUpAt(gx, gz, gy) && inBounds(gx, gz, gy + 1))
        drawFlight(gx, gz, stairPlan(gx, gz, gy), true);
      if (stairUpAt(gx, gz, gy - 1) && inBounds(gx, gz, gy - 1))
        drawFlight(gx, gz, stairPlan(gx, gz, gy - 1), false);
    }
  }

  /* ————— what hangs where ————— */
  if (loans && loans.size){
    for (let row = 0; row < rows; row++){
      for (let col = 0; col < cols; col++){
        const gx = gx0 + col, gz = gz1 - row;
        const n = loans.get(roomKey(gx, gz, gy)) | 0;
        if (!n || !inBounds(gx, gz, gy)) continue;
        works += n;
        const shown = Math.min(n, 6);
        const r = Math.max(1.5, cell * 0.035);
        const gap = r * 3;
        const y = py(gz) + cell - Math.max(6, cell * 0.18);
        let x = px(gx) + cell/2 - (shown - 1) * gap / 2;
        g.fillStyle = BRASS;
        for (let i = 0; i < shown; i++, x += gap){
          g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
        }
      }
    }
  }

  /* ————— you ————— */
  const onThisFloor = you.gy === gy;
  const yx = px(you.gx) + cell/2 + you.x * k2px;
  const yy = py(you.gz) + cell/2 - you.z * k2px;
  const inFrame = you.gx >= gx0 && you.gx < gx0 + cols
               && you.gz <= gz1 && you.gz > gz1 - rows;
  if (inFrame){
    if (onThisFloor){
      /* A wedge, pointing where they are looking. World forward is
         (sin yaw, −cos yaw) in x,z; the plan puts +z up, so that same vector
         is (sin yaw, cos yaw) on the page. */
      const fx = Math.sin(you.yaw), fy = Math.cos(you.yaw);
      /* A person is 0.7 m in a 14 m bay — five per cent — and five per cent of
         a cell is a speck nobody can find. This is a map marker rather than a
         figure, so it is drawn at the smallest size that still reads as an
         arrowhead, and capped so a large cell does not turn it into a sail. */
      const L = Math.max(5, Math.min(13, cell * 0.13)), Wd = L * 0.62;
      g.fillStyle = BONE;
      g.beginPath();
      g.moveTo(yx + fx*L, yy + fy*L);
      g.lineTo(yx - fx*L*0.5 - fy*Wd, yy - fy*L*0.5 + fx*Wd);
      g.lineTo(yx - fx*L*0.5 + fy*Wd, yy - fy*L*0.5 - fx*Wd);
      g.closePath(); g.fill();
    } else {
      /* Looking at another storey: they are still somewhere, and saying where
         is the whole reason anyone flicks up a floor to look. */
      g.strokeStyle = DIM; g.lineWidth = 1;
      g.beginPath(); g.arc(yx, yy, Math.max(4, cell*0.15), 0, Math.PI*2); g.stroke();
    }
  }

  /* North and the scale are said in the caption under the drawing rather than
     drawn into a corner of it. There is no corner to spare: the grid is sized
     to fill the page, and a compass rose inside it lands on somebody's hall. */
  return { halls, works, seen, cell };
}
