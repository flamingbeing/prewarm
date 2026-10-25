// Run with: node prewarm/test/stamp-versions.test.mjs
// The deploy stamp (tools/stamp-versions.mjs, app-update's): only exact-version core.anawj.com addresses count as
// pinned; any other address on another site (the design kit's /v1/) is fetched again after every deploy; the date is
// the app folder's last git change in Singapore time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stamp } from '../../tools/stamp-versions.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-stamp-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');
fs.writeFileSync(path.join(dir, 'app.js'), 'export {}');
const sw = `const VERSION = 'prewarm-v1';
const SHELL = ['./', 'app.js', 'https://design.anawj.com/v1/tokens.css', 'https://core.anawj.com/sync/0.4.0/index.js'];
const MANIFEST = {};
`;
const run = (now, gitDate) => { fs.writeFileSync(path.join(dir, 'sw.js'), sw); return stamp({ dir, now, gitDate }); };
const one = run(1000, '2026-10-24T17:30:00Z'), two = run(2000, '2026-10-24T17:30:00Z');
assert.equal(one.manifest['https://core.anawj.com/sync/0.4.0/index.js'], 'pinned', 'an exact version never changes');
assert.notEqual(one.manifest['https://design.anawj.com/v1/tokens.css'], two.manifest['https://design.anawj.com/v1/tokens.css'], 'a moving address: new every deploy');
assert.equal(one.manifest['app.js'], two.manifest['app.js'], 'an unchanged own file keeps its hash');
assert.match(one.version, /^prewarm-v1-2026-10-25-[0-9a-f]{8}$/, '17:30 UTC on the 24th is the 25th in Singapore');
assert.match(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), /const VERSION = 'prewarm-v1-2026-10-25-[0-9a-f]{8}';/);
// --check only reads
fs.writeFileSync(path.join(dir, 'sw.js'), sw);
stamp({ dir, write: false });
assert.equal(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), sw);
fs.rmSync(dir, { recursive: true });
console.log('prewarm stamp-versions: ok');
