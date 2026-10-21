// Run with: node prewarm/test/prewarm.test.mjs  (fake data only)
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { HEADERS, SECTIONS, SCREENING_HEADERS } from '../js/headers.js';
import { FIELDS, BY_ID, PAGES, SCREENING, SITES, EXTRA, EXTRA_BY_ID, PACU_KEYS, colLetter, colIndex, calc, normaliseTemp, isShown, shownValue } from '../js/schema.js';
import fs from 'node:fs';
import { newRecord, setVal, val, mergeRecord, mergeInto, packFile, readFile, isGone, markDeleted, restore } from '../js/store.js';
import { workbook, workbookSheets, cellFor, ixText } from '../js/export.js';
import { dateSerial, timeSerial } from '../js/xlsx.js';

// schema lines up with the template, column for column
assert.equal(FIELDS.length, HEADERS.length, 'one field per template column');
assert.equal(new Set(FIELDS.map(f => f.id)).size, FIELDS.length, 'field ids are unique');
assert.equal(SCREENING.length, SCREENING_HEADERS.length);
const at = id => colLetter(BY_ID[id].colIndex);
const anchors = {
  screen_id: ['A', /^Screening ID/], enrol_id: ['B', /^Enrollment ID/], sex: ['G', /^Gender/], smoker: ['L', /^Smoker/],
  ihd_mi: ['U', /previous MI\(0-yes; 1-no\)/], csurg_proc: ['AE', /surgical procedure/], asp: ['AF', /^Aspirin/],
  warf: ['AJ', /^Warfarin\(0-yes; 1-no\)/], pre_hb: ['AR', /^Haemoglobin/], pre_ecg: ['BA', /^ECG/], pre_dl: ['BB', /^Downloaded/],
  arm: ['BC', /^Randomisation/], prewarm_0_core: ['BF', /^0min - Core/], prewarm_40_ts: ['DP', /^Thermal Sensation/],
  io_flip: ['DQ', /flipped/], io_ix: ['EM', /^Intraoperative Investigations/], iotemp_base_core: ['EN', /^Baseline Core/],
  iotemp_75_core: [null, /^75min \nCore/], iotemp_end_room: [null, /^End of Surgery\nRoom Temp/],
  haemo_base_sbp: ['OB', /^Baseline \nSystolic BP/], haemo_end_bis: ['SG', /^End of Surgery \nBIS/], pacu_in: ['SH', /PACU arrival/],
  pacu_delay_why: ['SR', /why\?/], d1_drain: ['SS', /^Blood loss/], d1_pcm: ['TD', /^Paracetamol/], d1_tram_dose: ['TM', /dosage/],
  sat_pre: ['TN', /preoperative period/], sat_post: ['TO', /postoperative period/], d2_dl: ['TY', /^Downloaded/],
  d2_pcm: ['UB', /^Paracetamol/], dc_hai: ['UL', /^Hospital Acquired Infection/], dc_mace: ['UO', /^Major Adverse Cardiac Event/],
  dc_icu: ['UT', /^Unplanned ICU/], dc_icu2: ['UV', /^Unplanned ICU/], dc_cost: ['UZ', /^Hospitalization Costs/],
};
for (const [id, [col, re]] of Object.entries(anchors)) {
  assert.ok(BY_ID[id], id + ' exists');
  if (col) assert.equal(at(id), col, id + ' column');
  assert.match(HEADERS[BY_ID[id].colIndex], re, id + ' header');
}
// each page's first field starts its template section
for (const p of PAGES) {
  const first = BY_ID[p.fields[0].id].colIndex;
  const [, a, b] = SECTIONS[p.section];
  assert.ok(first >= colIndex(a) && first <= colIndex(b), p.id + ' is inside ' + SECTIONS[p.section][0]);
}
// coded fields offer exactly the codes the template's dropdowns allow (where it has one)
assert.deepEqual(BY_ID.smoker.opts.map(o => o[0]), [0, 1, 2, 3]);
assert.deepEqual(BY_ID.dc_mace.opts.map(o => o[0]), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(BY_ID.pre_ecg.opts.map(o => o[0]), [0, 1, 2]);
// show conditions point at earlier fields
for (const f of FIELDS) if (f.show) assert.ok(BY_ID[f.show.f] && BY_ID[f.show.f].colIndex < BY_ID[f.id].colIndex, f.id + ' show');

assert.equal(colLetter(0), 'A'); assert.equal(colLetter(25), 'Z'); assert.equal(colLetter(26), 'AA'); assert.equal(colLetter(571), 'UZ');
assert.equal(colIndex('UZ'), 571);

// helpers
assert.equal(calc('bmi', id => ({ wt: '70', ht: '175' })[id]), 22.9);
assert.equal(calc('bmi', id => ({ wt: '70', ht: '1.75' })[id]), 22.9);
assert.equal(calc('bmi', id => ({ wt: '70' })[id]), null);
assert.equal(calc('txa', id => ({ io_txa_bolus: '1000', io_txa_inf: '500' })[id]), 1500);
assert.equal(calc('map', id => ({ sbp: '120', dbp: '60' })[id]), 80);
assert.equal(normaliseTemp('365'), '36.5');
assert.equal(normaliseTemp('36,5'), '36.5');
assert.equal(normaliseTemp('120'), '120');
assert.equal(isShown(BY_ID.ihd_mi_years, id => ({ ihd: 1, ihd_mi: 0 })[id]), true);
// a follow-up of a follow-up hides when the first answer goes back to No, and its old value isn't exported
assert.equal(isShown(BY_ID.ihd_mi_years, id => ({ ihd: 0, ihd_mi: 0 })[id]), false);
assert.equal(shownValue('ihd_mi_years', id => ({ ihd: 0, ihd_mi: 0, ihd_mi_years: 3 })[id]), null);
assert.equal(shownValue('io_txa_bolus', id => ({ io_txa: 0, io_txa_bolus: '1000' })[id]), null);
assert.equal(shownValue('io_txa_bolus', id => ({ io_txa: 1, io_txa_bolus: '1000' })[id]), '1000');
assert.equal(isShown(BY_ID.ihd_mi_years, id => ({ ihd: 1, ihd_mi: 1 })[id]), false);

// records and merging
{
  const a = newRecord(1000);
  assert.equal(setVal(a, 'age', 64, 'A', 2000), true);
  assert.equal(setVal(a, 'age', 64, 'A', 2100), false, 'same value is not an edit');
  setVal(a, 'sex', 1, 'A', 2000);
  const b = { ...a, f: { ...a.f } };
  setVal(b, 'age', 65, 'B', 3000);  // B corrects age later
  setVal(a, 'sex', null, 'A', 4000); // A clears sex later still
  setVal(b, 'wt', 70, 'B', 3500);
  const m1 = mergeRecord(a, b).rec, m2 = mergeRecord(b, a).rec;
  assert.deepEqual(m1.f, m2.f, 'merging is the same either way round');
  assert.equal(val(m1, 'age'), 65); assert.equal(val(m1, 'sex'), null); assert.equal(val(m1, 'wt'), 70);
  assert.equal(mergeRecord(m1, m1).changed, 0, 'merging a copy changes nothing');
  // clock behind: an edit still lands after the value it replaces
  const c = newRecord(); setVal(c, 'age', 1, '', 5000); setVal(c, 'age', 2, '', 100);
  assert.ok(c.f.age.t > 5000);
}
{
  // the same patient entered on two phones merges by Screening ID
  const a = newRecord(1); setVal(a, 'screen_id', 'SBH001', 'A', 10); setVal(a, 'age', 50, 'A', 10);
  const b = newRecord(2); setVal(b, 'screen_id', 'sbh001 ', 'B', 20); setVal(b, 'wt', 80, 'B', 20);
  const other = newRecord(3); setVal(other, 'screen_id', 'SBH002', 'B', 20);
  const { map, added, updated } = mergeInto({ [a.id]: a }, [b, other], ['screen_id', 'enrol_id']);
  assert.equal(Object.keys(map).length, 2); assert.equal(added, 1); assert.equal(updated, 1);
  assert.equal(val(map[a.id], 'wt'), 80); assert.equal(val(map[a.id], 'age'), 50);
  // deleting travels
  const del = { ...map[a.id], deleted: 99 };
  assert.equal(mergeInto(map, [del], ['screen_id']).map[a.id].deleted, 99);
  // junk is ignored
  assert.equal(mergeInto(map, [null, { id: 5 }], []).added, 0);
}
{
  // shared files leave out initials
  const s = newRecord(); setVal(s, 'id', 'SBH001'); setVal(s, 'initials', 'XY');
  const file = JSON.stringify(packFile({ patients: [], screening: [s] }, ['initials'], 'tester'));
  assert.ok(!file.includes('XY'));
  const back = readFile(file);
  assert.equal(val(back.screening[0], 'id'), 'SBH001');
  assert.throws(() => readFile('{"kind":"other"}'));
  assert.throws(() => readFile('not json'));
}

// export
assert.equal(dateSerial('2026-10-12'), 46307);
assert.equal(timeSerial('06:00'), 0.25);
assert.deepEqual(cellFor(BY_ID.op_date, '2026-10-12'), { v: 46307, fmt: 'date' });
assert.deepEqual(cellFor(BY_ID.pw_start, 'NA'), 'NA');
assert.equal(cellFor(BY_ID.sex, 0), 0);
assert.equal(cellFor(BY_ID.wt, '70.5'), 70.5);
assert.equal(cellFor(BY_ID.io_tech, 'TIVA'), 'TIVA');
assert.equal(cellFor(BY_ID.age, ''), null);
{
  const p = newRecord(); setVal(p, 'enrol_id', 'E2'); setVal(p, 'sex', 0); setVal(p, 'iotemp_end_room', '21.5'); setVal(p, 'dc_cost', 12000);
  const q = newRecord(); setVal(q, 'enrol_id', 'E10');
  const gone = newRecord(); setVal(gone, 'enrol_id', 'E1'); gone.deleted = 1;
  const [data, scr] = workbookSheets([q, p, gone], []);
  assert.equal(data.rows.length, 4, 'section row, header row, two live patients');
  assert.equal(data.rows[2][1], 'E2', 'sorted by Enrollment ID, numbers in order');
  assert.equal(data.rows[2][colIndex('G')], 0);
  assert.equal(data.rows[2][BY_ID.iotemp_end_room.colIndex], 21.5);
  assert.equal(data.rows[2][colIndex('UZ')], 12000);
  assert.equal(data.merges.length, 12);
  assert.equal(scr.rows.length, 1);
  // readings sheet: one row per saved timepoint, with the exact time and who saved it
  setVal(p, 'prewarm_5_core', '36.5', 'AB'); setVal(p, 'at_prewarm_5', '08:12', 'AB');
  const [, , rd, ex] = workbookSheets([p], []);
  assert.equal(rd.rows.length, 3, 'the 5-min pre-warming reading and the end-of-surgery room temp');
  assert.deepEqual(rd.rows[1].slice(0, 3), ['E2', 'Pre-warming', '5 min']);
  assert.match(rd.rows[1][5], /Core \(spot on\) 36.5/);
  assert.equal(ex.rows[0][0].s, 'Subject ID');
  assert.equal(ex.rows[0][1].s, 'Hospital');
  assert.deepEqual(SITES, ['NTF', 'NUH', 'SGH', 'CGH', 'TTSH', 'KTPH', 'WH']);
  assert.equal(EXTRA[0].id, 'site');
  // investigation rows go in the template's one cell as text
  setVal(p, 'io_ix_rows', JSON.stringify([{ time: '10:30', hb: '9.8', test: 'ROTEM', ct: '60' }]));
  assert.equal(workbookSheets([p], [])[0].rows[2][BY_ID.io_ix.colIndex], '10:30, Hb 9.8, ROTEM, CT or R 60');
  assert.equal(ixText('not json'), '');
  // deleted, then restored (a later "restored" field): back in the export
  const dr = newRecord(); setVal(dr, 'enrol_id', 'DEL-1', 'A', 1000); dr.deleted = 2000;
  assert.equal(isGone(dr), true);
  assert.equal(workbookSheets([dr], [])[0].rows.length, 2, 'deleted: not exported');
  setVal(dr, 'restored', 1, 'A', 3000);
  assert.equal(isGone(dr), false);
  assert.equal(workbookSheets([dr], [])[0].rows.length, 3, 'restored: exported');
  dr.deleted = 4000;
  assert.equal(isGone(dr), true, 'deleted again');
  // delete, restore, delete, restore, again and again: every restore works, even from a phone whose clock is behind
  const dd = newRecord(); setVal(dd, 'enrol_id', 'DEL-2', 'A', 1000);
  markDeleted(dd, 5000); assert.equal(isGone(dd), true);
  restore(dd, 'A', 6000); assert.equal(isGone(dd), false, 'first restore');
  markDeleted(dd, 7000); assert.equal(isGone(dd), true, 'deleted again');
  restore(dd, 'A', 8000); assert.equal(isGone(dd), false, 'second restore works');
  markDeleted(dd, 100); assert.equal(isGone(dd), true, 'a delete from a slow clock still counts');
  restore(dd, 'A', 50); assert.equal(isGone(dd), false, 'and so does a restore from a slow clock');
  // the free-text note for anything off-protocol goes to the Extra sheet
  const nv = newRecord(); setVal(nv, 'enrol_id', 'NOTE-1', 'A'); setVal(nv, 'io_dev', 'monitor fault 10:20', 'A');
  const extraSheet = workbookSheets([nv], []).find(sh => sh.name === 'Extra');
  assert.ok(extraSheet && JSON.stringify(extraSheet.rows).includes('monitor fault 10:20'), 'io_dev is in the Extra sheet');
  // pre-warming readings past the warming export as NA (10 min group: after 10; 30 min group: after 30); none for the no-pre-warming group
  const naRow = (arm, extra = {}) => { const q = newRecord(); setVal(q, 'enrol_id', 'NA-' + arm, 'A'); setVal(q, 'arm', arm, 'A'); for (const [k, v] of Object.entries(extra)) setVal(q, k, v, 'A'); return workbookSheets([q], [])[0].rows[2]; };
  const col = id => BY_ID[id].colIndex;
  const r10 = naRow(2, { prewarm_10_core: '36.5' }), r30 = naRow(1), r0 = naRow(3);
  assert.equal(r10[col('prewarm_15_core')], 'NA', '10 min group: 15 min reading is NA');
  assert.equal(r10[col('prewarm_10_core')]?.v ?? r10[col('prewarm_10_core')], 36.5, 'the 10 min reading itself is kept');
  assert.equal(r10[col('prewarm_5_chest')], null, 'a reading within the warming stays empty');
  assert.equal(r30[col('prewarm_30_core')], null, '30 min group: 30 min is within the warming');
  assert.equal(r30[col('prewarm_35_core')], 'NA', '30 min group: 35 min is NA');
  assert.equal(r0[col('prewarm_15_core')], null, 'no pre-warming group: left empty');
  assert.equal(cellFor({ type: 'num' }, '37,5'), 37.5, 'a decimal comma is a number');
  // corrected to the no pre-warming group: its pre-warming readings aren't exported; very long text is cut to fit a cell
  const nw = newRecord(); setVal(nw, 'enrol_id', 'NW-1', 'A'); setVal(nw, 'arm', 1, 'A'); setVal(nw, 'prewarm_0_core', '36.5', 'A');
  assert.equal(workbookSheets([nw], [])[0].rows[2][BY_ID.prewarm_0_core.colIndex], 36.5);
  setVal(nw, 'arm', 3, 'A');
  assert.equal(workbookSheets([nw], [])[0].rows[2][BY_ID.prewarm_0_core.colIndex], null);
  assert.equal(cellFor({ type: 'text' }, 'x'.repeat(40000)).length, 32000);
  // hidden follow-ups aren't exported (TXA answered No after a bolus was typed); no pre-warming exports NA for its start
  setVal(p, 'io_txa', 1); setVal(p, 'io_txa_bolus', '1000');
  assert.equal(workbookSheets([p], [])[0].rows[2][BY_ID.io_txa_bolus.colIndex], 1000);
  setVal(p, 'io_txa', 0);
  assert.equal(workbookSheets([p], [])[0].rows[2][BY_ID.io_txa_bolus.colIndex], null);
  setVal(p, 'arm', 3);
  assert.equal(workbookSheets([p], [])[0].rows[2][BY_ID.pw_start.colIndex], 'NA');
  assert.equal(calc('nudesc', id => ({ nd_dis: 1, nd_beh: 2 })[id]), 3);

  // the file is a valid zip whose sheet carries the values
  const bytes = workbook([p], []);
  const text = unzip(bytes);
  assert.deepEqual(Object.keys(text).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml']);
  assert.match(text['xl/worksheets/sheet1.xml'], /<c r="UZ3"><v>12000<\/v><\/c>/);
  assert.match(text['xl/worksheets/sheet1.xml'], /<mergeCell ref="A1:AE1"\/>/);
  assert.match(text['xl/workbook.xml'], /name="Screening Number"/);
}

function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true), size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nl));
    let data = bytes.subarray(o + 30 + nl + xl, o + 30 + nl + xl + size);
    if (method === 8) data = inflateRawSync(data);
    out[name] = new TextDecoder().decode(data);
    o += 30 + nl + xl + size;
  }
  return out;
}

