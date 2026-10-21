// The eCRF as form pages. Fields are listed in template column order: field n is column n of the
// "Data Collection" sheet (A, B, … UZ), so the export lines up with HEADERS. test/schema.test.mjs checks the
// count and a few anchor columns.
//
// Field: { id, label, type, opts?, unit?, show?, na?, carry?, temp?, hint? }
//   type: code (tap a button, stores the template's number), text, num, int, date, time, word (tap a button,
//         stores the word)
//   show: { f: otherFieldId, in: [values] }: shown only then (or when it already has a value)
//   na: offers an "NA" button (stores the text NA, as the template asks)
//   carry: a series column that usually stays the same; "Same as before" copies it from the last timepoint
//   temp: a temperature; "365" is read as 36.5

import { HEADERS } from './headers.js';

const YN = [[0, 'No'], [1, 'Yes']];
const ECG = [[0, 'Normal'], [1, 'Abnormal'], [2, 'Not done']];
const PAIN = Array.from({ length: 11 }, (_, i) => [i, String(i)]);
const COMFORT = [[0, 'Comfortable'], [1, 'Somewhat comfortable'], [2, 'Neutral'], [3, 'Somewhat uncomfortable'], [4, 'Uncomfortable']];
// ASHRAE 7-point thermal sensation scale (the template doesn't say which scale)
const THERMAL = [[-3, '−3 Cold'], [-2, '−2 Cool'], [-1, '−1 Slightly cool'], [0, '0 Neutral'], [1, '+1 Slightly warm'], [2, '+2 Warm'], [3, '+3 Hot']];

const yn = (id, label, extra) => ({ id, label, type: 'code', opts: YN, ...extra });
const ifYes = f => ({ show: { f, in: [1] } });

function bloods(p) {
  return [
    { id: p + 'hb', label: 'Haemoglobin', type: 'num', unit: 'g/dL' },
    { id: p + 'wbc', label: 'White cells', type: 'num', unit: '×10⁹/L' },
    { id: p + 'plt', label: 'Platelets', type: 'num', unit: '×10⁹/L' },
    { id: p + 'pt', label: 'PT', type: 'num', unit: 's' },
    { id: p + 'aptt', label: 'APTT', type: 'num', unit: 's' },
  ];
}

function analgesia(p) {
  const out = [];
  for (const [k, name] of [['pcm', 'Paracetamol'], ['nsaid', 'NSAIDs'], ['cox2', 'COX-2 inhibitors'], ['opioid', 'Opioids (MME)'], ['tram', 'Tramadol']]) {
    out.push(yn(p + k, name), { id: p + k + '_dose', label: name + ' dose', type: 'text', ...ifYes(p + k) });
  }
  return out;
}

// Timepoints: key (used in field ids), label, minutes after the reference time (null: no fixed time)
const tp = (from, to, step) => { const a = []; for (let m = from; m <= to; m += step) a.push({ key: String(m), label: m + ' min', min: m }); return a; };
const BASELINE = { key: 'base', label: 'Baseline', min: null };
const END = { key: 'end', label: 'End of surgery', min: null };

const TEMPS = [['core', 'Core (spot on)'], ['chest', 'Chest'], ['arm', 'Arm'], ['thigh', 'Thigh'], ['calf', 'Calf']]
  .map(([k, l]) => ({ key: k, label: l, type: 'num', unit: '°C', temp: true }));

const SERIES = {
  prewarm: {
    ref: ['pw_start', 'pw_gown'], refLabel: 'start of active warming',
    points: tp(0, 40, 5),
    cols: [...TEMPS,
      { key: 'set', label: 'Set temp on gown', type: 'num', unit: '°C', na: true, carry: true },
      { key: 'ts', label: 'Thermal sensation', type: 'code', opts: THERMAL }],
  },
  iotemp: {
    ref: ['io_knife'], refLabel: 'induction',
    points: [BASELINE, ...tp(0, 60, 5), ...tp(75, 300, 15), END],
    cols: [...TEMPS,
      { key: 'under', label: 'Underbody warming', type: 'code', opts: YN, carry: true },
      { key: 'gown', label: 'Gown warming', type: 'code', opts: YN, carry: true },
      { key: 'room', label: 'Room temp', type: 'num', unit: '°C', carry: true }],
  },
  haemo: {
    ref: ['io_knife'], refLabel: 'induction',
    points: [BASELINE, ...tp(15, 300, 15), END],
    cols: [
      { key: 'sbp', label: 'Systolic BP', type: 'int', unit: 'mmHg' },
      { key: 'dbp', label: 'Diastolic BP', type: 'int', unit: 'mmHg' },
      { key: 'map', label: 'Mean BP', type: 'int', unit: 'mmHg' },
      { key: 'hr', label: 'Heart rate', type: 'int', unit: '/min' },
      { key: 'bis', label: 'BIS', type: 'int' }],
  },
};

