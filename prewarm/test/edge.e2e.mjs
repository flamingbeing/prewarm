// Edge cases of the prewarming app in demo mode (fake data only): a case running past midnight, double-tapping Save,
// BP / HR / BIS checks, the phone's back button with an unsaved reading, Log then move on, Enter on the last question.
// Needs the site served on :8080 (python3 -m http.server 8080), like e2e.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch();
const fails = [];
const tryit = async f => { try { await f(); } catch (e) { fails.push('error: ' + e.message.split('\n')[0] + ' @ ' + [...e.stack.matchAll(/edge.e2e.mjs:(\d+)/g)].map(m => m[1]).join(',')); } };
const log = (ok, msg) => { if (!ok) fails.push(msg); };
// a key time: tap its box, then Now on the time pad (the pad also takes typed digits and has Clear and Back)
const tapNow = async (pg, id) => { await pg.click(`[data-ev="${id}"]`); await pg.click('.kp [data-now]'); };
// Save leaves out carried-over (grey) measurements (14 Oct 2026): confirm them first, as a user would by tapping each value
const confirmDefaults = async pg => {
  for (let i = 0; i < 12; i++) {
    const n = await pg.$('.card.dflt .num');
    if (n) { await n.click(); await pg.waitForSelector('dialog.kp[open]'); await pg.click('.kp [data-a="ok"]'); await pg.waitForTimeout(150); continue; }
    const t = await pg.$('.card.dflt input[data-in]');
    if (t) { const v = await t.inputValue(); await t.fill(''); await t.fill(v); await pg.waitForTimeout(100); continue; }
    break;
  }
};
const saveNow = async pg => { await confirmDefaults(pg); await pg.waitForTimeout(800); await pg.click('#save'); };
// each block below starts from its own fresh browser context, so they run a few at a time (JOBS, default 4)
const jobs = [];
async function runJobs(n = +(process.env.JOBS || 4)) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < jobs.length) await jobs[next++](); }));
}
async function fresh(time) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fails.push('page error: ' + e.message));
  if (time) await pg.clock.install({ time: new Date(time) });
  await pg.goto('http://localhost:8080/prewarm/?demo'); await pg.waitForTimeout(800);
  return { ctx, pg };
}
// DEMO-01 is in pre-warming, DEMO-02 in surgery
const open = async (pg, i) => { await pg.locator('a[href*="#/p/"]', { hasText: i ? 'DEMO-02' : 'DEMO-01' }).first().click(); await pg.waitForSelector('#clock'); };