// lock: the later lock / unlock wins when records merge
{
  const a = { id: 'L', created: 1, f: {}, lock: { on: true, t: 5, by: 'admin' } };
  const b = { id: 'L', created: 1, f: {}, lock: { on: false, t: 9, by: 'admin' } };
  assert.equal(mergeRecord(a, b).rec.lock.on, false);
  assert.equal(mergeRecord(b, a).rec.lock.on, false, 'an older lock does not win');
  assert.equal(mergeRecord({ id: 'L', created: 1, f: {} }, a).rec.lock.on, true);
}
// the PACU nurse's link may write only the PACU page's fields: PACU_KEYS and the rules' list match, and every key is real
{
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const m = /function pacuKeys\(\) \{\s*return \[([^\]]*)\]/.exec(rules);
  const listed = [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]);
  assert.deepEqual([...listed].sort(), [...PACU_KEYS].sort(), 'the rules allow exactly PACU_KEYS');
  for (const k of PACU_KEYS) assert.ok(k === 'sign_pacu' || BY_ID[k] || EXTRA_BY_ID[k], 'a real field: ' + k);
  const page = PAGES.find(x => x.id === 'pacu').fields.map(f => f.id);
  for (const k of page) assert.ok(PACU_KEYS.includes(k), 'every PACU page field can be written from the link: ' + k);
  assert.ok(!PACU_KEYS.some(k => /^(prewarm|iotemp|haemo|io_|pw_|arm|enrol)/.test(k)), 'nothing from the other pages');
}

