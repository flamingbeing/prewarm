// The crop reading route (worker/read.js): Access check, the field allowlist, size caps, and what is sent to the model.
// Access and the Anthropic API are stood in for. Run: node worker/test/read.test.mjs
import assert from 'node:assert/strict';
import { handleRead, parseReading, MAX_CROP, MAX_CROPS } from '../read.js';
import { resetAccessCache } from '../access.js';
import { READ_PATH } from '../routes.js';
import worker from '../sites.js';

const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const b64u = x => Buffer.from(typeof x === 'string' ? x : new Uint8Array(x)).toString('base64url');
async function token(claims) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(head + '.' + body)))}`;
}
const env = { ACCESS_TEAM: 'team', SCAN_ACCESS_AUD: 'scanaud', ANTHROPIC_API_KEY: 'test-key-not-real' };
const later = Math.floor(Date.now() / 1000) + 600;
const good = await token({ aud: ['scanaud'], exp: later, iss: 'https://team.cloudflareaccess.com', email: 'member@example.com' });
const otherAud = await token({ aud: ['other'], exp: later, iss: 'https://team.cloudflareaccess.com', email: 'x@example.com' });

let calls = [];
// the model stub answers by prompt: A -> "12.5", B -> "12.6" (so a disagreement shows), unless told otherwise
const fake = (reply = defaultReply) => async (url, init = {}) => {
  if (String(url) === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  return reply(calls[calls.length - 1]);
};
const defaultReply = c => Response.json({ content: [{ type: 'text', text: c.body.messages[0].content[1].text.startsWith('Transcribe') ? '{"text": "12.6", "legible": false}' : 'Sure: {"text": "12.5", "legible": true}' }] });
const png = n => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n - 8, 1)]).toString('base64');  // n bytes
const req = (body, { jwt = good, method = 'POST', type = 'application/json', origin } = {}) => new Request('https://prewarmstudy.anawj.com' + READ_PATH, {
  method, body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), 'Content-Type': type, ...(origin ? { Origin: origin } : {}) },
});
const crop = id => ({ id, png: png(300) });

// not set up: names the missing setting, never a value
let r = await handleRead(req({}), { ...env, ANTHROPIC_API_KEY: '' }, fake());
assert.equal(r.status, 503); assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);

// no token, another Access app's token, a bad signature: 401 and the model is never asked
resetAccessCache(); calls = [];
for (const jwt of [null, otherAud, good.slice(0, -4) + 'AAAA']) {
  r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')] }, { jwt }), env, fake());
  assert.equal(r.status, 401, String(jwt).slice(-8));
}
assert.equal(calls.length, 0);

// a good request: two reads per crop, in the order of the crops, with the right model settings and key
r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp'), crop('p1.sample_start')] }), env, fake());
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), [
  { id: 'p1.sample_temp', a: { text: '12.5', legible: true }, b: { text: '12.6', legible: false } },
  { id: 'p1.sample_start', a: { text: '12.5', legible: true }, b: { text: '12.6', legible: false } },
]);
assert.equal(calls.length, 4);
const c0 = calls[0];
assert.equal(c0.url, 'https://api.anthropic.com/v1/messages');
assert.equal(c0.init.headers['x-api-key'], 'test-key-not-real');
assert.equal(c0.body.model, 'claude-haiku-5-5'); assert.equal(c0.body.max_tokens, 100); assert.deepEqual(c0.body.thinking, { type: 'disabled' });
assert.equal(c0.body.messages[0].content[0].source.media_type, 'image/png');
const prompts = calls.map(c => c.body.messages[0].content[1].text);
assert.ok(prompts.some(p => p.includes('"Sample temperature" (°C)') && p.includes('a decimal number')), 'label, unit, expectation in prompt A');
assert.ok(prompts.some(p => p.startsWith('Transcribe') && p.includes('a 24-hour clock time')), 'prompt B for a time cell');
assert.ok(prompts.every(p => !p.includes('{label}') && !p.includes('{expect}')));
assert.ok(calls.every(c => c.url.startsWith('https://api.anthropic.com/')), 'nothing goes anywhere else');

// a field with options says so
calls = [];
await handleRead(req({ page: 2, crops: [crop('p2.sample_stage')] }), env, fake());
assert.ok(calls[0].body.messages[0].content[1].text.includes('one of one, two, three'));

// refused before anything is sent: IDs, dates, free text, unknown or odd ids, repeats
for (const id of ['p1.sample_id', 'p1.sample_date', 'p2.sample_note', 'nope', '__proto__', 'constructor', 'toString']) {
  calls = [];
  r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp'), crop(id)] }), env, fake());
  assert.equal(r.status, 400, id); assert.equal(calls.length, 0, 'nothing sent for ' + id);
}
// bad input: 400
const bad = [
  'not json', { page: 0, crops: [crop('p1.sample_temp')] }, { page: 15, crops: [crop('p1.sample_temp')] }, { page: '1', crops: [crop('p1.sample_temp')] },
  { page: 1 }, { page: 1, crops: [] }, { page: 1, crops: [{ id: 'p1.sample_temp' }] }, { page: 1, crops: [{ id: 'p1.sample_temp', png: 'not base64!' }] },
  { page: 1, crops: [{ id: 'p1.sample_temp', png: Buffer.from('GIF89a....').toString('base64') }] },
  { page: 1, crops: [crop('p1.sample_temp'), crop('p1.sample_temp')] },
];
calls = [];
for (const b of bad) assert.equal((await handleRead(req(b), env, fake())).status, 400, JSON.stringify(b).slice(0, 60));
assert.equal(calls.length, 0);

// size caps: a crop of 40 KB is fine, one byte-ish over is not; 40 crops fine, 41 not
r = await handleRead(req({ page: 1, crops: [{ id: 'p1.sample_temp', png: png(MAX_CROP) }] }), env, fake());
assert.equal(r.status, 200);
r = await handleRead(req({ page: 1, crops: [{ id: 'p1.sample_temp', png: png(MAX_CROP + 10) }] }), env, fake());
assert.equal(r.status, 400); assert.match((await r.json()).error, /too big/);
// MAX_CROPS distinct fields would be needed; the cap is checked before the ids, so repeats show it
r = await handleRead(req({ page: 1, crops: Array.from({ length: MAX_CROPS + 1 }, () => crop('p1.sample_temp')) }), env, fake());
assert.equal(r.status, 400); assert.match((await r.json()).error, /At most 40/);
r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')], pad: 'x'.repeat(4e6) }), env, fake());
assert.equal(r.status, 413);

// wrong method, content type, origin
assert.equal((await handleRead(req({}, { method: 'GET' }), env, fake())).status, 405);
assert.equal((await handleRead(req('x', { type: 'text/plain' }), env, fake())).status, 415);
assert.equal((await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')] }, { origin: 'https://evil.example' }), env, fake())).status, 403);

// upstream trouble: 502 with no detail passed on (status, key, body)
for (const reply of [() => new Response('{"error":"secret detail"}', { status: 500 }), () => { throw new Error('network'); }]) {
  r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')] }), env, fake(reply));
  assert.equal(r.status, 502); assert.doesNotMatch(JSON.stringify(await r.json()), /secret|test-key/);
}
// a reply that is not JSON reads as empty and not legible (as the Python reader does), not an error
r = await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')] }), env, fake(() => Response.json({ content: [{ type: 'text', text: 'I cannot tell' }] })));
assert.deepEqual((await r.json())[0].a, { text: '', legible: false });
assert.deepEqual(parseReading('{"text": 7, "legible": "yes"}'), { text: '7', legible: false });

// nothing is logged
const logged = []; const keep = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = (...a) => logged.push(a);
await handleRead(req({ page: 1, crops: [crop('p1.sample_temp')] }), env, fake(() => new Response('x', { status: 500 })));
Object.assign(console, keep);
assert.equal(logged.length, 0);

// registered in the Worker: the route answers there (401 without sign-in), and other scan-api paths still go to the relay
const w = await worker.fetch(req({ page: 1, crops: [crop('p1.sample_temp')] }, { jwt: null }), { ...env, SCAN_ORIGIN: 'https://o.example.test', SCAN_CLIENT_ID: 'a', SCAN_CLIENT_SECRET: 'b' });
assert.equal(w.status, 401); assert.match((await w.json()).error, /Sign in/);
console.log('read.test.mjs ok');
