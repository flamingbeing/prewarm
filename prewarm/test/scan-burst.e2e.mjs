// Scan pages, several pages in a row and the 14-slot grid, in demo mode with a fake camera (fake image only): a burst over a
// page range with the live camera (waits for the sheet to change, turns an upside-down page upright, marks a blurry one Check),
// the grid's states, a taken slot's Retake / Choose from gallery / Delete / Adjust corners (a side and a corner snap back onto
// the paper), an empty slot taking just that page, the lighting style remembered, a burst with the phone's camera app and from
// the gallery. Needs the site served on :8080 like e2e.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import { fakeCamera } from './fake-camera.mjs';
const b = await chromium.launch();
const fails = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(fakeCamera);
const pg = await ctx.newPage();
pg.on('pageerror', e => fails.push('page error: ' + e.message));
pg.on('dialog', d => d.accept());
const ok = (c, m) => { if (!c) fails.push(m); };
const cam = (k, v) => pg.evaluate(([k, v]) => { window.__cam[k] = v; }, [k, v]);
const text = s => pg.textContent(s);
const pages = () => pg.evaluate(() => new Promise(ok => {
  const r = indexedDB.open('prewarm-scan'); r.onsuccess = () => { const q = r.result.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => ok(q.result.map(p => ({ id: p.id, label: p.label, needs: p.needs, flipped: !!p.flipped, mode: p.mode, corners: p.corners }))); };
}));
const byLabel = async l => (await pages()).find(p => p.label === l);
const labels = () => pg.$$eval('#sclist figure .scnum', e => e.map(x => x.textContent));
const settled = n => pg.waitForFunction(n => !document.querySelector('[data-tidy]') && document.querySelectorAll('#sclist figure').length === n, n, { timeout: 20000 });
const openPage = async l => { await pg.locator(`#sclist figure:has(.scnum:text-is("${l}")) img`).click(); await pg.waitForSelector('#scdlg[open]'); };
// a fake photo file (the 'page' scene as a still), for the gallery and the camera app
const photo = async () => Buffer.from(await pg.evaluate(async () => {
  const W = 1600, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#3a302a'; x.fillRect(0, 0, W, H);
  x.save(); x.beginPath(); x.moveTo(380, 120); x.lineTo(1180, 190); x.lineTo(1260, 1060); x.lineTo(300, 980); x.closePath(); x.clip();
  x.fillStyle = '#e8e8e2'; x.fillRect(0, 0, W, H); x.fillStyle = '#202020'; for (let i = 0; i < 9; i++) x.fillRect(420 + i * 8, 260 + i * 80, 600, 10); x.restore();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return [...new Uint8Array(await blob.arrayBuffer())];
}));
try {
  await pg.goto('http://localhost:8080/prewarm/?demo#/settings'); await pg.waitForTimeout(800);
  await pg.check('#scanon');
  await pg.click('a[href="#/scan"]');
  await pg.fill('#scsub', 'DEMO-03');
  const jpg = { name: 'page.jpg', mimeType: 'image/jpeg', buffer: await photo() };

  // the grid: 14 empty slots; several pages in a row is on, over a range
  ok((await pg.$$('#sclist [data-shoot]')).length === 14, 'fourteen empty slots');
  ok(/0 of 14 pages/.test(await text('#scprog')), 'progress line: ' + await text('#scprog'));
  ok(await pg.isChecked('#scburst') && await pg.isVisible('#scrange') && !(await pg.isVisible('#scnum')), 'burst on by default, with a range instead of one page number');
  ok(/Shoot pages 1 to 14/.test(await text('#scshottxt')), 'button names the range: ' + await text('#scshottxt'));
  await pg.selectOption('#scfrom', '3'); await pg.selectOption('#scto', '5');
  ok(/Shoot pages 3 to 5/.test(await text('#scshottxt')), 'range 3 to 5');

  // burst with the live camera: page 3, then it waits for the sheet to change
  await cam('scene', 'page');
  await pg.click('#scshotlbl');
  await pg.waitForSelector('#sclive:not([hidden])');
  ok(/Page 3 · 1 of 3/.test(await text('#sclivetitle')) && /Done/.test(await text('#sclivedone')), 'burst title: ' + await text('#sclivetitle'));
  await pg.waitForFunction(() => /Page 4 · 2 of 3/.test(document.querySelector('#sclivetitle').textContent), null, { timeout: 8000 });
  ok(await pg.isVisible('#sclive') && await pg.$eval('#scedit', e => e.hidden), 'camera stays open, no editor between pages');
  ok(/Page 3 taken\. Now page 4/.test(await text('#sccoach')), 'coach asks for the next sheet: ' + await text('#sccoach'));
  await pg.waitForTimeout(1500);
  ok(/Page 4 · 2 of 3/.test(await text('#sclivetitle')), 'the same sheet is not taken twice');
  // page 4: the sheet is swapped for a printed page lying upside down
  await cam('scene', 'none'); await pg.waitForTimeout(400); await cam('scene', 'upside');
  await pg.waitForFunction(() => /Page 5 · 3 of 3/.test(document.querySelector('#sclivetitle').textContent), null, { timeout: 8000 });
  // page 5: blurry; the burst ends after it
  await cam('scene', 'none'); await pg.waitForTimeout(400); await cam('blur', true); await cam('scene', 'page');
  await pg.waitForSelector('#sclive', { state: 'hidden', timeout: 10000 });
  await cam('blur', false);
  ok(/Burst done: pages 3 to 5/.test(await text('#scburstmsg')), 'burst done message: ' + await text('#scburstmsg'));
  ok(await pg.evaluate(() => window.__cam.tracks.every(t => t.readyState === 'ended')), 'camera off after the burst');
  await settled(3);
  ok(JSON.stringify(await labels()) === '["3","4","5"]', 'pages 3 to 5 in their slots: ' + await labels());
  const p4 = await byLabel('4'), p5 = await byLabel('5'), p3 = await byLabel('3');
  ok(p4?.flipped, 'upside-down page turned upright: ' + JSON.stringify(p4 && { flipped: p4.flipped }));
  ok(!p3?.flipped && !p3?.needs, 'page 3 fine as it was');
  ok(p5?.needs === 'blurry', 'blurry page marked: ' + p5?.needs);
  ok((await pg.$$('#sclist .scflag')).length === 1 && /3 of 14 pages · 1 to check/.test(await text('#scprog')), 'one Check badge: ' + await text('#scprog'));

  // a page that needs a look: says why; Looks right clears it
  await openPage('5');
  ok(/blurry/.test(await text('#scdlgwhy')) && await pg.isVisible('#scdlgok'), 'why it needs a look');
  ok(await pg.isVisible('#scretake') && await pg.isVisible('#scdel') && /Choose from gallery/.test(await text('#scdlg')), 'Retake, Choose from gallery, Delete offered');
  await pg.click('#scdlgok');
  await pg.waitForFunction(() => !document.querySelector('#sclist .scflag'));
  ok(!(await byLabel('5')).needs, 'page 5 checked');

  // Choose from gallery replaces page 3, only that page (no camera afterwards); the lighting style picked is remembered
  await openPage('3');
  ok(!(await pg.isVisible('#scdlgok')), 'no Looks right on a page that needs nothing');
  await pg.setInputFiles('#scgallery', jpg);
  await pg.waitForSelector('#scedit:not([hidden]) #screv:not([hidden])');
  ok(/Page 3/.test(await text('#sctitle')), 'gallery photo is page 3');
  await pg.click('[data-mode="color"]');
  await pg.click('#scok'); await pg.waitForSelector('#scedit', { state: 'hidden' });
  await pg.waitForTimeout(300);
  ok(await pg.$eval('#sclive', e => e.hidden), 'no camera after replacing one page');
  await settled(3); await pg.waitForTimeout(300);
  const p3b = await byLabel('3');
  ok(p3b && p3b.id !== p3.id && (await pages()).length === 3, 'page 3 replaced, not added');

  // an empty slot takes just that page (here: one page at a time, live camera), in the remembered style
  await pg.click('#sclist [data-shoot="7"]');
  await pg.waitForSelector('#sclive:not([hidden])');
  ok(/^Page 7$/.test(await text('#sclivetitle')) && /Close/.test(await text('#sclivedone')), 'empty slot: page 7 alone: ' + await text('#sclivetitle'));
  await pg.waitForSelector('#scedit:not([hidden]) #screv:not([hidden])', { timeout: 8000 });
  ok(await pg.$eval('[data-mode="color"]', b => b.getAttribute('aria-pressed')) === 'true', 'lighting style remembered (Colour)');
  await pg.click('[data-mode="auto"]');
  await pg.click('#scok'); await pg.waitForSelector('#scedit', { state: 'hidden' }); await pg.waitForTimeout(300);
  ok(await pg.$eval('#sclive', e => e.hidden), 'no camera after the one page');
  await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 4);
  ok(JSON.stringify(await labels()) === '["3","4","5","7"]', 'page 7 in its slot');

  // Retake a taken page from its slot: the live camera for that page only, and it replaces it
  const p7 = await byLabel('7');
  await openPage('7'); await pg.click('#scretake');
  await pg.waitForSelector('#sclive:not([hidden])');
  ok(/^Page 7$/.test(await text('#sclivetitle')), 'retake is page 7');
  await pg.waitForSelector('#scedit:not([hidden]) #screv:not([hidden])', { timeout: 8000 });
  await pg.click('#scok'); await pg.waitForSelector('#scedit', { state: 'hidden' }); await pg.waitForTimeout(400);
  ok((await pages()).length === 4 && (await byLabel('7')).id !== p7.id, 'retake replaced page 7');

  // Adjust corners: the crop step on the original; a side and a corner dragged a little off the paper snap back onto it
  const before = (await byLabel('7')).corners;
  await openPage('7'); await pg.click('#scadjust');
  await pg.waitForSelector('#scedit:not([hidden]) #sccrop:not([hidden])');
  ok(!(await pg.$('#scdlg[open]')), 'the page dialog closed before the editor opened');
  const box = await pg.$eval('#sccrop', c => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const at = p => [box[0] + p.x * box[2], box[1] + p.y * box[3]];
  const drag = async (from, dx, dy) => { await pg.mouse.move(...from); await pg.mouse.down(); await pg.mouse.move(from[0] + dx, from[1] + dy, { steps: 4 }); await pg.mouse.up(); };
  const top = at({ x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 });
  await drag(top, 0, 7); // the top side's handle, 7 px down
  await drag(at(before[2]), -6, -5); // the bottom-right corner, off the paper
  await pg.click('#scflat'); await pg.waitForSelector('#screv:not([hidden])');
  ok(/Step 2 of 2/.test(await text('#scstep')), 'after the corners: step 2 of 2');
  await pg.click('#scok'); await pg.waitForSelector('#scedit', { state: 'hidden' }); await pg.waitForTimeout(500);
  const after = (await byLabel('7')).corners, moved = after.map((p, i) => Math.hypot((p.x - before[i].x) * 1600, (p.y - before[i].y) * 1200));
  ok(moved.every(d => d < 12), 'side and corner snapped back onto the paper (photo px moved: ' + moved.map(Math.round) + ')');

  // Delete from the slot: the slot is empty again
  await openPage('7'); await pg.click('#scdel');
  await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 3);
  ok(await pg.$('#sclist [data-shoot="7"]'), 'slot 7 empty again');

  // a burst with the phone's camera app: each tap takes the next page of the range
  await pg.check('#sccamapp');
  await pg.selectOption('#scfrom', '9'); await pg.selectOption('#scto', '10');
  let ch = pg.waitForEvent('filechooser'); await pg.click('#scshotlbl'); await (await ch).setFiles(jpg);
  await pg.waitForFunction(() => /Take page 10 \(2 of 2\)/.test(document.querySelector('#scshottxt').textContent));
  ok(await pg.isVisible('#scstop'), 'Stop the burst offered while it runs');
  ch = pg.waitForEvent('filechooser'); await pg.click('#scshotlbl'); await (await ch).setFiles(jpg);
  await pg.waitForFunction(() => /Burst done: pages 9 to 10/.test(document.querySelector('#scburstmsg').textContent));
  await settled(5);
  ok(JSON.stringify(await labels()) === '["3","4","5","9","10"]', 'camera app burst: pages 9 and 10: ' + await labels());
  ok(!(await pg.isVisible('#scstop')) && /Shoot pages 9 to 10/.test(await text('#scshottxt')), 'burst over: button back to the range');
  ok(/Pages 9, 10 already have photos/.test(await text('#scrangenote')), 'range over taken pages says they will be replaced');

  // a burst from the gallery: the range's numbers in the order picked; extra photos left out, with a note
  await pg.selectOption('#scfrom', '12'); await pg.selectOption('#scto', '13');
  await pg.setInputFiles('#scpick', [jpg, { ...jpg, name: 'b.jpg' }, { ...jpg, name: 'c.jpg' }]);
  await settled(7);
  ok(JSON.stringify(await labels()) === '["3","4","5","9","10","12","13"]', 'gallery burst: pages 12 and 13: ' + await labels());
  ok(/1 more photo was left out/.test(await text('#scburstmsg')), 'extra photo noted: ' + await text('#scburstmsg'));

  // kept after a reload; the burst switch is remembered on this phone
  await pg.uncheck('#scburst');
  await pg.reload(); await pg.waitForSelector('#scsub'); await pg.fill('#scsub', 'DEMO-03');
  await pg.waitForFunction(() => document.querySelectorAll('#sclist figure').length === 7);
  ok(!(await pg.isChecked('#scburst')) && /Take page 1/.test(await text('#scshottxt')), 'burst off remembered; one page at a time');
} catch (e) { fails.push('crashed: ' + e.message.split('\n')[0]); }
await b.close();
if (fails.length) { console.error('scan burst e2e FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('scan burst e2e passed');
