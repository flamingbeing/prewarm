// Read on phone at phone size (made-up form and pages only: test/scan-parity): off by default; switched on, a subject's
// pages are lined up and cut up here, the cells go to /scan-api/read (stood in for), and a pending import of this phone's
// own is written beside the study computer's (stood in for: window.__scanCloud). The upload to the study computer goes
// on as before. Needs the site served on :8080 like e2e.mjs.
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
const D = new URL('./scan-parity/', import.meta.url);
const b64 = f => readFileSync(new URL(f, D)).toString('base64');
const map = readFileSync(new URL('form-map.json', D), 'utf8');
const form = { version: 'test', map, templates: [b64('template-1.png')] };
const pageB64 = b64('page-1.png');

const b = await chromium.launch();
const fails = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => fails.push('page error: ' + e.message));
const ok = (c, m) => { if (!c) fails.push(m); };
try {
  await pg.addInitScript(form => {
    window.__got = [];
    window.__scanCloud = { scanForm: async () => form, addScanImport: async (id, doc) => { window.__got.push({ id, doc: { ...doc, by: 'phoneA' } }); } };
  }, form);
  const reads = [], uploads = [];
  await pg.route('**/scan-api/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    if (u.pathname.endsWith('/whoami')) return route.fulfill({ json: { email: 'member@example.com' } });
    if (u.pathname.includes('/status/')) return route.fulfill({ status: 404, json: { error: 'No such scan.' } });
    if (u.pathname.endsWith('/read')) {
      const body = JSON.parse(rq.postData());
      reads.push(body);
      return route.fulfill({ json: body.crops.map((c, i) => ({ id: c.id, a: { text: '1', legible: true }, b: { text: i ? '1' : '7', legible: true } })) });
    }
    uploads.push(u.pathname);
    return route.fulfill({ json: { ok: true, pages: ['1'] } });
  });

  await pg.goto('http://localhost:8080/prewarm/?demo#/settings'); await pg.waitForTimeout(800);
  await pg.check('#scanon');
  // one made-up page already on the phone for DEMO-01 (as a tidied page is kept)
  await pg.evaluate(async b64 => {
    const clean = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' });
    await new Promise((ok, no) => {
      const r = indexedDB.open('prewarm-scan', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('pages', { keyPath: 'id' }); s.createIndex('subject', 'subject'); };
      r.onsuccess = () => { const t = r.result.transaction('pages', 'readwrite'); t.objectStore('pages').put({ id: 'pg1', subject: 'DEMO-01', label: '1', at: 1, clean, original: clean }); t.oncomplete = () => { r.result.close(); ok(); }; t.onerror = () => no(t.error); };
      r.onerror = () => no(r.error);
    });
  }, pageB64);
  await pg.goto('http://localhost:8080/prewarm/?demo&scantest#/scan'); await pg.waitForSelector('#scsub');
  await pg.fill('#scsub', 'DEMO-01');
  await pg.waitForSelector('#sclist figure');
  ok(!(await pg.$eval('#scphonelbl', e => e.hidden)), 'Read on phone switch shown where pages can be sent');
  ok(!(await pg.isChecked('#scphoneon')), 'Read on phone is off by default');
  ok(await pg.$eval('#scphone', e => e.hidden), 'no Read on phone button while it is off');
  await pg.check('#scphoneon');
  await pg.waitForSelector('#scphone:not([hidden])');
  await pg.click('#scphone');
  await pg.waitForFunction(() => /on the phone/.test(document.querySelector('#scmsg').textContent), null, { timeout: 60000 });
  const msg = await pg.textContent('#scmsg');
  ok(/Read 1 page on the phone/.test(msg), 'read message: ' + msg);
  const got = await pg.evaluate(() => window.__got);
  ok(got.length === 1, 'one import written: ' + got.length);
  const { id, doc } = got[0] || {};
  ok(/^[A-Za-z0-9_-]+-phone-[a-z0-9]+$/.test(id || ''), 'import id is <scan>-phone-<stamp>: ' + id);
  ok(doc && doc.status === 'pending' && doc.via === 'phone' && doc.subject === 'DEMO-01' && id.startsWith(doc.scan + '-phone-'), 'pending, read on phone, same scan id');
  ok(doc && doc.pages.length === 1 && doc.pages[0].page === 1, 'one page in it');
  const sent = reads.flatMap(r => r.crops);
  ok(reads.length >= 1 && reads.every(r => r.page === 1 && r.crops.length <= 40), 'cells sent 40 at most per request: ' + reads.map(r => r.crops.length));
  ok(sent.length > 20 && sent.every(c => c.png.startsWith('iVBORw0KGgo') && c.png.length * 0.75 <= 40000), 'cells sent as small PNGs: ' + sent.length);
  ok(!sent.some(c => c.id === 'demo_id'), 'free text never sent');
  const vals = Object.values(doc?.fields || {});
  ok(vals.some(v => v.flags.includes('two reads disagree')), 'the disagreeing reading is flagged');
  ok(vals.some(v => v.v === '1' && !v.flags.length), 'the agreeing readings come through');
  ok(uploads.some(p => /\/upload\/[^/]+\/1$/.test(p)) && uploads.some(p => p.includes(doc?.scan)), 'the page still went to the study computer under the same scan id: ' + uploads);

  // again: the page's readings are kept on it, so nothing is paid for twice
  const n = reads.length;
  await pg.click('#scphone');
  await pg.waitForFunction(() => window.__got.length === 2, null, { timeout: 60000 });
  ok(reads.length === n, 'a second go reuses the kept readings: ' + (reads.length - n) + ' more requests');
} catch (e) { fails.push('error: ' + e.message.split('\n')[0]); }
await b.close();
console.log(fails.length ? 'FAIL scan-phone e2e:\n' + fails.join('\n') : 'scan-phone e2e passed');
process.exit(fails.length ? 1 : 0);
