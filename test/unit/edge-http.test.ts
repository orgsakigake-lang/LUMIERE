import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight, json } from '../../supabase/functions/_shared/http.ts';

test('browser clients can preflight private sharing POST requests', () => {
  const response = preflight(new Request('https://gallery.example/functions/v1/share-gallery', { method: 'OPTIONS' }));
  assert.equal(response?.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-headers')!, /authorization/);
  assert.match(response.headers.get('access-control-allow-methods')!, /POST/);
});

test('private responses and errors are readable cross-origin and never cached', async () => {
  const response = json({ error: 'unavailable' }, 404);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'unavailable' });
  assert.equal(preflight(new Request('https://gallery.example', { method: 'POST' })), null);
});

test('privileged signing accepts only canonical assets owned by the link owner', async () => {
  const { isOwnedAsset } = await import('../../supabase/functions/_shared/asset-path.ts');
  assert.equal(isOwnedAsset('alice', { bucket: 'private_loans', path: 'alice/image.jpg' }), true);
  for (const path of ['bob/image.jpg', 'alice/../bob/image.jpg', 'alice/%2e%2e/bob/image.jpg', 'alice//image.jpg', 'alice/image.jpg?x=1', 'alice/']) {
    assert.equal(isOwnedAsset('alice', { bucket: 'private_loans', path }), false, path);
  }
  assert.equal(isOwnedAsset('alice', { bucket: 'other', path: 'alice/image.jpg' }), false);
});
