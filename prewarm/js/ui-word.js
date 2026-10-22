// The study's Word form filled in for a patient.
import { SERIES, BY_ID, IX_COLS } from './schema.js';
import { val } from './store.js';
import * as cloud from './cloud.js';
import * as wordview from './wordview.js';
import { $, DEMO, NS, cleanup, esc, go, header, paint, patients, render, route, shared, sid, sidL, toast } from './ui-core.js';
import { sharing } from './ui-sync.js';

// ---------- form view: the study's Word form (uploaded once by an admin) filled in for this patient: download it,
// or show it and print / save as PDF. Without the Word form yet: a simple version of the day-of-surgery pages.
let blankCache = null;
export const forgetBlank = () => { blankCache = null; };
async function blankForm() {
  if (blankCache) return blankCache;
  if (DEMO) { try { blankCache = JSON.parse(sessionStorage.getItem(NS + 'blank')); } catch { /* none */ } return blankCache; }
  if (!sharing()) return null;
  try { blankCache = await cloud.blankForm(); } catch { /* offline and never fetched */ }
  return blankCache;
}
function noBlankNote() {
  if (DEMO) return `<div class="note">Demo: this is a simple version. To see the study’s Word form filled in, choose its blank .docx (kept only in this browser tab).
    <label class="secondary filebtn">Choose the blank form<input type="file" id="blankfile" accept=".docx" hidden></label></div>`;
  if (shared.admin) return `<p class="note">This is a simple version. Upload the study’s blank Word form on the <a href="#/export">Export screen</a> to fill in the real form.</p>`;
  if (sharing()) return `<p class="note">This is a simple version: your study admin hasn’t uploaded the blank Word form yet.</p>`;
  return `<p class="note">This is a simple version. <a href="#/settings">Join your hospital’s team</a> to fill in the study’s Word form.</p>`;
}
route(/^\/p\/(\w+)\/form$/, async id => {
  const p = patients[id]; if (!p) return go('#/');
  header(sidL(p) + ' · Form view', '#/p/' + id);
  const here = location.hash, still = () => location.hash === here;
  paint(`<p class="muted">Loading the form…</p>`);
  const b = await blankForm();
  if (!still()) return;
  if (!b) {
    simpleForm(p, id, noBlankNote());
    const inp = $('#blankfile');
    if (inp) inp.onchange = async () => {
      try { const r = await wordview.prepareBlank(inp.files[0]); blankCache = { b64: r.b64, name: inp.files[0].name, setAt: Date.now() }; }
      catch (e) { toast(e.message); return; }
      try { sessionStorage.setItem(NS + 'blank', JSON.stringify(blankCache)); } catch { /* this visit only */ }
      render();
    };
    return;
  }
  paint(`<div class="noprint stack"><div class="sharerow"><button class="primary" id="dl" disabled>Download Word file</button><button class="secondary" id="print" disabled>Save as PDF / Print</button></div>
    <p class="muted small">The study’s data collection form, filled in. Pages with no data stay blank. To save a PDF, choose “Save as PDF” as the printer (iPhone: Share → Print).</p></div>
    <div id="doc" class="wordview"><p class="muted">Filling in the form…</p></div>`);
  let file;
  try { file = await wordview.filledDocx(b.b64, p); if (!still()) return; await wordview.show(file, $('#doc')); }
  catch (e) { if (still()) $('#doc').innerHTML = `<p class="note">Couldn’t open the form: ${esc(e.message)}</p>`; return; }
  if (!still()) return;
  $('#dl').disabled = $('#print').disabled = false;
  $('#dl').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = `${sid(p)} data collection form.docx`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  $('#print').onclick = () => window.print();
  // the Word pages carry their own margins
  const pageStyle = document.createElement('style'); pageStyle.textContent = '@page { size: A4; margin: 0; }'; document.head.append(pageStyle);
  const refit = () => wordview.fit($('#doc'));
  addEventListener('resize', refit);
  cleanup.push(() => { pageStyle.remove(); removeEventListener('resize', refit); });
});
function simpleForm(p, id, note = '') {
  const v = k => val(p, k);
  const t = k => esc(v(k) ?? '');
  const box = on => on ? '☒' : '☐';
  const yn = k => `${box(String(v(k)) === '1')} Yes ${box(String(v(k)) === '0')} No`;
  const line = (k, unit = '') => `<span class="fill">${v(k) != null ? esc(v(k)) + (unit ? ' ' + unit : '') : ''}</span>`;
  const ifYes = (k, html) => String(v(k)) === '1' ? html : '';
  const day = (() => { const ts = Object.values(p.f).map(x => x.t).filter(Boolean); return ts.length ? new Date(Math.min(...ts)).toLocaleDateString('en-GB') : ''; })();
  const head = `<div class="fhead"><span>Subject ID: <b>${esc(sid(p))}</b></span><span>Date of entry: <b>${day}</b></span></div>`;
  const foot = pg => `<div class="ffoot">Name / Signature / Date: <b>${t('sign_' + pg) || '&nbsp;'}</b></div>`;
  const row = (label, html) => `<tr><th>${label}</th><td>${html}</td></tr>`;
  const pw = SERIES.prewarm, it = SERIES.iotemp, hd = SERIES.haemo;
  const cell = (s, pt, c) => { const x = v(`${s}_${pt.key}_${c.key}`); return `<td>${x == null ? '' : esc(c.key === 'ts' && x > 0 ? '+' + x : c.type === 'code' && s === 'iotemp' ? (String(x) === '1' ? 'Y' : 'N') : x)}</td>`; };
  const arm = String(v('arm'));
  const ix = (() => { try { return JSON.parse(v('io_ix_rows')) || []; } catch { return []; } })();
  const comfort = k => BY_ID.sat_pre.opts.map(([o, l]) => `${box(String(v(k)) === String(o))} ${l}`).join('<br>');
  paint(`${note}<div class="noprint stack"><button class="primary big" id="print">Save as PDF / Print</button>
    <p class="muted small">Opens the phone’s print screen: choose “Save as PDF” as the printer (on iPhone: Share → Print, then share the preview).</p></div>
  <div class="form">
  <section class="fpage" tabindex="0" aria-label="Pre-operative intervention page">${head}
    <h3>PRE-OPERATIVE (INTERVENTION)</h3>
    <h4>RANDOMISATION</h4>
    <p>${box(arm === '1')} 30-minute prewarming &nbsp; ${box(arm === '2')} 10-minute prewarming &nbsp; ${box(arm === '3')} No prewarming</p>
    <h4>INTERVENTION DETAILS</h4>
    <table class="ftable kv">${row('Time that gown was put on', line('pw_gown') + ' (24 hour clock)')}
      ${row('Start time of active warming', (v('pw_start') && v('pw_start') !== 'NA' ? line('pw_start') : '<span class="fill"></span>') + ' (24 hour clock)<br>' + box(arm === '3' || v('pw_start') === 'NA') + ' Not applicable, patient is in no prewarming group')}
      ${row('Active warming stopped', line('ev_wstop'))}</table>
    <p class="fcap">Temperature every 5 minutes</p>
    <div class="scroll" tabindex="0"><table class="ftable grid5"><thead><tr><th>Time (min)</th>${pw.points.map(x => `<th>${x.min}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Time (00:00)</th>${pw.points.map(x => `<td>${esc(v('at_prewarm_' + x.key) || '')}</td>`).join('')}</tr>
      ${pw.cols.map(c => `<tr><th>${c.key === 'set' ? 'Set temp on gown*' : c.label}</th>${pw.points.map(x => cell('prewarm', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fsmall">*“NA” if patient is in control group OR active warming has been terminated. Thermal sensation: −3 cold … 0 neutral … +3 hot.</p>
    ${foot('prewarm')}</section>

  <section class="fpage" tabindex="0" aria-label="Intraoperative page">${head}
    <h3>INTRAOPERATIVE</h3>
    <h4>SURGERY DETAILS</h4>
    <table class="ftable kv">${row('Time that patient was flipped', line('io_flip'))}${row('Knife-to-skin start time (Induction)', line('io_knife'))}
      ${row('Start time of underbody Bair Hugger', line('io_under_start'))}${row('Start time of intraoperative gown Bair Hugger', line('io_gown_start'))}
      ${row('Surgery completion time (Post-extubation)', line('io_done'))}</table>
    <h4>ANAESTHESIA DETAILS</h4>
    <table class="ftable kv">${row('Anaesthesia technique', `${box(v('io_tech') === 'Inhalational')} GA (Inhalational)<br>${box(v('io_tech') === 'TIVA')} GA (TIVA)`)}
      ${row('Blood loss', line('io_ebl', 'ml'))}
      ${row('Transfusion', `<table class="ftable inner"><tr><th></th><th>RBC</th><th>Platelets</th><th>FFP</th><th>Cryo</th></tr>
        <tr><th>Units</th>${['rbc', 'plt', 'ffp', 'cryo'].map(k => `<td>${t('io_' + k)}</td>`).join('')}</tr>
        <tr><th>Volume (ml)</th>${['rbc', 'plt', 'ffp', 'cryo'].map(k => `<td>${t('io_' + k + '_ml')}</td>`).join('')}</tr></table>`)}
      ${row('Cell Saver', yn('io_cs') + ifYes('io_cs', `<br>Volume in cell saver: ${line('io_cs_vol', 'ml')}<br>Volume retransfused: ${line('io_cs_ret', 'ml')}`))}
      ${row('Prothrombin Complex Concentrate', yn('io_pcc') + ifYes('io_pcc', ` (dose: ${line('io_pcc_dose')})`))}
      ${row('Tranexamic Acid', yn('io_txa') + ifYes('io_txa', `<br>Bolus: ${line('io_txa_bolus', 'mg')}<br>Infusion: ${line('io_txa_inf', 'mg')}<br>Total: ${line('io_txa_total', 'mg')}`))}
      ${row('Fibrinogen', yn('io_fib') + ifYes('io_fib', ` (dose: ${line('io_fib_dose')})`))}</table>
    <p class="fcap">Intraoperative Investigations</p>
    <table class="ftable"><tr>${IX_COLS.map(([, l]) => `<th>${l}${l === 'Hb' ? '*' : ''}</th>`).join('')}</tr>
      ${(ix.length ? ix : [{}, {}]).map(r => `<tr>${IX_COLS.map(([k]) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</table>
    <p class="fsmall">*If only Hct is available, chart Hb as Hct/3</p>
    ${foot('intraop')}</section>

  <section class="fpage" tabindex="0" aria-label="Intraoperative readings page">${head}
    <h3>INTRAOPERATIVE READINGS</h3>
    <p class="fcap">Temperature every 5 minutes for the first 60 minutes, then every 15 minutes after</p>
    <div class="scroll" tabindex="0"><table class="ftable"><thead><tr><th>Time from induction</th>${it.cols.map(c => `<th>${c.label}${c.unit ? ' ' + c.unit : c.type === 'code' ? ' Y/N' : ''}</th>`).join('')}</tr></thead><tbody>
      ${it.points.map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End of Surgery (post extubation)' : x.min}</th>${it.cols.map(c => cell('iotemp', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fcap">Hemodynamics to be collected every 15 minutes</p>
    <div class="scroll" tabindex="0"><table class="ftable"><thead><tr><th>Time from induction</th>${hd.cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>
      ${hd.points.filter(x => x.key === 'base' || v('at_haemo_' + x.key)).map(x => `<tr><th>${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End of Surgery' : x.min}</th>${hd.cols.map(c => cell('haemo', x, c)).join('')}</tr>`).join('')}</tbody></table></div>
    ${foot('iotemp')}</section>

  <section class="fpage" tabindex="0" aria-label="PACU page">${head}
    <h3>POSTOPERATIVE (PACU)</h3>
    <h4>PACU DETAILS AND COMPLICATIONS</h4>
    <table class="ftable kv">${row('Time of PACU arrival', line('pacu_in'))}${row('Temperature on PACU arrival', line('pacu_temp', '°C'))}
      ${row('Shivering', yn('pacu_shiver'))}${row('Nausea and Vomiting', yn('pacu_ponv'))}
      ${row('Hypotension<br><small>(Systolic BP either &gt;20% below preoperative systolic BP or below 90 mmHg for &gt; 5 minutes)</small>', yn('pacu_hypot'))}
      ${row('Need for Transfusion in PACU', yn('pacu_tx'))}${row('Highest Pain Score<br><small>(Based on 11-point NRS score)</small>', line('pacu_pain'))}
      ${row('NuDESC Score', line('pacu_nudesc'))}${row('Time of Transfer from PACU to Ward', line('pacu_out'))}
      ${row('Delay in PACU Discharge', yn('pacu_delay') + ifYes('pacu_delay', `<br>If yes, is delay for more than 1 hour? ${yn('pacu_delay1h')}` + ifYes('pacu_delay1h', `<br>Reason: ${line('pacu_delay_why')}`)))}</table>
    <h4>PATIENT SATISFACTION FEEDBACK</h4>
    <table class="ftable kv">${row('Were you comfortable in the preoperative period?', comfort('sat_pre'))}${row('Were you comfortable in the postoperative period?', comfort('sat_post'))}</table>
    ${foot('pacu')}</section>
  </div>`);
  $('#print').onclick = () => window.print();
}
