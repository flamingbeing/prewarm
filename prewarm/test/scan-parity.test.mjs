// Scan pages: the phone's alignment against the Python tools on made-up pages. node prewarm/test/scan-parity.test.mjs
// Fixtures (test/scan-parity/) come from `python3 prewarm/tools/scan/parity.py`: a made-up form, its form-map.json and
// quarter-size template from make-form-map.py, three phone-like photos of it (shifted, scaled, turned, rows drifting,
// uneven light), and per field the crop Python's align.py/scan.py gives and where it truly is on each photo.
// Pass: every crop corner within 3 px of the truth, and within 3 px of Python's or closer to the truth than Python's
// (Python's ECC is itself a few px off on the turned, drifting pages); a score no worse; the same retake verdict.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGrayPng } from './png-gray.mjs';
import { alignPage, mapPoint, RETAKE } from '../js/scan-align.js';

const D = new URL('./scan-parity/', import.meta.url), TOL = 3;
const fm = JSON.parse(readFileSync(new URL('form-map.json', D))), ex = JSON.parse(readFileSync(new URL('expected.json', D)));

// the form map: page size, quarter template, fields with crops, only the right types sent on
assert.deepEqual([fm.page.w, fm.page.h, fm.quarter], [1800, 2400, 4]);
const tpl = readGrayPng(new URL(fm.pages[0].template, D));
assert.deepEqual([tpl.w, tpl.h], [450, 600]);
assert.equal(fm.pages[0].tables.length, 2);
const byId = Object.fromEntries(fm.fields.map(f => [f.id, f]));
assert.equal(byId.demo_id.send, false, 'free text stays on the phone');
assert.ok(byId.demo_0_c0.send && byId.demo_time_0.send && byId.demo_tick.kind === 'tick');
for (const f of fm.fields) assert.ok(f.crop[2] > f.crop[0] && f.crop[3] > f.crop[1] && f.crop[0] >= 0 && f.crop[3] <= 2400, f.id);

const worst = [];
for (const pg of ex.pages) {
  const p = readGrayPng(new URL(pg.page, D));
  assert.deepEqual([p.w, p.h], [1800, 2400]);
  const r = alignPage(p.data, p.w, p.h, tpl.data, fm.pages[0].tables);
  let vsPy = 0, vsTruth = 0;
  for (const f of fm.fields) {
    const a = mapPoint(r.fit, f.crop[0], f.crop[1]), b = mapPoint(r.fit, f.crop[2], f.crop[3]), js = [a.x, a.y, b.x, b.y];
    js.forEach((v, i) => {
      const py = pg.crops[f.id][i], tr = pg.truth[f.id][i], dPy = Math.abs(v - py), dTr = Math.abs(v - tr), pyOff = Math.abs(py - tr);
      assert.ok(dTr <= TOL, `${pg.page} ${f.id}[${i}]: ${v.toFixed(1)} is ${dTr.toFixed(1)} px from the truth ${tr}`);
      assert.ok(dPy <= TOL || dTr < pyOff, `${pg.page} ${f.id}[${i}]: ${v.toFixed(1)} vs Python ${py}, truth ${tr}`);
      vsPy = Math.max(vsPy, dPy); vsTruth = Math.max(vsTruth, dTr);
    });
  }
  assert.ok(r.score >= pg.score - 0.05, `${pg.page}: score ${r.score} vs Python ${pg.score}`);
  assert.equal(r.score < RETAKE, pg.score < RETAKE, `${pg.page}: retake verdict`);
  assert.equal(r.fit.tables.length, pg.table_scores.length, `${pg.page}: refined tables`);
  worst.push(`${pg.page} score ${r.score.toFixed(3)} (Python ${pg.score}), worst ${vsTruth.toFixed(1)} px from truth, ${vsPy.toFixed(1)} from Python`);
}
console.log(worst.join('\n'));
console.log('scan-parity: ok');
