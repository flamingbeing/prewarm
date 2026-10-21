// worker/routes.js: which folder each address serves, and what it must never serve. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, SITES } from '../routes.js';

const H = 'prewarmstudy.anawj.com';

test('the prewarming host serves its folder at the root (and under its own name)', () => {
  assert.deepEqual(resolve(H, '/'), { file: 'prewarm/' });
  assert.deepEqual(resolve(H, '/js/app.js'), { file: 'prewarm/js/app.js' });
  assert.deepEqual(resolve('PREWARMSTUDY.anawj.com:443', '/'), { file: 'prewarm/' });
  assert.deepEqual(resolve(H, '/prewarm'), { redirect: '/prewarm/' });
  assert.deepEqual(resolve(H, '/prewarm/sw.js'), { file: 'prewarm/sw.js' });
  assert.deepEqual(resolve(H, '/update.html'), { file: 'prewarm/update.html' });
  assert.deepEqual(resolve(H, '/prewarm-update/'), { file: 'prewarm-update/' });
});

test('only the prewarming folders: notes, tools and config stay inside prewarm/ or 404', () => {
  for (const p of ['/wrangler.jsonc', '/AGENTS.md', '/worker/scan.js', '/tools/check.mjs'])
    assert.deepEqual(resolve(H, p), { file: 'prewarm' + p }, p);   // looked up inside prewarm/, where they don't exist
});

test('unknown hosts serve nothing; localhost serves the repo', () => {
  assert.deepEqual(resolve('prewarm.kohwenjun.workers.dev', '/prewarm/'), { notFound: true });
  assert.deepEqual(resolve('apmes.anawj.com', '/prewarm/'), { notFound: true });
  assert.deepEqual(resolve('localhost:8787', '/prewarm/'), { file: 'prewarm/' });
});

test('nothing escapes its folder', () => {
  for (const p of ['/../wrangler.jsonc', '/%2e%2e/x', '/a%2fb', '/a\\b', '/./x'])
    assert.deepEqual(resolve(H, p), { notFound: true }, p);
});

test('every folder in SITES exists', () => {
  for (const [host, s] of Object.entries(SITES))
    for (const f of [s.root, ...Object.values(s.prefixes || {})].filter(Boolean))
      assert.ok(fs.existsSync(new URL(`../../${f}`, import.meta.url)), `${host}: ${f}`);
});
