# Status

## Now
- Patients sync through app-sync 0.2.0 since 24 Oct 2026 (#15); patients index deployed and `updatedAt` backfilled.
- Server stamps PR (app-sync 0.3.0): writes carry `serverAt`, an admin's lock writes `leaves/patient:{id}` so a closed
  phone drops the patient at its next open. Not merged.
- Same PR, sync fixes found by the flaky emulator test (24 Oct 2026): a "Not sent yet" line that stayed after the save
  went; a join that could show "Not allowed" or never sync (sign-in and join raced); a patient locked while its refused
  changes were still on the phone was dropped with them; a typed BMI sent without `auto: false`. Stale gaps checks moved
  from the old `prewarm:pending` tokens to the outbox.
- Live from this repo's Worker since 21 Oct 2026 (moved from anawj-site; no downtime). Rules deploy on merge.

## Waiting on the owner
- Nothing.

## Next (in order)
- Server stamps rollout, in order: deploy the new indexes (`firestore.indexes.json`: patients site+locked+serverAt,
  leaves site+deletedAt and site+serverAt) before the merge (rules deploy on merge); after the merge, run
  `tools/backfill-server-at.mjs` (dry run, then `--write`); once older app versions are gone, a second rules PR
  requires `serverAt == request.time`, then the hub moves to `stampMode: 'server'`.
1. Check a real scan upload from a phone on prewarmstudy.anawj.com (the relay's settings are all set).

## Recently done
- 21 Oct 2026: imported from anawj-site; all prewarm tests pass here; cut-over done; first keyless rules deploy passed.

## Decisions (dated, one line each)
- 24 Oct 2026: patients sync through app-sync (outbox, delta listener, server-side field merge); every patient write must change `updatedAt` (old app versions are refused until they update; their changes stay on the phone and heal after).
- 21 Oct 2026: rules deploy uses keyless OIDC sign-in, not a stored service-account key.
