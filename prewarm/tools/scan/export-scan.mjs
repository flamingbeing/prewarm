// Reviewed scans -> the study workbook, through the app's own export (same 572 columns, same formats).
//   node export-scan.mjs <out.xlsx> <patient1.reviewed.json> [patient2.reviewed.json ...]
// Each reviewed.json is one patient: { "fields": { "<field id>": "<value>" } } as saved by review.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { BY_ID, EXTRA_BY_ID } from '../../js/schema.js';
import { newRecord, setVal } from '../../js/store.js';
import { workbook } from '../../js/export.js';

// a reviewed value as the app stores it: numbers as numbers, option codes as their code, blanks left out
export function toValue(f, v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if ((f.type === 'num' || f.type === 'int' || f.type === 'code') && s.toUpperCase() !== 'NA' && s !== '' && Number.isFinite(Number(s))) return Number(s);
  if (f.opts && f.type === 'code') { const o = f.opts.find(([k]) => String(k) === s); return o ? o[0] : s; }
  return s;
}

export function recordFrom(reviewed, by = 'scan') {
  const rec = newRecord(0);
  const skipped = [];
  for (const [id, v] of Object.entries(reviewed.fields || {})) {
    const f = BY_ID[id] || EXTRA_BY_ID[id];
    if (!f) { skipped.push(id); continue; }
    const x = toValue(f, v);
    if (x != null) setVal(rec, id, x, by, 1);
  }
  rec.skipped = skipped;
  return rec;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) { console.error('usage: node export-scan.mjs out.xlsx patient.reviewed.json ...'); process.exit(2); }
  const recs = files.map(f => recordFrom(JSON.parse(readFileSync(f, 'utf8'))));
  writeFileSync(out, workbook(recs, []));
  for (const r of recs) if (r.skipped.length) console.warn('not in the schema, left out:', r.skipped.join(', '));
  console.log(`${recs.length} patient(s) written to ${out}`);
}
