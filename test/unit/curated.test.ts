import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, fitViewport, moveVisitor, cameraPath } from '../../src/curated/session.ts';

test('inspection restores the mode that opened it and wraps artwork navigation', () => {
  const session = createSession(6);
  session.open('browse');
  session.inspect(5);
  assert.equal(session.state.mode, 'inspect');
  session.next(1);
  assert.equal(session.state.artwork, 0);
  session.close();
  assert.equal(session.state.mode, 'browse');
  session.open('touring');
  session.inspect(2);
  session.close();
  assert.equal(session.state.mode, 'touring');
});

test('invalid artwork indices cannot poison selection', () => {
  const session = createSession(6);
  assert.throws(() => session.inspect(6), RangeError);
  assert.throws(() => session.inspect(NaN), RangeError);
  assert.equal(session.state.mode, 'entrance');
});

test('viewport respects the total pixel budget on large high-DPI displays', () => {
  const view = fitViewport(3840, 2160, 3, 1_000_000);
  assert.ok(view.width * view.height <= 1_000_000);
  assert.ok(Math.abs(view.width / view.height - 16 / 9) < 0.01);
  assert.deepEqual(fitViewport(800, 600, 1, 2_000_000), { width: 800, height: 600 });
});

test('movement cannot cross exterior walls or the bench', () => {
  assert.deepEqual(moveVisitor([7.4, 0], [1, 0]), [7.4, 0]);
  assert.deepEqual(moveVisitor([0, 3], [0, -2]), [0, 3]);
});

test('movement passes through the central doorway but not its wall', () => {
  assert.deepEqual(moveVisitor([0, -8], [0, -1]), [0, -9]);
  assert.deepEqual(moveVisitor([4, -8], [0, -1]), [4, -8]);
});

test('movement slides along walls and rejects non-finite input', () => {
  assert.deepEqual(moveVisitor([7.4, 4], [1, -0.5]), [7.4, 3.5]);
  assert.deepEqual(moveVisitor([1, 4], [NaN, 1]), [1, 4]);
});

test('a guided transition remains walkable when interrupted beside the bench', () => {
  const path = cameraPath([5.7, 7.5], [-3.5, -4.2]);
  assert.deepEqual(path[0], [5.7, 7.5]);
  assert.deepEqual(path.at(-1), [-3.5, -4.2]);
  for (let i = 1; i < path.length; i++) {
    for (let step = 1; step <= 100; step++) {
      const point = path[i - 1].map((v, axis) => v + (path[i][axis] - v) * step / 100) as [number, number];
      assert.notDeepEqual(moveVisitor(point, [0.01, 0]), point, `trapped at ${point}`);
    }
  }
});
