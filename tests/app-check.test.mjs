import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/js/firebase-app-check.js', import.meta.url), 'utf8');
const { startAppCheck } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('production ignores development storage and enables refreshing attestation', async () => {
  const environment = { location: { hostname: 'ugrodrigo.github.io' },
    sessionStorage: { getItem() { throw new Error('Must not read development token'); } } };
  const app = {};
  const result = await startAppCheck(app, 'public-site-key', environment, async () => ({
    ReCaptchaEnterpriseProvider: class { constructor(key) { this.key = key; } },
    initializeAppCheck(received, options) { assert.equal(received, app); return options; },
  }));
  assert.equal(result.provider.key, 'public-site-key');
  assert.equal(result.isTokenAutoRefreshEnabled, true);
  assert.equal(environment.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
});

test('local debug credential is opt-in and installed before loading the SDK', async () => {
  for (const token of [null, 'test-only-token']) {
    const environment = { location: { hostname: 'localhost' }, sessionStorage: { getItem: () => token } };
    await startAppCheck({}, 'public-site-key', environment, async () => {
      assert.equal(environment.FIREBASE_APPCHECK_DEBUG_TOKEN, token || undefined);
      return { ReCaptchaEnterpriseProvider: class {}, initializeAppCheck() {} };
    });
  }
});

test('missing configuration and SDK errors propagate instead of silently bypassing App Check', async () => {
  await assert.rejects(startAppCheck({}, '', {}), /site key is missing/);
  await assert.rejects(startAppCheck({}, 'key', { location: { hostname: 'example.com' } },
    async () => { throw new Error('SDK unavailable'); }), /SDK unavailable/);
});
