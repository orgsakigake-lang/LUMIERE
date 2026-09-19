export type Mode = 'entrance' | 'touring' | 'browse' | 'inspect';
export type Point = [number, number];

export function createSession(count: number) {
  const state = { mode: 'entrance' as Mode, artwork: 0 };
  let returnMode: Mode = 'entrance';
  return {
    state,
    open(mode: Exclude<Mode, 'inspect'>) { state.mode = mode; },
    inspect(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError('Unknown artwork');
      if (state.mode !== 'inspect') returnMode = state.mode;
      state.artwork = index;
      state.mode = 'inspect';
    },
    next(direction: number) { state.artwork = (state.artwork + direction % count + count) % count; },
    close() { state.mode = returnMode; },
  };
}

export function fitViewport(width: number, height: number, dpr: number, pixels: number) {
  const scale = Math.min(dpr, Math.sqrt(pixels / Math.max(1, width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function walkable(x: number, z: number) {
  if (Math.abs(x) > 7.45 || z > 8.45 || z < -12.45) return false;
  if (z < -8.2 && Math.abs(x) > 1.15) return false;
  // The bench's collision footprint includes the visitor radius.
  if (Math.abs(x) < 2.15 && z > 0.15 && z < 1.85) return false;
  return true;
}

export function moveVisitor(position: Point, delta: Point): Point {
  if (![...position, ...delta].every(Number.isFinite)) return position;
  const result: Point = [...position];
  for (const axis of [0, 1] as const) {
    const steps = Math.ceil(Math.abs(delta[axis]) / 0.2);
    let clear = true;
    for (let step = 1; step <= steps; step++) {
      const probe: Point = [...result];
      probe[axis] += delta[axis] * step / steps;
      if (!walkable(...probe)) { clear = false; break; }
    }
    if (clear) result[axis] += delta[axis];
  }
  return result;
}

/** Reference-room tour paths detour around the bench, so interruption is safe. */
export function cameraPath(from: Point, to: Point): Point[] {
  const corners: Point[] = [[-2.45, -0.15], [2.45, -0.15], [-2.45, 2.15], [2.45, 2.15]];
  const clear = (a: Point, b: Point) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  };
  const paths = [[from, to], ...corners.map(c => [from, c, to]),
    ...corners.flatMap(a => corners.filter(b => b !== a).map(b => [from, a, b, to]))];
  const length = (path: Point[]) => path.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - path[i][0], point[1] - path[i][1]), 0);
  const candidates = paths.filter(path => path.slice(1).every((point, i) => clear(path[i], point)));
  candidates.sort((a, b) => length(a) - length(b));
  return candidates[0] || [from];
}
