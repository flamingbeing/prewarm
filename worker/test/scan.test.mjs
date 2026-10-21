// The scan upload route (worker/scan.js): the Access check, what gets through to the study computer, and what never does.
// Access and the study computer are stood in for. Run: node worker/test/scan.test.mjs
import assert from 'node:assert/strict';
import { handleScan, MAX_PHOTO } from '../scan.js';
import { resetAccessCache } from '../access.js';
import worker from '../sites.js';

const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const b64u = x => Buffer.from(typeof x === 'string' ? x : new Uint8Array(x)).toString('base64url');
async function token(claims) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(head + '.' + body)))}`;
}
const env = { ACCESS_TEAM: 'team', SCAN_ACCESS_AUD: 'scanaud', SCAN_ORIGIN: 'https://scan.example.test/', SCAN_CLIENT_ID: 'cid', SCAN_CLIENT_SECRET: 'csecret' };
const later = Math.floor(Date.now() / 1000) + 600;
const good = await token({ aud: ['scanaud'], exp: later, iss: 'https://team.cloudflareaccess.com', email: 'member@example.com' });
const otherAud = await token({ aud: ['aud1'], exp: later, iss: 'https://team.cloudflareaccess.com', email: 'owner@example.com' });

let calls = [];
const fake = reply => async (url, init = {}) => {
  if (String(url) === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  calls.push({ url: String(url), init });
  return reply(url, init);
};
const ok = () => Response.json({ ok: true, pages: ['1'] });
const req = (path, { method = 'GET', jwt, body, type = 'image/jpeg', origin, subject } = {}) => new Request('https://prewarmstudy.anawj.com' + path, {
  method, body, headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...(body ? { 'Content-Type': type } : {}), ...(origin ? { Origin: origin } : {}), ...(subject ? { 'X-Scan-Subject': subject } : {}) },
});
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// not set up: names the missing setting, never a value
let r = await handleScan(req('/scan-api/whoami', { jwt: good }), { ...env, SCAN_CLIENT_SECRET: '' }, fake(ok));
assert.equal(r.status, 503); assert.match((await r.json()).error, /SCAN_CLIENT_SECRET/);

// no token, a token for another Access app, a bad signature: all 401, nothing sent on
resetAccessCache(); calls = [];
for (const jwt of [undefined, otherAud, good.slice(0, -4) + 'AAAA']) {
  r = await handleScan(req(`/scan-api/status/${ID}`, { jwt }), env, fake(ok));
  assert.equal(r.status, 401, 'unsigned in: 401');
}
assert.equal(calls.length, 0, 'nothing reached the study computer');

// whoami
r = await handleScan(req('/scan-api/whoami', { jwt: good }), env, fake(ok));
assert.deepEqual(await r.json(), { email: 'member@example.com' }); assert.equal(calls.length, 0);

// upload goes on with the service token and who sent it; the Access token is not forwarded
r = await handleScan(req(`/scan-api/upload/${ID}/4`, { method: 'POST', jwt: good, body: photo, origin: 'https://prewarmstudy.anawj.com' }), env, fake(ok));
assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, pages: ['1'] });
assert.equal(calls.length, 1);
assert.equal(calls[0].url, `https://scan.example.test/scan-api/upload/${ID}/4`);
const h = calls[0].init.headers;
assert.equal(h['CF-Access-Client-Id'], 'cid'); assert.equal(h['CF-Access-Client-Secret'], 'csecret'); assert.equal(h['X-Scan-User'], 'member@example.com');
assert.equal(h['Cf-Access-Jwt-Assertion'], undefined); assert.equal(h['X-Scan-Subject'], undefined, 'no subject: none passed on');

// the Subject ID typed on the phone goes on with the photo; one with odd characters is refused before anything is sent
calls = [];
r = await handleScan(req(`/scan-api/upload/${ID}/5`, { method: 'POST', jwt: good, body: photo, subject: 'DEMO-01' }), env, fake(ok));
assert.equal(r.status, 200); assert.equal(calls[0].init.headers['X-Scan-Subject'], 'DEMO-01');
calls = [];
r = await handleScan(req(`/scan-api/upload/${ID}/5`, { method: 'POST', jwt: good, body: photo, subject: '<script>' }), env, fake(ok));
assert.equal(r.status, 400); assert.equal(calls.length, 0);

// status
calls = [];
r = await handleScan(req(`/scan-api/status/${ID}`, { jwt: good }), env, fake(ok));
assert.equal(r.status, 200); assert.equal(calls[0].url, `https://scan.example.test/scan-api/status/${ID}`);

// refusals: other site, wrong type, empty, too big, bad ids and paths, wrong method
calls = [];
const up = (o, path = `/scan-api/upload/${ID}/1`) => handleScan(req(path, { method: 'POST', jwt: good, body: photo, ...o }), env, fake(ok));
assert.equal((await up({ origin: 'https://evil.example' })).status, 403);
assert.equal((await up({ type: 'text/html' })).status, 415);
assert.equal((await up({}, `/scan-api/upload/${ID}/0`)).status, 404);
assert.equal((await up({}, `/scan-api/upload/${ID}/15`)).status, 404);
assert.equal((await up({}, `/scan-api/upload/${ID}/010`)).status, 404);
assert.equal((await up({}, '/scan-api/upload/short/1')).status, 404);
assert.equal((await up({}, `/scan-api/upload/${ID}/../1`)).status, 404);
assert.equal((await handleScan(req(`/scan-api/upload/${ID}/1`, { method: 'POST', jwt: good, body: new Uint8Array(0) }), env, fake(ok))).status, 400);
assert.equal((await handleScan(req(`/scan-api/upload/${ID}/1`, { method: 'POST', jwt: good, body: new Uint8Array(MAX_PHOTO + 1) }), env, fake(ok))).status, 413);
assert.equal((await handleScan(req(`/scan-api/status/${ID}`, { method: 'DELETE', jwt: good }), env, fake(ok))).status, 404);
assert.equal((await handleScan(req('/scan-api/anything', { jwt: good }), env, fake(ok))).status, 404);
assert.equal(calls.length, 0, 'refused requests are not passed on');

// the study computer's trouble comes back as a plain message, never its headers or a redirect
r = await handleScan(req(`/scan-api/status/${ID}`, { jwt: good }), env, fake(() => new Response('', { status: 302, headers: { Location: 'https://x.cloudflareaccess.com/' } })));
assert.equal(r.status, 502);
r = await handleScan(req(`/scan-api/status/${ID}`, { jwt: good }), env, fake(() => { throw new Error('down'); }));
assert.equal(r.status, 502);
r = await handleScan(req(`/scan-api/status/${ID}`, { jwt: good }), env, fake(() => new Response('<html>', { status: 500 })));
assert.equal(r.status, 502);
r = await handleScan(req(`/scan-api/status/${ID}`, { jwt: good }), env, fake(() => Response.json({ error: 'no such scan' }, { status: 404 })));
assert.equal(r.status, 404);

// through the Worker: only on the prewarm host; elsewhere /scan-api/ is just a missing file
const ASSETS = { fetch: async () => new Response('nope', { status: 404 }) };
r = await worker.fetch(req('/scan-api/whoami', { jwt: good }), { ASSETS });
assert.equal(r.status, 503, 'prewarm host: routed to the scan handler (not set up here)');
r = await worker.fetch(new Request('https://nuhroster.anawj.com/scan-api/whoami'), { ASSETS });
assert.equal(r.status, 404);
console.log('scan route tests passed');
