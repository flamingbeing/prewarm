// worker/sites.js with a stand-in for the static assets. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites.js';

const FILES = { '/prewarm/index.html': '<h1>hi</h1>', '/prewarm/sw.js': '//', '/prewarm-update/index.html': '<h1>update</h1>' };
const env = { ASSETS: { fetch: async req => {
  const p = new URL(req.url).pathname;
  return p in FILES ? new Response(FILES[p], { status: 200 }) : new Response('', { status: 404 });
} } };
const get = (url, method = 'GET') => worker.fetch(new Request(url, { method }), env);

test('serves the folder index, noindex', async () => {
  const r = await get('https://prewarmstudy.anawj.com/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
  assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('folder without a slash redirects; missing files 404; unknown hosts 404', async () => {
  assert.equal((await get('https://prewarmstudy.anawj.com/prewarm')).status, 301);
  assert.equal((await get('https://prewarmstudy.anawj.com/nope.js')).status, 404);
  assert.equal((await get('https://prewarm.kohwenjun.workers.dev/prewarm/')).status, 404);
});

test('the update helper and the app under its own name', async () => {
  assert.equal(await (await get('https://prewarmstudy.anawj.com/prewarm-update/')).text(), '<h1>update</h1>');
  assert.equal((await get('https://prewarmstudy.anawj.com/prewarm/sw.js')).status, 200);
  assert.equal((await get('https://prewarmstudy.anawj.com/sw.js')).status, 200);
});

test('only GET and HEAD', async () => {
  assert.equal((await get('https://prewarmstudy.anawj.com/', 'POST')).status, 405);
});
