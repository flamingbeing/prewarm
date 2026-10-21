// The paper data collection form (v3.2, .docx) filled in from a patient record: where each field goes on the form.
// The blank form itself is not in this repo (it carries staff names in its file details): an admin uploads it once and
// it is kept in the study's Firebase. docx-fill.js does the typing; this file says what goes where, in form order.
import { WordForm } from './docx-fill.js';
import { PAGES, EXTRA, SERIES, BY_ID, EXTRA_BY_ID, IX_COLS, shownValue } from './schema.js';
import { val } from './store.js';

const field = id => BY_ID[id] || EXTRA_BY_ID[id];
// the form's pages, in order, and the app pages whose fields are on each (for its "Date of Entry" and sign-off)
export const FORM_PAGES = [
  { pages: ['preop', 'meds', 'bloods'] },
  { pages: ['prewarm'], extra: ['at_prewarm_'], sign: ['prewarm'] },
  { pages: ['intraop'], extra: ['io_rbc_ml', 'io_plt_ml', 'io_ffp_ml', 'io_cryo_ml', 'io_ix_rows'], sign: ['intraop'] },
  { pages: ['iotemp', 'haemo'], extra: ['at_iotemp_', 'at_haemo_'], sign: ['iotemp', 'haemo'] },
  { pages: ['pacu'], extra: ['pacu_tx', 'nd_'], sign: ['pacu'] },
  { pages: ['pod1', 'pod1an', 'satis', 'pod2', 'pod2an'], sign: ['satis'] },
  { pages: ['dc'] },
];
const PAGE_IDS = FORM_PAGES.map(fp => {
  const ids = new Set(PAGES.filter(p => fp.pages.includes(p.id)).flatMap(p => p.fields.map(f => f.id)));
  return id => ids.has(id) || (fp.extra || []).some(x => x.endsWith('_') ? id.startsWith(x) : id === x);
});
const ddmmyy = t => { const d = new Date(t); return [d.getDate(), d.getMonth() + 1, d.getFullYear() % 100].map(n => String(n).padStart(2, '0')).join(''); };

