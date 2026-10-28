// Shared state and helpers for the prewarming study screens (ui-*.js): this phone's saved copy, settings, the team
// state, toast, routing and the top bar. app.js owns start-up (the move to the new address, the offline shell).
// Imports nothing from the screens: they call back through hooks, so this module runs first.
import { BY_ID, EXTRA_BY_ID } from './schema.js';
import { newRecord, setVal, val, mergeRecord, isGone } from './store.js';
import { closeKeypad } from './keypad.js';


export const DEMO = new URLSearchParams(location.search).has('demo');
export const NS = DEMO ? 'prewarm-demo:' : 'prewarm:';
export const $ = s => document.querySelector(s);
// the app kit's theme (app-ui @core/theme, one exact version; sw.js keeps it offline): look C (plain bar, hairlines) on
// the light grey ground, the study's navy as the accent, so it looks as before the move unless this phone picks another
// in Settings. import() so a blocked core.anawj.com leaves the kit's plain CSS look
export const KIT = 'https://core.anawj.com/ui/1.0.0-rc.27/';
export const theme = import(KIT + 'theme/index.js').then(t => { t.applyTheme({ accent: '#002f6c', look: 'c', surface: 'grey' }); return t; }).catch(() => null);
export const view = $('#view');
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const field = id => BY_ID[id] || EXTRA_BY_ID[id];
export const GROUPS = [[1, '30 min pre-warming'], [2, '10 min pre-warming'], [3, 'No pre-warming']];

// Replace the screen. Blurring first lets a half-typed box commit its change before it disappears, and the guard
// stops that change from redrawing again mid-swap.
let painting = false, newer = null;
export function paint(html) {
  if (painting) { newer = html; return; } // drawn by the blur's own handler: newer than ours
  painting = true; newer = null;
  try { if (view.contains(document.activeElement)) document.activeElement.blur(); view.innerHTML = newer ?? html; } finally { painting = false; }
}

// ---------- storage
export const read = (k, d) => { try { return JSON.parse(localStorage.getItem(NS + k)) ?? d; } catch { return d; } };
// a failed write stays on screen (a toast would be replaced at once by "… saved"): what's not stored here is lost on
// reload unless it reached the team
export const write = (k, v) => {
  try { localStorage.setItem(NS + k, JSON.stringify(v)); if (k === 'patients') document.getElementById('storefull')?.remove(); return true; } catch {
    if (!document.getElementById('storefull')) document.body.insertAdjacentHTML('afterbegin', '<div id="storefull" class="storefull" role="alert">This phone couldn’t store the last change (storage full or blocked). Don’t close the app: export Excel from Settings, or ask the study admin.</div>');
    return false;
  }
};
export let patients = read('patients', {});
// another window of the app on this phone saved: take its changes (newest value per field wins, as between phones)
// so neither window writes its stale copy over the other's
window.addEventListener('storage', e => {
  if (e.key !== NS + 'patients' || !e.newValue) return;
  let other; try { other = JSON.parse(e.newValue); } catch { return; }
  let changed = false;
  for (const r of Object.values(other || {})) {
    const local = patients[r.id];
    if (!local) { patients[r.id] = r; changed = true; continue; }
    const m = mergeRecord(local, r);
    if (m.changed) { Object.assign(local, m.rec); changed = true; }
  }
  if (changed) { shared.stale = true; const b = document.getElementById('fresh'); if (b) b.hidden = false; }
});
export const settings = Object.assign({ me: '', site: '', scan: false, hide: { skin: false, set: false, ts: false, warm: false, room: false, haemo15: false, bis: false },
  remind: { vibrate: true, beep: true, banner: true, awake: true, haemo: false } }, read('settings', {}));
