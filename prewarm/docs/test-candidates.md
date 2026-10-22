# Prewarming study app: fixed bugs that should become tests

The "Bug hunt" list in [readings-and-alerts.md](readings-and-alerts.md) records behaviours fixed after reviews. Checked
against `test/` on 22 Oct 2026: of 56 behaviours, 29 have a test that asserts them, 13 are partly covered (2 of them out of date) and 14 have
none. Only the gaps are listed here; tick one off by adding the test and deleting its row. Tests use fake data only.

## No test yet

| Fixed behaviour | Suggested test |
|---|---|
| "Update available" (or an update taken in another tab) asks to save an unsaved reading before reloading (`afterAsking`) | e2e: type a temp, fire the update path, assert the save-or-leave prompt shows before reload |
| A typed BMI isn't overwritten by the calculation | e2e: type a BMI, change weight, assert the typed BMI stays |
| The screen-awake lock is taken again after switching apps | e2e: stub `navigator.wakeLock`, fire visibilitychange hidden then visible, assert `request()` ran twice |
| On the first server word each session, patients the server never had are sent whole | emulator: make a patient offline in a fresh session, go online, assert the server copy has every field |
| Pending entries from an earlier session are dropped on the first server word | emulator: leave an older pending entry, reload, assert it is cleared and doesn't overwrite a newer server value |
| `push` always sends `auto`, so a typed BMI / TXA total / NuDESC isn't recalculated elsewhere | emulator: phone A types a BMI; assert `auto` is false on the server and B keeps the typed value after a weight change |
| A member's patient locked with unsent changes stays on the phone with a warning | emulator: A edits offline, an admin locks, A reconnects; assert the patient stays on A with the warning |
| An emptied time picker doesn't clear the time | e2e: set a time, empty `#evtime`, close the pad, assert the time is still set |
| A restore reaches every phone in the team | emulator: A deletes then restores; assert B lists the patient again |
| Alerts due in the same second share one banner, with three beeps | e2e: two readings due at the same instant; assert one banner naming both; stub AudioContext and count 3 tones |
| Sound resumes on every tap (phones suspend it after an app switch) | e2e: stub AudioContext state `suspended`, tap, assert `resume()` ran |
| AF "specify" on discharge is New onset / Existing chips and ticks the Word form | unit (`wordform.test.mjs`): pick New onset, assert the Word box is ticked |
| "Tap again to delete" ignores a second tap within 0.6 s | e2e: tap Delete twice 200 ms apart, assert the patient is still listed |
| Comfort answers change but don't clear on a second tap | e2e: tap the same comfort chip twice, assert it is still picked |

## Partly covered

| Fixed behaviour | Covered now by | Missing check |
|---|---|---|
| A hidden follow-up's value is left out of the Word export | `prewarm.test.mjs` (`shownValue` only) | unit (`wordform.test.mjs`): parent No with a stored follow-up, assert the Word text leaves it out |
| A hidden value stays stored, so switching back brings it back | `prewarm.test.mjs` (TXA at the `shownValue` level) | e2e: IHD No then Yes, assert years since MI shows its old value |
| Subject ID can be corrected but can't be blank or a duplicate | `edge.e2e.mjs` block K (duplicate, correction) | e2e: clear the Subject ID and Tab, assert it is refused and the old ID kept |
| Save sends only the boxes that changed (plus the save time) | `sync.emulator.mjs` (same reading on both phones) | emulator: B changes core only, A changes chest; assert both edits survive |
| A wrong join code's "isn't right" isn't replaced by "Not allowed" | `sync.emulator.mjs` (the toast) | emulator: after a wrong code wait 2 s, assert it never says "Not allowed" |
| The asked time is the reading's time on the Word form and Readings sheet | `wordform.test.mjs`, `prewarm.test.mjs` (row, not time) | unit: set a late time, assert the Readings sheet row shows it |
| A saved reading shows "Taken hh:mm (saved by XX) · Change time" | `edge.e2e.mjs` block P (no "saved by") | e2e: assert the line matches `Taken hh:mm (saved by XX)` |
| A reading due after Underbody / Gown warming start defaults to Yes | `edge.e2e.mjs` block S (gown only) | e2e: the same with Underbody warm |
| Double tap on Log / a time box / a comfort answer is ignored | `edge.e2e.mjs` block T (Save only) | e2e: double tap a key time's Now, assert only that time is set |
| `render()` blurs a box being typed first, so swipe / back commits it | `edge.e2e.mjs` block T (temps) | e2e: type a form answer, press back without Tab, reopen, assert it saved |
| A typed temperature shows at once; the redraw waits 0.4 s so Save isn't lost | `edge.e2e.mjs` block T | e2e: type a temp and tap Save within 0.3 s, assert the first tap saves |

## Doc lines out of date (fix the doc, no test needed)

- "readings hidden in Settings are listed in Still to fill": the Settings section for hidden readings was removed.
- "a BP reading falling due on the Temperatures tab or a form alerts too": the BP alarm is now off by default (a
  Settings switch, `edge.e2e.mjs` block AB).
