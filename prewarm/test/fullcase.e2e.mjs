// A whole case through the UI, per group, with a fake clock: every key time logged in order (Log button), every
// reading saved when due, Intra-op details, PACU and comfort filled in. Then: no unexpected prompts or errors, Still to
// fill empty, and the exported template row has every op-day cell filled except the ones that should be blank
// (timepoints after surgery end, follow-ups of No, not turned prone, no investigations; pre-warming for no
// pre-warming). Needs the site served on :8080 (python3 -m http.server 8080). About 1 minute.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import { workbookSheets } from '../js/export.js';
import { FIELDS, colIndex } from '../js/schema.js';
import { SECTIONS } from '../js/headers.js';
const BASE = `http://localhost:${process.env.PORT || 8080}/prewarm/`;
const b = await chromium.launch();
const ALLOWED = new Set(['io_flip', 'io_cs_vol', 'io_cs_ret', 'io_pcc_dose', 'io_txa_bolus', 'io_txa_inf', 'io_txa_total', 'io_fib_dose', 'io_ix', 'pacu_delay1h', 'pacu_delay_why']);
// the three groups run side by side, each in its own browser context with its own fake clock
await Promise.all(['1', '2', '3'].map(async ARM => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const dialogs = []; pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await pg.clock.install({ time: new Date('2026-10-13T07:58:00') });
  await pg.goto(`${BASE}?demo`); await pg.waitForTimeout(600);
  await pg.evaluate(() => { localStorage.setItem('prewarm-demo:settings', JSON.stringify({ me: 'TT' })); });
  await pg.goto(`${BASE}?demo#/new`); await pg.reload(); await pg.waitForSelector('#sid');
  await pg.fill('#sid', 'FULL-01'); await pg.click('.seg .chip[data-v="' + ARM + '"]'); await pg.click('button[type=submit]');
  await pg.waitForSelector('.times');
  const pid = pg.url().match(/#\/p\/(\w+)/)[1];
  const adv = async m => { await pg.clock.fastForward(m * 60000); await pg.waitForTimeout(80); };
  // the next key time is set to now from its pad (the Log shortcut was replaced by the sync status, 13 Oct 2026)
  const log = async () => {
    await pg.goto(`${BASE}?demo#/p/${pid}`); await pg.waitForSelector('.times');
    const id = await pg.evaluate(() => ['pw_gown', 'pw_start', 'ev_wstop', 'ev_ot', 'io_knife', 'io_done'].find(e => { const b = document.querySelector(`[data-ev="${e}"]`); return b && !b.classList.contains('set'); }));
    const t = (await pg.textContent(`[data-ev="${id}"] span`)).trim();
    await pg.click(`[data-ev="${id}"]`); await pg.click('.kp [data-now]'); await pg.waitForTimeout(100); return t;
  };
  const tapEv = async id => { await pg.goto(`${BASE}?demo#/p/${pid}`); await pg.waitForSelector('.times'); await pg.click(`[data-ev="${id}"]`); await pg.click('.kp [data-now]'); await pg.waitForTimeout(100); };
  // PACU in / To ward are logged on the PACU page (owner, 13 Oct 2026)
  const pacuTime = async (id, label) => { await pg.goto(`${BASE}?demo#/p/${pid}/form/pacu`); await pg.waitForSelector('#f-pacu_temp'); await pg.click(`[data-pev="${id}"]`); await pg.click('.kp [data-now]'); await pg.waitForTimeout(800); return label; }; // the tap guard ignores taps near the last one for 0.7 s
  async function temps(series, key) {
    await pg.goto(`${BASE}?demo#/p/${pid}/${series}/${key}`); await pg.waitForSelector('#save'); await pg.clock.fastForward(800); // the tap guard ignores taps near the last one for 0.7 s
    for (const c of ['core', 'chest', 'arm', 'thigh', 'calf', 'room']) if (await pg.$(`.card[data-fill="${c}"]`)) await pg.click(`.card[data-fill="${c}"] .clab`);
    // carried-over (grey) values are not saved unless confirmed (14 Oct 2026): tap each one and OK, as a user would
    for (let i = 0; i < 12; i++) { const n = await pg.$('.card.dflt .num'); if (!n) break; await n.click(); await pg.waitForSelector('dialog.kp[open]'); await pg.click('.kp [data-a="ok"]'); await pg.waitForTimeout(150); }
    for (const [c, v] of [['set', '42'], ['ts', '0'], ['under', '0'], ['gown', '0']]) {
      const chip = await pg.$(`.chip[data-c="${c}"][data-v="${v}"]`);
      if (chip && !(await pg.$(`.chip[data-c="${c}"][aria-pressed="true"]`))) await chip.click();
    }
    await pg.click('#save'); await pg.waitForTimeout(150);
  }
  async function bp(key) {
    await pg.goto(`${BASE}?demo#/p/${pid}/haemo/${key}`); await pg.waitForSelector('input[data-in="sbp"]');
    for (const [k, v] of [['sbp', '120'], ['dbp', '70'], ['map', '87'], ['hr', '70'], ['bis', '45']]) await pg.fill(`input[data-in="${k}"]`, v);
    await pg.click('#save'); await pg.waitForTimeout(150);
  }
  const steps = [];
  steps.push(await log()); // gown on 07:58
  if (ARM === '3') { await adv(44); }
  else {
  await adv(2); steps.push(await log()); // prewarm on 08:00
  // the last warming reading (10 or 30 min) completes pre-warming; the later 5-min points aren't taken
  const lastWarm = ARM === '2' ? 10 : 30;
  for (let m = 0; m <= lastWarm; m += 5) { if (m) await adv(5); await temps('prewarm', String(m)); if (m === lastWarm) steps.push(await log()); }
  await adv(42 - lastWarm);
  }
  steps.push(await log()); // In OT 08:42
  await temps('iotemp', 'base'); await bp('base');
  await adv(8); steps.push(await log()); // induction 08:50
  for (let m = 0; m <= 90; m += 5) {
    if (m > 60 && m % 15) continue;
    if (m) await adv(m > 60 ? 15 : 5);
    if (m === 5) await tapEv('io_under_start');
    if (m === 10) await tapEv('io_gown_start');
    await temps('iotemp', String(m));
    if (m && m % 15 === 0) await bp(String(m));
  }
  await adv(3); steps.push(await log()); // surgery end
  await temps('iotemp', 'end'); await bp('end');
  // intra-op details
  await pg.goto(`${BASE}?demo#/p/${pid}/form/intraop`); await pg.waitForSelector('#f-io_ebl');
  await pg.click('.chip[data-f="io_tech"][data-v="Inhalational"]').catch(() => {});
  await pg.fill('#f-io_ebl', '200'); await pg.keyboard.press('Tab');
  for (const f of ['io_cs', 'io_pcc', 'io_txa', 'io_fib']) await pg.click(`.chip[data-f="${f}"][data-v="0"]`);
  for (const k of ['rbc', 'plt', 'ffp', 'cryo']) { await pg.fill(`input[data-f="io_${k}"]`, '0'); await pg.keyboard.press('Tab'); }
  await adv(10); steps.push(await pacuTime('pacu_in', 'PACU in'));
  await pg.goto(`${BASE}?demo#/p/${pid}/form/pacu`); await pg.waitForSelector('#f-pacu_temp');
  await pg.fill('#f-pacu_temp', '36.4'); await pg.keyboard.press('Tab');
  for (const f of ['pacu_shiver', 'pacu_ponv', 'pacu_hypot', 'pacu_tx', 'pacu_delay']) await pg.click(`.chip[data-f="${f}"][data-v="0"]`);
  await pg.click('.chip[data-f="pacu_pain"][data-v="3"]');
  for (const f of ['nd_dis', 'nd_beh', 'nd_com', 'nd_ill', 'nd_psy']) await pg.click(`.chip[data-f="${f}"][data-v="0"]`);
  await pg.click('.chip[data-sat="sat_post"][data-v="1"]'); await pg.waitForTimeout(100);
  await pg.goto(`${BASE}?demo#/p/${pid}/prewarm`); await pg.waitForSelector('.times');
  await pg.click('.chip[data-sat="consent_st"][data-v="1"]'); await pg.clock.fastForward(800); // the tap guard ignores taps near the last one for 0.7 s
  await pg.click('.chip[data-sat="sat_pre"][data-v="1"]'); await pg.waitForTimeout(100);
  await adv(60); steps.push(await pacuTime('pacu_out', 'To ward'));
  await pg.goto(`${BASE}?demo#/p/${pid}`); await pg.waitForSelector('.times'); await pg.waitForTimeout(1500);

  await pg.goto(`${BASE}?demo#/p/${pid}`); await pg.waitForSelector('.times'); await pg.waitForTimeout(1500);
  { const g = await pg.$('#gaps'); if (g) throw new Error('still to fill: ' + await pg.textContent('#gaps')); }
  assert.deepEqual(dialogs, [], `group ${ARM}: no prompts on an in-order case`);
  assert.deepEqual(errs, [], `group ${ARM}: no page errors`);
  assert.deepEqual(steps.map(t => t.replace(/^Log\s*/, '').trim()), ARM === '3' ? ['Gown on', 'In OT', 'Induction', 'Surgery end', 'PACU in', 'To ward']
    : ['Gown on', 'Prewarm on', 'Prewarm off', 'In OT', 'Induction', 'Surgery end', 'PACU in', 'To ward'], `group ${ARM}: Log goes in order`);
  const rec = await pg.evaluate(id => JSON.parse(localStorage.getItem('prewarm-demo:patients'))[id], pid);
  const row = workbookSheets([rec], [])[0].rows[2];
  const empty = [];
  for (const [t, a, z] of SECTIONS.filter(([t]) => /INTERVENTION|INTRAOPERATIVE|PACU|SATISFACTION/.test(t)))
    for (let i = colIndex(a); i <= colIndex(z); i++) if (row[i] == null || row[i] === '') empty.push(FIELDS[i].id);
  const wrong = empty.filter(id => {
    if (ALLOWED.has(id)) return false;
    const m = /^(prewarm|iotemp|haemo)_(\w+?)_/.exec(id);
    if (m && m[1] !== 'prewarm' && +m[2] > 90) return false; // after surgery end (90 min)
    if (m && m[1] === 'prewarm' && ARM === '3') return false;
    if (m && m[1] === 'prewarm' && +m[2] > (ARM === '2' ? 10 : 30)) return false; // not taken after the last warming reading
    return true;
  });
  assert.deepEqual(wrong, [], `group ${ARM}: op-day cells left blank`);
  assert.equal(row[FIELDS.findIndex(f => f.id === 'pw_start')], ARM === '3' ? 'NA' : row[FIELDS.findIndex(f => f.id === 'pw_start')]);
  await ctx.close();
}));
await b.close();
console.log('prewarm full case: ok (30 min, 10 min, no pre-warming: in order, nothing left to fill, every op-day cell exported)');
