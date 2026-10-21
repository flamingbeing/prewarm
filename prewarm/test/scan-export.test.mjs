// Run with: node prewarm/test/scan-export.test.mjs  (fake data only)
// Reviewed scan values go through the app's own export: right column, right type, NA kept, unknown ids reported.
import assert from 'node:assert/strict';
import { recordFrom, toValue } from '../tools/scan/export-scan.mjs';
import { workbookSheets } from '../js/export.js';
import { FIELDS, BY_ID } from '../js/schema.js';

const rec = recordFrom({ fields: { enrol_id: 'AB123', age: '67', sex: '1', pw_gown: '07:05', prewarm_5_core: '36.7', prewarm_0_set: 'NA', nonsense: '5', wt: '' } });
assert.deepEqual(rec.skipped, ['nonsense']);
const [data] = workbookSheets([rec], []);
const row = data.rows[2];
const at = id => row[BY_ID[id].colIndex];
assert.equal(at('enrol_id'), 'AB123');
assert.equal(at('age'), 67);
assert.equal(at('sex'), 1);
assert.equal(at('prewarm_5_core'), 36.7);
assert.equal(at('prewarm_0_set'), 'NA');
assert.equal(at('wt'), null);
assert.ok(at('pw_gown') && at('pw_gown').fmt === 'time', 'time becomes an Excel time');
assert.equal(row.length, FIELDS.length);
assert.equal(toValue({ type: 'num' }, ' 36.5 '), 36.5);
assert.equal(toValue({ type: 'text' }, ' x '), 'x');
console.log('scan-export: ok');
