// The Form view's Word file: filling the paper form's structures (made-up fixture; the real form isn't in the repo).
// node prewarm/test/wordform.test.mjs
import assert from 'node:assert/strict';
import { WordForm, parseXml, serialize, cleanProps } from '../js/docx-fill.js';
import { fillForm } from '../js/wordform.js';
import { fixtureXml, fixtureFiles } from './fixture-form.mjs';

const xml = fixtureXml();
// untouched, the file comes back byte for byte
assert.equal(serialize(parseXml(xml)), xml);
assert.equal(new WordForm(xml).xml(), xml);

const t = Date.UTC(2026, 9, 12, 2);
const f = {};
const put = (k, v) => { f[k] = { v, t, by: 'TT' }; };
Object.entries({ enrol_id: 'AB123', age: 67, sex: 1, hld: 1, hld_statin: 0, arm: 2, pw_gown: '7:05',
  prewarm_0_core: '36.6', prewarm_5_core: '36.7', prewarm_5_chest: '34.1', at_prewarm_0: '07:10', sign_prewarm: 'TT 12 Oct 2026 08:00' }).forEach(([k, v]) => put(k, v));
const { xml: out, missed } = fillForm(xml, { id: 'x', created: t, f });
const text = out.replace(/<[^>]+>/g, '');

assert.match(text, / 67 _? *years old/, 'age typed over the blank line');
assert.doesNotMatch(text, /_________/, 'the age blank is gone');
assert.match(text, /☒Male/, 'Male ticked');
assert.match(text, /☐ Female/);
assert.equal((out.match(/w14:checked w14:val="1"/g) || []).length, 4, 'Male, hyperlipidaemia Yes, statins No, 10-minute group');
assert.match(text, /statins\?\s+☐ Yes\s+☒ No/, 'statins No, in its own line');
assert.match(text, /☐ 30-minute prewarming\s+☒ 10-minute prewarming/);
assert.match(text, /07  :  05  \(24 hour clock\)/, 'time over __ __ : __ __');
assert.match(text, /36\.6/); assert.match(text, /34\.1/); assert.match(text, /07:10/);
// typed cells keep the font size but not the placeholder grey
assert.match(out, /<w:r><w:rPr><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">36\.6<\/w:t><\/w:r>/);
// Subject ID one character per box on every page; Date of Entry only on pages with data
assert.equal((text.match(/Subject ID:AB123/g) || []).length, 2, 'Subject ID on both pages');
assert.equal((text.match(/Date of Entry:121026/g) || []).length, 2, 'both made-up pages have data');
// sign-off on the pre-warming page only
assert.match(text, /Name: TT .*Date: 12 Oct 2026$/m);
assert.equal((text.match(/Name: TT/g) || []).length, 1);
assert.ok(missed.length > 0, 'the fixture is only part of the form');

// "data collection complete" signs the op-day pages with data that have no sign-off of their own
const done = fillForm(xml, { id: 'd', created: t, f: { ...f, sign_prewarm: undefined, done: { v: 'CD 13 Oct 2026 09:00', t } } }).xml.replace(/<[^>]+>/g, '');
assert.match(done, /Name: CD .*Date: 13 Oct 2026$/m);
assert.doesNotMatch(done.split('PREOPERATIVE')[1].split('Subject ID')[0], /Name: CD/, 'not on the pre-op page');

// "Vital Signs Data Collected" ticks itself once any BP / HR / BIS value is in
const vit = fillForm(xml, { id: 'v', created: t, f: { haemo_base_sbp: { v: '120', t } } }).xml.replace(/<[^>]+>/g, '');
assert.match(vit, /☒ Vital Signs Data Collected/);
assert.match(text, /☐ Vital Signs Data Collected/, 'not ticked without vitals');

// a long Subject ID: the five boxes become one
const long = fillForm(xml, { id: 'y', created: t, f: { enrol_id: { v: 'NTF-0012', t } } }).xml;
assert.match(long, /<w:gridSpan w:val="5"\/>/);
assert.match(long.replace(/<[^>]+>/g, ''), /Subject ID:NTF-0012/);
assert.doesNotThrow(() => parseXml(long));

// nothing entered: the form stays blank (apart from nothing at all)
const empty = fillForm(xml, { id: 'z', created: t, f: {} }).xml;
assert.equal(empty, xml);

// file details: who made and edited the form are removed
const core = cleanProps(fixtureFiles()['docProps/core.xml']);
assert.doesNotMatch(core, /Test Author|Test Editor/);
assert.match(core, /<dc:creator><\/dc:creator>/);
assert.equal(cleanProps('<Properties><Company>Some Uni</Company><Pages>3</Pages></Properties>'), '<Properties><Company></Company><Pages>3</Pages></Properties>');

console.log('prewarm wordform: ok');
