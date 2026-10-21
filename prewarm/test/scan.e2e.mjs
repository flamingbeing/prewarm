// Scan pages screen in demo mode (fake image only): off by default, toggled on in Settings, a photo is tidied, labelled,
// kept after a reload, and deleted. Needs the site served on :8080 like e2e.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch();
const fails = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => fails.push('page error: ' + e.message));
let refuse = false;
pg.on('dialog', d => { if (refuse) { refuse = false; return d.dismiss(); } return d.accept(); });
const ok = (c, m) => { if (!c) fails.push(m); };
try {
  // a fake photo: a tilted white page with dark lines and a shadow across its right half, on dark "carpet"
  const photoJs = `async (name) => {
    const W = 1600, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#3a302a'; x.fillRect(0, 0, W, H);
    x.save(); x.beginPath(); x.moveTo(380, 120); x.lineTo(1180, 190); x.lineTo(1260, 1060); x.lineTo(300, 980); x.closePath(); x.clip();
    x.fillStyle = '#e8e8e2'; x.fillRect(0, 0, W, H); x.fillStyle = '#202020';
    for (let i = 0; i < 9; i++) x.fillRect(420 + i * 8, 260 + i * 80, 600, 10);
    const g = x.createLinearGradient(700, 0, 1300, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.restore();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return new File([blob], name, { type: 'image/jpeg' });
  }`;
  const give = (sel, name) => pg.evaluate(`(async () => { const f = await (${photoJs})(${JSON.stringify(name)}); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('${sel}'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
  const flatPaper = () => pg.$eval('#screv', cv => { // brightness along a row of the page, away from the ink lines
    const x = cv.getContext('2d'), v = []; for (const px of [150, 450, 900, 1350, 1650]) v.push(x.getImageData(px, 2300, 1, 1).data[0]); return v; });

  await pg.goto('http://localhost:8080/prewarm/?demo#/settings'); await pg.waitForTimeout(800);
  ok(!(await pg.$('a[href="#/scan"]')), 'Scan pages link hidden until switched on');
  await pg.check('#scanon');
  await pg.click('a[href="#/scan"]');
  await pg.waitForSelector('#scsub');
  ok(await pg.$eval('#scact', e => e.hidden), 'no photo buttons before a Subject ID');
  await pg.fill('#scsub', 'DEMO-01');
  ok(!(await pg.$eval('#scact', e => e.hidden)), 'photo buttons after a Subject ID');
  ok(await pg.isChecked('#scburst'), 'several pages in a row is on by default');
  await pg.uncheck('#scburst'); // one page at a time here; bursts and the grid have their own test (scan-burst.e2e.mjs)
  ok(/Take page 1/.test(await pg.textContent('#scshottxt')), 'one page at a time: camera button names page 1');
  await pg.check('#sccamapp'); // this test feeds files to the camera-app input; the live camera has its own test (scan-live.e2e.mjs)

  // photo -> the page was found clearly, so straight to the flat page (one tap "Looks right"); Adjust corners for the crop step
  await give('#scshot', 'p1.jpg');
  await pg.waitForSelector('#scedit:not([hidden]) #screv:not([hidden])');
  ok(/^Check the page$/.test(await pg.textContent('#scstep')) && /Page found and flattened/.test(await pg.textContent('#schint')), 'sure outline skips the corners: ' + await pg.textContent('#schint'));
  ok(/Looks right/.test(await pg.textContent('#scok')), 'one-tap Looks right');
  await pg.click('#scback');
  await pg.waitForSelector('#sccrop:not([hidden])');
  const box = await pg.$eval('#sccrop', c => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  ok(box[2] > 300 && Math.abs(box[2] / box[3] - 4 / 3) < 0.02, 'crop view shows the whole photo, got ' + box);
  // the guess should have put the first corner near the page's top-left (380,120 of 1600x1200): nudge it by dragging, loupe shows
  const at = (px, py) => [box[0] + px / 1600 * box[2], box[1] + py / 1200 * box[3]];
  const [cx, cy] = at(380, 120);
  await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx + 3, cy + 3, { steps: 3 });
  ok(!(await pg.$eval('#scloupe', e => e.hidden)), 'magnifier shown while a corner is held');
  await pg.mouse.up();
  ok(await pg.$eval('#scloupe', e => e.hidden), 'magnifier hidden after letting go');
  await pg.click('#scflat');
  await pg.waitForSelector('#screv:not([hidden])');
  const paper = await flatPaper();
  ok(Math.min(...paper) > 235 && Math.max(...paper) - Math.min(...paper) < 15, 'flat page is evenly lit across the shadow: ' + paper);
  const dimsRev = await pg.$eval('#screv', c => [c.width, c.height]);
  ok(dimsRev[0] === 1800 && dimsRev[1] === 2400, 'flat page is 1800x2400, got ' + dimsRev);
  ok(/Auto \(black and white\)/.test(await pg.textContent('[data-mode="auto"]')), 'Auto picks black and white for black ink');
  await pg.click('[data-mode="color"]');
  ok(await pg.$eval('[data-mode="color"]', b => b.getAttribute('aria-pressed')) === 'true', 'Colour chosen');
  await pg.click('[data-mode="bw"]');
  const chooser = pg.waitForEvent('filechooser', { timeout: 5000 });
  await pg.click('#scok');
  await chooser; // Accept reopens the camera
  ok(await pg.$eval('#scedit', e => e.hidden), 'editor closed after Accept');
  await pg.waitForSelector('#sclist figure');
  ok(await pg.$eval('#scnum', s => s.value) === '2', 'page number moved on to 2');
  ok(/Take page 2/.test(await pg.textContent('#scshottxt')), 'camera button names page 2');

  // skip page 2 and 3: choose 4; the next offer is 5
  await pg.selectOption('#scnum', '4');
  await give('#scshot', 'p4.jpg');
  await pg.waitForSelector('#screv:not([hidden])');
  await pg.click('[data-mode="color"]'); await pg.click('#scback'); await pg.waitForSelector('#sccrop:not([hidden])');
  await pg.click('#scrot'); await pg.click('#scrot'); await pg.click('#scrot'); await pg.click('#scrot'); // a full turn: back where it was
  await pg.click('#scflat'); await pg.waitForSelector('#screv:not([hidden])');
  await pg.click('#scok');
  await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 2);
  ok(await pg.$eval('#scnum', s => s.value) === '5', 'after page 4 the offer is page 5');
  ok(JSON.stringify(await pg.$$eval('.scnum', e => e.map(x => x.textContent))) === '["1","4"]', 'thumbnails in page order');

  // the original is kept beside the tidied copy, and the tidied copy is the flat page
  await pg.click('[data-open]'); await pg.waitForSelector('dialog[open]');
  const dims = await pg.$eval('#scimg', i => new Promise(r => { const f = () => r([i.naturalWidth, i.naturalHeight]); i.complete ? f() : (i.onload = f); }));
  ok(dims[0] === 1800 && dims[1] === 2400, 'tidied copy is 1800x2400, got ' + dims);
  await pg.click('#scorig'); ok((await pg.$eval('#scorig', e => e.textContent)) === 'Show tidied', 'original shown');
  await pg.waitForFunction(() => document.querySelector('#scimg').naturalWidth === 1600);
  // Retake from the page's own dialog replaces it
  const ch2 = pg.waitForEvent('filechooser', { timeout: 5000 });
  await pg.click('#scretake'); await ch2;
  await give('#scshot', 'p1b.jpg');
  await pg.waitForSelector('#screv:not([hidden])');
  await pg.click('#scok'); await pg.waitForFunction(() => document.querySelector('#scedit').hidden);
  await pg.waitForTimeout(500);
  ok((await pg.$$('#sclist figure')).length === 2, 'retake replaced page 1, did not add a third');
  await pg.reload(); await pg.waitForTimeout(800);
  await pg.goto('http://localhost:8080/prewarm/?demo#/scan'); await pg.waitForSelector('#scsub');
  await pg.fill('#scsub', 'DEMO-01');
  await pg.waitForSelector('#sclist figure');
  ok(JSON.stringify(await pg.$$eval('.scnum', e => e.map(x => x.textContent))) === '["1","4"]', 'pages kept after reload');
  ok(await pg.$eval('#scnum', s => s.value) === '2', 'offer is the first free number after a reload');

  // "Choose from photos" goes through the same crop step; Save tidied pages is offered
  ok(!(await pg.$eval('#scsave', e => e.hidden)), 'Save tidied pages offered');
  await give('#scpick', 'pick.jpg');
  await pg.waitForSelector('#screv:not([hidden])');
  await pg.click('#scok'); await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 3);
  // delete one
  await pg.click('[data-open]'); await pg.waitForSelector('dialog[open]'); await pg.click('#scdel'); await pg.waitForTimeout(300);
  ok((await pg.$$('#sclist figure')).length === 2, 'photo deleted');
  // press and hold selects; tap toggles; All / None / Cancel; Delete removes the picked ones
  const hold = async i => { const b = await (await pg.$$('#sclist img'))[i].boundingBox(); await pg.mouse.move(b.x + 20, b.y + 20); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up(); };
  const picked = () => pg.$$eval('#sclist figure.picked', e => e.length);
  ok(await pg.$eval('#scselbar', e => e.hidden), 'selection bar hidden at first');
  await hold(0); await pg.waitForTimeout(100);
  ok(!(await pg.$eval('#scselbar', e => e.hidden)) && await picked() === 1 && (await pg.$$('dialog[open]')).length === 0, 'press and hold starts selecting without opening the page');
  await pg.locator('#sclist figure img').nth(1).click(); ok(await picked() === 2, 'tap adds a photo');
  await pg.locator('#sclist figure img').nth(1).click(); ok(await picked() === 1, 'tap removes a photo');
  await pg.click('#scselnone'); ok(await picked() === 0 && await pg.$eval('#scseldel', e => e.disabled), 'None clears; Delete disabled');
  await pg.click('#scselall'); ok(await picked() === 2, 'All picks every photo');
  await pg.click('#scselcancel'); ok(await pg.$eval('#scselbar', e => e.hidden) && await picked() === 0, 'Cancel leaves selecting');
  await hold(0); refuse = true; await pg.click('#scseldel'); await pg.waitForTimeout(200);
  ok((await pg.$$('#sclist figure')).length === 2, 'declining the question deletes nothing');
  await pg.click('#scseldel'); await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 1);
  ok(await pg.$eval('#scselbar', e => e.hidden), 'bar closes after deleting');
  await give('#scpick', 'pick.jpg');
  await pg.waitForSelector('#screv:not([hidden])');
  await pg.click('#scok'); await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 2);

  // sending: only on the real address (here: localhost with ?scantest), Access and the study computer stood in for
  await pg.goto('http://localhost:8080/prewarm/?demo#/scan'); await pg.waitForSelector('#scsub');
  await pg.fill('#scsub', 'DEMO-01');
  ok(await pg.$eval('#scsend', e => e.hidden), 'no Send button in demo mode');
  ok(await pg.$eval('#scsign', e => e.hidden) && await pg.$eval('#scautosendlbl', e => e.hidden), 'no sign-in note or auto-send switch in demo mode');
  const sent = [], others = [];
  let signedIn = false, failPage = '', status = null;
  await pg.route('**/scan-api/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    if (u.pathname.endsWith('/whoami')) return signedIn ? route.fulfill({ json: { email: 'member@example.com' } }) : route.fulfill({ status: 302, headers: { Location: 'https://team.cloudflareaccess.com/login' } });
    if (u.pathname.includes('/status/')) return status ? route.fulfill({ json: { scan: u.pathname.split('/').pop(), ...status } }) : route.fulfill({ status: 404, json: { error: 'No such scan.' } });
    if (failPage && u.pathname.endsWith('/' + failPage)) return route.fulfill({ status: 500, json: { error: 'the study computer is busy' } });
    if (rq.headers()['x-scan-subject'] === 'DEMO-02') sent.push(u.pathname); else others.push(u.pathname);
    return route.fulfill({ json: { ok: true, pages: ['1'] } });
  });
  await pg.goto('http://localhost:8080/prewarm/?demo&scantest#/scan'); await pg.waitForSelector('#scsub');
  await pg.waitForSelector('#scsign:not([hidden])');
  ok(true, 'the sign-in note shows as the screen opens, before any photo');
  await pg.fill('#scsub', 'DEMO-02');
  ok(await pg.isChecked('#scautosend'), 'send each page when ready: on by default');
  const addPage = async () => { await give('#scpick', 'x.jpg'); await pg.waitForSelector('#screv:not([hidden])'); await pg.click('#scok'); await pg.waitForFunction(() => document.querySelector('#scedit').hidden); await pg.waitForTimeout(400); };
  const stateOf = l => pg.$$eval('#sclist figure', (fs, l) => fs.find(f => f.querySelector('.scnum').textContent === l)?.querySelector('.scst')?.textContent || '', l);
  await addPage();
  await pg.waitForFunction(() => /sign in first/.test(document.querySelector('#scmsg').textContent));
  ok(sent.length === 0, 'nothing uploaded while signed out');
  ok(await stateOf('1') === 'On phone', 'page 1 waits on the phone: ' + await stateOf('1'));
  signedIn = true;
  await pg.click('#scsignchk');
  await pg.waitForFunction(() => document.querySelectorAll('.scsent').length === 1);
  ok(await pg.$eval('#scsign', e => e.hidden), 'sign-in note gone once signed in');
  ok(sent.length === 1 && sent[0].endsWith('/1'), 'page 1 sent by itself with the Subject ID: ' + sent);
  ok(others.length === 2 && new Set(others.map(p => p.split('/')[3])).size === 1 && others[0].split('/')[3] !== sent[0].split('/')[3], 'the earlier subject\'s unsent pages went too, under their own scan: ' + others);
  ok(await stateOf('1') === 'Sent', 'page 1 shows Sent');
  ok(await pg.$eval('#scup', e => e.hidden), 'no Send now button when nothing waits');
  failPage = '7';
  await pg.selectOption('#scnum', '7'); await addPage();
  await pg.waitForFunction(() => /Not sent/.test(document.querySelector('#scmsg').textContent));
  ok(/the study computer is busy/.test(await pg.textContent('#scmsg')), 'the failure reason is shown');
  ok((await pg.$$('[data-retry]')).length === 1 && await pg.$eval('[data-retry]', b => b.closest('figure').querySelector('.scnum').textContent) === '7', 'Retry only on page 7');
  ok(/Send now \(1 waiting\)/.test(await pg.textContent('#scup')), 'Send now names what waits');
  failPage = '';
  // the study computer has read both: page 1 gave 12 values (2 flagged); the photo sent as page 7 is really page 8
  status = { pages: ['1', '7'], state: 'read', page: { 1: { state: 'read', page: 1, values: 12, flagged: 2 }, 7: { state: 'read', page: 8, values: 3, flagged: 0 } } };
  await pg.click('[data-retry]');
  await pg.waitForFunction(() => document.querySelectorAll('.scsent').length === 2);
  ok(sent.length === 2 && new Set(sent.map(p => p.split('/')[3])).size === 1, 'both pages sent under one scan id: ' + sent);
  ok(!(await pg.$('[data-retry]')), 'no Retry once sent');
  await pg.waitForFunction(() => [...document.querySelectorAll('#sclist .scnum')].some(b => b.textContent === '8'));
  ok(await stateOf('1') === 'Read · 12 · 2 flags', 'page 1 read, with its counts: ' + await stateOf('1'));
  ok(/was 7/.test(await stateOf('8')) && !(await stateOf('7')), 'the page moved to slot 8 and says it was 7');
  ok(/matched the photo sent as page 7 to page 8/.test(await pg.textContent('#scburstmsg')), 'the move is said in words');
  ok(/2 sent · 2 read/.test(await pg.textContent('#scprog')), 'progress counts sent and read: ' + await pg.textContent('#scprog'));
  // a retake request: one tap on the slot's Retake goes straight to the camera for that page, and the new photo is sent
  status = { pages: ['1', '7'], state: 'read', page: { 1: { state: 'retake', page: 1, why: 'Did not line up with the form (score 0.41).' }, 7: { state: 'read', page: 8, values: 3, flagged: 0 } } };
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pg.waitForSelector('[data-retake]');
  ok(/Did not line up/.test(await pg.getAttribute('[data-retake]', 'aria-label')), 'the Retake button says why');
  status.page[1] = { state: 'received' }; // what the study computer says once the new photo is in
  await pg.click('[data-retake]');
  await give('#scshot', 'retake.jpg');
  await pg.waitForSelector('#screv:not([hidden])'); await pg.click('#scok');
  await pg.waitForFunction(() => document.querySelectorAll('.scsent').length === 2 && !document.querySelector('[data-retake]'));
  ok(sent.length === 3 && sent[2].endsWith('/1') && sent[2].split('/')[3] === sent[0].split('/')[3], 'the retake went to page 1 of the same scan: ' + sent);
  // both approved: safe to clear, and clearing empties the phone
  // (checked before the approved status is served: a quick poll would otherwise take the keep note away first)
  await pg.waitForFunction(() => !document.querySelector('#scclear').hidden, null, { timeout: 5000 }).catch(() => {});
  ok(!(await pg.$eval('#scclear', e => e.hidden)) && /keep them until the import is approved/.test(await pg.textContent('#scclearmsg')), 'all on the study computer: safe to clear, with the keep note');
  status = { pages: ['1', '7'], state: 'approved', page: { 1: { state: 'approved', page: 1 }, 7: { state: 'approved', page: 8 } } };
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pg.waitForFunction(() => [...document.querySelectorAll('.scst')].every(e => e.textContent.startsWith('Approved')));
  ok(await stateOf('1') === 'Approved', 'approved shows on the slot');
  ok(/safe to clear/.test(await pg.textContent('#scclearmsg')) && !/keep them/.test(await pg.textContent('#scclearmsg')), 'safe to clear, no keep note once approved');
  await pg.click('#scclearbtn');
  await pg.waitForFunction(() => !document.querySelectorAll('#sclist figure').length);
  ok(await pg.$eval('#scclear', e => e.hidden), 'nothing left to clear');

  // approving a scan import (admin screen mounted with a stand-in cloud and one demo patient; fake values only)
  await pg.goto('http://localhost:8080/prewarm/?demo#/settings'); await pg.waitForTimeout(500);
  const res = await pg.evaluate(async () => {
    const m = await import('./js/scan-imports.js');
    const div = document.createElement('div'); div.id = 'siview'; document.body.append(div);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const saved = [], reviewed = [], asked = [];
    const imp = { id: 'scan1', scan: 'scan1', subject: 's-01', status: 'pending', createdAt: Date.now(), pages: [],
      fields: { age: { v: '67', flags: [], page: 1, box: { x: 0.1, y: 0.2, w: 0.2, h: 0.03 } }, pw_gown: { v: '07:05', flags: ['hard to read'], page: 2, box: { x: 0.1, y: 0.5, w: 0.2, h: 0.03 } },
        wt: { v: '70', flags: [], page: 1, box: { x: 0.4, y: 0.2, w: 0.2, h: 0.03 } } } };
    const other = { id: 'scan2', scan: 'scan2', subject: 'S-99', status: 'pending', createdAt: Date.now() - 1000, pages: [], fields: { age: { v: '50', flags: [] } } };
    const cloud = { scanImports: async () => [imp, other], reviewScanImport: async (id, st) => { reviewed.push([id, st]); }, friendly: e => String(e) };
    const pt = { id: 'p1', site: 'NUH', f: { enrol_id: { v: 'S-01' }, wt: { v: 65 } } }, pt2 = { id: 'p2', site: 'NTF', f: { enrol_id: { v: 'S-02' } } };
    const c = document.createElement('canvas'); c.width = 180; c.height = 240; c.getContext('2d').fillRect(0, 0, 180, 240);
    const page1 = await new Promise(r => c.toBlob(r, 'image/jpeg'));
    const photo = async (scan, subject, page) => { asked.push([scan, subject, page]); return page === 1 ? page1 : null; };
    window.confirm = () => true;
    m.mount({ view: div, esc, toast() {}, cloud, patients: () => ({ p1: pt, p2: pt2 }), sid: p => p.f.enrol_id.v, val: (p, id) => p.f[id]?.v ?? null, setField: (p, id, v) => saved.push([p.id, id, v]), photo });
    const wait = (n = 50) => new Promise(r => setTimeout(r, n));
    await wait();
    const out = { groups: [...div.querySelectorAll('.sigrp h3')].map(h => h.textContent) };
    div.querySelector('[data-open="scan1"]').click(); await wait(300);
    out.approveEnabled = !div.querySelector('#siok').disabled;
    out.patient = /Patient S-01/.test(div.querySelector('.sipt').textContent.replace(/\s+/g, ' '));
    out.noDropdown = !div.querySelector('select');
    out.pages = [...div.querySelectorAll('.sipage h3')].map(h => h.textContent);
    out.shown = [...div.querySelectorAll('.sipage > ul .sihead b')].map(b => b.textContent);
    out.folded = [...div.querySelectorAll('.sifine .sihead b')].map(b => b.textContent);
    out.cmp = [...div.querySelectorAll('.sicmp > span')].map(e => [...e.children].map(x => x.textContent).join(' ')).join(' / ');
    out.crops = div.querySelectorAll('.sicrop canvas').length;
    out.noPhoto = [...div.querySelectorAll('.sicrop')].filter(e => /only on the phone that scanned it/.test(e.textContent)).length;
    out.asked = JSON.stringify(asked);
    div.querySelector('#sinext').click(); await wait();
    out.next1 = [div.querySelector('.sirow.on .sihead b')?.textContent, div.querySelector('#sinext').textContent];
    div.querySelector('#sinext').click(); await wait();
    out.next2 = div.querySelector('.sirow.on .sihead b')?.textContent;
    const wt = [...div.querySelectorAll('.sirow')].find(li => li.querySelector('.sihead b').textContent === 'Weight');
    const inp = wt.querySelector('[data-val]'); inp.value = '72'; inp.dispatchEvent(new Event('input'));
    out.ticked = wt.querySelector('[data-use]').checked;
    out.read = wt.querySelector('.siread').textContent;
    out.ticks = [...div.querySelectorAll('[data-use]')].map(c => c.checked);
    div.querySelector('#siok').click(); await wait();
    // no patient with the Subject ID sent: find one by typing, no dropdown
    div.querySelector('[data-open="scan2"]').click(); await wait(100);
    out.noMatch = /No patient with Subject ID S-99/.test(div.textContent) && div.querySelector('#siok').disabled;
    const f = div.querySelector('#sifind'); f.value = 's-02'; f.dispatchEvent(new Event('input')); await wait();
    out.found = [...div.querySelectorAll('[data-pid]')].map(b => b.dataset.pid);
    div.querySelector('[data-pid="p2"]').click(); await wait();
    out.picked = !div.querySelector('#siok').disabled && /Patient S-02/.test(div.querySelector('.sipt').textContent.replace(/\s+/g, ' '));
    return { ...out, saved, reviewed };
  });
  ok(JSON.stringify(res.groups) === '["s-01","S-99"]', 'imports grouped by Subject ID: ' + res.groups);
  ok(res.approveEnabled && res.patient && res.noDropdown, 'the patient is picked from the Subject ID sent, no dropdown');
  ok(JSON.stringify(res.pages) === '["Page 1","Page 2"]', 'grouped by form page: ' + res.pages);
  ok(JSON.stringify(res.shown) === '["Weight","Gown put on"]' && JSON.stringify(res.folded) === '["Age"]', 'to check shown, the rest folded: ' + res.shown + ' / ' + res.folded);
  ok(res.cmp === 'Now saved 65 / Scanned 70', 'now saved beside scanned: ' + res.cmp);
  ok(res.crops === 2 && res.noPhoto === 1, `photo crops from this phone's page 1, a note for page 2: ${res.crops} ${res.noPhoto}`);
  ok(res.asked === '[["scan1","s-01",1],["scan1","s-01",2]]', 'asked the phone for each page once: ' + res.asked);
  ok(res.next1[0] === 'Weight' && res.next1[1] === 'Next to check (1 of 2)' && res.next2 === 'Gown put on', 'Next to check walks the values to check: ' + res.next1 + ' ' + res.next2);
  ok(res.ticked && res.read === 'Scanner read: 70', 'an edit ticks the value and keeps the reading: ' + res.read);
  ok(JSON.stringify(res.ticks) === '[true,true,false]', 'the edited and the fine value ticked, flagged unticked (screen order): ' + res.ticks);
  ok(JSON.stringify(res.saved) === '[["p1","age",67],["p1","wt",72]]', 'only ticked values saved, the edit as typed: ' + JSON.stringify(res.saved));
  ok(JSON.stringify(res.reviewed) === '[["scan1","approved"]]', 'the import is marked approved');
  ok(res.noMatch && JSON.stringify(res.found) === '["p2"]' && res.picked, 'no match: find the patient by typing: ' + res.found);
} catch (e) { fails.push('error: ' + e.message.split('\n')[0]); }
await b.close();
console.log(fails.length ? 'FAIL scan e2e:\n' + fails.join('\n') : 'scan e2e passed');
process.exit(fails.length ? 1 : 0);