export const saveAll = () => write('patients', patients);
export const saveSettings = () => write('settings', settings);
// settings v2 (owner, 12 Oct 2026): every reading is entered live by default, BP / HR / BIS every 15 min included
if ((settings.v || 0) < 2) { settings.hide.haemo15 = false; settings.v = 2; saveSettings(); }
// settings v3 (owner, 13 Oct 2026): the "Readings to enter live" section is gone, so nothing stays hidden from an old choice
if (settings.v < 3) { for (const k of Object.keys(settings.hide)) settings.hide[k] = false; settings.v = 3; saveSettings(); }
// Interface size (this phone only): zooms the whole screen. Normal is 100%.
export const SIZES = [['0.85', 'Smaller'], ['0.92', 'Small'], ['1', 'Normal'], ['1.1', 'Large'], ['1.25', 'Larger']];
export const applySize = z => document.documentElement.style.setProperty('--ui-zoom', SIZES.some(([k]) => k === String(z)) ? String(z) : '1');
applySize(settings.zoom);
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

if (DEMO && !Object.keys(patients).length) {
  // started an hour or two ago, but never before today's midnight: a start yesterday would make POD1 due on the demo
  const ago = ms => Math.max(Date.now() - ms, new Date(new Date().toDateString()).getTime());
  const p = newRecord(ago(3600e3));
  const now = new Date(), hm = m => { const d = new Date(now.getTime() - m * 60e3); return d.toTimeString().slice(0, 5); };
  setVal(p, 'enrol_id', 'DEMO-01', 'DM'); setVal(p, 'arm', 1, 'DM'); setVal(p, 'pw_gown', hm(30), 'DM'); setVal(p, 'pw_start', hm(22), 'DM');
  [[0, 36.6, 33.0, 32.1, 31.6, 30.9], [5, 36.6, 33.6, 32.6, 31.9, 31.1], [10, 36.7, 34.1, 33.0, 32.2, 31.4], [15, 36.7, 34.5, 33.4, 32.4, 31.6]].forEach(([m, ...t]) => {
    ['core', 'chest', 'arm', 'thigh', 'calf'].forEach((c, i) => setVal(p, `prewarm_${m}_${c}`, String(t[i]), 'DM'));
    setVal(p, `prewarm_${m}_set`, '43', 'DM'); setVal(p, `prewarm_${m}_ts`, m ? 1 : 0, 'DM'); setVal(p, `at_prewarm_${m}`, hm(22 - m), 'DM');
  });
  patients[p.id] = p;
  // a second patient already in OT, induction 50 min ago
  const q = newRecord(ago(7200e3));
  setVal(q, 'enrol_id', 'DEMO-02', 'DM'); setVal(q, 'arm', 2, 'DM'); setVal(q, 'pw_gown', hm(95), 'DM'); setVal(q, 'pw_start', hm(90), 'DM'); setVal(q, 'ev_wstop', hm(80), 'DM');
  setVal(q, 'ev_ot', hm(65), 'DM'); setVal(q, 'io_knife', hm(50), 'DM'); setVal(q, 'io_flip', hm(42), 'DM'); setVal(q, 'io_under_start', hm(40), 'DM');
  [['base', 36.4], [0, 36.3], [5, 36.2], [10, 36.1], [15, 36.0], [20, 35.9], [25, 35.9], [30, 35.8], [35, 35.8], [40, 35.9], [45, 35.9]].forEach(([m, core], i) => {
    setVal(q, `iotemp_${m}_core`, core.toFixed(1), 'DM');
    ['chest', 'arm', 'thigh', 'calf'].forEach((c, j) => setVal(q, `iotemp_${m}_${c}`, (34.2 - j * 0.6 - i * 0.05).toFixed(1), 'DM'));
    setVal(q, `iotemp_${m}_under`, m === 'base' || m < 10 ? 0 : 1, 'DM'); setVal(q, `iotemp_${m}_gown`, 0, 'DM'); setVal(q, `iotemp_${m}_room`, '21.0', 'DM');
    setVal(q, `at_iotemp_${m}`, m === 'base' ? hm(55) : hm(50 - m), 'DM');
  });
  setVal(q, 'haemo_base_sbp', '132', 'DM'); setVal(q, 'haemo_base_dbp', '78', 'DM'); setVal(q, 'haemo_base_map', '96', 'DM'); setVal(q, 'haemo_base_hr', '72', 'DM'); setVal(q, 'at_haemo_base', hm(55), 'DM');
  patients[q.id] = q;
  saveAll();
}

