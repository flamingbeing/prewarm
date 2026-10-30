// Scan imports (owner, 20 Oct 2026): Firetop reads each received scan and writes the values it found to scanImports/{id}
// (firestore.rules). Nothing reaches a patient until an admin approves here. Flagged values start unticked, and so does any
// value that would replace one already saved. Values only in Firestore: no photos or crops are stored.
// Phone-first (scan-ux S4): imports grouped by Subject ID; the patient picked from the Subject ID sent with the scan; values
// grouped by form page in form order, only those to check shown (the rest folded), Next to check, the value edited in place
// with the scanner's reading kept beside it, now saved vs scanned for a replacement, and the photo of each value cut from
// this phone's own copy of the page (the field's `box`), when this is the phone that scanned it.
import { FIELDS, EXTRA, BY_ID, EXTRA_BY_ID } from './schema.js';

const fieldOf = id => BY_ID[id] || EXTRA_BY_ID[id];
const ORDER = {}; [...FIELDS, ...EXTRA].forEach((f, i) => { ORDER[f.id] ??= i; }); // form order (a template field before an Extra one of the same id)
const norm = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

// a scanned value as the app stores it: numbers as numbers, blanks left out (same rule as tools/scan/export-scan.mjs)
export function toValue(f, v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if ((f.type === 'num' || f.type === 'int' || f.type === 'code') && s.toUpperCase() !== 'NA' && Number.isFinite(Number(s))) return Number(s);
  return s;
}

const boxOf = b => b && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(b[k])) && b.w > 0 && b.h > 0 ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;

// the rows to show for one import, by form page then form order. `current` is the chosen patient's saved value for a field
// id, or null. `check`: flagged or replacing a saved value (shown); the rest look fine (folded).
export function rowsFor(imp, current = () => null) {
  const skipped = [], rows = [];
  for (const [id, e] of Object.entries(imp.fields || {})) {
    const f = fieldOf(id);
    if (!f) { skipped.push(id); continue; }
    const v = toValue(f, e?.v), flags = Array.isArray(e?.flags) ? e.flags.map(String) : [];
    if (v == null && !flags.length) continue;
    const cur = current(id);
    const replaces = cur != null && cur !== v;
    const page = Number.isInteger(e?.page) && e.page >= 1 && e.page <= 14 ? e.page : null;
    rows.push({ id, label: f.label, unit: f.unit || '', value: v == null ? '' : String(v), flags, now: cur, replaces, page, box: boxOf(e?.box),
      check: flags.length > 0 || replaces, use: v != null && !flags.length && !replaces });
  }
  rows.sort((a, b) => (a.page ?? 99) - (b.page ?? 99) || (ORDER[a.id] ?? 1e9) - (ORDER[b.id] ?? 1e9));
  return { rows, skipped };
}

// rows -> [{ page, check: [rows], fine: [rows] }] in page order (page null last: an import from before pages were sent)
export function byPage(rows) {
  const out = [];
  for (const r of rows) {
    let g = out.find(x => x.page === r.page);
    if (!g) out.push(g = { page: r.page, check: [], fine: [] });
    (r.check ? g.check : g.fine).push(r);
  }
  return out;
}

// the patients whose Subject ID is the one typed on the phone (case and spaces aside)
export function matchPatients(subject, list, sid) {
  const s = norm(subject);
  return s ? list.filter(p => norm(sid(p)) === s) : [];
}

// imports -> [{ key, subject, imports }] by Subject ID (else by scan, so -2, -3 rounds stay with their first read), newest first
export function groupImports(list) {
  const groups = new Map();
  for (const x of list) {
    const key = x.subject ? 's:' + norm(x.subject) : 'c:' + String(x.scan || x.id).replace(/-\d+$/, '');
    if (!groups.has(key)) groups.set(key, { key, subject: x.subject || '', imports: [] });
    groups.get(key).imports.push(x);
  }
  const latest = g => Math.max(...g.imports.map(x => x.createdAt || 0));
  for (const g of groups.values()) g.imports.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return [...groups.values()].sort((a, b) => latest(b) - latest(a));
}

// the part of a W x H page photo to show for a field's box, with room around it so the cell's lines show
export function cropRect(box, W, H) {
  const px = Math.max(0.02, box.w * 0.15), py = Math.max(0.012, box.h * 0.5);
  const x0 = Math.max(0, box.x - px), y0 = Math.max(0, box.y - py), x1 = Math.min(1, box.x + box.w + px), y1 = Math.min(1, box.y + box.h + py);
  return { sx: Math.round(x0 * W), sy: Math.round(y0 * H), sw: Math.max(1, Math.round((x1 - x0) * W)), sh: Math.max(1, Math.round((y1 - y0) * H)) };
}

