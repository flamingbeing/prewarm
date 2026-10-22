// The patient screen: key event times, temperatures and readings, the top bar's timer and Log button.
import { SERIES, BY_ID, calc, normaliseTemp, isShown, WARM_MIN } from './schema.js';
import { setVal, val, isGone } from './store.js';
import { openKeypad } from './keypad.js';
import { $, GROUPS, NS, askTime, cleanup, esc, field, fitNums, fromMin, go, header, hooks, lockTaps, nowHM, paint, patients, read, render, route, saveAll, setLeaveGuard, settings, sid, sidL, toMin, toast, view, write } from './ui-core.js';
import { failed, pending, refreshNow, set, sharing, sync, syncText } from './ui-sync.js';
import { SANE, colsFor, dueOf, expected, noWarming, nowFor, pointsFor, savedAt, setTempNA } from './series.js';
import { declined } from './ui-home.js';
import { INTRAOP_Q, PACU_Q, disableSealed, doneHtml, gaps, gapsHtml, haemoState, sealNote, sealedBy, sealedMsg, signoffClick, signoffHtml, startAlerts, vitalsCollected } from './ui-alerts.js';
import { DATA_PARTS } from './ui-data.js';
import { resetSubject } from './ui-forms.js';

// ---------- patient main screen: event times, temperatures, then links to the other forms in the order they are
// filled in. BP/HR/BIS uses the same reading screen without the times.
export const EVENTS = [['pw_gown', 'Gown on'], ['pw_start', 'Prewarm on', 'pw'], ['ev_wstop', 'Prewarm off', 'pw'], ['ev_ot', 'In OT'],
  ['io_knife', 'Induction'], ['io_flip', 'Prone'], ['io_under_start', 'Under­body warm'], ['io_gown_start', 'Gown warm'],
  ['io_done', 'Surgery end'], ['pacu_in', 'PACU in'], ['pacu_out', 'To ward']];
// the gown and Bair Hugger times, coloured warm (owner, 12 Oct 2026)
const WARM_EVENTS = new Set(['pw_gown', 'pw_start', 'ev_wstop', 'io_under_start', 'io_gown_start']);
export const EVENT_FULL = { pw_gown: 'Gown on', ev_ot: 'In OT', pacu_in: 'PACU arrival', io_flip: 'Flipped prone', pw_start: 'Active warming started', ev_wstop: 'Active warming stopped', io_knife: 'Induction', io_under_start: 'Underbody Bair Hugger on',
  io_gown_start: 'Gown Bair Hugger on', io_done: 'Surgery completed (post-extubation)', pacu_out: 'Transfer to ward' };
