const valueAt = (values, percentile) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index), high = Math.ceil(index);
  const value = sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  return +value.toFixed(2);
};

const boundedPush = (values, value, limit) => {
  if (!Number.isFinite(value)) return;
  values.push(value);
  if (values.length > limit) values.shift();
};

const summary = (values, percentiles) => Object.fromEntries([
  ['samples', values.length],
  ...percentiles.map(([name, value]) => [name, valueAt(values, value)]),
]);

export class Metrics {
  constructor({ limit = 240 } = {}) {
    this.limit = Math.max(1, limit | 0);
    this.reset();
  }

  frame(timestamp, cpuMs) {
    if (Number.isFinite(this.lastFrameAt) && timestamp >= this.lastFrameAt)
      boundedPush(this.intervals, timestamp - this.lastFrameAt, this.limit);
    if (Number.isFinite(timestamp)) this.lastFrameAt = timestamp;
    boundedPush(this.cpu, cpuMs, this.limit);
  }

  roomBuilt(durationMs) {
    this.roomsBuilt++;
    if (Number.isFinite(durationMs)) this.roomTotalMs += durationMs;
    boundedPush(this.roomDurations, durationMs, this.limit);
  }

  reset() {
    this.lastFrameAt = null;
    this.intervals = [];
    this.cpu = [];
    this.roomDurations = [];
    this.roomsBuilt = 0;
    this.roomTotalMs = 0;
  }

  snapshot(extra = {}) {
    const frames = summary(this.intervals, [['p50Ms', 0.5], ['p95Ms', 0.95], ['p99Ms', 0.99]]);
    frames.cpu = summary(this.cpu, [['p50Ms', 0.5], ['p95Ms', 0.95], ['p99Ms', 0.99]]);
    const rooms = summary(this.roomDurations, [['p50Ms', 0.5], ['p95Ms', 0.95]]);
    rooms.built = this.roomsBuilt;
    rooms.totalMs = +this.roomTotalMs.toFixed(2);
    return { frames, rooms, ...extra };
  }
}
