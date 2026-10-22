// Join links and the share pages (Share subject, Share to PACU).
import { SITES } from './schema.js';
import { val, isGone } from './store.js';
import * as cloud from './cloud.js';
import { qrcode } from './vendor/qrcode.js';
import { $, cleanup, esc, go, header, paint, patients, render, route, saveSettings, settings, shared, sid, sidL, toast, view, write } from './ui-core.js';
import { guest, makePacuLink, pacuLinkHtml, pacuToken, pacuUrl, set, sharing, stopPacuLink, sync, team, watch } from './ui-sync.js';
import { isDraft } from './ui-home.js';
import { joinTeam } from './ui-settings.js';

// ---------- join link: #/join/{site}/{code} (after the #, so the code never reaches a server)
export const joinLink = (site, code) => location.origin + location.pathname + (/emulator/.test(location.search) ? '?emulator' : '') + `#/join/${site}/${encodeURIComponent(code)}`;
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

export function qrSvg(text, label = 'QR code of the join link') {
  const qr = qrcode(0, 'M');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