// A. midnight: intra-op patient, clock crosses midnight
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T23:40:00');
  await open(pg, 1);
  const before = await pg.textContent('#clock');
  await pg.clock.fastForward('00:40:00'); await pg.waitForTimeout(1500);
  const after = await pg.textContent('#clock');
  log(!/\d+:\d\d:\d\d/.test(after), `midnight: countdown sane (${before.replace(/\s+/g, ' ')} -> ${after.replace(/\s+/g, ' ')})`);
  const due = await pg.textContent('#due').catch(() => '');
  log(!/in \d{3,}/.test(due), 'midnight: due pill sane: ' + due);
  const missed = await pg.$$eval('.strip a.missed', a => a.length);
  log(missed < 12, 'midnight: strip missed count ' + missed);
  await ctx.close();
}));
// B. surgery end: later intra-op points stop nagging
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 1);
  await tapNow(pg, 'io_done'); await pg.waitForTimeout(300);
  const end = await pg.textContent('[data-ev="io_done"] b');
  log(!!end.match(/\d\d:\d\d/), 'surgery end set');
  log(!/late \d+:\d\d:\d\d/.test(await pg.textContent('#clock')), 'top bar sane after surgery end');
  await ctx.close();
}));
// C. double tap Save: must not save the next timepoint
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const tp = (await pg.textContent('.tp b')).trim();
  await confirmDefaults(pg); await pg.waitForTimeout(800); await pg.dblclick('#save'); await pg.waitForTimeout(500);
  const next = (await pg.textContent('.tp b')).trim();
  const saved = await pg.$$eval('.strip a.done', a => a.map(x => x.textContent.trim()));
  log(next !== tp && !saved.includes(next.replace(' min', '')), `double-tap Save on ${tp} must not save ${next} too (saved: ${saved.join(',')})`);
  await ctx.close();
}));
// D. BP: letters refused, unusual asked
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  await pg.click('#haemolink'); await pg.waitForSelector('input[data-in="sbp"]');
  await pg.fill('input[data-in="sbp"]', '12o'); await pg.click('#save');
  log(/numbers only/.test(await pg.textContent('#toast')), 'BP letters refused: ' + await pg.textContent('#toast'));
  let asked = '';
  pg.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await pg.fill('input[data-in="sbp"]', '320'); await pg.click('#save'); await pg.waitForTimeout(300);
  log(/unusual/.test(asked), 'BP 320 asked: ' + asked);
  // OK to the unusual value, then to the blank boxes (BIS)
  const ok = d => d.accept(); pg.on('dialog', ok);
  await pg.click('#save'); await pg.waitForTimeout(300);
  pg.off('dialog', ok);
  log(/saved/.test(await pg.textContent('#toast')), 'BP 320 saved after OK');
  await ctx.close();
}));
// E. back button with unsaved change, app opened at home: back never leaves the app while there's something to save
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const url = pg.url();
  await pg.click('[data-step="1"][data-c="core"]');
  await pg.goBack(); await pg.waitForTimeout(400);
  log(!!await pg.$('dialog.ask[open]') && pg.url() === url, 'back: prompt shown, URL kept');
  await pg.click('dialog.ask [data-a="stay"]', { timeout: 3000 });
  log((await pg.textContent('.num[data-type="core"]')).trim() !== '', 'stay keeps the screen');
  await pg.goBack(); await pg.waitForTimeout(400);
  log(!!await pg.$('dialog.ask[open]') && pg.url() === url, 'back again: prompt again, still in the app');
  await pg.click('dialog.ask [data-a="stay"]', { timeout: 3000 });
  await pg.goBack(); await pg.waitForTimeout(400);
  log(!!await pg.$('dialog.ask[open]') && pg.url() === url, 'third back: prompt again');
  await pg.click('dialog.ask [data-a="drop"]', { timeout: 3000 }); await pg.waitForTimeout(400);
  log(!pg.url().includes('/p/'), "Don't save: back at " + pg.url().split('#')[1]);
  await pg.goForward(); await pg.waitForTimeout(400);
  log(pg.url().includes('/p/') && !await pg.$('dialog.ask[open]'), 'forward: back on the patient, no prompt');
  // link away, Stay, then link away and Save
  await pg.click('[data-step="1"][data-c="core"]');
  await pg.click('#haemolink'); await pg.waitForTimeout(300);
  await pg.click('dialog.ask [data-a="stay"]', { timeout: 3000 }); await pg.waitForTimeout(300);
  log(!pg.url().includes('haemo'), 'link, Stay: still on temps');
  await pg.click('#haemolink'); await pg.waitForTimeout(300);
  pg.once('dialog', d => d.accept()); // the grey carried-over boxes are left blank on Save: it asks first
  await pg.click('dialog.ask [data-a="save"]', { timeout: 3000 }); await pg.waitForTimeout(500);
  log(pg.url().includes('haemo'), 'link, Save: on BP screen');
  await pg.goBack(); await pg.waitForTimeout(400);
  log(pg.url().includes('/p/') && !pg.url().includes('haemo') && !await pg.$('dialog.ask[open]'), 'back from BP: temps, no prompt');
  await ctx.close();
}));
// F. setting Prewarm off on an unsaved timepoint: no prompt for the automatic NA
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  pg.once('dialog', d => d.accept()); await tapNow(pg, 'ev_wstop'); await pg.waitForTimeout(300);
  await pg.click('.pn.next'); await pg.waitForTimeout(300);
  log(!await pg.$('dialog.ask[open]'), 'Prewarm off then next: no prompt when nothing typed');
  await ctx.close();
}));
// G. Perioperative data: Enter on the last question, Shift+Enter back
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  await pg.click('#haemolink'); await pg.click('.links.three a:has-text("Pre-op")'); await pg.waitForSelector('details.sect');
  await pg.locator('details.sect').last().locator('summary').click();
  const last = pg.locator('details.sect').last().locator('.fld').last().locator('input, .chip').first();
  await last.focus(); await pg.keyboard.press('Enter');
  log(!await pg.$('dialog.ask[open]'), 'Enter on the last question: no error, no prompt');
  await ctx.close();
}));
// H. intra-op: after Surgery end the End readings fall due; once missed they and the unanswered details are listed,
// and Mark data collection as complete lists them first
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await pg.evaluate(() => { const k = 'prewarm-demo:settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.me = 'AB'; localStorage.setItem(k, JSON.stringify(s)); });
  await pg.reload(); await pg.waitForTimeout(600);
  await open(pg, 1);
  await tapNow(pg, 'io_done'); await pg.waitForTimeout(300);
  log(/End of surgery/.test(await pg.textContent('#clock .next')), 'after Surgery end the top bar asks for the End reading');
  await pg.clock.fastForward('00:06:00'); await pg.waitForTimeout(1500);
  const g = await pg.textContent('#gaps');
  log(/Intra-op temps not saved:[^:]*End/.test(g), 'missed End temp listed: ' + g);
  log(/BP, HR, BIS not saved:[^:]*End/.test(g), 'missed End BP listed');
  log(/Intra-op details unanswered: .*Blood loss/.test(g), 'unanswered intra-op details listed');
  let msg = ''; pg.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await pg.click('[data-done]'); await pg.waitForTimeout(300);
  log(/Still to fill/.test(msg) && !/Data collection complete/.test(await pg.textContent('main')), 'Mark complete asks first; Cancel leaves it open');
  await pg.click('#gaps a[href*="/iotemp/"]'); await pg.waitForTimeout(400);
  log(pg.url().includes('/iotemp/'), 'the link opens the first missed intra-op temp');
  await pg.click('#haemolink'); await pg.waitForSelector('input[data-in="sbp"]');
  log(/\d+ to answer/.test(await pg.textContent('.links a[href$="/form/intraop"]')), 'Intra-op details (BP, HR, BIS tab) shows how many are left');
  log(!!await pg.$('#gaps'), 'still to fill on the BP, HR, BIS tab too');
  await ctx.close();
}));
// I. swipe left / right changes tab; no pull-to-refresh; the BP, HR, BIS tick sits above Intra-op details
jobs.push(() => tryit(async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fails.push('page error: ' + e.message));
  await pg.goto('http://localhost:8080/prewarm/?demo'); await pg.waitForTimeout(800);
  await open(pg, 0);
  const cdp = await ctx.newCDPSession(pg);
  // from the reading's heading row (a touch that starts on a −/+ button is its hold-to-repeat, not a swipe)
  const swipe = async (x1, x2, y) => {
    y ??= await pg.evaluate(() => { const r = document.querySelector('.tp').getBoundingClientRect(); return r.top + r.height / 2; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 5, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pg.waitForTimeout(500);
  };
  await swipe(320, 80);
  log(pg.url().endsWith('/haemo'), 'swipe left opens BP, HR, BIS: ' + pg.url());
  const order = await pg.evaluate(() => { const a = document.querySelector('[data-sign="haemo"], [data-unsign="haemo"]'), b = document.querySelector('a[href$="/form/intraop"]'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  log(order, 'BP, HR, BIS tick above Intra-op details');
  await swipe(80, 320);
  log(/#\/p\/\w+$/.test(pg.url()), 'swipe right back to Temperatures: ' + pg.url());
  log(await pg.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY) === 'none', 'pull-to-refresh off');
  await ctx.close();
}));
// J. a stray tap on a key time with earlier ones empty asks first; times out of order are listed
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  let msg = ''; pg.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await tapNow(pg, 'io_done'); await pg.waitForTimeout(300);
  log(/In OT, Induction aren’t logged yet/.test(msg) && (await pg.textContent('[data-ev="io_done"] b')) === 'tap', 'stray Surgery end asks first; Cancel leaves it empty: ' + msg);
  pg.once('dialog', d => d.accept()); await tapNow(pg, 'ev_ot'); await pg.waitForTimeout(200);
  pg.once('dialog', d => d.accept()); await tapNow(pg, 'io_knife'); await pg.waitForTimeout(200);
  const ot = await pg.textContent('[data-ev="ev_ot"] b'), [h, m] = ot.split(':').map(Number), early = `${String((h + 23) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  await pg.waitForTimeout(700); await pg.click('[data-ev="io_knife"]'); await pg.fill('#evtime', early); await pg.waitForTimeout(1500);
  log(/Times out of order: Induction \d\d:\d\d is before In OT/.test(await pg.textContent('#gaps')), 'Induction an hour before In OT is listed');
  await ctx.close();
}));
// K. Perioperative data: Subject ID and group can be corrected (never blank, never a duplicate; group asks first);
// BMI is worked out from weight and height; a follow-up of a follow-up hides when the first answer goes to No
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  await pg.click('#haemolink'); await pg.click('.links.three a:has-text("Pre-op")'); await pg.waitForSelector('#f-enrol_id');
  await pg.fill('#f-enrol_id', 'DEMO-02'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(/already used/.test(await pg.textContent('#toast')) && await pg.inputValue('#f-enrol_id') === 'DEMO-01', 'duplicate Subject ID refused');
  await pg.fill('#f-enrol_id', 'DEMO-01A'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(/DEMO-01A/.test(await pg.textContent('#title')), 'Subject ID corrected');
  let asked = ''; pg.once('dialog', d => { asked = d.message(); d.accept(); });
  await pg.click('.chip[data-f="arm"][data-v="2"]'); await pg.waitForTimeout(200);
  log(/Change the group to 10 min/.test(asked) && await pg.getAttribute('.chip[data-f="arm"][data-v="2"]', 'aria-pressed') === 'true', 'group corrected after asking');
  await pg.click('.chip[data-f="arm"][data-v="2"]'); await pg.waitForTimeout(200);
  log(await pg.getAttribute('.chip[data-f="arm"][data-v="2"]', 'aria-pressed') === 'true', 'group never cleared by a second tap');
  await pg.fill('#f-wt', '70'); await pg.keyboard.press('Tab'); await pg.fill('#f-ht', '175'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(await pg.inputValue('#f-bmi') === '22.9', 'BMI worked out: ' + await pg.inputValue('#f-bmi'));
  await pg.click('.chip[data-f="ihd"][data-v="1"]'); await pg.click('.chip[data-f="ihd_mi"][data-v="0"]'); await pg.waitForTimeout(200);
  log(!!await pg.$('#f-ihd_mi_years'), 'years since MI shown');
  await pg.click('.chip[data-f="ihd"][data-v="0"]'); await pg.waitForTimeout(200);
  log(!await pg.$('#f-ihd_mi_years') && !await pg.$('.chip[data-f="ihd_mi"]'), 'IHD No hides both follow-ups');
  await ctx.close();
}));
// L. Save with every box blank removes the reading; a part-blank one asks, then shows in Still to fill; columns hidden in Settings show too
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  await pg.click('#haemolink'); await pg.waitForSelector('input[data-in="sbp"]');
  await pg.click('.strip a:has-text("60")'); await pg.waitForSelector('input[data-in="sbp"]');
  for (const k of ['sbp', 'dbp', 'map', 'hr', 'bis']) await pg.fill(`input[data-in="${k}"]`, '');
  await saveNow(pg); await pg.waitForTimeout(400);
  log(/removed/.test(await pg.textContent('#toast')) && !await pg.$('.strip a.done:has-text("60")'), 'Save with nothing entered removes the reading (nothing saved)');
  await pg.click('.strip a:has-text("60")'); await pg.waitForSelector('input[data-in="sbp"]');
  await pg.fill('input[data-in="sbp"]', '118');
  const accept = d => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined); // also the "what time was it taken?" question, when the demo clock is late
  await pg.waitForTimeout(900); // the tap guard after the first Save
  pg.on('dialog', accept); await saveNow(pg); await pg.waitForTimeout(400); pg.off('dialog', accept);
  await pg.waitForFunction(() => !!document.querySelector('#gaps'), null, { timeout: 4000 });
  log(/BP, HR, BIS saved with blanks: .*60 min \(Diastolic BP, Mean BP, Heart rate, BIS\)/.test(await pg.textContent('#gaps')), 'part-blank reading listed: ' + (await pg.textContent('#gaps')).replace(/\s+/g, ' ').slice(0, 300));
  await pg.evaluate(() => { location.hash = '#/settings'; }); await pg.waitForSelector('#me');
  log(!/Readings to enter live/.test(await pg.textContent('main')) && /When a reading is due/.test(await pg.textContent('main')), 'Settings no longer has a Readings to enter live section');
  await ctx.close();
}));
// M. typed form answers: letters refused where a number is asked; an odd temperature asked about
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  await pg.click('#haemolink'); await pg.click('a[href$="/form/intraop"]'); await pg.waitForSelector('#f-io_ebl');
  await pg.fill('#f-io_ebl', '500o'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(/Blood loss: numbers only/.test(await pg.textContent('#toast')) && await pg.inputValue('#f-io_ebl') === '', 'EBL with a letter refused');
  await pg.fill('#f-io_ebl', '500'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  await pg.goBack(); await pg.click('a[href$="/form/pacu"]'); await pg.waitForSelector('#f-pacu_temp');
  let asked = ''; pg.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await pg.fill('#f-pacu_temp', '3.66'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  log(/3\.66 °C looks unusual/.test(asked) && await pg.inputValue('#f-pacu_temp') === '', 'PACU temp 3.66 asked about, Cancel clears it');
  await pg.fill('#f-pacu_temp', '366'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
  await pg.goBack(); await pg.click('a[href$="/form/pacu"]'); await pg.waitForSelector('#f-pacu_temp');
  log(await pg.inputValue('#f-pacu_temp') === '36.6', 'PACU temp 366 read as 36.6');
  await ctx.close();
}));
// N. temperature alerts fire on every patient screen (here Intra-op details); BP, HR, BIS never alarm (owner, 13 Oct)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await open(pg, 1);
  await pg.click('#haemolink'); await pg.click('a[href$="/form/intraop"]'); await pg.waitForSelector('#f-io_ebl');
  const seen = [];
  for (let i = 0; i < 16; i++) {
    await pg.clock.fastForward('01:00'); await pg.waitForTimeout(150);
    const t = await pg.evaluate(() => { const b = document.querySelector('#banner'); return b && !b.hidden ? b.textContent : ''; });
    if (t && !seen.includes(t)) seen.push(t);
  }
  log(!seen.some(t => /BP, HR, BIS/.test(t)), 'no BP, HR, BIS alarm: ' + JSON.stringify(seen));
  log(seen.some(t => /Temperature .* reading due now/.test(t)), 'temperature due alert there too');
  await ctx.close();
}));
// O. same Subject ID twice is flagged on the list; storage full stays on screen; locking a patient still being
// charted says so
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => {
    const k = 'prewarm-demo:patients', all = JSON.parse(localStorage.getItem(k));
    const two = Object.values(all).find(r => r.f.enrol_id?.v === 'DEMO-02'); two.f.enrol_id.v = 'DEMO-01';
    localStorage.setItem(k, JSON.stringify(all));
  });
  await pg.reload(); await pg.waitForSelector('.list');
  log((await pg.$$('.twinline')).length === 2, 'both records with the same Subject ID flagged');
  let asked = ''; pg.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await pg.click('#select'); await pg.locator('[data-sel]').first().check(); await pg.click('#lock'); await pg.waitForTimeout(200);
  log(/Still being charted\?/.test(asked), 'lock warns about a patient changed in the last 3 hours: ' + asked.slice(0, 120));
  await pg.click('#seldone');
  await pg.locator('.list a').first().click(); await pg.waitForSelector('#clock');
  await pg.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await pg.click('.tabs2 a:first-child'); await pg.waitForSelector('.chip[data-sat="consent_st"]'); // consent is first on the Induction room tab
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.waitForTimeout(300);
  log(/couldn’t store the last change/.test(await pg.textContent('#storefull').catch(() => '')), 'storage full stays on screen');
  await ctx.close();
}));
// P. a reading saved late asks when it was taken (that time is what the forms show); Change time fixes it later
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await open(pg, 1);
  await pg.click('#haemolink'); await pg.waitForSelector('input[data-in="sbp"]');
  const tp = (await pg.textContent('.tp b')).trim();
  const due = (await pg.textContent('#due')).match(/\d\d:\d\d/)?.[0];
  let q = ''; const ans = d => { if (d.type() === 'prompt') { q = d.message(); d.accept('09:58'); } else d.accept(); };
  pg.on('dialog', ans);
  await saveNow(pg); await pg.waitForTimeout(400);
  pg.off('dialog', ans);
  log(new RegExp(`The ${tp} reading was due at ${due}`).test(q), `late ${tp} asks when it was taken: ${q}`);
  await pg.click(`.strip a:has-text("${tp.replace(' min', '')}")`); await pg.waitForSelector('[data-attime]');
  log(/Taken 09:58/.test(await pg.textContent('main')), 'the time given is kept');
  pg.once('dialog', d => d.accept('9.59'));
  await pg.click('[data-attime]'); await pg.waitForTimeout(300);
  log(/Taken 09:59/.test(await pg.textContent('main')), 'Change time (9.59 read as 09:59)');
  await ctx.close();
}));
// Q. a deleted patient can be restored (Settings › Delete participants), and can't be charted into while deleted
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const pid = pg.url().match(/#\/p\/(\w+)/)[1];
  await pg.goto('http://localhost:8080/prewarm/?demo#/delete'); await pg.waitForSelector('.dellist');
  const del = pg.locator('.dellist li', { hasText: 'DEMO-01' }).locator('[data-del]');
  await del.click(); await pg.waitForTimeout(700); await del.click(); await pg.waitForTimeout(200);
  await pg.goto(`http://localhost:8080/prewarm/?demo#/p/${pid}`); await pg.waitForTimeout(300);
  log(!/#\/p\//.test(pg.url()) && /was deleted\. Restore it in Settings/.test(await pg.textContent('#toast')), 'a deleted patient can’t be opened');
  await pg.goto('http://localhost:8080/prewarm/?demo#/delete'); await pg.waitForSelector('[data-restore]');
  await pg.click('[data-restore]'); await pg.waitForTimeout(200);
  await pg.goto('http://localhost:8080/prewarm/?demo#/'); await pg.waitForSelector('.list');
  log(/DEMO-01/.test(await pg.textContent('.list')), 'restored patient back on the list');
  await ctx.close();
}));
// R. Prewarm off due alerts like a reading (10-min group: 10 min after Prewarm on)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await pg.evaluate(() => { localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'TT' })); });
  await pg.goto('http://localhost:8080/prewarm/?demo#/new'); await pg.reload(); await pg.waitForSelector('#sid');
  await pg.fill('#sid', 'ALERT-1'); await pg.click('.seg .chip[data-v="2"]'); await pg.click('button[type=submit]'); await pg.waitForSelector('#syncchip');
  await tapNow(pg, 'pw_gown'); await pg.waitForTimeout(900); await tapNow(pg, 'pw_start'); // Gown on, Prewarm on (not a double tap)
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await pg.clock.fastForward('01:00'); await pg.waitForTimeout(150);
    const t = await pg.evaluate(() => { const b = document.querySelector('#banner'); return b && !b.hidden ? b.textContent : ''; });
    if (t && !seen.includes(t)) seen.push(t);
  }
  log(seen.some(t => /Prewarm off due now \(10 min of warming\)/.test(t)), 'Prewarm off alert: ' + JSON.stringify(seen));
  await ctx.close();
}));
// S. a reading due after Underbody warm / Gown warm was logged defaults to Yes for it; saved No after it is listed
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 1);
  const st = await pg.textContent('[data-ev="io_gown_start"] b');
  if (!/\d\d:\d\d/.test(st)) { await tapNow(pg, 'io_gown_start'); await pg.waitForTimeout(900); } // past the tap guard
  const t = await pg.textContent('[data-ev="io_gown_start"] b');
  await pg.click('.strip a:has-text("55")'); await pg.waitForSelector('#save');
  const due = (await pg.textContent('#due')).match(/\d\d:\d\d/)?.[0];
  if (due >= t) {
    log(await pg.getAttribute('.chip[data-c="gown"][data-v="1"]', 'aria-pressed') === 'true', `gown warming Yes by default (start ${t}, due ${due})`);
    await pg.click('.chip[data-c="gown"][data-v="0"]');
    const ok = d => d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept(); pg.on('dialog', ok);
    await saveNow(pg); await pg.waitForTimeout(400); pg.off('dialog', ok);
    await pg.goto(pg.url().replace(/\/iotemp\/\w+$/, '')); await pg.waitForSelector('#gaps');
    log(/Gown warming says No after its start time: .*55 min/.test(await pg.textContent('#gaps')), 'saved No after the start listed');
  } else log(false, `test setup: 55 min due ${due} is before gown start ${t}`);
  await ctx.close();
}));
// T. real touch double taps (100 ms apart) on Save and Log; typing a temperature then swiping / pressing back
jobs.push(() => tryit(async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fails.push('page error: ' + e.message));
  await pg.clock.install({ time: new Date('2026-10-13T09:00:00') });
  await pg.goto('http://localhost:8080/prewarm/?demo'); await pg.waitForTimeout(800);
  await open(pg, 0);
  const cdp = await ctx.newCDPSession(pg);
  const tapAt = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await pg.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const dbl = async sel => { const r = await pg.locator(sel).boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await tapAt(x, y); await pg.waitForTimeout(100); await tapAt(x, y); await pg.waitForTimeout(600); };
  const ok = d => d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept(); pg.on('dialog', ok);
  // Save
  const before = await pg.$$eval('.strip a.done', a => a.length);
  await pg.locator('#save').scrollIntoViewIfNeeded();
  await dbl('#save');
  const after = await pg.$$eval('.strip a.done', a => a.length);
  log(after === before + 1, `double-tap Save saves one timepoint (saved ${before} → ${after})`);
  pg.off('dialog', ok);
  // typing a temperature, then swiping to Others: the typed value counts, so leaving asks
  await pg.goto(pg.url().replace(/(#\/p\/\w+).*$/, '$1')); await pg.waitForSelector('.num[data-type="core"]');
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp input.num');
  await pg.keyboard.type('372'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); // the pad's OK
  const ty = await pg.evaluate(() => { const r = document.querySelector('.tp').getBoundingClientRect(); return r.top + r.height / 2; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: ty }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - 48 * i, y: ty }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(500);
  log(!!await pg.$('dialog.ask[open]'), 'typed temperature then swipe: asks to save');
  if (await pg.$('dialog.ask[open]')) await pg.click('dialog.ask [data-a="stay"]');
  log(/37\.2/.test(await pg.textContent('.num[data-type="core"]')), 'and the typed 37.2 is kept: ' + await pg.textContent('.num[data-type="core"]'));
  // typing then the phone's back button
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp input.num'); await pg.keyboard.type('368'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  await pg.goBack(); await pg.waitForTimeout(400);
  log(!!await pg.$('dialog.ask[open]'), 'typed temperature then back: asks to save');
  await ctx.close();
}));
// U. a temperature due now also shows in the Others tab's top bar (BP isn't due before In OT)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const main = await pg.textContent('#clock .next'), st = await pg.getAttribute('#clock .next', 'data-state');
  log(/Temp/.test(main) && /now|late/.test(st), 'demo pre-warming patient has a temperature due: ' + main);
  await pg.click('#haemolink'); await pg.waitForSelector('#haemolink[aria-selected="true"], .haemo, #clock'); await pg.waitForTimeout(400);
  log((await pg.textContent('#clock .next')) === main, 'Others tab top bar shows the temperature due: ' + await pg.textContent('#clock .next'));
  await ctx.close();
}));
// V. two patients at once (the next pre-warms while the last is in surgery): the home list shows what each needs now,
// and the open patient's screen alerts for the other one too (once opened on this phone)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.waitForTimeout(1200);
  const lines = await pg.$$eval('.dueline:not([hidden])', els => els.map(e => e.textContent));
  log(lines.length === 2 && lines.every(t => /^Temp \d+ min: due now$/.test(t)), 'home list shows each patient\'s due reading: ' + JSON.stringify(lines));
  // not opened on this phone yet (e.g. a teammate's patient): shown on the list but no alert
  await pg.evaluate(() => localStorage.removeItem('prewarm-demo:nag'));
  await open(pg, 1); await pg.waitForTimeout(1500);
  let bn = await pg.evaluate(() => document.querySelector('.banner')?.textContent || '');
  log(!/DEMO-01/.test(bn), 'a patient never opened here doesn\'t alert: ' + bn);
  // opened here: its due readings alert on the other patient's screen too
  await pg.goto('http://localhost:8080/prewarm/?demo'); await pg.waitForTimeout(500);
  await open(pg, 0); await pg.goBack(); await pg.waitForTimeout(300);
  await pg.evaluate(() => localStorage.removeItem('prewarm-demo:nag'));
  await open(pg, 1); await pg.waitForTimeout(1500);
  bn = await pg.evaluate(() => document.querySelector('.banner')?.textContent || '');
  log(/DEMO-01: Temperature \d+ min reading due now/.test(bn), 'other patient\'s due reading alerts on this screen: ' + bn);
  await ctx.close();
}));
// W. the phone closes the app with a reading half typed: it comes back when reopened; Don't save forgets it
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  pg.on('dialog', d => d.accept());
  await open(pg, 1);
  await pg.click('#haemolink'); await pg.waitForSelector('[data-in="sbp"]');
  await pg.fill('[data-in="sbp"]', '133');
  await pg.reload(); await pg.waitForSelector('[data-in="sbp"]');
  log(await pg.inputValue('[data-in="sbp"]') === '133', 'typed BP back after the app closed: ' + await pg.inputValue('[data-in="sbp"]'));
  log(/brought back/.test(await pg.textContent('#toast')), 'and it says so');
  // a temperature being typed (keyboard still up) when the app closes
  await pg.click('#templink'); await pg.waitForSelector('dialog.ask[open]'); await pg.click('dialog.ask [data-a="drop"]');
  await pg.waitForSelector('.num[data-type="core"]'); await pg.waitForTimeout(800);
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp input.num');
  await pg.keyboard.type('372'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  await pg.reload(); await pg.waitForSelector('.num[data-type="core"]');
  log((await pg.textContent('.num[data-type="core"]')).trim() === '37.2', 'temperature being typed back after the app closed: ' + await pg.textContent('.num[data-type="core"]'));
  // Don't save: gone when reopened
  await pg.click('#haemolink'); await pg.waitForSelector('dialog.ask[open]'); await pg.click('dialog.ask [data-a="drop"]');
  await pg.waitForSelector('[data-in="sbp"]');
  await pg.click('#templink'); await pg.waitForSelector('.num[data-type="core"]');
  log((await pg.textContent('.num[data-type="core"]')).trim() !== '37.2', 'Don\'t save forgets it: ' + await pg.textContent('.num[data-type="core"]'));
  await ctx.close();
}));
// X. layout: key times on top, the Temperatures / Others tab bar under them on both tabs, Save on screen;
// the no-pre-warming group keeps an Induction room tab that says so and asks consent
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 1);
  const below = () => pg.evaluate(() => !!(document.querySelector('.times')?.compareDocumentPosition(document.querySelector('main .ptabs')) & Node.DOCUMENT_POSITION_FOLLOWING));
  log(await below(), 'tab bar under the key times (Temperatures)');
  // the bottom part (other forms, Still to fill, Mark complete) is the same on both tabs
  const bottom = () => pg.evaluate(() => [...document.querySelectorAll('nav.links a, a.widebox, .textlinks a, .gaps h3, [data-done]')].map(e => e.textContent.trim().split('\n')[0]).join('|'));
  const tb = await bottom();
  await pg.click('#haemolink'); await pg.waitForSelector('[data-in="sbp"]');
  log(tb && tb === await bottom(), 'same bottom part on both tabs: ' + tb + ' / ' + await bottom());
  log(await below(), 'tab bar under the key times (Others)');
  const sv = await pg.locator('#save').boundingBox();
  log(sv.y + sv.height <= 844, 'Others: Save on screen without scrolling: ' + (sv.y + sv.height));
  await pg.goto('http://localhost:8080/prewarm/?demo#/new'); await pg.waitForSelector('#sid');
  await pg.fill('#sid', 'NOPW-X'); await pg.click('.seg .chip[data-v="3"]'); await pg.click('button[type=submit]');
  await pg.waitForSelector('.tabs2');
  // no pre-warming: Start opens the Induction room tab (consent and the before-surgery comfort question), and it stays
  // the opening tab until the patient is in OT
  await pg.waitForSelector('.nopw');
  const nopwUrl = pg.url();
  log(/Induction room/.test(await pg.textContent('.tabs2 [aria-selected="true"]')), 'no pre-warming: Start opens the Induction room tab');
  log(!!await pg.$('.chip[data-sat="consent_st"]'), 'consent is asked on the Induction room tab');
  log(/No pre-warming/.test(await pg.textContent('.nopw')) && !await pg.$('#save'), 'Induction room tab says no pre-warming, nothing to save');
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.waitForTimeout(800);
  log(/Consented/.test(await pg.textContent('.consentok')), 'consent answered: shown on the comfort question');
  log(!/Prewarm|Temp Prewarm/.test(await pg.textContent('.next').catch(() => '')), 'no pre-warming: no pre-warming countdown in the top bar');
  await pg.click('.chip[data-sat="sat_pre"][data-v="2"]'); await pg.waitForTimeout(100);
  const home = nopwUrl.split('#')[0], pid = nopwUrl.match(/#\/p\/(\w+)/)[1];
  await pg.goto(home + '#/'); await pg.goto(home + '#/p/' + pid); await pg.waitForSelector('.tabs2');
  log(/Induction room/.test(await pg.textContent('.tabs2 [aria-selected="true"]')), 'no pre-warming still opens on Induction room once comfort is answered');
  await pg.evaluate(i => { const k = 'prewarm-demo:patients', all = JSON.parse(localStorage.getItem(k)); all[i].f.ev_ot = { v: '08:00', t: Date.now(), by: 'T' }; localStorage.setItem(k, JSON.stringify(all)); }, pid);
  await pg.goto(home + '#/'); await pg.reload(); await pg.goto(home + '#/p/' + pid); await pg.waitForSelector('.tabs2');
  log(/Intra-op/.test(await pg.textContent('.tabs2 [aria-selected="true"]')), 'opens on Intra-op once In OT is logged');
  await ctx.close();
}));
// Y. Reset this subject asks twice (Cancel on the second keeps everything); PACU view opens only the PACU page;
// swiping on the key times doesn't change tab
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 1);
  let n = 0; const one = d => { n++; n === 2 ? d.dismiss() : d.accept(); }; pg.on('dialog', one);
  await pg.click('#resetsub'); await pg.waitForTimeout(400); pg.off('dialog', one);
  log(n === 2 && /\d\d:\d\d/.test(await pg.textContent('.times')), 'reset asks twice; Cancel keeps the times');
  pg.on('dialog', d => d.accept());
  await pg.click('#resetsub'); await pg.waitForTimeout(800);
  log(!/\d\d:\d\d/.test(await pg.textContent('.times')) && /DEMO-02/.test(await pg.textContent('#title')), 'reset clears the times, keeps the Subject ID');
  const cdp = await ctx.newCDPSession(pg);
  const y = await pg.evaluate(() => { const r = document.querySelector('.third.top').getBoundingClientRect(); return r.top + r.height / 2; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
  for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - 48 * k, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(500);
  log(!pg.url().endsWith('/haemo'), 'a swipe on the key times doesn\'t change tab');
  log((await pg.$$('[data-sign="iotemp"], [data-sign="prewarm"]')).length === 1, 'one temps complete tick: the open sub-tab\'s');
  await pg.goto('http://localhost:8080/prewarm/?demo#/'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { location.hash = '#/pacu'; }); await pg.click('a[href^="#/pacu/"] >> nth=0'); await pg.waitForTimeout(500);
  log(/· PACU$/.test(await pg.textContent('#title')) && /#\/pacu\/\w+$/.test(pg.url()), 'PACU view opens the PACU page: ' + await pg.textContent('#title'));
  // PACU in / To ward on the PACU page: a tap logs now
  await pg.click('[data-pev="pacu_in"]'); await pg.click('.kp [data-now]'); await pg.waitForTimeout(300);
  log(/^\d\d:\d\d$/.test(await pg.textContent('[data-pev="pacu_in"] b')), 'PACU in logged from the PACU page');
  await pg.click('#back'); await pg.waitForTimeout(300);
  log(pg.url().endsWith('#/pacu'), 'and back returns to the PACU list');
  await ctx.close();
}));
// Z. a section marked complete is read only until its tick is undone (which asks); each temps tick on its own sub-tab
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'ZZ' })));
  await pg.reload(); await pg.waitForTimeout(600);
  await open(pg, 1);
  log(!!await pg.$('[data-sign="iotemp"]') && !await pg.$('[data-sign="prewarm"]'), 'Intra-op sub-tab shows only the intra-op temps tick');
  await pg.click('#haemolink'); await pg.waitForSelector('[data-in="sbp"]');
  await pg.click('[data-sign="haemo"]'); await pg.waitForSelector('.sealnote');
  log(!await pg.$('#save') && await pg.$eval('[data-in="sbp"]', i => i.disabled), 'BP, HR, BIS complete: no Save, boxes locked');
  let asked = ''; pg.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await pg.click('[data-unsign="haemo"]'); await pg.waitForTimeout(300);
  log(/Undo/.test(asked) && !!await pg.$('.sealnote'), 'undo asks; Cancel keeps it complete');
  pg.once('dialog', d => d.accept());
  await pg.click('[data-unsign="haemo"]'); await pg.waitForSelector('#save');
  log(!await pg.$eval('[data-in="sbp"]', i => i.disabled), 'undone: editable again');
  // PACU marked complete: its page is read only, including PACU in / To ward
  await pg.click('a[href$="/form/pacu"]'); await pg.waitForSelector('[data-pev]');
  await pg.click('[data-sign="pacu"]'); await pg.waitForSelector('.sealnote');
  const before = await pg.textContent('[data-pev="pacu_in"] b');
  await pg.click('[data-pev="pacu_in"]'); await pg.waitForTimeout(300);
  log(await pg.textContent('[data-pev="pacu_in"] b') === before && await pg.$eval('.sealed input', i => i.disabled), 'PACU complete: times and answers locked');
  await ctx.close();
}));
// AA. temperature layout, carry-over from pre-warming, labels, Clear (owner, 13 Oct 2026)
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  const id = pg.url().match(/#\/p\/(\w+)/)[1];
  await pg.evaluate(id => { const k = 'prewarm-demo:patients', all = JSON.parse(localStorage.getItem(k)), t = Date.now();
    for (const [a, b] of [['prewarm_20_core', '36.8'], ['prewarm_20_chest', '33.5'], ['at_prewarm_20', '08:00']]) all[id].f[a] = { v: b, t, by: 'T' };
    localStorage.setItem(k, JSON.stringify(all)); }, id);
  await pg.goto(`http://localhost:8080/prewarm/?demo#/p/${id}/iotemp/base`); await pg.reload(); await pg.waitForSelector('.num[data-type="core"]');
  const txt = k => pg.textContent(`.num[data-type="${k}"]`).then(t => t.trim());
  log(await txt('core') === '36.8' && await txt('chest') === '33.5', 'first intra-op reading starts from the last pre-warming one: ' + await txt('core') + ' ' + await txt('chest'));
  const box = k => pg.locator(`.card:has(.num[data-type="${k}"])`).boundingBox();
  const [c, ch, a, th, ca] = [await box('core'), await box('chest'), await box('arm'), await box('thigh'), await box('calf')];
  log(c.width > ch.width * 1.8 && Math.abs(ch.y - a.y) < 2 && Math.abs(th.y - ca.y) < 2 && a.y < th.y && c.y < ch.y, 'core spans two columns; chest + arm, then thigh + calf');
  log((await pg.textContent('.card:has(.num[data-type="core"]) .clab')).includes('Core (spot on)'), 'core is labelled Core (spot on)');
  const strip = await pg.$$eval('.strip a', as => as.map(x => x.textContent.trim()).slice(0, 4));
  log(strip.join('|') === 'Arrival|Induction|5 min|10 min', 'strip labels: ' + strip.join('|'));
  // an empty skin box starts at 31 from its card; one tap on a number opens the box for typing
  await pg.click('#clearall'); await pg.waitForTimeout(200);
  log(await txt('core') === 'tap' && await txt('chest') === 'tap', 'Clear empties every box');
  await pg.click('.card[data-fill="thigh"] .clab');
  log(await txt('thigh') === '31.0', 'skin starts at 31.0');
  await pg.waitForTimeout(800); await pg.click('.num[data-type="core"]');
  log(!!await pg.$('input.num'), 'one tap opens the box for typing');
  await ctx.close();
}));
// AB. BP, HR, BIS alarm is off by default and comes on with its Settings toggle
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh('2026-10-13T10:00:00');
  await pg.goto('http://localhost:8080/prewarm/?demo#/settings'); await pg.waitForSelector('[data-g="remind"][data-k="haemo"]');
  log(!await pg.isChecked('[data-g="remind"][data-k="haemo"]'), 'BP, HR, BIS alarm toggle is off by default');
  await pg.check('[data-g="remind"][data-k="haemo"]'); await pg.waitForTimeout(200);
  await pg.goto('http://localhost:8080/prewarm/?demo#/'); await open(pg, 1);
  await pg.click('#haemolink'); await pg.click('a[href$="/form/intraop"]'); await pg.waitForSelector('#f-io_ebl');
  const seen = [];
  for (let i = 0; i < 16; i++) {
    await pg.clock.fastForward('01:00'); await pg.waitForTimeout(150);
    const t = await pg.evaluate(() => { const b = document.querySelector('#banner'); return b && !b.hidden ? b.textContent : ''; });
    if (t && !seen.includes(t)) seen.push(t);
  }
  log(seen.some(t => /BP, HR, BIS .* reading due now/.test(t)), 'with the toggle on, BP, HR, BIS alarms: ' + JSON.stringify(seen));
  await ctx.close();
}));
// AC. the quick-entry pads: time pad (typed digits, 3-digit times, bad times, Back, Clear), number pad (keys replace the
// old value, three digits save a temperature, Next moves on), the countdown opens its reading, no PACU times in the top row
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await open(pg, 0);
  pg.on('dialog', d => d.accept());
  log(!await pg.$('[data-ev="pacu_in"]') && !await pg.$('[data-ev="pacu_out"]'), 'no PACU in / To ward in the key times row');
  // time pad
  await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.keyboard.type('2575'); await pg.waitForTimeout(200);
  log(await pg.$('dialog.kp[open]') !== null && !(await pg.textContent('[data-ev="ev_ot"] b')).includes(':'), 'a bad time (25:75) is not saved');
  await pg.fill('#evtime', ''); await pg.keyboard.type('731');
  await pg.click('.kp [data-a="ok"]'); await pg.waitForTimeout(300);
  log((await pg.textContent('[data-ev="ev_ot"] b')) === '07:31', '731 and OK save 07:31: ' + await pg.textContent('[data-ev="ev_ot"] b'));
  await pg.waitForTimeout(800); await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-k="0"]'); await pg.click('.kp [data-k="9"]'); await pg.click('.kp [data-k="1"]'); await pg.click('.kp [data-k="5"]'); await pg.waitForTimeout(300);
  log((await pg.textContent('[data-ev="ev_ot"] b')) === '09:15', 'keys 0 9 1 5 save 09:15 (the fourth digit saves): ' + await pg.textContent('[data-ev="ev_ot"] b'));
  await pg.waitForTimeout(800); await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-a="back"]'); await pg.waitForTimeout(200);
  log((await pg.textContent('[data-ev="ev_ot"] b')) === '09:15' && !await pg.$('dialog.kp[open]'), 'Back closes the pad without a change');
  await pg.waitForTimeout(800); await pg.click('[data-ev="ev_ot"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-a="clear"]'); await pg.waitForTimeout(300);
  log((await pg.textContent('[data-ev="ev_ot"] b')) === 'tap', 'Clear (after asking) empties the time');
  // number pad: skin box
  await pg.waitForTimeout(800);
  await pg.click('.num[data-type="chest"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-k="3"]'); await pg.click('.kp [data-k="2"]'); await pg.click('.kp [data-k="5"]'); await pg.waitForTimeout(300);
  // three digits save the reading and the pad moves on to the next box (the next pad is open now: Back closes it)
  log(await pg.$('dialog.kp[open]') !== null && /Arm|Thigh|Calf|Set/.test(await pg.textContent('dialog.kp .kphead b')), 'the pad moves on to the next box: ' + await pg.textContent('dialog.kp .kphead b').catch(() => '-'));
  await pg.click('.kp [data-a="back"]'); await pg.waitForTimeout(300);
  log((await pg.textContent('.num[data-type="chest"]')).trim() === '32.5', 'keys 3 2 5 save 32.5: ' + await pg.textContent('.num[data-type="chest"]'));
  await pg.waitForTimeout(800); await pg.click('.num[data-type="chest"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-k="3"]');
  log(await pg.inputValue('dialog.kp input') === '3', 'the first key replaces the old value');
  await pg.click('.kp [data-a="back"]');
  // the countdown opens its reading's first box
  await pg.waitForTimeout(800); await pg.click('#clock .next'); await pg.waitForSelector('dialog.kp[open]');
  log(/Core/.test(await pg.textContent('.kp .kphead')), 'tapping the countdown opens the due reading\'s first box');
  await pg.click('.kp [data-a="back"]');
  // BP pad: Next moves to the next box
  await pg.click('#haemolink'); await pg.waitForSelector('dialog.ask[open]'); await pg.click('dialog.ask [data-a="drop"]'); // the unsaved chest value
  await pg.waitForSelector('[data-in="sbp"]'); await pg.waitForTimeout(800);
  await pg.click('[data-in="sbp"]'); await pg.waitForSelector('dialog.kp[open]');
  await pg.click('.kp [data-k="1"]'); await pg.click('.kp [data-k="2"]'); await pg.click('.kp [data-k="0"]'); await pg.click('.kp [data-a="next"]'); await pg.waitForTimeout(300);
  log(/Diastolic/.test(await pg.textContent('.kp .kphead')) && await pg.inputValue('[data-in="sbp"]') === '120', 'Next saves 120 and opens Diastolic BP');
  await ctx.close();
}));
// AD. progress ticks on the patient list (read only); Perioperative data has its own complete tick that locks its page, and
// "data collection complete" doesn't lock it
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'ZZ' })));
  await pg.reload(); await pg.waitForTimeout(600);
  await open(pg, 1);
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  const prog = async () => { await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForSelector('.list .progress'); return pg.$$eval(`.list a[href*="/${id}"]:not(.rowbtn) .progress > span`, as => as.map(a => (a.classList.contains('on') ? '+' : '-') + a.textContent.trim()).join('|')); };
  const back = async (h = '') => { await pg.evaluate(x => { location.hash = x; }, `#/p/${id}${h}`); await pg.waitForTimeout(500); };
  log((await prog()) === '-Pre-warm|-Intra-op temps|-BP, HR, BIS|-Pre-op|-Intra-op details|-PACU|-POD1|-POD2|-Discharge|-PayNow', 'list shows ten sections in order (Pre-op after BP, HR, BIS; PayNow last), none complete yet: ' + await prog());
  await back(); log(await pg.$('.progress') === null, 'no extra tick boxes on the patient page');
  await pg.click('[data-sign="iotemp"]'); await pg.waitForTimeout(300);
  log(/\+✓Intra-op temps/.test(await prog()), 'a section marked complete shows its tick on the list');
  const tapTo = async () => (await prog(), pg.$eval(`.list a[href*="/${id}"]:not(.rowbtn)`, a => a.getAttribute('href')));
  log(await tapTo() === `#/p/${id}`, 'tapping the patient opens the chart while a temps section is open: ' + await tapTo());
  for (const t of ['/prewarm', '/haemo']) { await back(t); const b = await pg.$(`[data-sign="${t.slice(1)}"]`); if (b) { await b.click(); await pg.waitForTimeout(300); } }
  log(await tapTo() === `#/p/${id}/data` && /\+✓BP, HR, BIS/.test(await prog()), 'temps and BP, HR, BIS ticked: tapping the patient opens Pre-op: ' + await tapTo());
  await back('/data'); await pg.waitForSelector('#f-enrol_id', { state: 'attached' });
  const d0 = await pg.$eval('#f-enrol_id', i => i.disabled);
  await pg.click('[data-sign="periop"]'); await pg.waitForSelector('.sealnote');
  log(!d0 && await pg.$eval('#f-enrol_id', i => i.disabled), 'Perioperative data complete: its boxes lock');
  pg.once('dialog', d => d.accept());
  await pg.click('[data-unsign="periop"]'); await pg.waitForSelector('[data-sign="periop"]');
  log(!await pg.$eval('#f-enrol_id', i => i.disabled), 'undone: editable again');
  // data collection complete does not close Perioperative data
  await back(); await pg.waitForSelector('[data-done]'); pg.once('dialog', d => d.accept()); await pg.click('[data-done]'); await pg.waitForTimeout(300);
  await back('/data'); await pg.waitForSelector('#f-enrol_id', { state: 'attached' });
  log(!await pg.$eval('#f-enrol_id', i => i.disabled), 'data collection complete leaves Perioperative data open');
  await ctx.close();
}));
// AE. the last warming reading (10 min for arm 2, 30 min for arm 1) marks pre-warming complete and goes to the intra-op temps
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'ZZ' })));
  await pg.reload(); await pg.waitForTimeout(600);
  await open(pg, 1); // DEMO-02: 10 min of warming
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  const sealed = () => pg.evaluate(i => { const a = JSON.parse(localStorage.getItem('prewarm-demo:patients')); return !!a[i].f.sign_prewarm; }, id);
  await pg.evaluate(h => { location.hash = h; }, `#/p/${id}/prewarm/5`); await pg.waitForSelector('.num[data-type="core"]');
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp[open]'); await pg.click('.kp [data-k="3"]'); await pg.click('.kp [data-k="6"]'); await pg.click('.kp [data-k="5"]'); await pg.waitForTimeout(300);
  if (await pg.$('dialog.kp[open]')) await pg.click('.kp [data-a="back"]'); await pg.waitForTimeout(300);
  const seenD = []; pg.on('dialog', d => { seenD.push(d.message().slice(0, 60)); d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined); });
  await saveNow(pg); await pg.waitForTimeout(500);
  log(/prewarm\/10$/.test(await pg.evaluate(() => location.hash)) && !await sealed(), 'the 5 min save moves to 10 min and does not complete pre-warming: ' + JSON.stringify(seenD) + await pg.textContent('#toast').catch(() => '') + await pg.evaluate(() => location.hash));
  log(await pg.$('.card.dflt [data-type="core"]') !== null, 'a value carried over from the last reading shows as a light grey default');
  await pg.click('.num[data-type="core"]'); await pg.waitForSelector('dialog.kp[open]'); await pg.click('.kp [data-k="3"]'); await pg.click('.kp [data-k="6"]'); await pg.click('.kp [data-k="6"]'); await pg.waitForTimeout(300);
  if (await pg.$('dialog.kp[open]')) await pg.click('.kp [data-a="back"]');
  await saveNow(pg); await pg.waitForTimeout(600);
  log(/\/iotemp/.test(await pg.evaluate(() => location.hash)) && await sealed(), 'the 10 min save marks pre-warming complete and opens the intra-op temps: ' + await pg.evaluate(() => location.hash));
  await ctx.close();
}));
// AF. Refresh now at the bottom of the home page (and in Settings): never loses anything, says so
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.click('#refreshnow'); await pg.waitForTimeout(500);
  log(/Up to date/.test(await pg.textContent('#toast')) && await pg.$('.list a') !== null, 'Refresh now keeps the patient list and says it is up to date');
  await ctx.close();
}));
// AG. the update helper page (outside the app's scope, for a phone that won't update): clears the app's saved code, keeps
// patients, and opens the app again
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => caches.open('prewarm-v1').then(c => c.put('/x', new Response('old'))));
  await pg.goto('http://localhost:8080/prewarm-update/'); await pg.click('#go');
  await pg.waitForURL(/\/prewarm\/$/, { timeout: 10000 });
  log(!(await pg.evaluate(() => caches.keys())).includes('prewarm-v1'), 'update helper clears the saved copy and opens the app');
  await ctx.close();
}));
// AH. a section marked complete is read only: timepoints with no data are hidden, nothing is offered for logging
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  await pg.evaluate(() => localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'ZZ', v: 3 })));
  await pg.reload(); await pg.waitForTimeout(600);
  await open(pg, 1);
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  const strip = () => pg.$$eval('.strip a', as => as.map(a => a.textContent.trim()).join('|'));
  // a bare time left behind by a blank save (no readings) doesn't keep a point visible
  await pg.evaluate(i => { const k = 'prewarm-demo:patients', all = JSON.parse(localStorage.getItem(k)); all[i].f.at_prewarm_15 = { v: '08:50', t: Date.now(), by: 'T' }; localStorage.setItem(k, JSON.stringify(all)); }, id);
  await pg.reload(); await pg.waitForTimeout(600);
  await pg.evaluate(h => { location.hash = h; }, `#/p/${id}/prewarm`); await pg.waitForSelector('[data-sign="prewarm"]');
  const before = await strip();
  await pg.click('[data-sign="prewarm"]'); await pg.waitForSelector('.sealnote');
  const after = await strip();
  log(/15 min/.test(before) && !/15 min/.test(after) && /10 min/.test(after), 'complete: pre-warming points with no data are hidden: ' + before + ' -> ' + after);
  await pg.evaluate(h => { location.hash = h; }, `#/p/${id}/prewarm/20`); await pg.waitForSelector('.strip');
  log(!/20 min/.test(await strip()) && await pg.$('.sealnote') !== null, 'opening a hidden point goes to one that has data');
  await ctx.close();
}));
// AI. list shortcuts: Share and PACU buttons per line, Select to export with All / None, Select none apart from Lock / Unlock;
// "Downloaded" no longer asked; the "Study IDs only" line is gone
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  log(await pg.$$eval('.list li a.rowbtn', a => a.map(x => x.getAttribute('href').replace(/\/p\/\w+/, '')).join(' ')) === '#/share/h #/pacushare/h #/share/h #/pacushare/h', 'each patient line has Share and PACU buttons');
  log(/Email \/ PayNow/.test(await pg.textContent('#payview')) && !await pg.$('#pacuview'), 'Email / PayNow replaces PACU view at the top');
  log(!/Study IDs only/.test(await pg.textContent('main')), 'the Study IDs only line is gone');
  await pg.click('#selexport'); await pg.waitForSelector('.seltools');
  log(/0 selected to export/.test(await pg.textContent('.selcount')) && await pg.isDisabled('#exportsel'), 'Select to export starts with none and Export disabled');
  await pg.click('#selallx');
  log(/2 selected/.test(await pg.textContent('.selcount')) && !await pg.isDisabled('#exportsel'), 'Select all picks every patient');
  await pg.click('#selnone');
  log(/0 selected/.test(await pg.textContent('.selcount')), 'Select none clears');
  await pg.click('[data-sel]');
  const dl = pg.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await pg.click('#exportsel');
  const d = await dl;
  log(!!d && /\.xlsx$/.test(d.suggestedFilename()), 'Export downloads an Excel file for the selected case: ' + (d && d.suggestedFilename()));
  await pg.click('#seldone'); await pg.click('#select'); await pg.waitForSelector('#lock');
  const y = id => pg.$eval(id, e => Math.round(e.getBoundingClientRect().y));
  log(await y('#selnone') !== await y('#lock') && await y('#selnone') < await y('#lock'), 'Select none is on its own line, above Lock / Unlock');
  log(await pg.$eval('#selnone', e => e.className) !== await pg.$eval('#unlock', e => e.className), 'Select none looks different from Lock / Unlock');
  await pg.click('#seldone');
  await pg.click('.list li:first-child a.rowbtn[href$="/pacushare/h"]'); await pg.waitForSelector('.paculink');
  log(/Share to PACU/.test(await pg.textContent('#title')) && /demo mode/.test(await pg.textContent('.paculink')), 'the PACU button opens Share to PACU');
  await pg.click('#back'); await pg.waitForSelector('.list');
  log(await pg.evaluate(() => location.hash) === '#/', 'its back button goes to the list');
  const first = (await pg.getAttribute('.list li:first-child a.rowbtn', 'href')).split('/')[2];
  await pg.evaluate(x => { location.hash = '#/p/' + x + '/data'; }, first); await pg.waitForSelector('details.sect');
  log(!(await pg.textContent('main')).includes('Downloaded'), 'Pre-op no longer asks Downloaded');
  await ctx.close();
}));
// AJ. the old address moves a phone to the new one (owner, 13 Oct 2026): demo phones go straight away, keeping the path, query and #
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  const NEW = 'http://127.0.0.1:' + (process.env.PORT || 8080) + '/prewarm/';
  await pg.goto('http://localhost:8080/prewarm/?demo&oldhost=' + encodeURIComponent(NEW) + '#/nurse/abcdefghijklmnopqrstuv');
  await pg.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 12000 });
  log(/\/prewarm\/\?demo#\/nurse\/abcdefghijklmnopqrstuv$/.test(pg.url()), 'the redirect keeps the path, query and # part (nurse link): ' + pg.url());
  await pg.waitForTimeout(2500);
  log(/^http:\/\/127\.0\.0\.1:/.test(pg.url()) && !/oldhost/.test(pg.url()), 'no redirect loop on the new address');
  const upd = await pg.goto('http://127.0.0.1:8080/prewarm/update.html'); await pg.waitForSelector('#go');
  log(upd.ok() && /Get the latest version/.test(await pg.textContent('#go')), 'update helper page inside the app folder');
  await ctx.close();
}));
// AK. chart-review reminders (14 Oct 2026): POD1 / POD2 show as due on the list from the first / second day after the
// day the patient was started, until their Complete tick
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  const setCreated = days => pg.evaluate(d => { const a = JSON.parse(localStorage.getItem('prewarm-demo:patients')); for (const p of Object.values(a)) p.created = Date.now() - d * 864e5; localStorage.setItem('prewarm-demo:patients', JSON.stringify(a)); }, days);
  const pod = async () => (await pg.$$eval('.podline', els => els.map(e => e.textContent))).join('|');
  log(await pod() === '', 'no POD reminder on the day of surgery: ' + await pod());
  await setCreated(2); await pg.reload(); await pg.waitForTimeout(800);
  log(/POD1 overdue · POD2 due today/.test(await pod()), 'two days on: POD1 overdue, POD2 due today: ' + await pod());
  await pg.click('.list a'); await pg.waitForTimeout(600);
  const gp = await pg.textContent('#gaps').catch(() => '');
  log(/POD1 chart review overdue/.test(gp) && /POD2 chart review due today/.test(gp), 'Still to fill lists POD1 and POD2 once due: ' + gp.slice(0, 160));
  await pg.goBack(); await pg.waitForTimeout(500);
  await pg.evaluate(() => { const a = JSON.parse(localStorage.getItem('prewarm-demo:patients')); for (const p of Object.values(a)) p.f.sign_pod1 = { v: 'AB 1 Jan', t: Date.now(), by: 'AB' }; localStorage.setItem('prewarm-demo:patients', JSON.stringify(a)); });
  await pg.reload(); await pg.waitForTimeout(800);
  log(!/POD1/.test(await pod()) && /POD2 due today/.test(await pod()), 'POD1 complete: only POD2 is left: ' + await pod());
  // more than five patients: a Subject ID search appears and filters the list; a waiting patient is badged
  await pg.evaluate(() => { const a = JSON.parse(localStorage.getItem('prewarm-demo:patients')); const first = Object.values(a)[0];
    for (let i = 0; i < 5; i++) { const c = JSON.parse(JSON.stringify(first)); c.id = 'zz' + i; c.f.enrol_id = { v: 'ZED-0' + i, t: Date.now(), by: 'AB' }; a[c.id] = c; }
    localStorage.setItem('prewarm-demo:patients', JSON.stringify(a)); });
  await pg.reload(); await pg.waitForTimeout(800);
  log(await pg.$('#psearch') !== null, 'a search box shows with more than five patients');
  await pg.fill('#psearch', 'zed-03'); await pg.waitForTimeout(200);
  log(await pg.$$eval('.list li:not([hidden])', l => l.length) === 1, 'typing a Subject ID leaves only that patient');
  await pg.fill('#psearch', ''); await pg.waitForTimeout(200);
  log(await pg.$$eval('.list li:not([hidden])', l => l.length) === 7, 'clearing the search shows everyone');
  await ctx.close();
}));
// AL. carried-over (grey) measurements are not saved unless confirmed (owner, 14 Oct 2026: "stopped on save"): only what
// was typed, tapped or confirmed with OK is stored; the set temp and warming Yes / No still carry
jobs.push(() => tryit(async () => {
  const { ctx, pg } = await fresh();
  pg.on('dialog', d => d.accept());
  await open(pg, 0);
  const id = (await pg.evaluate(() => location.hash)).split('/')[2];
  const stored = async k => pg.evaluate(([i, k]) => JSON.parse(localStorage.getItem('prewarm-demo:patients'))[i].f[k]?.v ?? null, [id, k]);
  const point = async () => (await pg.evaluate(() => location.hash)).match(/prewarm\/(\d+)/)?.[1];
  await pg.evaluate(h => { location.hash = h; }, `#/p/${id}/prewarm/10`); await pg.waitForSelector('#save'); await pg.waitForTimeout(500);
  for (const c of ['core', 'chest']) { if (await pg.$(`.card[data-fill="${c}"]`)) await pg.click(`.card[data-fill="${c}"] .clab`); }
  await pg.waitForTimeout(800); await pg.click('#save'); await pg.waitForTimeout(1500);
  log(await stored('prewarm_10_chest') != null, 'a tapped value is saved: ' + await stored('prewarm_10_chest'));
  // the app moves on to the next reading, which shows the carried-over values in grey
  const n1 = await point();
  log(await pg.$('.card.dflt .num[data-type="chest"]') !== null, 'the next reading (' + n1 + ' min) shows the carried-over value in grey');
  await pg.waitForTimeout(900); await pg.click('#save'); await pg.waitForTimeout(1500);
  log(await stored(`prewarm_${n1}_chest`) == null, 'a grey carried-over value is not saved: ' + await stored(`prewarm_${n1}_chest`));
  // tap the value and OK: it is confirmed, so it is saved
  await pg.evaluate(h => { location.hash = h; }, `#/p/${id}/prewarm/${n1}`); await pg.waitForSelector('#save'); await pg.waitForTimeout(500);
  if (await pg.$('.card.dflt .num[data-type="chest"]')) { await pg.click('.num[data-type="chest"]'); await pg.waitForSelector('dialog.kp[open]'); await pg.click('.kp [data-a="ok"]'); await pg.waitForTimeout(300); }
  await pg.waitForTimeout(900); await pg.click('#save'); await pg.waitForTimeout(1500);
  log(await stored(`prewarm_${n1}_chest`) != null, 'tapping the value and OK confirms it, so it is saved: ' + await stored(`prewarm_${n1}_chest`));
  await ctx.close();
}));
await runJobs();
await b.close();
if (fails.length) { console.error('prewarm edge: FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('prewarm edge: ok (midnight, surgery end, double-tap Save, BP checks, back button, Log, Enter, still to fill, swipe, stray taps, time order, corrections, BMI, follow-ups, blanks, typed answers, alerts everywhere, duplicates, storage full, lock warning, late readings, delete and restore, prewarm off alert, warming yes / no, touch double taps, typing then leaving, other tab due, two patients, app closed mid-reading, layout, reset, PACU view, sections closed once complete, layout and carry-over, haemo alarm toggle, keypad popups, progress ticks on the list and perioperative tick, last warming reading completes pre-warming)');
