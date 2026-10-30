// Scan pages: what a reading can sensibly be, and the rules across a column of readings (no DOM; made-up values in
// tests). Ports of tools/scan/plausible.py (clean, allowed) and tools/scan/scan.py (point_order, arrow_gaps,
// fill_arrows, series_checks). Readings are flagged for the review screen, never fixed. A field is { id, type, opts,
// series, col, point }; a result is { value, flags: [], notes? } per field id.

// [field id pattern, low, high]; first match wins
export const RANGES = [
  [/^(prewarm|iotemp)_\w+_core$|^pacu_temp$/, 30, 42],
  [/^(prewarm|iotemp)_\w+_(chest|arm|thigh|calf)$/, 20, 42],   // skin runs cold in a cold theatre
  [/^(prewarm)_\w+_set$/, 30, 50],
  [/^iotemp_\w+_room$/, 15, 30],
  [/_ts$/, -3, 3],
  [/_sbp$/, 40, 260], [/_dbp$/, 20, 160], [/_map$/, 30, 200], [/_hr$/, 20, 220], [/_bis$/, 0, 100],
  [/^age$/, 16, 110], [/^wt$/, 30, 250], [/^ht$/, 120, 220], [/^bmi$/, 12, 70],
  [/^pre_hb$/, 3, 20], [/^pre_wbc$/, 0.5, 80], [/^pre_plt$/, 5, 1500], [/^pre_inr$/, 0.5, 10], [/^pacu_pain$/, 0, 10],
  [/^io_(rbc|plt|ffp|cryo)$/, 0, 50], [/^io_(rbc|plt|ffp|cryo)_ml$/, 0, 20000],
  [/^io_ebl$/, 0, 20000], [/^io_cs_(vol|ret)$/, 0, 10000], [/^io_pcc_dose$/, 0, 10000],
  [/^io_txa_(bolus|inf|total)$/, 0, 10000], [/^io_fib_dose$/, 0, 20],
];
export const JUMP = { core: 1.0, chest: 6.0, arm: 6.0, thigh: 6.0, calf: 6.0 };   // °C between neighbouring readings
export const ARROW = 'arrow or ditto: same as the reading above?';

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const toNum = s => { const t = String(s).trim(); return NUM.test(t) ? Number(t) : NaN; };

export function normaliseTemp(s) {
  const t = String(s).trim().replace(/,/g, '.');
  if (/^\d{3}$/.test(t) && int(t) / 10 >= 25 && int(t) / 10 <= 45) return String(int(t) / 10);
  return t;
}
const int = t => parseInt(t, 10);
const asPair = o => Array.isArray(o) ? o : [o, o];

// [value, problems] for the text read from a field of this type; value null when it can't be used
export function clean(f, text) {
  text = (text || '').trim().replace(/−/g, '-').replace(/–/g, '-');
  if (text === '') return [null, []];
  const kind = f.type;
  if (/^(arrow|ditto|same)/i.test(text)) return [null, [ARROW]];   // "same as above": only a person can place it
  if (kind === 'code' && f.opts && f.opts.length) {
    const opts = f.opts.map(asPair), keys = new Map(opts.map(([k]) => [String(k), k])), t = text.replace(/\+/g, '');
    if (keys.has(t)) return [keys.get(t), []];
    const letters = new Map();
    for (const [k, label] of opts) { const c = String(label).trim().slice(0, 1).toUpperCase(); letters.set(c, letters.has(c) ? null : k); }   // a letter shared by two options can't pick one
    const k = letters.get(text.toUpperCase());
    if (k !== undefined && k !== null) return [k, []];
    return [text, ['not one of: ' + opts.map(([, l]) => String(l)).join(', ')]];
  }
  if (kind === 'time') {
    const m = /^(\d{1,2})\s*[:.]?\s*(\d{2})$/.exec(text);
    if (!m || int(m[1]) > 23 || int(m[2]) > 59) return [text, ['not a 24-hour time']];
    return [`${String(int(m[1])).padStart(2, '0')}:${m[2]}`, []];
  }
  if (kind === 'num' || kind === 'int' || kind === 'code') {
    if (text.toUpperCase() === 'NA') return ['NA', []];
    const n = toNum(kind === 'num' ? normaliseTemp(text) : text);
    if (Number.isNaN(n)) return [text, ['not a number']];
    const whole = kind === 'int' || f.id.endsWith('_ts');
    if (whole && n !== Math.trunc(n)) return [text, ['should be a whole number']];
    const probs = [], r = RANGES.find(([pat]) => pat.test(f.id));
    if (r && !(r[1] <= n && n <= r[2])) probs.push(`outside ${r[1]}-${r[2]}`);
    return [whole ? Math.trunc(n) : n, probs];
  }
  return [text, []];
}

