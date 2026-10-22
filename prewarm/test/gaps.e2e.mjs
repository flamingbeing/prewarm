// Browser tests for fixed bugs that had no test (list: docs/test-candidates.md), in demo mode with fake data only:
// the update prompt with an unsaved reading, a typed BMI, the screen-awake lock, an emptied time pad, alerts due in the
// same second, sound after an app switch, double taps on Delete and comfort answers, a cleared Subject ID,
// the "saved by" line, Underbody warm defaulting to Yes, hidden answers coming back, a form answer committed by Back,
// and a typed temperature followed at once by Save.
// Needs the site served on :8080 (python3 -m http.server 8080), like edge.e2e.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = `http://localhost:${process.env.PORT || 8080}/prewarm/`;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const fails = [];
const tryit = async f => { try { await f(); } catch (e) { fails.push('error: ' + e.message.split('\n')[0] + ' @ ' + [...e.stack.matchAll(/gaps.e2e.mjs:(\d+)/g)].map(m => m[1]).join(',')); } };
const log = (ok, msg) => { if (!ok) fails.push(msg); };
const tapNow = async (pg, id) => { await pg.click(`[data-ev="${id}"]`); await pg.click('.kp [data-now]'); };
const jobs = [];
async function runJobs(n = +(process.env.JOBS || 2)) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < jobs.length) await jobs[next++](); }));
}
// a fresh phone; `init` runs in the page before the app starts (stubs), `time` freezes the clock
async function fresh(time, init, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fails.push('page error: ' + e.message));
  if (init) await pg.addInitScript(init);
  if (time) await pg.clock.install({ time: new Date(time) });
  await pg.goto(BASE + '?demo'); await pg.waitForTimeout(800);
  return { ctx, pg };
}
const open = async (pg, i) => { await pg.locator('a[href*="#/p/"]', { hasText: i ? 'DEMO-02' : 'DEMO-01' }).first().click(); await pg.waitForSelector('#clock'); };
const preop = async pg => { await pg.click('#haemolink'); await pg.click('.links.three a:has-text("Pre-op")'); await pg.waitForSelector('#f-enrol_id'); };
const stored = (pg, id, k) => pg.evaluate(([i, k]) => JSON.parse(localStorage.getItem('prewarm-demo:patients'))[i].f[k]?.v ?? null, [id, k]);

// 1. "Update available" asks to save an unsaved reading first (afterAsking). Not in demo mode, so this phone runs the real
// service worker against a small server of the repo whose sw.js can change version (and skips the design kit, which the
// test machine may not reach).
jobs.push(() => tryit(async () => {
  let swv = 'v-first';
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (f.endsWith('/')) f += 'index.html';
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
    let body = fs.readFileSync(f);
    if (u.pathname.endsWith('/prewarm/sw.js')) body = Buffer.from(body.toString().replace(/const VERSION = '([^']+)'/, `const VERSION = '$1-${swv}'`).replace("'https://design.anawj.com/v1/tokens.css',", ''));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${srv.address().port}/prewarm/`;
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => fails.push('update: page error: ' + e.message));
    await pg.goto(url + '?demo'); await pg.waitForTimeout(800);
    const data = await pg.evaluate(() => localStorage.getItem('prewarm-demo:patients'));
    await pg.evaluate(d => { localStorage.setItem('prewarm:patients', d); localStorage.setItem('prewarm:settings', JSON.stringify({ me: 'TT' })); }, data);
    await pg.goto(url); await pg.waitForTimeout(500);
    await pg.evaluate(() => navigator.serviceWorker.ready);
    await pg.reload(); await pg.waitForTimeout(1000); // now controlled by the first worker
    await pg.locator('a[href*="#/p/"]', { hasText: 'DEMO-01' }).first().click(); await pg.waitForSelector('#clock');
    await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp input.num');
    await pg.keyboard.type('372'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); // an unsaved core temp
    await pg.evaluate(() => { window.__same = 1; });
    swv = 'v-second';
    await pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await pg.waitForSelector('#update:not([hidden])', { timeout: 15000 });
    await pg.click('#update'); await pg.waitForTimeout(500);
    log(!!await pg.$('dialog.ask[open]'), 'Update with an unsaved reading asks first');
    log(await pg.evaluate(() => window.__same) === 1, 'the page was not reloaded before the answer');
    await pg.click('dialog.ask [data-a="stay"]'); await pg.waitForTimeout(500);
    log(await pg.evaluate(() => window.__same) === 1 && /37\.2/.test(await pg.textContent('.num[data-type="core"]')), 'Stay keeps the page and the typed reading');
    await pg.click('#update'); await pg.waitForSelector('dialog.ask[open]');
    await pg.click('dialog.ask [data-a="drop"]');
    await pg.waitForFunction(() => window.__same === undefined, null, { timeout: 15000 }).catch(() => log(false, 'after Don’t save the update reloaded the app'));
    await ctx.close();
  } finally { srv.close(); }
}));

