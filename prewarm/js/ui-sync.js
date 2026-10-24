// Sharing with the team: saving and sending fields, sync status, log out, the PACU nurse link, Refresh now, sign-in.
import { PACU_KEYS } from './schema.js';
import { setVal, val, mergeRecord, isGone } from './store.js';
import * as cloud from './cloud.js';
import { $, NS, esc, go, leaveGuard, patients, read, render, saveAll, saveSettings, settings, shared, sid, toast, view, write } from './ui-core.js';
import { UPDATE_HELPER } from './ui-home.js';
import { paintSyncChip } from './ui-patient.js';
import { qrSvg } from './ui-share.js';

export function set(p, id, v) {
  if (p.lock?.on) return toast('Locked: read only. Unlock it on the home page to change it.');
  if (setVal(p, id, v, settings.me)) { saveAll(); sync(p, [id]); }
}

// ---------- sharing
// subjects this phone opened from Share subject links (owner, 21 Oct 2026): patient id -> { token, site }. A phone not on
// a team sees and edits only these (the rules let it read each one by id, nothing else)
export let guest = read('guest', {});
export const team = () => !!(shared.member || shared.admin);
export const sharing = () => cloud.enabled && (team() || (!!shared.uid && Object.keys(guest).length > 0));
// shared subjects not already covered by the team's own list
const guestIds = () => shared.admin ? [] : Object.keys(guest).filter(id => guest[id].site !== shared.member?.site);
// Every save goes to this phone's outbox first (the sync engine, cloud.js), then to the team. pending: patients with
// saves not yet sent (no signal); failed: patients whose last save did not reach the team and will not retry by itself:
// id -> why (14 Oct 2026), shown in the chip. Both are worked out from the outbox, plus the app's own reasons (appFailed:
// not shared, no hospital) that never reach it.
export let pending = {};
export let failed = {};
let appFailed = read('failed', {});
const why = e => /locked|permission|insufficient/i.test(e || '') ? 'refused (locked by the study admin?)' : 'could not be saved';
let outbox = null;
function fromOutbox() {
  const p = {}, f = { ...appFailed };
  for (const x of outbox ? outbox.entries() : []) {
    if (x.kind !== 'patient') continue;
    if (x.state === 'pending') p[x.record.id] = true;
    else if ((x.state === 'failed' || x.state === 'conflict') && !(x.record.id in f)) f[x.record.id] = why(x.error);
  }
  const was = Object.keys(pending).length;
  pending = p; failed = f;
  if (was && !Object.keys(p).length && heard) synced(); else showSync();
}
const setFailed = (id, reason) => { if (reason) appFailed[id] = reason; else if (id in appFailed) delete appFailed[id]; else return; write('failed', appFailed); fromOutbox(); };
let heard = false;   // the team's list has come from the server since this page opened
// when this phone was last fully in step with the server (nothing waiting to send, team's changes received)
export let lastSync = read('lastSync', 0);
function synced() {
  if (Object.keys(pending).length) return;
  lastSync = Date.now(); write('lastSync', lastSync); showSync();
}
export function syncText() {
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
export function sync(p, ids, withLock = false) {
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
  pending[p.id] = true; showSync();
  cloud.push(p, ids, withLock).catch(e => {
    // refused (e.g. an admin locked the patient meanwhile): kept in the outbox as failed (chip turns red) until a later
    // save reaches the team; the outbox says which (fromOutbox)
    toast(e?.code === 'permission-denied' ? `${sid(p)}: ${cloud.friendly(e, 'save')}` : cloud.friendly(e, 'save'));
  }).finally(fromOutbox);
}
// Log out (owner, 12 Oct 2026): leaves the team and deletes every patient on this phone, after a warning, and a
// second one if some changes haven't reached the team yet. Settings (initials, display) stay.
export async function logOut(btn) {
  const n = Object.values(patients).filter(p => !isGone(p)).length;
  const who = shared.member ? `the ${shared.member.site} team` : 'the study';
  if (!confirm(`Log out of ${who} on this phone?\n\nThis deletes all ${n} patient${n === 1 ? '' : 's'} from this phone. What has synced stays with your team.`)) return;
  btn.disabled = true; btn.textContent = 'Checking everything has synced…';
  if (Object.keys(pending).length) { await cloud.flushed(6000); fromOutbox(); }
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
export const pacuToken = p => p.f.pacu_token?.v || null;
const pacuFields = (p, keys = PACU_KEYS) => Object.fromEntries(keys.filter(k => p.f[k]).map(k => [k, p.f[k]]));
export const pacuUrl = token => `${location.origin}${location.pathname}${/[?&]emulator/.test(location.search) ? '?emulator' : ''}#/nurse/${token}`;
const pacuSubs = new Map(); // token -> unsubscribe
// a value from the link only if it is a plain short answer for a PACU field
export const pacuClean = (k, x) => PACU_KEYS.includes(k) && x && typeof x === 'object' && typeof x.t === 'number'
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
export async function makePacuLink(p) {
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
export async function stopPacuLink(p) {
  const token = pacuToken(p); if (!token) return;
  try { await Promise.race([cloud.pacuStop(token), new Promise((_, no) => setTimeout(() => no({ code: 'unavailable' }), 8000))]); }
  catch (e) { return toast(cloud.friendly(e)); }
  pacuSubs.get(token)?.(); pacuSubs.delete(token);
  set(p, 'pacu_token', null);
}
export function pacuLinkHtml(p) {
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
export let swReg = null, offerUpdate = null;
export const setSw = (reg, offer) => { swReg = reg; offerUpdate = offer; };
export const refreshHtml = () => `<div class="refreshbox"><button class="secondary" id="refreshnow">Refresh now</button><small class="muted">Gets the team’s latest data again, sends anything waiting, and checks for a new app version. <span id="appver"></span></small><a class="link" href="${UPDATE_HELPER}">App still won’t update? Get the latest version</a></div>`;
export async function refreshNow(btn) {
  const chip = btn.id === 'syncchip'; // the bar's chip keeps its own text
  btn.disabled = true; const was = btn.textContent; if (!chip) btn.textContent = 'Refreshing…'; else btn.dataset.busy = '1';
  let msg = 'Up to date.';
  try {
    if (cloud.enabled) {
      // who this phone is: a new admin-list entry or team membership counts without logging out
      const u = await cloud.whoAmI();
      if (u) { shared.member = await cloud.member(); shared.admin = !u.isAnonymous ? await cloud.isAdmin() : false; shared.email = u.email || ''; shared.uid = u.uid; }
    }
    if (cloud.enabled && sharing()) { cloud.nudge(); uploadLocal(); await watch(); if (!(await cloud.flushed(5000))) msg = 'Refreshed, but some changes are still waiting for signal.'; }
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
export const wireRefresh = () => {
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
  if (!local.lock?.on && !r.lock?.on && !pending[r.id]) {
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
export async function watch() {
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
      delete patients[id]; changed = true;
    }
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
    }
    if (meta.server) { heard = true; synced(); resyncOnce(); }
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
export function uploadLocal() {
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
export async function finishAdmin(email) {
  if (!email) return toast('Enter the email the link was sent to.');
  try { await cloud.finishAdminLink(email); toast('Signed in'); }
  catch (err) { toast(cloud.friendly(err)); go('#/settings'); }
}
if (cloud.enabled && cloud.isAdminLink()) {
  const email = cloud.savedAdminEmail();
  if (email) finishAdmin(email);
  else location.hash = '#/confirm';
}
let unOutbox = null;
if (cloud.enabled) cloud.onUser(async u => {
  const before = sharing();
  shared.member = u ? await cloud.member() : null;
  shared.admin = u && !u.isAnonymous ? await cloud.isAdmin() : false;
  shared.email = u?.email || '';
  shared.uid = u?.uid || null;
  // this account's saves in the outbox (also those left from an earlier visit: they send now)
  unOutbox?.(); unOutbox = null; outbox = null;
  if (u) { outbox = await cloud.queue(); unOutbox = outbox.onChange(fromOutbox); fromOutbox(); }
  if (shared.member) { settings.site = shared.member.site; if (!settings.me && shared.member.initials) settings.me = shared.member.initials; saveSettings(); }
  uploadLocal();
  await watch();
  // changes held over from an earlier visit: the first word from the server sends again anything still newer (watch)
  document.body.dataset.cloud = 'ready';
  // redraw only when sharing changed, so a half-typed join code isn't wiped
  if (before !== sharing() && !view.contains(document.activeElement)) render();
});
