// Settings, Ready for a case?, Delete participants, Scan pages, Scan imports and finishing an admin sign-in.
import { SITES } from './schema.js';
import { val, lastEdit, isGone, markDeleted, restore } from './store.js';
import * as cloud from './cloud.js';
import * as scan from './scan.js';
import * as scanImports from './scan-imports.js';
import { $, SIZES, theme, applySize, cleanup, esc, go, header, paint, patients, render, route, saveAll, saveSettings, settings, shared, showBanner, sid, sidL, toast, view } from './ui-core.js';
import { failed, finishAdmin, lastSync, logOut, pending, refreshHtml, set, sharing, swReg, sync, syncText, uploadLocal, watch, wireRefresh } from './ui-sync.js';
import { LOCK_ICON, status } from './ui-home.js';
import { beep } from './ui-alerts.js';

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
    ['App is up to date', !swReg?.waiting && !swReg?.installing, 'tap Refresh now below: the app restarts on the new version'],
  ];
  const bad = rows.filter(r => !r[1]).length;
  return `<h2>Ready for a case?</h2><ul class="ready" role="list" aria-label="Checks before a case">${rows.map(([l, ok, fix]) => `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span><span><b>${esc(l)}</b>${ok ? '' : `<small>${esc(fix)}</small>`}</span></li>`).join('')}</ul>
    <small class="muted">${bad ? `${bad} to fix before a case.` : 'All good.'} Also make a fresh PACU link per patient and test it once on a phone that is not on the team.</small>`;
}
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
    ${group('This phone', `<h3>Screen size</h3><div class="seg sizes" role="group" aria-label="Screen size">${SIZES.map(([k, l]) => `<button type="button" class="chip" data-zoom="${k}" aria-pressed="${String(settings.zoom || '1') === k}">${l}</button>`).join('')}</div>
    <small class="muted">Makes text and buttons bigger or smaller on this phone.</small>
    <h3>Look</h3><div id="themebox"></div>`)}
    ${group('Scan pages (beta)', `<label class="tog"><input type="checkbox" id="scanon" ${settings.scan ? 'checked' : ''}><span>Show Scan pages<small>Photograph the paper form’s pages. Pages stay on this phone for now.</small></span></label>
    ${settings.scan ? '<a class="secondary" href="#/scan">Scan pages</a>' : ''}
    ${settings.scan && shared.admin ? '<a class="secondary" href="#/scanimports">Scan imports (approve)</a>' : ''}`)}</div>`);
  wireRefresh();
  // the kit's look, light / dark, density and Bars and sheets (kept on this phone)
  theme.then(t => { const box = $('#themebox'); if (t && box && !box.childElementCount) t.themeSwitch(box); });
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
export async function joinTeam(site, code, btn) {
  btn.disabled = true; btn.textContent = 'Joining…';
  shared.joining = true;
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
  } finally { shared.joining = false; }
}
