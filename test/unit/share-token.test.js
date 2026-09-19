import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
globalThis.location = { hash: '' };
const { generateShareToken, hashShareToken, isShareToken, shareTokenFromLocation } = await import('../../src/cloud/share-token.js');

test('share tokens are opaque, URL-safe, and non-repeatable', () => {
  const first = generateShareToken();
  const second = generateShareToken();
  assert.equal(first.length, 43);
  assert.ok(isShareToken(first));
  assert.notEqual(first, second);
  assert.equal(first.includes('+'), false);
  assert.equal(first.includes('/'), false);
});

test('only the exact token shape is accepted', () => {
  assert.equal(isShareToken('short'), false);
  assert.equal(isShareToken('x'.repeat(43)), true);
  assert.equal(isShareToken('x'.repeat(42) + '='), false);
  assert.equal(isShareToken(null), false);
});

test('token hashes are deterministic and never equal the bearer token', async () => {
  const token = 'A'.repeat(43);
  const digest = await hashShareToken(token);
  assert.equal(digest.length, 64);
  assert.notEqual(digest, token);
  assert.equal(digest, await hashShareToken(token));
  await assert.rejects(() => hashShareToken('bad'), TypeError);
});

test('the token stays in the fragment and malformed fragments are ignored', () => {
  const token = 'A'.repeat(43);
  assert.equal(shareTokenFromLocation(`#share=${token}`), token);
  assert.equal(shareTokenFromLocation(`?share=${token}`), null);
  assert.equal(shareTokenFromLocation('#share=bad'), null);
});
