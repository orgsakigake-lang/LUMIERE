import test from 'node:test';
import assert from 'node:assert/strict';
import { putLocalWork, waitForTransaction } from '../../src/curator/storage.js';

function transaction(outcome = 'complete') {
  const tx = new EventTarget();
  tx.error = outcome === 'complete' ? null : new Error('quota exhausted');
  tx.objectStore = () => ({
    put(value) {
      tx.value = value;
      queueMicrotask(() => tx.dispatchEvent(new Event(outcome)));
    },
  });
  return tx;
}

test('putLocalWork resolves only after transaction completion', async () => {
  const tx = transaction('complete');
  const db = { transaction: () => tx };
  await putLocalWork(db, { id: 'u1', name: 'Study', blob: new Blob(['x']) });
  assert.equal(tx.value.id, 'u1');
});

test('putLocalWork rejects when the transaction aborts after put', async () => {
  const tx = transaction('abort');
  const db = { transaction: () => tx };
  await assert.rejects(
    putLocalWork(db, { id: 'u1', name: 'Study', blob: new Blob(['x']) }),
    /quota exhausted/,
  );
});

test('waitForTransaction rejects an errored transaction', async () => {
  const tx = transaction('error');
  const pending = waitForTransaction(tx);
  queueMicrotask(() => tx.dispatchEvent(new Event('error')));
  await assert.rejects(pending, /quota exhausted/);
});
