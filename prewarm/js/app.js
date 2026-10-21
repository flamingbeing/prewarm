// Prewarming study: op-day screens. Data stays on this phone for now (localStorage); sharing comes with Firebase.
import { PAGES, SERIES, BY_ID, EXTRA_BY_ID, IX_COLS, SITES, PACU_KEYS, calc, normaliseTemp, isShown, WARM_MIN } from './schema.js';
import { newRecord, setVal, val, lastEdit, mergeRecord, isGone, markDeleted, restore } from './store.js';
import { openKeypad, closeKeypad } from './keypad.js';
import { workbook } from './export.js';
import * as cloud from './cloud.js';
import { qrcode } from './vendor/qrcode.js';
import * as wordview from './wordview.js';
import * as scan from './scan.js';
import * as scanImports from './scan-imports.js';
import * as pay from './pay.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const NS = DEMO ? 'prewarm-demo:' : 'prewarm:';
const $ = s => document.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const field = id => BY_ID[id] || EXTRA_BY_ID[id];
const GROUPS = [[1, '30 min pre-warming'], [2, '10 min pre-warming'], [3, 'No pre-warming']];

// Replace the screen. Blurring first lets a half-typed box commit its change before it disappears, and the guard
// stops that change from redrawing again mid-swap.
let painting = false, newer = null;
function paint(html) {
  if (painting) { newer = html; return; } // drawn by the blur's own handler: newer than ours
  painting = true; newer = null;
  try { if (view.contains(document.activeElement)) document.activeElement.blur(); view.innerHTML = newer ?? html; } finally { painting = false; }
}

// ---------- storage
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(NS + k)) ?? d; } catch { return d; } };
// a failed write stays on screen (a toast would be replaced at once by "… saved"): what's not stored here is lost on
// reload unless it reached the team
const write = (k, v) => {
  try { localStorage.setItem(NS + k, JSON.stringify(v)); if (k === 'patients') document.getElementById('storefull')?.remove(); return true; } catch {
    if (!document.getElementById('storefull')) document.body.insertAdjacentHTML('afterbegin', '<div id="storefull" class="storefull" role="alert">This phone couldn’t store the last change (storage full or blocked). Don’t close the app: export Excel from Settings, or ask the study admin.</div>');
    return false;
  }
};
let patients = read('patients', {});
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
const settings = Object.assign({ me: '', site: '', scan: false, hide: { skin: false, set: false, ts: false, warm: false, room: false, haemo15: false, bis: false },
  remind: { vibrate: true, beep: true, banner: true, awake: true, haemo: false } }, read('settings', {}));
const saveAll = () => write('patients', patients);
const saveSettings = () => write('settings', settings);
// settings v2 (owner, 12 Oct 2026): every reading is entered live by default, BP / HR / BIS every 15 min included
if ((settings.v || 0) < 2) { settings.hide.haemo15 = false; settings.v = 2; saveSettings(); }
// settings v3 (owner, 13 Oct 2026): the "Readings to enter live" section is gone, so nothing stays hidden from an old choice
if (settings.v < 3) { for (const k of Object.keys(settings.hide)) settings.hide[k] = false; settings.v = 3; saveSettings(); }
// Interface size (this phone only): zooms the whole screen. Normal is 100%.
const SIZES = [['0.85', 'Smaller'], ['0.92', 'Small'], ['1', 'Normal'], ['1.1', 'Large'], ['1.25', 'Larger']];
const applySize = z => document.documentElement.style.setProperty('--ui-zoom', SIZES.some(([k]) => k === String(z)) ? String(z) : '1');
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
const nowHM = () => new Date().toTimeString().slice(0, 5);
const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? +m[1] * 60 + +m[2] : null; };
const fromMin = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const sid = p => val(p, 'enrol_id') || 'New patient';
// "Subject ID: 85" wherever a patient is named on screen (owner, 13 Oct 2026)
const sidL = p => 'Subject ID: ' + sid(p);
function set(p, id, v) {
  if (p.lock?.on) return toast('Locked: read only. Unlock it on the home page to change it.');
  if (setVal(p, id, v, settings.me)) { saveAll(); sync(p, [id]); }
}

// ---------- sharing
const shared = { member: null, admin: false, email: '', uid: null, unwatch: null, stale: false };
// subjects this phone opened from Share subject links (owner, 21 Oct 2026): patient id -> { token, site }. A phone not on
// a team sees and edits only these (the rules let it read each one by id, nothing else)
let guest = read('guest', {});
const team = () => !!(shared.member || shared.admin);
const sharing = () => cloud.enabled && (team() || (!!shared.uid && Object.keys(guest).length > 0));
// shared subjects not already covered by the team's own list
const guestIds = () => shared.admin ? [] : Object.keys(guest).filter(id => guest[id].site !== shared.member?.site);
// send changed fields; Firestore keeps them on the phone and sends them when there is signal
// patients with changes sent but not yet confirmed by the server (no signal), kept across reloads; Log out warns
let pending = read('pending', {});
// patients whose last save did not reach the team and will not retry by itself: id -> why (14 Oct 2026). Shown in the chip.
let failed = read('failed', {});
const setFailed = (id, why) => { if (why) failed[id] = why; else if (id in failed) delete failed[id]; else return; write('failed', failed); showSync(); };
const sessionStart = Date.now();
// when this phone was last fully in step with the server (nothing waiting to send, team's changes received)
let lastSync = read('lastSync', 0);
function synced() {
  if (Object.keys(pending).length) return;
  lastSync = Date.now(); write('lastSync', lastSync); showSync();
}
function syncText() {
  if (!sharing()) return '';
  const n = Object.keys(pending).map(id => patients[id]).filter(p => p && !isGone(p)).length;
  const when = !lastSync ? '' : (() => {
    const m = (Date.now() - lastSync) / 60000, d = new Date(lastSync);
    if (m < 1) return 'just now';
    if (m < 60) return Math.floor(m) + ' min ago';
    const t = d.toTimeString().slice(0, 5);
    return d.toDateString() === new Date().toDateString() ? 'at ' + t : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + t;
  })();
  if (n) return `Not synced: ${n} patient${n === 1 ? '' : 's'} waiting for signal.${when ? ' Last synced ' + when + '.' : ''}`;
  return when ? `Synced ${when}.` : 'Not synced yet.';
}
// every "last synced" line on screen
function showSync() { paintSyncChip(); const t = syncText(); document.querySelectorAll('.syncline').forEach(el => { el.textContent = t; el.classList.toggle('late', /^Not/.test(t)); }); }
setInterval(showSync, 20000);
addEventListener('online', () => showSync()); addEventListener('offline', () => showSync());
function sync(p, ids, withLock = false) {
  if (!sharing()) return;
  // a phone with only shared subjects can't send its own patients anywhere
  if (!team() && !guest[p.id]) { setFailed(p.id, 'not shared: join your hospital’s team in Settings'); return; }
  // PACU answers also go to the nurse's link copy, so the nurse's phone sees them (owner, 13 Oct 2026)
  const ptok = pacuToken(p), pk = ptok && !p.lock?.on ? ids.filter(k => PACU_KEYS.includes(k)) : [];
  if (pk.length) cloud.pacuPush(ptok, pacuFields(p, pk)).catch(() => { /* retried by the heal below */ });
  p.site ||= val(p, 'site') || guest[p.id]?.site || shared.member?.site || settings.site;
  // no hospital: nothing can be sent. Say so instead of showing "Synced"
  if (!p.site) { setFailed(p.id, 'no hospital: set it in Settings'); return; }
  setFailed(p.id, null);
  const tok = Date.now() + Math.random();
  pending[p.id] = tok; write('pending', pending);
  showSync();
  const done = () => { if (pending[p.id] === tok) { delete pending[p.id]; write('pending', pending); synced(); } };
  cloud.push(p, ids, withLock).then(done).catch(e => {
    // refused (e.g. an admin locked the patient meanwhile): the server drops the change, so it isn't waiting either
    // it stays marked as failed (chip turns red) until a later save reaches the team
    if (e?.code === 'permission-denied') { done(); setFailed(p.id, 'refused (locked by the study admin?)'); toast(`${sid(p)}: ${cloud.friendly(e, 'save')}`); }
    else { setFailed(p.id, 'could not be saved'); toast(cloud.friendly(e, 'save')); }
  });
}
// Log out (owner, 12 Oct 2026): leaves the team and deletes every patient on this phone, after a warning, and a
// second one if some changes haven't reached the team yet. Settings (initials, display) stay.
async function logOut(btn) {
  const n = Object.values(patients).filter(p => !isGone(p)).length;
  const who = shared.member ? `the ${shared.member.site} team` : 'the study';
  if (!confirm(`Log out of ${who} on this phone?\n\nThis deletes all ${n} patient${n === 1 ? '' : 's'} from this phone. What has synced stays with your team.`)) return;
  btn.disabled = true; btn.textContent = 'Checking everything has synced…';
  if (Object.keys(pending).length && await cloud.flushed(6000)) { pending = {}; write('pending', pending); synced(); }
  const unsynced = [...new Set([...Object.keys(pending), ...Object.keys(failed)])].map(id => patients[id]).filter(p => p && !isGone(p)).map(sid);
  if (unsynced.length && !confirm(`Not synced yet: ${unsynced.join(', ')}.${lastSync ? ' ' + syncText().replace(/^Not synced:[^.]*\. ?/, '') : ''}\n\nThese changes haven’t reached your team (no signal?). Logging out now loses them. Cancel, get signal and wait a moment, or Export Excel first.\n\nLog out anyway and lose them?`)) {
    btn.disabled = false; btn.textContent = 'Log out'; return;
  }
  shared.unwatch?.();
  await cloud.logOut();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(NS) && k !== NS + 'settings') localStorage.removeItem(k); } catch { /* storage blocked */ }
  location.replace(location.pathname + location.search + '#/');
  location.reload();
}
// ---------- PACU nurse link (owner, 13 Oct 2026)
// pacu/{token} holds a copy of one participant's PACU answers. A member makes it (the token is the secret: a link and QR
// code on the PACU page); the nurse's phone opens #/nurse/<token> and can write only those answers; members' phones
// merge what the nurse writes into the patient (newest field wins, like everywhere else).
const pacuToken = p => p.f.pacu_token?.v || null;
const pacuFields = (p, keys = PACU_KEYS) => Object.fromEntries(keys.filter(k => p.f[k]).map(k => [k, p.f[k]]));
const pacuUrl = token => `${location.origin}${location.pathname}${/[?&]emulator/.test(location.search) ? '?emulator' : ''}#/nurse/${token}`;
const pacuSubs = new Map(); // token -> unsubscribe
// a value from the link only if it is a plain short answer for a PACU field
const pacuClean = (k, x) => PACU_KEYS.includes(k) && x && typeof x === 'object' && typeof x.t === 'number'
  && (x.v == null || (typeof x.v === 'string' && x.v.length <= 200) || typeof x.v === 'number');
function watchPacu() {
  if (!sharing()) return;
  for (const p of Object.values(patients)) {
    const token = pacuToken(p);
    if (!token || pacuSubs.has(token) || isGone(p)) continue;
    pacuSubs.set(token, null);
    cloud.pacuWatch(token, data => {
      const cur = patients[p.id];
      if (!data || !cur || cur.lock?.on) return;
      const ch = [];
      for (const [k, x] of Object.entries(data.f || {})) {
        if (!pacuClean(k, x) || (cur.f[k]?.t || 0) >= x.t) continue;
        cur.f[k] = { v: x.v ?? null, t: x.t, by: String(x.by || '').slice(0, 20), ...(x.auto ? { auto: true } : {}) };
        ch.push(k);
      }
      if (!ch.length) return;
      saveAll(); sync(cur, ch);
      const h = location.hash.slice(1) || '/', typing = view.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
      if (new RegExp(`^/(pacu/${p.id}|p/${p.id}(/form/pacu)?)$|^/$|^/pacu$`).test(h) && !typing && !leaveGuard?.() && !document.querySelector('dialog[open]')) render();
      else { shared.stale = true; const b = $('#fresh'); if (b) b.hidden = false; }
    }, () => { /* the link was stopped, or no signal: the patient's own PACU page still works */ })
      .then(u => { if (pacuSubs.has(token)) pacuSubs.set(token, u); else u?.(); }).catch(() => pacuSubs.delete(token));
  }
}
async function makePacuLink(p) {
  if (!sharing()) return toast('Join your hospital’s team in Settings first.');
  const site = p.site || val(p, 'site') || shared.member?.site || settings.site;
  if (!site) return toast('Set your hospital in Settings first.');
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(b, x => abc[x % 32]).join(''); // 24 characters of 5 bits: not guessable
  try {
    await Promise.race([cloud.pacuCreate(token, { site, pid: p.id, sid: sid(p), created: Date.now(), f: pacuFields(p) }),
      new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 8000))]);
  } catch (e) { return toast(cloud.friendly(e)); }
  p.site ||= site;
  set(p, 'pacu_token', token); watchPacu();
}
async function stopPacuLink(p) {
  const token = pacuToken(p); if (!token) return;
  try { await Promise.race([cloud.pacuStop(token), new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 8000))]); }
  catch (e) { return toast(cloud.friendly(e)); }
  pacuSubs.get(token)?.(); pacuSubs.delete(token);
  set(p, 'pacu_token', null);
}
function pacuLinkHtml(p) {
  const head = '<h2>PACU nurse link</h2>', tk = pacuToken(p);
  if (!cloud.enabled) return `<div class="paculink">${head}<p class="muted small">Not available in demo mode.</p></div>`;
  if (!sharing()) return `<div class="paculink">${head}<p class="muted small">Join your hospital’s team (Settings) to make a link for the PACU nurse.</p></div>`;
  if (!tk) return `<div class="paculink">${head}<p class="muted small">The link couldn’t be made just now (no signal?). It opens only this participant’s PACU page, so the PACU nurse can fill it in on their own phone.</p>
    <button class="secondary" data-pacu-make>Try again</button></div>`;
  const url = pacuUrl(tk);
  return `<div class="paculink">${head}<div class="qr">${qrSvg(url, 'QR code of the PACU nurse link')}</div>
    <input class="pacuurl" readonly value="${esc(url)}" aria-label="PACU nurse link">
    <div class="sharerow"><button class="primary" data-pacu-share>Share link</button><button class="secondary" data-pacu-copy>Copy link</button></div>
    <p class="muted small">Opens only ${esc(sid(p))}’s PACU page. Show the QR code to the PACU nurse or send the link. It stays the same for this participant${shared.admin ? '' : '; only a study admin can stop it'}.</p>
    ${shared.admin ? '<button class="link" data-pacu-stop>Stop this link (admin)</button>' : ''}</div>`;
}

// Refresh now (owner, 13 Oct 2026): fetch the team's latest data again and look for a new app version
let swReg = null, offerUpdate = null;
const refreshHtml = () => `<div class="refreshbox"><button class="secondary" id="refreshnow">Refresh now</button><small class="muted">Gets the team’s latest data again, sends anything waiting, and checks for a new app version. <span id="appver"></span></small><a class="link" href="${UPDATE_HELPER}">App still won’t update? Get the latest version</a></div>`;
async function refreshNow(btn) {
  const chip = btn.id === 'syncchip'; // the bar's chip keeps its own text
  btn.disabled = true; const was = btn.textContent; if (!chip) btn.textContent = 'Refreshing…'; else btn.dataset.busy = '1';
  let msg = 'Up to date.';
  try {
    if (cloud.enabled) {
      // who this phone is: a new admin-list entry or team membership counts without logging out
      const u = await cloud.whoAmI();
      if (u) { shared.member = await cloud.member(); shared.admin = !u.isAnonymous ? await cloud.isAdmin() : false; shared.email = u.email || ''; shared.uid = u.uid; }
    }
    if (cloud.enabled && sharing()) { uploadLocal(); await watch(); if (!(await cloud.flushed(5000))) msg = 'Refreshed, but some changes are still waiting for signal.'; }
    if (swReg) {
      await swReg.update().catch(() => {});
      const w = swReg.installing;
      if (w && w.state !== 'installed') await new Promise(ok => { const t = setTimeout(ok, 8000); w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); ok(); } }); });
      if (swReg.waiting && navigator.serviceWorker.controller) { offerUpdate?.(swReg.waiting); msg = 'A new app version is ready: tap “Update available” at the top.'; }
    }
  } catch { msg = 'Couldn’t refresh. Check your signal and try again.'; }
  btn.disabled = false; if (!chip) btn.textContent = was; else delete btn.dataset.busy; paintSyncChip(); toast(msg);
  if (/^#\/(settings)?$/.test(location.hash) || !location.hash) render();
}
// which app version this phone is running (the saved copy's name), so a phone stuck on an old one can be spotted
const wireRefresh = () => {
  $('#refreshnow')?.addEventListener('click', e => refreshNow(e.target));
  const el = $('#appver'); if (el && window.caches) caches.keys().then(ks => { const k = ks.find(x => x.startsWith('prewarm-')); if (k && $('#appver')) { const v = k.replace('prewarm-', ''), d = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/.exec(v); $('#appver').textContent = 'App version ' + (d ? `${d[1]} (${d[2]})` : v); } }).catch(() => {});
};
// one record from the server into this phone's copy; true if the phone's copy changed
function take(r) {
  const local = patients[r.id];
  if (!local) { patients[r.id] = { ...r, f: { ...r.f } }; return true; }
  const m = mergeRecord(local, r);
  // in place: open screens hold this object
  if (m.changed) Object.assign(local, m.rec, { site: local.site || r.site });
  // heal (bug hunt, 12 Oct 2026): the server keeps whichever write arrived last, not the newest; anything this
  // phone holds newer than the copy it just heard goes back up, so both phones and the server settle on the newest
  if (!local.lock?.on && !r.lock?.on) {
    const newer = Object.keys(local.f).filter(k => (local.f[k]?.t || 0) > (r.f?.[k]?.t || 0));
    if (newer.length) sync(local, newer);
  }
  return m.changed;
}
// new data on screen: redraw unless someone is typing (a focused link or button is fine)
function redraw() {
  saveAll();
  const h = location.hash.slice(1) || '/';
  const typing = view.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
  if (/^\/$|^\/p\/\w+$|\/sheet$/.test(h) && !typing && !leaveGuard?.()) render();
  else { shared.stale = true; const b = $('#fresh'); if (b) b.hidden = false; }
}
let guestSubs = [];
async function watch() {
  shared.unwatch?.(); shared.unwatch = null;
  for (const u of guestSubs) u?.(); guestSubs = [];
  for (const u of pacuSubs.values()) u?.(); pacuSubs.clear();
  if (!sharing()) return;
  watchGuests();
  if (!team()) return;
  const seen = new Set();
  let healedAll = false;
  shared.unwatch = await cloud.watchPatients(shared.admin ? null : shared.member.site, (list, meta) => {
    let changed = false;
    // a member's phone: a patient locked by an admin leaves the team's query, so it goes from this phone, unless it
    // has changes the server never took: then it stays here (export it, ask the admin to unlock)
    if (!shared.admin) for (const id of meta.removed || []) {
      if (!patients[id]) continue;
      if (pending[id]) { toast(`${sid(patients[id])} was locked by the study admin before your last changes reached the team. They stay on this phone: ask the admin to unlock it.`); continue; }
      delete patients[id]; delete pending[id]; changed = true;
    }
    if (changed) write('pending', pending);
    for (const r of list) { seen.add(r.id); if (take(r)) changed = true; }
    if (meta.server && !healedAll) {
      healedAll = true;
      // patients on this phone the server has never had (made before sign-in finished, or before signal): send whole
      for (const p of Object.values(patients)) {
        if (seen.has(p.id) || guestIds().includes(p.id) || p.lock?.on || !Object.keys(p.f).length) continue;
        const site = val(p, 'site') || p.site;
        if (!shared.admin && site && site !== shared.member?.site) continue;
        sync(p, Object.keys(p.f));
      }
      // changes waiting from an earlier visit were sent again just above if still newer: stop counting them
      for (const [id, tok] of Object.entries(pending)) if (tok < sessionStart) delete pending[id];
      write('pending', pending);
    }
    if (meta.server) { synced(); resyncOnce(); }
    watchPacu();
    if (changed) redraw();
  }, async e => {
    // refused right after a wrong join code (the phone's own copy of the refused join made it look like a member):
    // check with the server; not a member means just stop listening, the join screen already said why
    if (e?.code === 'permission-denied' && !shared.admin && !(await cloud.member())) { shared.member = null; shared.unwatch?.(); shared.unwatch = null; return; }
    toast(cloud.friendly(e));
  });
}
// each subject opened from a Share subject link, one by one (a guest can't ask for a list). The link stopped or the
// subject locked: refused, so the subject leaves this phone (unless it holds changes the server never took)
function watchGuests() {
  for (const id of guestIds()) {
    cloud.watchPatient(id, (list, meta) => {
      let changed = false;
      for (const r of list) if (take(r)) changed = true;
      if (meta.removed.length && patients[id] && !pending[id]) { delete patients[id]; changed = true; }
      if (meta.server) synced();
      watchPacu();
      if (changed) redraw();
    }, e => {
      if (e?.code !== 'permission-denied') return toast(cloud.friendly(e));
      const p = patients[id], name = p ? sid(p) : 'A shared subject';
      delete guest[id]; write('guest', guest);
      if (p && !pending[id] && !failed[id]) delete patients[id];
      toast(`${name}: its share link was stopped or the subject was locked, so it is no longer on this phone.`);
      redraw();
    }).then(u => guestSubs.push(u)).catch(() => {});
  }
}
// Repair (12 Oct 2026): a lock, unlock or delete briefly sent an empty f, which wiped the readings on the server copy.
// Once, after the phone has the server's latest (so nothing newer is overwritten), send every patient whole again.
function resyncOnce() {
  // resync2: also gives older records the locked flag the team's query filters on
  if (read('resync2', false) || !team()) return;
  write('resync2', true);
  for (const p of Object.values(patients)) {
    const site = val(p, 'site') || p.site;
    if (!shared.admin && site !== shared.member?.site) continue;
    if (Object.keys(p.f).length) sync(p, Object.keys(p.f));
  }
}
function uploadLocal() {
  if (!shared.member) return;
  const key = 'uploaded:' + shared.member.site;
  if (read(key, false)) return;
  for (const p of Object.values(patients)) {
    const site = val(p, 'site') || p.site;
    if (site && site !== shared.member.site) continue;
    if (!site) setVal(p, 'site', shared.member.site, settings.me);
    sync(p, Object.keys(p.f));
  }
  saveAll(); write(key, true);
}
// opened from an admin's emailed sign-in link
async function finishAdmin(email) {
  if (!email) return toast('Enter the email the link was sent to.');
  try { await cloud.finishAdminLink(email); toast('Signed in'); }
  catch (err) { toast(cloud.friendly(err)); go('#/settings'); }
}
if (cloud.enabled && cloud.isAdminLink()) {
  const email = cloud.savedAdminEmail();
  if (email) finishAdmin(email);
  else location.hash = '#/confirm';
}
if (cloud.enabled) cloud.onUser(async u => {
  const before = sharing();
  shared.member = u ? await cloud.member() : null;
  shared.admin = u && !u.isAnonymous ? await cloud.isAdmin() : false;
  shared.email = u?.email || '';
  shared.uid = u?.uid || null;
  if (shared.member) { settings.site = shared.member.site; if (!settings.me && shared.member.initials) settings.me = shared.member.initials; saveSettings(); }
  uploadLocal();
  await watch();
  // changes held over from an earlier visit: the first word from the server sends again anything still newer (watch)
  document.body.dataset.cloud = 'ready';
  // redraw only when sharing changed, so a half-typed join code isn't wiped
  if (before !== sharing() && !view.contains(document.activeElement)) render();
});
let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }

