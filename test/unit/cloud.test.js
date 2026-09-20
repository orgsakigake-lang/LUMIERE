import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { hostname: 'localhost', search: '', hash: '' };
const { cloud, setFetch, cloudBoot, cloudLoadGallery, cloudLoadMine, cloudSetPublished, cloudClaimSlug, cloudManageShareLink, cloudReplaceBlob, cloudDeleteUpload, cloudUploadBlob } = await import('../../src/cloud/client.js');

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => {
  Object.assign(cloud, { on: true, privateSharing: true, sess: null, viewing: null, published: false, shareToken: null });
  globalThis.location = { search: '?gallery=alice', hash: '' };
  globalThis.history = { replaceState() {} };
  globalThis.localStorage = { getItem: () => null, removeItem() {}, setItem() {} };
});

test('a failed profile read is unavailable, not a missing gallery', async () => {
  setFetch(async () => reply({}, 503));
  assert.equal((await cloudBoot()).mode, 'unreachable');
});

test('a partial collection read never installs a guest gallery', async () => {
  setFetch(async url => url.includes('/profiles?') ? reply([{ id: 'alice' }])
    : url.includes('/uploads?') ? reply({}, 403) : reply([]));
  await assert.rejects(cloudLoadGallery('alice'));
  assert.equal(cloud.viewing, null);
});

test('a failed owner read does not change the known publishing state', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity }; cloud.published = true;
  setFetch(async () => reply({}, 503));
  await assert.rejects(cloudLoadMine());
  assert.equal(cloud.published, true);
});

test('malformed and empty gallery parameters never load the signed-in owner', async () => {
  cloud.sess = { uid: 'bob', expires_at: Infinity };
  let requests = 0;
  setFetch(async () => { requests++; return reply([]); });
  for (const search of ['?gallery=', '?gallery=%3Cscript%3E', '?gallery=alice&gallery=bob']) {
    location.search = search;
    assert.equal((await cloudBoot()).mode, 'missing');
  }
  assert.equal(requests, 0);
});

test('resolving a missing gallery clears a previous guest identity', async () => {
  cloud.viewing = { slug: 'bob', owner: 'bob' };
  setFetch(async () => reply([]));
  assert.equal(await cloudLoadGallery('alice'), null);
  assert.equal(cloud.viewing, null);
});

test('publishing must confirm a changed row before reporting success', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  setFetch(async () => reply([]));
  await assert.rejects(cloudSetPublished(true));
  assert.equal(cloud.published, false);
  setFetch(async (_url, options) => {
    assert.equal(options.headers.Prefer, 'return=representation');
    return reply([{ id: 'alice', published: true }]);
  });
  await cloudSetPublished(true);
  assert.equal(cloud.published, true);
});


test('claiming a gallery name verifies the returned profile row', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  cloud.slug = 'old-name';
  cloud.published = true;

  setFetch(async (_url, options) => {
    assert.equal(options.headers.Prefer, 'resolution=merge-duplicates,return=representation');
    return reply([]);
  });
  await assert.rejects(cloudClaimSlug('new-name'));
  assert.equal(cloud.slug, 'old-name');
  assert.equal(cloud.published, true);

  setFetch(async () => reply([{ id: 'alice', slug: 'new-name', published: false }]));
  await cloudClaimSlug('new-name');
  assert.equal(cloud.slug, 'new-name');
  assert.equal(cloud.published, false);
});

test('gallery slugs resolve with the schema-compatible shape and owner filters', async () => {
  const requested = [];
  setFetch(async url => {
    requested.push(url);
    if (url.includes('/profiles?')) return reply([{ id: 'alice', theme: 'graphite' }]);
    if (url.includes('/uploads?')) return reply([{ id: 'u1', name: 'Study', path: 'alice/u1.jpg' }]);
    return reply([{ k: '3,-4@2:1', upload_id: 'u1' }]);
  });
  location.search = '?gallery=-ALICE';
  const result = await cloudBoot();
  assert.equal(result.mode, 'guest');
  assert.equal(result.data.slug, '-alice');
  assert.deepEqual(result.data.placements, [['3,-4@2:1', 'u1']]);
  assert.equal(result.data.theme, 'graphite');
  assert.ok(requested.slice(1).every(url => url.includes('owner=eq.alice')));
});

