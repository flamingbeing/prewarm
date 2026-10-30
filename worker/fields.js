// The fields the Worker will read (worker/read.js): id -> { type, label, unit, opts }. Only num and time cells are ever sent
// to the reading model; any other id (IDs, dates, names, free text) is refused. GENERATED from the form map by the scan
// build step; the entries below are MADE-UP samples until the real list is generated. Do not hand-edit once generated.
export const FIELDS = {
  'p1.sample_temp': { type: 'num', label: 'Sample temperature', unit: '°C', opts: null },
  'p1.sample_rate': { type: 'num', label: 'Sample rate', unit: 'per min', opts: null },
  'p1.sample_start': { type: 'time', label: 'Sample start time', unit: '', opts: null },
  'p2.sample_stage': { type: 'num', label: 'Sample stage', unit: '', opts: [['1', 'one'], ['2', 'two'], ['3', 'three']] },
  // not readable by the model (kept here so the refusal is by type, not by a missing id)
  'p1.sample_id': { type: 'id', label: 'Sample ID', unit: '', opts: null },
  'p1.sample_date': { type: 'date', label: 'Sample date', unit: '', opts: null },
  'p2.sample_note': { type: 'text', label: 'Sample note', unit: '', opts: null },
};
