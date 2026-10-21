// Where each field sits on the paper form, found by asking the app's own Form view: fill ONE field at a time into the
// blank form (js/wordform.js), render, and see which printed characters appeared. No hand-made coordinates.
//   node locate.mjs <blank.docx> <outdir>     writes outdir/v*.docx, variants.json and fields.json
// then:  python3 locate.py <outdir>           renders them and writes fieldmap.json (keep it out of git: it comes from the form)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { FIELDS, EXTRA, BY_ID, EXTRA_BY_ID } from '../../js/schema.js';
import { fillForm } from '../../js/wordform.js';
const JSZip = createRequire(import.meta.url)('../../js/vendor/jszip.min.js');
const [blank, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const zip = await JSZip.loadAsync(readFileSync(blank));
const xml = await zip.file('word/document.xml').async('string');
const fieldOf = id => BY_ID[id] || EXTRA_BY_ID[id];
// some fields list their options as plain strings (io_tech, site): make every option a [value, label] pair
const all = [...FIELDS, ...EXTRA].filter(f => f.type !== 'rows').map(f => f.opts ? { ...f, opts: f.opts.map(o => Array.isArray(o) ? o : [o, o]) } : f);

// what must be set for a field to show on the form: its parents' answers, and a pre-warming arm
function prereqs(f, acc = {}) {
  if (f.show) { const p = fieldOf(f.show.f); acc[f.show.f] = f.show.in[0]; if (p) prereqs(p, acc); }
  return acc;
}
const sentinel = f => f.type === 'time' ? '07:05' : f.type === 'date' ? '2026-10-14' : f.type === 'text' || f.type === 'word' ? 'XX' : '88';
const rec = f => ({ id: 'x', created: 0, f: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { v, t: 1 }])) });

const variants = []; const bases = new Map(); let n = 0;
const filled = values => fillForm(xml, rec(values)).xml;
const write = async (name, docXml) => { zip.file('word/document.xml', docXml); writeFileSync(`${out}/${name}.docx`, await zip.generateAsync({ type: 'nodebuffer' })); };
const unplaced = [];
for (const f of all) {
  const pre = prereqs(f); const bk = JSON.stringify(pre);
  if (!bases.has(bk)) { bases.set(bk, 'b' + bases.size); bases.set(bk + 'xml', filled(pre)); await write(bases.get(bk), bases.get(bk + 'xml')); }
  const tries = f.opts ? f.opts.map(([v]) => ({ option: String(v), value: v })) : [{ value: sentinel(f) }];
  for (const t of tries) {
    const x = filled({ ...pre, [f.id]: t.value });
    if (x === bases.get(bk + 'xml')) { unplaced.push(f.id + (t.option ? ':' + t.option : '')); continue; }  // the form has no place for it
    const name = 'v' + String(++n).padStart(5, '0');
    await write(name, x);
    variants.push({ name, base: bases.get(bk), field: f.id, option: t.option });
  }
}
writeFileSync(`${out}/variants.json`, JSON.stringify({ variants, unplaced }));
writeFileSync(`${out}/fields.json`, JSON.stringify(all.map(({ id, label, type, unit, opts, page, show, series, point, col }) => ({ id, label, type, unit, opts, page, show, series, point, col }))));
console.log(`${all.length} fields, ${variants.length} variants, ${[...bases.keys()].filter(k => !k.endsWith("xml")).length} baselines, ${unplaced.length} with no place on the form in ${out}`);
