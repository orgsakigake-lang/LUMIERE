import test from 'node:test';
import assert from 'node:assert/strict';
import { planArrangement } from '../../src/curator/arrange.js';

test('automatic arrangement preserves manual placements and matches each work shape', () => {
  const works = [
    { id: 'manual', orientation: 'portrait' },
    { id: 'wide', orientation: 'landscape', featured: true },
    { id: 'square', orientation: 'square' },
  ];
  const slots = [
    { key: '0,0:0', aspect: 'P', priority: 0 },
    { key: '0,0:1', aspect: 'S', priority: 2 },
    { key: '0,0:2', aspect: 'W', priority: 1 },
  ];
  const original = new Map([['0,0:0', 'manual']]);

  const result = planArrangement(works, slots, original);

  assert.deepEqual([...result.placements], [
    ['0,0:0', 'manual'],
    ['0,0:2', 'wide'],
    ['0,0:1', 'square'],
  ]);
  assert.equal(result.added, 2);
  assert.deepEqual(result.unplaced, []);
  assert.deepEqual([...original], [['0,0:0', 'manual']], 'the input map is not mutated');
});

test('automatic arrangement returns a deterministic partial result', () => {
  const works = [
    { id: 'b', orientation: 'landscape' },
    { id: 'a', orientation: 'landscape' },
  ];
  const slots = [{ key: '0,0:0', aspect: 'L', priority: 0 }];

  const first = planArrangement(works, slots, new Map());
  const second = planArrangement(works, slots, new Map());

  assert.deepEqual([...first.placements], [...second.placements]);
  assert.deepEqual([...first.placements], [['0,0:0', 'a']]);
  assert.deepEqual(first.unplaced, ['b']);
});
