// Offline app shell for the prewarming study app, on the shared update module (app-update 0.1.0: sw-core.js does the
// work; its README has the rules). The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs); keep them plain
// here ('prewarm-vN', {}). Change the vN only when this file's own logic changes.
// - Install: every SHELL file or nothing (flaky hospital wifi: the phone keeps the old complete copy instead of an
//   update with a hole in it), only changed files fetched. A new version takes over at once and the open page
//   reloads once (js/app.js registers through register.js).
// - Activate: deletes only this app's old caches ('prewarm-*'; 'prewarm-rt-*' are kept).
// - Fetch: SHELL files and pages cache-first (pages keyed by the folder, './'); the design kit and the app's other
//   files once fetched (refreshed in the background); the Firebase SDK (versioned) once fetched. Never cached: the
//   scan upload (/scan-api/), Cloudflare Access (/cdn-cgi/) and Firebase sign-in (/__/) steps, the update helper
//   (update.html), sw.js itself, and Firebase traffic.

const VERSION = 'prewarm-v82';
const SHELL = [
  './', 'style.css', 'manifest.webmanifest', 'https://design.anawj.com/v1/tokens.css',
  'js/app.js', 'js/ui-core.js', 'js/ui-sync.js', 'js/series.js', 'js/ui-home.js', 'js/ui-patient.js', 'js/ui-alerts.js', 'js/ui-data.js', 'js/ui-forms.js',
  'js/ui-word.js', 'js/ui-pay.js', 'js/ui-settings.js', 'js/ui-share.js', 'js/ui-admin.js', 'js/ui-export.js',
  'js/keypad.js', 'js/schema.js', 'js/headers.js', 'js/store.js', 'js/xlsx.js', 'js/export.js', 'js/cloud.js', 'js/firebase-config.js', 'js/vendor/qrcode.js',
  'js/docx-fill.js', 'js/wordform.js', 'js/wordview.js', 'js/scan.js', 'js/scan-geom.js', 'js/scan-imports.js', 'js/pay.js', 'js/vendor/jszip.min.js', 'js/vendor/docx-preview.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  // the sync engine (app-sync), one exact version: without it nothing reaches the team
  'https://core.anawj.com/sync/0.2.0/index.js',
  'https://core.anawj.com/sync/0.2.0/src/sync.js',
  'https://core.anawj.com/sync/0.2.0/src/writes.js',
  'https://core.anawj.com/sync/0.2.0/src/conflict.js',
  'https://core.anawj.com/sync/0.2.0/src/store.js',
  'https://core.anawj.com/sync/0.2.0/src/outbox.js',
  'https://core.anawj.com/sync/0.2.0/src/watchdog.js',
  'https://core.anawj.com/sync/0.2.0/src/persist.js',
  'https://core.anawj.com/sync/0.2.0/src/status.js',
  'https://core.anawj.com/sync/0.2.0/src/firestore.js',
  // the page side of app-update (one exact version), so the app opens offline
  'https://core.anawj.com/update/0.1.0/register.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/0.1.0/sw-core.js');
AppUpdate.init({
  app: 'prewarm', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: ['/scan-api/', /\/update\.html$/, /\/sw\.js$/],
  runtime: [
    { name: 'kit', match: 'https://design.anawj.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|webmanifest|docx)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
