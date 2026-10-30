// Scan pages: crop places and what the ink in a cell is (made-up marks only). node prewarm/test/scan-crop.test.mjs
// The same cases as tools/scan/unit.py, drawn here with plain strokes instead of OpenCV text.
import assert from 'node:assert/strict';
import { cropRect, hasWriting, arrowShaft, throughArrow, markGroups, components, readTicks, inkLayer, open2, cut, snapBox, readMovedTick, readCrop, MARGIN } from '../js/scan-crop.js';

const mask = (w, h) => ({ w, h, data: new Uint8Array(w * h) });
const box = (m, x0, y0, x1, y1) => { for (let y = Math.max(0, y0); y < Math.min(m.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(m.w, x1); x++) m.data[y * m.w + x] = 1; return m; };
const line = (m, ax, ay, bx, by, t = 3) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay)) * 2 + 1; for (let i = 0; i <= n; i++) { const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n; box(m, Math.round(x - t / 2), Math.round(y - t / 2), Math.round(x - t / 2) + t, Math.round(y - t / 2) + t); } return m; };
// a pen digit: a loop (0, 6, 8, 9) or a stroke with a foot (1, 7), about 22 x 36 px
const digit = (m, x, y, d) => {
  if ('0689'.includes(d)) { line(m, x, y, x + 20, y); line(m, x + 20, y, x + 20, y + 34); line(m, x + 20, y + 34, x, y + 34); line(m, x, y + 34, x, y); if (d !== '0') line(m, x, y + 17, x + 20, y + 17); }
  else if (d === '.') box(m, x + 2, y + 30, x + 7, y + 35);
  else { line(m, x, y, x + 20, y); line(m, x + 20, y, x + 6, y + 34); if ('35'.includes(d)) line(m, x + 2, y + 17, x + 18, y + 17); }
  return m;
};
const write = (m, x, y, s) => { [...s].forEach((d, i) => digit(m, x + i * 30, y, d)); return m; };
const W = m => [m.data, m.w, m.h];

// handwriting present or not: digits yes, a thin leftover line or a table edge no
const digits = write(mask(160, 80), 10, 20, '36.5');
assert.ok(hasWriting(...W(digits)), 'digits are writing');
assert.ok(!hasWriting(...W(box(mask(160, 80), 5, 40, 155, 42))), 'a thin line is not');
assert.ok(!hasWriting(...W(box(mask(160, 80), 3, 0, 5, 80))), 'a table edge is not');
assert.ok(!hasWriting(...W(box(mask(160, 80), 50, 40, 53, 43))), 'a speck is not');

// arrows: the shaft runs through the middle of the cell; a printed sliver sits at its edge
assert.ok(arrowShaft(...W(box(mask(106, 42), 52, 0, 55, 42))));
assert.ok(!arrowShaft(...W(box(mask(106, 42), 1, 0, 4, 42))), 'an edge sliver');
const short = box(mask(106, 42), 52, 10, 55, 22);
assert.ok(!arrowShaft(...W(short)), 'a short stroke');
const thru = box(box(mask(106, 42), 52, 1, 55, 41), 40, 18, 48, 24);   // shaft, and a stray tick beside it
assert.ok(throughArrow(...W(thru)) && !throughArrow(...W(digits)) && !throughArrow(...W(short)));
assert.ok(!throughArrow(...W(box(mask(106, 42), 45, 2, 59, 40))), 'a tall letter stroke 0.13 wide');
assert.ok(!throughArrow(...W(line(line(mask(106, 42), 50, 9, 56, 6), 56, 6, 56, 34))), 'a written 1');

// a crossed-out answer next to a new one is two marks; one letter is one; an edge leaking in is not a mark
const N = () => { const m = mask(106, 42); line(m, 42, 34, 42, 10); line(m, 42, 10, 62, 34); line(m, 62, 34, 62, 10); return m; };
assert.equal(markGroups(...W(N())), 1);
const yx = N(); line(yx, 12, 10, 20, 20); line(yx, 28, 10, 20, 20); line(yx, 20, 20, 20, 34); line(yx, 6, 30, 32, 8, 2);
assert.equal(markGroups(...W(yx)), 2);
assert.equal(markGroups(...W(box(N(), 0, 0, 9, 42))), 1);

// components: two blobs, 8-connected diagonals join
const cc = box(box(mask(20, 10), 1, 1, 4, 4), 4, 4, 6, 6);
assert.deepEqual(components(...W(cc)), [{ x: 1, y: 1, w: 5, h: 5, a: 13 }]);

// crop places: inside a table cell the crop is the cell less 3 px, grown 5 px; outside, around the field's text
const cells = [[100, 100, 300, 150], [100, 150, 300, 200], [0, 0, 1800, 2400]];
assert.deepEqual(cropRect([120, 160, 160, 190], cells, { w: 1800, h: 2400 }), { outer: [98, 148, 302, 202], inner: [103, 153, 297, 197] });
assert.deepEqual(cropRect([500, 500, 560, 530], cells, { w: 1800, h: 2400 }), { outer: [476, 472, 624, 558], inner: [480, 480, 620, 550] });
assert.deepEqual(cropRect([2, 2, 30, 20], [], { w: 100, h: 100 }), { outer: [0, 0, 94, 48], inner: [0, 0, 90, 40] }, 'clamped to the page');