// Running timer and the next event to note, in the app bar of the patient screen
// PACU in / To ward are logged on the PACU page (owner, 13 Oct 2026), so they are not in the key-times row or the Log button
export const ESSENTIAL = ['pw_gown', 'pw_start', 'ev_wstop', 'ev_ot', 'io_knife', 'io_done'];
export const PACU_TIMES = ['pacu_in', 'pacu_out'];
export const mmss = m => { const sec = Math.max(0, Math.floor(m * 60)), h = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
// top bar: a countdown to the next thing to log: the next reading due on this screen, or warming off, whichever comes first
// (the "Time now" clock was removed 20 Oct 2026 at the owner's request)
function clockHtml(p, s) {
  const n = nextDue(p, s);
  let next = '';
  if (n) {
    const left = n.left, st = left > 2 ? 'later' : left > 0 ? 'soon' : left > -5 ? 'now' : 'late';
    next = `<div class="next" role="button" tabindex="0" aria-label="${esc(n.label)}: open it" data-state="${st}"><small>${esc(n.label)}</small><b>${left > 0 ? 'in ' + mmss(left) : left > -5 ? 'now' : 'late ' + mmss(-left)}</b></div>`;
  }
  return next;
}
export function nextDue(p, s) {
  const all = [], mine = duePick(p, s);
  if (mine) all.push(mine);
  // the other tab's reading once it is due and this tab's isn't (a temperature due now shows on the Others tab too)
  const other = duePick(p, s === 'haemo' ? defaultSeries(p) : 'haemo');
  if (other && other.left <= 0 && !(mine?.left <= 0)) all.push(other);
  const nx = nextEvent(p);
  if (nx?.due != null) all.push({ label: nx.label, left: nx.due - nowFor(p, 'prewarm'), target: { pid: p.id, ev: nx.id } });
  return all.sort((a, b) => a.left - b.left)[0] || null;
}
// the reading due most recently (until the next one is due), else the next one coming up
function duePick(p, s) {
  if (sealedBy(p, s) || (s === 'prewarm' && noWarming(p))) return null; // marked complete, or no pre-warming: nothing is asked for
  const now = nowFor(p, s);
  const timed = pointsFor(p, s).map(x => ({ x, due: dueOf(p, s, x) })).filter(t => t.due != null && expected(p, s, t.due)).sort((a, b) => a.due - b.due);
  const cur = timed.filter(t => t.due <= now).pop(), up = timed.find(t => t.due > now && !savedAt(p, s, t.x.key));
  const pick = cur && !savedAt(p, s, cur.x.key) ? cur : up;
  return pick ? { label: (s === 'haemo' ? 'BP ' : 'Temp ') + pick.x.label, left: pick.due - now, target: { pid: p.id, s, key: pick.x.key } } : null;
}
// the next event to note: the first unset one after the last one set (warming off: when it is expected)
export function nextEvent(p) {
  const evs = ESSENTIAL.filter(id => !(noWarming(p) && (id === 'pw_start' || id === 'ev_wstop')));
  const last = evs.reduce((i, id, j) => val(p, id) ? j : i, -1);
  const id = evs.slice(last + 1).find(x => !val(p, x));
  if (!id) return null;
  const label = EVENTS.find(([f]) => f === id)[1].replace('\u00ad', '');
  const due = id === 'ev_wstop' && toMin(val(p, 'pw_start')) != null && WARM_MIN[val(p, 'arm')] ? toMin(val(p, 'pw_start')) + WARM_MIN[val(p, 'arm')] : null;
  return { id, label, due };
}
const evLabel = id => EVENTS.find(([f]) => f === id)[1].replace('\u00ad', '');
// the key times before this one that are still empty (none for times outside the key sequence)
function skippedBefore(p, id) {
  const evs = ESSENTIAL.filter(x => !(noWarming(p) && (x === 'pw_start' || x === 'ev_wstop')));
  const i = evs.indexOf(id);
  return i < 0 ? [] : evs.slice(0, i).filter(x => !val(p, x)).map(evLabel);
}
// app-bar sync status (owner, 13 Oct 2026, instead of the Log shortcut): Synced / N waiting / Offline / Phone only; a tap runs Refresh now
function syncChipState() {
  if (!sharing()) return ['Local', 'this phone', 'local', 'Data stays on this phone: not shared with a team'];
  const n = Object.keys(pending).map(id => patients[id]).filter(p => p && !isGone(p)).length;
  const bad = Object.keys(failed).map(id => patients[id]).filter(p => p && !isGone(p));
  if (bad.length) return [`${bad.length} not saved`, 'tap for why', 'bad', bad.map(p => `${sid(p)}: ${failed[p.id]}`).join('; ')];
  if (n) return [`${n} waiting`, 'to send', 'wait', `${n} patient${n === 1 ? '' : 's'} not sent to the team yet`];
  if (!navigator.onLine) return ['Offline', 'no signal', 'wait', 'No signal: changes send when it returns'];
  return ['Synced', 'with team', 'ok', syncText()];
}
export function paintSyncChip() {
  const el = $('#syncchip'); if (!el) return;
  const [t, sub, st, tip] = syncChipState(), h = `<b>${esc(t)}</b><small>${esc(sub)}</small>`;
  if (el.innerHTML !== h) el.innerHTML = h;
  el.dataset.state = st; el.title = tip; el.setAttribute('aria-label', `Sync status: ${t}, ${sub}. Tap to refresh.`);
}
// The patient screens' top bar (main screen, BP / HR / BIS, intra-op details, PACU): running timer, next event and
// its sync status chip. Returns a function that redraws it; it also ticks every second while the screen is open.
export function topBar(p, s, onLog) {
  $('#extra').innerHTML = `<div class="clock" id="clock">${clockHtml(p, s)}</div><button class="logbtn syncchip" id="syncchip"></button>`;
  paintSyncChip();
  const refresh = () => {
    const ck = $('#clock'); if (ck) ck.innerHTML = clockHtml(p, s);
    paintSyncChip();
  };
  // the countdown opens what it counts down to: that reading's first box, or the key time's pad
  const ckGo = () => { const n = nextDue(p, s); if (n?.target) openTarget(n.target); };
  $('#clock').onclick = e => { if (e.target.closest('.next')) ckGo(); };
  $('#clock').onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.next')) { e.preventDefault(); ckGo(); } };
  $('#syncchip').onclick = e => { const [, , st, why] = syncChipState(); if (st === 'bad') toast(`Not saved to the team: ${why}`); refreshNow(e.currentTarget); };
  const iv = setInterval(refresh, 1000);
  cleanup.push(() => clearInterval(iv));
  // patients opened here today get due alerts on every screen (kept a day)
  write('opened', Object.fromEntries([...Object.entries(read('opened', {})).filter(([, t]) => Date.now() - t < 864e5), [p.id, Date.now()]]));
  startAlerts(p);
  return refresh;
}
let pendingOpen = null, openHere = null;
// go to a reading (or a key time) and open its pad: the screen is reached first, then the pad opens on it
// an alarm banner only goes to the screen (pad = false); the top-bar countdown also opens the pad
function openTarget(t, pad = true) {
  const hash = t.ev || !t.s ? `#/p/${t.pid}` : `#/p/${t.pid}/${t.s}/${t.key}`;
  if (!pad) { if (location.hash !== hash && !openHere?.(t, true)) go(hash); return; }
  if (openHere?.(t) === true) return;
  pendingOpen = { ...t, at: Date.now() };
  if (location.hash === hash) render(); else go(hash);
}
// patient comfort (owner, 20 Oct 2026): the before-surgery question sits on the Induction room tab, the after-surgery one
// on the PACU page; one line once answered
const COMFORT = BY_ID.sat_pre.opts;
// consent (owner, 21 Oct 2026): first on the Induction room tab, same look as comfort; Declined on the left, Consented on
// the right, in short words (the export keeps the code)
const CONSENT = [[0, 'Declined to participate'], [1, 'Consented, copy given']];
let satEdit = null;
// roomy (PACU, owner 21 Oct 2026): two answers per row, Neutral alone, so the words never split; the Induction room tab keeps one row
export function comfortHtml(p, id, label, roomy = false, aside = '') {
  const v = val(p, id), opts = id === 'consent_st' ? CONSENT : COMFORT;
  if (v != null && satEdit !== id) {
    return `<div class="comfort done"><span>${label}: <b>${esc(opts.find(o => String(o[0]) === String(v))?.[1] || v)}</b></span><button class="link" data-satedit="${id}">Change</button><button class="link" data-satclear="${id}">Clear</button></div>`;
  }
  // one row, short words, so Save stays on screen on a phone; the full wording shows once answered
  if (opts === CONSENT) return `<div class="comfort consent"><span class="lab">${label}</span>
    ${opts.map(([ov, ol]) => `<button class="chip" data-sat="${id}" data-v="${ov}" aria-pressed="${String(v) === String(ov)}">${String(ov) === '0' ? 'Declined' : ol}</button>`).join('')}</div>`;
  return `<div class="comfort"><span class="lab">${label}${aside || '<small>ask the patient</small>'}</span>
    <div class="seg comfort5${roomy ? ' roomy' : ''}">${COMFORT.map(([ov, ol]) => `<button class="chip" data-sat="${id}" data-v="${ov}" aria-pressed="${String(v) === String(ov)}">${roomy ? ol : ol.replace('omfortable', 'omfort&shy;able')}</button>`).join('')}</div></div>`;
}
// the top of the Induction room tab, one card tall so Save stays on screen: consent first; once consented, the
// before-surgery comfort question with the consent answer on its label line; a declined patient is asked nothing more
// The Email and PayNow button sits under consent (owner, 21 Oct 2026; it was at the bottom of the tab), once comfort is
// answered too: a payment is for participants only, and earlier it would push Save off a phone screen
function inductionAsks(p) {
  const c = val(p, 'consent_st');
  if (c == null || satEdit === 'consent_st' || declined(p)) return comfortHtml(p, 'consent_st', 'Consent');
  if (val(p, 'sat_pre') == null || satEdit === 'sat_pre') return comfortHtml(p, 'sat_pre', 'Comfortable before surgery?', false,
    `<span class="consentok">✓ Consented <button class="link" data-satedit="consent_st">Change</button></span>`);
  return comfortHtml(p, 'consent_st', 'Consent') + payButton(p) + comfortHtml(p, 'sat_pre', 'Comfortable before surgery?');
}
// the Email and PayNow page's button (owner, 21 Oct 2026): says whether they were saved, never what they are
function payButton(p) {
  const saved = p.f.pay_saved, cleared = p.f.pay_cleared;
  const st = cleared ? '✓ Paid, deleted' : saved ? `✓ Saved${saved.by ? ' by ' + esc(saved.by) : ''}` : 'for the payment';
  return `<a class="paybtn" href="#/p/${p.id}/pay"><span>Email and PayNow</span><small>${st}</small></a>`;
}
// true when the tap was a comfort answer, Change or Clear
export function comfortTap(p, t, draw, put = (k, v) => set(p, k, v)) {
  const sat = t.closest('[data-sat]');
  // an answer can be changed, not cleared by tapping it again; the row collapses, so taps pause a moment
  if (sat) { put(sat.dataset.sat, +sat.dataset.v); satEdit = null; draw(); lockTaps(); return true; }
  const sc = t.closest('[data-satclear]');
  if (sc) { if (confirm(sc.dataset.satclear === 'consent_st' ? 'Clear the consent answer?' : 'Clear this comfort answer?')) { put(sc.dataset.satclear, null); satEdit = null; draw(); } return true; }
  const se = t.closest('[data-satedit]');
  if (se) { satEdit = se.dataset.satedit; draw(); return true; }
  return false;
}
const TS_SCALE = [[3, 'hot', 'intolerably warm'], [2, 'warm', 'too warm'], [1, 'slightly warm', 'tolerably uncomfortable, warm'],
  [0, 'neutral', 'comfortable'], [-1, 'slightly cool', 'tolerably uncomfortable, cool'], [-2, 'cool', 'too cool'], [-3, 'cold', 'intolerably cool']];
// every group opens on the Induction room tab until the patient is in OT (owner, 21 Oct 2026: consent is asked there)
export const defaultSeries = p => val(p, 'ev_ot') || val(p, 'io_knife') ? 'iotemp' : 'prewarm';
route(/^\/p\/(\w+)(?:\/(?:read\/)?(prewarm|iotemp|haemo)(?:\/(\w+))?)?$/, (id, s, key) => {
  const p = patients[id]; if (!p) return go('#/');
  // the no-pre-warming group keeps the Induction room tab, which says so and asks consent and the before-surgery comfort
  // question (owner, 12, 20 and 21 Oct 2026); the tab was Pre-warming until 21 Oct 2026
  if (!s) s = defaultSeries(p);
  const noPw = s === 'prewarm' && noWarming(p);
  const sealed = () => sealedBy(p, noPw ? null : s);
  const main = s !== 'haemo';
  const def = SERIES[s], pts = pointsFor(p, s);
  header(sidL(p), '#/');
  // two tabs under the bar (owner, 12 Oct 2026): temperatures, and BP / HR / BIS with the other forms; each warms up
  // and pulses as its next reading falls due
  // key times fill the top of the screen on both tabs; the tab bar sits under them (owner, 12 Oct 2026)
  const ptabsHtml = () => `<nav class="ptabs" role="tablist" aria-label="Readings"><a role="tab" id="templink" href="#/p/${id}" aria-selected="${main}" data-state="${haemoState(p, defaultSeries(p))}">Temperatures</a>`
    + `<a role="tab" id="haemolink" href="#/p/${id}/haemo" aria-selected="${!main}" data-state="${haemoState(p)}">BP, HR, BIS</a></nav>`;
  const refreshBar = topBar(p, s, () => draw());
  // swipe left / right to change tab (owner, 12 Oct 2026); not from the timepoint strip or a box being typed in
  let sw = null;
  const swStart = e => { const t = e.touches[0]; sw = e.touches.length === 1 && e.target.closest('.third.mid') && !e.target.closest('.strip, input, .tchip.edit') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null; };
  const swEnd = e => {
    if (!sw) return;
    const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, quick = Date.now() - sw.at < 700;
    sw = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx < 0 && main) go(`#/p/${id}/haemo`);
    else if (dx > 0 && !main) go('#/p/' + id);
  };
  view.addEventListener('touchstart', swStart, { passive: true });
  view.addEventListener('touchend', swEnd, { passive: true });
  cleanup.push(() => { view.removeEventListener('touchstart', swStart); view.removeEventListener('touchend', swEnd); });
  let alive = true; cleanup.push(() => { alive = false; });
  let typing = null; // the BP / HR / BIS box with the keyboard up
  // default timepoint: the one due most recently while unsaved (until the next is due), else the next one coming up,
  // else the first unsaved (the nearest-due rule opened the next timepoint once a reading was 2.5 min late)
  if (!key) {
    const open = pts.filter(x => !savedAt(p, s, x.key));
    const now = nowFor(p, s);
    const timed = pts.map(x => ({ x, d: dueOf(p, s, x) })).filter(t => t.d != null && expected(p, s, t.d)).sort((a, b) => a.d - b.d);
    const cur = timed.filter(t => t.d <= now).pop();
    const pick = cur && !savedAt(p, s, cur.x.key) ? cur.x : timed.find(t => t.d > now && !savedAt(p, s, t.x.key))?.x;
    key = (pick || open[0] || pts[pts.length - 1]).key;
  }
  // a timepoint hidden because the section is read only and it has no data: open the default one instead
  if (!pts.some(x => x.key === key)) key = (pts.find(x => !savedAt(p, s, x.key)) || pts[pts.length - 1]).key;
  const pt = def.points.find(x => x.key === key) || pts[0];
  const idx = def.points.indexOf(pt);
  const cols = colsFor(s, pt);
  // draft: this timepoint's saved values, else carried over from the last saved timepoint
  const prev = def.points.slice(0, idx).reverse().find(x => savedAt(p, s, x.key));
  const draft = {}, was = {};
  const touched = new Set(); // boxes the user set or confirmed on this screen (even to the carried-over value)
  // the first intra-op reading starts from the last pre-warming one (owner, 13 Oct 2026)
  const prevPw = !prev && s === 'iotemp' ? [...SERIES.prewarm.points].reverse().find(x => savedAt(p, 'prewarm', x.key)) : null;
  for (const c of cols) {
    const mine = val(p, `${s}_${pt.key}_${c.key}`);
    was[c.key] = prev ? val(p, `${s}_${prev.key}_${c.key}`) : prevPw && c.temp ? val(p, `prewarm_${prevPw.key}_${c.key}`) : null;
    draft[c.key] = mine ?? was[c.key];
  }
  let setTouched = false; // gown set temp follows "warming off" until someone picks a value
  const warmTouched = new Set(); // underbody / gown warming follow their logged start time until someone picks
  const isSaved = !!savedAt(p, s, pt.key);
  // when each box was last changed as the screen opened: a later change came from the other phone
  const openT = Object.fromEntries(cols.map(c => [c.key, p.f[`${s}_${pt.key}_${c.key}`]?.t || 0]));
  // what's on screen when it opens; anything changed from that is asked about before leaving
  const snap = () => JSON.stringify(cols.map(c => draft[c.key] == null ? null : String(draft[c.key])));
  let base = null;
  // an unsaved reading is also kept on the phone as it's typed: if the phone closes the app (another app opened, low
  // memory, flat battery), it comes back when the reading is opened again, unless the reading was saved since
  const DKEY = `unsaved:${p.id}:${s}:${pt.key}`;
  const dropDraft = () => { try { localStorage.removeItem(NS + DKEY); } catch { /* fine */ } };
  const keep = () => {
    if (base == null || p.lock?.on) return;
    const d = { ...draft };
    // a temperature still being typed counts too
    const open = view.querySelector('input.num[data-k]');
    if (open) { const k = open.dataset.k, v = cols.find(c => c.key === k)?.temp ? normaliseTemp(open.value) : open.value.trim(); d[k] = v === '' ? null : v; }
    if (JSON.stringify(cols.map(c => d[c.key] == null ? null : String(d[c.key]))) === base) dropDraft();
    else write(DKEY, { t: Date.now(), v: d });
  };
  const kept = read(DKEY, null);
  let restored = false;
  if (kept && !p.lock?.on && Date.now() - kept.t < 12 * 3600e3 && cols.every(c => openT[c.key] <= kept.t)) {
    base = snap();
    for (const c of cols) if (c.key in kept.v) { draft[c.key] = kept.v[c.key]; if (String(kept.v[c.key]) !== String(was[c.key])) touched.add(c.key); }
    // the restored set temp / warming answers stay as they were (not recalculated)
    setTouched = true; warmTouched.add('under'); warmTouched.add('gown');
    restored = snap() !== base;
    if (!restored) dropDraft();
  } else if (kept) dropDraft();
  const hide = () => { if (document.visibilityState === 'hidden') keep(); };
  document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', keep);
  cleanup.push(() => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', keep); });
  setLeaveGuard(() => !p.lock?.on && base != null && snap() !== base ? { what: pt.label + ' reading', save: commit, drop: dropDraft } : null);
  // Save leaves out carried-over measurements (owner, 14 Oct 2026: "stopped on save"): a grey temperature or BP, HR, BIS
  // that nobody touched is only a default, so it is never stored as a new reading. The set temp, warming Yes / No and room
  // temp still carry. Cancelled saves put the defaults back.
  function commit() {
    const dropped = {};
    for (const c of cols) if ((c.temp || s === 'haemo') && isDefault(c.key)) { dropped[c.key] = draft[c.key]; draft[c.key] = null; }
    const ok = commitNow();
    if (!ok) Object.assign(draft, dropped);
    return ok;
  }
  function commitNow() {
    if (sealed()) { toast(sealedMsg(p, s)); return false; }
    if (p.lock?.on) { toast('Locked: read only. Unlock it on the home page to change it.'); return false; }
    const bad = cols.filter(c => c.temp && draft[c.key] != null && (+draft[c.key] < 25 || +draft[c.key] > 45 || Number.isNaN(+draft[c.key])));
    if (bad.length) { toast('Check ' + bad.map(c => c.label).join(', ') + ': temperatures should be 25–45 °C.'); return false; }
    // BP, HR, BIS and room temp: numbers only; unusual ones are asked about, not refused
    const typed = cols.filter(c => SANE[c.key] && draft[c.key] != null);
    const nan = typed.filter(c => !/^\d+(\.\d)?$/.test(String(draft[c.key])));
    if (nan.length) { toast('Check ' + nan.map(c => c.label).join(', ') + ': numbers only.'); return false; }
    const odd = typed.filter(c => +draft[c.key] < SANE[c.key][0] || +draft[c.key] > SANE[c.key][1]);
    if (odd.length && !confirm(odd.map(c => `${c.label} ${draft[c.key]}`).join(', ') + ' looks unusual. Save anyway?')) return false;
    // saving with every box blank removes the reading (owner, 13 Oct 2026): the timepoint is left as if never taken,
    // e.g. readings that make no sense once pre-warming stopped early
    const blank = cols.filter(c => draft[c.key] == null || draft[c.key] === '');
    if (blank.length === cols.length) {
      if (savedAt(p, s, pt.key) && !confirm(`Remove the ${pt.label} reading?\n\nIts saved values are deleted.`)) return false;
      const ids = [...cols.map(c => `${s}_${pt.key}_${c.key}`), `at_${s}_${pt.key}`];
      const sent = ids.filter(id => setVal(p, id, null, settings.me));
      saveAll(); if (sent.length) sync(p, sent);
      toast(`${pt.label} reading removed`); dropDraft(); base = snap();
      for (const c of cols) openT[c.key] = p.f[`${s}_${pt.key}_${c.key}`]?.t || 0;
      return true;
    }
    if (blank.length && !confirm(`${blank.map(c => c.label).join(', ')} ${blank.length === 1 ? 'is' : 'are'} blank.\n\nSave the ${pt.label} reading without ${blank.length === 1 ? 'it' : 'them'}?`)) return false;
    // the other phone saved this reading while it was open here: ask before writing over it (Cancel shows theirs)
    const theirs = cols.filter(c => (p.f[`${s}_${pt.key}_${c.key}`]?.t || 0) !== openT[c.key]);
    if (theirs.length) {
      const by = p.f[`${s}_${pt.key}_${theirs[0].key}`]?.by;
      if (!confirm(`The ${pt.label} reading was changed on another phone${by ? ' (' + by + ')' : ''} while you had it open: ${theirs.map(c => `${c.label} ${val(p, `${s}_${pt.key}_${c.key}`) ?? 'blank'}`).join(', ')}.\n\nOK: save yours over it. Cancel: show theirs.`)) { dropDraft(); setLeaveGuard(null); render(); return false; }
    }
    // saved more than 5 min after it was due (typed in later): ask when it was taken; that time goes on the forms
    let takenAt = nowHM();
    const dueAt = dueOf(p, s, pt);
    // saved well before it's due: probably the wrong timepoint (it would then never be asked for)
    if (!savedAt(p, s, pt.key) && dueAt != null && dueAt - nowFor(p, s) > 3
      && !confirm(`The ${pt.label} reading isn't due until ${fromMin(Math.round(dueAt))} (in ${Math.round(dueAt - nowFor(p, s))} min). Save it now anyway?`)) return false;
    if (!savedAt(p, s, pt.key) && dueAt != null && nowFor(p, s) - dueAt > 5) {
      const t = askTime(`The ${pt.label} reading was due at ${fromMin(Math.round(dueAt))}. What time was it taken?`, fromMin(Math.round(dueAt)));
      if (!t) return false;
      takenAt = t;
    }
    // only what changed goes out (with the save time): an unchanged box never overwrites the other phone's newer one
    const sent = cols.map(c => `${s}_${pt.key}_${c.key}`).filter((id, i) => setVal(p, id, draft[cols[i].key] == null ? null : (cols[i].type === 'code' ? +draft[cols[i].key] : String(draft[cols[i].key])), settings.me));
    if (!savedAt(p, s, pt.key)) { setVal(p, `at_${s}_${pt.key}`, takenAt, settings.me); sent.push(`at_${s}_${pt.key}`); }
    saveAll();
    if (sent.length) sync(p, sent);
    toast(pt.label + ' saved');
    dropDraft();
    base = snap();
    for (const c of cols) openT[c.key] = p.f[`${s}_${pt.key}_${c.key}`]?.t || 0;
    return true;
  }

  // timepoint labels (owner, 13 Oct 2026): Arrival, the zero point named for what it is, then "5 min"
  const pointShort = (ser, x) => x.key === 'base' ? 'Arrival' : x.key === 'end' ? 'End' : x.min === 0 ? (ser === 'prewarm' ? 'Prewarm on' : 'Induction') : x.min + ' min';
  function strip() {
    const now = nowFor(p, s);
    return `<div class="strip" role="list">${pts.map(x => {
      const done = savedAt(p, s, x.key), due = dueOf(p, s, x), missed = !done && due != null && now > due + 5 && expected(p, s, due);
      return `<a role="listitem" href="#/p/${id}/${s}/${x.key}" class="${x.key === pt.key ? 'on' : ''} ${done ? 'done' : missed ? 'missed' : ''}">${pointShort(s, x)}</a>`;
    }).join('')}</div>`;
  }
  // a value only carried over (or filled in by a rule) and not yet saved for this timepoint shows light grey (owner, 13 Oct 2026)
  const isDefault = k => val(p, `${s}_${pt.key}_${k}`) == null && draft[k] != null && !touched.has(k)
    && (String(draft[k]) === String(was[k]) || (k === 'set' && !setTouched) || ((k === 'under' || k === 'gown') && !warmTouched.has(k)));
  function isChanged(k) { const v = draft[k]; return v != null && was[k] != null && String(v) !== String(was[k]); }
  function hintOf(c) {
    const v = draft[c.key];
    if (c.key === 'map' && v == null) { const m = calc('map', k => draft[k]); if (m) return `<button class="link" data-map="${m}">use ${m}</button>`; }
    return isChanged(c.key) ? 'was ' + was[c.key] : was[c.key] != null ? 'same' : '';
  }
  function card(c) {
    const v = draft[c.key];
    if (c.type === 'code') {
      return `<div class="card ${c.opts.length > 2 ? 'wide inline' : ''}${isDefault(c.key) ? ' dflt' : ''}" ${c.key === 'ts' ? 'title="−3 cold … +3 hot" aria-label="Thermal sensation, −3 cold to +3 hot" role="group"' : ''}><div class="clab">${c.label}</div>
        <div class="seg ${c.opts.length > 2 ? 'seven' : 'two'}">${c.opts.map(([ov, ol]) => `<button class="chip" aria-pressed="${String(v) === String(ov)}" data-c="${c.key}" data-v="${ov}">${c.key === 'ts' ? ol.split(' ')[0] : ol}</button>`).join('')}</div></div>`;
    }
    if (c.key === 'set') {
      return `<div class="card wide inline${isDefault('set') ? ' dflt' : ''}"><div class="clab">Gown set <small>°C</small></div>
        <div class="seg seven">${['38', '39', '40', '41', '42', '43', 'NA'].map(o => `<button class="chip" aria-pressed="${String(v) === o}" data-c="set" data-v="${o}">${o}</button>`).join('')}</div></div>`;
    }
    const changed = isChanged(c.key), hint = hintOf(c);
    // BP, HR, BIS: plain boxes that stay boxes, so the keyboard stays up from one to the next (owner, 12 Oct 2026)
    if (s === 'haemo') {
      const last = c === cols[cols.length - 1];
      return `<div class="card typed ${changed ? 'changed' : ''}${isDefault(c.key) ? ' dflt' : ''}" data-k="${c.key}"><div class="clab"><span>${c.label}</span><small>${hint}</small></div>
        <input class="num" id="in-${c.key}" data-in="${c.key}" inputmode="none" enterkeyhint="${last ? 'done' : 'next'}" autocomplete="off" aria-label="${c.label}" value="${esc(v ?? '')}"></div>`;
    }
    // an empty temperature: the whole card is one big target that puts in 36.5
    const fill = (c.temp || c.key === 'room') && v == null;
    return `<div class="card ${changed ? 'changed' : ''}${isDefault(c.key) ? ' dflt' : ''}${fill ? ' fill' : ''}${c.key === 'core' ? ' wide core' : ''}" ${fill ? `data-fill="${c.key}"` : ''}><div class="clab">${c.label}<small>${hint}</small></div>
      <div class="pm"><button class="k" data-step="-1" data-c="${c.key}" aria-label="${c.label} down">−</button><button class="num" data-type="${c.key}">${v ?? '<span class="muted">tap</span>'}</button><button class="k" data-step="1" data-c="${c.key}" aria-label="${c.label} up">+</button></div></div>`;
  }
  // the original Thermal Sensation Scale (owner, 21 Oct 2026, from the study's paper copy), under Save so Save stays on screen; the picked row is marked
  function tsScale(v) {
    return `<table class="tsscale"><caption>Thermal Sensation Scale</caption><thead><tr><th colspan="2">Scale</th><th>Comments</th></tr></thead><tbody>${TS_SCALE.map(([n, w, cm]) =>
      `<tr${String(v) === String(n) ? ' class="on"' : ''}><td>${n < 0 ? '−' + -n : n}</td><td>${w}</td><td>${cm}</td></tr>`).join('')}</tbody></table>`;
  }
  function timesHtml() {
    // numbered in the order they happen (owner, 12 Oct 2026)
    return `<div class="times${val(p, 'done') ? ' sealed' : ''}">${EVENTS.filter(([f, , pw]) => !(pw && noWarming(p)) && !PACU_TIMES.includes(f)).map(([f, l], i) => {
      const v = val(p, f), full = EVENT_FULL[f] || l, n = `<i class="tn" aria-hidden="true">${i + 1}</i>`;
      return `<button class="tchip ${v ? 'set' : ''}${WARM_EVENTS.has(f) ? ' warm' : ''}" data-ev="${f}" aria-label="${i + 1}, ${full}: ${v ? v + ', tap to change' : 'tap to set now'}">${n}<span>${l}</span><b>${v ? esc(v) : 'tap'}</b></button>`;
    }).join('')}</div>`;
  }
  // the other forms, Still to fill and Mark complete: the same on both tabs (owner, 12 Oct 2026)
  function linksHtml() {
    const done = (pg, name) => val(p, 'sign_' + pg) ? ` class="done" aria-label="${name}, complete"` : '';
    // once their stage has come: how many questions are left
    const todo = (ids, from) => {
      if (!val(p, from)) return '';
      const n = ids.map(field).filter(f => f && isShown(f, k => val(p, k)) && val(p, f.id) == null).length;
      return n ? `${n} to answer` : '';
    };
    // Pre-op, Intra-op details, PACU on one line; POD1, POD2, Discharge under them (owner, 21 Oct 2026)
    const data = d => `<a href="#/p/${id}/${d.path}"${done(d.sign, d.short)}>${d.short}</a>`;
    return `<nav class="links three" aria-label="Other forms">${data(DATA_PARTS[0])}
      <a href="#/p/${id}/form/intraop"${done('intraop', 'Intra-op details')}>Intra-op details<small>${todo(INTRAOP_Q, 'io_done') || 'Blood, products, tests'}</small></a>
      <a href="#/p/${id}/form/pacu"${done('pacu', 'PACU')}>PACU<small>${todo(PACU_Q, 'pacu_in') || 'Temp, NuDESC, delay'}</small></a>
      </nav>
      <nav class="links three" aria-label="Chart review">${DATA_PARTS.slice(1).map(data).join('')}</nav>
      <div class="textlinks"><a href="#/p/${id}/form">Form view</a><a href="#/p/${id}/sheet">Sheet view</a></div>
      <div class="sharerow caseshare"><a class="secondary" href="#/p/${id}/share">Share subject</a><a class="secondary" href="#/p/${id}/pacushare">Share to PACU</a></div>`;
  }
  // previous / next timepoint: big buttons either side of the tabs and the timepoint strip
  function navHtml() {
    const i = pts.findIndex(x => x.key === pt.key);
    const btn = (x, cls, sym, word) => x
      ? `<a class="pn ${cls}" href="#/p/${id}/${s}/${x.key}" aria-label="${word}: ${esc(x.label)}">${sym}</a>`
      : `<span class="pn ${cls}" aria-hidden="true">${sym}</span>`;
    return `<div class="nav2">${btn(pts[i - 1], 'prev', '‹', 'Previous')}<div class="mid">${main ? tabsHtml() : ''}${strip()}</div>${btn(pts[i + 1], 'next', '›', 'Next')}</div>`;
  }
  function tabsHtml() {
    return `<div class="tabs2" role="tablist">${['prewarm', 'iotemp'].map(x => `<a role="tab" aria-selected="${x === s}" href="#/p/${id}/${x}">${x === 'prewarm' ? 'Induction room' : 'Intra-op'}</a>`).join('')}</div>`;
  }
  function draw() {
    const clean = base == null || snap() === base;
    if (s === 'prewarm' && !setTouched && cols.some(c => c.key === 'set') && setTempNA(p, pt)) draft.set = 'NA';
    // underbody / gown warming: a reading due after its logged start time is Yes unless someone picks otherwise
    if (s === 'iotemp' && !isSaved) for (const [c, ev] of [['under', 'io_under_start'], ['gown', 'io_gown_start']]) {
      if (warmTouched.has(c) || !cols.some(x => x.key === c)) continue;
      const st = toMin(val(p, ev)), d = dueOf(p, s, pt);
      if (st != null && d != null && (d - st + 1440) % 1440 < 720) draft[c] = '1';
    }
    // an automatic change (set temp NA once warming is off) isn't something to ask about
    if (clean) base = snap();
    keep();
    const due = dueOf(p, s, pt);
    const grp = s === 'prewarm' ? `<span class="badge">${GROUPS.find(g => String(g[0]) === String(val(p, 'arm')))?.[1] || 'Group not set'}</span>` : '';
    const reading = noPw ? `<div class="nav2"><span></span><div class="mid">${tabsHtml()}</div><span></span></div>
      <p class="note nopw">No pre-warming: this patient is in the no pre-warming group, so there are no temperatures to take here. Intra-op temperatures are on the Intra-op tab.</p>` : `${navHtml()}
      <div class="tp"><div><b>${pt.label}</b> ${grp}</div><div class="due" id="due">${due != null ? 'due ' + fromMin(Math.round(due)) : pt.key === 'base' ? (s === 'prewarm' ? '' : 'on arrival in OT') : pt.min != null ? `<span class="hint">Log ${s === 'prewarm' ? 'Prewarm on' : 'Induction'} first</span>` : ''}</div></div>
      <div class="${sealed() ? 'sealed' : ''}">${isSaved ? `<p class="muted small tight">Taken ${esc(savedAt(p, s, pt.key))}${p.f['at_' + s + '_' + pt.key]?.by ? ' (saved by ' + esc(p.f['at_' + s + '_' + pt.key].by) + ')' : ''} <button class="link" data-attime>Change time</button>. Changes save when you tap Save.</p>` : ''}
      <div class="board">${cols.map(card).join('')}</div>
      ${sealed() ? sealNote(p, s) : `<button class="save big" id="save">${isSaved ? 'Save changes' : `Save ${pt.label} reading`}</button>
      <p class="resetline"><button class="link" id="clearall">Clear ${isSaved ? 'this saved reading' : 'all boxes'}</button></p>`}
      ${cols.some(c => c.key === 'ts') ? tsScale(draft.ts) : ''}</div>`;
    // three parts (owner, 12 Oct 2026): key times; the tab bar and its readings (swipe changes tab here only);
    // the other forms, Still to fill and Mark complete, the same on both tabs
    paint(`<section class="third top" aria-label="Key times">${val(p, 'done') ? `<p class="ok-box donetop">✓ Data collection complete <small>${esc(val(p, 'done'))}</small></p>` : ''}${timesHtml()}</section>
      <section class="third mid">${ptabsHtml()}${s === 'prewarm' ? inductionAsks(p) : ''}${reading}
      ${s === 'haemo' && vitalsCollected(p) ? '<p class="okline small">✓ Vital signs data collected: ticked on the paper form</p>' : ''}
      ${s === 'haemo' && settings.hide.haemo15 ? `<p class="muted small">Only baseline is entered here; the 15-min rows come from the monitor download. Turn them on in Settings.</p>` : ''}
      ${main && noPw ? '' : signoffHtml(p, s)}</section>
      <section class="third bot" aria-label="Other forms and checks">${linksHtml()}${gapsHtml(p)}${doneHtml(p)}
      <p class="resetline"><button class="link" id="resetsub">Reset this subject</button></p></section>`);
    refreshBar();
    disableSealed();
    fitNums();
    if (typing) { const i = view.querySelector(`[data-in="${typing}"]`); i?.focus(); }
    const st = view.querySelector('.strip'), on = st?.querySelector('.on');
    if (on) st.scrollLeft = on.offsetLeft - st.offsetLeft - (st.clientWidth - on.offsetWidth) / 2;
  }
  // the quick-entry pads (owner, 13 Oct 2026): a number pad for a box, a time pad for a key time
  function openCell(k) {
    const c = cols.find(x => x.key === k); if (!c) return;
    // Next goes to the following box that takes a number (the gown set temp and yes/no boxes use taps, not the pad);
    // three digits of a temperature save it and move on by themselves (14 Oct 2026: about 5 taps fewer per reading)
    const padCols = cols.filter(x => (x.type === 'num' || x.type === 'int') && x.key !== 'set'), nxt = padCols[padCols.indexOf(c) + 1] || null;
    openKeypad({ title: c.label + (c.unit ? ' ' + c.unit : ''), mode: s === 'haemo' ? 'int' : c.temp ? 'temp' : 'dec', value: draft[k] ?? '',
      hint: was[k] != null ? 'was ' + was[k] : '',
      onDone: v => { draft[k] = v === '' ? null : v; touched.add(k); draw(); lockTaps(); },
      onClear: () => { draft[k] = null; draw(); },
      onNext: nxt ? v => { draft[k] = v === '' ? null : v; touched.add(k); draw(); openCell(nxt.key); } : null, nextLabel: 'Next' });
  }
  function editTime(f) {
    const had = !!val(p, f), label = EVENT_FULL[f] || evLabel(f);
    openKeypad({ title: label, mode: 'time', value: had && val(p, f) !== 'NA' ? val(p, f) : '', nowValue: nowHM(), hint: had ? 'logged ' + val(p, f) : '',
      onDone: v => {
        if (v === '') return;
        // logging one while an earlier key time is still empty asks first: a stray tap on Surgery end would otherwise
        // stop the intra-op readings counting as due
        if (!had) {
          const skipped = skippedBefore(p, f);
          if (skipped.length && !confirm(`${skipped.join(', ')} ${skipped.length === 1 ? 'isn’t' : 'aren’t'} logged yet.\n\nLog ${evLabel(f)} at ${v}?`)) return;
        }
        set(p, f, v); lockTaps(); draw();
      },
      onClear: () => {
        if (!had) return;
        if (!confirm(`Clear the ${evLabel(f)} time (${val(p, f)})?`)) return;
        set(p, f, null); draw();
      } });
  }
  // an alarm or the top-bar countdown opens its reading's first box straight away (owner, 13 Oct 2026)
  // returns true when the target is on this screen (so no navigation, which would ask about an unsaved reading)
  openHere = (t, stay) => {
    if (t.pid !== id) return false;
    if (stay) return t.ev || (t.s === s && t.key === pt.key);
    if (t.ev) { editTime(t.ev); return true; }
    if (t.s === s && t.key === pt.key) { if (cols[0]) openCell(cols[0].key); return true; }
    return false;
  };
  cleanup.push(() => { openHere = null; });
  draw();
  if (pendingOpen && pendingOpen.pid === id && Date.now() - pendingOpen.at < 8000) { const t = pendingOpen; pendingOpen = null; setTimeout(() => openHere?.(t), 0); }
  if (restored) toast(`Unsaved ${pt.label} reading brought back. Check it, then Save.`);
  const step = { core: 0.1, chest: 0.1, arm: 0.1, thigh: 0.1, calf: 0.1, room: 0.5, sbp: 1, dbp: 1, map: 1, hr: 1, bis: 1 };
  // an empty box starts here with + / − or a tap on its card; skin temperature starts at 31 (owner, 13 Oct 2026)
  const start = { core: 36.5, chest: 31, arm: 31, thigh: 31, calf: 31, room: 20, sbp: 120, dbp: 70, map: 85, hr: 75, bis: 50 };
  function bump(k, dir) {
    const cur = parseFloat(draft[k]);
    const n = Number.isFinite(cur) ? cur + dir * step[k] : start[k];
    touched.add(k);
    draft[k] = step[k] < 1 ? (Math.round(n * 10) / 10).toFixed(1) : String(Math.round(n));
  }
  let hold;
  const stopHold = () => { clearTimeout(hold); clearInterval(hold); };
  view.onpointerdown = e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    e.preventDefault();
    if (b.closest('.sealed')) return toast(sealedMsg(p, s));
    const k = b.dataset.c, dir = +b.dataset.step;
    bump(k, dir); draw();
    hold = setTimeout(() => { hold = setInterval(() => { bump(k, dir); draw(); }, 120); }, 450);
  };
  view.onpointerup = view.onpointercancel = view.onpointerleave = stopHold;
  cleanup.push(stopHold, () => { view.onpointerdown = view.onpointerup = view.onpointercancel = view.onpointerleave = view.onclick = null; });
  view.onclick = e => {
    const t = e.target;
    if (t.closest('.sealed') && t.closest('button, .card, .chip, [data-ev], [data-attime]')) return toast(sealedMsg(p, t.closest('.times') ? null : s));
    const st = t.closest('[data-step]');
    if (st && e.detail === 0) { bump(st.dataset.c, +st.dataset.step); draw(); return; } // keyboard
    const chip = t.closest('.chip[data-c]');
    if (chip) { if (chip.dataset.c === 'set') setTouched = true; warmTouched.add(chip.dataset.c); draft[chip.dataset.c] = draft[chip.dataset.c] === chip.dataset.v ? null : chip.dataset.v; draw(); return; }
    const fl = t.closest('.card[data-fill]');
    if (fl && !t.closest('[data-step], .num')) { touched.add(fl.dataset.fill); draft[fl.dataset.fill] = start[fl.dataset.fill].toFixed(1); draw(); return; }
    const m = t.closest('[data-map]');
    if (m) { draft.map = m.dataset.map; draw(); return; }
    if (comfortTap(p, t, draw)) return;
    const ev = t.closest('[data-ev]');
    if (ev) { editTime(ev.dataset.ev); return; }
    const n = t.closest('.num[data-type]');
    if (n) { openCell(n.dataset.type); return; }
    const tc = t.closest('.card.typed');
    if (tc) { openCell(tc.dataset.k); return; }
    if (t.closest('[data-attime]')) {
      const v = askTime(`What time was the ${pt.label} reading taken?`, savedAt(p, s, pt.key));
      if (v) { set(p, `at_${s}_${pt.key}`, v); draw(); }
      return;
    }
    if (t.closest('#clearall')) {
      if (isSaved) {
        if (!confirm(`Remove the saved ${pt.label} reading (${cols.filter(c => val(p, `${s}_${pt.key}_${c.key}`) != null).map(c => c.label + ' ' + val(p, `${s}_${pt.key}_${c.key}`)).join(', ')})?\n\nIt goes back to not taken.`)) return;
        const ids = [...cols.map(c => `${s}_${pt.key}_${c.key}`), `at_${s}_${pt.key}`].filter(id => val(p, id) != null && setVal(p, id, null, settings.me));
        saveAll(); if (ids.length) sync(p, ids);
        dropDraft(); setLeaveGuard(null); toast(pt.label + ' reading removed'); render(); return;
      }
      for (const c of cols) draft[c.key] = null;
      setTouched = true; for (const k of ['under', 'gown']) warmTouched.add(k);
      draw(); return;
    }
    if (t.closest('#save')) {
      if (!commit()) return;
      lockTaps(); // a double tap on Save mustn't save the next timepoint too
      // the last warming reading (10 min or 30 min by arm): pre-warming is complete, on to the intra-op temps (owner, 13 Oct 2026)
      if (s === 'prewarm' && pt.min != null && pt.min === WARM_MIN[val(p, 'arm')]) {
        if (settings.me && !val(p, 'sign_prewarm')) set(p, 'sign_prewarm', `${settings.me} ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${nowHM()}`);
        toast(settings.me ? 'Pre-warming complete. Now the intra-op temps.' : 'Last pre-warming reading saved. Add your initials in Settings to mark it complete.');
        go(`#/p/${id}/iotemp`);
        return;
      }
      const next = pts.slice(pts.indexOf(pt) + 1).find(x => !savedAt(p, s, x.key));
      go(`#/p/${id}/${s}/` + (next ? next.key : pt.key));
      return;
    }
    if (t.closest('[data-done]')) {
      if (!settings.me) return toast('Add your initials in Settings first.');
      const g = gaps(p);
      if (g.length && !confirm(`Still to fill:\n${g.map(x => `• ${x.what}: ${x.items.join(', ')}`).join('\n')}\n\nMark data collection complete anyway?`)) return;
      set(p, 'done', `${settings.me} ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${nowHM()}`);
      toast('Data collection marked complete'); draw(); window.scrollTo(0, 0); return;
    }
    if (t.closest('[data-undone]')) {
      if (!confirm(`Undo "Data collection complete" (${val(p, 'done')})?\n\nThe day's screens can then be changed again.`)) return;
      set(p, 'done', null); draw(); return;
    }
    if (t.closest('#resetsub')) { resetSubject(p); return; }
    signoffClick(p, s, t);
  };
  // typed boxes (BP, HR, BIS): no redraw while typing, so moving to the next box keeps the keyboard up
  view.onfocusin = e => { if (e.target.dataset.in) typing = e.target.dataset.in; };
  view.oninput = e => {
    const k = e.target.dataset.in; if (!k) return;
    const v = e.target.value.trim(); touched.add(k); draft[k] = v === '' ? null : v;
    keep();
    for (const c of cols) {
      const cd = view.querySelector(`.card[data-k="${c.key}"]`); if (!cd) continue;
      cd.classList.toggle('changed', isChanged(c.key)); cd.querySelector('.clab small').innerHTML = hintOf(c);
    }
  };
  view.onkeydown = e => {
    if (e.key !== 'Enter' || !e.target.dataset.in) return;
    e.preventDefault();
    const all = [...view.querySelectorAll('[data-in]')], next = all[all.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  };
  view.onfocusout = e => {
    if (e.target.dataset.in) setTimeout(() => { if (!view.querySelector('[data-in]:focus')) typing = null; }, 0);
  };
  cleanup.push(() => { view.onfocusout = view.onfocusin = view.oninput = view.onkeydown = null; });
  // the due time warms up as it nears the clock: soon (2 min), now (to 5 min past), late; plain once saved
  const dueTick = () => {
    const el = $('#due'); if (!el) return;
    const d = dueOf(p, s, pt); if (d == null) return;
    const left = d - nowFor(p, s);
    el.textContent = 'due ' + fromMin(Math.round(d)) + (left > 0 ? ` · in ${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, '0')}` : left > -5 ? ' · now' : ' · late');
    el.dataset.state = isSaved ? 'saved' : left > 2 ? 'later' : left > 0 ? 'soon' : left > -5 ? 'now' : 'late';
  };
  dueTick();
  // the BP, HR, BIS box warms up the same way for its next 15-min reading; the still-to-fill list keeps up as
  // readings fall due (main screen)
  const hl = setInterval(() => {
    dueTick();
    const a = $('#haemolink'); if (a) a.dataset.state = haemoState(p);
    const tl = $('#templink'); if (tl) tl.dataset.state = haemoState(p, defaultSeries(p));
    const gp = $('#gaps'), h = gapsHtml(p);
    if (gp && gp.outerHTML !== h) { if (h) gp.outerHTML = h; else gp.remove(); }
    else if (!gp && h) $('[data-done], [data-undone]')?.closest('.sign')?.insertAdjacentHTML('beforebegin', h);
  }, 1000);
  cleanup.push(() => clearInterval(hl));
});

hooks.openTarget = openTarget;
