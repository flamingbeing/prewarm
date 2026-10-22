# Prewarming study app: fixed bugs that should become tests

The "Bug hunt" list in [readings-and-alerts.md](readings-and-alerts.md) records behaviours fixed after reviews. Checked
against `test/` on 22 Oct 2026: of 56 behaviours, 29 had a test that asserts them, 13 were partly covered (2 of them out of
date) and 14 had none. The 14 untested and 10 of the 11 live partly covered ones now have tests (added the same day, in
`gaps.e2e.mjs`, `sync-gaps.emulator.mjs`, `wordform.test.mjs`, `prewarm.test.mjs`); only the gaps still open are listed here.
Tick one off by adding the test and deleting its row. Tests use fake data only.

## Still open

| Fixed behaviour | Covered now by | Why no test yet |
|---|---|---|
| Double tap on a time box is ignored | `edge.e2e.mjs` block T (Save), `gaps.e2e.mjs` (comfort answer) | The time pad's Now button sits away from the time boxes, so a double tap on it cannot land on the next box; nothing to assert. Re-check if the pad moves. |
| "Update taken in another tab" (`controllerchange` while a reading is half typed) asks before reloading | `gaps.e2e.mjs` covers the "Update available" button with a real service worker | The other-tab path needs a second tab taking the update; same `afterAsking` call, not tested on its own. |

## Doc lines out of date (fix the doc, no test needed)

- "readings hidden in Settings are listed in Still to fill": the Settings section for hidden readings was removed.
- "a BP reading falling due on the Temperatures tab or a form alerts too": the BP alarm is now off by default (a
  Settings switch, `edge.e2e.mjs` block AB).
- "A typed temperature goes back in place at once and the screen redraws 0.4 s later": the number pad now saves the box
  and redraws at once (`openCell` in `ui-patient.js`). `gaps.e2e.mjs` checks the outcome that fix was for (a Save tapped
  0.1 s after typing saves on the first tap).