// Fill document.xml for one patient. Returns { xml, missed } (missed: places the form didn't have, for tests).
export function fillForm(xml, rec) {
  const F = new WordForm(xml);
  // hidden follow-ups (their question answered No) are left blank, as on the export
  const v = id => { const x = shownValue(id, k => val(rec, k)); return x == null || x === '' ? null : x; };
  const lab = id => { const x = v(id); if (x == null) return null; const o = field(id)?.opts?.find(([k]) => String(k) === String(x)); return o ? o[1] : String(x); };
  const pick = (id, map) => { const x = v(id); return x == null ? null : map[x]; };
  const yn = (cell, id, opts) => cell.tick(lab(id), opts);

  // ---- PREOPERATIVE
  F.seek('PATIENT DEMOGRAPHICS');
  F.row('Age').line(v('age'));
  F.row('Gender').tick(lab('sex'));
  F.row('Weight').line(v('wt'));
  F.row('Height').line(v('ht'));
  F.row('Body Mass Index').line(v('bmi'));
  F.seek('MEDICAL HISTORY');
  F.row('ASA status').tick(lab('asa'));
  F.row('Smoker').tick(pick('smoker', { 0: 'Everyday', 1: 'Someday', 2: 'Former', 3: 'Never' }));
  let c = F.row('Hyperlipidaemia'); yn(c, 'hld'); yn(c, 'hld_statin', { in: 'statins' });
  c = F.row('Hypertension'); yn(c, 'htn');
  c.tick(pick('htn_med', { 1: 'Beta-blockers', 2: 'ACE inhibitors', 3: 'Diuretics', 4: 'Others' })).line(v('htn_med_other'), { in: 'Others' });
  c = F.row('Diabetes'); yn(c, 'dm'); c.tick(pick('dm_med', { 1: 'Insulin', 2: 'Oral hypoglycaemic', 3: 'Diuretics', 4: 'Others' }));
  c = F.row('Ischaemic Heart Disease'); yn(c, 'ihd'); yn(c, 'ihd_mi', { in: 'previous MI?' }); c.line(v('ihd_mi_years'), { in: 'how long ago' });
  c = F.row('Atrial Fibrillation'); yn(c, 'af'); c.tick(pick('af_type', { 1: 'Paroxysmal', 2: 'Persistent' }));
  c = F.row('Heart Failure'); yn(c, 'hf');
  c.tick(pick('hf_type', { 1: 'Left sided heart failure with reduced', 2: 'Left sided heart failure with preserved' }));
  c = F.row('Previous Percutaneous'); yn(c, 'pci'); c.line(v('pci_year'), { in: 'year' });
  c = F.row('Previous Cardiac Surgery'); yn(c, 'csurg'); c.line(v('csurg_year'), { in: 'year' }).line(v('csurg_proc'), { in: 'procedure' });
  F.seek('PREOPERATIVE MEDICATIONS');
  c = F.row('Aspirin'); yn(c, 'asp'); c.line(v('asp_dose'), { in: 'dosage' }); yn(c, 'asp_stopped', { in: 'stopped currently' }); c.line(v('asp_days'), { in: 'how many days' });
  c = F.row('Warfarin'); yn(c, 'warf'); yn(c, 'warf_bridge', { in: 'bridged' });
  yn(F.row('Low Molecular Weight Heparin'), 'lmwh');
  c = F.row('Other Antiplatelets'); yn(c, 'antiplt'); c.line(v('antiplt_name'), { in: 'specify' });
  c = F.row('Direct Thrombin Inhibitor'); yn(c, 'dti'); c.line(v('dti_name'), { in: 'specify' });
  F.seek('PREOPERATIVE INVESTIGATIONS');
  for (const [l, id] of [['Haemoglobin', 'pre_hb'], ['White Blood Cells', 'pre_wbc'], ['Platelets', 'pre_plt'], ['PT', 'pre_pt'], ['PTT', 'pre_aptt'],
    ['INR', 'pre_inr'], ['HbA1c', 'pre_hba1c'], ['Troponin I', 'pre_trop'], ['C-Reactive Protein', 'pre_crp']]) F.row(l).line(v(id));
  const ECG = { 0: 'Performed, normal', 1: 'Performed, abnormal', 2: 'Not performed' };
  F.row('ECG').tick(pick('pre_ecg', ECG));

  // ---- PREOPERATIVE (INTERVENTION)
  F.seek('RANDOMISATION');
  F.row('☐ 30-minute prewarming', 0).tick(pick('arm', { 1: '30-minute', 2: '10-minute', 3: 'No prewarming' }));
  F.row('Time that gown was put on').time(v('pw_gown'));
  c = F.row('Start time of active warming').time(v('pw_start'));
  if (String(v('arm')) === '3') c.tick('Not applicable');
  let g = F.table('Time (min)');
  const pw = SERIES.prewarm;
  for (const pt of pw.points) {
    const col = g.col(String(pt.min), 1);
    g.set('Time (00:00)', col, v(`at_prewarm_${pt.key}`));
    for (const [l, k] of [['Core', 'core'], ['Chest', 'chest'], ['Arm', 'arm'], ['Thigh', 'thigh'], ['Calf', 'calf'], ['Set temp', 'set'], ['Thermal', 'ts']]) {
      let x = v(`prewarm_${pt.key}_${k}`);
      if (k === 'ts' && x != null) x = +x > 0 ? '+' + x : +x < 0 ? '−' + Math.abs(x) : '0';
      g.set(l, col, x);
    }
  }

  // ---- INTRAOPERATIVE
  F.row('Time that patient was flipped').time(v('io_flip'));
  F.row('Knife-to-skin').time(v('io_knife'));
  F.row('Start time of underbody').time(v('io_under_start'));
  F.row('Start time of intraoperative gown').time(v('io_gown_start'));
  F.row('Surgery completion time').time(v('io_done'));
  F.row('Anaesthesia technique').tick(pick('io_tech', { Inhalational: 'GA (Inhalational)', TIVA: 'GA (TIVA)' }));
  F.row('Blood loss').line(v('io_ebl'));
  g = F.table('Units');
  for (const [l, k] of [['RBC', 'rbc'], ['Platelets', 'plt'], ['Fresh Frozen', 'ffp'], ['Cryo', 'cryo']]) {
    const col = g.col(l);
    g.set('Units', col, v('io_' + k)); g.set('Volume', col, v(`io_${k}_ml`));
  }
  c = F.row('Cell Saver'); yn(c, 'io_cs'); c.line(v('io_cs_vol'), { in: 'Volume in cell saver' }).line(v('io_cs_ret'), { in: 'retransfused' });
  c = F.row('Prothrombin Complex'); yn(c, 'io_pcc'); c.line(v('io_pcc_dose'), { in: 'dose' });
  c = F.row('Tranexamic Acid'); yn(c, 'io_txa');
  c.line(v('io_txa_bolus'), { in: 'Bolus' }).line(v('io_txa_inf'), { in: 'Infusion' }).line(v('io_txa_total'), { in: 'Total' });
  c = F.row('Fibrinogen'); yn(c, 'io_fib'); c.line(v('io_fib_dose'), { in: 'dose' });
  let ix = [];
  try { ix = JSON.parse(v('io_ix_rows') || '[]') || []; } catch { /* none */ }
  g = F.table('Time', { exact: true });
  if (ix.length) {
    g.grow(ix.length);
    ix.forEach((r, i) => IX_COLS.forEach(([k], j) => g.set(i + 1, j, r[k])));
  }

  // ---- INTRAOPERATIVE READINGS
  const rowLabel = pt => pt.key === 'base' ? 'Baseline' : pt.key === 'end' ? 'End of Surgery' : String(pt.min);
  g = F.table('Time from induction');
  const IO = [['Core', 'core'], ['Chest', 'chest'], ['Arm', 'arm'], ['Thigh', 'thigh'], ['Calf', 'calf'],
    ['Active Warming Underbody', 'under'], ['Active Warming Gown', 'gown'], ['Room', 'room']].map(([l, k]) => [g.col(l), k]);
  for (const pt of SERIES.iotemp.points) {
    for (const [col, k] of IO) {
      let x = v(`iotemp_${pt.key}_${k}`);
      if ((k === 'under' || k === 'gown') && x != null) x = String(x) === '1' ? 'Y' : 'N';
      if (x != null) g.set(rowLabel(pt), col, x);
    }
  }
  g = F.table('Time from induction');
  const HD = [['Systolic', 'sbp'], ['Diastolic', 'dbp'], ['Mean', 'map'], ['Heart Rate', 'hr'], ['BIS', 'bis']].map(([l, k]) => [g.col(l), k]);
  for (const pt of SERIES.haemo.points) {
    if (!HD.some(([, k]) => v(`haemo_${pt.key}_${k}`) != null)) continue;
    if (!g.rowOf(rowLabel(pt))) { F.missed.push('haemo row ' + rowLabel(pt)); continue; }
    for (const [col, k] of HD) g.set(rowLabel(pt), col, v(`haemo_${pt.key}_${k}`));
  }

  // "Vital Signs Data Collected": ticked once any BP / HR / BIS value is in
  if (Object.keys(rec.f).some(k => /^haemo_/.test(k) && v(k) != null)) F.tickParagraph('Vital Signs Data Collected');

  // ---- POSTOPERATIVE (PACU)
  F.row('Time of PACU arrival').time(v('pacu_in'));
  F.row('Temperature on PACU arrival').line(v('pacu_temp'));
  yn(F.row('Shivering'), 'pacu_shiver');
  yn(F.row('Nausea and Vomiting'), 'pacu_ponv');
  yn(F.row('Hypotension'), 'pacu_hypot');
  yn(F.row('Need for Transfusion in PACU'), 'pacu_tx');
  F.row('Highest Pain Score').line(v('pacu_pain'));
  F.row('NuDESC Score').line(v('pacu_nudesc'));
  F.row('Time of Transfer from PACU').time(v('pacu_out'));
  c = F.row('Delay in PACU Discharge'); yn(c, 'pacu_delay'); yn(c, 'pacu_delay1h', { in: 'more than 1 hour?' }); c.line(v('pacu_delay_why'));

  // ---- POSTOPERATIVE: day 1, satisfaction, day 2
  for (const d of ['d1', 'd2']) {
    F.seek(`POSTOPERATIVE DAY ${d[1]} CHART REVIEW`);
    for (const [l, id] of [['Blood Loss', 'drain'], ['Haemoglobin', 'hb'], ['White Blood Cells', 'wbc'], ['Platelets', 'plt'], ['PT', 'pt'],
      ['PTT', 'aptt'], ['Troponin I', 'trop'], ['C-Reactive Protein', 'crp']]) F.row(l).line(v(`${d}_${id}`));
    F.row('ECG').tick(pick(`${d}_ecg`, ECG));
    F.row('Highest Temperature').line(v(`${d}_tmax`));
    F.row('Highest Pain Score').line(v(`${d}_pain`));
    F.seek(`POSTOPERATIVE DAY ${d[1]} ANALGESIC`);
    for (const [l, k] of [['Paracetamol', 'pcm'], ['NSAIDs', 'nsaid'], ['COX-2', 'cox2'], ['Opioids', 'opioid'], ['Tramadol', 'tram']]) {
      c = F.row(l); yn(c, `${d}_${k}`); c.line(v(`${d}_${k}_dose`), { in: 'dose' });
    }
    if (d === 'd1') {
      F.seek('PATIENT SATISFACTION');
      F.row('Were you comfortable in the preoperative').tick(lab('sat_pre'));
      F.row('Were you comfortable in the postoperative').tick(lab('sat_post'));
    }
  }

  // ---- DISCHARGE
  F.seek('DISCHARGE');
  c = F.row('Hospital Acquired Infection'); yn(c, 'dc_hai');
  c.tick(pick('dc_hai_type', { 0: 'Surgical site', 1: 'Others' })).line(v('dc_hai_other'), { in: 'Others' });
  c = F.row('Major Adverse Cardiac Event');
  if (v('dc_mace') != null) {
    ['Myocardial Infarction', 'Stroke', 'Heart failure', 'Revascularisation', 'CABG'].forEach((l, i) => c.tick(+v('dc_mace') === i + 1 ? 'Yes' : 'No', { in: l }));
  }
  c = F.row('Atrial Fibrillation'); yn(c, 'dc_af');
  const afs = String(v('dc_af_spec') || '');
  if (/new/i.test(afs)) c.tick('New Onset'); else if (/exist/i.test(afs)) c.tick('Existing');
  yn(F.row('Acute Kidney Injury'), 'dc_aki');
  yn(F.row('Postoperative Delirium'), 'dc_delirium');
  c = F.row('Unplanned ICU Admission'); yn(c, 'dc_icu'); c.line(v('dc_icu_spec'), { in: 'indication' });
  c = F.row('Unplanned ICU Admission'); yn(c, 'dc_icu2'); c.line(v('dc_icu2_spec'));
  F.row('ICU Length of Stay').line(v('dc_icu_los'));
  F.row('Hospital Length of Stay').line(v('dc_los'));
  F.row('Hospitalization Costs').line(v('dc_cost'));

  // ---- every page: Subject ID; Date of Entry and the sign-off where the page has data
  F.at = -1;
  const heads = F.rows.filter(r => r.label === 'subject id:');
  const id = String(v('enrol_id') ?? '');
  const signs = F.signLines();
  heads.forEach((h, n) => {
    const boxes = h.cells.slice(1, 6);
    if (id.length <= boxes.length) [...id].forEach((ch, i) => F.cell(boxes[i], ch));
    else F.cell(F.merge(boxes), id);
    const fp = FORM_PAGES[n];
    if (!fp) return;
    const ts = Object.entries(rec.f).filter(([k, x]) => x?.v != null && x.v !== '' && x.t && PAGE_IDS[n](k)).map(([, x]) => x.t);
    if (ts.length) {
      const di = h.cells.findIndex(cl => F.cellLabel(cl) === 'date of entry:');
      [...ddmmyy(Math.min(...ts))].forEach((ch, i) => h.cells[di + 1 + i] && F.cell(h.cells[di + 1 + i], ch));
    }
    // the page's own sign-off, else "data collection complete" on the op-day pages that have data
    const s = (fp.sign || []).map(pg => v('sign_' + pg)).find(Boolean) || (fp.sign && ts.length ? v('done') : null);
    const line = signs.find(P => F.order(P.p) > F.order(h.tr) && (!heads[n + 1] || F.order(P.p) < F.order(heads[n + 1].tr)));
    if (s && line) F.sign(line, s);
  });
  return { xml: F.xml(), missed: F.missed };
}