test('collection reads carry an abort deadline so a stalled link can recover', async () => {
  const signals = [];
  setFetch(async (_url, options) => { signals.push(options.signal); return reply([]); });
  await cloudLoadGallery('alice');
  assert.equal(signals.length, 1);
  assert.ok(signals.every(signal => signal instanceof AbortSignal));
});

test('a guest link ignores an expired local login and reads as an anonymous visitor', async () => {
  cloud.sess = { uid: 'bob', access_token: 'stale', refresh_token: 'spent', expires_at: 0 };
  const requests = [];
  setFetch(async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    if (url.includes('/auth/')) return reply({}, 400);
    if (options.headers.Authorization !== 'Bearer ' + cloud.key) return reply({}, 401);
    return url.includes('/profiles?') ? reply([{ id: 'alice' }]) : reply([]);
  });
  assert.equal((await cloudBoot()).mode, 'guest');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => !request.url.includes('/auth/') && request.authorization === 'Bearer ' + cloud.key));
  assert.equal(cloud.sess.access_token, 'stale', 'guest navigation must not alter the owner session');
});

test('owner share lifecycle sends bearer-link actions with the signed-in session', async () => {
  cloud.sess = { uid: 'alice', access_token: 'owner-token', expires_at: Infinity };
  let request;
  setFetch(async (url, options) => {
    request = { url, options };
    return reply({ token: 'a'.repeat(43), expiresIn: 60 });
  });
  const result = await cloudManageShareLink('create');
  assert.equal(result.token.length, 43);
  assert.match(request.url, /\/functions\/v1\/manage-share-link$/);
  assert.equal(request.options.headers.Authorization, 'Bearer owner-token');
  assert.deepEqual(JSON.parse(request.options.body), { action: 'create' });
});

test('share fragment loads a private manifest and is removed from the address bar', async () => {
  const token = 'b'.repeat(43);
  location.search = '';
  location.hash = '#share=' + token;
  setFetch(async (url, options) => {
    assert.match(url, /\/functions\/v1\/share-gallery$/);
    assert.equal(options.headers.Authorization, 'Bearer ' + cloud.key);
    return reply({ gallery: { slug: 'alice', uploads: [{ id: 'u1', name: 'Study', path: 'alice/u1.jpg', url: 'https://signed/u1' }], placements: [] } });
  });
  const result = await cloudBoot();
  assert.equal(result.mode, 'guest');
  assert.equal(result.data.slug, 'alice');
  assert.equal(result.data.uploads[0].url, 'https://signed/u1');
  assert.equal(cloud.viewing.slug, 'alice');
});

test('every image in a published collection has a URL, including later rows', async () => {
  setFetch(async url => url.includes('/profiles?') ? reply([{ id: 'alice' }])
    : url.includes('/uploads?') ? reply([{ id: 'one', path: 'alice/one.jpg' }, { id: 'two', path: 'alice/two.jpg' }]) : reply([]));
  const data = await cloudLoadGallery('alice');
  assert.equal(data.uploads[1].url, cloud.url + '/storage/v1/object/public/loans/alice/two.jpg');
});

test('invalid and duplicate secret links never open the signed-in collection', async () => {
  cloud.sess = { uid: 'bob', expires_at: Infinity };
  location.search = '';
  let requests = 0;
  setFetch(async () => { requests++; return reply([]); });
  for (const hash of ['#share=', '#share=bad', '#share=' + 'A'.repeat(43) + '&share=' + 'B'.repeat(43)]) {
    location.hash = hash;
    assert.equal((await cloudBoot()).mode, 'missing');
  }
  assert.equal(requests, 0);
});

test('a private manifest service error is retryable, not a missing collection', async () => {
  location.search = ''; location.hash = '#share=' + 'A'.repeat(43);
  setFetch(async () => reply({}, 503));
  assert.equal((await cloudBoot()).mode, 'unreachable');
});

test('private image signing fails atomically without a public URL fallback', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity }; cloud.published = true; cloud.slug = 'previous';
  setFetch(async url => url.includes('/profiles?') ? reply([{ slug: 'alice', published: false }])
    : url.includes('/uploads?') ? reply([{ id: 'one', bucket: 'private_loans', path: 'alice/one.jpg' }])
    : url.includes('/object/sign/') ? reply({}, 403) : reply([]));
  await assert.rejects(cloudLoadMine());
  assert.equal(cloud.published, true);
  assert.equal(cloud.slug, 'previous');
});

