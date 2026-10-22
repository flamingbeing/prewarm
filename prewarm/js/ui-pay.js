// Email and PayNow (js/pay.js holds the logic).
import { val, isGone } from './store.js';
import * as cloud from './cloud.js';
import * as pay from './pay.js';
import { $, esc, go, header, paint, patients, render, route, settings, shared, sid, sidL, toast, view } from './ui-core.js';
import { set } from './ui-sync.js';
import { declined, isDraft } from './ui-home.js';

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
