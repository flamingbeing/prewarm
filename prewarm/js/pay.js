// Email and PayNow for the participant's payment (owner, 21 Oct 2026): a page opened from the Induction room tab.
// What is typed goes only to payments/{patient id} (firestore.rules): team phones write it and can't read it back;
// study admins see it, tick Email sent and Payment sent, then delete the email and PayNow. The patient record keeps
// only when they were saved and when they were deleted (pay_saved, pay_cleared), never the values.

// '' when fine, else what to fix; a PayNow number is a Singapore mobile (8 digits starting 8 or 9, +65 optional)
export const cleanPaynow = s => String(s ?? '').replace(/[\s-]/g, '').replace(/^\+?65(?=[89]\d{7}$)/, '');
export function checkPay(email, paynow) {
  const e = String(email ?? '').trim(), n = cleanPaynow(paynow);
  if (!e && !n) return 'Enter the email or the PayNow number.';
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Check the email address.';
  if (n && !/^[89]\d{7}$/.test(n)) return 'The PayNow number is a Singapore mobile: 8 digits starting with 8 or 9.';
  return '';
}

// admin list order: still to pay first, then paid but not yet deleted, then done; newest first within each
export const payStage = d => d.cleared ? 2 : d.paid ? 1 : 0;
export const payOrder = list => [...list].sort((a, b) => payStage(a) - payStage(b) || (b.setAt || 0) - (a.setAt || 0));

const when = st => st ? `${new Date(st.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${st.by ? ', ' + st.by : ''}` : '';

// one entry's ticks and Delete, the same on the patient's page and the admin list
export function ticksHtml(d, esc) {
  const tick = (k, l) => `<label class="tog paytick"><input type="checkbox" data-paytick="${k}" data-pid="${esc(d.pid)}" ${d[k] ? 'checked' : ''}><span>${l}${d[k] ? `<small>${esc(when(d[k]))}</small>` : ''}</span></label>`;
  const ids = d.email || d.paynow;
  return `${tick('emailSent', 'Email sent')}${tick('paid', 'Payment sent')}
    ${ids ? `<button class="danger" data-payclear="${esc(d.pid)}" ${d.paid ? '' : 'disabled'}>Delete email and PayNow</button>
    ${d.paid ? '' : '<small class="muted">Delete opens once Payment sent is ticked.</small>'}` : ''}
    ${d.cleared ? `<p class="okline small">✓ Email and PayNow deleted (${esc(when(d.cleared))})</p>` : ''}`;
}

// the ticks and Delete for an admin: tick / untick, and delete after a confirm; then redraw
export function wireTicks(root, { cloud, toast, list, after }) {
  root.onclick = async e => {
    const c = e.target.closest('[data-payclear]');
    if (!c) return;
    const d = list().find(x => x.pid === c.dataset.payclear);
    if (!confirm(`Delete the email and PayNow number for ${d?.sid || 'this participant'}?\n\nThis can't be undone. The ticks stay.`)) return;
    c.disabled = true;
    try { await cloud.payClear(c.dataset.payclear); toast('Email and PayNow deleted'); after(c.dataset.payclear, 'cleared'); }
    catch (err) { c.disabled = false; toast(cloud.friendly(err, 'pay')); }
  };
  root.onchange = async e => {
    const i = e.target.closest('[data-paytick]');
    if (!i) return;
    if (!i.checked && !confirm('Untick this?')) { i.checked = true; return; }
    i.disabled = true;
    try { await cloud.payTick(i.dataset.pid, i.dataset.paytick, i.checked); after(i.dataset.pid, i.dataset.paytick); }
    catch (err) { i.checked = !i.checked; i.disabled = false; toast(cloud.friendly(err, 'pay')); }
  };
}