// 2. a typed BMI isn't overwritten by the calculation
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0); await preop(pg);
  await pg.fill('#f-wt', '70'); await pg.keyboard.press('Tab'); await pg.fill('#f-ht', '175'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(await pg.inputValue('#f-bmi') === '22.9', 'BMI worked out first: ' + await pg.inputValue('#f-bmi'));
  await pg.fill('#f-bmi', '30'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  await pg.fill('#f-wt', '90'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(300);
  log(await pg.inputValue('#f-bmi') === '30', 'a typed BMI stays after a weight change: ' + await pg.inputValue('#f-bmi'));
  await ctx.close();
}));

// 3. the screen-awake lock is asked for again when the app comes back to the front
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh(null, () => {
    window.__wl = 0; window.__vis = 'visible';
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { window.__wl++; return Promise.resolve({ release: () => Promise.resolve() }); } } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
  });
  await open(pg, 0); await pg.waitForTimeout(300);
  const first = await pg.evaluate(() => window.__wl);
  log(first >= 1, 'the lock is taken on a patient screen: ' + first);
  await pg.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(100);
  log(await pg.evaluate(() => window.__wl) === first, 'not asked for while hidden');
  await pg.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(100);
  log(await pg.evaluate(() => window.__wl) === first + 1, 'asked for again once back in front: ' + await pg.evaluate(() => window.__wl));
  await ctx.close();
}));

// 4. an emptied time pad doesn't clear the time (Clear does, after asking)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  pg.on('dialog', d => d.accept());
  await tapNow(pg, 'ev_ot'); await pg.waitForTimeout(900);
  const t = await pg.textContent('[data-ev="ev_ot"] b');
  log(/\d\d:\d\d/.test(t), 'In OT set: ' + t);
  await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.fill('#evtime', ''); await pg.click('.kp [data-a="ok"]'); await pg.waitForTimeout(400);
  log(!await pg.$('dialog.kp[open]') && await pg.textContent('[data-ev="ev_ot"] b') === t, 'emptied pad then OK: the time is kept: ' + await pg.textContent('[data-ev="ev_ot"] b'));
  await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.fill('#evtime', ''); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
  log(await pg.textContent('[data-ev="ev_ot"] b') === t, 'emptied pad then Enter: the time is kept');
  await ctx.close();
}));

// 5 + 6. alerts due in the same second share one banner and one run of three beeps; every tap wakes a suspended sound
const audio = () => {
  window.__osc = 0; window.__resume = 0;
  window.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; window.__ac = this; }
    resume() { window.__resume++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { window.__osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  };
};
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00', audio);
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('prewarm-demo:settings') || '{}'); s.me = 'TT'; s.remind = { vibrate: true, beep: true, banner: true, awake: true, haemo: true }; localStorage.setItem('prewarm-demo:settings', JSON.stringify(s)); });
  await pg.reload(); await pg.waitForTimeout(800);
  await open(pg, 1);
  let both = null;
  for (let i = 0; i < 12 && !both; i++) {
    const o0 = await pg.evaluate(() => window.__osc);
    await pg.clock.fastForward('05:00'); await pg.waitForTimeout(100);
    const t = await pg.evaluate(() => { const b = document.querySelector('#banner'); return b && !b.hidden ? b.textContent : ''; });
    if (/Temperature .* due now/.test(t) && /BP, HR, BIS .* due now/.test(t)) both = { t, beeps: (await pg.evaluate(() => window.__osc)) - o0, banners: await pg.$$eval('#banner', b => b.length) };
  }
  log(!!both, 'a temperature and a BP reading due in the same second never showed together');
  if (both) {
    log(both.banners === 1 && / · /.test(both.t), 'one banner names both: ' + both.t);
    log(both.beeps === 3, 'with one run of three beeps, not six: ' + both.beeps);
  }
  await ctx.close();
}));
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh(null, audio);
  await pg.click('body', { position: { x: 5, y: 5 } }); await pg.waitForTimeout(100);
  const r1 = await pg.evaluate(() => window.__resume);
  log(r1 >= 1, 'a tap wakes the sound: resume ran ' + r1 + ' time(s)');
  await pg.evaluate(() => { window.__ac.state = 'suspended'; }); // the phone suspends it after an app switch
  await pg.click('body', { position: { x: 5, y: 5 } }); await pg.waitForTimeout(100);
  log(await pg.evaluate(() => window.__resume) === r1 + 1, 'and again on the next tap after a suspend: ' + await pg.evaluate(() => window.__resume));
  await pg.evaluate(() => { window.__ac.state = 'running'; });
  await pg.click('body', { position: { x: 5, y: 5 } }); await pg.waitForTimeout(100);
  log(await pg.evaluate(() => window.__resume) === r1 + 1, 'no resume while it is running');
  await ctx.close();
}));

