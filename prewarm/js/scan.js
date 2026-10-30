// Scan pages (owner, 20 Oct 2026): scanner-style capture of the paper form's pages. Photo, then crop (four corners, magnifier),
// flatten to a portrait page, take out shadows, set the contrast, accept, next page. Everything runs on the phone in plain canvas
// code (js/scan-geom.js). Pages are kept on this phone (IndexedDB), the original photo beside the tidied copy. Each page is sent
// as soon as it is ready (a queue that retries and waits out no signal; pages marked Check wait for a look) through the Worker's
// /scan-api/ (behind Cloudflare Access; worker/scan.js) to the study computer, only on prewarmstudy.anawj.com, with the Subject
// ID. Its status route says per page: received, read (values, flags), retake (why), approved; a page the study computer
// matched to another page number moves to that slot. Nothing here touches patient records or sync.
import { MAX_EDGE, PAGE_W, PAGE_H, fitSize, autoLevels, guessCorners, isConvex, rotateCorners, flattenPage, setContrast, coachFor, quadMove, photoCheck, edgeInfo, snapCorner, snapSide, uprightScore, rotate180 } from './scan-geom.js';
export { MAX_EDGE, fitSize, autoLevels };
export const PAGE_LABELS = Array.from({ length: 14 }, (_, i) => String(i + 1));
const SRC_EDGE = 3200; // the photo is kept at up to this long edge for the flattening (a page fills most of it)
const STEADY = 7, GIVE_UP = 20000; // live camera: frames (about 120 ms apart) held still before the auto photo; auto stops after 20 s

// per-phone choices (this phone only, not synced): the phone's own camera app instead of the live camera, auto photo on or off
const pref = (k, d) => { try { const v = localStorage.getItem('prewarm-scan-' + k); return v === null ? d : v === '1'; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('prewarm-scan-' + k, v ? '1' : '0'); } catch { /* private window: this visit only */ } };
const prefStr = (k, d) => { try { return localStorage.getItem('prewarm-scan-' + k) || d; } catch { return d; } };
const setPrefStr = (k, v) => { try { localStorage.setItem('prewarm-scan-' + k, v); } catch { /* this visit only */ } };

// the page number to offer next: the first free number after the one just saved, else the first free one; none free: the last
export function nextLabel(taken, after = '') {
  const free = PAGE_LABELS.filter(l => !taken.includes(l)), a = Number(after) || 0;
  return free.find(l => Number(l) > a) || free[0] || PAGE_LABELS[PAGE_LABELS.length - 1];
}

// several pages in a row (owner, 20 Oct 2026): the page numbers a burst covers, in order ("3 to 7"); each shot takes the next
export function burstLabels(from, to) {
  const a = Math.max(1, Math.min(14, Number(from) || 1)), b = Math.max(a, Math.min(14, Number(to) || 14));
  return PAGE_LABELS.slice(a - 1, b);
}
// why a page in the grid wants a look (kept on the page as `needs` until it is checked, adjusted or retaken)
export const NEEDS = { blurry: 'Looks blurry: retake it, or keep it if the writing reads.', dark: 'Looks dark: retake it with more light.', corners: 'The page edges were a guess: check the corners.' };

