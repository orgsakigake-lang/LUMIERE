import test from 'node:test';
import assert from 'node:assert/strict';

import { Metrics } from '../../src/render/metrics.js';

test('keeps only the newest bounded frame and CPU samples', () => {
  const metrics = new Metrics({ limit: 3 });

  metrics.frame(0, 1);
  metrics.frame(10, 2);
  metrics.frame(30, 3);
  metrics.frame(60, 4);
  metrics.frame(100, 5);

  assert.deepEqual(metrics.snapshot().frames, {
    samples: 3,
    p50Ms: 30,
    p95Ms: 39,
    p99Ms: 39.8,
    cpu: { samples: 3, p50Ms: 4, p95Ms: 4.9, p99Ms: 4.98 },
  });
});

test('summarises room builds with counts and percentiles', () => {
  const metrics = new Metrics({ limit: 8 });
  metrics.roomBuilt(10);
  metrics.roomBuilt(20);
  metrics.roomBuilt(30);
  metrics.roomBuilt(40);

  assert.deepEqual(metrics.snapshot().rooms, {
    built: 4,
    samples: 4,
    totalMs: 100,
    p50Ms: 25,
    p95Ms: 38.5,
  });
});

test('ignores a frame timestamp that moved backwards', () => {
  const metrics = new Metrics();
  metrics.frame(20, 1);
  metrics.frame(10, 2);

  assert.equal(metrics.snapshot().frames.samples, 0);
});

test('reset clears retained samples and room totals', () => {
  const metrics = new Metrics();
  metrics.frame(0, 3);
  metrics.frame(16, 4);
  metrics.roomBuilt(9);
  metrics.reset();

  assert.deepEqual(metrics.snapshot(), {
    frames: {
      samples: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      cpu: { samples: 0, p50Ms: null, p95Ms: null, p99Ms: null },
    },
    rooms: { built: 0, samples: 0, totalMs: 0, p50Ms: null, p95Ms: null },
  });
});
