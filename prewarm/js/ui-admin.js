// Admin: join codes and members.
import { SITES } from './schema.js';
import * as cloud from './cloud.js';
import { $, cleanup, esc, header, paint, render, route, shared, toast, view } from './ui-core.js';
import { joinLink, qrSvg } from './ui-share.js';

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
