// Browser test of the prewarming app in demo mode (fake data only), at phone size, with an axe accessibility check.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node prewarm/test/e2e.mjs            SHOTS=<dir> also saves phone screenshots
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fixtureFiles } from './fixture-form.mjs';
const JSZip = createRequire(import.meta.url)('../js/vendor/jszip.min.js');
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/prewarm/`;
const SHOTS = process.env.SHOTS;

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let n = 0;
const toastSaysE = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: 5000 });
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
const axe = async name => {
  if (!fs.existsSync(AXE)) return;
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }));
  const bad = r.violations.filter(v => ['serious', 'critical'].includes(v.impact));
  assert.equal(bad.length, 0, `${name}: ${bad.map(v => v.id + ' ' + v.nodes[0]?.target).join('; ')}`);
};

try {
  await page.goto(BASE + '?demo');
  await page.waitForSelector('.list a');
  assert.match(await page.textContent('.list'), /DEMO-01/);
  await axe('home'); await shot('home');

  // new patient screen (owner, 21 Oct 2026): Save draft and Patient declined need only the Subject ID; drafts reopen the
  // form from the list; the list is by Subject ID, largest on top; Share buttons are here too
  await page.click('#new');
  assert.ok(await page.$('#nshare') && await page.$('#npacu'), 'Share subject and Share to PACU on the new patient screen');
  await page.fill('#sid', 'DEMO-10'); await page.click('#draft');
  await page.waitForSelector('.list a.draft');
  assert.match(await page.textContent('.list a.draft'), /Draft/);
  assert.deepEqual(await page.$$eval('.list li[data-sid]', l => l.map(x => x.dataset.sid)), ['demo-10', 'demo-02', 'demo-01'], 'largest Subject ID on top, numbers as numbers');
  await page.click('.list a.draft'); await page.waitForSelector('#sid');
  assert.equal(await page.inputValue('#sid'), 'DEMO-10', 'a draft reopens the new patient form');
  await page.fill('#sid', 'DEMO-9');
  page.once('dialog', d => d.accept()); await page.click('#declined');
  await page.waitForSelector('.list a.declined');
  assert.match(await page.textContent('.list a.declined'), /DEMO-9[\s\S]*Declined to participate/);
  assert.equal(await page.$('.list a.draft'), null, 'the draft became the declined patient');
  await page.click('#new'); await page.fill('#sid', 'DEMO-9'); await page.click('#draft');
  await toastSaysE(/already on this phone/);
  await page.goto(BASE + '?demo#/'); await page.waitForSelector('.list a');
  await page.click('#new');
  await page.fill('#sid', 'TEST-02');
  await page.click('.seg .chip[data-v="2"]');
  await page.click('button[type=submit]');
  // the patient opens on the main screen: times, then pre-warming temperatures
  await page.waitForSelector('.times');
  // consent, then pre-op comfort in its place, on the Induction room tab, one line once answered; post-op comfort is on the PACU page
  assert.match(await page.textContent('.comfort'), /Consent/);
  assert.deepEqual(await page.$$eval('.chip[data-sat="consent_st"]', x => x.map(b => b.dataset.v)), ['0', '1'], 'Declined left, Consented right');
  assert.equal(await page.$('.chip[data-sat="sat_pre"]'), null, 'comfort waits for consent');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/fit.png' });
  // one timepoint fits a 390 x 844 phone: Save is on screen without scrolling
  const sv = await page.locator('#save').boundingBox();
  assert.ok(sv.y + sv.height <= 844, 'Save is below the fold: ' + (sv.y + sv.height));
  await page.click('.chip[data-sat="consent_st"][data-v="1"]'); await page.waitForTimeout(800); // the tap guard
  assert.match(await page.textContent('.comfort:has([data-sat="sat_pre"])'), /before surgery.*Consented/s);
  const sv2 = await page.locator('#save').boundingBox();
  assert.ok(sv2.y + sv2.height <= 844, 'Save is below the fold once consented: ' + (sv2.y + sv2.height));
  await page.click('.chip[data-sat="sat_pre"][data-v="2"]');
  assert.match(await page.textContent('.comfort.done:has([data-satedit="sat_pre"])'), /Neutral/);
  assert.match(await page.textContent('.comfort.done:has([data-satedit="consent_st"])'), /Consented, copy given/);
  // Email and PayNow: a button on the Induction room tab opens their own page; saved, the button says so (never the values)
  assert.ok(await page.$('.comfort.done:has([data-satedit="consent_st"]) + a.paybtn'), 'the Email and PayNow button sits right under consent');
  await page.waitForTimeout(800); // the tap guard after an answer
  await page.click('a.paybtn'); await page.waitForSelector('#payemail');
  await axe('email and PayNow');
  await page.fill('#paynow', '6123 4567'); await page.click('#payf button[type=submit]');
  await toastSaysE(/8 digits/);
  await page.fill('#payemail', 'pt@example.com'); await page.fill('#paynow', '9123 4567'); await page.click('#payf button[type=submit]');
  await page.waitForSelector('a.paybtn');
  assert.match(await page.textContent('a.paybtn'), /Saved/);
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('pt@example.com'), 'the email is never kept in the patient record');
  assert.equal(await page.$('.chip[data-sat="sat_post"]'), null, 'post-op comfort is not on the temperatures screen');
  assert.equal(await page.$('.links a[href$="/form/satis"]'), null, 'no separate satisfaction screen');
  assert.match(await page.textContent('main .ptabs [aria-selected="true"]'), /Induction room/);
  assert.match(await page.textContent('.badge'), /10 min pre-warming/, 'group shows with the pre-warming temperatures');
  // Gown on is still empty, so it asks first (a stray tap shouldn't log out of order)
  let asked = ''; page.once('dialog', d => { asked = d.message(); d.accept(); });
  await page.click('[data-ev="pw_start"]'); await page.click('.kp [data-now]'); // the time pad: Now logs the current time
  await page.waitForTimeout(200);
  assert.match(asked, /Gown on isn’t logged yet/);
  assert.match(await page.textContent('[data-ev="pw_start"] b'), /^\d\d:\d\d$/, 'tapping an empty time and Now sets now');
  assert.match(await page.textContent('#due'), /due \d\d:\d\d/);
  // the 0-min reading is due right now: the due time shows its 'now' state
  await page.waitForFunction(() => document.querySelector('#due')?.dataset.state === 'now', null, { timeout: 5000 });
  // the top bar: what to log next and when (the 0-min temperature, due now); no "Time now" clock
  assert.equal(await page.locator('#clock .now').count(), 0);
  assert.match(await page.textContent('#clock .next'), /Temp 0 min\s*now/);
  assert.equal(await page.getAttribute('#clock .next', 'data-state'), 'now');
  // the 0-min reading is due now: the banner floats over the top of the page (nothing moves) and hides on a tap
  await page.waitForSelector('#banner:not([hidden])');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#banner')).position), 'fixed');
  // a tap on the alarm goes to the reading's screen but does not open a pad (owner, 13 Oct 2026); the countdown does
  await page.click('#banner'); await page.waitForTimeout(400);
  assert.equal(await page.$('dialog.kp[open]'), null, 'tapping the alarm opens no pad');
  await page.click('#clock .next'); await page.waitForSelector('dialog.kp[open]');
  assert.match(await page.textContent('.kp .kphead'), /Core/, 'tapping the countdown opens the first box of the reading');
  await axe('keypad'); await shot('keypad');
  await page.click('.kp [data-a="back"]'); await page.waitForTimeout(300);
  // the app bar shows the sync status, not a Log button (owner, 13 Oct 2026); a time is set to now from its pad, then cleared
  assert.match(await page.textContent('#syncchip'), /Local/, 'sync status chip in the bar');
  assert.equal(await page.$('#lognext'), null, 'no Log button');
  await page.waitForTimeout(900); await page.click('[data-ev="ev_wstop"]'); page.once('dialog', d => d.accept()); // earlier times aren't logged yet: asks first
  await page.waitForSelector('.kp [data-now]'); await page.click('.kp [data-now]'); await page.waitForTimeout(900);
  assert.match(await page.textContent('[data-ev="ev_wstop"] b'), /^\d\d:\d\d$/, 'Now sets warming off to now');
  await page.click('[data-ev="ev_wstop"]');
  let cleared = ''; page.once('dialog', d => { cleared = d.message(); d.accept(); });
  await page.click('.kp [data-a="clear"]'); await page.waitForTimeout(200);
  assert.match(cleared, /Clear the Prewarm off time/, 'Clear asks first');
  assert.equal(await page.textContent('[data-ev="ev_wstop"] b'), 'tap');
  // changing a set time
  await page.click('[data-ev="pw_start"]');
  await page.waitForSelector('#evtime');
  await axe('patient'); await shot('patient');
  // two hours ago (a fixed clock time would read as tomorrow's when the test runs more than 12 h later)
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const ago = new Date(Date.now() - 2 * 3600e3), PW = hm(ago), PW1 = hm(new Date(+ago + 60e3));
  await page.fill('#evtime', PW);
  assert.equal(await page.textContent('[data-ev="pw_start"] b'), PW);

  // pre-warming reading, option B: empty temp taps to 36.5, type core, nudge chest, pick sensation, save
  assert.match(await page.textContent('.tp'), /0 min/);
  // previous / next timepoint buttons beside the strip
  const at = () => page.textContent('.strip a.on');
  const before = await at();
  assert.ok(await page.$('span.pn.prev'), 'no previous before the first timepoint');
  await page.click('.pn.next'); await page.waitForFunction(b => document.querySelector('.strip a.on')?.textContent !== b, before);
  await page.click('.pn.prev'); await page.waitForFunction(b => document.querySelector('.strip a.on')?.textContent === b, before);
  // one tap on a temperature opens its box for typing (owner, 13 Oct 2026); 325 is read as 32.5
  await page.click('.num[data-type="chest"]');
  await page.fill('input.num', '325'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  assert.equal((await page.textContent('.num[data-type="chest"]')).trim(), '32.5', 'one tap opens the box; 325 is read as 32.5');
  // anywhere on an empty temperature's card (not its number) fills the starting value: skin 31
  await page.click('.card[data-fill="arm"] .clab');
  assert.equal((await page.textContent('.num[data-type="arm"]')).trim(), '31.0', 'tapping the card label fills 31.0 for skin');
  assert.equal(await page.$('.card[data-fill="arm"]'), null, 'a filled card is no longer one big target');
  await page.click('.num[data-type="core"]');
  await page.fill('input.num', '366');
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  assert.equal((await page.textContent('.num[data-type="core"]')).trim(), '36.6', '366 is read as 36.6');
  await page.click('[data-step="-1"][data-c="chest"]');
  assert.equal((await page.textContent('.num[data-type="chest"]')).trim(), '32.4');
  await page.click('.chip[data-c="ts"][data-v="1"]');
  assert.match(await page.textContent('.tsscale tr.on'), /slightly warm.*tolerably uncomfortable, warm/, 'the Thermal Sensation Scale under the chips marks the picked row');
  await axe('reading'); await shot('reading');
  // thigh and calf are still blank: Save asks first (Cancel keeps the reading open)
  let blanks = ''; page.once('dialog', d => { blanks = d.message(); d.dismiss(); });
  await page.click('#save'); await page.waitForTimeout(200);
  assert.match(blanks, /Thigh, Calf, Set temp on gown are blank/);
  assert.match(await page.textContent('.tp'), /0 min/, 'not saved after Cancel');
  // Prewarm on was moved two hours back, so this reading is late: Save also asks when it was taken (due time filled in)
  const asked2 = [];
  const ans = d => { asked2.push(d.type() + ': ' + d.message()); d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept(); };
  page.on('dialog', ans);
  await page.click('#save');
  await page.waitForFunction(() => /5 min/.test(document.querySelector('.tp')?.textContent || ''));
  page.off('dialog', ans);
  assert.ok(asked2.some(m => m.startsWith(`prompt: The 0 min reading was due at ${PW}. What time was it taken?`)), 'late reading asks when it was taken: ' + JSON.stringify(asked2));
  assert.equal((await page.textContent('.num[data-type="core"]')).trim(), '36.6', 'carried over from the last reading');
  await page.click('[data-step="1"][data-c="core"]');
  assert.equal((await page.textContent('.num[data-type="core"]')).trim(), '36.7');
  await shot('reading-next');

  // warming stopped: set temp becomes NA for later timepoints
  page.once('dialog', d => d.accept()); // Gown on is still empty
  await page.click('[data-ev="ev_wstop"]');
  await page.fill('#evtime', PW1); // one minute after Prewarm on: every later reading has the set temp NA
  // leaving a reading with unsaved changes asks first: Stay keeps them, Save saves and goes on
  await page.click('.strip a:has-text("10")');
  await page.waitForSelector('dialog.ask[open]');
  assert.match(await page.textContent('dialog.ask'), /Save the 5 min reading\?/);
  await axe('save prompt');
  await page.click('dialog.ask [data-a="stay"]');
  assert.match(await page.textContent('.tp'), /5 min/, 'Stay keeps the screen');
  assert.equal((await page.textContent('.num[data-type="core"]')).trim(), '36.7', 'and the change');
  await page.click('.strip a:has-text("10")');
  // thigh and calf are still blank, and the reading is late: OK to both (the due time as when it was taken)
  page.on('dialog', ans);
  await page.click('dialog.ask [data-a="save"]');
  await page.waitForFunction(() => /10 min/.test(document.querySelector('.tp')?.textContent || ''));
  page.off('dialog', ans);
  await page.click('.strip a:has-text("5")');
  await page.waitForFunction(() => /5 min/.test(document.querySelector('.tp')?.textContent || ''));
  assert.equal((await page.textContent('.num[data-type="core"]')).trim(), '36.7', 'Save in the prompt saved it');
  assert.equal(await page.$('dialog.ask'), null, 'no prompt when nothing changed');
  await page.click('.strip a:has-text("10")');
  await page.waitForFunction(() => /10 min/.test(document.querySelector('.tp')?.textContent || ''));
  await page.waitForFunction(() => document.querySelector('.chip[data-c="set"][data-v="NA"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });

  // intra-op tab: group not shown
  await page.click('#iotemplink');
  await page.waitForFunction(() => /Baseline/.test(document.querySelector('.tp')?.textContent || ''));
  assert.doesNotMatch(await page.textContent('main'), /10 min pre-warming/, 'group hidden outside the pre-warming temperatures');
  // an empty room temp fills 20.0 when its card is tapped
  await page.click('.card[data-fill="room"] .clab');
  assert.equal((await page.textContent('.num[data-type="room"]')).trim(), '20.0', 'room temp starts at 20');
  await shot('intraop-temps');

  // form view: the paper form's day-of-surgery pages, filled in, with Save as PDF / Print
  // (the room temp above wasn't saved: Don't save leaves without it)
  await page.click('.textlinks a[href$="/form"]');
  await page.click('dialog.ask [data-a="drop"]');
  await page.waitForSelector('.fpage');
  assert.equal((await page.$$('.fpage')).length, 4);
  assert.match(await page.textContent('.form'), /PRE-OPERATIVE \(INTERVENTION\)[\s\S]*☒ 10-minute prewarming/);
  assert.ok(await page.$('#print'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scroll');
  await axe('form view (print)'); await shot('form-print');
  // the study's Word form (demo: chosen on this tab; live: uploaded by an admin), filled in: shown, downloaded
  assert.match(await page.textContent('main'), /simple version/);
  const zip = new JSZip(); for (const [k, v] of Object.entries(fixtureFiles())) zip.file(k, v);
  await page.setInputFiles('#blankfile', { name: 'blank form.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await page.waitForSelector('#doc section.docx', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#dl').disabled);
  assert.match(await page.textContent('#doc'), /☒ 10-minute prewarming/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'Word pages fit the phone');
  await shot('form-word');
  const [wdl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  assert.equal(wdl.suggestedFilename(), 'TEST-02 data collection form.docx');
  const got = await JSZip.loadAsync(fs.readFileSync(await wdl.path()));
  const docXml = await got.file('word/document.xml').async('string');
  assert.match(docXml, /w14:checked w14:val="1"/, 'ticked in the Word file');
  assert.doesNotMatch(await got.file('docProps/core.xml').async('string'), /Test Author/, 'file details removed');
  await page.goBack();

  // three tabs under the key times (Induction room, Intraop temp, BP, HR, BIS), no subtabs; the other forms' links are on all
  assert.deepEqual(await page.$$eval('main .ptabs a', a => a.map(x => x.textContent.trim())), ['Induction room', 'Intraop temp', 'BP, HR, BIS']);
  assert.equal(await page.$('.tabs2'), null, 'no subtabs under the tabs');
  assert.equal(await page.getAttribute('#iotemplink', 'aria-selected'), 'true');
  assert.ok(await page.$('.links a[href$="/form/intraop"]'), 'other forms are on the Induction room tab too');
  await page.click('#haemolink');
  await page.waitForSelector('input[data-in="sbp"]');
  assert.equal(await page.getAttribute('#haemolink', 'aria-selected'), 'true');
  assert.match(await page.textContent('[data-sign="haemo"]'), /Mark BP, HR, BIS complete/, 'the sign-off names its section');
  assert.ok(await page.$('[data-done]'), 'Mark data collection as complete on this tab too');
  // other data: the rest of the study's pages on one page, under headers open by default, from the small box on the
  // BP, HR, BIS tab; Enter and the arrow keys move between questions
  const rowsOf = () => page.$$eval('.links.three', ns => ns.map(n => [...n.querySelectorAll('a')].map(a => a.firstChild.textContent.replace(/\s*✓/, '').trim())));
  assert.deepEqual(await rowsOf(), [['Pre-op', 'Intra-op details', 'PACU'], ['POD1', 'POD2', 'Discharge']], 'Pre-op left of Intra-op details; POD1, POD2, Discharge under them');
  for (const row of await page.$$('.links.three')) {
    const ys = await row.$$eval('a', as => as.map(a => Math.round(a.getBoundingClientRect().y)));
    assert.ok(ys.every(y => y === ys[0]), 'each row of three shares one line');
  }
  assert.equal((await page.textContent('#haemolink')).trim(), 'BP, HR, BIS', 'second tab is BP, HR, BIS');
  await page.click('.links.three a:has-text("Pre-op")');
  await page.waitForSelector('details.sect');
  assert.equal(await page.$$eval('details.sect:not([open])', x => x.length), 0, 'Pre-op page: every section starts open');
  assert.equal(await page.$$eval('details.sect', x => x.length), 4, 'Pre-op page: Subject ID and group, pre-op, meds, bloods');
  assert.match(await page.textContent('details.sect[data-pg="meds"] summary'), /Not started|\d+ of \d+ filled/, 'a header says how much is filled');
  const pid3 = (await page.evaluate(() => location.hash)).split('/')[2];
  await page.evaluate(h => { location.replace(h); }, `#/p/${pid3}/data/day1`); await page.waitForSelector('details.sect');
  assert.equal(await page.$$eval('details.sect', x => x.length), 2, 'POD1 page: chart review and analgesia');
  assert.equal(await page.$$eval('details.sect[open]', x => x.length), 2, 'POD1 page: both sections open');
  assert.deepEqual(await page.$$eval('.podtabs a', a => a.map(x => x.textContent.trim())), ['POD1', 'POD2', 'Discharge'], 'shortcuts to POD1, POD2 and Discharge');
  assert.equal(await page.getAttribute('.podtabs a[aria-current="page"]', 'href').then(h => h.endsWith('/data/day1')), true, 'the open page is marked');
  // presets fill the free-text dose box (same stored text)
  await page.click('.chip[data-f="d1_pcm"][data-v="1"]'); await page.waitForSelector('#f-d1_pcm_dose'); await page.click('.fld:has(#f-d1_pcm_dose) .preset:has-text("Anarex")');
  assert.equal(await page.inputValue('#f-d1_pcm_dose'), 'Anarex 2 tab tds', 'a preset fills the dose');
  await page.click('.podtabs a:has-text("Discharge")'); await page.waitForSelector('[data-sign="dc"]');
  assert.equal(await page.$('.presets'), null, 'no dose presets on the discharge page');
  await page.click('.podtabs a:has-text("POD1")'); await page.waitForSelector('#f-d1_pcm_dose');
  await page.goBack(); await page.goBack(); await page.waitForSelector('#f-d1_pcm_dose'); // keep the history as it was
  await page.evaluate(h => { location.replace(h); }, `#/p/${pid3}/data/day2`); await page.waitForSelector('details.sect');
  assert.deepEqual(await page.$$eval('details.sect', x => x.map(d => d.dataset.pg)), ['pod2', 'pod2an'], 'POD2 page: chart review and analgesia');
  assert.match(await page.textContent('[data-sign="pod2"]'), /Mark POD2 complete/);
  await page.evaluate(h => { location.replace(h); }, `#/p/${pid3}/data/dc`); await page.waitForSelector('details.sect');
  assert.deepEqual(await page.$$eval('details.sect', x => x.map(d => d.dataset.pg)), ['dc'], 'Discharge has its own page');
  assert.match(await page.textContent('[data-sign="dc"]'), /Mark Discharge complete/, 'and its own tick');
  await page.evaluate(h => { location.replace(h); }, `#/p/${pid3}/data`); await page.waitForSelector('details.sect');
  await page.fill('#f-age', '67'); await page.keyboard.press('Enter');
  assert.match(await page.textContent('details.sect[data-pg="preop"] summary'), /1 of \d+ filled/, 'Enter saves the answer');
  const nextKey = await page.evaluate(() => document.activeElement.dataset.f);
  assert.ok(nextKey && nextKey !== 'age', 'Enter moves to the next question');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-age', '↑ goes back');
  await page.keyboard.press('ArrowDown');
  if (await page.evaluate(() => document.activeElement.classList.contains('chip'))) {
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute(`.chip[data-f="${nextKey}"][data-v]:nth-child(2)`, 'aria-pressed'), 'true', '→ then Enter picks the second choice');
  }
  await page.click('details.sect[data-pg="preop"] summary');
  assert.deepEqual(await page.$$eval('details.sect[open]', x => x.map(d => d.dataset.pg)), ['study', 'meds', 'bloods'], 'a header folds its section');
  await page.click('details.sect[data-pg="preop"] summary');
  assert.equal(await page.$$eval('details.sect:not([open])', x => x.length), 0, 'a header unfolds its section');
  await axe('other data'); await shot('other-data');
  await page.goBack(); await page.waitForSelector('input[data-in="sbp"]');
  await page.goBack(); await page.waitForSelector('.textlinks a[href$="/sheet"]');

  // sheet view
  await page.click('.textlinks a[href$="/sheet"]');
  await page.waitForSelector('.sheet');
  assert.match(await page.textContent('.sheet'), /36\.6/);
  assert.equal(await page.$('#del'), null, 'no delete on the spreadsheet view');
  await axe('form view'); await shot('form-view');
  await page.goBack();

  // BP, HR, BIS: typed boxes (no − / +); Enter goes to the next box without a redraw, so the keyboard stays up
  await page.click('#haemolink');
  await page.waitForSelector('input[data-in="sbp"]');
  assert.equal(await page.$('[data-step]'), null, 'no − / + on BP, HR, BIS');
  const hd = await page.$('input[data-in="dbp"]');
  await page.fill('input[data-in="sbp"]', '120');
  await page.focus('input[data-in="sbp"]'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.in), 'dbp', 'Enter moves to diastolic');
  await page.keyboard.type('70');
  assert.ok(await hd.evaluate(el => el.isConnected), 'the same box: no redraw while typing');
  await page.focus('input[data-in="hr"]'); await page.keyboard.type('64'); // a computer keyboard types straight into the box
  assert.equal(await page.inputValue('input[data-in="dbp"]'), '70');
  page.once('dialog', d => d.accept()); // mean BP and BIS left blank
  await page.click('#save');
  await page.waitForFunction(() => /15/.test(document.querySelector('.tp')?.textContent || ''));
  await page.click('.strip a:has-text("Arrival")');
  await page.waitForSelector('input[data-in="sbp"]');
  assert.equal(await page.inputValue('input[data-in="hr"]'), '64', 'saved');
  await axe('bp hr bis'); await shot('haemo');

  // intra-op details: TXA total worked out, transfusion volumes
  await page.click('.links a[href$="/form/intraop"]');
  await page.click('.chip[data-f="io_txa"][data-v="1"]');
  await page.fill('#f-io_txa_bolus', '1000'); await page.dispatchEvent('#f-io_txa_bolus', 'change');
  await page.fill('#f-io_txa_inf', '500'); await page.dispatchEvent('#f-io_txa_inf', 'change');
  assert.equal(await page.inputValue('#f-io_txa_total'), '1500');
  await page.fill('input[data-f="io_rbc"]', '2'); await page.dispatchEvent('input[data-f="io_rbc"]', 'change');
  await page.click('#addix');
  await axe('intra-op'); await shot('intraop');
  await page.goBack();

  // Share subject and Share to PACU at the bottom of the case, each its own page (demo mode: not available)
  await page.click('.caseshare a[href$="/share"]');
  await page.waitForSelector('.paculink');
  assert.match(await page.textContent('main'), /Share subject[\s\S]*Not available in demo mode/);
  await axe('share subject');
  await page.goBack(); await page.waitForSelector('.caseshare');
  await page.click('.caseshare a[href$="/pacushare"]');
  await page.waitForFunction(() => /pacushare$/.test(location.hash) && document.querySelector('.paculink'));
  assert.match(await page.textContent('main'), /PACU nurse link[\s\S]*Not available in demo mode/);
  await page.goBack(); await page.waitForSelector('.caseshare');

  // PACU: NuDESC total
  await page.click('.links a[href$="/form/pacu"]');
  // sub-screens keep the running timer and the sync status in the top bar
  assert.ok(await page.$('#clock'), 'timer on the PACU screen');
  assert.ok(await page.$('#syncchip'), 'sync status on the PACU screen');
  await page.click('.chip[data-f="nd_dis"][data-v="1"]');
  await page.click('.chip[data-f="nd_psy"][data-v="2"]');
  assert.equal(await page.inputValue('#f-pacu_nudesc'), '3');
  // from the top: mid-scroll, axe counts a chip half under the sticky top bar as too small
  await page.evaluate(() => scrollTo(0, 0));
  await axe('pacu'); await shot('pacu');

  // settings and export
  await page.goto(BASE + '?demo#/settings');
  await page.fill('#me', 'tt'); await page.dispatchEvent('#me', 'change');
  await page.click('[data-site="NUH"]');
  assert.equal(await page.getAttribute('[data-site="NUH"]', 'aria-pressed'), 'true');
  await axe('settings'); await shot('settings');
  // screen size: zooms the whole app on this phone, and is remembered
  await page.click('[data-zoom="1.25"]');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).zoom), '1.25');
  await page.reload(); await page.waitForSelector('#me');
  assert.equal(await page.getAttribute('[data-zoom="1.25"]', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).zoom), '1.25');
  await page.click('[data-zoom="1"]');
  // every reading live by default; deleting participants only from Settings
  assert.doesNotMatch(await page.textContent('main'), /Readings to enter live/, 'no Readings to enter live section; every reading is live');
  await page.click('a[href="#/delete"]');
  await page.waitForSelector('.dellist');
  await axe('delete participants'); await shot('delete');
  const delBtn = page.locator('.dellist li', { hasText: 'TEST-02' }).locator('[data-del]');
  await delBtn.click(); await page.waitForTimeout(700); await delBtn.click(); // a double tap isn't a deliberate second tap
  // it moves to the Deleted list, where it can be restored
  await page.waitForSelector('[data-restore]');
  assert.equal(await page.locator('.dellist li', { hasText: 'TEST-02' }).locator('[data-del]').count(), 0);
  await page.goto(BASE + '?demo#/');
  assert.doesNotMatch(await page.textContent('.list'), /TEST-02/, 'deleted from the list');
  // mark data collection complete (bottom of the main screen): shown at the top and in the patient list
  await page.click('.list a:has-text("DEMO-01")');
  await page.waitForSelector('[data-done]');
  assert.ok(await page.$('[data-sign="prewarm"]') && !await page.$('[data-sign="iotemp"]'), 'only the open sub-tab\'s temps complete tick');
  await page.click('[data-done]');
  assert.match(await page.textContent('.donetop'), /Data collection complete\s*TT \d+ \w+ \d{4} \d\d:\d\d/);
  await page.goto(BASE + '?demo#/');
  assert.match(await page.textContent('.list'), /DEMO-01[\s\S]*✓ Data collection complete/);
  // tapping a completed patient warns first, opens on the second tap
  await page.click('.list a:has-text("DEMO-01")');
  assert.match(await page.textContent('.list a.warned'), /marked complete .*Tap again to open/);
  assert.doesNotMatch(page.url(), /#\/p\//, 'still on the list');
  await page.click('.list a:has-text("DEMO-01")');
  await page.waitForSelector('.donetop');
  // locking (demo mode lets anyone try it): select all but the latest, lock; locked rows can't be opened
  await page.goto(BASE + '?demo#/');
  await page.click('#select');
  // the list is by Subject ID (largest on top), so the latest edited one is named on the button
  const latestSid = (await page.textContent('#selall')).match(/All but (.+) \(latest\)/)[1];
  await page.click('#selall');
  const unticked = await page.$$eval('[data-sel]:not(:checked)', cs => cs.map(c => c.closest('label').textContent));
  assert.ok(unticked.length === 1 && unticked[0].includes(latestSid), 'the latest stays out: ' + unticked);
  page.once('dialog', d => d.accept());
  await page.click('#lock');
  await page.waitForSelector('.list a.locked');
  assert.match(await page.textContent('.list a.locked'), /Locked by the study admin/);
  await axe('home with locked patients'); await shot('locked');
  // an admin (anyone, in demo mode) opens a locked patient read only
  await page.click('.list a.locked');
  await page.waitForSelector('.board');
  assert.ok(await page.evaluate(() => document.body.classList.contains('ro')), 'read only');
  assert.equal(await page.isVisible('#save'), false, 'no Save');
  assert.equal(await page.isVisible('#syncchip'), true, 'sync status still shows when read only');
  await shot('locked-readonly');
  await page.goto(BASE + '?demo#/');
  assert.equal(await page.evaluate(() => document.body.classList.contains('ro')), false);
  // unlock them all again
  await page.click('#select');
  const nSel = await page.$$eval('[data-sel]', x => x.length);
  for (let i = 0; i < nSel; i++) await page.locator('[data-sel]').nth(i).check();
  await page.click('#unlock');
  assert.equal(await page.$('.list a.locked'), null, 'unlocked');
  await page.goto(BASE + '?demo#/');
  assert.equal(await page.$('a[href="#/export"]'), null, 'no export on the home page');
  await page.goto(BASE + '?demo#/settings');
  await page.click('a[href="#/export"]');
  await page.waitForSelector('#xl');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xl')]);
  const file = await dl.path();
  const head = fs.readFileSync(file).subarray(0, 2).toString();
  assert.equal(head, 'PK', 'export is a zip (xlsx)');
  if (SHOTS) fs.copyFileSync(file, `${SHOTS}/export.xlsx`);

  assert.deepEqual(errors, []);
  console.log('prewarm e2e: ok');
} finally {
  await b.close();
}
