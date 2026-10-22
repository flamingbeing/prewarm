// Perioperative data: the study's other pages (pre-op, day 1, day 2 and discharge).
import { PAGES } from './schema.js';
import { val, isGone } from './store.js';
import { GROUPS, cleanup, esc, field, go, header, paint, patients, route, setTitle, sidL, toast, view } from './ui-core.js';
import { set } from './ui-sync.js';
import { defaultSeries, topBar } from './ui-patient.js';
import { disableSealed, sealNote, sealedBy, sealedMsg, signoffClick, signoffHtml } from './ui-alerts.js';
import { FORM, REDRAW, fieldHtml, recalc, typedValue } from './ui-forms.js';

// ---------- other data: the study's remaining pages (pre-op, day 1 and 2 chart review, discharge), all on one page under
// headers that open by default (owner, 12 Oct 2026). Built for a computer keyboard too: Enter or ↓ goes to the next
// question, ↑ to the one before; on a row of choices ← → move along it and Enter or Space picks one and moves on.
// The page is split in three (owner, 13 Oct 2026): pre-op and patient details, day 1, day 2 (with discharge). Each has its own
// complete tick; the questions are the same and in the same order as before.
export const DATA_PARTS = [
  { path: 'data', sign: 'periop', short: 'Pre-op', title: 'Pre-op and patient details', pages: ['preop', 'meds', 'bloods'], study: true },
  { path: 'data/day1', sign: 'pod1', short: 'POD1', title: 'POD1', pages: ['pod1', 'pod1an'] },
  { path: 'data/day2', sign: 'pod2', short: 'POD2', title: 'POD2', pages: ['pod2', 'pod2an'] },
  // Discharge has its own page and tick (owner, 21 Oct 2026; it was part of POD2, whose tick covered it)
  { path: 'data/dc', sign: 'dc', short: 'Discharge', title: 'Discharge', pages: ['dc'] },
];
export const DATA_SIGNS = new Set(DATA_PARTS.map(d => d.sign));
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
