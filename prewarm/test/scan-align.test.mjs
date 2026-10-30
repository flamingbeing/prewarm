// Scan pages: lining the phone's page up with the form, on small made-up grids. node prewarm/test/scan-align.test.mjs
// The whole-page check against the Python tools is scan-parity.test.mjs.
import assert from 'node:assert/strict';
import { pool, dilateMask, flattenIllumination, hitGrid, lineScore, bestScaleShift, runs, matchLines, knotMap, refineTables, mapPoint, tableOk } from '../js/scan-align.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// pooling: min keeps a thin dark line, max keeps one lit pixel
const g = new Uint8Array(8 * 4).fill(255); for (let x = 0; x < 8; x++) g[1 * 8 + x] = 0;
assert.deepEqual([...pool(g, 8, 4, 4)], [0, 0]);
const m = new Uint8Array(16); m[5] = 1;
assert.deepEqual([...pool(m, 4, 4, 4, true)], [1]);
assert.equal(dilateMask(m, 4, 4, 1).reduce((s, v) => s + v, 0), 9);

// uneven light: a page dimmed to the right comes back to paper white, the ink stays dark
{
  const w = 400, h = 400, p = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = Math.round((x % 50 < 3 ? 60 : 240) * (1 - 0.4 * x / w));
  const f = flattenIllumination(p, w, h);
  near(f[200 * w + 380], 255, 12, 'dim paper is white again');
  assert.ok(f[200 * w + 350] < 120, 'a line in the dim part is still dark');
}

// line runs and matching printed lines to found ones under a small stretch and shift
assert.deepEqual(runs([0, 1, 1, 0, 0, 0, 0, 0, 1, 0], 0.5), [1.5, 8]);
{
  const tpl = [100, 200, 300, 400, 500], found = tpl.map(t => 1.02 * t + 14).filter((_, i) => i !== 2).concat([700]);
  const got = matchLines(tpl, found, 10);
  assert.deepEqual(Object.keys(got).map(Number), [0, 1, 3, 4], 'the missing line stays missing, the stray one is left out');
  near(got[4], 1.02 * 500 + 14, 0.01, 'line 4');
  assert.deepEqual(matchLines(tpl, [1, 2], 10), {}, 'too few lines found');
}
assert.equal(knotMap([[0, 10], [100, 130]], 50), 70);
assert.equal(knotMap([[0, 10], [100, 130]], -5), 5, 'before the first knot, its offset carries on');
assert.equal(knotMap([[0, 10], [100, 130]], 120), 150);

// profile slide: template sample u sees the photo at u - shift, so a bump 7 samples later on the photo is shift -7
{
  const n = 120, bump = c => Array.from({ length: n }, (_, i) => Math.exp(-((i - c) ** 2) / 20) + Math.exp(-((i - c - 30) ** 2) / 20));
  const best = bestScaleShift(bump(57), bump(50), [0.95, 1, 1.05], 20)[0];
  assert.deepEqual([best.scale, best.shift], [1, -7]);
}

// a table whose rows drift down the page: refined rows and columns put each printed line on the found one
{
  const w = 800, h = 800, xs = [100, 300, 500, 700], ys = Array.from({ length: 12 }, (_, i) => 100 + 50 * i);
  const drift = y => y + 0.02 * (y - 100) + 3, dark = new Uint8Array(w * h);
  for (const y of ys) for (let x = 100; x <= 702; x++) for (let t = 0; t < 2; t++) dark[(Math.round(drift(y)) + t) * w + x + 2] = 1;
  for (const x of xs) for (let y = 100; y <= drift(650) + 1; y++) for (let t = 0; t < 2; t++) dark[y * w + x + 2 + t] = 1;
  const ts = refineTables(dark, w, h, [{ bbox: [100, 100, 700, 650], xs, ys }]);
  assert.equal(ts.length, 1);
  const fit = { affine: [1, 0, 0, 0, 1, 0], tables: ts };
  for (const y of [150, 400, 600]) near(mapPoint(fit, 300, y).y, drift(y) + 0.5, 1.0, `row at ${y}`);
  near(mapPoint(fit, 500, 300).x, 502.5, 1.0, 'column');
  assert.deepEqual(mapPoint(fit, 10, 760), { x: 10, y: 760 }, 'outside the table the affine alone');
  assert.deepEqual(refineTables(new Uint8Array(w * h), w, h, [{ bbox: [100, 100, 700, 650], xs, ys }]), [], 'no lines, no table');
}

// line score: share of printed ink with page ink within 2 px
{
  const w = 80, h = 80, qw = 20, qh = 20, tplQ = new Uint8Array(qw * qh).fill(255);
  for (let x = 0; x < qw; x++) tplQ[5 * qw + x] = 0;               // printed line at page y 20-23
  const dark = new Uint8Array(w * h); for (let x = 0; x < 40; x++) dark[24 * w + x] = 1;   // half of it, a pixel low
  near(lineScore(hitGrid(dark, w, h), tplQ, qw, qh), 0.5, 0.06, 'half the line');
  assert.equal(lineScore(hitGrid(dark, w, h), tplQ, qw, qh, [0, 0, 40, 80]), 1);
}
assert.ok(tableOk(0.75, [0.9, 0.86]) && !tableOk(0.75, [0.9, 0.8]) && !tableOk(0.6, [0.95]) && !tableOk(0.95, []));
console.log('scan-align: ok');