// a short plain statement of what a reading of this field can be (for whoever reads the crops)
export function allowed(f) {
  if (f.opts && f.opts.length) return 'one of: ' + f.opts.map(o => String(asPair(o)[1])).join(', ') + ' (usually just the letter or number)';
  if (f.type === 'time') return 'a 24-hour clock time, like 07:05';
  if (['num', 'int', 'code'].includes(f.type)) {
    const r = RANGES.find(([pat]) => pat.test(f.id));
    return r ? `a number from ${r[1]} to ${r[2]}` + (f.type === 'int' ? ' (whole)' : '') : 'a number';
  }
  return 'text';
}

// order of a series' timepoints: baseline first, then the minutes, end of surgery last
export const pointOrder = k => k === 'base' ? -1 : /^\d+$/.test(k) ? int(k) : 1e6;
const empty = v => v === null || v === undefined || v === '';
const byPoint = (a, b) => pointOrder(a[1]) - pointOrder(b[1]);

function columns(out, fields, keep) {
  const cols = new Map();
  for (const fid of Object.keys(out)) {
    const f = fields[fid]; if (!f || !keep(f)) continue;
    const k = f.series + '\u0000' + f.col; if (!cols.has(k)) cols.set(k, []); cols.get(k).push([fid, f.point]);
  }
  for (const pts of cols.values()) pts.sort(byPoint);   // stable, like Python's sort
  return cols;
}

// An empty cell between two 'same as above' arrows, or below one and above another reading in the same column, is
// probably covered by the arrow too: flag it instead of leaving it silently empty.
const ARROW_COLS = ['under', 'gown', 'room', 'core', 'chest', 'arm', 'thigh', 'calf'];
export function arrowGaps(out, fields) {
  for (const pts of columns(out, fields, f => f.series === 'iotemp' && ARROW_COLS.includes(f.col)).values()) {
    const state = pts.map(([fid]) => out[fid].flags.some(t => t.includes('arrow')) ? 'arrow' : !empty(out[fid].value) ? 'value' : 'empty');
    pts.forEach(([fid], i) => {
      if (state[i] !== 'empty' || out[fid].flags.length) return;
      let above = null, below = null;
      for (let j = i - 1; j >= 0; j--) if (state[j] !== 'empty') { above = state[j]; break; }
      for (let j = i + 1; j < pts.length; j++) if (state[j] !== 'empty') { below = state[j]; break; }
      if (above === 'arrow' && (below === 'arrow' || below === 'value')) out[fid].flags.push('empty between arrows: same as the reading above?');
    });
  }
}

// A 'same as above' arrow (or an empty cell the arrow runs through) repeats the reading above it in the same column:
// copy that value in and note it. An arrow with nothing above it stays flagged.
export function fillArrows(out, fields) {
  for (const pts of columns(out, fields, f => f.series && f.col).values()) {
    let last = null, doubtful = false;
    for (const [fid] of pts) {
      const e = out[fid], marks = e.flags.filter(t => t.includes('same as the reading above'));
      if (marks.length && empty(e.value) && last !== null) {
        e.value = last;
        e.flags = e.flags.filter(t => !marks.includes(t));
        (e.notes = e.notes || []).push('arrow: copied from the reading above');
        if (doubtful) e.flags.push('arrow: copied from a reading that needs checking');   // never pass a doubt down silently
      } else if (!empty(e.value)) { last = e.value; doubtful = e.flags.length > 0; }
    }
  }
}

// Things a pen can get wrong that a rule can spot: a temperature jumping, BP upside down.
export function seriesChecks(out, fields) {
  const by = new Map();
  for (const [fid, e] of Object.entries(out)) {
    const f = fields[fid];
    if (f && f.series && e.value !== null && e.value !== undefined && e.value !== 'NA' && f.col in JUMP) {
      const k = f.series + '\u0000' + f.col; if (!by.has(k)) by.set(k, { col: f.col, pts: [] }); by.get(k).pts.push([fid, f.point, e.value]);
    }
  }
  for (const { col, pts } of by.values()) {
    pts.sort(byPoint);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = toNum(pts[i][2]), b = toNum(pts[i + 1][2]);
      if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) > JUMP[col]) for (const k of [pts[i][0], pts[i + 1][0]]) out[k].flags.push(`jumps >${JUMP[col]} °C from the neighbouring reading`);
    }
  }
  for (const [fid, e] of Object.entries(out)) {
    if (!fid.endsWith('_sbp')) continue;
    const dk = fid.slice(0, -4) + '_dbp', d = out[dk];
    if (!d) continue;
    const s = toNum(e.value), dv = toNum(d.value);
    if (!Number.isNaN(s) && !Number.isNaN(dv) && s <= dv) for (const k of [fid, dk]) out[k].flags.push('systolic not above diastolic');
  }
}