// ---------- pages kept on this phone
const DB = 'prewarm-scan';
const open = () => new Promise((ok, no) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { const s = r.result.createObjectStore('pages', { keyPath: 'id' }); s.createIndex('subject', 'subject'); };
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
const tx = async (mode, f) => { const db = await open(); return new Promise((ok, no) => { const t = db.transaction('pages', mode); const out = f(t.objectStore('pages')); t.oncomplete = () => { db.close(); ok(out.result); }; t.onerror = () => no(t.error); t.onabort = () => no(t.error); }); };
export const listPages = subject => tx('readonly', s => s.index('subject').getAll(subject)).then(a => a.sort((x, y) => x.at - y.at));
const allPages = () => tx('readonly', s => s.getAll());
const getPage = id => tx('readonly', s => s.get(id));
export const putPage = p => tx('readwrite', s => s.put(p));
export const delPage = id => tx('readwrite', s => s.delete(id));

// the tidied copy of one form page on this phone, for Scan imports' crops (scan id first; a subject's page as a fallback)
export async function pagePhoto(scan, subject, page) {
  const all = await allPages().catch(() => []), want = String(page);
  const p = all.find(q => q.scan && q.scan === scan && q.label === want) || (subject ? all.find(q => q.subject === subject && q.label === want) : null);
  return p?.clean || null;
}

// uploading works only on the real address (Access and the Worker's /scan-api/ are there), not in demo mode or on previews
// (the browser tests try it on localhost with ?scantest)
export const CAN_SEND = typeof location !== 'undefined' && (location.hostname === 'prewarmstudy.anawj.com' && !/[?&]demo\b/.test(location.search)
  || location.hostname === 'localhost' && /[?&]scantest\b/.test(location.search));
const API = '/scan-api/';
// the browser tests stand in for Firestore on localhost (?scantest): window.__scanCloud { scanForm, addScanImport }
const testCloud = () => typeof location !== 'undefined' && location.hostname === 'localhost' && /[?&]scantest\b/.test(location.search) && window.__scanCloud || null;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$/; // the Subject IDs the Worker takes (sent with each page)
const signedIn = async () => {
  try { const r = await fetch(API + 'whoami', { redirect: 'manual', cache: 'no-store' }); return r.ok && (await r.json()).email; } catch { return null; } // null: no signal
};
// a page's place on the way: on the phone, sending, not sent (failed), then the study computer's word on it
export const STATES = { phone: 'On phone', sending: 'Sending…', failed: 'Not sent', received: 'Sent', reading: 'Reading…', read: 'Read', retake: 'Retake', approved: 'Approved', rejected: 'Rejected' };
const DONE = new Set(['approved', 'rejected']);
export const KEEP_DAYS = 7; // pages approved (or rejected) this long ago are cleared from the phone by themselves
const RETRY = [15, 60, 300]; // seconds before a failed send is tried again (then every 5 minutes)
export function stateOf(p, sending, failed) {
  if (!p.sentAt) return sending?.has(p.id) ? 'sending' : failed?.has(p.id) ? 'failed' : 'phone';
  return STATES[p.server?.state] ? p.server.state : 'received';
}
// the study computer's status of a scan onto this phone's pages: which change, and which move to the page the study computer
// matched them to (only into a free slot, and once: a person's own relabel after that stands)
export function applyStatus(pages, st, now = Date.now()) {
  const changed = [], moved = [];
  for (const p of pages) {
    const e = p.scan === st.scan && p.sentAt ? st.page?.[p.sentAs || p.label] : null;
    if (!e || JSON.stringify(e) === JSON.stringify(p.server)) continue;
    p.server = e; if (DONE.has(e.state) && !p.doneAt) p.doneAt = now;
    const to = e.page != null ? String(e.page) : '';
    if (to && to !== p.label && e.state !== 'retake' && !p.from && PAGE_LABELS.includes(to) && !pages.some(q => q !== p && q.subject === p.subject && q.label === to)) {
      moved.push([p.label, to]); p.from = p.label; p.label = to;
    }
    changed.push(p);
  }
  return { changed, moved };
}

const fileName = (p, orig) => `${p.subject.replace(/[^\w-]+/g, '_')}-page-${p.label || 'x'}${orig ? '-original' : ''}.jpg`;

// ---------- screen
const MODES = [['auto', 'Auto'], ['bw', 'Black and white'], ['color', 'Colour']];
const tick = () => new Promise(r => setTimeout(r, 30)); // let the screen repaint between the heavy steps

// deps: { view, esc, toast, subjects: () => [Subject IDs on this phone] }
export function mount({ view, esc, toast, subjects, cloud }) {
  let subject = '', sel = null, urls = [], num = '1', ed = null, queue = [], saving = Promise.resolve(), auth = null, pumping = false, again = false, retryT = 0, pollT = 0, gone = false, phoneBusy = false;
  let run = null, one = null; // run: a burst under way { labels, i }; one: the next shot is just this page { label } (a slot, Retake)
  const failed = new Map(); // page id -> why it was not sent (until the next try)
  const sending = new Set(), tries = new Map(), scans = new Map(); // pages going now; failed tries per page; subject -> scan id
  const tidying = new Set(); // page numbers being tidied beside the camera (a burst)
  const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const free = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
  const opts = PAGE_LABELS.map(l => `<option>${l}</option>`).join('');
  view.innerHTML = `<div class="stack scan">
    <p class="muted small">Lay the sheet on a darker surface and hold the phone over it, whole page in view: the camera takes the photo by itself once the page is found and still. The page is flattened, turned upright and the shadows taken out; a page that needs a look is marked Check in the grid. Pages stay on this phone; the original photo is kept beside the tidied copy.</p>
    <label class="lab" for="scsub">Subject ID</label>
    <input id="scsub" list="scsubs" autocomplete="off" autocapitalize="characters" placeholder="e.g. DEMO-01"><datalist id="scsubs">${subjects().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div id="scsign" class="note scsign" hidden><p>Sign in once before taking photos, so each page goes to the study computer as soon as it is ready.</p>
      <div class="row"><a class="primary" id="scsignlink" href="${API}whoami" target="_blank" rel="noopener">Sign in</a><button class="secondary" id="scsignchk">I have signed in</button></div><p id="scsignmsg" class="small" role="status"></p></div>
    <div id="scact" hidden>
      <label class="tog"><input type="checkbox" id="scburst"><span>Several pages in a row<small>Shoot the pages back to back with no check in between; each is tidied by itself. Look at the ones marked Check after.</small></span></label>
      <div id="scrange" class="scrange"><label for="scfrom">Pages</label><select id="scfrom" aria-label="First page">${opts}</select><span>to</span><select id="scto" aria-label="Last page">${opts}</select></div>
      <div id="scone"><label class="lab" for="scnum">Page number <small class="muted">(moves on by itself; change it to skip a page)</small></label>
      <select id="scnum" aria-label="Page number"></select></div>
      <p id="scrangenote" class="muted small" hidden></p>
      <label class="primary filebtn scbig" id="scshotlbl"><span id="scshottxt">📷 Take page 1</span><input id="scshot" type="file" accept="image/*" capture="environment" hidden></label>
      <button class="secondary" id="scstop" hidden>Stop the burst here</button>
      <label class="secondary filebtn">Choose from photos<input id="scpick" type="file" accept="image/*" multiple hidden></label>
      <label class="tog"><input type="checkbox" id="sccamapp"><span>Use phone camera app<small>Instead of the live camera here, on this phone only. For a phone where the live camera is poor.</small></span></label>
      <label class="tog" id="scphonelbl" hidden><input type="checkbox" id="scphoneon"><span>Read on phone<small>Also read the pages here and add the values to Scan imports, beside the study computer's reading. On this phone only; trial.</small></span></label>
      <label class="tog" id="scautosendlbl" hidden><input type="checkbox" id="scautosend"><span>Send each page when it is ready<small>To the study computer, in the background; with no signal they wait and go later. Pages marked Check wait for a look.</small></span></label>
    </div>
    <p id="scburstmsg" class="small scburstmsg" role="status" hidden></p>
    <div id="scselbar" class="scselbar" hidden><strong id="scselcount" role="status"></strong><button class="secondary" id="scselall">All</button><button class="secondary" id="scselnone">None</button><button class="secondary scseldel" id="scseldel">Delete</button><button class="secondary" id="scselcancel">Cancel</button></div>
    <p id="scprog" class="small" hidden></p>
    <div id="sclist" class="scgrid"></div>
    <div id="scsend" hidden><button class="primary" id="scup">Send to the study computer</button><button class="secondary" id="scphone" hidden>Read on phone</button><p id="scmsg" class="muted small" role="status"></p></div>
    <div id="scclear" class="ok-box scclear" hidden><p id="scclearmsg"></p><button class="secondary" id="scclearbtn">Clear these pages from this phone</button></div>
    <div id="scsave" hidden><button class="secondary" id="scdl">Save tidied pages to this phone</button></div>
    <dialog id="scdlg" class="scdlg"><img alt="Scanned page" id="scimg"><p id="scdlgwhy" class="scdlgwhy" hidden></p>
      <div class="row"><button class="secondary" id="scorig">Show original</button><button class="secondary" id="scadjust">Adjust corners</button><button class="primary" id="scdlgok" hidden>Looks right</button></div>
      <div class="row"><button class="secondary" id="scretake">Retake</button><label class="secondary filebtn">Choose from gallery<input id="scgallery" type="file" accept="image/*" hidden></label><button class="secondary scseldel" id="scdel">Delete</button></div>
      <div class="row"><select id="scdlgnum" aria-label="Page number for this photo"></select><button class="primary" id="scclose">Close</button></div>
    </dialog>
    <div id="sclive" class="scedit sclive" hidden role="dialog" aria-label="Live camera">
      <div class="schead"><strong id="sclivetitle">Page</strong><span id="sclivesize" class="small"></span></div>
      <div id="sclivestage" class="scstage"><div id="sclivebox" class="sclivebox"><video id="scvideo" playsinline muted autoplay></video><canvas id="scover" aria-hidden="true"></canvas></div></div>
      <p id="sccoach" class="sccoach" role="status" aria-live="polite">Opening the camera…</p>
      <div id="sclivefail" class="sclivefail" hidden><p id="sclivewhy"></p><button class="primary" id="scfallback">Use phone camera app</button></div>
      <div class="scbar"><button class="secondary" id="sclivedone">Close</button><button class="secondary" id="scauto" aria-pressed="true">Auto photo on</button><button class="secondary" id="sctorch" aria-pressed="false" hidden>Torch off</button></div>
      <button class="primary scbig" id="scsnap" aria-label="Take the photo now">Take photo</button>
    </div>
    <div id="scedit" class="scedit" hidden role="dialog" aria-label="Scan a page">
      <div class="schead"><strong id="sctitle">Page</strong><span id="scstep" class="small"></span></div>
      <div id="scstage" class="scstage"><canvas id="sccrop" aria-label="Page photo with corner and side handles"></canvas><canvas id="screv" aria-label="Flattened page" hidden></canvas><canvas id="scloupe" class="scloupe" width="120" height="120" hidden></canvas><div id="scwork" class="scwork" hidden>Flattening…</div></div>
      <p id="schint" class="small scedithint"></p>
      <div id="scmodes" class="scmodes" hidden>${MODES.map(([k, t]) => `<button class="secondary" data-mode="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
      <div class="scbar" id="scbar0" hidden><button class="primary" id="scretake0">Retake</button><button class="secondary" id="scanyway">Use it anyway</button></div>
      <div class="scbar" id="scbar1"><button class="secondary" id="scretake1">Retake</button><button class="secondary" id="scrot">Rotate</button><button class="primary" id="scflat">Flatten</button></div>
      <div class="scbar" id="scbar2" hidden><button class="secondary" id="scback">Adjust corners</button><button class="secondary" id="scretake2">Retake</button><button class="primary" id="scok">Looks right</button></div>
    </div>
  </div>`;
  const $$ = s => view.querySelector(s);
  const taken = () => (view._pages || []).map(p => p.label).filter(Boolean);
  const burstOn = () => $$('#scburst').checked;
  const range = () => burstLabels($$('#scfrom').value, $$('#scto').value);

  function setNum(l) {
    num = l;
    $$('#scnum').innerHTML = PAGE_LABELS.map(x => `<option value="${x}" ${x === l ? 'selected' : ''}>${x}${taken().includes(x) ? ' (has a photo: will replace)' : ''}</option>`).join('');
    paintShot();
  }
  // the camera button and the burst controls say what the next tap does
  function paintShot() {
    const b = burstOn(), r = range();
    $$('#scrange').hidden = !b; $$('#scone').hidden = b; $$('#scstop').hidden = !run;
    $$('#scshottxt').textContent = run ? `📷 Take page ${run.labels[run.i]} (${run.i + 1} of ${run.labels.length})`
      : b ? `📷 Shoot pages ${r[0]} to ${r[r.length - 1]}` : `📷 Take page ${num}`;
    const over = b && !run ? r.filter(l => taken().includes(l)) : [];
    $$('#scrangenote').hidden = !over.length;
    $$('#scrangenote').textContent = over.length ? `Page${over.length > 1 ? 's' : ''} ${over.join(', ')} already ${over.length > 1 ? 'have photos' : 'has a photo'}: a new shot replaces it.` : '';
  }
  const burstMsg = t => { $$('#scburstmsg').hidden = !t; $$('#scburstmsg').textContent = t || ''; };

  // the 14 slots: empty (tap to take that page), tidying, taken (tap for the page's own screen); under each its state on the
  // way to the study computer, a Retake button when the study computer asks for one
  const stLine = p => {
    const st = stateOf(p, sending, failed), e = p.server || {};
    if (st === 'retake') return `<button class="scst scst-retake" data-retake="${p.id}" aria-label="Retake page ${esc(p.label)}: ${esc(e.why || 'the study computer asks')}">Retake</button>`;
    const t = st === 'read' ? `Read · ${e.values ?? 0}${e.flagged ? ` · ${e.flagged} flag${e.flagged > 1 ? 's' : ''}` : ''}` : STATES[st];
    return `<span class="scst scst-${st}">${esc(t)}${p.from ? ` <i>was ${esc(p.from)}</i>` : ''}</span>`;
  };
  const slot = p => `<figure data-id="${p.id}" class="${p.needs ? 'scneeds' : ''}${p.server?.state === 'retake' ? ' scretake' : ''}">
      <img src="${url(p.clean)}" alt="Page ${esc(p.label || 'not labelled')}${p.needs ? ', needs a look' : ''}" data-open="${p.id}" draggable="false"><b class="scnum">${esc(p.label || '?')}</b><span class="sccheck" aria-hidden="true">✓</span>
      ${p.needs ? '<span class="scflag">Check</span>' : ''}
      ${p.sentAt ? '<span class="scsent">✓</span>' : failed.has(p.id) ? `<button class="scretry" data-retry="${p.id}" title="${esc(failed.get(p.id))}">Retry</button>` : ''}
      ${CAN_SEND ? stLine(p) : ''}</figure>`;
  async function draw() {
    if (gone) return; // a save or a send that finished after the screen was left
    free();
    const ok = !!subject;
    $$('#scact').hidden = !ok;
    const pages = ok ? (await listPages(subject)).sort((a, b) => (Number(a.label) || 99) - (Number(b.label) || 99) || a.at - b.at) : [];
    if (gone) return;
    view._pages = pages;
    $$('#scsave').hidden = !pages.length;
    $$('#scsend').hidden = !pages.length || !CAN_SEND;
    const unsent = pages.filter(p => !p.sentAt).length;
    $$('#scphone').hidden = !pref('phoneread', false) || phoneBusy;
    $$('#scup').hidden = !unsent; $$('#scup').textContent = autoSend() ? `Send now (${unsent} waiting)` : 'Send to the study computer';
    const states = pages.map(p => stateOf(p, sending, failed)), count = s => states.filter(x => x === s).length;
    const onPc = pages.length && states.every(s => !['phone', 'sending', 'failed'].includes(s));
    $$('#scclear').hidden = !CAN_SEND || !onPc;
    if (onPc) $$('#scclearmsg').textContent = `All ${pages.length} page${pages.length > 1 ? 's are' : ' is'} on the study computer: safe to clear from this phone.`
      + (states.every(s => DONE.has(s)) ? '' : ` The photo beside each value in Scan imports comes from this phone, so keep them until the import is approved; approved pages clear by themselves after ${KEEP_DAYS} days.`);
    const by = new Map(), extra = [];
    for (const p of pages) PAGE_LABELS.includes(p.label) && !by.has(p.label) ? by.set(p.label, p) : extra.push(p);
    $$('#sclist').innerHTML = !ok ? '' : PAGE_LABELS.map(l => tidying.has(l) ? `<div class="scslot sctidy" data-tidy="${l}"><b>${l}</b><span>Tidying…</span></div>`
      : by.has(l) ? slot(by.get(l)) : `<button class="scslot" data-shoot="${l}" aria-label="Take page ${l}"><b>${l}</b><span>Take</span></button>`).join('') + extra.map(slot).join('');
    const check = pages.filter(p => p.needs).length;
    $$('#scprog').hidden = !ok;
    const sentN = pages.filter(p => p.sentAt).length, redo = count('retake'), readN = count('read') + count('approved');
    $$('#scprog').textContent = `${by.size} of 14 pages` + (check ? ` · ${check} to check` : '') + (tidying.size ? ` · tidying ${tidying.size}` : '')
      + (CAN_SEND && sentN ? ` · ${sentN} sent` + (readN ? ` · ${readN} read` : '') + (redo ? ` · ${redo} to retake` : '') : '');
    setNum(num);
    paintSel();
  }

  // ---------- from a photo to a page: guess the corners, check the light, flatten, turn upright
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  async function prepare(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }), bw = bmp.width, bh = bmp.height;
    const [sw, sh] = fitSize(bmp.width, bmp.height, SRC_EDGE);
    const work = document.createElement('canvas'); work.width = sw; work.height = sh;
    work.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, sw, sh); bmp.close?.();
    const [gw, gh] = fitSize(sw, sh, 300), sm = document.createElement('canvas'); sm.width = gw; sm.height = gh;
    const sx = sm.getContext('2d', { willReadFrequently: true }); sx.drawImage(work, 0, 0, gw, gh);
    const g = guessCorners(sx.getImageData(0, 0, gw, gh).data, gw, gh);
    let quad = g.corners.map(p => ({ x: p.x * sw / gw, y: p.y * sh / gh }));
    const wide = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) > Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    if (wide) quad = rotateCorners(quad); // a sheet photographed sideways: always a portrait page
    // sure: the whole sheet was found clear of the photo's edges, so the corners step can be skipped (one tap "Looks right")
    return { work, sw, sh, quad, found: g.found, sure: g.found && coachFor(g, gw, gh).ok && isConvex(g.corners), still: { w: bw, h: bh } };
  }
  function lightCheck(pr) { // blur and darkness cannot be fixed later
    const [cw, ch] = fitSize(pr.sw, pr.sh, 1000), cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
    const cx = cc.getContext('2d', { willReadFrequently: true }); cx.drawImage(pr.work, 0, 0, cw, ch);
    return photoCheck(cx.getImageData(0, 0, cw, ch).data, cw, ch, pr.quad.map(p => ({ x: p.x * cw / pr.sw, y: p.y * ch / pr.sh })));
  }
  // the flat page; turned half round when the print reads upside down (unless the person turned it themselves)
  function flatPage(pr, quad, turned) {
    const lit = flattenPage(pr.work.getContext('2d').getImageData(0, 0, pr.sw, pr.sh).data, pr.sw, pr.sh, quad);
    if (!lit) return null;
    const flip = !turned && uprightScore(lit, PAGE_W, PAGE_H).flip;
    if (flip) rotate180(lit);
    return { lit, quad: flip ? rotateCorners(rotateCorners(quad)) : quad, flipped: flip };
  }
  const toJpeg = cv => new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('Could not make the tidied copy.')), 'image/jpeg', 0.9));
  const norm = (q, sw, sh) => q.map(p => ({ x: +(p.x / sw).toFixed(4), y: +(p.y / sh).toFixed(4) }));
  async function store(label, replace, rec) { // a new photo for a page replaces the one before it
    const old = replace ? (view._pages || []).find(p => p.id === replace) : (await listPages(subject)).find(p => p.label === label);
    if (old) await delPage(old.id);
    await putPage({ id: crypto.randomUUID(), subject, label, at: Date.now(), scan: old?.scan, ...rec });
  }

  // a burst page, tidied beside the camera with the remembered lighting style; anything doubtful is marked to check
  function tidyLater(file, label, how, camera) {
    const sub = subject; tidying.add(label); draw();
    const job = async () => {
      await tick();
      const pr = await prepare(file), check = camera ? lightCheck(pr) : undefined, f = flatPage(pr, pr.quad, false);
      if (!f) throw new Error('the page could not be found');
      const cv = document.createElement('canvas'); cv.width = PAGE_W; cv.height = PAGE_H;
      const img = new ImageData(f.lit, PAGE_W, PAGE_H), mode = prefStr('mode', 'auto'), used = setContrast(img.data, mode);
      cv.getContext('2d').putImageData(img, 0, 0);
      const needs = check?.blurry ? 'blurry' : check?.dark ? 'dark' : !pr.sure ? 'corners' : '';
      if (subject !== sub) return;
      await store(label, null, { original: file, clean: await toJpeg(cv), corners: norm(f.quad, pr.sw, pr.sh), mode, used, still: { ...pr.still, how }, check, needs, flipped: f.flipped || undefined });
    };
    saving = saving.then(job).catch(err => burstMsg(`Page ${label} could not be tidied (${err.message}): tap its slot to take it again.`))
      .then(() => { tidying.delete(label); return draw(); }).then(() => pump());
  }

  // ---------- the capture editor: one look at the flat page when the outline is sure, else the corners first
  async function startFile(file, camera, replace, how = '', o = {}) {
    $$('#scedit').hidden = false; setStep('load');
    try {
      const pr = await prepare(file);
      if (o.corners?.length === 4) { pr.quad = o.corners.map(p => ({ x: p.x * pr.sw, y: p.y * pr.sh })); pr.sure = false; }
      ed = { ...pr, file, camera, replace, label: o.label || num, one: !!o.one, mode: o.mode || prefStr('mode', 'auto'), lit: null, used: 'bw', turned: !!o.corners,
        still: o.still || { ...pr.still, how: how || (camera ? 'app' : 'file') } };
      if (camera) {
        const q = ed.check = lightCheck(pr);
        ed.warn = q.blurry && q.dark ? 'Looks blurry and dark' : q.blurry ? 'Looks blurry: the writing may not read' : q.dark ? 'Looks dark: turn on the torch or more light' : '';
      }
      if (ed.warn) setStep('check'); else go();
    } catch (e) { toast('Could not use that photo: ' + e.message); closeEditor(); nextInQueue(); }
  }
  const go = () => ed.sure ? flatten() : setStep('crop');
  const closeEditor = () => { $$('#scedit').hidden = true; ed = null; };

  function setStep(step) {
    const chk = step === 'check', crop = step === 'crop' || chk, rev = step === 'review';
    if (ed) ed.step = step;
    $$('#sctitle').textContent = `Page ${ed?.label || num}`;
    $$('#scstep').textContent = chk ? 'Check the photo' : crop ? 'Step 1 of 2: corners' : rev ? (ed.cropped ? 'Step 2 of 2: check the page' : 'Check the page') : '';
    $$('#sccrop').hidden = !crop; $$('#screv').hidden = !rev; $$('#scbar0').hidden = !chk; $$('#scbar1').hidden = !crop || chk; $$('#scbar2').hidden = !rev; $$('#scmodes').hidden = !rev;
    $$('#scwork').hidden = step !== 'load' && step !== 'work';
    $$('#scwork').textContent = step === 'load' ? 'Opening photo…' : 'Flattening…';
    $$('#schint').textContent = chk ? ed.warn + '. Retake?' : crop ? (ed.found ? 'Drag a corner or the middle of a side onto the paper’s edge; it snaps on.' : 'Could not spot the page: drag each corner onto the paper’s corner.')
      : rev ? (ed.cropped ? 'Shadows taken out.' : 'Page found and flattened.') + (ed.flipped ? ' Turned the right way up.' : '') + ' Pick a lighting style if it looks off.' : '';
    if (crop) { ed.cropped = true; edges(); layoutCrop(); if (!chk) checkQuad(); }
  }
  function edges() { // the edge map for snapping, from a copy about 800 px long (made once per photo)
    if (ed.edges) return;
    const [ew, eh] = fitSize(ed.sw, ed.sh, 800), c = document.createElement('canvas'); c.width = ew; c.height = eh;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(ed.work, 0, 0, ew, eh);
    ed.edges = edgeInfo(x.getImageData(0, 0, ew, eh).data, ew, eh); ed.ek = ew / ed.sw;
  }

  let k = 1; // screen px per photo px in the crop view
  function layoutCrop() {
    const st = $$('#scstage'), c = $$('#sccrop'), d = dpr();
    k = Math.min(st.clientWidth / ed.sw, st.clientHeight / ed.sh);
    const w = Math.round(ed.sw * k), h = Math.round(ed.sh * k);
    c.style.width = w + 'px'; c.style.height = h + 'px'; c.width = Math.round(w * d); c.height = Math.round(h * d);
    drawCrop();
  }
  const mid = i => { const a = ed.quad[i], b = ed.quad[(i + 1) % 4]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b }; };
  function drawCrop() {
    const c = $$('#sccrop'), x = c.getContext('2d'), d = dpr();
    x.setTransform(d, 0, 0, d, 0, 0); x.drawImage(ed.work, 0, 0, ed.sw * k, ed.sh * k);
    x.beginPath(); ed.quad.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](p.x * k, p.y * k)); x.closePath();
    x.fillStyle = 'rgba(255,212,0,.12)'; x.fill(); x.lineWidth = 2; x.strokeStyle = isConvex(ed.quad) ? '#ffd400' : '#ff4040'; x.stroke();
    for (let i = 0; i < 4; i++) { // side handles: a bar along the middle of each side (moves the whole side)
      const m = mid(i), ang = Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x);
      x.save(); x.translate(m.x * k, m.y * k); x.rotate(ang); x.beginPath(); x.roundRect(-20, -7, 40, 14, 7);
      x.fillStyle = ed.drag === 4 + i ? '#ffd400' : 'rgba(255,212,0,.55)'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke(); x.restore();
    }
    ed.quad.forEach((p, i) => { // corner handles, 44 px across
      x.beginPath(); x.arc(p.x * k, p.y * k, i === ed.drag ? 25 : 22, 0, 7); x.fillStyle = 'rgba(255,212,0,.3)'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
    });
  }
  const checkQuad = () => { const ok = isConvex(ed.quad); $$('#scflat').disabled = !ok; if (!ok) $$('#schint').textContent = 'The corners cross over: drag them back round the paper.'; };

  function loupe(i, show) {
    const l = $$('#scloupe'); l.hidden = !show; if (!show) return;
    const p = ed.quad[i], x = l.getContext('2d'), z = Math.min(1, k * 5), half = 60 / z; // window of 120/z photo px around the corner
    x.clearRect(0, 0, 120, 120); x.drawImage(ed.work, p.x - half, p.y - half, half * 2, half * 2, 0, 0, 120, 120);
    x.strokeStyle = '#ff2d55'; x.lineWidth = 1; x.beginPath(); x.moveTo(60, 48); x.lineTo(60, 72); x.moveTo(48, 60); x.lineTo(72, 60); x.stroke();
    const sx = p.x * k, sy = p.y * k, cv = $$('#sccrop'), st = $$('#scstage');
    const left = cv.offsetLeft + sx, top = cv.offsetTop + sy;
    l.style.left = Math.max(0, Math.min(st.clientWidth - 120, left - 60)) + 'px';
    l.style.top = (top < 170 ? top + 50 : top - 170) + 'px';
  }

  // Drag a corner (0-3) or a side's middle (4-7, both its corners move); on letting go it snaps onto the paper's corner or edge
  // when one is near (within 3 % of the photo), else it stays where it was put.
  function snap(i) {
    const e = ed.edges, kk = ed.ek, r = Math.max(e.w, e.h) * 0.03, cl = p => { p.x = Math.max(0, Math.min(ed.sw, p.x)); p.y = Math.max(0, Math.min(ed.sh, p.y)); };
    if (i < 4) {
      const p = ed.quad[i], s = snapCorner(e, { x: p.x * kk, y: p.y * kk }, r);
      if (s) { p.x = s.x / kk; p.y = s.y / kk; return true; }
    } else {
      const a = ed.quad[i - 4], b = ed.quad[(i - 3) % 4], s = snapSide(e, { x: a.x * kk, y: a.y * kk }, { x: b.x * kk, y: b.y * kk }, r);
      if (s) { for (const p of [a, b]) { p.x += s.dx / kk; p.y += s.dy / kk; cl(p); } return true; }
    }
    return false;
  }
  function dragSetup() {
    const c = $$('#sccrop'); let at = null;
    const pt = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
    c.onpointerdown = e => {
      const q = pt(e); let best = -1, bd = 48 / k;
      ed.quad.forEach((p, i) => { const dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd < bd) { bd = dd; best = i; } });
      if (best < 0) { bd = 36 / k; for (let i = 0; i < 4; i++) { const m = mid(i), dd = Math.hypot(m.x - q.x, m.y - q.y); if (dd < bd) { bd = dd; best = 4 + i; } } }
      if (best < 0) return;
      at = { i: best, last: q, dx: best < 4 ? ed.quad[best].x - q.x : 0, dy: best < 4 ? ed.quad[best].y - q.y : 0 };
      ed.drag = best; c.setPointerCapture(e.pointerId); e.preventDefault(); drawCrop(); if (best < 4) loupe(best, true);
    };
    c.onpointermove = e => {
      if (!at) return; const q = pt(e);
      if (at.i < 4) { const p = ed.quad[at.i]; p.x = Math.max(0, Math.min(ed.sw, q.x + at.dx)); p.y = Math.max(0, Math.min(ed.sh, q.y + at.dy)); loupe(at.i, true); }
      else {
        const a = ed.quad[at.i - 4], b = ed.quad[(at.i - 3) % 4];
        let dx = q.x - at.last.x, dy = q.y - at.last.y; // keep both corners inside the photo
        for (const p of [a, b]) { dx = Math.max(-p.x, Math.min(ed.sw - p.x, dx)); dy = Math.max(-p.y, Math.min(ed.sh - p.y, dy)); }
        for (const p of [a, b]) { p.x += dx; p.y += dy; }
        at.last = q;
      }
      drawCrop(); e.preventDefault();
    };
    const up = () => { if (!at) return; const i = at.i; at = null; ed.drag = -1; loupe(0, false); if (snap(i)) navigator.vibrate?.(15); drawCrop(); checkQuad(); };
    c.onpointerup = up; c.onpointercancel = up;
  }

  async function flatten() {
    setStep('work'); await tick();
    try {
      const f = flatPage(ed, ed.quad, ed.turned);
      if (!f) throw new Error('the corners do not make a page');
      ed.lit = f.lit; ed.quad = f.quad; ed.flipped = f.flipped; setStep('review'); renderMode();
    } catch (e) { toast('Could not flatten: ' + e.message); setStep('crop'); }
  }
  function renderMode() {
    const cv = $$('#screv'); cv.width = PAGE_W; cv.height = PAGE_H;
    const img = new ImageData(new Uint8ClampedArray(ed.lit), PAGE_W, PAGE_H);
    ed.used = setContrast(img.data, ed.mode);
    cv.getContext('2d').putImageData(img, 0, 0);
    view.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === ed.mode)));
    $$('[data-mode="auto"]').textContent = ed.mode === 'auto' ? `Auto (${ed.used === 'bw' ? 'black and white' : 'colour'})` : 'Auto';
  }

  // the camera opens again from a button tap (a phone only opens it from a tap), and the save carries on beside it
  function accept() {
    const e = ed, label = e.label;
    const done = toJpeg($$('#screv')).then(clean => store(label, e.replace, { original: e.file, clean, corners: norm(e.quad, e.sw, e.sh), mode: e.mode, used: e.used, still: e.still, check: e.check, needs: '', flipped: e.flipped || undefined }));
    saving = saving.then(() => done).catch(err => toast('Could not save the page: ' + err.message)).then(draw).then(() => pump());
    const after = nextLabel(taken().concat(label), label);
    closeEditor(); setNum(after);
    if (queue.length) nextInQueue(); else if (e.camera && !e.one) shoot();
  }
  function nextInQueue() { const f = queue.shift(); if (f) startFile(f.file, f.camera, null); }
  function retake() { const e = ed; closeEditor(); $$('#scshot').dataset.replace = e.replace || ''; num = e.label; one = e.one ? { label: e.label } : null; queue = []; shoot(); }

  const startNext = async () => { await saving; await draw(); };
  // a finished photo: just this page (a slot or Retake), the next page of a burst, or the editor for the page number shown
  async function took(file, camera, replace, how) {
    if (one) { const o = one; one = null; await startNext(); queue = []; return startFile(file, camera, replace, how, { label: o.label, one: true }); }
    if (run) {
      const label = run.labels[run.i++];
      tidyLater(file, label, how, camera);
      if (run.i >= run.labels.length) endRun(`Burst done: pages ${run.labels[0]} to ${label}.`);
      paintShot(); return label;
    }
    await startNext(); queue = []; startFile(file, camera, replace, how);
  }
  function endRun(t) {
    const r = run; run = null; if (!r) return; closeLive(); paintShot();
    const n = r.i; burstMsg(n ? `${t || `Burst stopped after ${n} page${n > 1 ? 's' : ''}.`} Pages marked Check need a look; tap any page to retake it.` : '');
  }

  $$('#scsub').oninput = e => { subject = e.target.value.trim().toUpperCase(); num = '1'; run = null; one = null; burstMsg(''); draw().then(() => { setNum(nextLabel(taken())); $$('#scfrom').value = nextLabel(taken()); $$('#scto').value = '14'; paintShot(); poll(); }); };
  $$('#scnum').onchange = e => setNum(e.target.value);
  $$('#scburst').checked = pref('burst', true);
  $$('#scburst').onchange = e => { setPref('burst', e.target.checked); run = null; paintShot(); };
  $$('#scfrom').onchange = () => { if (Number($$('#scto').value) < Number($$('#scfrom').value)) $$('#scto').value = $$('#scfrom').value; paintShot(); };
  $$('#scto').onchange = () => { if (Number($$('#scto').value) < Number($$('#scfrom').value)) $$('#scfrom').value = $$('#scto').value; paintShot(); };
  $$('#scto').value = '14';
  $$('#scstop').onclick = () => endRun();
  $$('#scshot').onchange = async e => {
    const f = [...e.target.files], r = e.target.dataset.replace || null; e.target.dataset.replace = ''; e.target.value = '';
    if (!subject || !f.length) return;
    took(f[0], true, r, 'app');
  };
  $$('#scpick').onchange = async e => {
    const f = [...e.target.files]; e.target.value = '';
    if (!subject || !f.length) return;
    if (burstOn()) { // several pages in a row from the gallery: the range's numbers in the order picked
      const r = range(), use = f.slice(0, r.length);
      use.forEach((file, i) => tidyLater(file, r[i], 'file', false));
      return burstMsg(`Tidying pages ${r[0]} to ${r[use.length - 1]}.` + (f.length > r.length ? ` ${f.length - r.length} more photo${f.length - r.length > 1 ? 's were' : ' was'} left out: the range is ${r.length} page${r.length > 1 ? 's' : ''}.` : '') + ' Pages marked Check need a look.');
    }
    await startNext(); queue = f.slice(1).map(file => ({ file, camera: false })); startFile(f[0], false, null);
  };
  $$('#scflat').onclick = flatten;
  $$('#scrot').onclick = () => { ed.quad = rotateCorners(ed.quad); ed.turned = true; drawCrop(); checkQuad(); };
  $$('#scback').onclick = () => setStep('crop');
  $$('#scok').onclick = accept;
  $$('#scretake0').onclick = retake; $$('#scretake1').onclick = retake; $$('#scretake2').onclick = retake;
  $$('#scanyway').onclick = go;
  $$('#scmodes').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) { ed.mode = b.dataset.mode; setPrefStr('mode', ed.mode); renderMode(); } };
  addEventListener('resize', () => { if (ed?.step === 'crop' || ed?.step === 'check') layoutCrop(); if (live) layoutLive(); });
  dragSetup();

  // ---------- live camera (owner, 20 Oct 2026): the page outline drawn on the video from guessCorners on a small copy of
  // each frame, a coach line, a photo by itself once the page is found and held still (or the shutter button), torch where
  // the phone has one. The photo is the camera's full-resolution still (ImageCapture) where the browser has it, else the
  // biggest video frame; its size shows at the top and is kept with the page. "Use phone camera app" goes back to the
  // phone's own camera (this phone only), and so does a camera that will not open.
  let live = null;
  const canLive = () => !pref('camapp', false) && !!navigator.mediaDevices?.getUserMedia;
  function shoot() { if (canLive()) openLive(); else $$('#scshot').click(); }
  // the camera button: with "Several pages in a row" on, a tap starts a burst over the chosen range
  function startShot() { if (!run && !one && burstOn()) { run = { labels: range(), i: 0 }; burstMsg(''); paintShot(); } }
  const liveTitle = () => run && !one ? `Page ${run.labels[run.i]} · ${run.i + 1} of ${run.labels.length}` : `Page ${one?.label || num}`;
  const say = t => { const c = $$('#sccoach'); if (c.textContent !== t) c.textContent = t; };
  const paintAuto = () => { const on = live?.auto; $$('#scauto').setAttribute('aria-pressed', String(!!on)); $$('#scauto').textContent = on ? 'Auto photo on' : 'Auto photo off'; };

  async function openLive() {
    closeLive();
    const L = live = { auto: pref('auto', true), steady: 0, since: Date.now(), busy: false, torch: false, armed: true, sm: document.createElement('canvas') };
    $$('#sclive').hidden = false; $$('#sclivefail').hidden = true; $$('#sctorch').hidden = true; $$('#scsnap').disabled = true;
    $$('#sclivetitle').textContent = liveTitle(); $$('#sclivedone').textContent = run && !one ? 'Done' : 'Close'; $$('#sclivesize').textContent = ''; say('Opening the camera…'); paintAuto();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
      if (live !== L) { stream.getTracks().forEach(t => t.stop()); return; }
      L.stream = stream; L.track = stream.getVideoTracks()[0];
      const v = $$('#scvideo'); v.srcObject = stream; await v.play();
      if (live !== L) return;
      if (!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
      $$('#sctorch').hidden = !L.track.getCapabilities?.().torch;
      if ('ImageCapture' in window) {
        try { L.cap = new ImageCapture(L.track); L.photo = await L.cap.getPhotoCapabilities(); } catch { L.cap = null; }
      }
      const pw = L.photo?.imageWidth?.max, ph = L.photo?.imageHeight?.max;
      $$('#sclivesize').textContent = `Camera ${v.videoWidth}×${v.videoHeight}` + (pw ? ` · photo ${pw}×${ph}` : '');
      $$('#scsnap').disabled = false; layoutLive(); look();
    } catch (e) {
      if (live !== L) return;
      $$('#sclivewhy').textContent = `Could not open the live camera (${e.name || e.message}). Use the phone’s camera app for this page, or turn on “Use phone camera app” below the camera button.`;
      $$('#sclivefail').hidden = false; say('');
    }
  }
  function closeLive() {
    const L = live; live = null; if (!L) return;
    clearTimeout(L.timer); L.stream?.getTracks().forEach(t => t.stop());
    const v = $$('#scvideo'); v.pause(); v.srcObject = null; $$('#sclive').hidden = true;
  }
  function layoutLive() {
    const v = $$('#scvideo'), st = $$('#sclivestage'), vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
    const kk = Math.min(st.clientWidth / vw, st.clientHeight / vh), w = Math.round(vw * kk), h = Math.round(vh * kk), d = dpr(), o = $$('#scover');
    $$('#sclivebox').style.width = w + 'px'; $$('#sclivebox').style.height = h + 'px';
    o.width = Math.round(w * d); o.height = Math.round(h * d); live.k = kk;
  }
  function drawLive(quad, ok) {
    const o = $$('#scover'), x = o.getContext('2d'), d = dpr(), kk = live.k || 1;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, o.width, o.height); if (!quad) return;
    x.setTransform(d * kk, 0, 0, d * kk, 0, 0);
    x.beginPath(); quad.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](p.x, p.y)); x.closePath();
    x.fillStyle = ok ? 'rgba(47,128,255,.18)' : 'rgba(255,212,0,.12)'; x.fill();
    x.lineWidth = 3 / kk; x.strokeStyle = ok ? '#2f80ff' : '#ffd400'; x.stroke();
    quad.forEach(p => { x.beginPath(); x.arc(p.x, p.y, 9 / kk, 0, 7); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 3 / kk; x.stroke(); });
  }
  // one look at the video: find the page, coach, count the frames it is held still, take the photo
  function look() {
    const L = live; if (!L || L.busy) return;
    const v = $$('#scvideo'), vw = v.videoWidth, vh = v.videoHeight;
    if (vw) {
      const [gw, gh] = fitSize(vw, vh, 240), sm = L.sm; if (sm.width !== gw) { sm.width = gw; sm.height = gh; }
      const sx = sm.getContext('2d', { willReadFrequently: true }); sx.drawImage(v, 0, 0, gw, gh);
      const g = guessCorners(sx.getImageData(0, 0, gw, gh).data, gw, gh), c = coachFor(g, gw, gh);
      // in a burst the next photo waits for the sheet to change: the page gone or cut off, or moved well away from the last shot
      if (!L.armed && (!c.ok || quadMove(L.shot, g.corners, gw, gh) > 0.04)) { L.armed = true; L.since = Date.now(); }
      L.steady = L.armed && c.ok && L.prev && quadMove(L.prev, g.corners, gw, gh) < 0.012 ? L.steady + 1 : 0;
      L.prev = c.ok ? g.corners : null;
      drawLive(g.found ? g.corners.map(p => ({ x: p.x * vw / gw, y: p.y * vh / gh })) : null, c.ok);
      if (L.auto && Date.now() - L.since > GIVE_UP) { L.auto = false; L.gaveUp = true; paintAuto(); }
      if (L.auto && L.steady >= STEADY) return capture();
      say(!L.armed ? `Page ${L.took} taken. Now page ${run?.labels[run.i]}: swap the sheet` : c.ok ? (L.auto ? 'Hold steady…' : 'Page found: tap Take photo') : c.say + (L.gaveUp ? '. Or tap Take photo' : ''));
    }
    L.timer = setTimeout(look, 120);
  }
  async function capture() {
    const L = live; if (!L || L.busy) return;
    L.busy = true; clearTimeout(L.timer); $$('#scsnap').disabled = true; say('Capturing… hold steady');
    let blob = null, how = 'frame';
    if (L.cap) { // full-resolution still; the torch stays as it is, otherwise no flash
      const opt = {}; if (L.photo?.imageWidth?.max) opt.imageWidth = L.photo.imageWidth.max;
      if (!L.torch && L.photo?.fillLightMode?.includes('off')) opt.fillLightMode = 'off';
      try { blob = await L.cap.takePhoto(opt); how = 'photo'; } catch { try { blob = await L.cap.takePhoto(); how = 'photo'; } catch { blob = null; } }
    }
    if (live !== L) return;
    if (!blob) {
      const v = $$('#scvideo'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    }
    if (live !== L) return;
    navigator.vibrate?.(40);
    if (!blob) { L.busy = false; $$('#scsnap').disabled = false; say('Could not take the photo: try again.'); L.timer = setTimeout(look, 120); return; }
    if (run && !one) { // a burst: the page is tidied beside the camera, which stays open for the next one
      const label = await took(blob, true, null, how);
      if (live !== L) return;
      Object.assign(L, { busy: false, armed: false, shot: L.prev || [], took: label, steady: 0 });
      $$('#sclivetitle').textContent = liveTitle(); $$('#scsnap').disabled = false;
      return look();
    }
    const r = $$('#scshot').dataset.replace || null; $$('#scshot').dataset.replace = '';
    closeLive();
    took(blob, true, r, how);
  }
  $$('#scsnap').onclick = () => { if (live) { live.armed = true; capture(); } };
  $$('#sclivedone').onclick = () => { $$('#scshot').dataset.replace = ''; one = null; if (run) endRun(); else closeLive(); };
  $$('#scauto').onclick = () => { if (!live) return; live.auto = !live.auto; live.since = Date.now(); live.gaveUp = false; live.steady = 0; setPref('auto', live.auto); paintAuto(); };
  $$('#sctorch').onclick = async () => {
    const L = live; if (!L?.track) return;
    try { await L.track.applyConstraints({ advanced: [{ torch: !L.torch }] }); L.torch = !L.torch; }
    catch { $$('#sctorch').hidden = true; return toast('This phone’s torch cannot be used from here.'); }
    $$('#sctorch').setAttribute('aria-pressed', String(L.torch)); $$('#sctorch').textContent = L.torch ? 'Torch on' : 'Torch off';
  };
  $$('#scfallback').onclick = () => { closeLive(); $$('#scshot').click(); };
  $$('#scshotlbl').addEventListener('click', startShot, true);
  // the camera button opens the live camera; with the camera app switch on (or no live camera) the label opens the file picker
  $$('#scshotlbl').addEventListener('click', e => { if (e.target !== $$('#scshot') && canLive()) { e.preventDefault(); openLive(); } });
  $$('#sccamapp').checked = pref('camapp', false);
  $$('#sccamapp').onchange = e => setPref('camapp', e.target.checked);

  // ---------- thumbnails, a page's own dialog, saving to the phone
  const show = id => view._pages.find(p => p.id === id);
  // Press and hold a photo to start selecting; then tap to add or remove, and use the bar to select all, none, delete or cancel.
  function paintSel() {
    if (sel) { const ids = new Set((view._pages || []).map(p => p.id)); sel = new Set([...sel].filter(id => ids.has(id))); }
    const on = !!sel;
    $$('#sclist').classList.toggle('selecting', on);
    $$('#scselbar').hidden = !on;
    $$('#sclist').querySelectorAll('figure').forEach(f => f.classList.toggle('picked', on && sel.has(f.dataset.id)));
    if (on) {
      $$('#scselcount').textContent = `${sel.size} selected`;
      $$('#scseldel').disabled = !sel.size;
    }
  }
  let holdTimer = 0, held = false, holdAt = null;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = 0; };
  $$('#sclist').addEventListener('pointerdown', e => {
    held = false; stopHold();
    const f = e.target.closest('figure');
    if (!f || e.target.closest('[data-retry], [data-retake]')) return;
    holdAt = [e.clientX, e.clientY];
    holdTimer = setTimeout(() => {
      held = true; sel = sel || new Set(); sel.add(f.dataset.id); navigator.vibrate?.(30); paintSel();
    }, 500);
  });
  $$('#sclist').addEventListener('pointermove', e => { if (holdTimer && Math.hypot(e.clientX - holdAt[0], e.clientY - holdAt[1]) > 10) stopHold(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) $$('#sclist').addEventListener(t, stopHold);
  $$('#sclist').addEventListener('contextmenu', e => e.preventDefault());
  $$('#scselall').onclick = () => { sel = new Set((view._pages || []).map(p => p.id)); paintSel(); };
  $$('#scselnone').onclick = () => { sel = new Set(); paintSel(); };
  $$('#scselcancel').onclick = () => { sel = null; paintSel(); };
  $$('#scseldel').onclick = async () => {
    const ids = [...(sel || [])]; if (!ids.length || !confirm(`Delete ${ids.length} photo${ids.length > 1 ? 's' : ''} (originals and tidied copies)?`)) return;
    for (const id of ids) await delPage(id);
    sel = null; toast(`Deleted ${ids.length}`); await draw();
  };
  $$('#sclist').onclick = async e => {
    if (held) { held = false; return; }
    if (sel) {
      const f = e.target.closest('figure'); if (!f) return;
      sel.has(f.dataset.id) ? sel.delete(f.dataset.id) : sel.add(f.dataset.id); return paintSel();
    }
    const r = e.target.closest('[data-retry]');
    if (r) { tries.delete(r.dataset.retry); return send([show(r.dataset.retry)], true); }
    const rt = e.target.closest('[data-retake]');
    if (rt) { const p = show(rt.dataset.retake); $$('#scshot').dataset.replace = p.id; num = p.label || num; setNum(num); one = { label: num }; return shoot(); } // the study computer asked: straight to the camera
    const t = e.target.closest('[data-shoot]');
    if (t) { one = { label: t.dataset.shoot }; setNum(t.dataset.shoot); return shoot(); } // an empty slot: take just that page
    const o = e.target.closest('[data-open]');
    if (o) {
      const p = show(o.dataset.open); let orig = false; view._open = p;
      const sh = () => { $$('#scimg').src = url(orig ? p.original : p.clean); $$('#scorig').textContent = orig ? 'Show tidied' : 'Show original'; };
      $$('#scdlgnum').innerHTML = `<option value="">Which page?</option>` + PAGE_LABELS.map(l => `<option ${p.label === l ? 'selected' : ''}>${l}</option>`).join('');
      const why = NEEDS[p.needs] || (p.server?.state === 'retake' ? 'Study computer: ' + (p.server.why || 'retake this page.') : p.from ? `The study computer matched this photo to page ${p.label} (it was sent as page ${p.from}).` : '');
      $$('#scdlgok').hidden = !p.needs; $$('#scdlgwhy').hidden = !why; $$('#scdlgwhy').textContent = why;
      $$('#scorig').onclick = () => { orig = !orig; sh(); }; sh(); $$('#scdlg').showModal();
    }
  };
  // a taken page: it looks fine after all, adjust its corners, or a new photo from the gallery (one screen at a time: the dialog
  // closes before the editor opens)
  $$('#scdlgok').onclick = async () => { const p = view._open; $$('#scdlg').close(); if (!p) return; p.needs = ''; await putPage(p); await draw(); pump(); };
  $$('#scadjust').onclick = () => {
    const p = view._open; $$('#scdlg').close(); if (!p) return;
    startFile(p.original, false, p.id, '', { label: p.label || num, one: true, corners: p.corners, mode: p.mode, still: p.still });
  };
  $$('#scgallery').onchange = e => {
    const f = e.target.files[0], p = view._open; e.target.value = ''; $$('#scdlg').close(); if (!f || !p) return;
    startFile(f, false, p.id, 'file', { label: p.label || num, one: true });
  };
  $$('#scdlgnum').onchange = async e => {
    const p = view._open; if (!p) return; p.label = e.target.value; if (p.sentAt) p.from = p.from || p.sentAs; await putPage(p); toast(p.label ? `Page ${p.label}` : 'Label cleared'); await draw(); pump();
  };
  $$('#scdel').onclick = async () => {
    const p = view._open; if (!p || !confirm('Delete this photo (original and tidied copy)?')) return;
    await delPage(p.id); $$('#scdlg').close(); await draw();
  };
  $$('#scretake').onclick = () => { const p = view._open; $$('#scdlg').close(); if (!p) return; $$('#scshot').dataset.replace = p.id; num = p.label || num; setNum(num); one = { label: num }; shoot(); };
  $$('#scclose').onclick = () => $$('#scdlg').close();

  // ---------- sending (owner, 20 Oct 2026): a queue. Each page goes when it is ready, every subject's unsent pages in turn, one
  // at a time; a failure is tried again after 15 s, 1 min, then every 5 min, and at once when the signal comes back. Pages
  // marked Check wait for a look (Looks right, Retake) unless sent by hand (Send now, Retry). The sign-in is checked when the
  // screen opens: until it is done, the note at the top says so and nothing is tried.
  const autoSend = () => pref('autosend', true);
  const msg = t => { if (!gone) $$('#scmsg').innerHTML = t; };
  const signNote = () => { if (!gone) $$('#scsign').hidden = auth !== false; };
  const wanted = new Set(), waitTill = new Map(); // pages picked by hand; page id -> no new try before
  const later = ms => { clearTimeout(retryT); retryT = setTimeout(pump, Math.max(1000, ms)); };
  async function checkSign() {
    if (!CAN_SEND) return false;
    const got = await signedIn(); if (got !== null) auth = !!got; // no signal: keep what was known
    signNote();
    return auth;
  }
  const scanOf = (p, all) => p.scan || all.find(q => q.subject === p.subject && q.scan)?.scan || scans.get(p.subject) || scans.set(p.subject, crypto.randomUUID()).get(p.subject);
  async function pump() {
    if (gone || !CAN_SEND) return;
    if (pumping) { again = true; return; }
    pumping = true; clearTimeout(retryT);
    try {
      do {
        again = false;
        const all = await allPages(), now = Date.now(), unsent = all.filter(p => !p.sentAt);
        for (const id of waitTill.keys()) if (!unsent.some(p => p.id === id)) waitTill.delete(id);
        const todo = unsent.filter(p => wanted.has(p.id) || autoSend() && !p.needs && (waitTill.get(p.id) || 0) <= now);
        // a page number used twice for one subject, or none: that page waits until it is fixed
        const n = new Map(), key = p => p.subject + '\n' + p.label; unsent.forEach(p => n.set(key(p), (n.get(key(p)) || 0) + 1));
        const stuck = todo.filter(p => !p.label || n.get(key(p)) > 1), go = todo.filter(p => !stuck.includes(p));
        stuck.forEach(p => wanted.delete(p.id));
        const mine = stuck.find(p => p.subject === subject);
        if (mine) msg(mine.label ? `Two photos are labelled page ${esc(mine.label)}: delete one, or fix its number. The others are sent.` : 'Choose a page number for every photo first.');
        if (!go.length) break;
        if (!navigator.onLine) { msg(`No signal: ${go.length} page${go.length > 1 ? 's' : ''} will go when the phone is back online. They are kept on this phone.`); break; }
        if (!await checkSign()) {
          msg(auth === false ? 'Not sent yet: sign in first (the note at the top).' : 'The study computer could not be reached: trying again in a minute.');
          if (auth !== false) later(60000);
          break;
        }
        let k = 0, good = 0; const bad = [];
        for (const p of go) {
          msg(`Sending page ${esc(p.label)}${p.subject !== subject ? ` of ${esc(p.subject)}` : ''} (${++k} of ${go.length})…`);
          sending.add(p.id); if (p.subject === subject) await draw();
          try {
            const scan = scanOf(p, all);
            const r = await fetch(`${API}upload/${scan}/${p.label}`, { method: 'POST', redirect: 'manual', body: p.clean,
              headers: { 'Content-Type': 'image/jpeg', ...(SUBJECT.test(p.subject) && { 'X-Scan-Subject': p.subject }) } });
            if (r.status === 401 || r.type === 'opaqueredirect') { auth = false; signNote(); throw new Error('sign in first'); }
            if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `error ${r.status}`); }
            const cur = await getPage(p.id); // deleted or replaced meanwhile: nothing to mark
            if (cur) { Object.assign(cur, { scan, sentAt: Date.now(), sentAs: p.label }); delete cur.server; delete cur.from; delete cur.doneAt; await putPage(cur); }
            p.scan = scan; failed.delete(p.id); tries.delete(p.id); waitTill.delete(p.id); good++;
          } catch (err) {
            const t = (tries.get(p.id) || 0) + 1; tries.set(p.id, t);
            failed.set(p.id, err.message); waitTill.set(p.id, Date.now() + RETRY[Math.min(t, RETRY.length) - 1] * 1000);
            bad.push(`page ${esc(p.label)}: ${esc(err.message)}`);
          } finally { sending.delete(p.id); wanted.delete(p.id); }
          if (auth === false || gone) break; // the rest wait for the next time this screen is open
        }
        msg(bad.length ? `${good ? good + ' sent. ' : ''}Not sent: ${bad.join('; ')}. The photos are still on this phone; ${auth === false ? 'sign in, then they go' : 'trying again by itself, or tap Retry on the page'}.`
          : `${good} page${good > 1 ? 's' : ''} sent. They stay on this phone too.`);
        await draw();
        if (good) poll();
      } while (again && !gone);
      const next = Math.min(...waitTill.values());
      if (isFinite(next) && autoSend() && auth !== false) later(next - Date.now());
    } finally { pumping = false; }
  }
  // Read on phone (js/scan-phone.js): this subject's pages, read here; the upload above goes on as before
  $$('#scphone').onclick = async () => {
    if (phoneBusy || !subject) return;
    phoneBusy = true; draw();
    try {
      const all = await allPages(), pages = view._pages, scan = scanOf(pages[0], all);
      const put = async p => { const cur = await getPage(p.id); if (cur) await putPage({ ...cur, phoneRead: p.phoneRead }); };
      const { readSubject } = await import('./scan-phone.js');
      const r = await readSubject({ cloud: testCloud() || cloud, pages, subject, scan, put, progress: t => msg(esc(t)) });
      msg(`Read ${r.pages} page${r.pages > 1 ? 's' : ''} on the phone: in Scan imports for an admin to check.`);
    } catch (e) { msg('Not read on the phone: ' + esc(e.message)); }
    finally { phoneBusy = false; draw(); }
  };
  const send = (pages, hand) => { pages.filter(p => p && !p.sentAt).forEach(p => { wanted.add(p.id); waitTill.delete(p.id); }); if (hand && !pages.some(p => p && !p.sentAt)) msg('Everything is already sent.'); return pump(); };
  $$('#scup').onclick = () => send(view._pages, true);

  // the study computer's word on each sent page, every 20 s while one is waiting to be read, else every 2 min, while this
  // screen is open and the phone awake; stops once every sent page is approved or rejected
  let polling = false, pollAgain = false;
  async function poll() {
    if (polling) { pollAgain = true; return; } // one at a time, so an older answer never lands after a newer one
    polling = true;
    try { do { pollAgain = false; await pollOnce(); } while (pollAgain); } finally { polling = false; }
  }
  async function pollOnce() {
    clearTimeout(pollT);
    if (gone || !CAN_SEND || document.hidden || auth === false) return;
    const all = await allPages(), open = all.filter(p => p.sentAt && p.scan && !DONE.has(p.server?.state));
    if (!open.length) return;
    let busy = false, mineChanged = false;
    for (const id of new Set(open.map(p => p.scan))) {
      try {
        const r = await fetch(`${API}status/${id}`, { cache: 'no-store', redirect: 'manual' });
        if (!r.ok) continue;
        const st = await r.json(), sub = all.find(p => p.scan === id).subject;
        if (gone) return;
        const { changed, moved } = applyStatus(all.filter(p => p.subject === sub), st);
        for (const p of changed) { const cur = await getPage(p.id); if (cur) await putPage({ ...cur, label: p.label, from: p.from, server: p.server, doneAt: p.doneAt }); }
        if (sub === subject && changed.length) mineChanged = true;
        if (sub === subject && moved.length) burstMsg(moved.map(([a, b]) => `The study computer matched the photo sent as page ${a} to page ${b}: it is in slot ${b} now.`).join(' '));
        if (Object.values(st.page || {}).some(e => e.state === 'received' || e.state === 'reading')) busy = true;
      } catch { busy = true; /* no signal: try again soon */ }
    }
    if (mineChanged) await draw();
    pollT = setTimeout(poll, busy ? 20000 : 120000);
  }
  // safe to clear: every page of this subject is on the study computer
  $$('#scclearbtn').onclick = async () => {
    const pages = view._pages || [];
    if (!pages.length || !confirm(`Clear ${pages.length} page${pages.length > 1 ? 's' : ''} of ${subject} from this phone (originals and tidied copies)? The study computer keeps its copies.`)) return;
    for (const p of pages) await delPage(p.id);
    toast(`Cleared ${pages.length} from this phone`); await draw();
  };
  // pages approved or rejected over KEEP_DAYS ago are cleared by themselves
  async function autoClear() {
    const old = (await allPages()).filter(p => p.doneAt && DONE.has(p.server?.state) && Date.now() - p.doneAt > KEEP_DAYS * 864e5);
    for (const p of old) await delPage(p.id);
    if (old.length) toast(`Cleared ${old.length} page${old.length > 1 ? 's' : ''} reviewed over ${KEEP_DAYS} days ago from this phone`);
  }
  $$('#scsignchk').onclick = async () => {
    const ok = await checkSign();
    $$('#scsignmsg').textContent = ok ? '' : ok === false ? 'Not signed in yet: tap Sign in, enter your email, then the code it sends, then come back here.' : 'No signal: try again in a moment.';
    if (ok) { pump(); poll(); }
  };
  $$('#scautosendlbl').hidden = !CAN_SEND;
  $$('#scphonelbl').hidden = !CAN_SEND;
  $$('#scphoneon').checked = pref('phoneread', false);
  $$('#scphoneon').onchange = e => { setPref('phoneread', e.target.checked); draw(); };
  $$('#scautosend').checked = autoSend();
  $$('#scautosend').onchange = e => { setPref('autosend', e.target.checked); draw(); if (e.target.checked) pump(); };
  const online = () => { waitTill.clear(); pump(); };
  addEventListener('online', online);
  $$('#scdl').onclick = () => {
    for (const p of view._pages) { const a = document.createElement('a'); a.href = url(p.clean); a.download = fileName(p); a.click(); }
    toast('Saved to this phone’s downloads');
  };
  // the phone locked or another app opened: camera off; back (perhaps from the sign-in page): check the sign-in, send, look
  const hide = () => { if (document.hidden) return closeLive(); if (CAN_SEND) checkSign().then(ok => { if (ok) { pump(); poll(); } }); };
  document.addEventListener('visibilitychange', hide);
  draw();
  if (CAN_SEND) checkSign().then(ok => { autoClear().then(draw); if (ok) { pump(); poll(); } });
  return () => { gone = true; document.removeEventListener('visibilitychange', hide); removeEventListener('online', online); clearTimeout(retryT); clearTimeout(pollT); closeLive(); free(); };
}
