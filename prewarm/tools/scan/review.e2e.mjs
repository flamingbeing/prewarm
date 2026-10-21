// Browser test of review.html at phone size with axe. From the repo root, with a static server on 8080
// (python3 -m http.server 8080):  node prewarm/tools/scan/review.e2e.mjs <scan.json> [saved.reviewed.json]
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const [scanPath, savePath = '/tmp/saved.reviewed.json'] = process.argv.slice(2);
const AXE = new URL('../../../tools/vendor/axe.min.js', import.meta.url).pathname;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto(`http://localhost:${process.env.PORT || 8080}/prewarm/tools/scan/review.html`);
assert.equal(await page.locator('#app').isHidden(), true);
await page.setInputFiles('#file', scanPath);
await page.waitForSelector('.row');
const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
const flagged = Object.entries(scan.fields).filter(([, e]) => e.flags.length).length;
assert.ok(flagged > 0, 'the test scan has flagged fields');
// flagged rows come first
const firstFlags = await page.$$eval('.row', rs => rs.map(r => r.classList.contains('flag')));
assert.deepEqual(firstFlags, [...firstFlags].sort((a, c) => c - a), 'flagged rows sorted first');
assert.equal(await page.locator('#save').isDisabled(), true, 'nothing to save before anything is confirmed');
// axe
await page.addScriptTag({ path: AXE });
const axe = await page.evaluate(() => axe.run());
assert.deepEqual(axe.violations.map(v => v.id + ': ' + v.nodes.map(n => n.html.slice(0, 90)).join(' / ')), [], 'axe violations');
// fix the first flagged text row and confirm it with Enter; then confirm one more by button
const first = page.locator('.row.flag input[type=text]').first();
await first.fill('36.5'); await first.press('Enter');
assert.match(await page.locator('#count').textContent(), /^1 of /);
assert.equal(await page.locator('#save').isEnabled(), true);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
await dl.saveAs(savePath);
const saved = JSON.parse(fs.readFileSync(savePath, 'utf8'));
assert.deepEqual(Object.values(saved.fields), ['36.5'], 'only the confirmed value is saved');
assert.deepEqual(errs, [], 'no console errors');
console.log('review.html: ok');
await b.close();