// 7. "Tap again to delete" ignores a second tap within 0.6 s
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.goto(BASE + '?demo#/delete'); await pg.waitForSelector('.dellist');
  const del = pg.locator('.dellist li', { hasText: 'DEMO-01' }).locator('[data-del]');
  await del.click(); await pg.waitForTimeout(200); await del.click(); await pg.waitForTimeout(200);
  log(await pg.locator('.dellist li', { hasText: 'DEMO-01' }).count() === 1 && /Tap again/.test(await del.textContent()), 'a second tap 200 ms later does not delete');
  await pg.waitForTimeout(700); await del.click(); await pg.waitForTimeout(300);
  log(!/DEMO-01/.test(await pg.textContent('.dellist')), 'a deliberate second tap deletes');
  await ctx.close();
}));

// 8. comfort answers change but don't clear on a second tap
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.waitForTimeout(900);
  const chips = await pg.$$eval('.chip[data-sat="sat_pre"]', c => c.map(x => x.dataset.v));
  await pg.click(`.chip[data-sat="sat_pre"][data-v="${chips[1]}"]`); await pg.waitForTimeout(900);
  const answered = (await pg.textContent('.comfort.done:has([data-satedit="sat_pre"])')).trim();
  log(/before surgery/.test(answered), 'comfort answered: ' + answered);
  await pg.click('[data-satedit="sat_pre"]'); await pg.waitForTimeout(200);
  log(await pg.getAttribute(`.chip[data-sat="sat_pre"][data-v="${chips[1]}"]`, 'aria-pressed') === 'true', 'Change shows the answer picked');
  await pg.click(`.chip[data-sat="sat_pre"][data-v="${chips[1]}"]`); await pg.waitForTimeout(900);
  log((await pg.textContent('.comfort.done:has([data-satedit="sat_pre"])')).trim() === answered && await stored(pg, id, 'sat_pre') == chips[1], 'tapping the same answer again keeps it');
  await pg.click('[data-satedit="sat_pre"]'); await pg.waitForTimeout(200);
  await pg.click(`.chip[data-sat="sat_pre"][data-v="${chips[2]}"]`); await pg.waitForTimeout(900);
  log(await stored(pg, id, 'sat_pre') == chips[2], 'a different answer changes it');
  // the consent answer too: Change, then the same answer again
  await pg.click('[data-satedit="consent_st"]'); await pg.waitForTimeout(200);
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.waitForTimeout(900);
  log(await stored(pg, id, 'consent_st') == 1, 'the same consent answer again keeps it');
  await ctx.close();
}));

// 9. Subject ID can't be cleared: the old one is kept
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0); await preop(pg);
  await pg.fill('#f-enrol_id', ''); await pg.keyboard.press('Tab'); await pg.waitForTimeout(300);
  log(await pg.inputValue('#f-enrol_id') === 'DEMO-01', 'cleared Subject ID goes back to the old one: ' + await pg.inputValue('#f-enrol_id'));
  log(/DEMO-01/.test(await pg.textContent('#title')), 'and the title still shows it');
  await ctx.close();
}));

// 10. a saved reading says who saved it: "Taken hh:mm (saved by XX)"
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('prewarm-demo:settings') || '{}'); s.me = 'TT'; localStorage.setItem('prewarm-demo:settings', JSON.stringify(s)); });
  await pg.reload(); await pg.waitForTimeout(800);
  await open(pg, 1);
  await pg.click('#haemolink'); await pg.waitForSelector('input[data-in="sbp"]');
  const tp = (await pg.textContent('.tp b')).trim();
  pg.on('dialog', d => d.type() === 'prompt' ? d.accept('09:58') : d.accept());
  await pg.fill('input[data-in="sbp"]', '120'); await pg.waitForTimeout(800); await pg.click('#save'); await pg.waitForTimeout(500);
  await pg.click(`.strip a:has-text("${tp.replace(' min', '')}")`); await pg.waitForSelector('[data-attime]');
  const line = await pg.textContent('main');
  log(/Taken \d\d:\d\d \(saved by TT\)/.test(line), 'the saved line names who saved it: ' + (line.match(/Taken[^.]*/)?.[0] || line.slice(0, 80)));
  await ctx.close();
}));

