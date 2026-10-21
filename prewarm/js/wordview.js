// The Form view's Word file: the study's blank paper form (uploaded by an admin) filled in for one patient, to
// download (.docx) or show and print (Save as PDF). JSZip and docx-preview load only when this is first used.
import { fillForm } from './wordform.js';
import { cleanProps } from './docx-fill.js';
import { newRecord } from './store.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let libs = null;
function script(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.append(s); });
}
export function loadLibs() {
  return libs ||= (async () => {
    // Carlito: the free font with Calibri's measurements (the form is set in Calibri), so lines break as in Word
    if (!document.querySelector('link[data-carlito]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.carlito = '';
      l.href = 'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap';
      document.head.append(l);
    }
    if (!window.JSZip) await script(new URL('./vendor/jszip.min.js', import.meta.url).href);
    if (!window.docx?.renderAsync) await script(new URL('./vendor/docx-preview.min.js', import.meta.url).href);
  })().catch(e => { libs = null; throw e; });
}
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

// the filled-in form as a .docx Blob
export async function filledDocx(b64, rec) {
  await loadLibs();
  const zip = await window.JSZip.loadAsync(fromB64(b64));
  const { xml } = fillForm(await zip.file('word/document.xml').async('string'), rec);
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'blob', mimeType: DOCX, compression: 'DEFLATE' });
}

// Check an uploaded blank form and make it ready to store: drops who made or edited it (file details), and lists the
// places this app's map didn't find (a different version of the form).
export async function prepareBlank(file) {
  await loadLibs();
  let zip;
  try { zip = await window.JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new Error('That isn’t a Word (.docx) file.'); }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('That isn’t a Word (.docx) file.');
  const xml = await doc.async('string');
  if (!/Subject ID:/.test(xml)) throw new Error('That doesn’t look like the data collection form (no “Subject ID:” boxes).');
  for (const name of ['docProps/core.xml', 'docProps/app.xml']) {
    const f = zip.file(name); if (f) zip.file(name, cleanProps(await f.async('string')));
  }
  const { missed } = fillForm(xml, newRecord(0));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { b64: toB64(bytes), size: bytes.length, missed };
}

// show a .docx Blob in el, pages scaled to fit the screen's width
export async function show(blob, el) {
  await loadLibs();
  el.innerHTML = '';
  await window.docx.renderAsync(blob, el, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true, renderHeaders: true, renderFooters: true });
  fit(el);
}
export function fit(el) {
  const page = el.querySelector('section.docx');
  if (!page) return;
  el.style.zoom = '';
  const z = Math.min(1, el.clientWidth / (page.offsetWidth + 16));
  el.style.zoom = String(z);
}