// ticks (5 px strokes: what OpenCV draws for thickness 3): a slash running past the box corners, an empty box, a speck
const tk = line(mask(200, 200), 28, 70, 62, 36, 5); tk.data[150 * 200 + 150] = 1;
const r = readTicks(tk.data, 200, 200, [{ rect: [40, 40, 60, 60] }, { rect: [140, 140, 160, 160] }]);
assert.deepEqual(r.map(x => x.state), ['ticked', 'empty']);
// stacked boxes: a slash through the lower box whose tail runs up into the upper one; the middle tells them apart
const r2 = readTicks(line(mask(200, 200), 25, 112, 70, 52, 5).data, 200, 200, [{ rect: [40, 40, 60, 60] }, { rect: [40, 80, 60, 100] }]);
assert.ok(r2[1].center >= 0.6 && r2[0].center <= 0.15, JSON.stringify(r2));

// ink layer: printed lines (in the quarter-size template) are taken out, writing next to them stays
const pw = 400, ph = 200, tplQ = new Uint8Array(100 * 50).fill(255);
for (let x = 0; x < 100; x++) tplQ[25 * 100 + x] = 0;            // a printed line at page y 100-103
const dark = box(write(mask(pw, ph), 150, 30, '36'), 0, 100, pw, 103);
const ink = inkLayer(dark.data, pw, ph, tplQ);
const sum = a => a.reduce((s, v) => s + v, 0);
assert.equal(sum(cut(ink, pw, [0, 95, pw, 108]).data), 0, 'the printed line is gone');
assert.ok(hasWriting(...Object.values(cut(ink, pw, [140, 20, 220, 80])).slice(0, 3)), 'the writing is still there');
const speck = mask(10, 10); speck.data[55] = 1; box(speck, 2, 2, 5, 5);
assert.equal(sum(open2(speck.data, 10, 10)), 9, 'opening drops a one-pixel speck, keeps a 3x3 blob');
// a tick box printed 12 px lower than the template puts it (a bent page): snapped onto its print, so an empty box
// stays empty and a slashed one is still ticked; a box where the template says stays put
{
  const w = 400, h = 200, tq = new Uint8Array(100 * 50).fill(255), outline = (m, x0, y0) => { line(m, x0, y0, x0 + 24, y0, 2); line(m, x0 + 24, y0, x0 + 24, y0 + 24, 2); line(m, x0 + 24, y0 + 24, x0, y0 + 24, 2); line(m, x0, y0 + 24, x0, y0, 2); return m; };
  for (const bx of [60, 260]) for (let k = 0; k <= 6; k++) { const x = bx / 4 + k; tq[15 * 100 + x] = tq[21 * 100 + x] = tq[(15 + k) * 100 + bx / 4] = tq[(15 + k) * 100 + bx / 4 + 6] = 0; }   // the box in quarter px
  const d = mask(w, h); outline(d, 60, 72); outline(d, 260, 72); line(d, 262, 98, 286, 74, 5);
  const rect = bx => [bx - 4, 56, bx + 28, 88];
  const e = snapBox(d.data, w, h, rect(60), tq), t = snapBox(d.data, w, h, rect(260), tq);
  assert.ok(e.moved && Math.abs(e.dy - 12) <= 4 && Math.abs(e.dx) <= 4, JSON.stringify(e));
  assert.equal(readTicks(inkLayer(d.data, w, h, tq), w, h, [{ rect: rect(60) }])[0].state !== 'empty', true, 'unsnapped: the outline reads as ink');
  assert.equal(readMovedTick(d.data, w, h, tq, e, '0').state, 'empty');
  assert.equal(readMovedTick(d.data, w, h, tq, t, '1').state, 'ticked');
  const still = mask(w, h); outline(still, 60, 60);
  assert.equal(snapBox(still.data, w, h, rect(60), tq).moved, false, 'in place: not moved');
}
// the picture sent for reading: the cell plus MARGIN, the cell itself untouched, the margin faded towards white
{
  const w = 200, h = 160, g = new Uint8Array(w * h).fill(40), inner = [80, 60, 120, 100];
  const c = readCrop(g, w, h, inner);
  assert.deepEqual([c.w, c.h], [40 + 2 * MARGIN[0], 40 + 2 * MARGIN[1]], 'cell plus margin');
  assert.equal(c.data[(MARGIN[1] + 20) * c.w + MARGIN[0] + 20], 40, 'the cell is untouched');
  assert.equal(c.data[(MARGIN[1] - 2) * c.w + MARGIN[0] + 20], 40, 'and so are its lines (3 px past inner)');
  assert.ok(c.data[2 * c.w + 2] > 150, 'the margin is faded');
  assert.equal(g[0], 40, 'the page itself is not changed');
  const edge = readCrop(g, w, h, [5, 5, 30, 30]);
  assert.deepEqual([edge.w, edge.h], [30 + MARGIN[0], 30 + MARGIN[1]], 'clamped at the page edge');
}
console.log('scan-crop: ok');