// 11. a reading due after Underbody warm was logged defaults to Yes for it (block S of edge.e2e.mjs checks Gown warm)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 1);
  const st = await pg.textContent('[data-ev="io_under_start"] b');
  if (!/\d\d:\d\d/.test(st)) { await tapNow(pg, 'io_under_start'); await pg.waitForTimeout(900); }
  const t = await pg.textContent('[data-ev="io_under_start"] b');
  await pg.click('.strip a:has-text("55")'); await pg.waitForSelector('#save');
  const due = (await pg.textContent('#due')).match(/\d\d:\d\d/)?.[0];
  if (due >= t) {
    log(await pg.getAttribute('.chip[data-c="under"][data-v="1"]', 'aria-pressed') === 'true', `underbody warming Yes by default (start ${t}, due ${due})`);
    log(await pg.getAttribute('.chip[data-c="under"][data-v="0"]', 'aria-pressed') === 'false', 'and No is not picked');
  } else log(false, `test setup: 55 min due ${due} is before underbody start ${t}`);
  await ctx.close();
}));

// 12. an answer hidden by its question being No stays stored: switching back brings it back
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0); await preop(pg);
  await pg.click('.chip[data-f="ihd"][data-v="1"]'); await pg.click('.chip[data-f="ihd_mi"][data-v="0"]'); await pg.waitForSelector('#f-ihd_mi_years');
  await pg.fill('#f-ihd_mi_years', '7'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(300);
  await pg.click('.chip[data-f="ihd"][data-v="0"]'); await pg.waitForTimeout(300);
  log(!await pg.$('#f-ihd_mi_years'), 'IHD No hides the years');
  await pg.click('.chip[data-f="ihd"][data-v="1"]'); await pg.waitForTimeout(300);
  log(!!await pg.$('#f-ihd_mi_years') && await pg.inputValue('#f-ihd_mi_years') === '7', 'IHD Yes again brings the old 7 back: ' + await pg.inputValue('#f-ihd_mi_years').catch(() => 'missing'));
  await ctx.close();
}));

// 13. Back without leaving the box (no Tab) still saves a form answer
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0); await preop(pg);
  await pg.fill('#f-wt', '81');
  await pg.goBack(); await pg.waitForTimeout(500);
  log(!/\/form\//.test(pg.url()), 'Back left the form: ' + pg.url().split('#')[1]);
  await preop(pg);
  log(await pg.inputValue('#f-wt') === '81', 'the weight typed before Back was saved: ' + await pg.inputValue('#f-wt'));
  await ctx.close();
}));

// 14. a typed temperature followed at once by Save: the first tap saves
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  pg.on('dialog', d => d.accept());
  const saved = () => pg.$$eval('.strip a.done', a => a.length);
  const before = await saved();
  await pg.waitForTimeout(800);
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp input.num');
  await pg.keyboard.type('372'); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(100);
  await pg.click('#save'); await pg.waitForTimeout(1200);
  log(await saved() === before + 1, `Save tapped 0.1 s after typing saves at once (saved ${before} → ${await saved()})`);
  await ctx.close();
}));

// 15. a real touch double tap on a comfort answer is ignored the second time (the row collapses under the finger)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T09:00:00', null, { hasTouch: true, isMobile: true });
  await open(pg, 0);
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  const asked = [];
  pg.on('dialog', d => { asked.push(d.message()); d.dismiss(); });
  const cdp = await ctx.newCDPSession(pg);
  const tapAt = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await pg.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const dbl = async sel => { const r = await pg.locator(sel).boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await tapAt(x, y); await pg.waitForTimeout(100); await tapAt(x, y); await pg.waitForTimeout(900); };
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.waitForTimeout(900);
  const v = (await pg.$$eval('.chip[data-sat="sat_pre"]', c => c.map(x => x.dataset.v)))[2];
  await dbl(`.chip[data-sat="sat_pre"][data-v="${v}"]`);
  log(await stored(pg, id, 'sat_pre') == v, 'the comfort answer is saved');
  log(asked.length === 0 && !!await pg.$('[data-satedit="sat_pre"]') && !await pg.$('.chip[data-sat="sat_pre"]'), 'the second tap of a double tap did nothing (no Clear question, not back in Change): ' + JSON.stringify(asked));
  await ctx.close();
}));

await runJobs();
await b.close();
if (fails.length) { console.error('prewarm gaps: FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('prewarm gaps: ok (update prompt, typed BMI, screen-awake lock, emptied time pad, one banner and three beeps, sound resume, delete double tap, comfort second tap, Subject ID kept, saved by, Underbody default, hidden answers back, Back commits, Save right after typing, double-tap comfort)');
