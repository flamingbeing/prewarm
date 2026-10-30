// Scan pages, read on the phone (phone-direct scan): one tidied page -> the de-identified cells to read, then the readings
// -> the scanImports document, in plain code (no DOM; made-up form and values in tests). Port of tools/scan/scan.py
// process_page (with the readings applied afterwards, since they come back from the Worker's /scan-api/read) and
// watch.py build_doc. The form map (fields, crop rects, tables, templates) is tools/scan/make-form-map.py's output.
// Only fields with send = true are ever cut out for reading (numbers, codes, times, below the page header): IDs, dates,
// names and free text stay on the phone, and the Worker refuses them anyway.
import { alignPage } from './scan-align.js';
import { inkLayer, cut, hasWriting, arrowShaft, throughArrow, markGroups, readTicks } from './scan-crop.js';
import { clean, fillArrows, seriesChecks, ARROW } from './scan-checks.js';

const TYPE_IN = 'type this in (not sent anywhere)';
const SEND = new Set(['num', 'int', 'code', 'time']);
const first = (v, n) => String(v).slice(0, n);

// One aligned page -> { score, check, retake, crops: [{ id, data, w, h }] (grey crops to read), out: { fid: entry } }.
// gray: the tidied page (w x h, normally 1800x2400); pg: form-map page; fields: that page's form-map fields; tplQ: its
// quarter-size template. Entries are { value, flags, page, box, marks? } like scan.py's (marks: pieces of ink, for opts).
export function planPage(gray, w, h, pg, fields, tplQ) {
  const r = alignPage(gray, w, h, tplQ, pg.tables || []);
  const ink = inkLayer(r.dark, w, h, tplQ), crops = [], out = {};
  for (const f of fields) {
    const e = { value: null, flags: [], page: f.page, box: f.box || null };
    if (f.kind === 'tick') {
      const res = Object.fromEntries(Object.entries(f.options).map(([o, rect]) => [o, readTicks(ink, w, h, [{ rect, label: o }])[0]]));
      let on = Object.keys(res).filter(o => res[o].state === 'ticked');
      const unsure = Object.keys(res).filter(o => res[o].state === 'unsure');
      e.flags = unsure.map(o => 'unsure tick: ' + o).concat(on.length > 1 ? ['more than one ticked'] : []);
      // two boxes with some ink (a slash running past its box): the one the slash crosses the middle of wins, flagged
      const crossed = Object.keys(res).filter(o => res[o].center >= 0.6);
      if (on.length + unsure.length > 1 && crossed.length === 1 && Object.keys(res).every(o => o === crossed[0] || res[o].center <= 0.15)) {
        on = crossed; e.flags = ['more than one box has ink: took the one the slash crosses the middle of, check'];
      }
      e.value = on.length === 1 ? on[0] : null;
      out[f.id] = e;
      continue;
    }
    if (!f.send && SEND.has(f.type)) continue;   // the page header (Subject ID, Date of Entry): never cut out
    const ci = cut(ink, w, f.inner), filled = hasWriting(ci.data, ci.w, ci.h);
    if (!f.send) { if (filled) e.flags.push(TYPE_IN); }
    else if (f.type !== 'text' && (filled ? throughArrow(ci.data, ci.w, ci.h) : arrowShaft(ci.data, ci.w, ci.h))) e.flags.push(ARROW);
    else if (filled) {
      const c = cut(r.gray, w, f.crop);
      crops.push({ id: f.id, data: c.data, w: c.w, h: c.h });
      if (f.opts && f.opts.length <= 3) e.marks = markGroups(ci.data, ci.w, ci.h);
    }
    out[f.id] = e;   // empty ones too: arrowGaps looks at the empty cells between arrows
  }
  return { score: Math.round(r.score * 1000) / 1000, check: r.check, retake: r.retake, crops, out };
}

// The Worker's two readings of a crop -> the entry's value and flags (scan.py process_page after read_cell).
export function applyRead(e, f, rd) {
  const reads = [rd.a, rd.b], vals = reads.map(x => clean(f, x.text));
  if (!reads.every(x => x.legible)) e.flags.push('hard to read');
  if (String(vals[0][0]) !== String(vals[1][0])) e.flags.push('two reads disagree');
  e.value = vals[0][0];
  e.flags.push(...[...new Set(vals.flatMap(v => v[1]))].sort());
  if (e.value === null && !reads.some(x => x.text.trim())) e.flags.push('ink in the cell but read as empty');
  if (f.opts && f.opts.length <= 3 && e.marks > 1) e.flags.push('two marks in the cell (one crossed out?)');
  return e;
}

// Every page's entries together -> the arrows filled and the series checked (scan.py main, after the pages).
export function finish(out, fieldsById) {
  fillArrows(out, fieldsById);
  seriesChecks(out, fieldsById);
  return out;
}

// -> the scanImports document (watch.py build_doc) plus who made it: via 'phone', by (the Firebase user id).
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$/;
export function importDoc({ scan, subject, pages, out, now, by }) {
  const fields = {};
  for (const [fid, e] of Object.entries(out)) {
    const flags = e.flags.map(x => first(x, 200)).slice(0, 10);
    if ((e.value === null || e.value === undefined || String(e.value) === '') && !flags.length) continue;
    fields[fid] = { v: e.value === null || e.value === undefined ? '' : first(e.value, 200), flags };
    if (Number.isInteger(e.page) && e.page >= 1 && e.page <= 14) fields[fid].page = e.page;
    if (e.box) fields[fid].box = e.box;
  }
  const doc = { scan, createdAt: now, status: 'pending', via: 'phone', by, pages: pages.map(p => ({ page: p.page, accepted: !p.retake, score: p.score })), fields };
  if (typeof subject === 'string' && SUBJECT.test(subject.trim())) doc.subject = subject.trim();
  return doc;
}
