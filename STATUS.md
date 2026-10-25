# Status

## Now
- Patients sync through app-sync 0.4.0 and the update module 0.2.0 since 25 Oct 2026: the stamp only moves forward
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
- 21 Oct 2026: imported from anawj-site; all prewarm tests pass here; cut-over done; first keyless rules deploy passed.

## Decisions (dated, one line each)
- 25 Oct 2026: app-sync 0.4.0 + update 0.2.0; updates no longer reload mid-entry (was instant since 24 Oct).
- 24 Oct 2026: patients sync through app-sync (outbox, delta listener, server-side field merge); every patient write must change `updatedAt` (old app versions are refused until they update; their changes stay on the phone and heal after).
- 21 Oct 2026: rules deploy uses keyless OIDC sign-in, not a stored service-account key.
