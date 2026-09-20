const shape = (value) => {
  if (value === 'portrait' || value === 'P') return 'portrait';
  if (value === 'square' || value === 'S') return 'square';
  if (value === 'landscape' || value === 'L' || value === 'W') return 'landscape';
  return 'unknown';
};

const matchCost = (orientation, aspect) => shape(orientation) === shape(aspect) ? 0 : 1;

/**
 * Fill empty frames without disturbing anything the curator placed by hand.
 * Work and frame ordering is explicit so the same collection always gets the
 * same arrangement, independent of upload or Map iteration timing.
 */
export function planArrangement(works, slots, current) {
  const placements = new Map(current);
  const alreadyPlaced = new Set(placements.values());
  const available = slots
    .filter((slot) => !placements.has(slot.key))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  const waiting = works
    .filter((work) => !alreadyPlaced.has(work.id))
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured)
      || String(a.id).localeCompare(String(b.id)));
  const unplaced = [];
  let added = 0;

  for (const work of waiting) {
    let best = -1;
    for (let i = 0; i < available.length; i++) {
      if (best < 0
          || matchCost(work.orientation, available[i].aspect)
             < matchCost(work.orientation, available[best].aspect)) best = i;
    }
    if (best < 0) {
      unplaced.push(work.id);
      continue;
    }
    const [slot] = available.splice(best, 1);
    placements.set(slot.key, work.id);
    added++;
  }

  return { placements, added, unplaced };
}
