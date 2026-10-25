// Two phones sharing a patient through the local Firebase emulators (fake data, demo project "demo-prewarm"; never
// the live project). Run from the repo root with a static server on port 8080 (python3 -m http.server 8080):
//   ~/.cache/anawj-rules/node_modules/.bin/firebase emulators:exec --only firestore,auth --project demo-prewarm \
//     --config <firebase.json with prewarm/firestore.rules, firestore 8085, auth 9099> "node prewarm/test/sync.emulator.mjs"
// tools/test-prewarm-sync.sh does all of that.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixtureFiles } from './fixture-form.mjs';
const JSZip = createRequire(import.meta.url)('../js/vendor/jszip.min.js');
const SHOTS = process.env.SHOTS;
const BASE = `http://localhost:${process.env.PORT || 8080}/prewarm/?emulator`;
const FS = 'http://127.0.0.1:8085/v1/projects/demo-prewarm/databases/(default)/documents';

// the NUH join code, written past the rules (emulator only)
const put = await fetch(`${FS}/codes/NUH`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { code: { stringValue: 'NUH-TEST-CODE' }, setAt: { integerValue: '1' }, setBy: { stringValue: 'lead@example.com' } } }) });
assert.ok(put.ok, 'seed code: ' + put.status);
const adm = await fetch(`${FS}/admins/lead@example.com`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { name: { stringValue: 'Lead' } } }) });
assert.ok(adm.ok, 'seed admin: ' + adm.status);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
async function phone(initials) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(initials + ': ' + e.message));
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('body[data-cloud=ready]');
  await page.fill('#me', initials); await page.dispatchEvent('#me', 'change');
  return page;
}
const toastSays = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: 15000 })
  .catch(async e => { throw new Error(`waited for ${re}, toast says: ${await page.textContent('#toast')}`); });