const seriesFields = s => SERIES[s].points.flatMap(p => SERIES[s].cols.map(c => {
  const { key, ...rest } = c;
  return { ...rest, id: `${s}_${p.key}_${key}`, label: `${p.label}: ${c.label}`, series: s, point: p.key, col: key };
}));

// Pages, in column order. series pages show one timepoint at a time.
export const PAGES = [
  { id: 'preop', title: 'Pre-op', section: 0, fields: [
    { id: 'screen_id', label: 'Screening ID', type: 'text', hint: 'SBHx' },
    { id: 'enrol_id', label: 'Subject ID', type: 'text' }, // the paper form's Subject ID goes in the Enrollment ID column
    { id: 'enrol_date', label: 'Enrollment date', type: 'date' },
    { id: 'op_date', label: 'Surgery date', type: 'date' },
    { id: 'op_type', label: 'Surgery type', type: 'text', suggest: true },
    { id: 'age', label: 'Age', type: 'int', unit: 'years' },
    { id: 'sex', label: 'Gender', type: 'code', opts: [[0, 'Female'], [1, 'Male']] },
    { id: 'wt', label: 'Weight', type: 'num', unit: 'kg' },
    { id: 'ht', label: 'Height', type: 'num', unit: 'cm' },
    { id: 'bmi', label: 'BMI', type: 'num', unit: 'kg/m²', calc: 'bmi' },
    { id: 'asa', label: 'ASA', type: 'code', opts: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
    { id: 'smoker', label: 'Smoker', type: 'code', opts: [[0, 'Every day'], [1, 'Some days'], [2, 'Former'], [3, 'Never']] },
    yn('hld', 'Hyperlipidaemia'),
    yn('hld_statin', 'On statins?', ifYes('hld')),
    yn('htn', 'Hypertension'),
    { id: 'htn_med', label: 'Hypertension medication', type: 'code', opts: [[1, 'Beta blocker'], [2, 'ACEi / ARB'], [3, 'Diuretic'], [4, 'Others']], ...ifYes('htn') },
    { id: 'htn_med_other', label: 'Other medication, specify', type: 'text', show: { f: 'htn_med', in: [4] } },
    yn('dm', 'Diabetes'),
    { id: 'dm_med', label: 'Diabetes medication', type: 'code', opts: [[1, 'Insulin'], [2, 'Oral hypoglycaemic'], [3, 'Diuretic'], [4, 'Others']], ...ifYes('dm') },
    yn('ihd', 'Ischaemic heart disease'),
    // the template codes this one the other way round: 0 = yes
    { id: 'ihd_mi', label: 'Previous MI?', type: 'code', opts: [[0, 'Yes'], [1, 'No']], ...ifYes('ihd') },
    { id: 'ihd_mi_years', label: 'MI how long ago', type: 'num', unit: 'years', show: { f: 'ihd_mi', in: [0] } },
    yn('af', 'Atrial fibrillation'),
    { id: 'af_type', label: 'AF type', type: 'code', opts: [[1, 'Paroxysmal'], [2, 'Persistent']], ...ifYes('af') },
    yn('hf', 'Heart failure'),
    { id: 'hf_type', label: 'Heart failure type', type: 'code', opts: [[1, 'HFrEF'], [2, 'HFpEF']], ...ifYes('hf') },
    yn('pci', 'Previous PCI'),
    { id: 'pci_year', label: 'Year of last PCI', type: 'int', ...ifYes('pci') },
    yn('csurg', 'Previous cardiac surgery'),
    { id: 'csurg_year', label: 'Year of last cardiac surgery', type: 'int', ...ifYes('csurg') },
    { id: 'csurg_proc', label: 'Cardiac surgery procedure', type: 'text', ...ifYes('csurg') },
  ] },
  { id: 'meds', title: 'Pre-op medication', section: 1, fields: [
    yn('asp', 'Aspirin'),
    { id: 'asp_dose', label: 'Aspirin dose', type: 'text', suggest: true, ...ifYes('asp') },
    yn('asp_stopped', 'Aspirin stopped?', ifYes('asp')),
    { id: 'asp_days', label: 'Stopped for how many days', type: 'int', unit: 'days', show: { f: 'asp_stopped', in: [1] } },
    // reversed in the template: 0 = yes
    { id: 'warf', label: 'Warfarin', type: 'code', opts: [[0, 'Yes'], [1, 'No']] },
    yn('warf_bridge', 'Bridged with heparin (IV or LMWH)?', { show: { f: 'warf', in: [0] } }),
    { id: 'warf_dose', label: 'Dose', type: 'text', show: { f: 'warf', in: [0] } },
    yn('lmwh', 'Low molecular weight heparin'),
    yn('antiplt', 'Other antiplatelets'),
    { id: 'antiplt_name', label: 'Which antiplatelet', type: 'text', suggest: true, ...ifYes('antiplt') },
    yn('dti', 'Direct thrombin inhibitor'),
    { id: 'dti_name', label: 'Which thrombin inhibitor', type: 'text', suggest: true, ...ifYes('dti') },
  ] },
  { id: 'bloods', title: 'Pre-op investigations', section: 2, fields: [
    ...bloods('pre_'),
    { id: 'pre_inr', label: 'INR', type: 'num' },
    { id: 'pre_hba1c', label: 'HbA1c', type: 'num', unit: '%' },
    { id: 'pre_trop', label: 'Troponin I', type: 'num', unit: 'ng/L', hint: 'DCF is ng/mL; EPIC is ng/L' },
    { id: 'pre_crp', label: 'CRP', type: 'num', unit: 'mg/L', hint: 'DCF: mg/L; EPIC: ml/L (as written in the template)' },
    { id: 'pre_ecg', label: 'ECG', type: 'code', opts: ECG },
    { id: 'pre_dl', label: 'Downloaded', type: 'word', opts: ['Yes', 'No'] },
  ] },
  { id: 'prewarm', title: 'Pre-warming', section: 3, opday: true, signoff: true, fields: [
    { id: 'arm', label: 'Randomisation', type: 'code', opts: [[1, '30 min'], [2, '10 min'], [3, 'No pre-warming']] },
    { id: 'pw_gown', label: 'Gown put on', type: 'time' },
    { id: 'pw_start', label: 'Active warming started', type: 'time', na: true },
  ], series: 'prewarm' },
  { id: 'intraop', title: 'Intra-op', section: 4, opday: true, signoff: true, fields: [
    { id: 'io_flip', label: 'Patient flipped', type: 'time' },
    { id: 'io_knife', label: 'Induction', type: 'time' },
    { id: 'io_under_start', label: 'Underbody Bair Hugger started', type: 'time' },
    { id: 'io_gown_start', label: 'Intra-op gown Bair Hugger started', type: 'time' },
    { id: 'io_done', label: 'Surgery completed (post-extubation)', type: 'time' },
    { id: 'io_tech', label: 'Anaesthesia technique (GA)', type: 'word', opts: ['Inhalational', 'TIVA'] },
    { id: 'io_ebl', label: 'Blood loss', type: 'int', unit: 'mL' },
    { id: 'io_rbc', label: 'RBC', type: 'num', unit: 'units' },
    { id: 'io_plt', label: 'Platelets', type: 'num', unit: 'units' },
    { id: 'io_ffp', label: 'FFP', type: 'num', unit: 'units' },
    { id: 'io_cryo', label: 'Cryoprecipitate', type: 'num', unit: 'units' },
    yn('io_cs', 'Cell saver'),
    { id: 'io_cs_vol', label: 'Cell saver volume', type: 'int', unit: 'mL', ...ifYes('io_cs') },
    { id: 'io_cs_ret', label: 'Volume retransfused', type: 'int', unit: 'mL', ...ifYes('io_cs') },
    yn('io_pcc', 'Prothrombin complex concentrate'),
    { id: 'io_pcc_dose', label: 'PCC dose', type: 'text', ...ifYes('io_pcc') },
    yn('io_txa', 'Tranexamic acid'),
    { id: 'io_txa_bolus', label: 'TXA bolus', type: 'num', unit: 'mg', ...ifYes('io_txa') },
    { id: 'io_txa_inf', label: 'TXA infusion', type: 'num', unit: 'mg', ...ifYes('io_txa') },
    { id: 'io_txa_total', label: 'TXA total', type: 'num', unit: 'mg', calc: 'txa', ...ifYes('io_txa') },
    yn('io_fib', 'Fibrinogen'),
    { id: 'io_fib_dose', label: 'Fibrinogen dose', type: 'text', ...ifYes('io_fib') },
    { id: 'io_ix', label: 'Intra-op investigations', type: 'text', long: true },
  ] },
  { id: 'iotemp', title: 'Intra-op temperatures', section: 4, opday: true, signoff: true, fields: [], series: 'iotemp' },
  { id: 'haemo', title: 'Intra-op haemodynamics', section: 4, opday: true, signoff: true, fields: [], series: 'haemo' },
  { id: 'pacu', title: 'PACU', section: 5, opday: true, signoff: true, fields: [
    { id: 'pacu_in', label: 'PACU arrival', type: 'time' },
    { id: 'pacu_temp', label: 'Temperature on arrival', type: 'num', unit: '°C', temp: true },
    yn('pacu_shiver', 'Shivering'),
    yn('pacu_ponv', 'Nausea, vomiting'),
    yn('pacu_hypot', 'Hypotension', { hint: 'Systolic BP >20% below pre-op, or below 90 mmHg, for more than 5 min' }),
    { id: 'pacu_pain', label: 'Highest pain score (0–10 NRS)', type: 'code', opts: PAIN },
    { id: 'pacu_nudesc', label: 'NuDESC total', type: 'int', calc: 'nudesc', hint: 'Worked out from the five items; over 2 = positive' },
    { id: 'pacu_out', label: 'Transfer to ward', type: 'time' },
    yn('pacu_delay', 'Delay in PACU discharge'),
    yn('pacu_delay1h', 'Delay more than 1 hour?', ifYes('pacu_delay')),
    { id: 'pacu_delay_why', label: 'Why the delay', type: 'text', ...ifYes('pacu_delay1h') },
  ] },
  { id: 'pod1', title: 'POD1 chart review', section: 6, fields: [
    { id: 'd1_drain', label: 'Drain blood loss (24 h)', type: 'int', unit: 'mL' },
    ...bloods('d1_'),
    { id: 'd1_trop', label: 'Troponin I', type: 'num', unit: 'ng/L', hint: 'DCF is ng/mL; EPIC is ng/L' },
    { id: 'd1_crp', label: 'CRP', type: 'num', unit: 'mg/L' },
    { id: 'd1_ecg', label: 'ECG', type: 'code', opts: ECG },
    { id: 'd1_tmax', label: 'Highest temperature', type: 'num', unit: '°C', temp: true },
    { id: 'd1_pain', label: 'Highest pain score (24 h)', type: 'code', opts: PAIN },
  ] },
  { id: 'pod1an', title: 'POD1 analgesia (24 h)', section: 7, fields: analgesia('d1_') },
  { id: 'satis', title: 'Patient satisfaction', section: 8, opday: true, signoff: true, fields: [
    { id: 'sat_pre', label: 'Comfortable in the pre-operative period?', type: 'code', opts: COMFORT },
    { id: 'sat_post', label: 'Comfortable in the post-operative period?', type: 'code', opts: COMFORT },
  ] },
  { id: 'pod2', title: 'POD2 chart review', section: 9, fields: [
    { id: 'd2_drain', label: 'Drain blood loss (24 h)', type: 'int', unit: 'mL' },
    ...bloods('d2_'),
    { id: 'd2_trop', label: 'Troponin I', type: 'num', unit: 'ng/L', hint: 'DCF is ng/mL; EPIC is ng/L' },
    { id: 'd2_crp', label: 'CRP', type: 'num', unit: 'mg/L' },
    { id: 'd2_ecg', label: 'ECG', type: 'code', opts: ECG },
    { id: 'd2_dl', label: 'Downloaded', type: 'word', opts: ['Yes', 'No'] },
    { id: 'd2_tmax', label: 'Highest temperature', type: 'num', unit: '°C', temp: true },
    { id: 'd2_pain', label: 'Highest pain score', type: 'code', opts: PAIN },
  ] },
  { id: 'pod2an', title: 'POD2 analgesia (24 h)', section: 10, fields: analgesia('d2_') },
  { id: 'dc', title: 'Discharge', section: 11, fields: [
    yn('dc_hai', 'Hospital-acquired infection'),
    { id: 'dc_hai_type', label: 'Type of infection', type: 'code', opts: [[0, 'Surgical site'], [1, 'Others']], ...ifYes('dc_hai') },
    { id: 'dc_hai_other', label: 'Other infection, specify', type: 'text', show: { f: 'dc_hai_type', in: [1] } },
    { id: 'dc_mace', label: 'Major adverse cardiac event', type: 'code', opts: [[0, 'No'], [1, 'Myocardial infarction'], [2, 'Stroke'], [3, 'Heart failure'], [4, 'Revascularisation incl. PCI'], [5, 'CABG']] },
    yn('dc_af', 'Atrial fibrillation'),
    { id: 'dc_af_spec', label: 'AF, specify', type: 'word', opts: ['New onset', 'Existing'], ...ifYes('dc_af') },
    yn('dc_aki', 'Acute kidney injury'),
    yn('dc_delirium', 'Post-operative delirium'),
    yn('dc_icu', 'Unplanned ICU admission'),
    { id: 'dc_icu_spec', label: 'ICU admission, specify', type: 'text', ...ifYes('dc_icu') },
    // the template has this question twice (columns UT and UV); both are kept so the columns line up
    yn('dc_icu2', 'Unplanned ICU admission (second column)'),
    { id: 'dc_icu2_spec', label: 'Specify', type: 'text', ...ifYes('dc_icu2') },
    { id: 'dc_icu_los', label: 'ICU length of stay', type: 'num', unit: 'days' },
    { id: 'dc_los', label: 'Hospital length of stay', type: 'num', unit: 'days' },
    { id: 'dc_cost', label: 'Hospitalisation costs before subsidies', type: 'num', unit: '$' },
  ] },
];

for (const p of PAGES) if (p.series) p.fields = [...p.fields, ...seriesFields(p.series)];

// minutes of active warming by group (1 = 30 min, 2 = 10 min); group 3 has none
export const WARM_MIN = { 1: 30, 2: 10 };
export { SERIES };

// All fields in column order; field i goes to column i + 1
export const FIELDS = PAGES.flatMap(p => p.fields.map(f => ({ ...f, page: p.id })));
export const BY_ID = Object.fromEntries(FIELDS.map((f, i) => [f.id, { ...f, colIndex: i }]));

// Study hospitals (owner, 12 Oct 2026). Each phone picks its hospital in Settings; new patients take it.
export const SITES = ['NTF', 'NUH', 'SGH', 'CGH', 'TTSH', 'KTPH', 'WH'];

// Op-day items the template has no column for: exported on the "Extra" sheet
const NUDESC = [[0, '0'], [1, '1'], [2, '2']];
export const EXTRA = [
  { id: 'site', label: 'Hospital', type: 'word', opts: SITES },
  { id: 'ev_wstop', label: 'Active warming stopped', type: 'time' },
  { id: 'ev_ot', label: 'Arrived in OT', type: 'time' },
  ...[['rbc', 'RBC'], ['plt', 'Platelets'], ['ffp', 'FFP'], ['cryo', 'Cryoprecipitate']].map(([k, l]) => ({ id: `io_${k}_ml`, label: l + ' volume', type: 'int', unit: 'mL' })),
  { id: 'io_ix_rows', label: 'Intra-op investigations', type: 'rows' },
  // free text for anything off-protocol (14 Oct 2026): a reading missed and why, monitor fault, warming stopped early
  { id: 'io_dev', label: 'Anything unusual or off-protocol (missed reading and why, equipment fault)', type: 'text', long: true },
  // consent (owner, 21 Oct 2026): first on Pre-op; a declined patient looks different on the home list
  { id: 'consent_st', label: 'Consent', type: 'code', opts: [[1, 'Patient consented, duplicate form given to patient'], [0, 'Declined to participate']] },
  yn('pacu_tx', 'Need for transfusion in PACU'),
  { id: 'done', label: 'Data collection complete (initials, date, time)', type: 'text' },
  ...[['dis', 'Disorientation'], ['beh', 'Inappropriate behaviour'], ['com', 'Inappropriate communication'], ['ill', 'Illusions / hallucinations'], ['psy', 'Psychomotor retardation']]
    .map(([k, l]) => ({ id: 'nd_' + k, label: l, type: 'code', opts: NUDESC })),
];
// Intra-op investigation table columns (paper form)
export const IX_COLS = [['time', 'Time'], ['hb', 'Hb'], ['test', 'ROTEM / TEG'], ['ct', 'CT or R'], ['cft', 'CFT or K'], ['alpha', 'Alpha'], ['a10', 'A10'], ['mcf', 'MCF or MA'], ['ml', 'ML or LY30']];
export const EXTRA_BY_ID = Object.fromEntries(EXTRA.map(f => [f.id, f]));

export function colLetter(i) { // 0-based
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}
export function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export const COLUMN_COUNT = HEADERS.length;

// Screening log (second sheet). Initials stay on this phone: never put in shared files.
export const SCREENING = [
  { id: 'id', label: 'Screening ID', type: 'text', hint: 'SBHx' },
  { id: 'initials', label: 'Initials', type: 'text', local: true },
  { id: 'date', label: 'Screening date', type: 'date' },
  { id: 'age', label: 'Age when approached', type: 'int', unit: 'years' },
  { id: 'eligible', label: 'Eligible?', type: 'word', opts: ['Yes', 'No'] },
  { id: 'fail', label: 'Reason for screen failure', type: 'text', suggest: true, show: { f: 'eligible', in: ['No'] } },
  { id: 'consent', label: 'Consent date', type: 'date' },
  { id: 'enrol', label: 'Enrollment ID', type: 'text' },
];

// Values worked out from other fields; offered when the field is empty
export function calc(kind, get) {
  const n = id => { const v = parseFloat(get(id)); return Number.isFinite(v) ? v : null; };
  if (kind === 'bmi') {
    const w = n('wt'); let h = n('ht');
    if (!w || !h) return null;
    if (h > 3) h /= 100; // cm
    return Math.round(w / (h * h) * 10) / 10;
  }
  if (kind === 'txa') {
    const b = n('io_txa_bolus'), i = n('io_txa_inf');
    return b == null && i == null ? null : (b || 0) + (i || 0);
  }
  if (kind === 'nudesc') {
    const v = ['dis', 'beh', 'com', 'ill', 'psy'].map(k => n('nd_' + k));
    return v.every(x => x == null) ? null : v.reduce((a, b) => a + (b || 0), 0);
  }
  if (kind === 'map') { // series: sbp and dbp ids passed through get
    const s = n('sbp'), d = n('dbp');
    return s && d ? Math.round((s + 2 * d) / 3) : null;
  }
  return null;
}

// "365" → 36.5, "36,5" → 36.5 for temperatures
export function normaliseTemp(s) {
  const t = String(s).trim().replace(',', '.');
  if (/^\d{3}$/.test(t)) { const n = Number(t) / 10; if (n >= 25 && n <= 45) return String(n); }
  return t;
}

// shown when its question's answer matches, and that question is itself shown (so a follow-up of a follow-up hides
// when the first answer goes back to No)
export function isShown(f, get, depth = 0) {
  if (!f.show) return true;
  const v = get(f.show.f);
  if (!f.show.in.some(x => String(x) === String(v))) return false;
  const parent = BY_ID[f.show.f] || EXTRA_BY_ID[f.show.f];
  return !parent || depth > 5 || isShown(parent, get, depth + 1);
}
// the value as it should be exported: a hidden follow-up's old answer is left out (it stays stored, so switching
// the answer back brings it back)
export function shownValue(id, get) {
  const f = BY_ID[id] || EXTRA_BY_ID[id];
  if (f && !isShown(f, get)) return null;
  // no pre-warming group (e.g. corrected to it later): its pre-warming readings and warming times aren't the study's
  if (String(get('arm')) === '3' && (/^prewarm_/.test(id) || id === 'pw_start' || id === 'ev_wstop')) return null;
  return get(id);
}

// What the PACU nurse's link may write (owner, 13 Oct 2026): the PACU page's fields and its complete tick. The same list
// is the allow-list in firestore.rules (pacu/{token}); the unit test keeps the two in step.
export const PACU_KEYS = ['pacu_in', 'pacu_out', 'pacu_temp', 'pacu_shiver', 'pacu_ponv', 'pacu_hypot', 'pacu_tx', 'pacu_pain',
  'nd_dis', 'nd_beh', 'nd_com', 'nd_ill', 'nd_psy', 'pacu_nudesc', 'pacu_delay', 'pacu_delay1h', 'pacu_delay_why', 'sat_post', 'sign_pacu'];
