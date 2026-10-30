// Scan pages read on the phone: a page -> crops to read -> readings -> the import document (made-up form and values only).
// node prewarm/test/scan-read.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGrayPng } from './png-gray.mjs';
import { planPage, applyRead, finish, importDoc } from '../js/scan-read.js';
import { ARROW } from '../js/scan-checks.js';
import { MARGIN } from '../js/scan-crop.js';

const D = new URL('./scan-parity/', import.meta.url);
const fm = JSON.parse(readFileSync(new URL('form-map.json', D))), ex = JSON.parse(readFileSync(new URL('expected.json', D)));
const tpl = readGrayPng(new URL(fm.pages[0].template, D)), byId = Object.fromEntries(fm.fields.map(f => [f.id, f]));
const onPage = fm.fields.filter(f => f.page === 1);

for (const pg of ex.pages) {
  const p = readGrayPng(new URL(pg.page, D)), r = planPage(p.data, p.w, p.h, fm.pages[0], onPage, tpl.data);
  assert.ok(r.score > 0 && r.score <= 1, pg.page + ': score');
  for (const c of r.crops) {
    const f = byId[c.id];
    assert.ok(f && f.send && f.kind === 'cell', `${pg.page}: only sendable cells are cut out (${c.id})`);
    const [x0, y0, x1, y1] = f.inner, want = [Math.min(p.w, x1 + MARGIN[0]) - Math.max(0, x0 - MARGIN[0]), Math.min(p.h, y1 + MARGIN[1]) - Math.max(0, y0 - MARGIN[1])];
    assert.deepEqual([c.w, c.h], want, c.id + ': crop is the cell plus the margin');
    assert.equal(c.data.length, c.w * c.h);
  }
  assert.ok(r.crops.length > 20, pg.page + ': the written cells are cut out');
  assert.ok(!r.crops.some(c => c.id === 'demo_id'), 'free text is never cut out');
  for (const f of onPage) if (f.kind === 'tick') assert.ok(f.id in r.out, f.id + ': ticks are read on the phone');
}

// two readings -> value and flags, as scan.py does
const num = { id: 'demo_0_c0', type: 'num', opts: null };
let e = applyRead({ value: null, flags: [] }, num, { a: { text: '36.5', legible: true }, b: { text: '36.5', legible: true } });
assert.deepEqual([e.value, e.flags], [36.5, []]);
e = applyRead({ value: null, flags: [] }, num, { a: { text: '36.5', legible: true }, b: { text: '38.5', legible: false } });
assert.deepEqual([e.value, e.flags], [36.5, ['hard to read', 'two reads disagree']]);
e = applyRead({ value: null, flags: [] }, num, { a: { text: '', legible: true }, b: { text: '', legible: true } });
assert.deepEqual(e.flags, ['ink in the cell but read as empty']);
e = applyRead({ value: null, flags: [], marks: 2 }, { id: 'x', type: 'code', opts: [[0, 'No'], [1, 'Yes']] }, { a: { text: 'Y', legible: true }, b: { text: '1', legible: true } });
assert.deepEqual([e.value, e.flags], [1, ['two marks in the cell (one crossed out?)']]);
e = applyRead({ value: null, flags: [] }, { id: 't', type: 'time', opts: null }, { a: { text: '7.05', legible: true }, b: { text: '0705', legible: true } });
assert.deepEqual([e.value, e.flags], ['07:05', []]);

// an arrow takes the reading above it in the same column
const fields = { a0: { id: 'a0', series: 'iotemp', col: 'core', point: '0' }, a1: { id: 'a1', series: 'iotemp', col: 'core', point: '15' } };
const out = finish({ a0: { value: 36.4, flags: [], page: 7 }, a1: { value: null, flags: [ARROW], page: 7 } }, fields);
assert.equal(out.a1.value, 36.4);

// the import document: values and flags only, same shape as Firetop's, marked as read on the phone
const doc = importDoc({ scan: 'abc123', subject: 'DEMO-01', now: 5, by: 'uid1', pages: [{ page: 1, score: 0.93, retake: false }, { page: 2, score: 0.6, retake: true }],
  out: { a0: { value: 36.4, flags: [], page: 7, box: { x: 0.1, y: 0.2, w: 0.1, h: 0.01 } }, empty: { value: null, flags: [], page: 7 }, odd: { value: null, flags: ['x'.repeat(300)], page: 99 } } });
assert.deepEqual(doc, {
  scan: 'abc123', createdAt: 5, status: 'pending', via: 'phone', by: 'uid1', subject: 'DEMO-01',
  pages: [{ page: 1, accepted: true, score: 0.93 }, { page: 2, accepted: false, score: 0.6 }],
  fields: { a0: { v: '36.4', flags: [], page: 7, box: { x: 0.1, y: 0.2, w: 0.1, h: 0.01 } }, odd: { v: '', flags: ['x'.repeat(200)] } },
});
assert.equal(importDoc({ scan: 's', subject: '<b>', now: 1, by: 'u', pages: [], out: {} }).subject, undefined, 'odd Subject IDs are left out');
console.log('scan-read: ok');
