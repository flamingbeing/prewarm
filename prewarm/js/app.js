// Prewarming study: op-day screens. Data stays on this phone for now (localStorage); sharing comes with Firebase.
// Start-up: the screens (ui-*.js) register their routes as they load; then the move to the new address, the offline
// shell, and the first screen.
import { isGone } from './store.js';
import * as cloud from './cloud.js';
import { $, DEMO, NS, afterAsking, esc, leaveGuard, patients, render, settings, shared } from './ui-core.js';
import { pending, setSw, sharing } from './ui-sync.js';
import './series.js';
import './ui-home.js';
import './ui-patient.js';
import './ui-alerts.js';
import './ui-data.js';
import './ui-forms.js';
import './ui-word.js';
import './ui-pay.js';
import './ui-settings.js';
import './ui-share.js';
import './ui-admin.js';
import './ui-export.js';

// ---------- moving to prewarmstudy.anawj.com (owner, 13 Oct 2026)
// Phones keep their saved copy, unsent readings and sign-in per web address, so the old address (anawj.com/prewarm/) moves a
// phone to the new one only when nothing on it is waiting: every reading sent to the team, no half-entered reading, the new
// address reachable. Otherwise the app carries on as before and a bar says why it hasn't moved. It runs once when the app opens
// (never while someone is entering a reading), and a team phone carries its join code and initials in the address's `#` part,
// which never reaches a server, so it rejoins its team on the new address without anyone typing the code.
const NEW_HOME = 'https://prewarmstudy.anawj.com/';
const MOVE_TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? new URLSearchParams(location.search).get('oldhost') : null; // tests: pretend to be the old address
const ON_OLD_ADDRESS = window.top === window && (!!MOVE_TEST || ['anawj.com', 'www.anawj.com'].includes(location.hostname));
function moveBar(text, canTry) {
  const el = $('#moved'); if (!el) return;
  el.hidden = false;
  el.innerHTML = `<b>The study app has a new address: prewarmstudy.anawj.com.</b> ${esc(text)} ${canTry ? '<button class="link" id="movenow">Try again</button>' : ''}`;
  $('#movenow')?.addEventListener('click', () => moveCheck());
}
// why this phone can't move yet ('' when it can)
async function notReadyToMove() {
  if (DEMO) return '';
  const t0 = Date.now();
  while (cloud.enabled && document.body.dataset.cloud !== 'ready' && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 200));
  if (cloud.enabled && document.body.dataset.cloud !== 'ready') return 'It is still checking this phone’s team and readings.';
  if (Object.keys(localStorage).some(k => k.startsWith(NS + 'unsaved:'))) return 'A reading on this phone is half entered: save it, then it moves.';
  if (Object.keys(pending).length) return 'Some readings are still waiting to reach the team: it moves once they have.';
  if (!sharing() && Object.values(patients).some(p => !isGone(p))) return 'This phone holds patients that are not shared with a team, so it stays here. Export them first (Settings → Export).';
  if (cloud.enabled && !(await cloud.flushed(6000))) return 'Waiting for signal to send the last readings: it moves once they have gone.';
  if (!navigator.onLine) return 'No signal: it moves when the new address can be reached.';
  try { await fetch(new URL('sw.js', MOVE_TEST || NEW_HOME).href + '?' + Date.now(), { mode: 'no-cors', cache: 'no-store' }); } catch { return 'The new address can’t be reached from here yet.'; }
  return '';
}
async function moveCheck() {
  if (!ON_OLD_ADDRESS) return;
  let why = await notReadyToMove();
  if (why) return moveBar(why, true);
  // a team phone rejoins on the new address with its code (read from its own membership record) and initials
  let hash = location.hash, member = null;
  if (cloud.enabled && !DEMO && shared.member && !shared.admin) { try { member = await cloud.member(); } catch { member = null; } }
  if (member?.code && member.site) hash = `#/join/${member.site}/${encodeURIComponent(member.code)}${settings.me ? '/' + encodeURIComponent(settings.me) : ''}`;
  else if (shared.member && !shared.admin) return moveBar('It couldn’t read this phone’s team details yet.', true);
  const rest = location.pathname.replace(/^\/prewarm\/?/, '').replace(/^index\.html$/, '');
  const search = location.search.replace(/([?&])oldhost=[^&]*(&|$)/, (m, p1, p2) => (p2 ? p1 : '')).replace(/[?&]$/, ''); // the original query, untouched
  const base = MOVE_TEST ? new URL(MOVE_TEST, location.href) : new URL(NEW_HOME);
  location.replace(base.origin + (MOVE_TEST ? base.pathname : '/') + rest + search + hash);
}
if (ON_OLD_ADDRESS) setTimeout(moveCheck, 1500);

// ---------- offline shell and updates
if ('serviceWorker' in navigator && !DEMO) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // updating reloads the app: an unsaved reading on screen is asked about first
    // the waiting worker may have been replaced by a newer one since the banner showed (several updates in a row), so ask the
    // current one; if nothing takes over in 3 s (Firefox did not), clear the saved copy of the app (never the patients) and reload
    const offer = w => { const b = $('#update'); b.hidden = false; b.onclick = () => afterAsking(() => {
      b.hidden = true;
      (reg.waiting || w).postMessage('skipWaiting');
      setTimeout(async () => {
        if (reloaded || !navigator.onLine) return;
        // only wipe the saved copy if the network really answers now (14 Oct 2026): a phone whose signal dropped in these
        // 3 seconds would otherwise have no app at all offline
        try { if (!(await fetch('sw.js', { cache: 'no-store' })).ok) return; } catch { return; }
        try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) if (k.startsWith('prewarm-')) await caches.delete(k); } catch { /* reload anyway */ }
        location.reload();
      }, 3000);
    }); };
    setSw(reg, offer);
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    // a phone keeps the app open for hours, and the browser only looks for a new version when the page is opened:
    // look again when the app comes back to the front, when signal returns, and every 10 minutes (owner, 13 Oct 2026)
    const look = () => { if (document.visibilityState === 'hidden') return; reg.update().catch(() => {}); if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting); };
    document.addEventListener('visibilitychange', look);
    addEventListener('online', look);
    setInterval(look, 10 * 60e3);
    look();
  }).catch(() => {});
  // reload only when an update takes over, not when the first install claims the page (that wiped a half-filled form)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reload = () => { reloaded = true; location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    // another tab took the update while a reading is half-entered here: wait for a tap rather than lose it
    if (leaveGuard?.()) { const b = $('#update'); b.hidden = false; b.onclick = () => afterAsking(reload); }
    else reload();
  });
}

render();
