// Writes the made-up fixture form (test/fixture-form.mjs) as a .docx, for the scan tool's tests: node make-template.mjs out.docx
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fixtureFiles } from '../../test/fixture-form.mjs';
const JSZip = createRequire(import.meta.url)('../../js/vendor/jszip.min.js');
const zip = new JSZip();
for (const [k, v] of Object.entries(fixtureFiles())) zip.file(k, v);
writeFileSync(process.argv[2], await zip.generateAsync({ type: 'nodebuffer' }));