try {
  const a = await phone('AA');
  // wrong code is refused
  await a.fill('#code', 'WRONG-CODE'); await a.click('#join');
  await toastSays(a, /isn’t a join code/);
  await a.fill('#code', 'NUH-WRONG123'); await a.click('#join');
  await toastSays(a, /isn’t right for NUH/);
  if (!(await a.$('#code'))) throw new Error('after wrong code: ' + (await a.textContent('main')).replace(/\s+/g, ' ').slice(0, 300));
  if (SHOTS) await a.screenshot({ path: SHOTS + '/sync-join.png', fullPage: true });
  await a.fill('#code', 'nuh-test-code'); await a.click('#join');
  await toastSays(a, /Joined the NUH team/);
  assert.match(await a.textContent('main'), /Sharing with the NUH team/);
  await a.waitForFunction(() => /Synced just now/.test(document.querySelector('.syncline')?.textContent || ''), null, { timeout: 15000 });
  if (SHOTS) await a.screenshot({ path: SHOTS + '/sync-joined.png' });

  // phone A starts a patient and saves the 0-min pre-warming reading
  await a.goto(BASE + '#/new');
  await a.fill('#sid', 'SYNC-01'); await a.click('.seg .chip[data-v="1"]'); await a.click('button[type=submit]');
  await a.waitForSelector('.times');
  await a.click('.num[data-type="core"]'); await a.fill('input.num', '366'); await a.keyboard.press('Enter');
  a.once('dialog', d => d.accept()); // only core entered: Save asks about the blank boxes
  await a.click('#save');
  await toastSays(a, /0 min saved/);

  // phone B joins and sees it
  const bb = await phone('BB');
  await bb.fill('#code', 'NUH-TEST-CODE'); await bb.click('#join');
  await toastSays(bb, /Joined the NUH team/);
  await bb.goto(BASE + '#/');
  await bb.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 15000 });
  await bb.click('.list a');
  await bb.click('.textlinks a[href$="/sheet"]');
  await bb.waitForFunction(() => /36\.6/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 15000 });

  // moving to the new address (owner, 13 Oct 2026): the old address moves a synced team phone and carries its join code and
  // initials in the # part; a half-entered reading keeps it where it is, with a bar saying why
  const NEWHOST = 'http://127.0.0.1:' + (process.env.PORT || 8080) + '/prewarm/';
  const mv = await a.context().newPage();
  mv.on('pageerror', e => errors.push('mover: ' + e.message));
  await a.evaluate(() => localStorage.setItem('prewarm:unsaved:test:prewarm:5', '{"x":1}'));
  await mv.goto(BASE + '&oldhost=' + encodeURIComponent(NEWHOST));
  await mv.waitForFunction(() => /half entered/.test(document.querySelector('#moved')?.textContent || ''), null, { timeout: 25000 });
  assert.match(mv.url(), /^http:\/\/localhost:/, 'a half-entered reading keeps the phone on the old address');
  await a.evaluate(() => localStorage.removeItem('prewarm:unsaved:test:prewarm:5'));
  await mv.click('#movenow');
  await mv.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 25000 });
  assert.match(mv.url(), /\?emulator#\/join\/NUH\/NUH-TEST-CODE\/AA$/, 'the new address gets the join code and initials in the # part: ' + mv.url());
  assert.doesNotMatch(mv.url(), /oldhost/);
  await mv.waitForSelector('#joinlink');
  assert.equal(await mv.inputValue('#me'), 'AA', 'initials carried over');
  await mv.click('#joinlink');
  await toastSays(mv, /Joined the NUH team/);
  await mv.goto(NEWHOST + '?emulator#/');
  await mv.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 15000 });
  await mv.close();

  // phone B adds the 5-min reading; phone A gets it
  await bb.goto(bb.url().replace('/sheet', '/prewarm/5'));
  await bb.click('[data-step="1"][data-c="core"]');
  bb.once('dialog', d => d.accept());
  await bb.click('#save');
  await a.goto(BASE + '#/');
  await a.click('.list a'); await a.click('.textlinks a[href$="/sheet"]');
  await a.waitForFunction(() => /36\.7/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 15000 });

  // the PACU nurse link: phone A makes it on the Share to PACU page (from the PACU page); a phone that joined nothing opens it, fills in PACU, and the
  // team's phones get it (and the other way); the nurse's phone has nothing else; stopping the link ends access
  await a.goto(BASE + '#/');
  await a.click('.list a');
  await a.click('.links a[href$="/form/pacu"]');
  await a.click('.paculink a[href$="/pacushare"]');
  // made by itself the first time the page opens, then the same link every time (owner, 21 Oct 2026)
  await a.waitForSelector('.pacuurl', { timeout: 20000 });
  const nurseLink = await a.inputValue('.pacuurl');
  assert.match(nurseLink, /#\/nurse\/[a-z2-9]{24}$/, 'a long random token in the link');
  assert.ok(await a.$('.paculink svg'), 'and a QR code');
  assert.equal(await a.$('[data-pacu-stop]'), null, 'only an admin can stop it');
  if (SHOTS) await a.screenshot({ path: SHOTS + '/pacu-link.png' });
  await a.goto(BASE + '#/'); await a.click('.list a.rowbtn[href$="/pacushare/h"]'); await a.waitForSelector('.pacuurl');
  assert.equal(await a.inputValue('.pacuurl'), nurseLink, 'the list\'s PACU button shows the same link');
  await a.goBack(); await a.goBack();
  await a.goBack(); await a.waitForSelector('[data-pev="pacu_in"]');
  const nctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const nu = await nctx.newPage();
  nu.on('pageerror', e => errors.push('nurse: ' + e.message));
  await nu.goto(nurseLink);
  await nu.waitForSelector('[data-pev="pacu_in"]', { timeout: 25000 });
  assert.match(await nu.textContent('#title'), /PACU · SYNC-01/);
  if (SHOTS) await nu.screenshot({ path: SHOTS + '/pacu-nurse.png', fullPage: true });
  await nu.fill('#ninit', 'NN'); await nu.dispatchEvent('#ninit', 'change');
  await nu.click('[data-pev="pacu_in"]'); await nu.click('.kp [data-now]');
  await nu.waitForTimeout(900); // the 0.7 s tap guard after a pad swallows a tap near the last one (the sub-page layout put this chip there)
  await nu.click('.chip[data-f="pacu_shiver"][data-v="0"]');
  await nu.waitForFunction(() => /Saved to the team/.test(document.querySelector('#nstat')?.textContent || ''), null, { timeout: 20000 });
  await a.waitForFunction(() => /\d\d:\d\d/.test(document.querySelector('[data-pev="pacu_in"] b')?.textContent || '') && document.querySelector('.chip[data-f="pacu_shiver"][data-v="0"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 25000 });
  await bb.goto(BASE + '#/'); await bb.click('.list a'); await bb.click('.links a[href$="/form/pacu"]');
  await bb.waitForFunction(() => /\d\d:\d\d/.test(document.querySelector('[data-pev="pacu_in"] b')?.textContent || ''), null, { timeout: 25000 });
  // the other way: phone A answers a PACU question, the nurse's page gets it
  await a.fill('#f-pacu_temp', '36.2'); await a.keyboard.press('Tab');
  await nu.waitForFunction(() => document.querySelector('#f-pacu_temp')?.value === '36.2', null, { timeout: 25000 });
  // the nurse's phone has no patients and no other screens' data
  await nu.goto(BASE + '#/');
  assert.equal(await nu.$('.list a'), null, 'the nurse phone has no patient list');
  const stopNurse = async ad => { // an admin stopping the link ends access (checked once the admin has signed in, below)
    await ad.goto(BASE + '#/'); await ad.waitForSelector('.list a.rowbtn');
    await ad.click('.list a.rowbtn[href$="/pacushare/h"]'); await ad.waitForSelector('[data-pacu-stop]', { timeout: 20000 });
    ad.once('dialog', d => d.accept());
    await ad.click('[data-pacu-stop]');
    await ad.waitForSelector('[data-pacu-make], .pacuurl', { timeout: 20000 });
    await nu.goto(nurseLink);
    await nu.waitForFunction(() => /was stopped/.test(document.body.textContent), null, { timeout: 25000 });
    await nctx.close();
  };

  // an admin signs in with an emailed link and makes a join code
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ad = await ctx.newPage();
  ad.on('pageerror', e => errors.push('admin: ' + e.message));
  await ad.goto(BASE + '#/settings');
  await ad.waitForSelector('body[data-cloud=ready]');
  await ad.click('#adminin');
  await ad.fill('#adminemail', 'Lead@Example.com');
  await ad.click('#adminsend');
  await ad.waitForFunction(() => /Sign-in link sent/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  const oob = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-prewarm/oobCodes')).json();
  const link = oob.oobCodes.filter(c => c.requestType === 'EMAIL_SIGNIN').pop();
  assert.equal(link.email, 'lead@example.com');
  await ad.goto(BASE + '&adminlink&mode=signIn&lang=en&apiKey=fake-api-key&oobCode=' + encodeURIComponent(link.oobCode));
  await ad.waitForFunction(() => /NUH-TEST-CODE/.test(document.querySelector('main')?.textContent || '') && location.hash === '#/admin', null, { timeout: 20000 })
    .catch(async () => { throw new Error('admin page: ' + ad.url() + ' | ' + (await ad.textContent('main')).replace(/\s+/g, ' ').slice(0, 300) + ' | toast: ' + await ad.textContent('#toast')); });
  assert.doesNotMatch(ad.url(), /oobCode/, 'the one-time code leaves the address bar');
  assert.match(await ad.textContent('main'), /NUH-TEST-CODE/);
  assert.match(await ad.textContent('main'), /AA/, 'members listed');
  // the admin sets a password, logs out, and signs in with email and password (owner, 13 Oct 2026)
  await ad.evaluate(() => { location.hash = '#/settings'; });
  await ad.waitForSelector('details.sect summary');
  await ad.click('details.sect summary'); await ad.waitForSelector('#setpw'); await ad.fill('#newpw', 'short'); await ad.click('#setpw');
  await toastSays(ad, /at least 8/);
  await ad.fill('#newpw', 'correct horse 42'); await ad.click('#setpw');
  await toastSays(ad, /Password saved/);
  ad.once('dialog', d => d.accept());
  await ad.click('#leave');
  await ad.waitForURL(/#\/$/, { timeout: 20000 }); await ad.waitForTimeout(1500);
  await ad.goto(BASE + '#/settings'); await ad.waitForSelector('body[data-cloud=ready]'); await ad.waitForSelector('#adminin', { timeout: 20000 });
  await ad.click('#adminin'); await ad.fill('#adminemail', 'lead@example.com');
  await ad.fill('#adminpw', 'wrong password'); await ad.click('#adminpwin');
  await toastSays(ad, /Wrong email or password/);
  await ad.fill('#adminpw', 'correct horse 42'); await ad.click('#adminpwin');
  await ad.waitForFunction(() => /Signed in as study admin/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 20000 });
  await ad.evaluate(() => { location.hash = '#/settings'; });
  // an admin picks the hospital for patients started on this phone (it was missing: they couldn't be set at all)
  await ad.click('[data-site="NUH"]');
  assert.equal(await ad.getAttribute('[data-site="NUH"]', 'aria-pressed'), 'true', 'an admin can set the hospital in Settings');
  await ad.waitForSelector('#refreshnow'); await ad.click('#refreshnow');
  await toastSays(ad, /Up to date|still waiting/);
  assert.match(await ad.textContent('main'), /Signed in as study admin/, 'Refresh now keeps the admin signed in');
  await ad.evaluate(() => { location.hash = '#/admin'; });
  await ad.waitForFunction(() => /NUH-TEST-CODE/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 20000 });
  await ad.click('[data-newcode="WH"]');
  await ad.waitForFunction(() => /WH-[A-Z2-9]{8}/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  // a new code for a team that has one warns first (cancelled here: the code stays)
  let warned = '';
  ad.once('dialog', d => { warned = d.message(); d.dismiss(); });
  await ad.click('[data-newcode="NUH"]');
  assert.match(warned, /stop working[\s\S]*Phones already in the NUH team stay in/);
  assert.match(await ad.textContent('main'), /NUH-TEST-CODE/);
  // tapping the code copies it
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ad.click('[data-copy="NUH-TEST-CODE"]');
  await toastSays(ad, /Code copied/);
  assert.equal(await ad.evaluate(() => navigator.clipboard.readText()), 'NUH-TEST-CODE');
  // study admins: the admin adds a second admin by email, can't remove themselves, then removes the second
  assert.match(await ad.textContent('#admins'), /lead@example\.com \(you\)/);
  assert.equal(await ad.$('[data-rmadmin="lead@example.com"]'), null, 'no Remove beside yourself');
  await ad.fill('#newadmin', 'Second@Example.com');
  ad.once('dialog', d => d.accept());
  await ad.click('#addadmin button');
  await toastSays(ad, /second@example\.com added/);
  await ad.waitForSelector('[data-rmadmin="second@example.com"]');
  assert.match(await ad.textContent('#admins'), /added by lead@example\.com/);
  ad.once('dialog', d => d.accept());
  await ad.click('[data-rmadmin="second@example.com"]');
  await toastSays(ad, /Removed/);
  await ad.waitForFunction(() => !document.querySelector('[data-rmadmin="second@example.com"]'));
  // the admin uploads the blank Word form on the Export screen (made-up fixture; it isn't the whole form, so they confirm)
  assert.equal(await ad.$('#blankup'), null, 'not on the admin screen (that is for people’s access)');
  await ad.evaluate(() => { location.hash = '#/export'; });
  await ad.waitForSelector('#blankup', { state: 'attached', timeout: 15000 }).catch(async e => { throw new Error('export: ' + ad.url() + ' | ' + (await ad.textContent('main')).replace(/\s+/g, ' ').slice(0, 400)); });
  ad.once('dialog', d => d.accept());
  const zip = new JSZip(); for (const [k, v] of Object.entries(fixtureFiles())) zip.file(k, v);
  await ad.setInputFiles('#blankup', { name: 'blank form.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await toastSays(ad, /Blank form saved/);
  await ad.waitForFunction(() => /blank form\.docx, uploaded/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  // phone A's Form view now fills in the Word form
  await a.goto(BASE + '#/');
  await a.click('.list a'); await a.click('.textlinks a[href$="/form"]');
  await a.waitForSelector('#doc section.docx', { timeout: 20000 });
  assert.match(await a.textContent('#doc'), /SYNC-01|S\s*Y\s*N\s*C/);
  // email and PayNow: phone A saves them and can't read them back; the admin sees them, ticks both, then deletes them
  const payPid = a.url().match(/#\/p\/(\w+)/)[1];
  await a.goto(`${BASE}#/p/${payPid}/pay`); await a.waitForSelector('#payemail');
  await a.fill('#payemail', 'pt@example.com'); await a.fill('#paynow', '+65 9123 4567'); await a.click('#payf button[type=submit]');
  await toastSays(a, /Saved for the study admins/);
  // the button sits under consent once consent and the before-surgery comfort question are answered
  await a.click('.chip[data-sat="consent_st"][data-v="1"]'); await a.waitForTimeout(800);
  await a.click('.chip[data-sat="sat_pre"][data-v="2"]');
  await a.waitForSelector('a.paybtn'); assert.match(await a.textContent('a.paybtn'), /Saved by AA/);
  await a.goto(`${BASE}#/p/${payPid}/pay`); await a.waitForSelector('#payemail');
  assert.equal(await a.inputValue('#payemail'), '', 'the team phone never shows them again');
  await ad.evaluate(() => { location.hash = '#/payments'; });
  await ad.waitForSelector('.paylist', { timeout: 15000 });
  assert.match(await ad.textContent('.paylist'), /SYNC-01[\s\S]*pt@example\.com[\s\S]*PayNow 91234567/);
  assert.ok(await ad.$eval('[data-payclear]', x => x.disabled), 'Delete waits for Payment sent');
  await ad.check(`[data-paytick="emailSent"][data-pid="${payPid}"]`); await ad.waitForFunction(() => /Email sent\s*\d/.test(document.querySelector('.paylist').textContent), null, { timeout: 15000 });
  await ad.check(`[data-paytick="paid"][data-pid="${payPid}"]`); await ad.waitForFunction(() => document.querySelector('[data-payclear]') && !document.querySelector('[data-payclear]').disabled, null, { timeout: 15000 });
  ad.once('dialog', d => d.accept());
  await ad.click('[data-payclear]'); await toastSays(ad, /Email and PayNow deleted/);
  await ad.waitForFunction(() => /Nothing waiting/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  await ad.click('#showdone'); assert.doesNotMatch(await ad.textContent('.paylist'), /pt@example|9123/, 'deleted for good');
  assert.match(await ad.textContent('.paylist'), /deleted/);
  // QR code and join link for WH
  await ad.evaluate(() => { location.hash = '#/admin'; });
  await ad.click('[data-qr="WH"]');
  await ad.waitForSelector('#qr-WH svg');
  if (SHOTS) await ad.screenshot({ path: SHOTS + '/admin.png', fullPage: true });
  const wh = (await ad.textContent('main')).match(/WH-[A-Z2-9]{8}/)[0];
  // a new phone opens the WH join link: no code to type
  const c = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  c.on('pageerror', e => errors.push('C: ' + e.message));
  await c.goto(`${BASE}#/join/WH/${wh}`);
  await c.waitForSelector('#joinlink');
  await c.waitForSelector('body[data-cloud=ready]');
  if (SHOTS) await c.screenshot({ path: SHOTS + '/join-link.png' });
  await c.fill('#me', 'cc');
  await c.click('#joinlink');
  await toastSays(c, /Joined the WH team/);
  assert.doesNotMatch(c.url(), /WH-/, 'the code leaves the address bar');
  await c.goto(BASE + '#/settings');
  await c.waitForFunction(() => /Sharing with the WH team/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 15000 });
  // a wrong link is refused
  const d = await (await b.newContext()).newPage();
  await d.goto(`${BASE}#/join/WH/WH-WRONG123`);
  await d.waitForSelector('body[data-cloud=ready]');
  await d.fill('#me', 'dd'); await d.click('#joinlink');
  await toastSays(d, /isn’t right for WH/);
  // the admin stops the PACU nurse link (only admins can)
  await stopNurse(ad);
  // the admin sees the NUH patient
  await ad.goto(BASE + '#/');
  await ad.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 15000 });
  // Share subject (owner, 21 Oct 2026): a one-subject link; a phone on no team opens only SYNC-01 and can fill it in
  await ad.click('.list a[href^="#/p/"]:not(.rowbtn)');
  await ad.click('.caseshare a[href$="/share"]');
  await ad.waitForSelector('#suburl', { timeout: 20000 });
  const subLink = await ad.inputValue('#suburl');
  assert.match(subLink, /#\/s\/[a-z2-9]{24}$/, 'the subject link: ' + subLink);
  assert.ok(await ad.$('.paculink svg'), 'and a QR code');
  assert.ok(await ad.$('[data-share-stop]'), 'an admin can stop it');
  if (SHOTS) await ad.screenshot({ path: SHOTS + '/share-subject.png' });
  const onSubject = pg => pg.waitForFunction(() => /SYNC-01/.test(document.querySelector('#title')?.textContent || '') && /^#\/p\/\w+$/.test(location.hash), null, { timeout: 25000 });
  const e = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  e.on('pageerror', x => errors.push('E: ' + x.message));
  await e.goto(subLink);
  await onSubject(e);
  const subId = e.url().match(/#\/p\/(\w+)$/)[1];
  await e.goto(BASE + '#/');
  await e.waitForSelector('.list a');
  assert.deepEqual(await e.$$eval('.list li b', x => x.map(y => y.textContent.replace(/\s+/g, ' ').trim())), ['Subject ID: SYNC-01 NUH'], 'only the shared subject on that phone');
  assert.match(await e.textContent('main'), /only the subjects shared with this phone/);
  // it fills in a PACU answer; the team gets it
  await e.goto(`${BASE}#/p/${subId}/form/pacu`);
  await e.waitForSelector('#f-pacu_temp');
  await e.fill('#f-pacu_temp', '36.9'); await e.keyboard.press('Tab');
  await e.waitForTimeout(500); await e.goto(BASE + '#/');
  await e.waitForFunction(() => /^Synced/.test(document.querySelector('.syncline')?.textContent || ''), null, { timeout: 25000 })
    .catch(async () => { throw new Error('guest phone: ' + (await e.textContent('main')).replace(/\s+/g, ' ').slice(0, 400)); });
  // (the form page doesn't redraw by itself: open it again until the value is there)
  const seesTemp = async (pg, v) => { for (let i = 0; i < 25; i++) { await pg.goto(`${BASE}#/p/${subId}/sheet`); await pg.goto(`${BASE}#/p/${subId}/form/pacu`); await pg.waitForSelector('#f-pacu_temp'); if (await pg.inputValue('#f-pacu_temp') === v) return; await pg.waitForTimeout(1000); } throw new Error('never saw ' + v); };
  await seesTemp(ad, '36.9');
  // and the team's changes reach it
  await ad.fill('#f-pacu_temp', '37.0'); await ad.keyboard.press('Tab');
  await seesTemp(e, '37.0');
  // it is still on no team
  await e.goto(BASE + '#/settings'); await e.waitForSelector('#code', { timeout: 15000 });
  // a phone already on the team goes straight to it, and a member's own Share subject gives the same link
  await bb.goto(subLink);
  await onSubject(bb);
  await bb.click('.caseshare a[href$="/share"]');
  await bb.waitForSelector('#suburl', { timeout: 15000 });
  assert.equal(await bb.inputValue('#suburl'), subLink);
  assert.equal(await bb.$('[data-share-stop]'), null, 'only an admin can stop it');
  // the admin stops the link: the guest phone loses the subject, and the link says it was stopped
  await ad.goto(`${BASE}#/p/${subId}/share`);
  await ad.waitForSelector('[data-share-stop]', { timeout: 15000 });
  ad.once('dialog', d => d.accept());
  await ad.click('[data-share-stop]');
  await ad.waitForSelector('#suburl:not([value="' + subLink + '"]), [data-share-make]', { timeout: 20000 });
  await e.goto(BASE + '#/');
  await e.reload();
  await e.waitForFunction(() => !document.querySelector('.list a'), null, { timeout: 25000 });
  await e.goto(subLink);
  await e.waitForFunction(() => /was stopped/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 25000 });
  await ad.goto(BASE + '#/');
  await ad.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 15000 });
  // phone C has the patient, then is closed (its copy stays on the phone) before the admin locks it
  const pc = await phone('CC');
  await pc.fill('#code', 'NUH-TEST-CODE'); await pc.click('#join'); await toastSays(pc, /Joined the NUH team/);
  await pc.goto(BASE + '#/');
  await pc.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
  // nothing left to send (a patient with unsent changes stays on the phone when locked, by design)
  await pc.waitForFunction(() => /Synced/.test(document.querySelector('.syncline')?.textContent || '') && !/Not sent yet/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
  await pc.waitForTimeout(1500);
  const pcctx = pc.context();
  await pc.close();
  // the admin locks it: phone A sees it locked and can't open it; then the admin unlocks it
  await ad.click('#select');
  await ad.locator('.selrow', { hasText: 'SYNC-01' }).locator('input').check();
  ad.once('dialog', d => d.accept());
  await ad.click('#lock');
  // server stamps (app-sync 0.3.0): the save carries the server's time, and the lock writes a leave entry with the
  // locked version, readable by the hospital's team
  const sync01Id = await ad.evaluate(() => Object.values(JSON.parse(localStorage.getItem('prewarm:patients'))).find(p => p.f?.enrol_id?.v === 'SYNC-01').id);
  let leave = null;
  for (let i = 0; i < 40 && !leave?.fields; i++) { leave = await (await fetch(`${FS}/leaves/patient:${sync01Id}`, { headers: { Authorization: 'Bearer owner' } })).json(); if (!leave?.fields) await a.waitForTimeout(300); }
  assert.ok(leave?.fields, 'a leave entry for the locked patient: ' + JSON.stringify(leave).slice(0, 200));
  const lockedDoc = await (await fetch(`${FS}/patients/${sync01Id}`, { headers: { Authorization: 'Bearer owner' } })).json();
  assert.equal(lockedDoc.fields.locked.booleanValue, true);
  assert.ok(lockedDoc.fields.serverAt?.timestampValue, 'the patient carries serverAt');
  assert.ok(leave.fields.serverAt?.timestampValue, 'the leave entry carries serverAt');
  // app-sync 0.4.0 onCommit: written in the lock's own transaction (same server time), so no phone ever sees the lock
  // without its leave entry (before, a lost signal between the two left closed phones holding it until the weekly read)
  assert.equal(leave.fields.serverAt.timestampValue, lockedDoc.fields.serverAt.timestampValue, 'the leave entry is written in the lock\u2019s transaction');
  assert.ok(+leave.fields.deletedAt.integerValue > +lockedDoc.fields.updatedAt.integerValue, 'the leave entry is after the version it removes');
  assert.equal(leave.fields.site.stringValue, 'NUH');
  assert.equal(leave.fields.data.mapValue.fields.updatedAt.integerValue, lockedDoc.fields.updatedAt.integerValue, 'the leave entry names the locked version');
  // phone C opens again: the locked patient leaves it at once (it no longer waits for the weekly full read)
  const pc2 = await pcctx.newPage();
  pc2.on('pageerror', e => errors.push('CC: ' + e.message));
  await pc2.goto(BASE + '#/'); await pc2.waitForSelector('body[data-cloud=ready]');
  await pc2.waitForFunction(() => !/SYNC-01/.test(document.querySelector('main').textContent), null, { timeout: 20000 })
    .catch(async () => { throw new Error('the locked patient stayed on the closed phone: ' + (await pc2.textContent('.list')).replace(/\s+/g, ' ').slice(0, 200)); });
  // a team phone doesn't get a locked patient at all: it goes from phone A, and the server refuses to send it
  await a.goto(BASE + '#/');
  await a.waitForFunction(() => !/SYNC-01/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  assert.ok(!(await a.evaluate(() => localStorage.getItem('prewarm:patients'))).includes('SYNC-01'), 'not kept on phone A');
  if (SHOTS) await a.screenshot({ path: SHOTS + '/locked.png' });
  // the admin's phone keeps the locked patient (admins get no leave entries), after a reload too
  await ad.reload(); await ad.waitForSelector('body[data-cloud=ready]');
  await ad.waitForFunction(() => /SYNC-01[\s\S]*Locked by the study admin/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
  await ad.waitForTimeout(2000);
  assert.match(await ad.textContent('.list'), /SYNC-01/, 'the locked patient stays on the admin\u2019s phone');
  await ad.click('#select');
  await ad.locator('.selrow', { hasText: 'SYNC-01' }).locator('input').check();
  await ad.click('#unlock');
  await a.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 15000 });
  // the unlock is newer than the leave entry: the patient shows again on phone C
  await pc2.goto(BASE + '#/');
  await pc2.waitForFunction(() => /SYNC-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
  await pcctx.close();
  // locking and unlocking keep the readings on the server copy
  const docs = await (await fetch(`${FS}/patients`, { headers: { Authorization: 'Bearer owner' } })).json();
  const sync01 = docs.documents.find(d => /SYNC-01/.test(JSON.stringify(d.fields.f)));
  assert.ok(sync01 && Object.keys(sync01.fields.f.mapValue.fields).length > 5, 'readings still on the server after lock / unlock');

  // the server keeps whichever write arrives last, so the phones heal it: A edits age offline, B edits it later
  // online; when A reconnects, A's older queued edit lands last, and B sends its newer one again: all settle on B's
  const serverAge = async () => {
    const all = await (await fetch(`${FS}/patients`, { headers: { Authorization: 'Bearer owner' } })).json();
    const doc = all.documents.find(x => /SYNC-01/.test(JSON.stringify(x.fields.f)));
    return doc?.fields.f.mapValue.fields.age?.mapValue.fields.v?.stringValue;
  };
  const localAge = pg => pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('prewarm:patients'))).find(r => JSON.stringify(r).includes('SYNC-01'))?.f.age?.v);
  for (const pg of [a, bb]) { await pg.goto(BASE + '#/'); await pg.click('.list a'); await pg.click('#haemolink'); await pg.click('.links.three a:has-text("Pre-op")'); await pg.waitForSelector('#f-age'); }
  await a.context().setOffline(true);
  await a.fill('#f-age', '60'); await a.keyboard.press('Tab'); await a.waitForTimeout(300);
  await bb.fill('#f-age', '70'); await bb.keyboard.press('Tab');
  for (let i = 0; i < 30 && await serverAge() !== '70'; i++) await bb.waitForTimeout(300);
  await a.context().setOffline(false);
  let settled = false;
  for (let i = 0; i < 60 && !settled; i++) { await a.waitForTimeout(500); settled = await serverAge() === '70' && await localAge(a) === '70' && await localAge(bb) === '70'; }
  assert.ok(settled, `newest edit wins everywhere: server ${await serverAge()}, A ${await localAge(a)}, B ${await localAge(bb)}`);

  // a reading screen left open while the other phone saves that reading: Save asks before writing over it
  const pid = a.url().match(/#\/p\/(\w+)/)[1];
  await a.goto(`${BASE}#/p/${pid}/prewarm/10`); await a.waitForSelector('#save');
  await bb.goto(`${BASE}#/p/${pid}/prewarm/10`); await bb.waitForSelector('#save');
  await bb.click('[data-step="1"][data-c="core"]');
  bb.once('dialog', d => d.accept());
  await bb.click('#save'); await toastSays(bb, /10 min saved/);
  await a.waitForFunction(() => !document.querySelector('#fresh').hidden, null, { timeout: 15000 });
  const asked = [];
  const answer = d => { asked.push(d.message()); /blank/.test(d.message()) ? d.accept() : d.dismiss(); };
  a.on('dialog', answer);
  await a.click('#save'); await a.waitForTimeout(500);
  a.off('dialog', answer);
  assert.ok(asked.some(m => /changed on another phone \(BB\)/.test(m)), 'A is asked before writing over B: ' + JSON.stringify(asked));
  await a.waitForFunction(() => /BB/.test(document.querySelector('main').textContent), null, { timeout: 5000 });

  // a phone reloaded while offline with an unsent change: when signal comes back, the change still reaches the server
  for (const pg of [a]) { await pg.goto(BASE + '#/'); await pg.click('.list a'); await pg.click('#haemolink'); await pg.click('.links.three a:has-text("Pre-op")'); await pg.waitForSelector('#f-age'); }
  await a.context().setOffline(true);
  await a.fill('#f-age', '55'); await a.keyboard.press('Tab'); await a.waitForTimeout(300);
  await a.reload(); await a.waitForSelector('#f-age', { timeout: 20000 });
  assert.equal(await a.inputValue('#f-age'), '55', 'kept on the phone across the reload');
  await a.context().setOffline(false);
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) { await a.waitForTimeout(500); landed = await serverAge() === '55' && await localAge(bb) === '55'; }
  assert.ok(landed, `offline change survives a reload: server ${await serverAge()}, B ${await localAge(bb)}`);

  // both phones save the same reading without seeing each other's (A offline): all settle on the later save (B's)
  await a.goto(`${BASE}#/p/${pid}/prewarm/20`); await a.waitForSelector('#save');
  await bb.goto(`${BASE}#/p/${pid}/prewarm/20`); await bb.waitForSelector('#save');
  await a.context().setOffline(true);
  const okAll = d => d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept();
  a.on('dialog', okAll); bb.on('dialog', okAll);
  await a.click('[data-step="1"][data-c="core"]'); await a.click('#save'); await a.waitForTimeout(400);
  await bb.click('[data-step="-1"][data-c="core"]'); await bb.click('[data-step="-1"][data-c="core"]'); await bb.click('#save'); await bb.waitForTimeout(400);
  const coreOf = async pg => pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('prewarm:patients'))).find(r => JSON.stringify(r).includes('SYNC-01'))?.f.prewarm_20_core?.v);
  const bVal = await coreOf(bb);
  await a.context().setOffline(false);
  let same = false;
  for (let i = 0; i < 60 && !same; i++) { await a.waitForTimeout(500); same = await coreOf(a) === bVal && await coreOf(bb) === bVal; }
  a.off('dialog', okAll); bb.off('dialog', okAll);
  assert.ok(same, `same reading saved on both: A ${await coreOf(a)}, B ${await coreOf(bb)} (expected B's ${bVal})`);

  // phone A logs out with a change that hasn't synced (offline): two warnings; cancelling keeps everything
  await a.goto(BASE + '#/');
  await a.click('.list a'); await a.waitForSelector('.board');
  await a.context().setOffline(true);
  await a.click('[data-ev="pw_gown"]'); await a.click('.kp [data-now]');
  const said = [];
  a.on('dialog', d => { said.push(d.message()); said.length === 1 ? d.accept() : d.dismiss(); });
  await a.goto(BASE + '#/settings');
  // the app version: the running service worker's (the deploy stamps it 'prewarm-<date>-<hash>', shown as 'date (hash)';
  // unstamped here, 'v<N>'), never a 'prewarm-rt-' runtime cache
  await a.goto(BASE + '#/'); await a.goto(BASE + '#/settings'); await a.waitForSelector('#appver');
  await a.waitForFunction(() => /App version (v\d+|\d{4}-\d{2}-\d{2} \([0-9a-f]{8}\))$/.test(document.querySelector('#appver')?.textContent || ''), null, { timeout: 10000 });
  // Ready for a case?: offline with a patient waiting, those two rows are red and the team rows are green
  await a.waitForSelector('.ready');
  const noRows = await a.$$eval('.ready li.no', l => l.map(x => x.textContent).join('|'));
  assert.match(noRows, /Online/); assert.match(noRows, /Nothing waiting or refused/);
  assert.ok(await a.$('.ready li.ok'), 'and the checks that pass are green');
  await a.click('#leave');
  await a.waitForFunction(() => document.querySelector('#leave') && !document.querySelector('#leave').disabled, null, { timeout: 20000 });
  assert.match(said[0], /deletes all 1 patient from this phone/);
  assert.match(said[1] || '', /Not synced yet: SYNC-01/);
  assert.match(said[1], /Last synced/);
  assert.match(await a.textContent('.syncline'), /Not synced: 1 patient waiting for signal/);
  await a.context().setOffline(false);
  // phone B logs out: one warning, then its patients are gone and it's no longer in the team
  bb.on('dialog', d => d.accept());
  await bb.goto(BASE + '#/settings');
  await bb.waitForSelector('#leave');
  await Promise.all([bb.waitForNavigation({ timeout: 20000 }), bb.click('#leave')]);
  await bb.waitForSelector('body[data-cloud=ready]', { timeout: 20000 });
  assert.equal(await bb.$('.list a'), null, 'no patients on phone B');
  // app-sync forgetDevice: the engine's copy of the list and the outbox hold nothing of the team's after a log out
  const left = await bb.evaluate(async () => {
    const out = [];
    for (const { name } of await indexedDB.databases()) {
      if (!/^prewarm-(store:|outbox)/.test(name)) continue;
      const db = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const s of db.objectStoreNames) { const n = await new Promise(ok => { const r = db.transaction(s).objectStore(s).count(); r.onsuccess = () => ok(r.result); r.onerror = () => ok(-1); }); if (n && !/meta/.test(s)) out.push(name + '/' + s + ':' + n); }
      db.close();
    }
    return out;
  });
  assert.deepEqual(left, [], 'nothing of the team left on phone B');
  await bb.goto(BASE + '#/settings');
  await bb.waitForSelector('#code', { timeout: 15000 });

  assert.deepEqual(errors, []);
  console.log('prewarm sync: ok (two phones, PACU nurse link, share subject link, join code, readings both ways, admin email-link and password sign-in, managing admins, codes, join link and QR, blank Word form upload and Form view, email and PayNow (team writes, admin ticks and deletes), lock (a closed phone drops it at its next open, server stamps, leave entry), offline edits heal, open reading asks, reload offline, same reading on both, log out)');
} finally {
  await b.close();
}
