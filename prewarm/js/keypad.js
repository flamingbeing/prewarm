// Quick-entry popup (owner, 13 Oct 2026): a big number pad for temperatures, BP, HR and BIS, and a time pad for key
// times. It is a modal <dialog>; the display is a real input (kept off the phone's own keyboard with inputmode="none"),
// so a computer keyboard works too: digits, Enter = OK, Esc = Back.
//
//   openKeypad({ title, mode, value, nowValue, onDone(v), onClear(), onNext(v), nextLabel, hint })
//     mode 'temp'  digits and one point; three digits like 366 mean 36.6 (see normaliseTemp)
//     mode 'dec'   digits and one point (room temperature)
//     mode 'int'   digits only (BP, HR, BIS)
//     mode 'time'  digits only, 24 hour clock: 0731 or 731 means 07:31; the fourth digit saves it; Now saves the
//                  current time in one tap
//   onDone gets the text to save ('' = emptied). Back closes without a change.

import { normaliseTemp } from './schema.js';

let open = null;
export const closeKeypad = () => { if (open) { try { open.close(); } catch { /* already closed */ } } };

const timeOf = digits => {
  const d = digits.replace(/\D/g, '');
  if (d.length < 3 || d.length > 4) return null;
  const h = +d.slice(0, d.length - 2), m = +d.slice(-2);
  return h > 23 || m > 59 ? null : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function openKeypad(o) {
  closeKeypad();
  const mode = o.mode || 'int', time = mode === 'time', point = mode === 'temp' || mode === 'dec';
  const d = document.createElement('dialog');
  d.className = 'kp';
  d.setAttribute('aria-label', o.title);
  d.innerHTML = `<div class="kphead"><b>${esc(o.title)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</div>
    ${time && o.nowValue ? `<button class="kpnow" data-now>Now <b>${esc(o.nowValue)}</b></button>` : ''}
    <input class="num kpin" ${time ? 'id="evtime"' : ''} inputmode="none" autocomplete="off" aria-label="${esc(o.title)}" placeholder="${time ? 'hh:mm' : ''}" value="${esc(o.value ?? '')}">
    <div class="kpgrid" role="group" aria-label="Digits">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
      ${point ? '<button data-k=".">.</button>' : '<span></span>'}<button data-k="0">0</button><button data-k="back" aria-label="Delete last digit">⌫</button></div>
    <div class="kpbtns"><button class="secondary" data-a="back">Back</button><button class="secondary" data-a="clear">Clear</button>
      ${o.onNext ? `<button class="secondary" data-a="next">${esc(o.nextLabel || 'Next')}</button>` : ''}<button class="save" data-a="ok">OK</button></div>`;
  document.body.append(d);
  const inp = d.querySelector('input');
  let finished = false, fresh = inp.value !== ''; // the first key replaces what the box held
  const finish = fn => { if (finished) return; finished = true; d.close(); fn?.(); };
  // what the box holds, in the form that is saved ('' when empty); null when it can't be saved yet
  const result = () => {
    const raw = inp.value.trim();
    if (raw === '') return '';
    if (time) return timeOf(raw);
    if (mode === 'temp') { const v = normaliseTemp(raw); return /^\d{1,2}(\.\d+)?$/.test(v) ? v : null; }
    if (mode === 'dec') { const v = raw.replace(',', '.'); return /^\d{1,2}(\.\d+)?$/.test(v) ? v : null; }
    return /^\d{1,3}$/.test(raw) ? raw : null;
  };
  const ok = go => {
    const v = result();
    if (v == null) { inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 500); return false; }
    finish(() => (go ? o.onNext : o.onDone)(v));
    return true;
  };
  const shape = () => {
    // keep only what the pad allows
    let v = inp.value;
    if (time) { v = v.replace(/\D/g, '').slice(0, 4); v = v.length > 2 ? v.slice(0, v.length - 2) + ':' + v.slice(-2) : v; }
    else if (point) { v = v.replace(',', '.').replace(/[^\d.]/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); v = v.slice(0, 5); }
    else v = v.replace(/\D/g, '').slice(0, 3);
    if (v !== inp.value) inp.value = v;
  };
  inp.addEventListener('input', () => {
    shape();
    // the fourth digit of a time saves it
    if (time && inp.value.replace(/\D/g, '').length === 4) ok(false);
  });
  d.addEventListener('click', e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k != null) {
      if (k === 'back') inp.value = inp.value.slice(0, -1);
      else inp.value = (fresh ? '' : inp.value) + k;
      fresh = false;
      inp.dispatchEvent(new Event('input'));
      // three digits of a temperature (like 366) are a whole reading: save it
      if (mode === 'temp' && /^\d{3}$/.test(inp.value) && !finished) { const v = result(); if (v != null && +v >= 25 && +v <= 45) ok(!!o.onNext); }
      return;
    }
    if (e.target.closest('[data-now]')) return finish(() => o.onDone(o.nowValue));
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') return finish();
    if (a === 'clear') return finish(() => (o.onClear || (() => o.onDone('')))());
    if (a === 'ok') return void ok(false);
    if (a === 'next') return void ok(true);
    if (e.target === d) finish(); // a tap outside the pad
  });
  d.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(false); } });
  d.addEventListener('cancel', e => { e.preventDefault(); finish(); });
  d.addEventListener('close', () => { d.remove(); if (open === d) open = null; });
  open = d;
  d.showModal();
  inp.focus(); inp.select();
}
