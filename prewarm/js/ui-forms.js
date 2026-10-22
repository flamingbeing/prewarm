// Forms (intra-op details, PACU, satisfaction), PACU view, the PACU nurse's page and the readings sheet.
import { PAGES, SERIES, BY_ID, IX_COLS, calc, normaliseTemp, isShown } from './schema.js';
import { setVal, val, lastEdit, isGone } from './store.js';
import { openKeypad } from './keypad.js';
import * as cloud from './cloud.js';
import { $, NS, cleanup, esc, field, go, header, lockTaps, nowHM, paint, patients, render, route, saveAll, saveSettings, setLeaveGuard, settings, sid, sidL, toast, view } from './ui-core.js';
import { pacuClean, set, sync } from './ui-sync.js';
import { noWarming, savedAt } from './series.js';
import { status } from './ui-home.js';
import { EVENT_FULL, comfortHtml, comfortTap, defaultSeries, topBar } from './ui-patient.js';
import { SECTION, disableSealed, sealNote, sealedBy, sealedMsg, signoffClick, signoffHtml, tickHtml } from './ui-alerts.js';
import { DATA_PARTS } from './ui-data.js';

// ---------- forms (intra-op details, PACU, satisfaction)
export const FORM = {
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
export function resetSubject(p) {
  if (p.lock?.on) return toast('Locked: read only. Unlock it on the home page to change it.');
  if (!confirm(`Reset ${sid(p)}?\n\nThis clears every time, reading and answer entered for this subject. The Subject ID and group stay.`)) return;
  if (!confirm(`Are you sure? Everything entered for ${sid(p)} will be cleared, on every phone sharing it. This can't be undone.`)) return;
  const ids = Object.keys(p.f).filter(k => !KEEP_ON_RESET.has(k) && val(p, k) != null && setVal(p, k, null, settings.me));
  try { Object.keys(localStorage).filter(k => k.startsWith(NS + 'unsaved:' + p.id + ':')).forEach(k => localStorage.removeItem(k)); } catch { /* fine */ }
  saveAll(); if (ids.length) sync(p, ids);
  setLeaveGuard(null); toast(sid(p) + ' reset');
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
export const REDRAW = new Set(['io_txa_bolus', 'io_txa_inf', ...Object.values(BY_ID).filter(f => f.show).map(f => f.show.f)]);
// totals worked out from other fields fill in when empty or when they still hold the old worked-out value
export function recalc(p) {
  for (const [id, kind] of [['io_txa_total', 'txa'], ['pacu_nudesc', 'nudesc'], ['bmi', 'bmi']]) {
    const c = calc(kind, k => val(p, k));
    if (c != null && !p.lock?.on && (val(p, id) == null || p.f[id]?.auto)) { setVal(p, id, String(c), settings.me); p.f[id].auto = true; saveAll(); sync(p, [id]); }
  }
}
// a typed form answer: numbers only where a number is asked; a temperature outside 25–45 °C is asked about.
// null: refused (the box goes back to what was saved)
export function typedValue(f, raw) {
  const v = f.temp ? normaliseTemp(raw) : String(raw).trim();
  if (v === '') return v;
  if ((f.type === 'num' || f.type === 'int') && !/^-?\d+(\.\d+)?$/.test(v)) { toast(`${f.label}: numbers only.`); return null; }
  if (f.temp && (+v < 25 || +v > 45) && !confirm(`${f.label} ${v} °C looks unusual. Keep it?`)) return null;
  return v;
}
const noFirst = opts => opts.some(o => o[1] === 'No') ? [...opts].sort((a, b) => (b[1] === 'No') - (a[1] === 'No')) : opts;
export function fieldHtml(f, get) {
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
