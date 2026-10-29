# Prewarming study app

Phone app for the op-day bedside data of the prewarming RCT: temperatures every 5 minutes (pre-warming and intra-op),
event times, intra-op details, PACU and satisfaction. Lives at `prewarmstudy.anawj.com` (it moved from `anawj.com/prewarm/`, which now moves phones across once they have nothing waiting); `?demo` opens a separate demo
store with a fake patient.

- **Study-day runbook for the team: `RUNBOOK.md`.** 
- Lasting rules: `NOTES.md` (topic detail in `docs/`). Plans, decisions and status are in the owner's private notes.
- `js/headers.js`: the eCRF template's 572 headers and sections, verbatim. `js/schema.js`: every template column as a
  field, in column order, plus op-day extras the template lacks. `js/app.js` and `js/ui-*.js`: the screens (map in `NOTES.md`).
  `js/store.js`: records with a timestamp per field (merge-ready for sharing). `js/xlsx.js` + `js/export.js`: the Excel export.
- Form view: `js/wordform.js` (where each field goes on the paper form v3.2), `js/docx-fill.js` (ticks boxes and types
  into blanks and cells of the Word XML, keeping everything else byte for byte), `js/wordview.js` (download; show with
  vendored docx-preview to print / save as PDF). The blank form is uploaded by an admin, never committed here.
- Sharing: `js/cloud.js` + `firestore.rules` (Firebase project `prewarm-study`; deployed on merge by the "Deploy
  Firestore rules" workflow). Without joining, data stays on the phone.

Tests (fake data only):

```
tools/test-prewarm.sh            # all of the below except rules and sync, browser tests side by side (~1½ min)
node prewarm/test/prewarm.test.mjs
node prewarm/test/wordform.test.mjs   # filling the Word form (made-up fixture-form.mjs)
python3 -m http.server 8080 &   # from the repo root
node prewarm/test/e2e.mjs        # phone-size browser test with an axe check; SHOTS=<dir> saves screenshots
node prewarm/test/edge.e2e.mjs   # edge cases (4 at a time; JOBS=1 for one at a time): past midnight, double-tap Save, BP checks, back button
node prewarm/test/back.e2e.mjs   # Back with tabs: tabs add one Back step at most, Back to the first tab, then out
node prewarm/test/gaps.e2e.mjs   # fixed bugs that had no test: update prompt, typed BMI, wake lock, one banner and three beeps, double taps
node prewarm/test/fullcase.e2e.mjs  # a whole case per group with a fake clock: nothing left to fill, every op-day cell exported
tools/test-rules.sh              # Firestore rules in the local emulator
tools/test-prewarm-sync.sh       # two phones sharing a patient through the local emulators
```
