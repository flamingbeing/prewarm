// Scan pages upload (prewarm/NOTES.md): the phones' photos of the paper form go to the study computer (Firetop) and nowhere
// else. prewarmstudy.anawj.com/scan-api/* is put behind Cloudflare Access (an allowlist of emails, one-time PIN); every request
// is checked again here (the Access token's signature and audience), then passed on to the study computer's own address, which
// Access guards with a service token only this Worker holds. The Worker stores nothing.
//   GET  /scan-api/whoami                       -> {email}              (is this browser signed in?)
//   POST /scan-api/upload/<scan>/<page>         one JPEG or PNG, page 1-14 or x; X-Scan-Subject: the Subject ID typed on the
//                                               phone (optional, passed on)   -> {ok, pages}
//   GET  /scan-api/status/<scan>                -> {scan, pages, state, page: {<page>: {state, page?, score?, values?, flagged?, why?}}}
//                                               (the study computer's reading of each page: received, read, retake, approved;
//                                               numbers and states only, never values)
// Set in Cloudflare (never in this repo): ACCESS_TEAM (already there), SCAN_ACCESS_AUD (the AUD tag of the Access app for this
// path), SCAN_ORIGIN (the study computer's address, https), SCAN_CLIENT_ID and SCAN_CLIENT_SECRET (a service token for it).
// Without them it answers 503 and names the missing one.
import { verifyAccess } from './access.js';

export const SCAN_HOST = 'prewarmstudy.anawj.com';
export const SCAN_PREFIX = '/scan-api/';
export const MAX_PHOTO = 12 * 1024 * 1024;
const SCAN_ID = /^[A-Za-z0-9-]{8,64}$/, PAGE = /^(?:[1-9]|1[0-4]|x)$/, SUBJECT = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

export async function handleScan(request, env, fetchImpl = fetch) {
  const missing = ['ACCESS_TEAM', 'SCAN_ACCESS_AUD', 'SCAN_ORIGIN', 'SCAN_CLIENT_ID', 'SCAN_CLIENT_SECRET'].filter(k => !env[k]);
  if (missing.length) return json({ error: `Scan upload is not set up yet: the Worker has no ${missing.join(', ')}.` }, 503);
  const email = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'), { ACCESS_TEAM: env.ACCESS_TEAM, ACCESS_AUD: env.SCAN_ACCESS_AUD }, fetchImpl);
  if (!email) return json({ error: 'Sign in first.' }, 401);
  const url = new URL(request.url), parts = url.pathname.slice(SCAN_PREFIX.length).split('/');
  let path;
  if (request.method === 'GET' && parts.length === 1 && parts[0] === 'whoami') return json({ email });
  if (request.method === 'GET' && parts.length === 2 && parts[0] === 'status' && SCAN_ID.test(parts[1])) path = `status/${parts[1]}`;
  else if (request.method === 'POST' && parts.length === 3 && parts[0] === 'upload' && SCAN_ID.test(parts[1]) && PAGE.test(parts[2])) {
    // only from the app itself (a page on another site can't use the person's sign-in to post here)
    const origin = request.headers.get('Origin');
    if (origin && origin !== `https://${SCAN_HOST}`) return json({ error: 'Wrong origin.' }, 403);
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/png') return json({ error: 'A JPEG or PNG photo only.' }, 415);
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: 'Empty photo.' }, 400);
    if (body.byteLength > MAX_PHOTO) return json({ error: 'That photo is too big (12 MB at most).' }, 413);
    const subject = (request.headers.get('X-Scan-Subject') || '').trim();
    if (subject && !SUBJECT.test(subject)) return json({ error: 'The Subject ID can only have letters, numbers, spaces and - _ . /' }, 400);
    return pass(fetchImpl, env, `upload/${parts[1]}/${parts[2]}`, { method: 'POST', body, headers: { 'Content-Type': type, ...(subject && { 'X-Scan-Subject': subject }) } }, email);
  } else return json({ error: 'Not found.' }, 404);
  return pass(fetchImpl, env, path, { method: 'GET' }, email);
}

async function pass(fetchImpl, env, path, init, email) {
  let res;
  try {
    res = await fetchImpl(`${env.SCAN_ORIGIN.replace(/\/+$/, '')}/scan-api/${path}`, {
      ...init, redirect: 'manual',
      headers: { ...init.headers, 'CF-Access-Client-Id': env.SCAN_CLIENT_ID, 'CF-Access-Client-Secret': env.SCAN_CLIENT_SECRET, 'X-Scan-User': email },
    });
  } catch (e) { return json({ error: 'The study computer did not answer.' }, 502); }
  if (res.status >= 300 && res.status < 400) return json({ error: 'The study computer refused the request (check its Access policy).' }, 502);
  if (res.status === 403 || res.status === 401) return json({ error: 'The study computer refused the request (check its service token).' }, 502);
  // only its JSON comes back, never its own headers
  const text = await res.text();
  let out; try { out = JSON.parse(text); } catch (e) { return json({ error: `The study computer said ${res.status}.` }, 502); }
  return json(out, res.status);
}