// Email and PayNow (js/pay.js)
{
  const { checkPay, cleanPaynow, payOrder, ticksHtml } = await import('../js/pay.js');
  assert.equal(checkPay('', ''), 'Enter the email or the PayNow number.');
  assert.equal(checkPay('pt@example.com', ''), '');
  assert.equal(checkPay('', '9123 4567'), '');
  assert.equal(checkPay('', '+65 8123-4567'), '');
  assert.match(checkPay('', '6123 4567'), /8 digits/);
  assert.match(checkPay('', '912345'), /8 digits/);
  assert.match(checkPay('not an email', ''), /email/);
  assert.equal(cleanPaynow('+65 9123 4567'), '91234567');
  assert.deepEqual(payOrder([{ pid: 'c', cleared: {}, paid: {} }, { pid: 'b', paid: {} }, { pid: 'a1', setAt: 1 }, { pid: 'a2', setAt: 2 }]).map(d => d.pid), ['a2', 'a1', 'b', 'c']);
  const esc = s => String(s);
  assert.match(ticksHtml({ pid: 'x', email: 'e@x.y' }, esc), /data-payclear="x" disabled/, 'Delete waits for Payment sent');
  assert.doesNotMatch(ticksHtml({ pid: 'x', email: 'e@x.y', paid: { t: 1, by: 'a' } }, esc), /data-payclear="x" disabled/);
  assert.doesNotMatch(ticksHtml({ pid: 'x', paid: { t: 1, by: 'a' }, cleared: { t: 2, by: 'a' } }, esc), /data-payclear/, 'nothing to delete once deleted');
}

console.log('prewarm: ok');
