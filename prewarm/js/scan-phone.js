// Read on phone (phone-direct scan, 30 Oct 2026): a subject's tidied pages are read here instead of only on the study
// computer. The form map and its page pictures come from forms/scan (written from Firetop); each page is lined up and cut
// up in a Web Worker (js/scan-read-worker.js -> js/scan-read.js); the de-identified cells go to the Worker's
// /scan-api/read (at most 40 per request), and the values and flags become a pending scanImports document of this
// phone's own, beside the study computer's (via 'phone'), for an admin to approve as usual. The upload to the study
// computer is unchanged. Each page's readings are kept on its page record (p.phoneRead), so a retry doesn't pay again.
import { applyRead, finish, importDoc } from './scan-read.js';

const API = '/scan-api/', BATCH = 40;
let form = null; // { version, map, byId, tpl: { page: Uint8Array 450x600 } } once fetched

const gray = async (blob, w, h) => {
  const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(w || bmp.width, h || bmp.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const d = x.getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000 | 0;
  return { data: g, w: c.width, h: c.height };
};
const b64Blob = (b64, type) => new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type });
async function pngB64({ data, w, h }) {
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), im = x.createImageData(w, h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) { im.data[j] = im.data[j + 1] = im.data[j + 2] = data[i]; im.data[j + 3] = 255; }
  x.putImageData(im, 0, 0);
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function loadForm(cloud) {
  if (form) return form;
  const d = await cloud.scanForm();
  if (!d?.map || !Array.isArray(d.templates)) throw new Error('The form for reading on the phone is not set up yet.');
  const map = JSON.parse(d.map), tpl = {};
  for (const pg of map.pages) {
    const b = d.templates[pg.page - 1];
    if (b) tpl[pg.page] = (await gray(b64Blob(b, 'image/png'))).data;
  }
  form = { version: d.version, map, byId: Object.fromEntries(map.fields.map(f => [f.id, f])), tpl };
  return form;
}

// one page in the Web Worker (on the main thread where module workers can't run)
async function plan(g, pg, fields, tpl) {
  const msg = { gray: g.data, w: g.w, h: g.h, pg, fields, tpl };
  try {
    const w = new Worker(new URL('./scan-read-worker.js', import.meta.url), { type: 'module' });
    return await new Promise((ok, no) => {
      w.onmessage = e => { w.terminate(); e.data.error ? no(new Error(e.data.error)) : ok(e.data); };
      w.onerror = e => { w.terminate(); no(new Error(e.message || 'worker')); };
      w.postMessage(msg, [g.data.buffer]);
    });
  } catch (e) {
    if (g.data.byteLength) throw e; // the worker ran and failed
    const { planPage } = await import('./scan-read.js');
    return planPage(msg.gray, msg.w, msg.h, pg, fields, tpl);
  }
}

async function readCrops(page, crops) {
  const out = {};
  for (let i = 0; i < crops.length; i += BATCH) {
    const part = await Promise.all(crops.slice(i, i + BATCH).map(async c => ({ id: c.id, png: await pngB64(c) })));
    const r = await fetch(API + 'read', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, crops: part }) });
    if (r.type === 'opaqueredirect' || r.status === 401) throw Object.assign(new Error('Sign in again first.'), { auth: true });
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j)) throw new Error(j?.error || `Reading failed (${r.status}).`);
    for (const x of j) out[x.id] = x;
  }
  return out;
}

// One page record (p.clean, p.label) -> { page, score, retake, out } (kept as p.phoneRead for this form version).
async function readPage(p, f, put) {
  const n = Number(p.label);
  if (p.phoneRead?.version === f.version && p.phoneRead.page === n) return p.phoneRead;
  const pg = f.map.pages.find(x => x.page === n);
  if (!pg || !f.tpl[n]) return null;
  const fields = f.map.fields.filter(x => x.page === n);
  const g = await gray(p.clean, f.map.page.w, f.map.page.h);
  const r = await plan(g, pg, fields, f.tpl[n]);
  const reads = r.crops.length ? await readCrops(n, r.crops) : {};
  for (const c of r.crops) if (reads[c.id]) applyRead(r.out[c.id], f.byId[c.id], reads[c.id]);
  else r.out[c.id].flags.push('not read: type this in');
  p.phoneRead = { version: f.version, page: n, score: r.score, retake: r.retake, out: r.out };
  await put(p);
  return p.phoneRead;
}

// A subject's pages -> this phone's pending import. scan: the scan id the pages went to the study computer under.
export async function readSubject({ cloud, pages, subject, scan, put, progress = () => {} }) {
  const f = await loadForm(cloud), done = [], out = {};
  const mine = pages.filter(p => /^\d+$/.test(p.label || '') && p.clean);
  for (const [i, p] of mine.entries()) {
    progress(`Reading page ${p.label} (${i + 1} of ${mine.length})…`);
    const r = await readPage(p, f, put);
    if (!r) continue;
    done.push(r);
    for (const [k, e] of Object.entries(r.out)) out[k] = { ...e, flags: [...e.flags] };
  }
  if (!done.length) throw new Error('No pages with a page number to read.');
  finish(out, f.byId);
  const id = `${scan}-phone-${Date.now().toString(36)}`;
  await cloud.addScanImport(id, importDoc({ scan, subject, pages: done, out, now: Date.now(), by: '' }));
  return { id, pages: done.length };
}
