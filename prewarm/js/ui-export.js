// Export: the Excel file and the blank Word form.
import { isGone } from './store.js';
import { workbook } from './export.js';
import * as cloud from './cloud.js';
import * as wordview from './wordview.js';
import { $, DEMO, esc, header, paint, patients, render, route, shared, toast } from './ui-core.js';
import { forgetBlank } from './ui-word.js';

// ---------- export
route(/^\/export$/, () => {
  header('Export', '#/settings');
  const n = Object.values(patients).filter(p => !isGone(p)).length;
  paint(`<div class="stack">
    <p>An Excel file in the study template’s layout: one row per patient, the template’s 572 columns, filled from everything entered here (op day and Perioperative data), so rows paste into the master sheet.</p>
    <ul class="muted small"><li><b>Data Collection</b>: the template sheet</li><li><b>Readings</b>: every reading with the time it was saved and who saved it</li>
    <li><b>Extra</b>: items the template has no column for (transfusion volumes, investigation rows, PACU transfusion, NuDESC items, sign-offs)</li></ul>
    <button class="primary big" id="xl" ${n ? '' : 'disabled'}>Export ${n} patient${n === 1 ? '' : 's'}</button>
    ${shared.admin ? '<div class="fld" id="blankbox"><b>Blank data collection form</b><small class="muted">Loading…</small></div>' : ''}</div>`);
  $('#xl').onclick = () => downloadWorkbook(Object.values(patients));
  if (shared.admin) blankFormBox();
});
// the blank Word form: admins upload it here, not on the admin screen, which is for people's access (owner, 19 Oct 2026)
async function blankFormBox() {
  let bf = null;
  try { bf = await cloud.blankForm(); } catch (e) { const b = $('#blankbox'); if (b) b.querySelector('small').textContent = cloud.friendly(e); return; }
  const box = $('#blankbox'); if (!box) return;
  box.innerHTML = `<b>Blank data collection form</b>
      <small class="muted">${bf ? `${esc(bf.name)}, uploaded ${new Date(bf.setAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} by ${esc(bf.setBy)}.` : 'Not uploaded yet.'} The Form view fills this Word file in for each patient; teams can download it or save it as a PDF. Its file details (author, editor, company) are removed on upload.</small>
      <label class="secondary filebtn">${bf ? 'Replace' : 'Upload'} the blank form (.docx)<input type="file" id="blankup" accept=".docx" hidden></label>`;
  $('#blankup').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let r;
    try { r = await wordview.prepareBlank(f); } catch (err) { toast(err.message); return; }
    if (r.missed.length && !confirm(`${r.missed.length} place(s) didn’t match the v3.2 form and will stay blank:\n${r.missed.slice(0, 12).join('\n')}${r.missed.length > 12 ? '\n…' : ''}\n\nUpload anyway?`)) return;
    try { await cloud.setBlankForm(r.b64, f.name, r.size); forgetBlank(); toast('Blank form saved'); render(); }
    catch (err) { toast(cloud.friendly(err)); }
  };
}
// the Excel file for the given patients: shared from the phone's share sheet when it can, else downloaded
export async function downloadWorkbook(live) {
  const bytes = workbook(live, []);
  // the phone's own date (toISOString is UTC: before 8 am in Singapore it named the file for yesterday), and how many patients
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = live.filter(p => !isGone(p)).length;
  const name = `prewarming-study-${day}-${n}pt${DEMO ? '-demo' : ''}.xlsx`;
  const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
