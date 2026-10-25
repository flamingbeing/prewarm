# Status

## Now
- Patients sync through app-sync 0.6.0 `createApp` since 25 Oct 2026 (the engine wiring in `js/cloud.js` is now
  config: same outbox and device-copy names, the lock's leave entry through `backend.onCommit`); log out still runs
  `forgetDevice` on createApp's parts (the screen warns about unsent saves first).
- Nothing-lost report on (app-sync 0.5.0, 25 Oct 2026): counts only, hourly at most, to core.anawj.com/report.
- Patients sync through app-sync 0.4.1 and the update module 0.2.0 since 25 Oct 2026 (#18 on 0.4.0, then 0.4.1:
  a leave entry no longer drops a patient that still has unsent saves): the stamp only moves forward
  (app-sync does it), an admin's lock writes its leave entry in the same transaction (no lock without its entry), a
  patient locked while it still has unsent saves stays on the phone with a warning, the sync chip says "Checking"
  until the server has answered and "at risk" only while offline, log out goes through `forgetDevice`, and an update
  waits while a reading is half entered, a sheet is open, someone is typing or saves are sending.
- Server stamps (app-sync 0.3.0, #17) merged 25 Oct 2026: writes carry `serverAt`; indexes deployed, `serverAt`
  backfilled. The hub still listens by `updatedAt` (client mode).
- Live from this repo's Worker since 21 Oct 2026 (moved from anawj-site; no downtime). Rules deploy on merge.

## Waiting on the owner
- Nothing.

## Next (in order)
- Server stamps, last steps: once older app versions are gone, a rules PR requires `serverAt == request.time`, then the
  hub moves to `stampMode: 'server'`.
1. Check a real scan upload from a phone on prewarmstudy.anawj.com (the relay's settings are all set).

## Recently done
- 25 Oct 2026: app-sync 0.6.0 createApp; `.wrangler/` and `firestore-debug.log` out of git; `.starter.json` (adopted
  app-starter). Next for links: join and share links by Worker custom token (app-devkit `custom-token.js`), which needs a
  service account secret on the Worker and a rules change.
- 25 Oct 2026: every Firebase call checked against app-sync: none outside `js/cloud.js`; patients go through app-sync, the rest stay direct on purpose (field-checked rules, not synced lists). New two-phone test: log out with an Email / PayNow saved without signal warns and keeps it.
- 21 Oct 2026: imported from anawj-site; all prewarm tests pass here; cut-over done; first keyless rules deploy passed.

## Decisions (dated, one line each)
- 25 Oct 2026: app-sync 0.4.0 (then 0.4.1) + update 0.2.0; updates no longer reload mid-entry (was instant since 24 Oct).
- 24 Oct 2026: patients sync through app-sync (outbox, delta listener, server-side field merge); every patient write must change `updatedAt` (old app versions are refused until they update; their changes stay on the phone and heal after).
- 21 Oct 2026: rules deploy uses keyless OIDC sign-in, not a stored service-account key.
