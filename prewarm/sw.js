// Offline app shell for the prewarming study app, on the shared update module (app-sync's update core 1.5.1: sw-core.js does the
// work; its README has the rules). The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs); keep them plain
// here ('prewarm-vN', {}). Change the vN only when this file's own logic changes.
// - Install: every SHELL file or nothing (flaky hospital wifi: the phone keeps the old complete copy instead of an
//   update with a hole in it), only changed files fetched. A new version takes over at once and the open page
//   reloads once, when nothing is open or sending (js/app.js registers through register.js with canReload).
// - Activate: deletes only this app's old caches ('prewarm-*'; 'prewarm-rt-*' are kept).
// - Fetch: SHELL files and pages cache-first (pages keyed by the folder, './'); the app's other
//   files once fetched (refreshed in the background); the Firebase SDK (versioned) once fetched. Never cached: the
//   scan upload (/scan-api/), Cloudflare Access (/cdn-cgi/) and Firebase sign-in (/__/) steps, the update helper
//   (update.html), sw.js itself, and Firebase traffic.

const VERSION = 'prewarm-v86';
const SHELL = [
  './', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/ui-core.js', 'js/ui-sync.js', 'js/series.js', 'js/ui-home.js', 'js/ui-patient.js', 'js/ui-alerts.js', 'js/ui-data.js', 'js/ui-forms.js',
  'js/ui-word.js', 'js/ui-pay.js', 'js/ui-settings.js', 'js/ui-share.js', 'js/ui-admin.js', 'js/ui-export.js',
  'js/keypad.js', 'js/schema.js', 'js/headers.js', 'js/store.js', 'js/xlsx.js', 'js/export.js', 'js/cloud.js', 'js/firebase-config.js', 'js/vendor/qrcode.js',
  'js/docx-fill.js', 'js/wordform.js', 'js/wordview.js', 'js/scan.js', 'js/scan-geom.js', 'js/scan-imports.js', 'js/scan-phone.js', 'js/scan-read.js', 'js/scan-read-worker.js', 'js/scan-align.js', 'js/scan-crop.js', 'js/scan-checks.js', 'js/pay.js', 'js/sync-rules.js', 'js/vendor/jszip.min.js', 'js/vendor/docx-preview.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  // the app kit (app-ui: early.js, the theme CSS and the Look switch with its imports), one exact version: without it the app opens unstyled offline
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/early.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/theme.css',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/index.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/choice.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/colour.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/grid.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/guard.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/motion.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/palette-css.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/presets.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/schema.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/switch.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks/a.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks/b.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks/c.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks/d.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/theme/looks/e.js',
  'https://core.anawj.com/ui/1.0.0-rc.42/ui/tab-back.js',
  // the sync engine (app-sync: index.js and the app, auth and sync modules), one exact version: without it nothing reaches the team
  'https://core.anawj.com/sync/1.5.1/index.js',
  'https://core.anawj.com/sync/1.5.1/src/cache.js',
  'https://core.anawj.com/sync/1.5.1/src/conflict.js',
  'https://core.anawj.com/sync/1.5.1/src/firestore.js',
  'https://core.anawj.com/sync/1.5.1/src/forget.js',
  'https://core.anawj.com/sync/1.5.1/src/outbox.js',
  'https://core.anawj.com/sync/1.5.1/src/persist.js',
  'https://core.anawj.com/sync/1.5.1/src/registry.js',
  'https://core.anawj.com/sync/1.5.1/src/replace.js',
  'https://core.anawj.com/sync/1.5.1/src/report.js',
  'https://core.anawj.com/sync/1.5.1/src/status.js',
  'https://core.anawj.com/sync/1.5.1/src/store.js',
  'https://core.anawj.com/sync/1.5.1/src/sync.js',
  'https://core.anawj.com/sync/1.5.1/src/user.js',
  'https://core.anawj.com/sync/1.5.1/src/watchdog.js',
  'https://core.anawj.com/sync/1.5.1/src/writes.js',
  'https://core.anawj.com/sync/1.5.1/app.js',
  'https://core.anawj.com/sync/1.5.1/src/runner.js',
  'https://core.anawj.com/sync/1.5.1/auth.js',
  'https://core.anawj.com/sync/1.5.1/src/auth.js',
  'https://core.anawj.com/sync/1.5.1/src/signin/anonymous.js',
  'https://core.anawj.com/sync/1.5.1/src/signin/email-link.js',
  'https://core.anawj.com/sync/1.5.1/src/signin/passcode.js',
  'https://core.anawj.com/sync/1.5.1/src/signin/password.js',
  'https://core.anawj.com/sync/1.5.1/src/core.js',
  'https://core.anawj.com/sync/1.5.1/src/kinds.js',
  'https://core.anawj.com/sync/1.5.1/src/module-sync.js',
  'https://core.anawj.com/sync/1.5.1/src/view.js',
  'https://core.anawj.com/sync/1.5.1/sync.js',
  // the page side of app-update (one exact version), so the app opens offline
  'https://core.anawj.com/update/1.5.1/register.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/1.5.1/sw-core.js');
AppUpdate.init({
  app: 'prewarm', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: ['/scan-api/', /\/update\.html$/, /\/sw\.js$/],
  runtime: [
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update|ui)\/\d+\.\d+\.\d+(-rc\.\d+)?\//, strategy: 'cache-first', max: 40 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|webmanifest|docx)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