// Which columns of a series are shown (Settings hides some)
function colsFor(s, pt) {
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
function pointsFor(p, s) {
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
function dueOf(p, s, pt) {
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
const SANE = { sbp: [40, 260], dbp: [20, 160], map: [30, 200], hr: [20, 220], bis: [0, 100], room: [10, 40] };
const refOf = (p, s) => SERIES[s].ref.map(id => toMin(val(p, id))).find(x => x != null) ?? null;
// the clock counted from the same day as the series' start, so a case running past midnight still compares right
function nowFor(p, s) {
  const n = nowMin(), r = refOf(p, s);
  return r == null ? n : n + 1440 * Math.round((r - n) / 1440);
}
// readings due after that stage ended (into OT for pre-warming, surgery end for intra-op) aren't expected
// the End reading, once saved, is the last temperature: nothing later is due, even if Surgery end wasn't logged (owner, 20 Oct 2026)
function expected(p, s, due) {
  let end = toMin(val(p, s === 'prewarm' ? 'ev_ot' : 'io_done'));
  if (end == null && s === 'iotemp') end = toMin(savedAt(p, s, 'end'));
  const r = refOf(p, s);
  if (end == null || r == null) return true;
  while (end < r) end += 1440;
  return due <= end;
}
const savedAt = (p, s, key) => val(p, `at_${s}_${key}`);
const noWarming = p => String(val(p, 'arm')) === '3';
// gown set temp is NA for the no-pre-warming group and once active warming has stopped
function setTempNA(p, pt) {
  if (noWarming(p)) return true;
  const stop = toMin(val(p, 'ev_wstop')), due = dueOf(p, 'prewarm', pt);
  return stop != null && due != null && due > stop;
}

// ---------- routing
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
let cleanup = [];
// a reading screen with changes not yet saved sets this: it returns { what, save } while there is something to lose.
// Each history entry carries its place (state.i), so leaving can be undone by stepping back the same way and redone
// once answered: the phone's back button never walks out of the app past an unsaved reading.
let leaveGuard = null, shown = location.hash, at = history.state?.i ?? 0, restoring = false;
function render() {
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
  if (lockedHere && !canLock()) { toast('Locked by the study admin'); location.replace('#/'); return; }
  document.body.classList.toggle('ro', lockedHere);
  for (const [re, fn] of routes) { const m = re.exec(h); if (m) { fn(...m.slice(1)); window.scrollTo(0, 0); return; } }
  home();
}
window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', e => { if (leaveGuard?.()) e.preventDefault(); });
// After a tap that moves or redraws the screen (Save, Log, a time, a comfort answer), taps are ignored for a moment: a
// double tap otherwise lands on whatever moved under the finger (the next timepoint's Save, the next event's Log).
// Prompts (the save dialog) aren't affected.
// Only a tap near the one just handled is ignored (a double tap lands in the same place; a quick tap elsewhere is fine).
let tapLockUntil = 0, tapAt = { x: -99, y: -99 }, lockAt = tapAt;
document.addEventListener('pointerdown', e => { tapAt = { x: e.clientX, y: e.clientY }; }, true);
const lockTaps = (ms = 700) => { tapLockUntil = Date.now() + ms; lockAt = tapAt; };
document.addEventListener('click', e => {
  if (Date.now() >= tapLockUntil || e.target.closest('dialog')) return;
  if (Math.hypot(e.clientX - lockAt.x, e.clientY - lockAt.y) < 48) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
// a reading's number shrinks until it fits between − and + (Large / Larger sizes and small phones cut 36.7 to "36.")
function fitNums() {
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
function askTime(q, def) {
  const r = prompt(q + '\n\n24-hour time, e.g. 08:05', def || '');
  if (r == null) return null;
  const m = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/.exec(r);
  if (!m || +m[1] > 23 || +m[2] > 59) { toast('Enter the time as hh:mm, e.g. 08:05.'); return null; }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
// run fn now, or after the save prompt when a reading on screen has unsaved changes
function afterAsking(fn) { const g = leaveGuard?.(); if (g) askLeave(g, () => { leaveGuard = null; fn(); }); else fn(); }
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
$('#banner').onclick = () => { $('#banner').hidden = true; const t = bannerTarget; bannerTarget = null; if (t) openTarget(t, false); };
// the due banner floats over the top of the page, just under the bar: nothing moves under a finger as it appears
// (it used to push the page down, so a tap meant for Save landed on another box); a tap on it only hides it
let bannerTimer, bannerTarget = null;
function showBanner(text, ms, target = null) {
  const b = $('#banner'); bannerTarget = target;
  b.style.top = Math.max(0, $('header.bar').getBoundingClientRect().bottom) + 'px';
  b.textContent = text; b.hidden = false;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}
// the bar shows a small "Subject ID" above the ID, so the long title doesn't crowd the countdown and Log
function setTitle(title) {
  const m = /^Subject ID: (.*)$/.exec(title), el = $('#title');
  if (m) el.innerHTML = `<small class="idlab">Subject ID</small><span>${esc(m[1])}</span>`; else el.textContent = title;
}
function header(title, back, extra = '') {
  $('#ptabs').hidden = true; $('#ptabs').innerHTML = '';
  setTitle(title);
  $('#back').hidden = !back; $('#back').onclick = () => go(back);
  $('#extra').innerHTML = extra;
}

// ---------- home
route(/^\/$/, home);
// Locking (owner, 12 Oct 2026): a study admin (or anyone, in demo mode) picks patients on the home page and locks
// them; nobody can open a locked patient, and the rules stop members changing it, until an admin unlocks it.
const canLock = () => shared.admin || DEMO;
const LOCK_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
// the update helper page: out of the app's service-worker scope on the old address, inside the app's folder on the new one
const UPDATE_HELPER = location.hostname === 'prewarmstudy.anawj.com' ? 'update.html' : '../prewarm-update/';
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
const PACU_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/></svg>';
let selecting = null; // Set of patient ids while choosing which to lock / unlock, or to export
let selMode = 'lock'; // what the selection is for: 'lock' or 'export'
function setLock(ids, on) {
  const by = shared.email || settings.me || 'admin';
  for (const id of ids) {
    const p = patients[id]; if (!p) continue;
    p.lock = { on, t: Math.max(Date.now(), (p.lock?.t || 0) + 1), by };
    // locking sends the whole record (repairs a server copy); unlocking only the lock (all a locked patient allows)
    sync(p, on ? Object.keys(p.f) : [], true);
  }
  saveAll();
}
let homeStop = null;
function home() {
  header('Prewarming study' + (DEMO ? ' (demo)' : ''), null, `<a class="iconbtn" href="#/settings" aria-label="Settings">⚙</a>`);
  // largest Subject ID on top (owner, 21 Oct 2026), numbers compared as numbers (S-10 above S-9)
  const all = Object.values(patients).filter(p => !isGone(p));
  const list = [...all].sort((a, b) => String(val(b, 'enrol_id') ?? '').localeCompare(String(val(a, 'enrol_id') ?? ''), undefined, { numeric: true, sensitivity: 'base' }) || b.created - a.created);
  if (selecting && selMode === 'lock' && !canLock()) selecting = null;
  const latest = [...all].sort((a, b) => (lastEdit(b)?.t || b.created) - (lastEdit(a)?.t || a.created))[0];
  paint(`
    ${settings.me && settings.site ? '' : `<div class="note">Add your ${settings.me ? '' : 'initials and '}hospital in <a href="#/settings">Settings</a>${settings.me ? '' : ' so each reading shows who entered it'}.</div>`}
    <div class="newrow"><button class="primary big" id="new">+ New patient</button><a class="secondary big" id="payview" href="#/paynow" title="Each participant's email and PayNow for their payment">Email / PayNow</a></div>
    <div class="listhead"><h2>Patients on this phone</h2>${list.length && !selecting ? `<span class="headlinks">${canLock() ? '<button class="link" id="select">Select to lock</button>' : ''}<button class="link" id="selexport">Select to export</button></span>` : ''}</div>
    ${selecting ? `<div class="seltools"><span class="selcount">${selecting.size} selected${selMode === 'export' ? ' to export' : ''}</span>
      <div class="selshort" role="group" aria-label="Quick selection"><button class="selchip" id="${selMode === 'export' ? 'selallx' : 'selall'}">${selMode === 'export' ? 'Select all' : latest && list.length > 1 ? `All but ${esc(sid(latest))} (latest)` : 'Select all'}</button><button class="selchip" id="selnone">Select none</button></div>
      <div class="selacts">${selMode === 'export'
        ? `<button class="primary" id="exportsel" ${selecting.size ? '' : 'disabled'}>Export ${selecting.size || ''} to Excel</button>`
        : `<button class="primary" id="lock" ${selecting.size ? '' : 'disabled'}>${LOCK_ICON} Lock</button><button class="secondary" id="unlock" ${selecting.size ? '' : 'disabled'}>Unlock</button>`}</div>
      <button class="link" id="seldone">Done</button></div>` : ''}
    ${list.length > 5 ? '<input class="search" id="psearch" type="search" placeholder="Find a Subject ID" aria-label="Find a patient by Subject ID" autocomplete="off">' : ''}
    ${list.length ? `<ul class="list">${list.map(p => {
      const e = lastEdit(p), locked = p.lock?.on, sa = ` data-sid="${esc(sid(p).toLowerCase())}"`;
      // the same Subject ID on two records (e.g. made on two phones without signal): readings are split between them
      const twin = list.some(q => q !== p && String(val(q, 'enrol_id') || '').toLowerCase() === String(val(p, 'enrol_id') || '').toLowerCase() && (val(q, 'site') || '') === (val(p, 'site') || ''));
      const body = `<b>${esc(sidL(p))}${val(p, 'site') ? ` <small>${esc(val(p, 'site'))}</small>` : ''}</b>${twin ? '<span class="twinline">Same Subject ID twice: readings may be split. Fill in one and correct the other’s ID (Pre-op and patient details), or delete it in Settings.</span>' : ''}<span${locked ? ' class="lockline"' : declined(p) ? ' class="declline"' : val(p, 'done') ? ' class="okline"' : ''}>${locked ? `${LOCK_ICON} Locked by the study admin${canLock() ? ' · read only' : ''}` : declined(p) ? 'Declined to participate' : esc(status(p))}</span>
        ${pending[p.id] || failed[p.id] ? `<span class="unsent">${failed[p.id] ? 'Not saved to the team' : 'Not sent yet'}</span>` : ''}<span class="dueline" data-due="${p.id}" hidden></span>${podDue(p) ? `<span class="podline">${esc(podDue(p))}</span>` : ''}${progressHtml(p)}<small>${e ? 'Last entry ' + new Date(e.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (e.by ? ' by ' + esc(e.by) : '') : 'No entries yet'}</small>`;
      if (selecting) return `<li${sa}><label class="selrow"><input type="checkbox" data-sel="${p.id}" ${selecting.has(p.id) ? 'checked' : ''}><span>${body}</span></label></li>`;
      // Share (this participant) and PACU (the nurse link) beside every line (owner, 21 Oct 2026; was the admins' Form view icon)
      const acts = declined(p) ? '' : `<span class="rowbtns"><a class="rowbtn" href="#/p/${p.id}/share/h" aria-label="Share ${esc(sidL(p))}">${SHARE_ICON}<small>Share</small></a><a class="rowbtn" href="#/p/${p.id}/pacushare/h" aria-label="Share ${esc(sidL(p))} to PACU">${PACU_ICON}<small>PACU</small></a></span>`;
      if (locked) return `<li${sa}><a href="${canLock() ? '#/p/' + p.id : '#/'}" class="locked"${canLock() ? '' : ' data-locked="1"'}>${body}</a></li>`;
      return `<li${sa} class="${acts ? 'rowact' : ''}"><a href="${isDraft(p) ? '#/new/' + p.id : nextHref(p)}"${declined(p) ? ' class="declined"' : isDraft(p) ? ' class="draft"' : ''}${val(p, 'done') ? ` data-done="${esc(val(p, 'done'))}"` : ''}>${body}</a>${acts}</li>`;
    }).join('')}</ul>` : `<p class="muted">No patients yet. Tap <b>New patient</b> on the morning of surgery.</p>`}
    <p class="muted small">${sharing() ? `Shared with the ${esc(shared.admin ? 'whole study (admin)' : shared.member ? shared.member.site + ' team' : 'study team (only the subjects shared with this phone)')}. Readings sync when there is signal. <b class="syncline">${esc(syncText())}</b>` : `Data stays on this phone. <a href="#/settings">Join your hospital’s team</a> to share patients.`}</p>${refreshHtml()}`);
  $('#psearch')?.addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); view.querySelectorAll('.list li[data-sid]').forEach(li => { li.hidden = !!q && !li.dataset.sid.includes(q); }); });
  wireRefresh();
  $('#new').onclick = () => go('#/new');
  // what each patient being charted needs now (a reading or Prewarm off due within 2 min, or late)
  const dues = () => view.querySelectorAll('[data-due]').forEach(el => {
    const q = patients[el.dataset.due], n = q && charting(q) ? nextDue(q, defaultSeries(q)) : null;
    const show = n && n.left <= 2;
    el.hidden = !show;
    if (show) { el.dataset.state = n.left > 0 ? 'soon' : n.left > -5 ? 'now' : 'late'; el.textContent = `${n.label}: ${n.left > 0 ? 'in ' + mmss(n.left) : n.left > -5 ? 'due now' : 'late ' + mmss(-n.left)}`; }
  });
  dues();
  // home() also redraws itself (choosing patients to lock): one timer and one alert loop at a time
  homeStop?.();
  const div = setInterval(dues, 1000), stopAlerts = startAlerts(null);
  homeStop = () => { clearInterval(div); stopAlerts(); homeStop = null; };
  cleanup.push(homeStop);
  view.querySelectorAll('.list a[data-locked]').forEach(a => a.onclick = e => { e.preventDefault(); toast('Locked by the study admin'); });
  if ($('#select')) $('#select').onclick = () => { selMode = 'lock'; selecting = new Set(); home(); };
  if ($('#selexport')) $('#selexport').onclick = () => { selMode = 'export'; selecting = new Set(); home(); };
  if (selecting) {
    view.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? selecting.add(c.dataset.sel) : selecting.delete(c.dataset.sel); home(); });
    if ($('#selall')) $('#selall').onclick = () => { selecting = new Set(list.filter(p => p !== latest).map(p => p.id)); home(); };
    if ($('#selallx')) $('#selallx').onclick = () => { selecting = new Set(list.map(p => p.id)); home(); };
    $('#selnone').onclick = () => { selecting = new Set(); home(); };
    $('#seldone').onclick = () => { selecting = null; home(); };
    if ($('#exportsel')) $('#exportsel').onclick = () => downloadWorkbook([...selecting].map(id => patients[id]).filter(Boolean));
    if (selMode === 'lock') {
    $('#lock').onclick = () => {
      const n = selecting.size;
      // a patient changed in the last 3 hours and not marked complete may still be charted on a team phone
      const busy = [...selecting].map(id => patients[id]).filter(p => p && !val(p, 'done') && Date.now() - (lastEdit(p)?.t || 0) < 3 * 3600e3).map(sid);
      if (!confirm(`Lock ${n} patient${n === 1 ? '' : 's'}?\n\nNobody can open ${n === 1 ? 'it' : 'them'} until an admin unlocks${sharing() ? ', and phones can’t change ' + (n === 1 ? 'it' : 'them') : ''}.${busy.length ? `\n\nStill being charted? ${busy.join(', ')} changed in the last 3 hours and ${busy.length === 1 ? 'isn’t' : 'aren’t'} marked complete: a team phone's unsent readings for ${busy.length === 1 ? 'it' : 'them'} would be refused.` : ''}`)) return;
      setLock(selecting, true); toast(n + ' locked'); selecting = null; home();
    };
    $('#unlock').onclick = () => { const n = selecting.size; setLock(selecting, false); toast(n + ' unlocked'); selecting = null; home(); };
    }
  }
  // a patient marked complete: warn on the first tap, open on the second
  view.querySelectorAll('.list a[data-done]').forEach(a => a.onclick = e => {
    if (a.dataset.warned) return;
    e.preventDefault(); a.dataset.warned = 1; a.classList.add('warned');
    a.insertAdjacentHTML('beforeend', `<em class="warnline">Data collection was marked complete${a.dataset.done ? ' (' + esc(a.dataset.done) + ')' : ''}. Tap again to open it; any change is recorded with your initials.</em>`);
  });
}
// chart-review days (14 Oct 2026): POD1 / POD2 are due the first and second calendar day after surgery, until their
// Complete tick. Surgery date = the Surgery date field, else the day the patient was started on this phone.
function podDays(p) {
  if (isGone(p) || declined(p) || isDraft(p) || status(p) === 'Not started') return null;
  const od = val(p, 'op_date'), start = od && /^\d{4}-\d{2}-\d{2}$/.test(od) ? new Date(od + 'T00:00:00') : new Date(new Date(p.created || Date.now()).toDateString());
  return Math.round((new Date(new Date().toDateString()) - start) / 864e5);
}
function podDue(p) {
  const days = podDays(p); if (days == null) return '';
  const out = [];
  for (const [n, sign] of [[1, 'sign_pod1'], [2, 'sign_pod2']]) if (days >= n && !val(p, sign)) out.push(`POD${n} ${days > n ? 'overdue' : 'due today'}`);
  return out.join(' · ');
}
const declined = p => String(val(p, 'consent_st')) === '0';
function status(p) {
  if (val(p, 'done')) return '✓ Data collection complete';
  if (val(p, 'pacu_in')) return 'PACU';
  if (val(p, 'io_knife') || val(p, 'ev_ot')) return 'In OT';
  if (val(p, 'pw_start') || val(p, 'pw_gown')) return 'Pre-warming';
  if (val(p, 'arm') == null) return 'Draft: group not chosen yet';
  return 'Not started';
}

// New patient (owner, 21 Oct 2026): Start needs the group; Save draft and Patient declined need only the Subject ID;
// Share subject / Share to PACU save a draft first, so a case can be shared before it starts. A draft (no group, not
// declined) opens here again from the list.
const isDraft = p => val(p, 'arm') == null && !declined(p);
route(/^\/new(?:\/(\w+))?$/, draftId => {
  const draft = draftId ? patients[draftId] : null;
  if (draftId && (!draft || !isDraft(draft))) return go(draft ? '#/p/' + draftId : '#/');
  header(draft ? 'Draft: ' + sid(draft) : 'New patient', '#/');
  paint(`<form id="f" class="stack">
    <label class="lab" for="sid">Subject ID</label><input id="sid" required autocomplete="off" autocapitalize="characters" value="${esc(draft ? val(draft, 'enrol_id') || '' : '')}">
    <span class="lab">Randomisation group</span>
    <div class="seg col">${GROUPS.map(([v, l]) => `<button type="button" class="chip" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="muted small">After this, the group shows only on the Induction room tab.</p>
    <button class="primary big" type="submit">Start</button>
    <div class="sharerow"><button type="button" class="secondary" id="draft">Save draft</button><button type="button" class="secondary" id="declined">Patient declined</button></div>
    <div class="sharerow caseshare"><button type="button" class="secondary" id="nshare">Share subject</button><button type="button" class="secondary" id="npacu">Share to PACU</button></div>
    <small class="muted">Share before the case starts: the patient is saved as a draft first.</small></form>`);
  let arm = null;
  view.querySelectorAll('.seg .chip').forEach(b => b.onclick = () => { arm = +b.dataset.v; view.querySelectorAll('.seg .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  // the record for what is on screen (the draft, or a new one); null with a message when the Subject ID won't do
  const save = () => {
    const id = $('#sid').value.trim();
    if (!id) { toast('Enter the Subject ID.'); return null; }
    if (Object.values(patients).some(p => p !== draft && !isGone(p) && String(val(p, 'enrol_id')).toLowerCase() === id.toLowerCase())) { toast('That Subject ID is already on this phone.'); return null; }
    const p = draft || newRecord();
    if (!draft) { patients[p.id] = p; if (settings.site) set(p, 'site', settings.site); }
    if (val(p, 'enrol_id') !== id) set(p, 'enrol_id', id);
    if (arm) set(p, 'arm', arm);
    saveAll();
    return p;
  };
  $('#f').onsubmit = e => {
    e.preventDefault();
    if (!$('#sid').value.trim()) return toast('Enter the Subject ID.');
    if (!arm) return toast('Choose the randomisation group.');
    const p = save(); if (!p) return;
    // Start opens the Induction room tab for every group, no pre-warming too (owner, 21 Oct 2026)
    go('#/p/' + p.id + '/prewarm');
  };
  $('#draft').onclick = () => { const p = save(); if (!p) return; toast(val(p, 'arm') == null ? 'Draft saved: tap it on the list to choose the group and start' : 'Saved'); go(val(p, 'arm') == null ? '#/' : '#/p/' + p.id + '/prewarm'); };
  $('#declined').onclick = () => {
    if (!$('#sid').value.trim()) return toast('Enter the Subject ID.');
    if (!confirm(`Record ${$('#sid').value.trim()} as declined to participate?`)) return;
    const p = save(); if (!p) return;
    set(p, 'consent_st', 0); toast('Recorded as declined'); go('#/');
  };
  $('#nshare').onclick = () => { const p = save(); if (p) go(`#/p/${p.id}/share`); };
  $('#npacu').onclick = () => { const p = save(); if (p) go(`#/p/${p.id}/pacushare`); };
});

// ---------- patient main screen: event times, temperatures, then links to the other forms in the order they are
// filled in. BP/HR/BIS uses the same reading screen without the times.
const EVENTS = [['pw_gown', 'Gown on'], ['pw_start', 'Prewarm on', 'pw'], ['ev_wstop', 'Prewarm off', 'pw'], ['ev_ot', 'In OT'],
  ['io_knife', 'Induction'], ['io_flip', 'Prone'], ['io_under_start', 'Under­body warm'], ['io_gown_start', 'Gown warm'],
  ['io_done', 'Surgery end'], ['pacu_in', 'PACU in'], ['pacu_out', 'To ward']];
// the gown and Bair Hugger times, coloured warm (owner, 12 Oct 2026)
const WARM_EVENTS = new Set(['pw_gown', 'pw_start', 'ev_wstop', 'io_under_start', 'io_gown_start']);
const EVENT_FULL = { pw_gown: 'Gown on', ev_ot: 'In OT', pacu_in: 'PACU arrival', io_flip: 'Flipped prone', pw_start: 'Active warming started', ev_wstop: 'Active warming stopped', io_knife: 'Induction', io_under_start: 'Underbody Bair Hugger on',
  io_gown_start: 'Gown Bair Hugger on', io_done: 'Surgery completed (post-extubation)', pacu_out: 'Transfer to ward' };
// Running timer and the next event to note, in the app bar of the patient screen
// PACU in / To ward are logged on the PACU page (owner, 13 Oct 2026), so they are not in the key-times row or the Log button
const ESSENTIAL = ['pw_gown', 'pw_start', 'ev_wstop', 'ev_ot', 'io_knife', 'io_done'];
const PACU_TIMES = ['pacu_in', 'pacu_out'];
const mmss = m => { const sec = Math.max(0, Math.floor(m * 60)), h = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = String(sec % 60).padStart(2, '0');
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
function nextDue(p, s) {
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
function nextEvent(p) {
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
function paintSyncChip() {
  const el = $('#syncchip'); if (!el) return;
  const [t, sub, st, tip] = syncChipState(), h = `<b>${esc(t)}</b><small>${esc(sub)}</small>`;
  if (el.innerHTML !== h) el.innerHTML = h;
  el.dataset.state = st; el.title = tip; el.setAttribute('aria-label', `Sync status: ${t}, ${sub}. Tap to refresh.`);
}
// The patient screens' top bar (main screen, BP / HR / BIS, intra-op details, PACU): running timer, next event and
// its sync status chip. Returns a function that redraws it; it also ticks every second while the screen is open.
function topBar(p, s, onLog) {
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
function comfortHtml(p, id, label, roomy = false, aside = '') {
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
function comfortTap(p, t, draw, put = (k, v) => set(p, k, v)) {
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
const defaultSeries = p => val(p, 'ev_ot') || val(p, 'io_knife') ? 'iotemp' : 'prewarm';
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
  leaveGuard = () => !p.lock?.on && base != null && snap() !== base ? { what: pt.label + ' reading', save: commit, drop: dropDraft } : null;
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
      if (!confirm(`The ${pt.label} reading was changed on another phone${by ? ' (' + by + ')' : ''} while you had it open: ${theirs.map(c => `${c.label} ${val(p, `${s}_${pt.key}_${c.key}`) ?? 'blank'}`).join(', ')}.\n\nOK: save yours over it. Cancel: show theirs.`)) { dropDraft(); leaveGuard = null; render(); return false; }
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
        dropDraft(); leaveGuard = null; toast(pt.label + ' reading removed'); render(); return;
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

// ---------- due alerts (only while the app is open)
// On every patient screen (both tabs, the forms, Perioperative data): a reading of any series falling due alerts
// (banner, vibrate, beep, as set in Settings), and the screen is kept awake, taken again after switching apps.
// patients still being charted on this phone (not deleted, locked or marked complete; changed in the last 12 hours)
const charting = q => !isGone(q) && !q.lock?.on && !val(q, 'done') && Date.now() - (lastEdit(q)?.t || q.created || 0) < 12 * 3600e3;
// alerts for patient p (or, with p null, every patient being charted); other patients' alerts carry their Subject ID,
// since the next patient pre-warms while the last one is in surgery
function startAlerts(p) {
  // when each reading last buzzed: a reading still unsaved buzzes again every 2 minutes for 10 minutes after it falls
  // due (a missed buzz in theatre gets another chance, and a phone that slept catches up when it wakes) (14 Oct 2026)
  const nag = Object.fromEntries(Object.entries(read('nag', {})).filter(([, t]) => Date.now() - t < 3600e3));
  let lock = null;
  const awake = () => { if ((p || Object.values(patients).some(q => charting(q) && Date.now() - (read('opened', {})[q.id] || 0) < 12 * 3600e3)) && settings.remind.awake && navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {}); };
  awake();
  document.addEventListener('visibilitychange', awake);
  const check = () => {
    // everything falling due this second goes in one banner, with one buzz / beep
    const due = []; let target = null;
    // other patients only if opened on this phone today (not a teammate's patient in another theatre)
    const opened = read('opened', {});
    const others = Object.values(patients).filter(q => q.id !== p?.id && charting(q) && Date.now() - (opened[q.id] || 0) < 12 * 3600e3);
    for (const q of p ? [p, ...others] : others) {
      const pre = q === p ? '' : sid(q) + ': ';
      const hit = (tag, msg, to) => { if (nag[tag] && Date.now() - nag[tag] < 120e3) return; nag[tag] = Date.now(); due.push(pre + msg); target ||= to; };
      // stopping the warming on time matters as much as a reading: Prewarm off due alerts too
      const nx = nextEvent(q);
      if (nx?.id === 'ev_wstop' && nx.due != null) {
        const now = nowFor(q, 'prewarm');
        if (now >= nx.due && now <= nx.due + 10) hit(q.id + 'ev_wstop' + val(q, 'pw_start'), `Prewarm off ${now > nx.due + 5 ? 'overdue' : 'due now'} (${WARM_MIN[val(q, 'arm')]} min of warming): tap Log`, { pid: q.id, ev: 'ev_wstop' });
      }
      // BP, HR, BIS alarm only when switched on in Settings (owner, 13 Oct 2026; off by default): their due time
      // still shows in the top bar and on the tab
      for (const s of settings.remind.haemo ? ['prewarm', 'iotemp', 'haemo'] : ['prewarm', 'iotemp']) {
        if ((s === 'prewarm' && noWarming(q)) || sealedBy(q, s)) continue;
        const now = nowFor(q, s);
        for (const x of pointsFor(q, s)) {
          const d = dueOf(q, s, x), tag = q.id + s + x.key + (val(q, SERIES[s].ref[0]) || '');
          if (d == null || !expected(q, s, d) || savedAt(q, s, x.key) || now < d || now > d + 10) continue;
          hit(tag, `${s === 'haemo' ? 'BP, HR, BIS' : 'Temperature'} ${x.label} reading ${now > d + 5 ? 'overdue' : 'due now'}`, { pid: q.id, s, key: x.key });
        }
      }
    }
    if (!due.length) return;
    write('nag', nag);
    if (settings.remind.banner) showBanner(due.join(' · ') + ' (tap to open)', 15000, target);
    if (settings.remind.vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    if (settings.remind.beep) beep();
  };
  const iv = setInterval(check, 1000);
  // a phone that slept (timers pause) checks the moment it is back in front
  const back = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', back);
  const stop = () => { clearInterval(iv); document.removeEventListener('visibilitychange', awake); document.removeEventListener('visibilitychange', back); lock?.release?.().catch(() => {}); };
  cleanup.push(stop);
  return stop;
}
let actx;
// three short beeps, loud enough for theatre; sound needs a tap first on phones, and is suspended again after
// switching apps, so every tap (and each beep) wakes it up
function beep() {
  try {
    actx ||= new AudioContext();
    if (actx.state !== 'running') actx.resume?.();
    for (let i = 0; i < 3; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.35;
      o.frequency.value = 880; g.gain.value = 0.5; o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
  } catch { /* sound needs a tap first on some phones */ }
}
document.addEventListener('pointerdown', () => { try { actx ||= new AudioContext(); if (actx.state !== 'running') actx.resume?.(); } catch { /* no sound */ } });

// ---------- the patient's op-day data collection marked complete (bottom of the main screen, so it isn't tapped by
// accident); shown at the top of the main screen and in the patient list. The Word form's sign-off lines use it.
// What's still missing (owner, 12 Oct 2026: nothing easy to miss during intra-op collection): readings whose time
// has passed, times skipped, warming marked on with no start time, and the forms' unanswered questions once their
// stage has come. Each: { what, items, href }.
const INTRAOP_Q = ['io_tech', 'io_ebl', 'io_cs', 'io_cs_vol', 'io_cs_ret', 'io_pcc', 'io_pcc_dose', 'io_txa', 'io_txa_bolus', 'io_txa_inf', 'io_txa_total', 'io_fib', 'io_fib_dose'];
const PACU_Q = ['pacu_temp', 'pacu_shiver', 'pacu_ponv', 'pacu_hypot', 'pacu_tx', 'pacu_pain', 'nd_dis', 'nd_beh', 'nd_com', 'nd_ill', 'nd_psy', 'pacu_delay', 'pacu_delay1h', 'pacu_delay_why'];
function gaps(p) {
  const out = [], get = k => val(p, k), at = s => `#/p/${p.id}/${s}`;
  const add = (what, items, href) => { if (items.length) out.push({ what, items, href }); };
  // readings: the link opens the first one missed
  const missed = (s, what) => {
    const xs = pointsFor(p, s).filter(x => {
      const d = dueOf(p, s, x);
      return d != null && !savedAt(p, s, x.key) && expected(p, s, d) && nowFor(p, s) > d + 5;
    });
    if (xs.length) add(what, xs.map(x => x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min + ' min'), at(s) + '/' + xs[0].key);
  };
  if (!noWarming(p)) missed('prewarm', 'Pre-warming temps not saved');
  missed('iotemp', 'Intra-op temps not saved');
  missed('haemo', 'BP, HR, BIS not saved');
  // saved readings with a blank box (asked about at Save, listed so it can be filled in later)
  for (const [s, what] of [['prewarm', 'Pre-warming temps'], ['iotemp', 'Intra-op temps'], ['haemo', 'BP, HR, BIS']]) {
    if (s === 'prewarm' && noWarming(p)) continue;
    const part = pointsFor(p, s).filter(x => savedAt(p, s, x.key)).map(x => {
      const miss = colsFor(s, x).filter(c => get(`${s}_${x.key}_${c.key}`) == null);
      return miss.length ? `${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min + ' min'} (${miss.map(c => c.label).join(', ')})` : null;
    }).filter(Boolean);
    add(what + ' saved with blanks', part, at(s));
  }
  // readings switched off in Settings are never asked for: say so while collecting
  const off = Object.entries({ skin: 'chest, arm, thigh, calf', set: 'gown set temp', ts: 'thermal sensation', warm: 'warming yes / no', room: 'room temp', bis: 'BIS', haemo15: 'BP, HR, BIS every 15 min' }).filter(([k]) => settings.hide[k]).map(([, l]) => l);
  if (off.length && !get('done')) add('Hidden in Settings (not being recorded)', off, '#/settings');
  // in OT a while with no induction time: the intra-op readings have no due times, so nothing else would flag them
  const ot = toMin(get('ev_ot'));
  if (ot != null && !get('io_knife') && ((nowMin() - ot + 1440) % 1440) > 20 && !get('io_done')) add('Induction not logged', ['intra-op readings fall due from it'], '#/p/' + p.id);
  // times: any essential one skipped before the latest one logged
  const evs = ESSENTIAL.filter(id => !(noWarming(p) && (id === 'pw_start' || id === 'ev_wstop')));
  const last = evs.reduce((i, id, j) => get(id) ? j : i, -1);
  const label = id => EVENTS.find(([f]) => f === id)[1].replace('\u00ad', '');
  add('Times not logged', evs.slice(0, last).filter(id => !get(id)).map(label), '#/p/' + p.id);
  // PACU in / To ward are logged on the PACU page once surgery has ended
  if (get('io_done')) add('PACU times not logged', PACU_TIMES.filter(id => !get(id)).map(label), `#/p/${p.id}/form/pacu`);
  // key times going backwards (more than a few minutes; past midnight counts forward): usually a mistyped time
  const logged = evs.filter(id => toMin(get(id)) != null);
  add('Times out of order', logged.slice(1).map((id, k) => [logged[k], id]).filter(([a, b]) => {
    const d = (toMin(get(b)) - toMin(get(a)) + 1440) % 1440;
    return d > 720;
  }).map(([a, b]) => `${label(b)} ${get(b)} is before ${label(a)} ${get(a)}`), '#/p/' + p.id);
  // warming marked Yes on a reading, but its start time not logged
  const yes = col => SERIES.iotemp.points.some(x => String(get(`iotemp_${x.key}_${col}`)) === '1');
  const afterStart = (col, ev) => {
    const st = toMin(get(ev)); if (st == null) return [];
    return SERIES.iotemp.points.filter(x => savedAt(p, 'iotemp', x.key) && String(get(`iotemp_${x.key}_${col}`)) === '0')
      .filter(x => { const d = dueOf(p, 'iotemp', x); return d != null && (d - st + 1440) % 1440 < 720 && d - st > 0; })
      .map(x => x.key === 'end' ? 'End' : x.key === 'base' ? 'Baseline' : x.min + ' min');
  };
  add('Underbody warming says No after its start time', afterStart('under', 'io_under_start'), at('iotemp'));
  add('Gown warming says No after its start time', afterStart('gown', 'io_gown_start'), at('iotemp'));
  add('Warming on, start time not logged', [['under', 'io_under_start'], ['gown', 'io_gown_start']].filter(([c, id]) => yes(c) && !get(id)).map(([, id]) => label(id)), '#/p/' + p.id);
  const unanswered = ids => ids.map(field).filter(f => f && isShown(f, get) && get(f.id) == null).map(f => f.label);
  if (get('io_done')) add('Intra-op details unanswered', unanswered(INTRAOP_Q), `#/p/${p.id}/form/intraop`);
  if (get('pacu_in')) add('PACU unanswered', unanswered(PACU_Q), `#/p/${p.id}/form/pacu`);
  // chart review: POD1 / POD2 once due and not ticked complete (how many of the questions have an answer)
  const days = podDays(p);
  for (const [n, sign, pages] of [[1, 'sign_pod1', ['pod1', 'pod1an']], [2, 'sign_pod2', ['pod2', 'pod2an']]]) {
    if (days == null || days < n || get(sign)) continue;
    const all = pages.flatMap(pg => FORM[pg].map(([k]) => k)), done = all.filter(k => get(k) != null).length;
    add(`POD${n} chart review ${days > n ? 'overdue' : 'due today'}`, [`${done} of ${all.length} answered`], at('data/day' + n));
  }
  if (get('ev_ot') && get('sat_pre') == null) add('Comfort not asked', ['Before surgery'], `#/p/${p.id}/prewarm`);
  if (get('pacu_in') && get('sat_post') == null) add('Comfort not asked', ['After surgery'], `#/p/${p.id}/form/pacu`);
  return out;
}
function gapsHtml(p) {
  const g = gaps(p);
  if (!g.length) return '';
  return `<div class="gaps" id="gaps"><b>Still to fill</b><ul>${g.map(x => `<li><a href="${x.href}">${esc(x.what)}</a>: ${x.items.map(esc).join(', ')}</li>`).join('')}</ul></div>`;
}
// a section marked complete is read only until its tick is undone; "data collection complete" closes every op-day
// screen (owner, 12 Oct 2026). The Perioperative data page (filled in later from the chart) stays open.
function sealedBy(p, pg) {
  // the perioperative pages are filled in later from the chart, so "data collection complete" doesn't close them: only their own ticks
  if (val(p, 'done') && !DATA_SIGNS.has(pg)) return 'Data collection';
  if (!pg || !val(p, 'sign_' + pg)) return null;
  const n = SECTION[pg] || PAGES.find(x => x.id === pg)?.title || 'This section';
  return n[0].toUpperCase() + n.slice(1);
}
const sealedMsg = (p, pg) => `${sealedBy(p, pg)} is marked complete. Undo its tick to change this.`;
const sealNote = (p, pg) => `<p class="sealnote">✓ ${esc(sealedMsg(p, pg))}</p>`;
// boxes in a closed section can't be typed in
const disableSealed = () => view.querySelectorAll('.sealed input, .sealed select, .sealed textarea').forEach(i => { i.disabled = true; });
// which sections are marked complete, shown on the patient list (owner, 13 Oct 2026): read only, they just
// mirror the existing complete ticks inside each section
// the list's ticks, in fill-in order (owner, 21 Oct 2026: Pre-op after BP, HR, BIS; PayNow ticked once its details are saved)
const SECTION_ORDER = [['prewarm', 'Pre-warm'], ['iotemp', 'Intra-op temps'], ['haemo', 'BP, HR, BIS'], ['periop', 'Pre-op'], ['intraop', 'Intra-op details'], ['pacu', 'PACU'], ['pod1', 'POD1'], ['pod2', 'POD2'], ['dc', 'Discharge'], ['pay', 'PayNow']];
const sectionDone = (p, k) => k === 'pay' ? !!(p.f.pay_saved || p.f.pay_cleared) : !!val(p, 'sign_' + k);
const SECTION_HREF = { haemo: 'haemo', periop: 'data', intraop: 'form/intraop', pacu: 'form/pacu', pod1: 'data/day1', pod2: 'data/day2', dc: 'data/dc', pay: 'pay' };
// tapping a patient on the list opens the first section not yet ticked (owner, 21 Oct 2026). The temperature tabs open
// the patient's chart as before (it picks Induction room or Intra-op itself); chart-review days only once they are due.
function nextHref(p) {
  if (val(p, 'done')) return '#/p/' + p.id;
  const days = podDays(p) ?? 0;
  const k = SECTION_ORDER.map(([x]) => x).find(x => !(x === 'prewarm' && noWarming(p)) && !(x === 'pay' && declined(p)) && !sectionDone(p, x)
    && !(x === 'pod1' && days < 1) && !(x === 'pod2' && days < 2) && !(x === 'dc' && days < 1));
  return '#/p/' + p.id + (SECTION_HREF[k] ? '/' + SECTION_HREF[k] : '');
}
function progressHtml(p) {
  const rows = SECTION_ORDER.filter(([k]) => !(k === 'prewarm' && noWarming(p)) && !(k === 'pay' && declined(p)));
  return `<span class="progress" role="list" aria-label="Sections marked complete">${rows.map(([k, l]) => { const on = sectionDone(p, k);
    return `<span role="listitem" class="${on ? 'on' : ''}" aria-label="${l}: ${on ? 'complete' : 'not marked complete'}"><span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>${l}</span>`; }).join('')}</span>`;
}
function doneHtml(p) {
  return tickHtml(!!val(p, 'done'), 'data collection', val(p, 'done') || '', 'data-undone', 'data-done').replace('Mark data collection complete', 'Mark data collection as complete').replace('<b>data collection complete', '<b>Data collection complete');
}

// ---------- section sign-off (replaces the paper form's Name / Signature / Date)
// each sign-off names its section, and shows a ticked box once marked (owner, 12 Oct 2026)
const SECTION = { periop: 'pre-op and patient details', pod1: 'POD1', pod2: 'POD2', dc: 'Discharge', prewarm: 'pre-warming temps', iotemp: 'intra-op temps', haemo: 'BP, HR, BIS', intraop: 'Intra-op details', pacu: 'PACU', satis: 'Patient comfort' };
const tickHtml = (on, label, who, undo, mark) => on
  ? `<div class="sign on"><span class="tick" aria-hidden="true">✓</span><span><b>${esc(label)} complete</b><small>${esc(who)}</small></span><button class="link" ${undo}>Undo</button></div>`
  : `<div class="sign${label === 'PACU' ? ' big' : ''}"><button class="tickbtn" ${mark}><span class="tick" aria-hidden="true"></span>Mark ${esc(label)} complete</button></div>`;
function signoffHtml(p, pg) {
  const name = SECTION[pg] || PAGES.find(x => x.id === pg)?.title || 'section';
  return tickHtml(!!val(p, 'sign_' + pg), name, val(p, 'sign_' + pg) || '', `data-unsign="${pg}"`, `data-sign="${pg}"`);
}
function signoffClick(p, pg, t) {
  // the tick names its own section (the Temperatures tab has two)
  pg = t.closest('[data-sign]')?.dataset.sign || t.closest('[data-unsign]')?.dataset.unsign || pg;
  if (t.closest('[data-sign]')) {
    if (!settings.me) return toast('Add your initials in Settings first.');
    set(p, 'sign_' + pg, `${settings.me} ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${nowHM()}`); render();
  } else if (t.closest('[data-unsign]')) {
    if (!confirm(`Undo "${sealedBy(p, pg) || pg} complete" (${val(p, 'sign_' + pg)})?\n\nIt can then be changed again.`)) return;
    set(p, 'sign_' + pg, null); render();
  }
}

// BP / HR / BIS: the next 15-min reading's state, like the due time (readings missed by over 15 min are let go)
function haemoState(p, s = 'haemo') {
  if (sealedBy(p, s)) return 'later';
  const now = nowFor(p, s);
  const lefts = pointsFor(p, s).filter(x => !savedAt(p, s, x.key))
    .map(x => dueOf(p, s, x)).filter(d => d != null && expected(p, s, d)).map(d => d - now).filter(l => l > (s === 'haemo' ? -15 : -5));
  if (!lefts.length) return 'later';
  const left = Math.min(...lefts);
  return left > 2 ? 'later' : left > 0 ? 'soon' : left > -5 ? 'now' : 'late';
}
// the paper form's "Vital Signs Data Collected": ticked once any BP / HR / BIS value is saved
const vitalsCollected = p => Object.keys(p.f).some(k => /^haemo_/.test(k) && val(p, k) != null);

// ---------- other data: the study's remaining pages (pre-op, day 1 and 2 chart review, discharge), all on one page under
// headers that open by default (owner, 12 Oct 2026). Built for a computer keyboard too: Enter or ↓ goes to the next
// question, ↑ to the one before; on a row of choices ← → move along it and Enter or Space picks one and moves on.
// The page is split in three (owner, 13 Oct 2026): pre-op and patient details, day 1, day 2 (with discharge). Each has its own
// complete tick; the questions are the same and in the same order as before.
const DATA_PARTS = [
  { path: 'data', sign: 'periop', short: 'Pre-op', title: 'Pre-op and patient details', pages: ['preop', 'meds', 'bloods'], study: true },
  { path: 'data/day1', sign: 'pod1', short: 'POD1', title: 'POD1', pages: ['pod1', 'pod1an'] },
  { path: 'data/day2', sign: 'pod2', short: 'POD2', title: 'POD2', pages: ['pod2', 'pod2an'] },
  // Discharge has its own page and tick (owner, 21 Oct 2026; it was part of POD2, whose tick covered it)
  { path: 'data/dc', sign: 'dc', short: 'Discharge', title: 'Discharge', pages: ['dc'] },
];
const DATA_SIGNS = new Set(DATA_PARTS.map(d => d.sign));
route(/^\/p\/(\w+)\/data(?:\/(day1|day2|dc))?$/, (id, day) => {
  const p = patients[id]; if (!p) return go('#/');
  const part = DATA_PARTS.find(d => d.path === (day ? 'data/' + day : 'data')), SIGN = part.sign;
  header(sidL(p) + ' · ' + part.title, `#/p/${id}/haemo`);
  topBar(p, defaultSeries(p));
  const get = k => val(p, k);
  const filled = pg => FORM[pg].filter(([k]) => val(p, k) != null).length;
  // every section starts open (owner, 21 Oct 2026: they were folded for a day); each header keeps its "x of y filled"
  const closed = new Set();
  const draw = () => {
    const y = window.scrollY;
    const sl = sealedBy(p, SIGN);
    paint(`<p class="muted small">Usually from Epic or the chart, after the day of surgery. Fill in what you have; the rest stays blank.</p>
      <div class="${sl ? 'sealed' : ''}">${part.study ? `<details class="sect" data-pg="study" ${closed.has('study') ? '' : 'open'}><summary><span>Subject ID and group</span><small>to correct a mistake</small></summary>
        <div class="stack">${fieldHtml(field('enrol_id'), get)}${fieldHtml(field('arm'), get)}</div></details>` : ''}
      ${part.pages.map(pg => `<details class="sect" data-pg="${pg}" ${closed.has(pg) ? '' : 'open'}><summary><span>${esc(PAGES.find(x => x.id === pg).title)}</span>
        <small>${filled(pg) ? filled(pg) + ' of ' + FORM[pg].length + ' filled' : 'Not started'}</small></summary>
        <div class="stack">${FORM[pg].map(([k]) => fieldHtml(field(k), get)).join('')}</div></details>`).join('')}</div>
      ${sl ? sealNote(p, SIGN) : ''}${signoffHtml(p, SIGN)}`);
    disableSealed();
    window.scrollTo(0, y);
  };
  draw();
  // each question is one stop: its box, or on a row of choices the picked one (else the first)
  const stops = () => [...view.querySelectorAll('details[open] .fld')];
  const stopOf = el => el.closest('.fld');
  const keyOf = fld => fld.querySelector('[data-f]')?.dataset.f;
  const focusStop = fld => { if (!fld) return; const t = fld.querySelector('input, .chip[aria-pressed="true"]') || fld.querySelector('.chip'); t.focus(); if (t.select && t.type === 'text') t.select(); };
  const move = (k, by) => {
    const all = stops(), i = all.findIndex(f => keyOf(f) === k);
    // past the last question of a section: unfold the next folded one and carry on there
    if (!all[i + by] && by > 0) { const nx = all[i]?.closest('details')?.nextElementSibling; if (nx?.matches('details.sect:not([open])')) { nx.open = true; return focusStop(nx.querySelector('.fld')); } }
    focusStop(all[i + by]);
  };
  const pick = b => {
    const f = field(b.dataset.f); const v = f.type === 'code' ? +b.dataset.v : b.dataset.v;
    // the group can be corrected, never cleared; it sets the pre-warming due times
    if (f.id === 'arm') {
      if (String(get('arm')) === String(v)) return;
      if (!confirm(`Change the group to ${GROUPS.find(g => String(g[0]) === String(v))?.[1] || v}?\n\nOnly to correct a mistake. The pre-warming due times change with it.`)) return draw();
      set(p, 'arm', v); return draw();
    }
    set(p, f.id, String(get(f.id)) === String(v) ? null : v); draw();
  };
  view.onclick = e => {
    if (e.target.closest('[data-sign], [data-unsign]')) return signoffClick(p, SIGN, e.target);
    const b = e.target.closest('.chip[data-f]');
    if (b && sealedBy(p, SIGN)) return toast(sealedMsg(p, SIGN));
    if (b) pick(b);
  };
  view.onchange = e => {
    const i = e.target; if (!i.dataset.f) return;
    if (sealedBy(p, SIGN)) return;
    const f = field(i.dataset.f);
    // Subject ID: never blank, never the same as another patient's here
    if (f.id === 'enrol_id') {
      const v = i.value.trim();
      const clash = Object.values(patients).some(q => q !== p && !isGone(q) && String(val(q, 'enrol_id') || '').toLowerCase() === v.toLowerCase());
      if (!v || clash) { toast(v ? 'That Subject ID is already used by another patient.' : 'The Subject ID can’t be blank.'); i.value = get('enrol_id') ?? ''; return; }
      set(p, 'enrol_id', v); setTitle(sidL(p) + ' · ' + part.title); return;
    }
    const tv = typedValue(f, i.value);
    if (tv == null) { i.value = val(p, f.id) ?? ''; return; }
    set(p, f.id, tv);
    if (REDRAW.has(f.id)) return draw();
    // BMI is worked out from weight and height (unless typed in): update its box without a redraw (focus stays)
    if (f.id === 'wt' || f.id === 'ht') { recalc(p); const b = view.querySelector('#f-bmi'); if (b) b.value = val(p, 'bmi') ?? ''; }
    const d = i.closest('details[data-pg]'), n = d && filled(d.dataset.pg);
    if (d) d.querySelector('summary small').textContent = n ? n + ' of ' + FORM[d.dataset.pg].length + ' filled' : 'Not started';
  };
  view.onkeydown = e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const fld = stopOf(e.target); if (!fld) return;
    const k = keyOf(fld), chip = e.target.closest('.chip');
    // date and time boxes keep their own arrow keys (they change the value)
    const arrows = chip || e.target.type === 'text';
    if (chip && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const row = [...fld.querySelectorAll('.chip')]; row[Math.max(0, Math.min(row.length - 1, row.indexOf(chip) + (e.key === 'ArrowRight' ? 1 : -1)))].focus();
    } else if (chip && e.key === ' ') {
      // Space picks or clears and stays; Enter picks (never clears) and moves on
      e.preventDefault(); const v = chip.dataset.v; pick(chip); view.querySelector(`.chip[data-f="${k}"][data-v="${v}"]`)?.focus();
    } else if (chip && e.key === 'Enter') {
      e.preventDefault(); if (chip.getAttribute('aria-pressed') !== 'true') pick(chip); move(k, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' || (arrows && e.key === 'ArrowDown')) {
      e.preventDefault(); e.target.blur(); move(k, e.shiftKey && e.key === 'Enter' ? -1 : 1);
    } else if (arrows && e.key === 'ArrowUp') {
      e.preventDefault(); e.target.blur(); move(k, -1);
    }
  };
  const ontoggle = e => { const d = e.target.closest?.('details[data-pg]'); if (d) d.open ? closed.delete(d.dataset.pg) : closed.add(d.dataset.pg); };
  view.addEventListener('toggle', ontoggle, true);
  cleanup.push(() => { view.onclick = view.onchange = view.onkeydown = null; view.removeEventListener('toggle', ontoggle, true); });
});

// ---------- forms (intra-op details, PACU, satisfaction)
const FORM = {
  intraop: [['io_tech'], ['io_ebl'], ['h', 'Transfusion'], ['tx'], ['io_cs', 'io_cs_vol', 'io_cs_ret'], ['io_pcc', 'io_pcc_dose'],
    ['io_txa', 'io_txa_bolus', 'io_txa_inf', 'io_txa_total'], ['io_fib', 'io_fib_dose'], ['h', 'Intra-op investigations'], ['ix'], ['h', 'Notes'], ['io_dev']],
  pacu: [['pacu_temp'], ['pacu_shiver'], ['pacu_ponv'], ['pacu_hypot'], ['pacu_tx'], ['pacu_pain'], ['h', 'NuDESC'],
    ['nd_dis', 'nd_beh', 'nd_com', 'nd_ill', 'nd_psy', 'pacu_nudesc'], ['pacu_delay', 'pacu_delay1h', 'pacu_delay_why']],
  satis: [['sat_pre'], ['sat_post']],
};
// the rest of the study's data (owner, 12 Oct 2026): every field of these pages, in template order
const OTHER_PAGES = ['preop', 'meds', 'bloods', 'pod1', 'pod1an', 'pod2', 'pod2an', 'dc'];
// "Downloaded" (pre-op and day 2) is no longer asked (owner, 13 Oct 2026); its template columns stay empty in the export
// nor the Screening ID on Pre-op (owner, 21 Oct 2026): its column stays, blank for new patients
const NOT_ASKED = new Set(['pre_dl', 'd2_dl', 'screen_id']);
for (const pg of OTHER_PAGES) FORM[pg] = PAGES.find(x => x.id === pg).fields.filter(f => f.id !== 'enrol_id' && !NOT_ASKED.has(f.id)).map(f => [f.id]);
// Reset a subject: clears every time, reading and answer, keeping the Subject ID, group and hospital (asks twice)
const KEEP_ON_RESET = new Set(['enrol_id', 'arm', 'site', 'restored', 'pay_saved', 'pay_cleared']); // the payment marks stay: the entry lives on in payments/
function resetSubject(p) {
  if (p.lock?.on) return toast('Locked: read only. Unlock it on the home page to change it.');
  if (!confirm(`Reset ${sid(p)}?\n\nThis clears every time, reading and answer entered for this subject. The Subject ID and group stay.`)) return;
  if (!confirm(`Are you sure? Everything entered for ${sid(p)} will be cleared, on every phone sharing it. This can't be undone.`)) return;
  const ids = Object.keys(p.f).filter(k => !KEEP_ON_RESET.has(k) && val(p, k) != null && setVal(p, k, null, settings.me));
  try { Object.keys(localStorage).filter(k => k.startsWith(NS + 'unsaved:' + p.id + ':')).forEach(k => localStorage.removeItem(k)); } catch { /* fine */ }
  saveAll(); if (ids.length) sync(p, ids);
  leaveGuard = null; toast(sid(p) + ' reset');
  if (location.hash === '#/p/' + p.id) render(); else go('#/p/' + p.id);
}

// PACU view (owner, 12 Oct 2026): a list where tapping a participant opens only their PACU page, to hand the phone
// to the PACU nurses
route(/^\/pacu$/, () => {
  header('PACU view', '#/');
  const list = Object.values(patients).filter(p => !isGone(p) && !p.lock?.on).sort((a, b) => (lastEdit(b)?.t || b.created) - (lastEdit(a)?.t || a.created));
  paint(`<p class="muted small">Tap a participant to open their PACU page.</p>
    ${list.length ? `<ul class="list">${list.map(p => `<li><a href="#/pacu/${p.id}"><b>${esc(sidL(p))}</b><span>${esc(status(p))}</span></a></li>`).join('')}</ul>` : '<p class="muted">No patients yet.</p>'}`);
});
route(/^\/pacu\/(\w+)$/, id => formPage(id, 'pacu', '#/pacu'));
route(/^\/p\/(\w+)\/form\/(\w+)$/, (id, pg) => formPage(id, pg, `#/p/${id}/haemo`));
function formPage(id, pg, back) {
  const p = patients[id]; if (!p) return go('#/');
  if (OTHER_PAGES.includes(pg)) return go(`#/p/${id}/${DATA_PARTS.find(d => d.pages.includes(pg)).path}`);
  if (!FORM[pg]) return go('#/p/' + id);
  header(sidL(p) + ' · ' + (SECTION[pg] || PAGES.find(x => x.id === pg).title), back);
  topBar(p, defaultSeries(p));
  const get = k => val(p, k);
  const draw = () => {
    const y = window.scrollY;
    // PACU in / To ward on the PACU page, so the PACU nurse logs them there (owner, 12 Oct 2026)
    const pt = pg === 'pacu' ? `<div class="times pacutimes">${[['pacu_in', 'PACU in'], ['pacu_out', 'To ward']].map(([f, l]) =>
      `<button class="tchip ${get(f) ? 'set' : ''}" data-pev="${f}" aria-label="${EVENT_FULL[f] || l}: ${get(f) ? get(f) + ', tap to change' : 'tap to set now'}"><span>${l}</span><b>${get(f) ? esc(get(f)) : 'tap'}</b></button>`).join('')}</div>` : '';
    const sl = sealedBy(p, pg);
    paint(`<div class="${sl ? 'sealed' : ''}">${pt}${pg === 'pacu' ? comfortHtml(p, 'sat_post', 'Comfortable after surgery?', true) : ''}<div class="stack">${FORM[pg].map(group => {
      if (group[0] === 'h') return `<h2>${group[1]}</h2>`;
      if (group[0] === 'tx') return txTable(p);
      if (group[0] === 'ix') return ixTable(p);
      return group.map(k => fieldHtml(field(k), get)).join('');
    }).join('')}</div></div>${sl ? sealNote(p, pg) : ''}${signoffHtml(p, pg)}${pg === 'pacu' ? `<div class="paculink"><h2>PACU nurse link</h2><a class="secondary" href="#/p/${id}/pacushare">Share to PACU</a></div>` : ''}`);
    disableSealed();
    window.scrollTo(0, y);
  };
  draw();
  view.onclick = e => {
    if (pg === 'pacu' && comfortTap(p, e.target, draw)) return;
    const b = e.target.closest('.chip[data-f]');
    if (b) { const f = field(b.dataset.f); const v = f.type === 'code' ? +b.dataset.v : b.dataset.v; set(p, f.id, String(get(f.id)) === String(v) ? null : v); recalc(p); draw(); return; }
    const u = e.target.closest('[data-use]');
    if (u) { set(p, u.dataset.use, u.dataset.v); draw(); return; }
    if (e.target.closest('#addix')) { const rows = ixRows(p); rows.push({ time: nowHM() }); set(p, 'io_ix_rows', JSON.stringify(rows)); draw(); return; }
    if (e.target.closest('.sealed') && e.target.closest('button')) return toast(sealedMsg(p, pg));
    const pe = e.target.closest('[data-pev]');
    if (pe) {
      const f = pe.dataset.pev, label = f === 'pacu_in' ? 'PACU in' : 'To ward', had = !!get(f);
      openKeypad({ title: label, mode: 'time', value: get(f) || '', nowValue: nowHM(), hint: had ? 'logged ' + get(f) : '',
        onDone: v => {
          if (v === '') return;
          if (f === 'pacu_out' && !get('pacu_in') && !had && !confirm('PACU in isn’t logged yet. Log To ward anyway?')) return;
          set(p, f, v); lockTaps(); draw();
        },
        onClear: () => { if (!had || !confirm(`Clear the ${label} time (${get(f)})?`)) return; set(p, f, null); draw(); } });
      return;
    }
    const rm = e.target.closest('[data-rmix]');
    if (rm && !confirm('Remove this investigation result?')) return;
    if (rm) { const rows = ixRows(p); rows.splice(+rm.dataset.rmix, 1); set(p, 'io_ix_rows', rows.length ? JSON.stringify(rows) : null); draw(); return; }
    signoffClick(p, pg, e.target);
  };
  view.onchange = e => {
    const i = e.target;
    if (i.dataset.ix != null) { const rows = ixRows(p); rows[+i.dataset.ix][i.dataset.k] = i.value.trim(); set(p, 'io_ix_rows', JSON.stringify(rows)); return; }
    if (!i.dataset.f) return;
    const f = field(i.dataset.f);
    const tv = typedValue(f, i.value);
    if (tv == null) { i.value = val(p, f.id) ?? ''; return; }
    set(p, f.id, tv);
    // redraw only when other fields depend on this one, so the next box keeps focus
    if (REDRAW.has(f.id)) { recalc(p); draw(); }
  };
  cleanup.push(() => { view.onclick = view.onchange = null; });
}
const REDRAW = new Set(['io_txa_bolus', 'io_txa_inf', ...Object.values(BY_ID).filter(f => f.show).map(f => f.show.f)]);
// totals worked out from other fields fill in when empty or when they still hold the old worked-out value
function recalc(p) {
  for (const [id, kind] of [['io_txa_total', 'txa'], ['pacu_nudesc', 'nudesc'], ['bmi', 'bmi']]) {
    const c = calc(kind, k => val(p, k));
    if (c != null && !p.lock?.on && (val(p, id) == null || p.f[id]?.auto)) { setVal(p, id, String(c), settings.me); p.f[id].auto = true; saveAll(); sync(p, [id]); }
  }
}
// a typed form answer: numbers only where a number is asked; a temperature outside 25–45 °C is asked about.
// null: refused (the box goes back to what was saved)
function typedValue(f, raw) {
  const v = f.temp ? normaliseTemp(raw) : String(raw).trim();
  if (v === '') return v;
  if ((f.type === 'num' || f.type === 'int') && !/^-?\d+(\.\d+)?$/.test(v)) { toast(`${f.label}: numbers only.`); return null; }
  if (f.temp && (+v < 25 || +v > 45) && !confirm(`${f.label} ${v} °C looks unusual. Keep it?`)) return null;
  return v;
}
const noFirst = opts => opts.some(o => o[1] === 'No') ? [...opts].sort((a, b) => (b[1] === 'No') - (a[1] === 'No')) : opts;
function fieldHtml(f, get) {
  if (!f || !isShown(f, get)) return '';
  const v = get(f.id), idA = 'f-' + f.id;
  const hint = f.hint ? `<small class="muted">${esc(f.hint)}</small>` : '';
  if (f.type === 'code' || f.type === 'word') {
    // No always on the left, Yes on the right (owner, 20 Oct 2026); only the order on screen changes, not the stored codes
    const opts = noFirst(f.type === 'word' ? f.opts.map(o => [o, f.id === 'io_tech' ? 'GA (' + o + ')' : o]) : f.opts);
    // short answers (Yes / No, 0 1 2) share a row with their label; long ones (GA (Inhalational)) keep their own line
    const cls = opts.every(([, l]) => String(l).length <= 4) && opts.length <= 3 ? ' short' : opts.some(([, l]) => String(l).length > 10) ? ' longopt' : '';
    return `<div class="fld${cls}"><span class="lab">${esc(f.label)}</span>${hint}<div class="seg ${opts.length > 4 ? 'many' : ''}">${opts.map(([ov, ol]) =>
      `<button class="chip" data-f="${f.id}" data-v="${ov}" aria-pressed="${String(v) === String(ov)}">${esc(ol)}</button>`).join('')}</div></div>`;
  }
  if (f.long) return `<div class="fld wide"><label class="lab" for="${idA}">${esc(f.label)}</label>${hint}<textarea id="${idA}" data-f="${f.id}" rows="3" autocomplete="off">${esc(v ?? '')}</textarea></div>`;
  const mode = f.type === 'text' ? 'text' : f.type === 'int' ? 'numeric' : 'decimal';
  const type = f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text';
  return `<div class="fld"><label class="lab" for="${idA}">${esc(f.label)}${f.unit ? ` <small>${esc(f.unit)}</small>` : ''}</label>${hint}
    <input id="${idA}" data-f="${f.id}" type="${type}" ${type === 'text' ? `inputmode="${mode}"` : ''} value="${esc(v ?? '')}" autocomplete="off"></div>`;
}
function txTable(p) {
  const rows = [['rbc', 'RBC'], ['plt', 'Platelets'], ['ffp', 'FFP'], ['cryo', 'Cryo']];
  return `<table class="grid"><thead><tr><th></th><th>Units</th><th>Volume (mL)</th></tr></thead><tbody>${rows.map(([k, l]) =>
    `<tr><th>${l}</th><td><input data-f="io_${k}" inputmode="decimal" value="${esc(val(p, 'io_' + k) ?? '')}" aria-label="${l} units"></td>
    <td><input data-f="io_${k}_ml" inputmode="numeric" value="${esc(val(p, 'io_' + k + '_ml') ?? '')}" aria-label="${l} volume"></td></tr>`).join('')}</tbody></table>`;
}
function ixRows(p) { try { return JSON.parse(val(p, 'io_ix_rows')) || []; } catch { return []; } }
function ixTable(p) {
  const rows = ixRows(p);
  return `${rows.map((r, i) => `<div class="ixrow">${IX_COLS.map(([k, l]) => `<label><span>${l}</span><input data-ix="${i}" data-k="${k}" ${k === 'time' ? 'type="time"' : k === 'test' ? '' : 'inputmode="decimal"'} value="${esc(r[k] ?? '')}"></label>`).join('')}
    <button class="link" data-rmix="${i}">Remove</button></div>`).join('')}
    <button class="secondary" id="addix">+ Add a result</button>
    <p class="muted small">Only Hct available? Enter Hb as Hct ÷ 3.</p>`;
}

// ---------- form view: readings laid out like the paper form
// The PACU nurse's page (owner, 13 Oct 2026): opened from the link or QR code on the PACU page, it shows only this
// participant's PACU answers; what is entered goes to pacu/{token} and into the patient on the team's phones.
route(/^\/nurse\/(\w{20,64})$/, token => {
  header('PACU', null);
  if (!cloud.enabled) { paint('<p class="note">The PACU nurse link needs the team connection, which isn’t available in demo mode.</p>'); return; }
  const rec = { id: token, f: {} };
  let info = null, status = 'Connecting…', gone = false, unsub = null, alive = true;
  cleanup.push(() => { alive = false; unsub?.(); });
  const get = k => val(rec, k);
  const locked = () => !!get('sign_pacu');
  const typing = () => view.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
  const setStatus = () => { const el = $('#nstat'); if (el) el.textContent = status; };
  const draw = () => {
    if (gone) { paint('<p class="note">This PACU link was stopped. Ask the study team for a new one.</p>'); return; }
    if (!info) { paint(`<p class="muted">${esc(status)}</p>`); return; }
    $('#title').textContent = 'PACU · ' + (info.sid || '');
    const tchip = (f, l) => `<button class="tchip ${get(f) ? 'set' : ''}" data-pev="${f}" aria-label="${l}: ${get(f) ? get(f) + ', tap to change' : 'tap to set'}"><span>${l}</span><b>${get(f) ? esc(get(f)) : 'tap'}</b></button>`;
    paint(`<p class="note">You can fill in only this participant’s PACU details here. Changes reach the study team as you go.</p>
      <div class="fld"><label class="lab" for="ninit">Your initials</label><input id="ninit" value="${esc(settings.me)}" maxlength="6" autocomplete="off" autocapitalize="characters"></div>
      <div class="${locked() ? 'sealed' : ''}"><div class="times pacutimes">${tchip('pacu_in', 'PACU in')}${tchip('pacu_out', 'To ward')}</div>
      ${comfortHtml(rec, 'sat_post', 'Comfortable after surgery?', true)}
      <div class="stack">${FORM.pacu.map(group => group[0] === 'h' ? `<h2>${group[1]}</h2>` : group.map(k => fieldHtml(field(k), get)).join('')).join('')}</div></div>
      ${locked() ? sealNote({ f: rec.f }, 'pacu') : ''}${tickHtml(locked(), 'PACU', get('sign_pacu') || '', 'data-unsign', 'data-sign')}
      <p class="muted small" id="nstat" role="status">${esc(status)}</p>`);
    disableSealed();
  };
  const push = k => { status = 'Saving…'; cloud.pacuPush(token, { [k]: rec.f[k] }).catch(e => { status = cloud.friendly(e, 'pacu'); setStatus(); }); };
  function nset(k, v, auto = false) {
    if (!setVal(rec, k, v, settings.me)) return false;
    if (auto && rec.f[k]) rec.f[k].auto = true;
    push(k); return true;
  }
  const renudesc = () => {
    const c = calc('nudesc', get);
    if (c != null && (get('pacu_nudesc') == null || rec.f.pacu_nudesc?.auto)) nset('pacu_nudesc', String(c), true);
  };
  (async () => {
    try { await cloud.ensureSignedIn(); } catch (e) { status = cloud.friendly(e, 'pacu'); draw(); return; }
    if (!alive) return;
    const u = await cloud.pacuWatch(token, (data, m) => {
      if (!alive) return;
      if (!data) { if (m.server) { gone = true; draw(); } return; }
      info = { sid: String(data.sid || '').slice(0, 60) };
      for (const [k, x] of Object.entries(data.f || {})) {
        if (pacuClean(k, x) && (rec.f[k]?.t || 0) < x.t) rec.f[k] = { v: x.v ?? null, t: x.t, by: String(x.by || '').slice(0, 20), ...(x.auto ? { auto: true } : {}) };
      }
      status = m.pending ? 'Saving…' : m.server ? 'Saved to the team ✓' : 'No signal: kept on this phone, sent when there is signal';
      if (typing() || document.querySelector('dialog[open]')) setStatus(); else draw();
    }, e => { status = cloud.friendly(e, 'pacu'); if (!info) draw(); else setStatus(); });
    if (alive) unsub = u; else u?.();
  })();
  draw();
  view.onclick = e => {
    const t = e.target;
    if (t.closest('.sealed') && t.closest('button')) return toast('PACU is marked complete. Undo its tick to change this.');
    if (comfortTap(rec, t, draw, nset)) return;
    const chip = t.closest('.chip[data-f]');
    if (chip) {
      const f = field(chip.dataset.f), v = f.type === 'code' ? +chip.dataset.v : chip.dataset.v;
      nset(f.id, String(get(f.id)) === String(v) ? null : v);
      if (f.id.startsWith('nd_')) renudesc();
      draw(); return;
    }
    const pe = t.closest('[data-pev]');
    if (pe) {
      const f = pe.dataset.pev, label = f === 'pacu_in' ? 'PACU in' : 'To ward', had = !!get(f);
      openKeypad({ title: label, mode: 'time', value: get(f) || '', nowValue: nowHM(), hint: had ? 'logged ' + get(f) : '',
        onDone: v => { if (v === '') return; nset(f, v); lockTaps(); draw(); },
        onClear: () => { if (!had || !confirm(`Clear the ${label} time (${get(f)})?`)) return; nset(f, null); draw(); } });
      return;
    }
    if (t.closest('[data-sign]')) {
      if (!settings.me) return toast('Add your initials first.');
      nset('sign_pacu', `${settings.me} ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${nowHM()}`); draw(); return;
    }
    if (t.closest('[data-unsign]') && confirm('Undo "PACU complete"? It can then be changed again.')) { nset('sign_pacu', null); draw(); }
  };
  view.onchange = e => {
    const i = e.target;
    if (i.id === 'ninit') { settings.me = i.value.trim().toUpperCase().slice(0, 6); saveSettings(); return; }
    if (!i.dataset.f) return;
    const f = field(i.dataset.f), tv = typedValue(f, i.value);
    if (tv == null) { i.value = get(f.id) ?? ''; return; }
    nset(f.id, tv === '' ? null : tv); setStatus();
  };
  cleanup.push(() => { view.onclick = view.onchange = null; });
});

route(/^\/p\/(\w+)\/sheet$/, id => {
  const p = patients[id]; if (!p) return go('#/');
  header(sidL(p) + ' · Sheet view', '#/p/' + id);
  const cell = (s, pt, c) => { const v = val(p, `${s}_${pt.key}_${c.key}`); return `<td><a href="#/p/${id}/${s}/${pt.key}" aria-label="${esc(pt.label + ' ' + c.label + ': ' + (v ?? 'empty'))}">${v == null ? '' : esc(c.key === 'ts' && v > 0 ? '+' + v : v)}</a></td>`; };
  const pw = SERIES.prewarm, it = SERIES.iotemp, hd = SERIES.haemo;
  paint(`
    ${noWarming(p) ? '' : `<h2>Pre-warming, every 5 minutes</h2><div class="scroll" tabindex="0"><table class="grid sheet"><thead><tr><th>Time (min)</th>${pw.points.map(x => `<th>${x.min}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Time</th>${pw.points.map(x => `<td>${esc(savedAt(p, 'prewarm', x.key) || '')}</td>`).join('')}</tr>
      ${pw.cols.map(c => `<tr><th>${c.label}</th>${pw.points.map(x => cell('prewarm', x, c)).join('')}</tr>`).join('')}</tbody></table></div>`}
    <h2>Intra-op temperature</h2><div class="scroll" tabindex="0"><table class="grid sheet"><thead><tr><th>From induction</th>${it.cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>
      ${it.points.map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min}</th>${it.cols.map(c => cell('iotemp', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <h2>Haemodynamics</h2><div class="scroll" tabindex="0"><table class="grid sheet"><thead><tr><th>From induction</th>${hd.cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>
      ${hd.points.map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min}</th>${hd.cols.map(c => cell('haemo', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="muted small">Tap a cell to change that reading.</p>`);
});

// ---------- delete participants (from Settings; the only place patients are deleted)
route(/^\/delete$/, () => {
  header('Delete participants', '#/settings');
  const list = Object.values(patients).filter(p => !isGone(p)).sort((a, b) => String(sid(a)).localeCompare(String(sid(b))));
  const gone = Object.values(patients).filter(isGone).sort((a, b) => b.deleted - a.deleted);
  paint(`<p class="muted small">${sharing() ? `Deleting removes the participant from this phone and from your team’s phones.` : 'Deleting removes the participant from this phone.'} Tap Delete, then tap again to confirm.</p>
    ${list.length ? `<ul class="list dellist">${list.map(p => {
      const e = lastEdit(p);
      return `<li><div><b>${esc(sidL(p))}${val(p, 'site') ? ` <small>${esc(val(p, 'site'))}</small>` : ''}</b><small>${esc(status(p))} · ${e ? 'last entry ' + new Date(e.t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'no entries'}</small></div>
        ${p.lock?.on ? `<span class="muted small">${LOCK_ICON} Locked</span>` : `<button class="danger" data-del="${p.id}" aria-label="Delete ${esc(sid(p))}">Delete</button>`}</li>`;
    }).join('')}</ul>` : `<p class="muted">No participants on this phone.</p>`}
    ${gone.length ? `<h2>Deleted</h2><p class="muted small">Deleted by mistake? Restore brings it back${sharing() ? ' on every phone in the team' : ''}.</p>
      <ul class="list dellist">${gone.map(p => `<li><div><b>${esc(sidL(p))}</b><small>deleted ${new Date(p.deleted).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><button class="secondary" data-restore="${p.id}">Restore</button></li>`).join('')}</ul>` : ''}`);
  view.onclick = e => {
    const r = e.target.closest('[data-restore]');
    if (r) { const p = patients[r.dataset.restore]; if (p?.lock?.on) return toast('Locked: unlock it on the home page first.'); if (p) { restore(p, settings.me); saveAll(); sync(p, ['restored']); toast(sid(p) + ' restored'); render(); } return; }
    const b = e.target.closest('[data-del]'); if (!b) return;
    const p = patients[b.dataset.del]; if (!p) return;
    if (!b.dataset.sure) { b.dataset.sure = Date.now(); b.textContent = 'Tap again'; b.setAttribute('aria-label', 'Tap again to delete ' + sid(p)); return; }
    if (Date.now() - b.dataset.sure < 600) return; // a double tap isn't a second, deliberate tap
    markDeleted(p); saveAll(); sync(p, []); toast(sid(p) + ' deleted'); render();
  };
  cleanup.push(() => { view.onclick = null; });
});

// ---------- form view: the study's Word form (uploaded once by an admin) filled in for this patient: download it,
// or show it and print / save as PDF. Without the Word form yet: a simple version of the day-of-surgery pages.
let blankCache = null;
async function blankForm() {
  if (blankCache) return blankCache;
  if (DEMO) { try { blankCache = JSON.parse(sessionStorage.getItem(NS + 'blank')); } catch { /* none */ } return blankCache; }
  if (!sharing()) return null;
  try { blankCache = await cloud.blankForm(); } catch { /* offline and never fetched */ }
  return blankCache;
}
function noBlankNote() {
  if (DEMO) return `<div class="note">Demo: this is a simple version. To see the study’s Word form filled in, choose its blank .docx (kept only in this browser tab).
    <label class="secondary filebtn">Choose the blank form<input type="file" id="blankfile" accept=".docx" hidden></label></div>`;
  if (shared.admin) return `<p class="note">This is a simple version. Upload the study’s blank Word form on the <a href="#/export">Export screen</a> to fill in the real form.</p>`;
  if (sharing()) return `<p class="note">This is a simple version: your study admin hasn’t uploaded the blank Word form yet.</p>`;
  return `<p class="note">This is a simple version. <a href="#/settings">Join your hospital’s team</a> to fill in the study’s Word form.</p>`;
}
route(/^\/p\/(\w+)\/form$/, async id => {
  const p = patients[id]; if (!p) return go('#/');
  header(sidL(p) + ' · Form view', '#/p/' + id);
  const here = location.hash, still = () => location.hash === here;
  paint(`<p class="muted">Loading the form…</p>`);
  const b = await blankForm();
  if (!still()) return;
  if (!b) {
    simpleForm(p, id, noBlankNote());
    const inp = $('#blankfile');
    if (inp) inp.onchange = async () => {
      try { const r = await wordview.prepareBlank(inp.files[0]); blankCache = { b64: r.b64, name: inp.files[0].name, setAt: Date.now() }; }
      catch (e) { toast(e.message); return; }
      try { sessionStorage.setItem(NS + 'blank', JSON.stringify(blankCache)); } catch { /* this visit only */ }
      render();
    };
    return;
  }
  paint(`<div class="noprint stack"><div class="sharerow"><button class="primary" id="dl" disabled>Download Word file</button><button class="secondary" id="print" disabled>Save as PDF / Print</button></div>
    <p class="muted small">The study’s data collection form, filled in. Pages with no data stay blank. To save a PDF, choose “Save as PDF” as the printer (iPhone: Share → Print).</p></div>
    <div id="doc" class="wordview"><p class="muted">Filling in the form…</p></div>`);
  let file;
  try { file = await wordview.filledDocx(b.b64, p); if (!still()) return; await wordview.show(file, $('#doc')); }
  catch (e) { if (still()) $('#doc').innerHTML = `<p class="note">Couldn’t open the form: ${esc(e.message)}</p>`; return; }
  if (!still()) return;
  $('#dl').disabled = $('#print').disabled = false;
  $('#dl').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = `${sid(p)} data collection form.docx`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  $('#print').onclick = () => window.print();
  // the Word pages carry their own margins
  const pageStyle = document.createElement('style'); pageStyle.textContent = '@page { size: A4; margin: 0; }'; document.head.append(pageStyle);
  const refit = () => wordview.fit($('#doc'));
  addEventListener('resize', refit);
  cleanup.push(() => { pageStyle.remove(); removeEventListener('resize', refit); });
});
function simpleForm(p, id, note = '') {
  const v = k => val(p, k);
  const t = k => esc(v(k) ?? '');
  const box = on => on ? '☒' : '☐';
  const yn = k => `${box(String(v(k)) === '1')} Yes ${box(String(v(k)) === '0')} No`;
  const line = (k, unit = '') => `<span class="fill">${v(k) != null ? esc(v(k)) + (unit ? ' ' + unit : '') : ''}</span>`;
  const ifYes = (k, html) => String(v(k)) === '1' ? html : '';
  const day = (() => { const ts = Object.values(p.f).map(x => x.t).filter(Boolean); return ts.length ? new Date(Math.min(...ts)).toLocaleDateString('en-GB') : ''; })();
  const head = `<div class="fhead"><span>Subject ID: <b>${esc(sid(p))}</b></span><span>Date of entry: <b>${day}</b></span></div>`;
  const foot = pg => `<div class="ffoot">Name / Signature / Date: <b>${t('sign_' + pg) || '&nbsp;'}</b></div>`;
  const row = (label, html) => `<tr><th>${label}</th><td>${html}</td></tr>`;
  const pw = SERIES.prewarm, it = SERIES.iotemp, hd = SERIES.haemo;
  const cell = (s, pt, c) => { const x = v(`${s}_${pt.key}_${c.key}`); return `<td>${x == null ? '' : esc(c.key === 'ts' && x > 0 ? '+' + x : c.type === 'code' && s === 'iotemp' ? (String(x) === '1' ? 'Y' : 'N') : x)}</td>`; };
  const arm = String(v('arm'));
  const ix = (() => { try { return JSON.parse(v('io_ix_rows')) || []; } catch { return []; } })();
  const comfort = k => BY_ID.sat_pre.opts.map(([o, l]) => `${box(String(v(k)) === String(o))} ${l}`).join('<br>');
  paint(`${note}<div class="noprint stack"><button class="primary big" id="print">Save as PDF / Print</button>
    <p class="muted small">Opens the phone’s print screen: choose “Save as PDF” as the printer (on iPhone: Share → Print, then share the preview).</p></div>
  <div class="form">
  <section class="fpage" tabindex="0" aria-label="Pre-operative intervention page">${head}
    <h3>PRE-OPERATIVE (INTERVENTION)</h3>
    <h4>RANDOMISATION</h4>
    <p>${box(arm === '1')} 30-minute prewarming &nbsp; ${box(arm === '2')} 10-minute prewarming &nbsp; ${box(arm === '3')} No prewarming</p>
    <h4>INTERVENTION DETAILS</h4>
    <table class="ftable kv">${row('Time that gown was put on', line('pw_gown') + ' (24 hour clock)')}
      ${row('Start time of active warming', (v('pw_start') && v('pw_start') !== 'NA' ? line('pw_start') : '<span class="fill"></span>') + ' (24 hour clock)<br>' + box(arm === '3' || v('pw_start') === 'NA') + ' Not applicable, patient is in no prewarming group')}
      ${row('Active warming stopped', line('ev_wstop'))}</table>
    <p class="fcap">Temperature every 5 minutes</p>
    <div class="scroll" tabindex="0"><table class="ftable grid5"><thead><tr><th>Time (min)</th>${pw.points.map(x => `<th>${x.min}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Time (00:00)</th>${pw.points.map(x => `<td>${esc(v('at_prewarm_' + x.key) || '')}</td>`).join('')}</tr>
      ${pw.cols.map(c => `<tr><th>${c.key === 'set' ? 'Set temp on gown*' : c.label}</th>${pw.points.map(x => cell('prewarm', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fsmall">*“NA” if patient is in control group OR active warming has been terminated. Thermal sensation: −3 cold … 0 neutral … +3 hot.</p>
    ${foot('prewarm')}</section>

  <section class="fpage" tabindex="0" aria-label="Intraoperative page">${head}
    <h3>INTRAOPERATIVE</h3>
    <h4>SURGERY DETAILS</h4>
    <table class="ftable kv">${row('Time that patient was flipped', line('io_flip'))}${row('Knife-to-skin start time (Induction)', line('io_knife'))}
      ${row('Start time of underbody Bair Hugger', line('io_under_start'))}${row('Start time of intraoperative gown Bair Hugger', line('io_gown_start'))}
      ${row('Surgery completion time (Post-extubation)', line('io_done'))}</table>
    <h4>ANAESTHESIA DETAILS</h4>
    <table class="ftable kv">${row('Anaesthesia technique', `${box(v('io_tech') === 'Inhalational')} GA (Inhalational)<br>${box(v('io_tech') === 'TIVA')} GA (TIVA)`)}
      ${row('Blood loss', line('io_ebl', 'ml'))}
      ${row('Transfusion', `<table class="ftable inner"><tr><th></th><th>RBC</th><th>Platelets</th><th>FFP</th><th>Cryo</th></tr>
        <tr><th>Units</th>${['rbc', 'plt', 'ffp', 'cryo'].map(k => `<td>${t('io_' + k)}</td>`).join('')}</tr>
        <tr><th>Volume (ml)</th>${['rbc', 'plt', 'ffp', 'cryo'].map(k => `<td>${t('io_' + k + '_ml')}</td>`).join('')}</tr></table>`)}
      ${row('Cell Saver', yn('io_cs') + ifYes('io_cs', `<br>Volume in cell saver: ${line('io_cs_vol', 'ml')}<br>Volume retransfused: ${line('io_cs_ret', 'ml')}`))}
      ${row('Prothrombin Complex Concentrate', yn('io_pcc') + ifYes('io_pcc', ` (dose: ${line('io_pcc_dose')})`))}
      ${row('Tranexamic Acid', yn('io_txa') + ifYes('io_txa', `<br>Bolus: ${line('io_txa_bolus', 'mg')}<br>Infusion: ${line('io_txa_inf', 'mg')}<br>Total: ${line('io_txa_total', 'mg')}`))}
      ${row('Fibrinogen', yn('io_fib') + ifYes('io_fib', ` (dose: ${line('io_fib_dose')})`))}</table>
    <p class="fcap">Intraoperative Investigations</p>
    <table class="ftable"><tr>${IX_COLS.map(([, l]) => `<th>${l}${l === 'Hb' ? '*' : ''}</th>`).join('')}</tr>
      ${(ix.length ? ix : [{}, {}]).map(r => `<tr>${IX_COLS.map(([k]) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</table>
    <p class="fsmall">*If only Hct is available, chart Hb as Hct/3</p>
    ${foot('intraop')}</section>

  <section class="fpage" tabindex="0" aria-label="Intraoperative readings page">${head}
    <h3>INTRAOPERATIVE READINGS</h3>
    <p class="fcap">Temperature every 5 minutes for the first 60 minutes, then every 15 minutes after</p>
    <div class="scroll" tabindex="0"><table class="ftable"><thead><tr><th>Time from induction</th>${it.cols.map(c => `<th>${c.label}${c.unit ? ' ' + c.unit : c.type === 'code' ? ' Y/N' : ''}</th>`).join('')}</tr></thead><tbody>
      ${it.points.map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End of Surgery (post extubation)' : x.min}</th>${it.cols.map(c => cell('iotemp', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fcap">Hemodynamics to be collected every 15 minutes</p>
    <div class="scroll" tabindex="0"><table class="ftable"><thead><tr><th>Time from induction</th>${hd.cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>
      ${hd.points.filter(x => x.key === 'base' || v('at_haemo_' + x.key)).map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End of Surgery' : x.min}</th>${hd.cols.map(c => cell('haemo', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    ${foot('iotemp')}</section>

  <section class="fpage" tabindex="0" aria-label="PACU page">${head}
    <h3>POSTOPERATIVE (PACU)</h3>
    <h4>PACU DETAILS AND COMPLICATIONS</h4>
    <table class="ftable kv">${row('Time of PACU arrival', line('pacu_in'))}${row('Temperature on PACU arrival', line('pacu_temp', '°C'))}
      ${row('Shivering', yn('pacu_shiver'))}${row('Nausea and Vomiting', yn('pacu_ponv'))}
      ${row('Hypotension<br><small>(Systolic BP either &gt;20% below preoperative systolic BP or below 90 mmHg for &gt; 5 minutes)</small>', yn('pacu_hypot'))}
      ${row('Need for Transfusion in PACU', yn('pacu_tx'))}${row('Highest Pain Score<br><small>(Based on 11-point NRS score)</small>', line('pacu_pain'))}
      ${row('NuDESC Score', line('pacu_nudesc'))}${row('Time of Transfer from PACU to Ward', line('pacu_out'))}
      ${row('Delay in PACU Discharge', yn('pacu_delay') + ifYes('pacu_delay', `<br>If yes, is delay for more than 1 hour? ${yn('pacu_delay1h')}` + ifYes('pacu_delay1h', `<br>Reason: ${line('pacu_delay_why')}`)))}</table>
    <h4>PATIENT SATISFACTION FEEDBACK</h4>
    <table class="ftable kv">${row('Were you comfortable in the preoperative period?', comfort('sat_pre'))}${row('Were you comfortable in the postoperative period?', comfort('sat_post'))}</table>
    ${foot('pacu')}</section>
  </div>`);
  $('#print').onclick = () => window.print();
}

// ---------- settings
// Ready for a case? (14 Oct 2026): everything that has gone wrong before a case, in one list
function readyHtml() {
  if (!cloud.enabled) return '';
  const rows = [
    ['Online', navigator.onLine, 'no signal: readings are kept and sent later'],
    ['Initials set', !!settings.me, 'add them below'],
    ['On a team', !!sharing(), 'join your hospital’s team below'],
    ['Hospital set', !!(shared.member?.site || settings.site), 'choose it below'],
    ['Nothing waiting or refused', !Object.keys(pending).some(id => patients[id] && !isGone(patients[id])) && !Object.keys(failed).some(id => patients[id] && !isGone(patients[id])), 'tap the chip at the top of a patient for why'],
    ['Synced in the last 15 minutes', !!lastSync && Date.now() - lastSync < 15 * 60e3, 'tap Refresh now below'],
    ['App is up to date', !swReg?.waiting, 'tap “Update available” at the top'],
  ];
  const bad = rows.filter(r => !r[1]).length;
  return `<h2>Ready for a case?</h2><ul class="ready" role="list" aria-label="Checks before a case">${rows.map(([l, ok, fix]) => `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span><span><b>${esc(l)}</b>${ok ? '' : `<small>${esc(fix)}</small>`}</span></li>`).join('')}</ul>
    <small class="muted">${bad ? `${bad} to fix before a case.` : 'All good.'} Also make a fresh PACU link per patient and test it once on a phone that is not on the team.</small>`;
}
// ---------- Email and PayNow (js/pay.js): typed here, sent only to payments/{id}; admins see, tick and delete them
route(/^\/p\/(\w+)\/pay$/, async id => {
  const p = patients[id]; if (!p) return go('#/');
  header('Email and PayNow', `#/p/${id}/prewarm`);
  const intro = `<p class="muted small">For ${esc(sid(p))}’s payment. Once saved, only study admins can see them; this phone can’t show them again.</p>`;
  const stamp = k => p.f[k] ? `${new Date(p.f[k].t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${p.f[k].by ? ' by ' + esc(p.f[k].by) : ''}` : '';
  const status = () => p.f.pay_cleared ? `<p class="okline small">✓ Paid; email and PayNow deleted (${stamp('pay_cleared')})</p>`
    : p.f.pay_saved ? `<p class="okline small">✓ Saved ${stamp('pay_saved')}. Saving again replaces them.</p>` : '';
  if (cloud.enabled && !shared.member && !shared.admin) return paint(`<div class="stack">${intro}<p class="note">Join the team in <a href="#/settings">Settings</a> first: the email and PayNow number go only to the study admins.</p></div>`);
  let entry = null;
  if (shared.admin) { paint(`<p class="muted">Loading…</p>`); try { entry = await cloud.payGet(id); } catch (err) { toast(cloud.friendly(err)); } }
  if (location.hash !== `#/p/${id}/pay`) return;
  const draw = () => {
    paint(`<form id="payf" class="stack">${shared.admin ? '' : intro}${status()}
      <label class="lab" for="payemail">Email</label><input id="payemail" type="email" inputmode="email" autocomplete="off" value="${esc(entry?.email || '')}">
      <label class="lab" for="paynow">PayNow mobile number</label><input id="paynow" type="tel" inputmode="tel" autocomplete="off" value="${esc(entry?.paynow || '')}">
      <button class="primary" type="submit">Save</button>
      ${cloud.enabled ? '' : '<small class="muted">Demo: nothing is sent.</small>'}</form>
      ${shared.admin ? `<section class="stack payticks" id="payticks"><h2>Payment</h2>${entry ? pay.ticksHtml(entry, esc) : '<p class="muted small">Nothing saved yet.</p>'}
      <a class="secondary" href="#/payments">All participants’ email and PayNow</a></section>` : ''}`);
    $('#payf').onsubmit = async e => {
      e.preventDefault();
      const email = $('#payemail').value.trim(), paynow = pay.cleanPaynow($('#paynow').value), why = pay.checkPay(email, paynow);
      if (why) return toast(why);
      if (p.lock?.on && !shared.admin) return toast('Locked: read only. Ask a study admin.');
      const btn = e.submitter || $('#payf button'); btn.disabled = true;
      if (cloud.enabled) {
        const by = shared.admin ? shared.email : settings.me || '';
        const w = cloud.payPut(id, { site: p.site || val(p, 'site') || shared.member?.site || settings.site, sid: sid(p), email, paynow, by });
        // without signal Firestore keeps it and sends it later; only a refusal is worth waiting for
        const res = await Promise.race([w.then(() => 'ok', err => err), new Promise(r => setTimeout(() => r('later'), 4000))]);
        if (res !== 'ok' && res !== 'later') { btn.disabled = false; return toast(cloud.friendly(res, 'pay')); }
        toast(res === 'ok' ? 'Saved for the study admins' : 'Saved: it goes to the study admins when there is signal');
        if (shared.admin) { try { entry = await cloud.payGet(id); } catch { /* shown next time */ } }
      } else toast('Demo: not sent');
      set(p, 'pay_saved', Date.now());
      if (shared.admin) draw(); else go(`#/p/${id}/prewarm`);
    };
    if (shared.admin && entry) pay.wireTicks($('#payticks'), { cloud, toast, list: () => [entry], after: async (pid, what) => {
      if (what === 'cleared' && !p.lock?.on) set(p, 'pay_cleared', Date.now());
      try { entry = await cloud.payGet(pid); } catch { /* keep */ }
      draw();
    } });
  };
  draw();
});
// Email / PayNow on the home page (owner, 21 Oct 2026; it was PACU view): admins get every participant's entry; a team
// phone picks a participant and types theirs (team phones can't read entries back)
route(/^\/paynow$/, () => {
  if (shared.admin) { history.replaceState(history.state, '', location.pathname + location.search + '#/payments'); return render(); }
  header('Email / PayNow', '#/');
  const list = Object.values(patients).filter(p => !isGone(p) && !declined(p) && !isDraft(p) && !p.lock?.on)
    .sort((a, b) => String(val(b, 'enrol_id') ?? '').localeCompare(String(val(a, 'enrol_id') ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
  const st = p => p.f.pay_cleared ? '✓ Paid' : p.f.pay_saved ? '✓ Saved' : 'Not yet';
  paint(`<p class="muted small">Tap a participant to type their email and PayNow mobile for the payment. Only the study admins can see them.</p>
    ${list.length ? `<ul class="list">${list.map(p => `<li><a href="#/p/${p.id}/pay"><b>${esc(sidL(p))}</b><span>${esc(st(p))}</span></a></li>`).join('')}</ul>` : '<p class="muted">No participants yet.</p>'}`);
});
route(/^\/payments$/, async () => {
  header('Email and PayNow', '#/');
  if (!shared.admin) return paint('<p class="note">Sign in as a study admin from Settings.</p>');
  paint('<p class="muted">Loading…</p>');
  let list = [];
  try { list = await cloud.payList(); } catch (err) { return paint(`<p class="note">${esc(cloud.friendly(err))}</p>`); }
  if (location.hash !== '#/payments') return;
  let showDone = false;
  const draw = () => {
    const rows = pay.payOrder(list).filter(d => showDone || pay.payStage(d) < 2);
    const done = list.filter(d => pay.payStage(d) === 2).length;
    paint(`<div class="stack"><p class="muted small">Typed in on the Induction room tab. Tick Email sent and Payment sent, then delete the email and PayNow.</p>
      ${rows.length ? `<ul class="paylist">${rows.map(d => `<li class="setcard"><h3>${esc(d.sid)} <small>${esc(d.site)}</small></h3>
        ${d.email || d.paynow ? `<p class="payids">${d.email ? `<span>${esc(d.email)}</span>` : ''}${d.paynow ? `<span>PayNow ${esc(d.paynow)}</span>` : ''}</p>` : ''}
        ${pay.ticksHtml(d, esc)}</li>`).join('')}</ul>` : '<p class="muted">Nothing waiting.</p>'}
      ${done ? `<button class="link" id="showdone">${showDone ? 'Hide' : 'Show'} ${done} done (deleted)</button>` : ''}</div>`);
    $('#showdone')?.addEventListener('click', () => { showDone = !showDone; draw(); });
    pay.wireTicks(view.querySelector('.stack'), { cloud, toast, list: () => list, after: async (pid, what) => {
      const q = patients[pid];
      if (what === 'cleared' && q && !q.lock?.on) set(q, 'pay_cleared', Date.now());
      try { list = await cloud.payList(); } catch { /* keep */ }
      draw();
    } });
  };
  draw();
});
route(/^\/scan$/, () => {
  header('Scan pages', '#/settings');
  if (!settings.scan) return paint('<p class="note">Turn on Scan pages in <a href="#/settings">Settings</a> first.</p>');
  paint('');
  cleanup.push(scan.mount({ view, esc, toast, subjects: () => Object.values(patients).filter(p => !isGone(p)).map(sid) })); // stops the live camera
});
route(/^\/scanimports$/, () => {
  header('Scan imports', '#/settings');
  if (!shared.admin) return paint('<p class="note">Sign in as a study admin from Settings.</p>');
  paint('');
  scanImports.mount({ view, esc, toast, cloud, patients: () => patients, sid, val, setField: set, photo: scan.pagePhoto });
});
route(/^\/settings$/, () => {
  header('Settings', '#/');
  const tog = (grp, k, l, d = '') => `<label class="tog"><input type="checkbox" data-g="${grp}" data-k="${k}" ${grp === 'hide' ? (settings.hide[k] ? '' : 'checked') : settings[grp][k] ? 'checked' : ''}><span>${l}${d ? `<small>${d}</small>` : ''}</span></label>`;
  // grouped into cards by what people come for (owner, 20 Oct 2026): you and your team, alerts, data, then the rarer ones
  const group = (title, body) => `<section class="setcard"><h2>${title}</h2>${body}</section>`;
  paint(`<div class="stack settings">
    ${cloud.enabled ? `<section class="setcard">${readyHtml()}</section>` : ''}
    ${group('You and your team', `<label class="lab" for="me">Your initials</label><input id="me" value="${esc(settings.me)}" maxlength="6" autocapitalize="characters" autocomplete="off">
    <small class="muted">Saved with each reading as “entered by”.</small>
    <h3>Hospital and sharing</h3>
    ${sharingHtml()}
    ${cloud.enabled ? refreshHtml() : ''}`)}
    ${group('When a reading is due', `<p class="muted small">Works while the app is open on screen.</p>
    ${tog('remind', 'banner', 'Banner')}${tog('remind', 'vibrate', 'Vibrate', 'Android only')}${tog('remind', 'beep', 'Short beep')}${tog('remind', 'awake', 'Keep the screen on during readings')}
    ${tog('remind', 'haemo', 'BP, HR, BIS due alarm', 'Off by default: the countdown still shows')}
    <button class="secondary" id="test">Test the alert</button>`)}
    ${group('Data', `<a class="secondary" href="#/export">Export Excel</a>
    <a class="secondary" href="#/delete">Delete participants</a>`)}
    ${group('Screen size', `<div class="seg sizes" role="group" aria-label="Screen size">${SIZES.map(([k, l]) => `<button type="button" class="chip" data-zoom="${k}" aria-pressed="${String(settings.zoom || '1') === k}">${l}</button>`).join('')}</div>
    <small class="muted">Makes text and buttons bigger or smaller on this phone.</small>`)}
    ${group('Scan pages (beta)', `<label class="tog"><input type="checkbox" id="scanon" ${settings.scan ? 'checked' : ''}><span>Show Scan pages<small>Photograph the paper form’s pages. Pages stay on this phone for now.</small></span></label>
    ${settings.scan ? '<a class="secondary" href="#/scan">Scan pages</a>' : ''}
    ${settings.scan && shared.admin ? '<a class="secondary" href="#/scanimports">Scan imports (approve)</a>' : ''}`)}</div>`);
  wireRefresh();
  $('#scanon').onchange = e => { settings.scan = e.target.checked; saveSettings(); render(); };
  view.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
    settings.zoom = b.dataset.zoom; saveSettings(); applySize(settings.zoom);
    view.querySelectorAll('[data-zoom]').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  view.querySelectorAll('[data-site]').forEach(b => b.onclick = () => { if (shared.member) return; settings.site = settings.site === b.dataset.site ? '' : b.dataset.site; saveSettings(); render(); });
  $('#me').onchange = e => { settings.me = e.target.value.trim().toUpperCase(); saveSettings(); if (shared.member) cloud.setInitials(settings.me).catch(() => {}); toast('Saved'); };
  $('#join')?.addEventListener('click', async e => {
    const code = $('#code').value.trim().toUpperCase();
    if (!code) return toast('Enter the join code.');
    // codes start with their hospital: NTF-XXXXXXXX
    const site = siteOfCode(code);
    if (!site) return toast('That isn’t a join code. It starts with the hospital, e.g. NTF-.');
    await joinTeam(site, code, e.target);
    render();
  });
  $('#leave')?.addEventListener('click', e => logOut(e.target));
  $('#adminin')?.addEventListener('click', () => { $('#adminbox').hidden = false; $('#adminemail').focus(); });
  $('#adminpwin')?.addEventListener('click', async e => {
    const email = $('#adminemail').value.trim().toLowerCase(), pw = $('#adminpw').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter your email address.');
    if (!pw) return toast('Enter your password, or use the emailed link.');
    e.target.disabled = true;
    try { await cloud.adminPasswordSignIn(email, pw); toast('Signed in'); }
    catch (err) { toast(cloud.friendly(err)); }
    e.target.disabled = false;
  });
  $('#adminreset')?.addEventListener('click', async e => {
    const email = $('#adminemail').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter your email address first.');
    e.target.disabled = true;
    try { await cloud.sendPasswordReset(email); toast('If that email has an account, a reset link is on its way.'); }
    catch (err) { toast(cloud.friendly(err)); }
    e.target.disabled = false;
  });
  $('#setpw')?.addEventListener('click', async e => {
    const pw = $('#newpw').value;
    if (pw.length < 8) return toast('Use at least 8 characters.');
    e.target.disabled = true;
    try { await cloud.setMyPassword(pw); $('#newpw').value = ''; toast('Password saved. Next time, sign in with your email and password.'); }
    catch (err) { toast(cloud.friendly(err)); }
    e.target.disabled = false;
  });
  $('#adminsend')?.addEventListener('click', async e => {
    const email = $('#adminemail').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter your email address.');
    e.target.disabled = true;
    try { await cloud.sendAdminLink(email); $('#adminbox').innerHTML = `<p class="ok-box">Sign-in link sent to ${esc(email)}. Open it on this phone, in this browser.</p>`; }
    catch (err) { e.target.disabled = false; toast(cloud.friendly(err)); }
  });

  view.onchange = e => {
    const i = e.target; if (!i.dataset.g) return;
    if (i.dataset.g === 'hide') settings.hide[i.dataset.k] = !i.checked; else settings.remind[i.dataset.k] = i.checked;
    saveSettings();
  };
  $('#test').onclick = () => {
    if (settings.remind.banner) showBanner('Test: reading due now', 4000);
    if (settings.remind.vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    if (settings.remind.beep) beep();
  };
  cleanup.push(() => { view.onchange = null; });
});

function sharingHtml() {
  const chips = `<div class="seg sites">${SITES.map(x => `<button type="button" class="chip" data-site="${x}" aria-pressed="${settings.site === x}" ${shared.member ? 'disabled' : ''}>${x}</button>`).join('')}</div>`;
  if (!cloud.enabled) return `${chips}<small class="muted">New patients on this phone are recorded at this hospital. Sharing is off in demo mode.</small>`;
  if (shared.email && !shared.admin) return `<p class="note">${esc(shared.email)} isn’t on the study’s admin list. Ask the owner to add it.</p><button class="secondary" id="leave">Log out</button>`;
  // an admin picks the hospital new patients on this phone are recorded at (members' hospital is fixed by their team)
  if (shared.admin) return `<p class="ok-box">Signed in as study admin (${esc(shared.email)}). You see every hospital’s patients.<br><span class="syncline">${esc(syncText())}</span></p>
    <label class="lab">Your hospital</label>${chips}<small class="muted">New patients you start on this phone are recorded at this hospital. Pick one before starting a patient.</small>
    <a class="secondary" href="#/admin">Join codes and members</a>
    <a class="secondary" href="#/payments">Email and PayNow (payments)</a>
    <details class="sect"><summary><span>Password</span><small>sign in with it next time</small></summary><div class="stack">
      <label class="lab" for="newpw">New password <small>(8 or more characters)</small></label>
      <input id="newpw" type="password" autocomplete="new-password"><button class="secondary" id="setpw">Save password</button></div></details>
    <button class="secondary" id="leave">Log out</button>`;
  if (shared.member) return `<p class="ok-box">Sharing with the ${esc(shared.member.site)} team. Readings sync when there is signal.<br><span class="syncline">${esc(syncText())}</span></p><button class="secondary" id="leave">Log out</button>
    <small class="muted">Logging out deletes every patient on this phone (it warns first, and again if something hasn’t synced).</small>`;
  return `<label class="lab" for="code">Join code</label><input id="code" autocomplete="off" autocapitalize="characters" placeholder="e.g. NTF-…">
    <small class="muted">From a study admin, or just open the join link they sent. The code says which hospital. Joining shares this phone’s patients with that hospital’s team.</small>
    <button class="primary" id="join">Join</button>
    <button class="link" id="adminin">Study admin? Sign in by email</button>
    <div id="adminbox" class="stack" hidden><label class="lab" for="adminemail">Your admin email</label>
      <input id="adminemail" type="email" autocomplete="email" inputmode="email">
      <label class="lab" for="adminpw">Password <small>(if you have set one)</small></label>
      <input id="adminpw" type="password" autocomplete="current-password">
      <button class="primary" id="adminpwin">Sign in</button>
      <button class="secondary" id="adminsend">Email me a sign-in link</button>
      <button class="link" id="adminreset">Forgot password? Email me a reset link</button></div>`;
}

// an admin's sign-in link opened in another browser: ask for the email again
route(/^\/confirm$/, () => {
  header('Finish signing in', '#/');
  if (!cloud.isAdminLink()) return go('#/settings');
  paint(`<div class="stack"><p>This sign-in link was opened in a different browser from the one that asked for it. Type the email it was sent to.</p>
    <label class="lab" for="adminconfirm">Email</label><input id="adminconfirm" type="email" autocomplete="email">
    <button class="primary" id="adminfinish">Sign in</button></div>`);
  $('#adminfinish').onclick = () => finishAdmin($('#adminconfirm').value.trim().toLowerCase());
});

const siteOfCode = code => SITES.find(x => code.startsWith(x + '-')) || null;
async function joinTeam(site, code, btn) {
  btn.disabled = true; btn.textContent = 'Joining…';
  try {
    await cloud.join(site, code, settings.me);
    shared.member = await cloud.member();
    settings.site = site; saveSettings();
    uploadLocal(); await watch();
    toast('Joined the ' + site + ' team');
    return true;
  } catch (err) {
    shared.member = null;
    toast(err?.code === 'permission-denied' ? 'That code isn’t right for ' + site + '. Ask a study admin.' : cloud.friendly(err));
    return false;
  }
}

// ---------- join link: #/join/{site}/{code} (after the #, so the code never reaches a server)
const joinLink = (site, code) => location.origin + location.pathname + (/emulator/.test(location.search) ? '?emulator' : '') + `#/join/${site}/${encodeURIComponent(code)}`;
route(/^\/join\/([A-Z]+)\/([^/]+)(?:\/(\w{1,6}))?$/, (site, enc, carriedMe) => joinPage(site, decodeURIComponent(enc), carriedMe));
// then: the screen to show once joined (a subject link opens its subject); by default the patient list
function joinPage(site, code, carriedMe, then = '#/') {
  // the code shouldn't stay in the history or a bookmark
  const forget = () => history.replaceState(null, '', location.pathname + location.search + then);
  header('Join the ' + site + ' team', '#/');
  if (!SITES.includes(site) || !cloud.enabled) { forget(); paint(`<p class="note">This join link doesn’t work${cloud.enabled ? '' : ' in demo mode'}.</p>`); return; }
  if (shared.member?.site === site) { forget(); if (then !== '#/') return render(); paint(`<p class="ok-box">This phone is already in the ${site} team.</p><a class="primary big" href="#/">Patients</a>`); return; }
  paint(`<div class="stack">
    <p>Join the <b>${site}</b> prewarming study team on this phone. You’ll see and enter ${site}’s patients, and they sync when there is signal.</p>
    ${shared.member ? `<p class="note">This phone is in the ${esc(shared.member.site)} team now; joining moves it to ${site}.</p>` : ''}
    <label class="lab" for="me">Your initials</label><input id="me" value="${esc(settings.me || (carriedMe || '').toUpperCase())}" maxlength="6" autocapitalize="characters" autocomplete="off">
    <small class="muted">Saved with each reading as “entered by”.</small>
    <button class="primary big" id="joinlink">Join ${site}</button></div>`);
  $('#joinlink').onclick = async e => {
    settings.me = $('#me').value.trim().toUpperCase(); saveSettings();
    if (!settings.me) return toast('Add your initials first.');
    if (shared.member) { shared.unwatch?.(); try { await cloud.leave(); } catch { /* out anyway */ } shared.member = null; }
    if (await joinTeam(site, code, e.target)) { forget(); render(); }
    else { e.target.disabled = false; e.target.textContent = 'Join ' + site; }
  };
}

// ---------- share pages (owner, 19 Oct 2026): two buttons at the bottom of every case, each its own link and QR code page.
// Much of the data is collected by people who aren't study admins (OT juniors, PACU nurses).
// Share subject (owner, 21 Oct 2026; was the team's join link): #/s/<token> opens only this subject. shares/{token} names
// the patient; the phone that opens it takes a guest pass and can then read and edit that one patient (firestore.rules).
// One fixed link per participant, made the first time the page opens (share_token syncs); only a study admin stops it.
const shareToken = p => p.f.share_token?.v || null;
const shareUrl = token => `${location.origin}${location.pathname}${/[?&]emulator/.test(location.search) ? '?emulator' : ''}#/s/${token}`;
async function makeShareLink(p) {
  const site = p.site || val(p, 'site') || guest[p.id]?.site || shared.member?.site || settings.site;
  if (!site) return toast('Set this patient’s hospital first.');
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(b, x => abc[x % 32]).join(''); // 24 characters of 5 bits: not guessable
  p.site ||= site;
  // the patient first: the link can only be opened once the server has it
  if (Object.keys(p.f).length) sync(p, Object.keys(p.f));
  try {
    await Promise.race([cloud.shareCreate(token, { site, pid: p.id, sid: sid(p).slice(0, 60), created: Date.now(), by: (settings.me || '').slice(0, 20) }),
      new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 8000))]);
  } catch (e) { return toast(cloud.friendly(e)); }
  set(p, 'share_token', token);
}
async function stopShareLink(p) {
  const token = shareToken(p); if (!token) return;
  try { await Promise.race([cloud.shareStop(token), new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 8000))]); }
  catch (e) { return toast(cloud.friendly(e)); }
  set(p, 'share_token', null);
}
// old links (#/join/{site}/{code}/p/{id}, before 21 Oct 2026) still join the team and open the subject
route(/^\/join\/([A-Z]+)\/([^/]+)\/p\/(\w+)$/, (site, enc, id) => {
  if (shared.admin && cloud.enabled) { history.replaceState(null, '', location.pathname + location.search + '#/open/' + id); return render(); }
  joinPage(site, decodeURIComponent(enc), '', '#/open/' + id);
});
route(/^\/s\/(\w{20,64})$/, token => {
  header('Opening the subject', '#/');
  if (!cloud.enabled) return paint('<p class="note">Share links need the team connection, which isn’t available in demo mode.</p>');
  paint('<p class="muted">Opening the shared subject…</p>');
  const here = location.hash;
  const fail = msg => { if (location.hash === here) paint(`<div class="stack"><p class="note">${esc(msg)}</p><a class="primary big" href="#/">Patients</a></div>`); };
  (async () => {
    try {
      await cloud.ensureSignedIn();
      const u = await cloud.whoAmI();
      shared.uid = u?.uid || null;
      if (u && !team()) { shared.member = await cloud.member(); shared.admin = !u.isAnonymous ? await cloud.isAdmin() : false; }
      const s = await cloud.shareGet(token);
      if (!s) return fail('This share link was stopped. Ask the study team for a new one.');
      if (!SITES.includes(s.site) || !/^\w{1,40}$/.test(String(s.pid))) return fail('This share link doesn’t work. Ask the study team for a new one.');
      // the team's own list already has it (an admin, or this hospital's member): just open it
      if (!shared.admin && shared.member?.site !== s.site) {
        await Promise.race([cloud.guestJoin(token, s.pid), new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 10000))]);
        guest[s.pid] = { token, site: s.site }; write('guest', guest);
        await watch();
      }
      if (location.hash !== here) return;
      history.replaceState(null, '', location.pathname + location.search + '#/open/' + s.pid);
      render();
    } catch (e) { fail(e?.code === 'unavailable' ? 'No connection. Open the link again with signal.' : cloud.friendly(e, 'pacu').replace('link', 'share link')); }
  })();
});
// the subject may not be on this phone yet (just joined, or a teammate's new patient): wait for the team's data
route(/^\/open\/(\w+)$/, id => {
  // replace, not push: the phone's back button shouldn't land here and bounce forward again
  const show = () => { history.replaceState(history.state, '', location.pathname + location.search + '#/p/' + id); render(); };
  if (patients[id] && !isGone(patients[id])) return show();
  header('Opening the subject', '#/');
  paint(`<p class="muted">Getting the subject…</p>`);
  const t0 = Date.now(), iv = setInterval(() => {
    if (patients[id] && !isGone(patients[id])) { clearInterval(iv); show(); }
    else if (Date.now() - t0 > 20000) {
      clearInterval(iv);
      paint(`<div class="stack"><p class="note">This subject isn’t on this phone. It may be locked, from another hospital, or there is no signal yet. Try again with signal, or ask the study team.</p><a class="primary big" href="#/">Patients</a></div>`);
    }
  }, 500);
  cleanup.push(() => clearInterval(iv));
});
// both pages also open from the home list's Share and PACU buttons (/h: back goes to the list)
route(/^\/p\/(\w+)\/share(\/h)?$/, (id, h) => {
  const p = patients[id]; if (!p) return go('#/');
  header(sidL(p) + ' · Share subject', h ? '#/' : (isDraft(p) ? '#/new/' : '#/p/') + id);
  const here = location.hash;
  let making = false, stopped = false;
  const box = body => paint(`<div class="paculink"><h2>Share subject</h2>${body}</div>`);
  const draw = () => {
    if (!cloud.enabled) return box('<p class="muted small">Not available in demo mode.</p>');
    if (!sharing()) return box('<p class="muted small">Join your hospital’s team (Settings) to share a subject.</p>');
    if (making) return box('<p class="muted">Making the link…</p>');
    const tk = shareToken(p);
    if (!tk && stopped) return box(`<p class="muted small">The link was stopped: it and its QR code no longer open ${esc(sid(p))}.</p><button class="secondary" data-share-make>Make a new link</button>`);
    if (!tk) return box(`<p class="muted small">The link couldn’t be made just now (no signal?). It opens only this subject, so someone collecting data can fill it in on their own phone.</p><button class="secondary" data-share-make>Try again</button>`);
    const url = shareUrl(tk);
    box(`<div class="qr">${qrSvg(url, 'QR code of the subject link')}</div>
      <input class="pacuurl" id="suburl" readonly value="${esc(url)}" aria-label="Subject link">
      <div class="sharerow"><button class="primary" id="subshare">Share link</button><button class="secondary" id="subcopy">Copy link</button></div>
      <p class="muted small">Opens only ${esc(sid(p))} in the app: whoever opens it can see and fill in this subject, and no other patient. It stays the same for this subject${shared.admin ? '' : '; only a study admin can stop it'}. Share it only with people collecting data for this study.</p>
      ${shared.admin ? '<button class="link" data-share-stop>Stop this link (admin)</button>' : ''}`);
    const copy = () => (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('Link copied'), () => { $('#suburl')?.select(); toast('Select the link and copy it'); });
    $('#subcopy').onclick = copy;
    $('#subshare').onclick = async () => {
      try { if (navigator.share) { await navigator.share({ title: 'Prewarming study: ' + sid(p), text: `Prewarming study: tap to open ${sid(p)}`, url }); return; } } catch (err) { if (err?.name === 'AbortError') return; }
      copy();
    };
  };
  const make = () => { making = true; draw(); makeShareLink(p).finally(() => { making = false; if (location.hash === here) draw(); }); };
  if (!shareToken(p) && cloud.enabled && sharing()) make(); else draw();
  view.onclick = e => {
    if (e.target.closest('[data-share-make]')) return void make();
    if (e.target.closest('[data-share-stop]') && confirm('Stop the Share subject link?\n\nThe link and its QR code stop working, and phones that opened it lose this subject. A new one can be made.')) stopShareLink(p).then(() => { stopped = !shareToken(p); draw(); });
  };
  cleanup.push(() => { view.onclick = null; });
});
// Share to PACU: the PACU nurse link (it used to sit at the bottom of the PACU page)
// one fixed link per participant (owner, 21 Oct 2026): made the first time this page opens, then the same link every
// time, on every team phone (pacu_token syncs); only a study admin can stop it (a link sent to the wrong person)
route(/^\/p\/(\w+)\/pacushare(\/h)?$/, (id, h) => {
  const p = patients[id]; if (!p) return go('#/');
  header(sidL(p) + ' · Share to PACU', h ? '#/' : (isDraft(p) ? '#/new/' : '#/p/') + id);
  const here = location.hash;
  let making = false;
  const make = () => { making = true; draw(); makePacuLink(p).finally(() => { making = false; if (location.hash === here) draw(); }); };
  const draw = () => { paint(making ? '<div class="paculink"><h2>PACU nurse link</h2><p class="muted">Making the link…</p></div>' : pacuLinkHtml(p)); };
  if (!pacuToken(p) && cloud.enabled && sharing()) make(); else draw();
  view.onclick = e => {
    if (e.target.closest('[data-pacu-make]')) return void make();
    if (e.target.closest('[data-pacu-stop]')) {
      if (confirm('Stop the PACU nurse link?\n\nThe link and its QR code stop working. A new one can be made.')) stopPacuLink(p).then(draw);
      return;
    }
    if (e.target.closest('[data-pacu-share]') && navigator.share) {
      const u = pacuUrl(pacuToken(p));
      navigator.share({ title: 'PACU: ' + sid(p), text: `Prewarming study: PACU page for ${sid(p)}`, url: u }).catch(() => {});
      return;
    }
    if (e.target.closest('[data-pacu-copy], [data-pacu-share]')) {
      const u = pacuUrl(pacuToken(p));
      (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => toast('Link copied'), () => { view.querySelector('.pacuurl')?.select(); toast('Select the link and copy it'); });
    }
  };
  cleanup.push(() => { view.onclick = null; });
});

function qrSvg(text, label = 'QR code of the join link') {
  const qr = qrcode(0, 'M');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- admin: join codes and members
route(/^\/admin$/, async () => {
  header('Study admin', '#/settings');
  if (!shared.admin) { paint(`<p class="note">Sign in as a study admin from Settings.</p>`); return; }
  paint(`<p class="muted">Loading…</p>`);
  let codes = {}, people = [], admins = [], me = '';
  try { [codes, people, admins, me] = await Promise.all([cloud.codes(), cloud.members(), cloud.admins(), cloud.myEmail()]); } catch (e) { paint(`<p class="note">${esc(cloud.friendly(e))}</p>`); return; }
  if (location.hash !== '#/admin') return; // left while it loaded: don't paint over the next screen
  paint(`<div class="stack">

    <p class="muted small">Send each hospital’s team its join link (or show the QR code): it opens the app ready to join, no typing. Share it only with that team. A new code makes old links stop working for new phones; phones already in stay in.</p>
    ${SITES.map(x => {
      const who = people.filter(m => m.site === x);
      return `<div class="fld"><b>${x}</b>
        <div class="coderow">${codes[x] ? `<button class="codebig" data-copy="${esc(codes[x].code)}" aria-label="Copy the ${x} join code">${esc(codes[x].code)}<small>tap to copy</small></button>` : '<span class="muted">no code yet</span>'}<button class="${codes[x] ? 'link' : 'secondary'}" data-newcode="${x}">${codes[x] ? 'New code' : 'Make code'}</button></div>
        ${codes[x] ? `<div class="sharerow"><button class="primary" data-share="${x}">Share join link</button><button class="secondary" data-qr="${x}">QR code</button></div><div class="qr" id="qr-${x}" hidden></div>` : ''}
        ${who.length ? `<ul class="plain">${who.map(m => `<li>${esc(m.initials || '—')} <small class="muted">joined ${new Date(m.joinedAt).toLocaleDateString()}</small> <button class="link" data-rm="${m.uid}">Remove</button></li>`).join('')}</ul>` : '<small class="muted">No phones yet</small>'}</div>`;
    }).join('')}
    <div class="fld" id="admins"><b>Study admins</b>
      <small class="muted">Admins see every hospital, make join codes, remove phones, lock patients and upload the blank form (Export). To add one, type their email: they then open Settings on their phone, tap “Study admin? Sign in by email” and use the emailed link.</small>
      <ul class="plain">${admins.sort((a, b) => a.email.localeCompare(b.email)).map(a => `<li>${esc(a.email)}${a.email === me ? ' <small class="muted">(you)</small>' : ''}
        ${a.addedBy ? `<small class="muted">added by ${esc(a.addedBy)}${a.addedAt ? ', ' + new Date(a.addedAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}</small>` : ''}
        ${a.email === me ? '' : `<button class="link" data-rmadmin="${esc(a.email)}">Remove</button>`}</li>`).join('')}</ul>
      <form class="addrow" id="addadmin"><input type="email" id="newadmin" placeholder="name@hospital.sg" autocomplete="off" aria-label="New admin’s email" required><button class="secondary">Add admin</button></form></div></div>`);
  $('#addadmin').onsubmit = async e => {
    e.preventDefault();
    const em = $('#newadmin').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Check the email address.');
    if (admins.some(a => a.email === em)) return toast(em + ' is already an admin.');
    if (!confirm(`Make ${em} a study admin?\n\nThey’ll see every hospital’s patients, make join codes, remove phones, lock patients and add or remove admins.`)) return;
    try { await cloud.addAdmin(em); toast(em + ' added. They sign in from Settings: “Study admin? Sign in by email”.'); render(); } catch (err) { toast(cloud.friendly(err)); }
  };
  view.onclick = async e => {
    const ra = e.target.closest('[data-rmadmin]');
    if (ra) {
      if (!confirm(`Remove ${ra.dataset.rmadmin} as a study admin?\n\nThey lose admin access straight away (their phone keeps only what a team member would see, if it joined a team).`)) return;
      try { await cloud.removeAdmin(ra.dataset.rmadmin); toast('Removed'); render(); } catch (err) { toast(cloud.friendly(err)); }
      return;
    }
    const sh = e.target.closest('[data-share]');
    if (sh) {
      const x = sh.dataset.share, url = joinLink(x, codes[x].code);
      const text = `Prewarming study: tap to join the ${x} team on your phone`;
      try { if (navigator.share) { await navigator.share({ title: 'Join the ' + x + ' team', text, url }); return; } } catch (err) { if (err?.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(url); toast('Join link copied: paste it into a message'); }
      catch { prompt('Copy this join link', url); }
      return;
    }
    const qb = e.target.closest('[data-qr]');
    if (qb) {
      const x = qb.dataset.qr, box = $('#qr-' + x);
      if (box.hidden) { box.innerHTML = qrSvg(joinLink(x, codes[x].code)) + `<small class="muted">Scan with the phone camera to join ${x}.</small>`; box.hidden = false; qb.textContent = 'Hide QR'; }
      else { box.hidden = true; qb.textContent = 'QR code'; }
      return;
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Code copied'); } catch { prompt('Copy this join code', cp.dataset.copy); }
      return;
    }
    const nc = e.target.closest('[data-newcode]');
    if (nc && codes[nc.dataset.newcode] && !confirm(`Make a new join code for ${nc.dataset.newcode}?\n\nThe current code, its join link and QR code stop working: phones that haven’t joined yet need the new link.\n\nPhones already in the ${nc.dataset.newcode} team stay in. To take a phone out, use Remove under the members.`)) return;
    if (nc) {
      const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(8));
      const code = nc.dataset.newcode + '-' + Array.from(b, x => abc[x % abc.length]).join('');
      try { await cloud.setCode(nc.dataset.newcode, code); render(); } catch (err) { toast(cloud.friendly(err)); }
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      if (!rm.dataset.sure) { rm.dataset.sure = 1; rm.textContent = 'Tap again to remove'; return; }
      try { await cloud.removeMember(rm.dataset.rm); render(); } catch (err) { toast(cloud.friendly(err)); }
    }
  };
  cleanup.push(() => { view.onclick = null; });
});

// ---------- export
route(/^\/export$/, () => {
  header('Export', '#/settings');
  const n = Object.values(patients).filter(p => !isGone(p)).length;
  paint(`<div class="stack">
    <p>An Excel file in the study template’s layout: one row per patient, the template’s 572 columns, filled from everything entered here (op day and Perioperative data), so rows paste into the master sheet.</p>
    <ul class="muted small"><li><b>Data Collection</b>: the template sheet</li><li><b>Readings</b>: every reading with the time it was saved and who saved it</li>
    <li><b>Extra</b>: items the template has no column for (transfusion volumes, investigation rows, PACU transfusion, NuDESC items, sign-offs)</li></ul>
    <button class="primary big" id="xl" ${n ? '' : 'disabled'}>Export ${n} patient${n === 1 ? '' : 's'}</button>
    ${shared.admin ? '<div class="fld" id="blankbox"><b>Blank data collection form</b><small class="muted">Loading…</small></div>' : ''}</div>`);
  $('#xl').onclick = () => downloadWorkbook(Object.values(patients));
  if (shared.admin) blankFormBox();
});
// the blank Word form: admins upload it here, not on the admin screen, which is for people's access (owner, 19 Oct 2026)
async function blankFormBox() {
  let bf = null;
  try { bf = await cloud.blankForm(); } catch (e) { const b = $('#blankbox'); if (b) b.querySelector('small').textContent = cloud.friendly(e); return; }
  const box = $('#blankbox'); if (!box) return;
  box.innerHTML = `<b>Blank data collection form</b>
      <small class="muted">${bf ? `${esc(bf.name)}, uploaded ${new Date(bf.setAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} by ${esc(bf.setBy)}.` : 'Not uploaded yet.'} The Form view fills this Word file in for each patient; teams can download it or save it as a PDF. Its file details (author, editor, company) are removed on upload.</small>
      <label class="secondary filebtn">${bf ? 'Replace' : 'Upload'} the blank form (.docx)<input type="file" id="blankup" accept=".docx" hidden></label>`;
  $('#blankup').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let r;
    try { r = await wordview.prepareBlank(f); } catch (err) { toast(err.message); return; }
    if (r.missed.length && !confirm(`${r.missed.length} place(s) didn’t match the v3.2 form and will stay blank:\n${r.missed.slice(0, 12).join('\n')}${r.missed.length > 12 ? '\n…' : ''}\n\nUpload anyway?`)) return;
    try { await cloud.setBlankForm(r.b64, f.name, r.size); blankCache = null; toast('Blank form saved'); render(); }
    catch (err) { toast(cloud.friendly(err)); }
  };
}
// the Excel file for the given patients: shared from the phone's share sheet when it can, else downloaded
async function downloadWorkbook(live) {
  const bytes = workbook(live, []);
  // the phone's own date (toISOString is UTC: before 8 am in Singapore it named the file for yesterday), and how many patients
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = live.filter(p => !isGone(p)).length;
  const name = `prewarming-study-${day}-${n}pt${DEMO ? '-demo' : ''}.xlsx`;
  const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- moving to prewarmstudy.anawj.com (owner, 13 Oct 2026)
// Phones keep their saved copy, unsent readings and sign-in per web address, so the old address (anawj.com/prewarm/) moves a
// phone to the new one only when nothing on it is waiting: every reading sent to the team, no half-entered reading, the new
// address reachable. Otherwise the app carries on as before and a bar says why it hasn't moved. It runs once when the app opens
// (never while someone is entering a reading), and a team phone carries its join code and initials in the address's `#` part,
// which never reaches a server, so it rejoins its team on the new address without anyone typing the code.
const NEW_HOME = 'https://prewarmstudy.anawj.com/';
const MOVE_TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? new URLSearchParams(location.search).get('oldhost') : null; // tests: pretend to be the old address
const ON_OLD_ADDRESS = window.top === window && (!!MOVE_TEST || ['anawj.com', 'www.anawj.com'].includes(location.hostname));
function moveBar(text, canTry) {
  const el = $('#moved'); if (!el) return;
  el.hidden = false;
  el.innerHTML = `<b>The study app has a new address: prewarmstudy.anawj.com.</b> ${esc(text)} ${canTry ? '<button class="link" id="movenow">Try again</button>' : ''}`;
  $('#movenow')?.addEventListener('click', () => moveCheck());
}
// why this phone can't move yet ('' when it can)
async function notReadyToMove() {
  if (DEMO) return '';
  const t0 = Date.now();
  while (cloud.enabled && document.body.dataset.cloud !== 'ready' && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 200));
  if (cloud.enabled && document.body.dataset.cloud !== 'ready') return 'It is still checking this phone’s team and readings.';
  if (Object.keys(localStorage).some(k => k.startsWith(NS + 'unsaved:'))) return 'A reading on this phone is half entered: save it, then it moves.';
  if (Object.keys(pending).length) return 'Some readings are still waiting to reach the team: it moves once they have.';
  if (!sharing() && Object.values(patients).some(p => !isGone(p))) return 'This phone holds patients that are not shared with a team, so it stays here. Export them first (Settings → Export).';
  if (cloud.enabled && !(await cloud.flushed(6000))) return 'Waiting for signal to send the last readings: it moves once they have gone.';
  if (!navigator.onLine) return 'No signal: it moves when the new address can be reached.';
  try { await fetch(new URL('sw.js', MOVE_TEST || NEW_HOME).href + '?' + Date.now(), { mode: 'no-cors', cache: 'no-store' }); } catch { return 'The new address can’t be reached from here yet.'; }
  return '';
}
async function moveCheck() {
  if (!ON_OLD_ADDRESS) return;
  let why = await notReadyToMove();
  if (why) return moveBar(why, true);
  // a team phone rejoins on the new address with its code (read from its own membership record) and initials
  let hash = location.hash, member = null;
  if (cloud.enabled && !DEMO && shared.member && !shared.admin) { try { member = await cloud.member(); } catch { member = null; } }
  if (member?.code && member.site) hash = `#/join/${member.site}/${encodeURIComponent(member.code)}${settings.me ? '/' + encodeURIComponent(settings.me) : ''}`;
  else if (shared.member && !shared.admin) return moveBar('It couldn’t read this phone’s team details yet.', true);
  const rest = location.pathname.replace(/^\/prewarm\/?/, '').replace(/^index\.html$/, '');
  const search = location.search.replace(/([?&])oldhost=[^&]*(&|$)/, (m, p1, p2) => (p2 ? p1 : '')).replace(/[?&]$/, ''); // the original query, untouched
  const base = MOVE_TEST ? new URL(MOVE_TEST, location.href) : new URL(NEW_HOME);
  location.replace(base.origin + (MOVE_TEST ? base.pathname : '/') + rest + search + hash);
}
if (ON_OLD_ADDRESS) setTimeout(moveCheck, 1500);

// ---------- offline shell and updates
if ('serviceWorker' in navigator && !DEMO) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // updating reloads the app: an unsaved reading on screen is asked about first
    // the waiting worker may have been replaced by a newer one since the banner showed (several updates in a row), so ask the
    // current one; if nothing takes over in 3 s (Firefox did not), clear the saved copy of the app (never the patients) and reload
    const offer = offerUpdate = w => { const b = $('#update'); b.hidden = false; b.onclick = () => afterAsking(() => {
      b.hidden = true;
      (reg.waiting || w).postMessage('skipWaiting');
      setTimeout(async () => {
        if (reloaded || !navigator.onLine) return;
        // only wipe the saved copy if the network really answers now (14 Oct 2026): a phone whose signal dropped in these
        // 3 seconds would otherwise have no app at all offline
        try { if (!(await fetch('sw.js', { cache: 'no-store' })).ok) return; } catch { return; }
        try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) if (k.startsWith('prewarm-')) await caches.delete(k); } catch { /* reload anyway */ }
        location.reload();
      }, 3000);
    }); };
    swReg = reg;
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    // a phone keeps the app open for hours, and the browser only looks for a new version when the page is opened:
    // look again when the app comes back to the front, when signal returns, and every 10 minutes (owner, 13 Oct 2026)
    const look = () => { if (document.visibilityState === 'hidden') return; reg.update().catch(() => {}); if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting); };
    document.addEventListener('visibilitychange', look);
    addEventListener('online', look);
    setInterval(look, 10 * 60e3);
    look();
  }).catch(() => {});
  // reload only when an update takes over, not when the first install claims the page (that wiped a half-filled form)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reload = () => { reloaded = true; location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    // another tab took the update while a reading is half-entered here: wait for a tap rather than lose it
    if (leaveGuard?.()) { const b = $('#update'); b.hidden = false; b.onclick = () => afterAsking(reload); }
    else reload();
  });
}

render();
