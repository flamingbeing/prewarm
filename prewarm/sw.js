// Offline app shell for the prewarming study app (copied from evals/sw.js). Bump VERSION whenever any shell file
// changes: the new worker installs alongside the old one and the app offers "Update available".
// Firebase (added with sharing) will always go to the network; its SDK files are cached here.

const VERSION = 'prewarm-v80';
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SDK_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => SDK + f);
// the design kit (tokens.css) comes from another host since the repo split (21 Oct 2026): listed in SHELL by full address
// and answered from the cache below, so the app keeps its look offline
const KIT = 'https://design.anawj.com/v1/';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'https://design.anawj.com/v1/tokens.css',
  'js/app.js', 'js/ui-core.js', 'js/ui-sync.js', 'js/series.js', 'js/ui-home.js', 'js/ui-patient.js', 'js/ui-alerts.js', 'js/ui-data.js', 'js/ui-forms.js',
  'js/ui-word.js', 'js/ui-pay.js', 'js/ui-settings.js', 'js/ui-share.js', 'js/ui-admin.js', 'js/ui-export.js',
  'js/keypad.js', 'js/schema.js', 'js/headers.js', 'js/store.js', 'js/xlsx.js', 'js/export.js', 'js/cloud.js', 'js/firebase-config.js', 'js/vendor/qrcode.js',
  'js/docx-fill.js', 'js/wordform.js', 'js/wordview.js', 'js/scan.js', 'js/scan-geom.js', 'js/scan-imports.js', 'js/pay.js', 'js/vendor/jszip.min.js', 'js/vendor/docx-preview.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  // all-or-nothing for the app's own files (14 Oct 2026): if one fails to download (flaky hospital wifi) the install fails,
  // the browser tries again later, and the phone keeps the old complete copy instead of an update with a hole in it.
  // The Firebase SDK files are fetched from Google and stay optional.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all([
    ...SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))),
    ...SDK_FILES.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})),
  ])));
});

// The page asks a waiting worker to take over when the user taps "Reload".
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // only this app's caches: other apps on the same origin keeps its own
    for (const k of await caches.keys()) if (k.startsWith('prewarm-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

const NEVER = /(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com)$/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url.startsWith(SDK)) {
    // cache first: the URL carries the version
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(req.url)) || fetch(req).then(res => {
      if (res.ok) c.put(req.url, res.clone());
      return res;
    })));
    return;
  }
  if (req.url.startsWith(KIT)) {
    // the page asks for it without CORS, the install saved it with CORS: match by address only
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(url.href, { ignoreSearch: true })) || fetch(req)));
    return;
  }
  if (url.origin !== self.location.origin || NEVER.test(url.hostname)) return;
  if (url.pathname.includes('/__/')) return; // Firebase auth helper pages
  // the scan upload and Cloudflare Access's sign-in steps (/cdn-cgi/access/...: its return page was shown as the app's home
  // page by the saved shell): always the network, never saved
  if (url.pathname.startsWith('/scan-api/') || url.pathname.startsWith('/cdn-cgi/')) return;
  if (url.pathname.endsWith('/update.html')) return; // the update helper must come from the network, not the saved shell
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // navigations: the cached shell, whatever the query (?demo) or hash
    // (keyed by the folder, './': Cloudflare previews answer 'index.html' with a redirect to the folder, and a cached
    // redirect can't be served for a navigation, so reloading failed there; GitHub Pages serves both directly)
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    } catch (err) {
      const shell = req.mode === 'navigate' && await cache.match('./');
      if (shell) return shell;
      throw err;
    }
  })());
});
