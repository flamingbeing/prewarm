// Run with: node prewarm/test/scan-imports.test.mjs  (fake data only)
// A scan import becomes rows for the approval screen: by form page in form order, values to check apart from those that look
// fine, unknown ids left out, nothing replaced unless ticked; the patient from the Subject ID; imports grouped; crops.
import assert from 'node:assert/strict';
import { rowsFor, toValue, byPage, matchPatients, groupImports, cropRect } from '../js/scan-imports.js';

const imp = { fields: { age: { v: '67', flags: [], page: 1 }, pw_gown: { v: '07:05', flags: ['hard to read'], page: 1 }, wt: { v: '', flags: [] }, nonsense: { v: '5', flags: [] },
  prewarm_5_core: { v: '36.7', flags: [], page: 3, box: { x: 0.5, y: 0.4, w: 0.1, h: 0.02 } }, sex: { v: '1', flags: [] } } };
const { rows, skipped } = rowsFor(imp, id => id === 'prewarm_5_core' ? 36.1 : null);
assert.deepEqual(skipped, ['nonsense']);
assert.deepEqual(rows.map(r => r.id), ['age', 'pw_gown', 'prewarm_5_core', 'sex'], 'by page, then form order; no page last; blanks without flags dropped');
const by = Object.fromEntries(rows.map(r => [r.id, r]));
assert.equal(by.age.use, true, 'a clean new value starts ticked');
assert.equal(by.age.check, false, 'a clean new value looks fine');
assert.equal(by.pw_gown.use, false, 'a flagged value starts unticked');
assert.equal(by.pw_gown.check, true, 'a flagged value is to check');
assert.equal(by.prewarm_5_core.use, false, 'a value that would replace a saved one starts unticked');
assert.equal(by.prewarm_5_core.replaces, true);
assert.equal(by.prewarm_5_core.check, true, 'a replacement is to check');
assert.deepEqual(by.prewarm_5_core.box, { x: 0.5, y: 0.4, w: 0.1, h: 0.02 });
assert.equal(by.age.box, null, 'no box: no crop');
assert.equal(rowsFor({ fields: { age: { v: '67' } } }, () => 67).rows[0].replaces, false, 'same value is not a replacement');
assert.equal(rowsFor({ fields: { age: { v: '67', page: 40, box: { x: 'a' } } } }).rows[0].page, null, 'a page out of range is not known');
assert.deepEqual(rowsFor({}).rows, [], 'an import with no fields');
const g = byPage(rows);
assert.deepEqual(g.map(x => [x.page, x.check.map(r => r.id), x.fine.map(r => r.id)]), [[1, ['pw_gown'], ['age']], [3, ['prewarm_5_core'], []], [null, [], ['sex']]]);
// the patient: the Subject ID typed on the phone, case and spaces aside; none or two -> the admin picks
const pts = [{ id: 'a', s: 'DEMO-01' }, { id: 'b', s: 'demo-02' }, { id: 'c', s: 'DEMO-02 ' }];
const sid = p => p.s;
assert.deepEqual(matchPatients(' demo-01', pts, sid).map(p => p.id), ['a']);
assert.deepEqual(matchPatients('DEMO-02', pts, sid).map(p => p.id), ['b', 'c']);
assert.deepEqual(matchPatients('', pts, sid), []);
assert.deepEqual(matchPatients(undefined, pts, sid), []);
// imports by Subject ID (else by scan, rounds with their first read), newest group first, rounds in order
const gs = groupImports([{ id: 'x', scan: 'x', subject: 'DEMO-01', createdAt: 1 }, { id: 'y', scan: 'y', createdAt: 5 }, { id: 'x-2', scan: 'x', subject: 'demo-01', createdAt: 3 }, { id: 'y-2', scan: 'y', createdAt: 6 }]);
assert.deepEqual(gs.map(x => x.imports.map(i => i.id)), [['y', 'y-2'], ['x', 'x-2']]);
assert.equal(gs[1].subject, 'DEMO-01');
// the crop: room around the box, inside the photo
const c = cropRect({ x: 0.5, y: 0.4, w: 0.1, h: 0.02 }, 1800, 2400);
assert.ok(c.sx < 900 && c.sx + c.sw > 1080 && c.sy < 960 && c.sy + c.sh > 1008, JSON.stringify(c));
const e = cropRect({ x: 0, y: 0.99, w: 1, h: 0.01 }, 1800, 2400);
assert.ok(e.sx === 0 && e.sw === 1800 && e.sy + e.sh <= 2400, JSON.stringify(e));
assert.equal(toValue({ type: 'num' }, ' 36.5 '), 36.5);
assert.equal(toValue({ type: 'num' }, 'NA'), 'NA');
assert.equal(toValue({ type: 'text' }, ' x '), 'x');
assert.equal(toValue({ type: 'num' }, ''), null);
console.log('scan-imports: ok');
