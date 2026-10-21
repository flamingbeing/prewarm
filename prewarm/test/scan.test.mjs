// Scan pages: the contrast stretch and sizing (fake pixels only). node prewarm/test/scan.test.mjs
import assert from 'node:assert/strict';
import { autoLevels, fitSize, burstLabels, stateOf, applyStatus } from '../js/scan.js';

// a dull grey "paper" (150) with a few dark "ink" pixels (60): paper goes to white, ink stays dark
const n = 1000, d = new Uint8ClampedArray(n * 4);
for (let i = 0; i < n; i++) { const v = i < 30 ? 60 : 150; d.set([v, v, v, 255], i * 4); }
const r = autoLevels(d);
assert.equal(r.changed, true);
assert.equal(d[999 * 4], 255, 'paper becomes white');
assert.ok(d[0] < 5, 'ink stays dark');
assert.equal(d[3], 255, 'alpha untouched');

// a flat image is left alone
const flat = new Uint8ClampedArray(400).fill(120);
assert.equal(autoLevels(flat).changed, false);
assert.ok(flat.every(v => v === 120));

// colour balance: one gain for all channels
const c = new Uint8ClampedArray(n * 4);
for (let i = 0; i < n; i++) c.set(i < 30 ? [50, 40, 30, 255] : [200, 160, 120, 255], i * 4);
autoLevels(c);
assert.ok(c[999 * 4] > c[999 * 4 + 1] && c[999 * 4 + 1] > c[999 * 4 + 2], 'warm tint kept in order');

assert.deepEqual(fitSize(4000, 3000), [2400, 1800]);
assert.deepEqual(fitSize(1000, 800), [1000, 800], 'never scaled up');
// a burst covers a range of page numbers in order, kept within 1-14
assert.deepEqual(burstLabels('3', '7'), ['3', '4', '5', '6', '7']);
assert.deepEqual(burstLabels(1, 14).length, 14);
assert.deepEqual(burstLabels(9, 2), ['9'], 'an end before the start: just the first page');
assert.deepEqual(burstLabels(0, 99), burstLabels(1, 14), 'kept within 1-14');

// a page's state on the way: phone, sending, not sent, then the study computer's word
assert.equal(stateOf({ id: 'a' }), 'phone');
assert.equal(stateOf({ id: 'a' }, new Set(['a'])), 'sending');
assert.equal(stateOf({ id: 'a' }, new Set(), new Map([['a', 'busy']])), 'failed');
assert.equal(stateOf({ id: 'a', sentAt: 1 }), 'received');
assert.equal(stateOf({ id: 'a', sentAt: 1, server: { state: 'retake' } }), 'retake');
assert.equal(stateOf({ id: 'a', sentAt: 1, server: { state: 'odd' } }), 'received', 'an unknown state reads as sent');

// the status onto the pages: states copied, a page matched to another number moves to a free slot, once
const pg = (id, label, o = {}) => ({ id, label, subject: 'DEMO-01', scan: 's1', sentAt: 1, sentAs: label, ...o });
let pages = [pg('a', '1'), pg('b', '3'), pg('c', '4'), pg('d', '6', { subject: 'DEMO-02' }), pg('e', '7', { sentAt: undefined })];
let st = { scan: 's1', page: { 1: { state: 'read', page: 1, values: 12, flagged: 2 }, 3: { state: 'read', page: 5 }, 4: { state: 'read', page: 1 }, 7: { state: 'read' } } };
let out = applyStatus(pages, st, 99);
assert.deepEqual(out.changed.map(p => p.id), ['a', 'b', 'c'], 'unsent pages are left alone');
assert.deepEqual(out.moved, [['3', '5']], 'page 3 was really page 5: moved; page 4 found as 1 stays (slot 1 is taken)');
assert.equal(pages[1].label, '5'); assert.equal(pages[1].from, '3'); assert.equal(pages[2].label, '4');
assert.equal(applyStatus(pages, st).changed.length, 0, 'the same status twice changes nothing');
st = { scan: 's1', page: { 1: { state: 'approved', page: 1 }, 3: { state: 'retake', page: 2, why: 'did not line up' } } };
out = applyStatus(pages, st, 99);
assert.equal(pages[0].doneAt, 99, 'approved: the day it was seen is kept (for the clearing)');
assert.equal(pages[1].label, '5', 'moved once only; matched by the number it was sent as');
assert.equal(pages[1].server.state, 'retake');
pages = [pg('a', '2')];
applyStatus(pages, { scan: 's1', page: { 2: { state: 'retake', page: 9 } } });
assert.equal(pages[0].label, '2', 'a page asked to be retaken is not moved');
applyStatus(pages, { scan: 'other', page: { 2: { state: 'read' } } });
assert.equal(pages[0].server.state, 'retake', 'another scan\'s status is not applied');
console.log('scan unit tests passed');