// the round of a scan: <scan> is the first read, <scan>-2 a retake or a late page read after it (a phone's own reading,
// <scan>-phone-<stamp>, has no round)
const roundOf = x => { const m = x.via !== 'phone' && /-(\d+)$/.exec(x.id); return m && x.scan && x.id === `${x.scan}-${m[1]}` ? Number(m[1]) : 1; };

export function mount({ view, esc, toast, cloud, patients, sid, val, setField, photo }) {
  const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const state = { list: [], open: null, pid: '', finding: false, find: '', next: -1, edits: {}, ticks: {} };
  const patientList = () => Object.values(patients()).filter(p => !p.deleted && !p.lock?.on)
    .sort((a, b) => sid(a).localeCompare(sid(b)));
  const paint = h => { view.innerHTML = h; };
  const $ = s => view.querySelector(s);

  async function load() {
    paint('<p class="muted">Loading scan imports…</p>');
    try { state.list = await cloud.scanImports(); } catch (e) { return paint(`<p class="note">${esc(cloud.friendly(e))}</p>`); }
    list();
  }

  function list() {
    state.open = null;
    const pending = x => x.status === 'pending';
    const flagged = x => rowsFor(x).rows.filter(r => r.flags.length).length; // replacements show once the patient is known
    const line = x => `<li><button class="secondary siimp" data-open="${esc(x.id)}"><span>${esc(when(x.createdAt))}${roundOf(x) > 1 ? ` · round ${roundOf(x)}` : ''}${x.via === 'phone' ? ' · read on phone' : ''}</span>
      <small>${Object.keys(x.fields || {}).length} values${pending(x) ? (flagged(x) ? ` · ${flagged(x)} flagged` : ' · none flagged') : ' · ' + esc(x.status)}</small></button></li>`;
    const card = g => `<section class="sigrp"><h3>${g.subject ? esc(g.subject) : 'No Subject ID'}</h3><ul class="plain" role="list">${g.imports.map(line).join('')}</ul></section>`;
    const groups = groupImports(state.list), pend = groups.filter(g => g.imports.some(pending)), done = groups.filter(g => !g.imports.some(pending));
    paint(`<div class="stack"><p class="muted small">Firetop reads each page you send from Scan pages and lists it here, by Subject ID. Nothing reaches a patient until you approve it.</p>
      <h2>Waiting for approval</h2>${pend.length ? pend.map(card).join('') : '<p class="muted">Nothing waiting.</p>'}
      ${done.length ? `<details class="sidone"><summary>Done (${done.length})</summary>${done.map(card).join('')}</details>` : ''}
      <button class="secondary" id="sirefresh">Refresh</button></div>`);
    view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => open(state.list.find(x => x.id === b.dataset.open)));
    $('#sirefresh').onclick = load;
  }

  function open(imp) {
    const hits = imp.status === 'pending' ? matchPatients(imp.subject, patientList(), sid) : [];
    Object.assign(state, { open: imp, pid: hits.length === 1 ? hits[0].id : '', finding: false, find: imp.subject || '', next: -1, edits: {}, ticks: {} });
    detail();
    view.scrollIntoView?.({ block: 'start' });
  }

  function patientHtml(imp, p, pend) {
    if (!pend) return '';
    if (p && !state.finding) {
      return `<div class="sipt"><p><span class="muted">Patient</span> <b>${esc(sid(p))}</b>${p.site ? ` (${esc(p.site)})` : ''}${norm(sid(p)) === norm(imp.subject) ? '<small class="muted"> · matches the Subject ID sent</small>' : ''}</p>
        <button class="secondary" id="sichange">Change patient</button></div>`;
    }
    const all = patientList(), q = norm(state.find);
    const found = all.filter(x => !q || norm(sid(x)).includes(q)).slice(0, 8);
    return `<div class="sipt">${imp.subject && !matchPatients(imp.subject, all, sid).length ? `<p class="note">No patient with Subject ID ${esc(imp.subject)} on this phone: find the right one.</p>` : ''}
      <label class="lab" for="sifind">Which patient is this?</label>
      <input id="sifind" type="search" value="${esc(state.find)}" placeholder="Type the Subject ID" autocomplete="off" autocapitalize="characters">
      <ul class="plain" role="list">${found.map(x => `<li><button class="secondary" data-pid="${esc(x.id)}">${esc(sid(x))}${x.site ? ` (${esc(x.site)})` : ''}</button></li>`).join('') || '<li class="muted">No patient matches.</li>'}</ul>
      ${p ? '<button class="secondary" id="sikeep">Keep ' + esc(sid(p)) + '</button>' : ''}</div>`;
  }

  function rowHtml(r, i, pend, can) {
    const ed = state.edits[r.id], v = ed ?? r.value, tick = state.ticks[r.id] ?? (r.use || (ed != null && ed !== r.value));
    return `<li class="sirow${r.flags.length ? ' flag' : ''}" id="sir${i}" data-row="${i}" tabindex="-1">
      ${r.box ? `<div class="sicrop" data-crop="${i}"><span class="muted small">${photo ? 'Loading photo…' : 'Photo only on the phone that scanned it'}</span></div>` : ''}
      <label class="sihead"><input type="checkbox" data-use="${i}" ${tick ? 'checked' : ''} ${pend && can ? '' : 'disabled'}> <b>${esc(r.label)}</b>${r.unit ? ` <span class="muted">(${esc(r.unit)})</span>` : ''}</label>
      ${r.replaces ? `<div class="sicmp"><span><small>Now saved</small><b>${esc(r.now)}</b></span><span><small>Scanned</small><b>${esc(r.value || '(blank)')}</b></span></div>` : ''}
      <input class="sival" data-val="${i}" value="${esc(v)}" aria-label="${esc(r.label)}" enterkeyhint="next" ${pend ? '' : 'disabled'}>
      <small class="muted siread" data-read="${i}">${ed != null && ed !== r.value ? `Scanner read: ${esc(r.value || '(blank)')}` : r.value ? 'As the scanner read it' : 'The scanner read nothing here'}</small>
      ${r.flags.map(f => `<small class="note">${esc(f)}</small>`).join('')}</li>`;
  }

  function detail() {
    const imp = state.open, p = patients()[state.pid], pend = imp.status === 'pending';
    const { rows, skipped } = rowsFor(imp, id => p ? val(p, id) : null);
    const groups = byPage(rows), idx = new Map(rows.map((r, i) => [r, i]));
    const nCheck = rows.filter(r => r.check).length, nFine = rows.length - nCheck;
    const bad = (imp.pages || []).filter(x => x.accepted === false).length;
    const row = r => rowHtml(r, idx.get(r), pend, !!p);
    paint(`<div class="stack siimport"><button class="secondary" id="siback">‹ All imports</button>
      <h2>${imp.subject ? esc(imp.subject) : 'No Subject ID'}<small class="muted"> · ${esc(when(imp.createdAt))}${roundOf(imp) > 1 ? ` · round ${roundOf(imp)}` : ''}${imp.via === 'phone' ? ' · read on phone' : ''}</small></h2>
      ${pend ? '' : `<p class="muted">${esc(imp.status)}${imp.reviewedBy ? ' by ' + esc(imp.reviewedBy) : ''}</p>`}
      ${bad ? `<p class="note">${bad} photo${bad > 1 ? 's' : ''} did not line up and ${bad > 1 ? 'were' : 'was'} not read: retake and send again.</p>` : ''}
      ${skipped.length ? `<p class="muted small">${skipped.length} value${skipped.length > 1 ? 's' : ''} not in this app’s form, left out.</p>` : ''}
      ${patientHtml(imp, p, pend)}
      <p class="sisum"><b>${nCheck} to check</b> · ${nFine} look fine${p || !pend ? '' : ' · choose the patient to tick values'}</p>
      ${groups.map(g => `<section class="sipage"><h3>${g.page ? `Page ${g.page}` : 'Page not known'}</h3>
        ${g.check.length ? `<ul class="plain" role="list">${g.check.map(row).join('')}</ul>` : ''}
        ${g.fine.length ? `<details class="sifine"><summary>${g.fine.length} value${g.fine.length > 1 ? 's' : ''} look${g.fine.length > 1 ? '' : 's'} fine</summary><ul class="plain" role="list">${g.fine.map(row).join('')}</ul></details>` : ''}</section>`).join('')}
      ${pend ? `<div class="sibar">${nCheck ? `<button class="secondary" id="sinext">Next to check</button>` : ''}<button class="primary" id="siok" ${p ? '' : 'disabled'}>Approve ticked values</button></div>
        <button class="secondary" id="sino">Reject this scan</button>` : ''}</div>`);
    $('#siback').onclick = list;
    crops(imp, rows);
    if (!pend) return;
    const re = () => { keep(rows); detail(); };
    $('#sichange') && ($('#sichange').onclick = () => { keep(rows); state.finding = true; detail(); $('#sifind')?.focus(); });
    $('#sikeep') && ($('#sikeep').onclick = () => { state.finding = false; re(); });
    const fi = $('#sifind');
    if (fi) fi.oninput = () => { const at = fi.selectionStart; state.find = fi.value; re(); const n = $('#sifind'); n.focus(); n.setSelectionRange?.(at, at); };
    view.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => { keep(rows); state.pid = b.dataset.pid; state.finding = false; state.ticks = {}; detail(); });
    // typing a value ticks it and shows what the scanner read; Enter goes on to the next value to check
    view.querySelectorAll('[data-val]').forEach(inp => {
      const i = +inp.dataset.val, r = rows[i];
      inp.oninput = () => {
        state.edits[r.id] = inp.value;
        const c = $(`[data-use="${i}"]`); if (c && !c.disabled) { c.checked = true; state.ticks[r.id] = true; }
        $(`[data-read="${i}"]`).textContent = inp.value !== r.value ? `Scanner read: ${r.value || '(blank)'}` : 'As the scanner read it';
      };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); next(rows, i); } };
    });
    view.querySelectorAll('[data-use]').forEach(c => c.onchange = () => { state.ticks[rows[+c.dataset.use].id] = c.checked; });
    $('#sinext') && ($('#sinext').onclick = () => next(rows));
    $('#sino').onclick = async () => {
      if (!confirm('Reject this scan? Nothing is saved to any patient.')) return;
      try { await cloud.reviewScanImport(imp.id, 'rejected'); imp.status = 'rejected'; toast('Rejected'); list(); } catch (e) { toast(cloud.friendly(e)); }
    };
    $('#siok').onclick = async () => {
      const q = patients()[state.pid]; if (!q) return;
      const picked = rows.map((r, i) => ({ r, on: $(`[data-use="${i}"]`).checked, v: $(`[data-val="${i}"]`).value }))
        .filter(x => x.on).map(x => ({ id: x.r.id, v: toValue(fieldOf(x.r.id), x.v) })).filter(x => x.v != null);
      if (!picked.length) return toast('Tick at least one value.');
      if (!confirm(`Save ${picked.length} value${picked.length > 1 ? 's' : ''} to ${sid(q)}?`)) return;
      for (const x of picked) setField(q, x.id, x.v);
      try { await cloud.reviewScanImport(imp.id, 'approved'); imp.status = 'approved'; toast(`Saved to ${sid(q)}`); list(); }
      catch (e) { toast('Saved to the patient, but the import could not be marked approved: ' + cloud.friendly(e)); }
    };
  }

  // edits and ticks survive a repaint (changing the patient, finding one)
  function keep(rows) {
    rows.forEach((r, i) => {
      const inp = $(`[data-val="${i}"]`), c = $(`[data-use="${i}"]`);
      if (inp && inp.value !== r.value) state.edits[r.id] = inp.value;
      if (c && !c.disabled) state.ticks[r.id] = c.checked;
    });
  }

  // Next to check: the next shown value after the last one (or after `from`), round to the first again
  function next(rows, from = state.next) {
    const order = rows.map((r, i) => i).filter(i => rows[i].check);
    if (!order.length) return;
    const i = order.find(k => k > from) ?? order[0];
    state.next = i;
    const li = $(`#sir${i}`); if (!li) return;
    view.querySelectorAll('.sirow.on').forEach(x => x.classList.remove('on'));
    li.classList.add('on'); li.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); li.focus({ preventScroll: true });
    const n = order.indexOf(i) + 1, b = $('#sinext'); if (b) b.textContent = `Next to check (${n} of ${order.length})`;
  }

  // each value's photo, cut from this phone's tidied copy of its page; a page not on this phone says so
  async function crops(imp, rows) {
    const pages = [...new Set(rows.filter(r => r.box && r.page).map(r => r.page))];
    const none = el => { el.innerHTML = '<span class="muted small">Photo only on the phone that scanned it</span>'; };
    view.querySelectorAll('[data-crop]').forEach(el => { if (!rows[+el.dataset.crop].page) none(el); });
    for (const pg of pages) {
      let bmp = null;
      try { const blob = photo && await photo(imp.scan || imp.id, imp.subject || '', pg); bmp = blob ? await createImageBitmap(blob) : null; } catch { bmp = null; }
      if (state.open !== imp) { bmp?.close?.(); return; }
      rows.forEach((r, i) => {
        if (r.page !== pg || !r.box) return;
        const el = $(`[data-crop="${i}"]`); if (!el) return;
        if (!bmp) return none(el);
        const { sx, sy, sw, sh } = cropRect(r.box, bmp.width, bmp.height);
        const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
        cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Photo of ${r.label} on page ${pg}`);
        el.replaceChildren(cv);
      });
      bmp?.close?.();
    }
  }

  load();
}
