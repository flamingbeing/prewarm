// The home page (patient list, locking, complete ticks) and New patient.
import { newRecord, val, lastEdit, isGone } from './store.js';
import { $, DEMO, GROUPS, cleanup, esc, go, header, hooks, paint, patients, route, saveAll, settings, shared, sid, sidL, toast, view } from './ui-core.js';
import { failed, pending, refreshHtml, set, sharing, sync, syncText, wireRefresh } from './ui-sync.js';
import { defaultSeries, mmss, nextDue } from './ui-patient.js';
import { charting, nextHref, progressHtml, startAlerts } from './ui-alerts.js';
import { downloadWorkbook } from './ui-export.js';

// ---------- home
route(/^\/$/, home);
// Locking (owner, 12 Oct 2026): a study admin (or anyone, in demo mode) picks patients on the home page and locks
// them; nobody can open a locked patient, and the rules stop members changing it, until an admin unlocks it.
const canLock = () => shared.admin || DEMO;
export const LOCK_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
// the update helper page: out of the app's service-worker scope on the old address, inside the app's folder on the new one
export const UPDATE_HELPER = location.hostname === 'prewarmstudy.anawj.com' ? 'update.html' : '../prewarm-update/';
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
export function podDays(p) {
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
export const declined = p => String(val(p, 'consent_st')) === '0';
export function status(p) {
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
export const isDraft = p => val(p, 'arm') == null && !declined(p);
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

hooks.home = home; hooks.canLock = canLock;
