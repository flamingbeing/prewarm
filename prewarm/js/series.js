// Readings series: which columns and timepoints are shown, when each is due and expected.
import { SERIES, WARM_MIN } from './schema.js';
import { val } from './store.js';
import { nowMin, settings, toMin } from './ui-core.js';
import { sealedBy } from './ui-alerts.js';


// Which columns of a series are shown (Settings hides some)
export function colsFor(s, pt) {
  const h = settings.hide;
  return SERIES[s].cols.filter(c => {
    if (h.skin && ['chest', 'arm', 'thigh', 'calf'].includes(c.key)) return false;
    if (h.set && c.key === 'set') return false;
    if (h.ts && c.key === 'ts') return false;
    if (h.warm && ['under', 'gown'].includes(c.key)) return false;
    if (h.room && c.key === 'room') return false;
    if (h.bis && c.key === 'bis') return false;
    return true;
  });
}
// a timepoint with a reading saved (a bare time doesn't count: a cleared or blank reading leaves one behind)
const hasData = (p, s, x) => Object.keys(p.f).some(k => k.startsWith(`${s}_${x.key}_`) && val(p, k) != null);
export function pointsFor(p, s) {
  let pts = SERIES[s].points;
  // read only (the section is marked complete, or data collection is): timepoints with no data are hidden, so no time is offered
  // for logging (owner, 13 Oct 2026); a series with no data at all keeps its list
  if (sealedBy(p, s)) { const seen = pts.filter(x => hasData(p, s, x)); if (seen.length) pts = seen; }
  if (s === 'haemo' && settings.hide.haemo15) return pts.filter(x => x.key === 'base' || val(p, 'at_haemo_' + x.key));
  // once pre-warming is complete (ticked, or its last reading saved), the later 5-min points (past the 10 / 30 min of warming) aren't taken (owner, 13 Oct 2026)
  if (s === 'prewarm' && WARM_MIN[val(p, 'arm')] && (val(p, 'sign_prewarm') || val(p, 'at_prewarm_' + WARM_MIN[val(p, 'arm')]))) return pts.filter(x => x.min == null || x.min <= WARM_MIN[val(p, 'arm')] || hasData(p, s, x));
  return pts;
}
// due time (minutes after midnight) of a timepoint, from the reference event
export function dueOf(p, s, pt) {
  const ref = refOf(p, s);
  // intra-op baseline is due on arrival in OT, the end-of-surgery reading at surgery end (same day as the start)
  if (s !== 'prewarm' && (pt.key === 'base' || pt.key === 'end')) {
    const t = toMin(val(p, pt.key === 'base' ? 'ev_ot' : 'io_done'));
    return t == null || ref == null ? t : t + 1440 * Math.round((ref - t) / 1440);
  }
  if (pt.min == null) return null;
  return ref == null ? null : ref + pt.min;
}
// usual ranges for typed readings: outside them, Save asks first
export const SANE = { sbp: [40, 260], dbp: [20, 160], map: [30, 200], hr: [20, 220], bis: [0, 100], room: [10, 40] };
const refOf = (p, s) => SERIES[s].ref.map(id => toMin(val(p, id))).find(x => x != null) ?? null;
// the clock counted from the same day as the series' start, so a case running past midnight still compares right
export function nowFor(p, s) {
  const n = nowMin(), r = refOf(p, s);
  return r == null ? n : n + 1440 * Math.round((r - n) / 1440);
}
// readings due after that stage ended (into OT for pre-warming, surgery end for intra-op) aren't expected
// the End reading, once saved, is the last temperature: nothing later is due, even if Surgery end wasn't logged (owner, 20 Oct 2026)
export function expected(p, s, due) {
  let end = toMin(val(p, s === 'prewarm' ? 'ev_ot' : 'io_done'));
  if (end == null && s === 'iotemp') end = toMin(savedAt(p, s, 'end'));
  const r = refOf(p, s);
  if (end == null || r == null) return true;
  while (end < r) end += 1440;
  return due <= end;
}
export const savedAt = (p, s, key) => val(p, `at_${s}_${key}`);
export const noWarming = p => String(val(p, 'arm')) === '3';
// gown set temp is NA for the no-pre-warming group and once active warming has stopped
export function setTempNA(p, pt) {
  if (noWarming(p)) return true;
  const stop = toMin(val(p, 'ev_wstop')), due = dueOf(p, 'prewarm', pt);
  return stop != null && due != null && due > stop;
}
