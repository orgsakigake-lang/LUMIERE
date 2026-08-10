import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe('the cloud layer', () => {
  test('the archive stub answers every call the real client does', async () => {
    /* The archive build swaps cloud/client.js for an inert stub of the same
       shape. esbuild only notices a missing export at build time, so adding a
       function to the client and forgetting the stub breaks `npm run archive`
       and nothing else — which is exactly what happened when password sign-in
       landed. CI caught it; this catches it a step earlier and says why. */
    const fs = await import('node:fs/promises');
    const names = (src) => new Set(
      [...src.matchAll(/export (?:async function|function|const) (\w+)/g)].map((m) => m[1]));
    const real = names(await fs.readFile('src/cloud/client.js', 'utf8'));
    const stub = names(await fs.readFile('src/cloud/client.stub.js', 'utf8'));
    const missing = [...real].filter((n) => !stub.has(n));
    expect(missing, `client.stub.js is missing: ${missing.join(', ')}`).toEqual([]);
  });

  /* The point of decoupling it: the read calls return plain data and touch
     neither the DOM nor the render scheduler, so they can be driven against a
     stubbed transport with no Supabase project in the loop. */
  test('reads return data against a stubbed transport', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(async () => {
      const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      const seen = [];
      window.DBG.cloudFetch((url) => {
        seen.push(String(url).replace(/^https?:\/\/[^/]+/, ''));
        if (url.includes('/profiles?slug=')) return json([{ id: 'owner-1' }]);
        if (url.includes('/uploads?owner=')) return json([{ id: 'u1', name: 'Study', path: 'owner-1/u1.jpg' }]);
        if (url.includes('/placements?owner=')) return json([{ k: '0,0:2', upload_id: 'u1' }]);
        return json([]);
      });
      const data = await window.DBG.cloudLoadGallery('somebody');
      window.DBG.cloudFetch(null);
      return { data, seen };
    });

    expect(result.data.slug).toBe('somebody');
    expect(result.data.owner).toBe('owner-1');
    expect(result.data.uploads).toHaveLength(1);
    expect(result.data.uploads[0].name).toBe('Study');
    expect(result.data.uploads[0].url).toContain('/storage/v1/object/public/loans/owner-1/u1.jpg');
    expect(result.data.placements).toEqual([['0,0:2', 'u1']]);
    expect(result.seen.some((u) => u.includes('/rest/v1/profiles?slug=eq.somebody'))).toBe(true);
  });

  test('a write that changed nothing is not reported as success', async ({ page }) => {
    /* The bug this exists for, found against the real project: `uploads` had
       policies for select, insert and delete but none for UPDATE. With RLS on
       and no UPDATE policy nobody can update — the owner included — and the
       request does not fail. It matches no rows, and PostgREST answers 200 for
       having done nothing. Every retitle would have returned 200, been thrown
       away by the database, and been marked sent by the outbox.

       The status is therefore not the answer. The row count is. */
    await boot(page);
    const r = await page.evaluate(async () => {
      const reply = (body) => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(body) });
      const out = {};
      window.DBG.cloudSessForTest(true);

      window.DBG.cloudFetch(() => reply([]));            // policy silently forbids it
      out.blocked = await window.DBG.cloudUpdateUpload('u1', { note: 'hello' });

      window.DBG.cloudFetch(() => reply([{ id: 'u1', note: 'hello' }]));
      out.applied = await window.DBG.cloudUpdateUpload('u1', { note: 'hello' });

      window.DBG.cloudFetch(() => Promise.resolve({
        ok: false, status: 403, json: () => Promise.resolve({}) }));
      out.refused = await window.DBG.cloudUpdateUpload('u1', { note: 'hello' });

      /* And the header that makes the count visible at all must be sent. */
      let headers = null;
      window.DBG.cloudFetch((url, opts) => { headers = opts && opts.headers; return reply([{ id: 'u1' }]); });
      await window.DBG.cloudUpdateUpload('u1', { note: 'x' });
      out.prefer = headers && headers.Prefer;

      window.DBG.cloudFetch(null); window.DBG.cloudSessForTest(false);
      return out;
    });
    console.log(`    0 rows → ok=${r.blocked.ok} · 1 row → ok=${r.applied.ok} · 403 → ok=${r.refused.ok}`);

    expect(r.blocked.ok, '200 with zero rows was treated as a successful write').toBe(false);
    expect(r.applied.ok).toBe(true);
    expect(r.refused.ok).toBe(false);
    expect(r.prefer, 'without return=representation the row count is invisible')
      .toContain('return=representation');
  });

  test('a project that will not send mail says so before you wait for it', async ({ page }) => {
    /* The report was "not getting any email confirmations", and the cause was
       not in this codebase at all: the project had Confirm email on, and
       Supabase's built-in sender is rate-limited to about two an hour and
       frequently delivers nothing. The account exists, the password is right,
       and every sign-in fails with "Email not confirmed" forever.

       Nothing here can fix that — it is one toggle in another product. What
       was fixable is that the gallery said "check your email" and stopped,
       which is indistinguishable from being broken. It now reads the project's
       own settings and names the toggle. */
    await boot(page);
    const r = await page.evaluate(async () => {
      const reply = (body) => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(body) });
      const note = document.getElementById('cur-cloud-note');
      const out = {};

      window.DBG.cloudFetch((url) => url.includes('/auth/v1/settings')
        ? reply({ mailer_autoconfirm: false, disable_signup: false, external: { email: true } })
        : reply([]));
      note.textContent = '';
      out.warned = await window.DBG.authWarnForTest();

      // and a project that needs no mail must stay quiet
      note.textContent = '';
      window.DBG.cloudFetch(() => reply({ mailer_autoconfirm: true, external: { email: true } }));
      out.quiet = await window.DBG.authWarnForTest(true);

      out.advice = {
        unconfirmed: window.DBG.authAdviceForTest('Email not confirmed'),
        wrongPw:     window.DBG.authAdviceForTest('Invalid login credentials'),
        exists:      window.DBG.authAdviceForTest('User already registered'),
        limited:     window.DBG.authAdviceForTest('email rate limit exceeded'),
        unknown:     window.DBG.authAdviceForTest('some other failure'),
      };
      window.DBG.cloudFetch(null);
      return out;
    });
    console.log(`    warned: ${r.warned.slice(0, 60)}…`);

    expect(r.warned, 'a confirm-email project must be flagged').toContain('Confirm email');
    expect(r.warned).toContain('Providers');
    expect(r.quiet, 'an auto-confirming project needs no warning').toBe('');
    expect(r.advice.unconfirmed).toContain('Confirm email');
    expect(r.advice.wrongPw).toContain('Create account');
    expect(r.advice.exists).toContain('Sign in');
    expect(r.advice.limited).toContain('rate-limit');
    // anything unrecognised is passed through rather than swallowed
    expect(r.advice.unknown).toBe('some other failure');
  });

  test('a provider redirect is read from the fragment and then erased', async ({ page }) => {
    /* Supabase hands the session back in the URL *fragment* on purpose — a
       fragment is never sent to a server, so the token cannot land in an access
       log, ours or GitHub's. It does land in the address bar, where it would
       survive a copied link, a screenshot or a shoulder, so it has to be read
       once and taken straight back out.

       `uid` comes from the JWT's `sub`, and getting that wrong is quiet rather
       than loud: every row-level-security policy compares against it, so a
       wrong id reads as "your collection is empty" instead of an error. */
    const tok = (sub) => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `${b64({ alg: 'HS256' })}.${b64({ sub, email: 'a@b.c' })}.sig`;
    };
    /* Stubbed before the page evaluates, because the session is consumed during
       boot. Left real, the fake token would 401, the refresh would be refused,
       and the session would be correctly discarded — the right behaviour, and
       the wrong thing to be measuring here. */
    await page.addInitScript(() => {
      window.fetch = (url) => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(String(url).includes('/auth/v1/settings') ? {} : []),
      });
    });
    await page.goto('/?q=0#access_token=' + tok('user-from-google')
                    + '&refresh_token=r-tok&expires_in=3600&token_type=bearer');
    await page.waitForFunction(() => typeof window.DBG?.stats === 'function', null, { timeout: 60_000 });

    const r = await page.evaluate(() => ({
      signedIn: window.DBG.cloudState().signedIn,
      uid: window.DBG.cloudUidForTest(),
      hash: location.hash,
      href: location.href,
    }));
    console.log(`    signedIn=${r.signedIn} uid=${r.uid} hash="${r.hash}"`);

    expect(r.signedIn, 'the redirect did not produce a session').toBe(true);
    expect(r.uid, 'uid must come from the token’s sub, or every read is empty')
      .toBe('user-from-google');
    expect(r.hash, 'the access token was left in the address bar').toBe('');
    expect(r.href).not.toContain('access_token');
  });

  test('a tunnel does not sign you out; a spent token does, loudly', async ({ page }) => {
    /* Two failures that used to be one. Any refresh failure dropped the
       session, so a moment offline signed a visitor out and took the queued
       writes' only route home with it — and it did so silently, leaving the
       office saying "signed in · loans open everywhere" while every write went
       out anonymously, matched no rows under RLS, and came back 200.

       A network error and a refused token are not the same event. */
    await boot(page);
    const r = await page.evaluate(async () => {
      const out = { lost: 0 };
      window.DBG.onAuthLostForTest(() => out.lost++);

      // 1. the network is down mid-refresh — the session must survive
      window.DBG.cloudSessForTest(true, { expired: true });
      window.DBG.cloudFetch(() => Promise.reject(new Error('offline')));
      await window.DBG.cloudUpdateUpload('u1', { note: 'x' }).catch(() => {});
      out.afterOffline = window.DBG.cloudState().signedIn;
      out.lostAfterOffline = out.lost;

      // 2. the refresh is refused — the token is spent, and that is real
      window.DBG.cloudSessForTest(true, { expired: true });
      window.DBG.cloudFetch((url) => url.includes('/auth/v1/token')
        ? Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }));
      await window.DBG.cloudUpdateUpload('u1', { note: 'x' }).catch(() => {});
      out.afterRefusal = window.DBG.cloudState().signedIn;
      out.lostAfterRefusal = out.lost;

      window.DBG.cloudFetch(null); window.DBG.onAuthLostForTest(null);
      window.DBG.cloudSessForTest(false);
      return out;
    });
    console.log(`    offline → signedIn=${r.afterOffline} · refused → signedIn=${r.afterRefusal}`);

    expect(r.afterOffline, 'a network blip signed the visitor out').toBe(true);
    expect(r.lostAfterOffline, 'a network blip announced a sign-out').toBe(0);
    expect(r.afterRefusal, 'a refused refresh left a dead session in place').toBe(false);
    expect(r.lostAfterRefusal, 'the sign-out happened silently').toBe(1);
  });

  test('a failed write is kept and sent when the cloud comes back', async ({ page }) => {
    await boot(page);
    /* Writes used to be fire-and-forget: the local change had already happened,
       so one that did not land left the gallery and the cloud disagreeing until
       the next reload — where the cloud won and the visitor's hanging vanished
       with no explanation. Losing an evening's arranging to a dropped
       connection is not an acceptable failure mode. */
    const r = await page.evaluate(async () => {
      window.DBG.outbox('clear');
      window.DBG.cloudSessForTest(true);
      let allow = false, sent = 0;
      window.DBG.cloudFetch((url, opt) => {
        if (!allow) return Promise.reject(new Error('offline'));
        sent++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      });

      /* Three hangings while the network is down. */
      window.DBG.placeForTest('0,0:0', 'u1');
      window.DBG.outbox('clear');
      for (const k of ['0,0:0', '0,0:1', '0,0:2']) window.DBG.enqueueForTest(k, 'u1');
      await new Promise((res) => setTimeout(res, 400));
      const offline = window.DBG.outbox();

      /* The same frame written again must replace, not stack. */
      window.DBG.enqueueForTest('0,0:1', 'u2');
      const coalesced = window.DBG.outbox();

      allow = true;
      window.DBG.outbox('flush');
      for (let i = 0; i < 40 && window.DBG.outbox().pending > 0; i++)
        await new Promise((res) => setTimeout(res, 100));
      const after = window.DBG.outbox();

      window.DBG.cloudFetch(null);
      window.DBG.cloudSessForTest(false);
      window.DBG.outbox('clear');
      return { offline, coalesced, after, sent };
    });

    console.log(`    held ${r.offline.pending} while offline · `
              + `${r.coalesced.pending} after rewriting one · ${r.after.pending} left after reconnect`);
    expect(r.offline.pending).toBe(3);        // nothing was thrown away
    expect(r.coalesced.pending).toBe(3);      // rewriting a frame replaced it
    expect(r.after.pending).toBe(0);          // and the backlog drained
    expect(r.sent).toBeGreaterThan(0);
  });

  test('a guest is put in front of the work, not at the origin', async ({ page }) => {
    await boot(page);
    /* The failure this guards: works hang wherever the curator walked, so a
       visitor dropped at (0,0) sees generated art, assumes that is all there
       is, and leaves without finding the collection at all. */
    const out = await page.evaluate(() => {
      window.DBG.tp(0, 0);
      const hung = ['7,-4:1', '-2,9:0', '3,3:2'];      // scattered, none at origin
      hung.forEach((k, n) => window.DBG.placeForTest(k, 'u' + n));
      const at = window.DBG.collectionSpawn();
      return { at, origin: [0, 0] };
    });

    expect(out.at).not.toBeNull();
    // nearest by rooms-walked: 3,3 (ring 3) beats 7,-4 (7) and -2,9 (9)
    expect([out.at.gx, out.at.gz]).toEqual([3, 3]);
    expect([out.at.gx, out.at.gz]).not.toEqual(out.origin);
    expect(Number.isFinite(out.at.yaw)).toBe(true);
  });

  test('an unknown gallery name resolves to null, not an exception', async ({ page }) => {
    await boot(page);
    const data = await page.evaluate(async () => {
      window.DBG.cloudFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }));
      const out = await window.DBG.cloudLoadGallery('nobody');
      window.DBG.cloudFetch(null);
      return out;
    });
    expect(data).toBeNull();
  });

  test('the seeded gallery is unaffected when the cloud is unreachable', async ({ page }) => {
    await boot(page);
    // The archival case: no backend at all. Every seeded work is generated
    // locally, so the museum itself must not depend on the network.
    const out = await page.evaluate(async () => {
      const before = window.DBG.artHash(0, 0, 0).hash;
      window.DBG.cloudFetch(() => Promise.reject(new Error('offline')));
      let threw = null;
      try { await window.DBG.cloudLoadGallery('anything'); } catch (e) { threw = String(e.message); }
      const after = window.DBG.artHash(0, 0, 0).hash;
      window.DBG.cloudFetch(null);
      return { before, after, threw, rooms: window.DBG.stats().cached, doors: window.DBG.doors(1, 0) };
    });
    expect(out.after).toBe(out.before);      // the art is untouched by the outage
    expect(out.rooms).toBeGreaterThan(0);
    expect(out.doors).toHaveProperty('e');
  });
});

/* One shared page: entering costs ~12s under SwiftShader, so paying it once
   for the whole group keeps the suite tractable. */
