// Scan pages: what a reading can be and the column rules (made-up values only). node prewarm/test/scan-checks.test.mjs
// The same cases as tools/scan/unit.py.
import assert from 'node:assert/strict';
import { clean, allowed, pointOrder, arrowGaps, fillArrows, seriesChecks, ARROW } from '../js/scan-checks.js';

const F = (id, type, k = {}) => ({ id, type, ...k });
const YN = [[0, 'No'], [1, 'Yes']], TH = [[-3, '−3 Cold'], [0, '0 Neutral'], [3, '+3 Hot']];
// numbers: whole, decimal, 3-digit temperature, wide skin range, minus signs
assert.deepEqual(clean(F('age', 'int'), '68'), [68, []]);
assert.deepEqual(clean(F('prewarm_0_core', 'num'), '365'), [36.5, []]);
assert.deepEqual(clean(F('iotemp_base_chest', 'num'), '25.9'), [25.9, []]);
assert.deepEqual(clean(F('prewarm_0_core', 'num'), '45')[1], ['outside 30-42']);
assert.deepEqual(clean(F('io_ebl', 'int'), '500'), [500, []]);
assert.deepEqual(clean(F('age', 'int'), '6.5')[1], ['should be a whole number']);
assert.deepEqual(clean(F('prewarm_0_ts', 'code', { opts: TH }), '−3'), [-3, []]);
assert.deepEqual(clean(F('prewarm_0_ts', 'code', { opts: TH }), '+3'), [3, []]);
assert.ok(clean(F('prewarm_0_ts', 'code', { opts: TH }), '5')[1][0].startsWith('not one of'));
assert.deepEqual(clean(F('pre_wbc', 'num'), '0.4')[1], ['outside 0.5-80']);
assert.deepEqual(clean(F('io_ebl', 'int'), 'abc'), ['abc', ['not a number']]);
assert.deepEqual(clean(F('io_ebl', 'int'), 'na'), ['NA', []]);
// written Y / N
assert.deepEqual(clean(F('iotemp_5_gown', 'code', { opts: YN }), 'Y'), [1, []]);
assert.deepEqual(clean(F('iotemp_5_gown', 'code', { opts: YN }), 'n'), [0, []]);
assert.ok(clean(F('iotemp_5_gown', 'code', { opts: YN }), 'X')[1].length);
// times
assert.deepEqual(clean(F('pw_gown', 'time'), '0820'), ['08:20', []]);
assert.deepEqual(clean(F('pw_gown', 'time'), '8:20'), ['08:20', []]);
assert.deepEqual(clean(F('pw_gown', 'time'), '25:00')[1], ['not a 24-hour time']);
// arrows and blanks
assert.deepEqual(clean(F('iotemp_5_room', 'num'), 'ARROW'), [null, [ARROW]]);
assert.deepEqual(clean(F('iotemp_5_room', 'num'), ''), [null, []]);
assert.equal(allowed(F('pw_gown', 'time')), 'a 24-hour clock time, like 07:05');
assert.equal(allowed(F('age', 'int')), 'a number from 16 to 110 (whole)');
assert.equal(allowed(F('iotemp_5_gown', 'code', { opts: YN })), 'one of: No, Yes (usually just the letter or number)');

// empty cells between arrows are flagged, a genuinely empty column is not
const pts = ['0', '5', '10', '15', '20', '25'];
const FS = Object.fromEntries(pts.map(p => [`iotemp_${p}_room`, { id: `iotemp_${p}_room`, series: 'iotemp', col: 'room', point: p }]));
const E = (k = {}) => ({ value: null, flags: [], ...k });
let out = { iotemp_0_room: E(), iotemp_5_room: E({ flags: [ARROW] }), iotemp_10_room: E(), iotemp_15_room: E({ flags: [ARROW] }), iotemp_20_room: E(), iotemp_25_room: { value: 18, flags: [] } };
arrowGaps(out, FS);
assert.ok(out.iotemp_10_room.flags.length && out.iotemp_20_room.flags.length && !out.iotemp_0_room.flags.length);
// arrows repeat the reading above (an empty cell the arrow runs through too); an arrow with nothing above stays flagged
out = { iotemp_0_room: { value: 18, flags: [] }, iotemp_5_room: E({ flags: [ARROW] }), iotemp_10_room: E(), iotemp_15_room: E({ flags: [ARROW] }), iotemp_20_room: { value: 19, flags: [] }, iotemp_25_room: E() };
arrowGaps(out, FS); fillArrows(out, FS);
assert.deepEqual(pts.map(p => out[`iotemp_${p}_room`].value), [18, 18, 18, 18, 19, null]);
assert.ok(!out.iotemp_5_room.flags.length);
assert.deepEqual(out.iotemp_5_room.notes, ['arrow: copied from the reading above']);
assert.ok(!out.iotemp_25_room.flags.length, 'a genuinely empty cell after a reading stays empty');
// a reading that needs checking is copied down, but every copy is flagged too
const chk = { iotemp_0_room: { value: 81, flags: ['outside 10-40'] }, iotemp_5_room: E({ flags: [ARROW] }), iotemp_10_room: E({ flags: [ARROW] }), iotemp_15_room: { value: 19, flags: [] }, iotemp_20_room: E({ flags: [ARROW] }), iotemp_25_room: E() };
fillArrows(chk, FS);
assert.ok(chk.iotemp_5_room.flags.length && chk.iotemp_10_room.flags.length && !chk.iotemp_20_room.flags.length);
const top = { iotemp_0_room: E({ flags: [ARROW] }), iotemp_5_room: { value: 18, flags: [] } };
fillArrows(top, FS);
assert.equal(top.iotemp_0_room.value, null); assert.deepEqual(top.iotemp_0_room.flags, [ARROW]);

// series order: baseline first, minutes in order, end of surgery last (a baseline next to the end is not a "jump")
const arm = { base: 35.0, 0: 35.2, 5: 34.9, 10: 34.2, 300: 29.8, end: 23.6 };
const fo = Object.fromEntries(Object.entries(arm).map(([k, v]) => [`iotemp_${k}_arm`, { value: v, flags: [] }]));
const ff = Object.fromEntries(Object.keys(arm).map(k => [`iotemp_${k}_arm`, { id: `iotemp_${k}_arm`, series: 'iotemp', col: 'arm', point: k }]));
seriesChecks(fo, ff);
assert.ok(!fo.iotemp_base_arm.flags.length && !fo.iotemp_0_arm.flags.length);
assert.deepEqual(fo.iotemp_end_arm.flags, ['jumps >6 °C from the neighbouring reading'], 'the 23.6 after 29.8 is flagged');
assert.deepEqual(['300', 'end', 'base', '5', '0'].sort((a, b) => pointOrder(a) - pointOrder(b)), ['base', '0', '5', '300', 'end']);
// blood pressure upside down; a missing or unreadable partner is left alone
const bp = { pacu_sbp: { value: 70, flags: [] }, pacu_dbp: { value: 80, flags: [] }, io_sbp: { value: 'NA', flags: [] }, io_dbp: { value: 60, flags: [] }, x_sbp: { value: 90, flags: [] } };
seriesChecks(bp, {});
assert.deepEqual([bp.pacu_sbp.flags, bp.pacu_dbp.flags, bp.io_sbp.flags, bp.x_sbp.flags], [['systolic not above diastolic'], ['systolic not above diastolic'], [], []]);
console.log('scan-checks: ok');