// ---------- helpers
export const nowHM = () => new Date().toTimeString().slice(0, 5);
export const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? +m[1] * 60 + +m[2] : null; };
export const fromMin = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
export const sid = p => val(p, 'enrol_id') || 'New patient';
// "Subject ID: 85" wherever a patient is named on screen (owner, 13 Oct 2026)
export const sidL = p => 'Subject ID: ' + sid(p);
// ---------- sharing (ui-sync.js keeps it up to date)
// joining: a join is on its way; it sets member and starts watching itself (ui-settings joinTeam, ui-sync onUser)
export const shared = { member: null, admin: false, email: '', uid: null, unwatch: null, stale: false, joining: false };
let toastTimer;
export function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }
// ---------- routing
// Set by the screens (ui-home.js, ui-patient.js): the home page, who may lock, and opening a due reading
export const hooks = { home() {}, canLock() { return false; }, openTarget() {} };
const routes = [];
export const route = (re, fn) => routes.push([re, fn]);
export function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
export let cleanup = [];
// a reading screen with changes not yet saved sets this: it returns { what, save } while there is something to lose.
// Each history entry carries its place (state.i), so leaving can be undone by stepping back the same way and redone
// once answered: the phone's back button never walks out of the app past an unsaved reading.
export let leaveGuard = null, shown = location.hash, at = history.state?.i ?? 0, restoring = false;
export const setLeaveGuard = g => { leaveGuard = g; };
export function render() {
  closeKeypad();
  if (restoring && location.hash === shown) { restoring = false; return; }
  restoring = false;
  // a box still being typed in (swipe, phone back): let it commit first, so the leave check sees it and a form's
  // answer is saved before its screen goes
  if (view.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) document.activeElement.blur();
  const g = leaveGuard?.();
  if (g) {
    const to = location.hash, i = history.state?.i;
    const asking = !!document.querySelector('dialog.ask[open]');
    if (to === shown) { if (!asking) askLeave(g, () => { leaveGuard = null; render(); }); return; }
    const delta = i == null ? 1 : i - at;
    if (delta) { restoring = true; history.go(-delta); }
    else history.replaceState(history.state, '', shown);
    if (!asking) askLeave(g, () => { leaveGuard = null; if (delta) history.go(delta); else go(to); });
    return;
  }
  leaveGuard = null; shown = location.hash;
  if (history.state?.i == null) history.replaceState({ i: ++at }, ''); else at = history.state.i;
  cleanup.forEach(f => f()); cleanup = [];
  shared.stale = false; $('#fresh').hidden = true;
  const h = location.hash.slice(1) || '/';
  // a locked patient can't be opened (by anyone) until a study admin unlocks it
  const pm = /^\/p\/(\w+)/.exec(h);
  // a locked patient can't be opened from a team phone; an admin opens it read only
  // a deleted patient isn't charted into (it wouldn't be exported): back to the list, which says where to restore it
  if (pm && patients[pm[1]] && isGone(patients[pm[1]])) { toast(`${sid(patients[pm[1]])} was deleted. Restore it in Settings › Delete participants.`); location.replace('#/'); return; }
  const lockedHere = !!(pm && patients[pm[1]]?.lock?.on);
  if (lockedHere && !hooks.canLock()) { toast('Locked by the study admin'); location.replace('#/'); return; }
  document.body.classList.toggle('ro', lockedHere);
  for (const [re, fn] of routes) { const m = re.exec(h); if (m) { fn(...m.slice(1)); window.scrollTo(0, 0); return; } }
  hooks.home();
}
window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', e => { if (leaveGuard?.()) e.preventDefault(); });
// After a tap that moves or redraws the screen (Save, Log, a time, a comfort answer), taps are ignored for a moment: a
// double tap otherwise lands on whatever moved under the finger (the next timepoint's Save, the next event's Log).
// Prompts (the save dialog) aren't affected.
// Only a tap near the one just handled is ignored (a double tap lands in the same place; a quick tap elsewhere is fine).
let tapLockUntil = 0, tapAt = { x: -99, y: -99 }, lockAt = tapAt;
document.addEventListener('pointerdown', e => { tapAt = { x: e.clientX, y: e.clientY }; }, true);
export const lockTaps = (ms = 700) => { tapLockUntil = Date.now() + ms; lockAt = tapAt; };
document.addEventListener('click', e => {
  if (Date.now() >= tapLockUntil || e.target.closest('dialog')) return;
  if (Math.hypot(e.clientX - lockAt.x, e.clientY - lockAt.y) < 48) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
// a reading's number shrinks until it fits between − and + (Large / Larger sizes and small phones cut 36.7 to "36.")
export function fitNums() {
  const fit = n => {
    n.style.fontSize = '';
    let f = parseFloat(getComputedStyle(n).fontSize);
    while (n.scrollWidth > n.clientWidth + 1 && f > 11) { f -= 1; n.style.fontSize = f + 'px'; }
    return f;
  };
  for (const n of view.querySelectorAll('.pm .num')) {
    // still tiny (Larger size on a small phone): narrower − / + make room
    if (fit(n) < 16) { n.parentElement.style.gridTemplateColumns = '32px minmax(0, 1fr) 32px'; n.parentElement.style.gap = '2px'; fit(n); }
  }
}
// ask for a 24-hour time (hh:mm); null if cancelled or not a time
export function askTime(q, def) {
  const r = prompt(q + '\n\n24-hour time, e.g. 08:05', def || '');
  if (r == null) return null;
  const m = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/.exec(r);
  if (!m || +m[1] > 23 || +m[2] > 59) { toast('Enter the time as hh:mm, e.g. 08:05.'); return null; }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
// run fn now, or after the save prompt when a reading on screen has unsaved changes
export function afterAsking(fn) { const g = leaveGuard?.(); if (g) askLeave(g, () => { leaveGuard = null; fn(); }); else fn(); }
function askLeave(g, proceed) {
  const d = document.createElement('dialog');
  d.className = 'ask';
  d.innerHTML = `<p><b>Save the ${esc(g.what)}?</b></p><p class="muted small">You changed it but haven’t saved.</p>
    <div class="askbtns"><button class="save" data-a="save">Save</button><button class="secondary" data-a="drop">Don’t save</button><button class="link" data-a="stay">Stay here</button></div>`;
  document.body.append(d);
  d.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a || (e.target === d ? 'stay' : null);
    if (!a) return;
    if (a === 'save' && !g.save()) { d.close(); return; }
    if (a === 'drop') g.drop?.();
    d.close();
    if (a !== 'stay') proceed();
  };
  d.onclose = () => d.remove();
  d.showModal();
  d.querySelector('[data-a="save"]').focus();
}
$('#fresh').onclick = () => render();
$('#banner').onclick = () => { $('#banner').hidden = true; const t = bannerTarget; bannerTarget = null; if (t) hooks.openTarget(t, false); };
// the due banner floats over the top of the page, just under the bar: nothing moves under a finger as it appears
// (it used to push the page down, so a tap meant for Save landed on another box); a tap on it only hides it
let bannerTimer, bannerTarget = null;
export function showBanner(text, ms, target = null) {
  const b = $('#banner'); bannerTarget = target;
  b.style.top = Math.max(0, $('header.bar').getBoundingClientRect().bottom) + 'px';
  b.textContent = text; b.hidden = false;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}
// the bar shows a small "Subject ID" above the ID, so the long title doesn't crowd the countdown and Log
export function setTitle(title) {
  const m = /^Subject ID: (.*)$/.exec(title), el = $('#title');
  if (m) el.innerHTML = `<small class="idlab">Subject ID</small><span>${esc(m[1])}</span>`; else el.textContent = title;
}
export function header(title, back, extra = '') {
  $('#ptabs').hidden = true; $('#ptabs').innerHTML = '';
  setTitle(title);
  $('#back').hidden = !back; $('#back').onclick = () => go(back);
  $('#extra').innerHTML = extra;
}
