// Back with tabs (owner, 29 Oct 2026, as Android apps do it), demo mode, fake data only: moving between a patient's
// reading tabs and timepoints adds at most one Back step; Back on another tab goes to the tab the patient opened on, Back
// there goes back to the list; a form opened from a tab still closes first. Needs the site on :8080, like e2e.mjs, and
// core.anawj.com (app-ui's tabBack).
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch();
const fails = [];
const log = (ok, msg) => { if (!ok) fails.push(msg); };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => fails.push('page error: ' + e.message));
const len = () => pg.evaluate(() => history.length);
const tab = () => pg.getAttribute('.ptabs a[aria-selected="true"]', 'id').catch(() => null);
const back = async () => { await pg.goBack(); await pg.waitForTimeout(400); };
try {
  await pg.goto('http://localhost:8080/prewarm/?demo'); await pg.waitForTimeout(1200);
  // DEMO-01 is in pre-warming: it opens on the Induction room tab
  await pg.locator('a[href*="#/p/"]', { hasText: 'DEMO-01' }).first().click(); await pg.waitForSelector('#clock');
  const l0 = await len();
  log(await tab() === 'prewarmlink', 'opens on Induction room: ' + await tab());
  // tab A -> B -> C (and a timepoint on C): one Back step at most
  for (const t of ['iotemp', 'haemo', 'iotemp']) { await pg.click(`#${t}link`); await pg.waitForTimeout(300); log(await tab() === `${t}link`, `tapped ${t}: on ${await tab()}`); }
  const pt = pg.locator('.strip a:not(.on)').first();
  if (await pt.count()) { await pt.click(); await pg.waitForTimeout(300); }
  log(await len() <= l0 + 1, `tabs and timepoints add at most one Back step (${l0} -> ${await len()})`);
  // Back -> the first tab, Back -> the list
  await back();
  log(await tab() === 'prewarmlink' && /#\/p\/\w+(\/prewarm)?$/.test(pg.url()), 'Back on another tab goes to the first tab: ' + pg.url());
  await back();
  log(/#\/?$|\/prewarm\/\?demo$/.test(pg.url()) && !(await pg.$('#clock')), 'Back on the first tab leaves the patient: ' + pg.url());
  // tapping the first tab again takes the extra step away
  await pg.locator('a[href*="#/p/"]', { hasText: 'DEMO-01' }).first().click(); await pg.waitForSelector('#clock');
  await pg.click('#haemolink'); await pg.waitForTimeout(300); await pg.click('#prewarmlink'); await pg.waitForTimeout(500);
  log(await tab() === 'prewarmlink', 'tap back to the first tab: ' + await tab());
  await back();
  log(!(await pg.$('#clock')), 'after tapping back to the first tab, one Back leaves: ' + pg.url());
  // a form pushed from another tab closes first, then the first tab, then the list
  await pg.goForward(); await pg.waitForSelector('#clock');
  await pg.click('#haemolink'); await pg.waitForTimeout(300);
  await pg.click('a[href$="/form/intraop"]'); await pg.waitForTimeout(400);
  log(/\/form\/intraop$/.test(pg.url()) && await tab() !== 'haemolink', 'the form is open: ' + pg.url());
  await back(); log(await tab() === 'haemolink', 'Back closes the form first: ' + await tab());
  await back(); log(await tab() === 'prewarmlink', 'then the first tab: ' + await tab());
  await back(); log(!(await pg.$('#clock')), 'then the list: ' + pg.url());
} catch (e) { fails.push('error: ' + e.message.split('\n')[0]); }
await b.close();
if (fails.length) { console.log('prewarm back with tabs: FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('prewarm back with tabs: ok (tabs and timepoints add one Back step at most, Back to the first tab then out, tap to the first tab, a form closes first)');
