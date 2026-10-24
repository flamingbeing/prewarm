# Status

## Now
- Live from this repo's Worker since 21 Oct 2026 (moved from anawj-site; no downtime). Rules deploy on merge.

## Waiting on the owner
- Patients sync through app-sync 0.2.0 (PR open, not merged): before merging, deploy `prewarm/firestore.indexes.json`
  (the rules deploy can't), and after merging run `tools/backfill-updated-at.mjs` (dry run first).

## Next (in order)
1. Check a real scan upload from a phone on prewarmstudy.anawj.com (the relay's settings are all set).

## Recently done
- 21 Oct 2026: imported from anawj-site; all prewarm tests pass here; cut-over done; first keyless rules deploy passed.

## Decisions (dated, one line each)
- 24 Oct 2026: patients sync through app-sync (outbox, delta listener, server-side field merge); every patient write must change `updatedAt` (old app versions are refused until they update; their changes stay on the phone and heal after).
- 21 Oct 2026: rules deploy uses keyless OIDC sign-in, not a stored service-account key.