test('private image replacement stays in its bucket and deletes the old private object', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  const requests = [];
  setFetch(async (url, opts) => { requests.push({ url, method: opts.method }); return reply([{ id: 'one' }]); });
  const result = await cloudReplaceBlob('one', 'alice/old.jpg', new Blob(['image']), 'private_loans');
  assert.equal(result.ok, true);
  assert.ok(requests.some(r => r.method === 'POST' && r.url.includes('/object/private_loans/')));
  assert.ok(requests.some(r => r.method === 'DELETE' && r.url.endsWith('/object/private_loans/alice/old.jpg')));
  assert.ok(requests.every(r => !r.url.includes('/object/loans/')));
});

test('private image deletion addresses the recorded bucket', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  const urls = [];
  setFetch(async url => { urls.push(url); return reply({}); });
  assert.equal((await cloudDeleteUpload({ id: 'one', path: 'alice/one.jpg', bucket: 'private_loans' })).ok, true);
  assert.ok(urls.some(url => url.endsWith('/object/private_loans/alice/one.jpg')));
});

test('new private uploads preserve their bucket and actual image MIME type', async () => {
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  const requests = [];
  setFetch(async (url, opts) => { requests.push({ url, opts }); return reply({}); });
  const result = await cloudUploadBlob('Drawing', new Blob(['png'], { type: 'image/png' }));
  assert.equal(result.bucket, 'private_loans');
  assert.equal(requests[0].opts.headers['Content-Type'], 'image/png');
});

test('retrying a revoked private link never restores the owner session', async () => {
  location.search = ''; location.hash = '#share=' + 'A'.repeat(43);
  localStorage.getItem = key => key === 'lumiere_sess' ? JSON.stringify({ uid: 'bob', expires_at: 9999999999999 }) : null;
  history.replaceState = () => { location.hash = ''; };
  const requests = [];
  setFetch(async url => { requests.push(url); return url.includes('/share-gallery') ? reply({}, 404) : reply([]); });
  assert.equal((await cloudBoot()).mode, 'missing');
  assert.equal((await cloudBoot()).mode, 'missing');
  assert.equal(cloud.sess, null);
  assert.ok(requests.every(url => url.includes('/share-gallery')));
});

test('public links include only legacy public assets and their placements', async () => {
  setFetch(async url => url.includes('/profiles?') ? reply([{ id: 'alice' }])
    : url.includes('/uploads?') ? reply([{ id: 'public', path: 'alice/a.jpg' }, { id: 'private', path: 'alice/b.jpg', bucket: 'private_loans' }])
    : reply([{ k: '0,0:0', upload_id: 'public' }, { k: '0,0:1', upload_id: 'private' }]));
  const data = await cloudLoadGallery('alice');
  assert.deepEqual(data.uploads.map(row => row.id), ['public']);
  assert.deepEqual(data.placements, [['0,0:0', 'public']]);
});

test('expired private image URLs are renewed through the guest manifest before use', async () => {
  const { cloudArtworkURL } = await import('../../src/cloud/client.js');
  cloud.shareToken = 'A'.repeat(43);
  cloud.viewing = { private: true };
  const record = { id: 'one', bucket: 'private_loans', url: 'https://old.example/image', urlExpiresAt: 1 };
  let requests = 0;
  setFetch(async (_url, opts) => {
    requests++;
    assert.deepEqual(JSON.parse(opts.body).ids, ['one']);
    return reply({ gallery: { uploads: [{ id: 'one', bucket: 'private_loans', url: 'https://new.example/image' }], placements: [] }, expiresIn: 60 });
  });
  assert.equal(await cloudArtworkURL(record), 'https://new.example/image');
  assert.equal(await cloudArtworkURL(record), 'https://new.example/image');
  assert.equal(requests, 1);
  record.urlExpiresAt = 1;
  setFetch(async () => reply({}, 404));
  await assert.rejects(cloudArtworkURL(record));
});

test('legacy deployments keep uploading without requiring the private migration', async () => {
  cloud.privateSharing = false;
  cloud.sess = { uid: 'alice', expires_at: Infinity };
  const requests = [];
  setFetch(async (url, opts) => { requests.push({ url, opts }); return reply({}); });
  const result = await cloudUploadBlob('Drawing', new Blob(['image']));
  assert.equal(result.bucket, 'loans');
  assert.ok(requests[0].url.includes('/object/loans/'));
  assert.equal('bucket' in JSON.parse(requests[1].opts.body), false);
  await assert.rejects(cloudManageShareLink('create'));
});
