// More two-phone checks for fixed bugs that had no test (list: docs/test-candidates.md), against the local Firebase
// emulators (fake data, demo project "demo-prewarm"; never the live project). Same set-up as sync.emulator.mjs:
// tools/test-prewarm-sync.sh runs both. Phones are team members of NUH; an admin's lock is written straight to the
// emulator's database (past the rules), so no admin sign-in is needed here.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
const BASE = `http://localhost:${process.env.PORT || 8080}/prewarm/?emulator`;
const FS = 'http://127.0.0.1:8085/v1/projects/demo-prewarm/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const put = await fetch(`${FS}/codes/NUH`, { method: 'PATCH', headers: OWNER,
  body: JSON.stringify({ fields: { code: { stringValue: 'NUH-GAPS-CODE' }, setAt: { integerValue: '1' }, setBy: { stringValue: 'lead@example.com' } } }) });
assert.ok(put.ok, 'seed code: ' + put.status);

// a server copy of a patient, with each field as { v, auto } (plain values), read past the rules
const plainVal = x => x == null ? null : 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue : 'booleanValue' in x ? x.booleanValue : 'doubleValue' in x ? x.doubleValue : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, plainVal(y)])) : null;
const server = async id => { const r = await fetch(`${FS}/patients/${id}`, { headers: OWNER }); if (!r.ok) return null; const d = await r.json(); return plainVal({ mapValue: { fields: d.fields } }); };
const serverWait = async (id, ok, what, ms = 20000) => {
  const end = Date.now() + ms; let d;
  while (Date.now() < end) { d = await server(id); if (d && ok(d)) return d; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(`waited for the server copy: ${what}; it has ${JSON.stringify(d?.f ? Object.fromEntries(Object.entries(d.f).map(([k, x]) => [k, x.v])) : d)}`);
};
const lockOnServer = (id, on) => fetch(`${FS}/patients/${id}?updateMask.fieldPaths=lock&updateMask.fieldPaths=locked&updateMask.fieldPaths=updatedAt`, { method: 'PATCH', headers: OWNER, // what an admin's lock writes (stamped, so phones listening for changes hear it)
  body: JSON.stringify({ fields: { updatedAt: { integerValue: String(Date.now()) }, locked: { booleanValue: on }, lock: { mapValue: { fields: { on: { booleanValue: on }, t: { integerValue: String(Date.now()) }, by: { stringValue: 'lead@example.com' } } } } } }) });
// a patient written straight to the emulator (past the rules), last changed at `at`
const seedPatient = (id, sid, at) => fetch(`${FS}/patients/${id}`, { method: 'PATCH', headers: OWNER,
  body: JSON.stringify({ fields: { id: { stringValue: id }, site: { stringValue: 'NUH' }, created: { integerValue: String(at) }, locked: { booleanValue: false }, updatedAt: { integerValue: String(at) },
    f: { mapValue: { fields: { enrol_id: { mapValue: { fields: { v: { stringValue: sid }, t: { integerValue: String(at) }, by: { stringValue: 'AA' } } } } } } } } }) });
// the leave entry an admin's lock writes (app-sync leaveEntry), past the rules
const leaveOnServer = (id, version) => fetch(`${FS}/leaves/patient:${id}`, { method: 'PATCH', headers: OWNER,
  body: JSON.stringify({ fields: { id: { stringValue: 'patient:' + id }, kind: { stringValue: 'patient' }, site: { stringValue: 'NUH' }, deletedAt: { integerValue: String(version) }, updatedAt: { integerValue: String(version) },
    data: { mapValue: { fields: { id: { stringValue: id }, updatedAt: { integerValue: String(version) } } } } } }) });

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
async function phone(initials, join = true) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(initials + ': ' + e.message));
  await page.addInitScript(() => { // every toast the app shows, in order
    window.__toasts = [];
    new MutationObserver(() => { const t = document.querySelector('#toast'); if (t && !t.hidden && t.textContent) window.__toasts.push(t.textContent); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('body[data-cloud=ready]');
  await page.fill('#me', initials); await page.dispatchEvent('#me', 'change');
  if (join) { await page.fill('#code', 'NUH-GAPS-CODE'); await page.click('#join'); await toastSays(page, /Joined the NUH team/); }
  return { ctx, page };
}
const toastSays = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: 15000 })
  .catch(async () => { throw new Error(`waited for ${re}, toast says: ${await page.textContent('#toast')}`); });
const listed = (page, re, ms = 20000) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('.list')?.textContent || ''), re.source, { timeout: ms });
const pid = page => page.evaluate(() => location.hash.split('/')[2]);
const stored = (page, id, k) => page.evaluate(([i, k]) => JSON.parse(localStorage.getItem('prewarm:patients'))[i]?.f[k]?.v ?? null, [id, k]);
const doneIn = async (name, f) => { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; try { await f(); console.log('  ok: ' + name); } catch (e) { errors.push(name + ': ' + e.message.split('\n')[0] + ' @ ' + [...e.stack.matchAll(/emulator.mjs:(\d+)/g)].map(m => m[1]).join(',')); } };

try {
  const A = await phone('AA'), B = await phone('BB');
  const a = A.page, bb = B.page;

  // A starts a patient with a weight and height: the BMI is worked out and sent
  await a.goto(BASE + '#/new');
  await a.fill('#sid', 'GAP-01'); await a.click('.seg .chip[data-v="1"]'); await a.click('button[type=submit]');
  await a.waitForSelector('.times');
  const id = await pid(a);
  await a.goto(BASE + `#/p/${id}/form/preop`); await a.waitForSelector('#f-wt');
  await a.fill('#f-wt', '70'); await a.keyboard.press('Tab'); await a.fill('#f-ht', '175'); await a.keyboard.press('Tab');
  await serverWait(id, d => d.f?.bmi?.v === '22.9', 'worked-out BMI 22.9');
  await bb.goto(BASE + '#/'); await listed(bb, /GAP-01/);

  await doneIn('push always sends auto: a typed BMI is not recalculated elsewhere', async () => {
    assert.equal((await server(id)).f.bmi.auto, true, 'the worked-out BMI is marked auto');
    await a.fill('#f-bmi', '30'); await a.keyboard.press('Tab');
    const d = await serverWait(id, d => d.f?.bmi?.v === '30', 'typed BMI 30');
    assert.equal(d.f.bmi.auto, false, 'auto is false on the server once typed');
    await bb.goto(BASE + `#/p/${id}/form/preop`); await bb.waitForSelector('#f-bmi');
    await bb.waitForFunction(() => document.querySelector('#f-bmi')?.value === '30', null, { timeout: 15000 });
    await bb.fill('#f-wt', '90'); await bb.keyboard.press('Tab'); await bb.waitForTimeout(1500);
    assert.equal(await bb.inputValue('#f-bmi'), '30', 'B keeps the typed BMI after a weight change');
    const after = await serverWait(id, d => d.f?.wt?.v === '90', 'weight 90');
    assert.equal(after.f.bmi.v, '30', 'and the server keeps it');
  });

  await doneIn('save sends only the boxes that changed: B saves the core box, A then saves the chest box of the same reading', async () => {
    const reading = BASE + `#/p/${id}/prewarm/0`;
    const enter = async (pg, box, digits) => { await pg.click(`.num[data-type="${box}"]`); await pg.waitForSelector('dialog.kp input.num'); await pg.keyboard.type(digits); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); };
    const saveIt = async pg => { pg.once('dialog', d => d.accept()); await pg.waitForTimeout(800); await pg.click('#save'); }; // only one box typed: Save asks about the blank ones
    await bb.goto(reading); await bb.waitForSelector('#save');
    await enter(bb, 'core', '368'); await saveIt(bb);
    const first = await serverWait(id, d => d.f?.prewarm_0_core?.v === '36.8', 'B’s core');
    // A opens the reading now, sees B's core, and saves only the chest
    await a.goto(BASE + '#/'); await a.goto(reading); await a.waitForSelector('#save');
    await a.waitForFunction(() => /36\.8/.test(document.querySelector('.num[data-type="core"]')?.textContent || ''), null, { timeout: 20000 });
    await enter(a, 'chest', '341'); await saveIt(a);
    const d = await serverWait(id, d => d.f?.prewarm_0_chest?.v === '34.1', 'A’s chest');
    assert.equal(d.f.prewarm_0_core.v, '36.8', 'B’s core survives A’s save');
    assert.equal(d.f.prewarm_0_core.by, 'BB', 'and was not sent again by A');
    assert.equal(d.f.prewarm_0_core.t, first.f.prewarm_0_core.t, 'with its own save time');
    await bb.goto(BASE + `#/p/${id}/sheet`);
    await bb.waitForFunction(() => /34\.1/.test(document.querySelector('.sheet')?.textContent || '') && /36\.8/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 20000 });
  });

  await doneIn('OK on "changed on another phone" saves only the boxes changed here: the other phone\u2019s core stays', async () => {
    const reading = BASE + `#/p/${id}/prewarm/0`;
    const enter = async (pg, box, digits) => { await pg.click(`.num[data-type="${box}"]`); await pg.waitForSelector('dialog.kp input.num'); await pg.keyboard.type(digits); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); };
    for (const pg of [a, bb]) { await pg.goto(BASE + '#/'); await pg.goto(reading); await pg.waitForSelector('#save'); }
    const okAll = d => d.accept();
    bb.on('dialog', okAll); a.on('dialog', okAll);
    const asked = []; a.on('dialog', d => asked.push(d.message()));
    await enter(bb, 'core', '370'); await bb.waitForTimeout(800); await bb.click('#save');
    await serverWait(id, d => d.f?.prewarm_0_core?.v === '37', 'B’s new core 37.0');
    await a.waitForFunction(() => document.querySelector('#fresh') && !document.querySelector('#fresh').hidden, null, { timeout: 15000 });
    await enter(a, 'chest', '339'); await a.waitForTimeout(800); await a.click('#save');
    const d = await serverWait(id, d => d.f?.prewarm_0_chest?.v === '33.9', 'A’s chest 33.9');
    bb.off('dialog', okAll); a.off('dialog', okAll);
    assert.ok(asked.some(m => /changed on another phone \(BB\)/.test(m) && /save only the boxes you changed/.test(m)), 'A is asked: ' + JSON.stringify(asked));
    assert.equal(d.f.prewarm_0_core.v, '37', 'B’s core is not written over by A’s old one');
    assert.equal(d.f.prewarm_0_core.by, 'BB', 'and is still B’s');
  });

  await doneIn('a wrong join code says "isn’t right" and is not replaced by "Not allowed"', async () => {
    const C = await phone('CC', false);
    await C.page.fill('#code', 'NUH-WRONG123'); await C.page.click('#join');
    await toastSays(C.page, /isn’t right for NUH/);
    await C.page.waitForTimeout(2500);
    const all = await C.page.evaluate(() => window.__toasts);
    assert.ok(!all.some(t => /Not allowed/i.test(t)), 'toasts shown: ' + JSON.stringify([...new Set(all)]));
    await C.ctx.close();
  });

  await doneIn('a restore reaches every phone in the team', async () => {
    await a.goto(BASE + '#/delete'); await a.waitForSelector('.dellist');
    const del = a.locator('.dellist li', { hasText: 'GAP-01' }).locator('[data-del]');
    await del.click(); await a.waitForTimeout(800); await del.click();
    await serverWait(id, d => d.deleted > 0, 'deleted on the server');
    await bb.goto(BASE + '#/');
    await bb.waitForFunction(() => !/GAP-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
    await a.waitForSelector('[data-restore]'); await a.click('[data-restore]');
    await bb.goto(BASE + '#/'); await listed(bb, /GAP-01/);
    await a.goto(BASE + '#/'); await listed(a, /GAP-01/);
  });

  await doneIn('the first server word sends whole any patient the server never had', async () => {
    const C = await phone('CC'); const c = C.page;
    // a patient made before sign-in finished: on this phone only, with several answers
    const nid = 'gapneverhad01';
    await c.evaluate(id => {
      const t = Date.now() - 60000, f = {};
      for (const [k, v] of Object.entries({ enrol_id: 'GAP-02', arm: 1, age: 61, wt: '80', ht: '170', sex: 1 })) f[k] = { v, t, by: 'CC' };
      const all = JSON.parse(localStorage.getItem('prewarm:patients') || '{}');
      all[id] = { id, created: t, site: 'NUH', f };
      localStorage.setItem('prewarm:patients', JSON.stringify(all));
    }, nid);
    await c.reload(); await c.waitForSelector('body[data-cloud=ready]');
    const d = await serverWait(nid, d => d.f?.sex?.v != null && d.f?.age?.v != null, 'every field of the offline patient');
    for (const k of ['enrol_id', 'arm', 'age', 'wt', 'ht', 'sex']) assert.ok(d.f[k] && d.f[k].v != null, k + ' reached the server');
    await C.ctx.close();
  });

  // (was "pending entries from an earlier session are dropped": the old send tokens in prewarm:pending went with the
  // app-sync outbox, 24 Oct 2026; what they guarded stays: an older value left on a phone never wins over the server's)
  await doneIn('an older value left on the phone from an earlier session does not overwrite the server\u2019s newer one', async () => {
    const C = await phone('CC'); const c = C.page;
    await c.goto(BASE + '#/'); await listed(c, /GAP-01/);
    const before = (await server(id)).f.wt;
    await c.evaluate(id => {
      const all = JSON.parse(localStorage.getItem('prewarm:patients')); all[id].f.wt = { v: '55', t: 5, by: 'CC' };
      localStorage.setItem('prewarm:patients', JSON.stringify(all));
    }, id);
    await c.reload(); await c.waitForSelector('body[data-cloud=ready]');
    await c.waitForFunction(([i, v]) => JSON.parse(localStorage.getItem('prewarm:patients'))[i]?.f.wt?.v === v, [id, before.v], { timeout: 20000 })
      .catch(async () => { throw new Error('this phone kept its older weight: ' + await stored(c, id, 'wt')); });
    await c.waitForTimeout(1500);
    assert.deepEqual((await server(id)).f.wt, before, 'the older local value did not overwrite the newer server one');
    await C.ctx.close();
  });

  await doneIn('a patient locked with unsent changes stays on the member’s phone with a warning', async () => {
    await a.goto(BASE + `#/p/${id}/form/preop`); await a.waitForSelector('#f-age');
    await a.context().setOffline(true); await a.waitForTimeout(500);
    await a.fill('#f-age', '47'); await a.keyboard.press('Tab'); await a.waitForTimeout(500);
    await lockOnServer(id, true);
    await a.waitForTimeout(500);
    const pend = await a.evaluate(() => localStorage.getItem('prewarm:pending')), ageBefore = await stored(a, id, 'age');
    await a.context().setOffline(false);
    await a.waitForFunction(() => window.__toasts.some(t => /locked/.test(t)), null, { timeout: 30000 })
      .catch(async () => { throw new Error('no lock warning; toasts: ' + JSON.stringify([...new Set(await a.evaluate(() => window.__toasts))]) + ' | list ' + await a.evaluate(() => { location.hash = '#/'; return new Promise(r => setTimeout(() => r((document.querySelector('.list')?.textContent || '').replace(/\s+/g, ' ')), 500)); }) + ' | pending before online ' + pend + ' age before ' + ageBefore + ' | pending now ' + await a.evaluate(() => localStorage.getItem('prewarm:pending')) + ' | age ' + await stored(a, id, 'age') + ' | server ' + JSON.stringify((await server(id)).locked)); });
    await a.goto(BASE + '#/');
    assert.match(await a.textContent('.list'), /GAP-01[\s\S]*(Not sent yet|Not saved to the team)/, 'the patient stays on the phone, marked as not sent');
    assert.equal(await stored(a, id, 'age'), '47', 'with the unsent change');
    // B had no unsent changes: the locked patient leaves its phone
    await bb.goto(BASE + '#/');
    await bb.waitForFunction(() => !/GAP-01/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 });
    await lockOnServer(id, false);
  });

  await doneIn('a lock arriving while a phone has unsent changes keeps the patient and warns', async () => {
    const C = await phone('CC'); const c = C.page;
    await c.goto(BASE + '#/'); await listed(c, /GAP-01/);
    // unsent changes: a save the outbox holds (the phone says it has no signal; its listener still hears the server)
    await c.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await c.goto(BASE + `#/p/${id}/form/preop`); await c.waitForSelector('#f-age');
    await c.fill('#f-age', '52'); await c.keyboard.press('Tab'); await c.waitForTimeout(800);
    await c.goto(BASE + '#/'); await listed(c, /GAP-01[\s\S]*Not sent yet/);
    await lockOnServer(id, true);
    await c.waitForFunction(() => window.__toasts.some(t => /locked by the study admin before your last changes reached the team/.test(t)), null, { timeout: 20000 })
      .catch(async () => { throw new Error('no lock warning; toasts: ' + JSON.stringify([...new Set(await c.evaluate(() => window.__toasts))])); });
    assert.match(await c.textContent('.list'), /GAP-01/, 'the patient stays on the phone');
    assert.equal(await stored(c, id, 'age'), '52', 'with the unsent change');
    await lockOnServer(id, false);
    await C.ctx.close();
  });

  await doneIn('a patient locked while a phone is closed leaves it at its next open', async () => {
    // an older patient (changed 2 h ago, so the next open's read of what changed doesn't cover it) and a newer one
    assert.ok((await seedPatient('gapold01', 'GAP-OLD', Date.now() - 2 * 3600e3)).ok);
    assert.ok((await seedPatient('gapnew01', 'GAP-NEW', Date.now())).ok);
    const C = await phone('CC'); const c = C.page;
    await c.goto(BASE + '#/'); await listed(c, /GAP-OLD/); await listed(c, /GAP-NEW/);
    await c.waitForTimeout(2000); await c.close();
    // an admin locks it while the phone is closed
    await lockOnServer('gapold01', true);
    assert.ok((await leaveOnServer('gapold01', Date.now())).ok);
    const c2 = await C.ctx.newPage();
    c2.on('pageerror', e => errors.push('CC: ' + e.message));
    await c2.goto(BASE + '#/'); await c2.waitForSelector('body[data-cloud=ready]'); await listed(c2, /GAP-NEW/);
    await c2.waitForFunction(() => !/GAP-OLD/.test(document.querySelector('.list')?.textContent || ''), null, { timeout: 20000 })
      .catch(() => { throw new Error('the locked patient stayed on the phone until its weekly full read'); });
    // unlocked (a newer version): it shows again
    await lockOnServer('gapold01', false);
    await listed(c2, /GAP-OLD/);
    await C.ctx.close();
  });
  await doneIn('a patient locked while a phone with its unsent changes is closed stays there with a warning', async () => {
    // app-sync 0.4.1: a leave entry for a patient with saves not sent keeps it (0.4.0 dropped it, change and all)
    assert.ok((await seedPatient('gapuns01', 'GAP-UNS', Date.now() - 2 * 3600e3)).ok);
    const C = await phone('CC'); const c = C.page;
    await c.goto(BASE + '#/'); await listed(c, /GAP-UNS/);
    // the phone says it has no signal from here on (its listener still hears the server), so the save stays unsent
    await C.ctx.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await c.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await c.goto(BASE + '#/p/gapuns01/form/preop'); await c.waitForSelector('#f-age');
    await c.fill('#f-age', '61'); await c.keyboard.press('Tab'); await c.waitForTimeout(800);
    await c.goto(BASE + '#/'); await listed(c, /GAP-UNS[\s\S]*Not sent yet/);
    await c.waitForTimeout(1000); await c.close();
    await lockOnServer('gapuns01', true);
    assert.ok((await leaveOnServer('gapuns01', Date.now())).ok);
    const c2 = await C.ctx.newPage();
    c2.on('pageerror', e => errors.push('CC: ' + e.message));
    await c2.addInitScript(() => { window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('#toast'); if (t && !t.hidden && t.textContent) window.__toasts.push(t.textContent); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true }); });
    await c2.goto(BASE + '#/'); await c2.waitForSelector('body[data-cloud=ready]');
    await c2.waitForFunction(() => window.__toasts.some(t => /GAP-UNS was locked by the study admin before your last changes reached the team/.test(t)), null, { timeout: 25000 })
      .catch(async () => { throw new Error('no lock warning; toasts: ' + JSON.stringify([...new Set(await c2.evaluate(() => window.__toasts))]) + ' | list ' + (await c2.textContent('.list').catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)); });
    await c2.waitForTimeout(3000);
    assert.match(await c2.textContent('.list'), /GAP-UNS/, 'the patient stays on the phone');
    assert.equal(await stored(c2, 'gapuns01', 'age'), '61', 'with the unsent change');
    const kept = await c2.evaluate(async () => {
      for (const { name } of await indexedDB.databases()) {
        if (!/^prewarm-store:/.test(name)) continue;
        const db = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        for (const s of [...db.objectStoreNames].filter(n => n === 'patients')) { const v = await new Promise(ok => { const r = db.transaction(s).objectStore(s).get('gapuns01'); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }); if (v) { db.close(); return true; } }
        db.close();
      }
      return false;
    });
    assert.ok(kept, 'the sync engine\u2019s copy keeps it too');
    await lockOnServer('gapuns01', false);
    await C.ctx.close();
  });
} finally {
  await b.close();
}
if (errors.length) { console.error('prewarm sync gaps: FAIL\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('prewarm sync gaps: ok (typed BMI not recalculated, changed boxes only, wrong code message, restore, first server word, older local value loses, locked with unsent changes, locked while a phone was closed (also with unsent changes), OK on a changed reading keeps the other phone\u2019s boxes)');
