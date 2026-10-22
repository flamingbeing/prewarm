# Prewarming study app: notes

Lasting rules and conventions. Topic detail is in `docs/`:

- [docs/screens.md](docs/screens.md): patient screen, key times, sign-offs, forms, look.
- [docs/readings-and-alerts.md](docs/readings-and-alerts.md): readings, alerts, entry pads, export, edge cases.
- [docs/sharing-and-sync.md](docs/sharing-and-sync.md): sharing, sync, admin sign-in, locking, PACU link, updates, address move.
- [docs/scan-pages.md](docs/scan-pages.md): Scan pages screen (camera, tidy, pages, sending) and the admins' Scan imports screen.
- [docs/test-candidates.md](docs/test-candidates.md): fixed bugs that should get their own regression test.

How to run and test: [README.md](README.md). Study-day routine: [RUNBOOK.md](RUNBOOK.md). Decisions, plans and status
are in the owner's private notes.

- **Code map** (ES modules, split from one `app.js` on 22 Oct 2026, like the logbook's): `js/app.js` start-up; `ui-core.js` state, storage, toast, routing (imports no screen; screens call back through `hooks`); `ui-sync.js` sharing and sync; `series.js` readings timing; screens `ui-home`, `ui-patient`, `ui-alerts` (due alerts, complete, sign-off), `ui-data`, `ui-forms`, `ui-word`, `ui-pay`, `ui-settings`, `ui-share`, `ui-admin`, `ui-export`. A new file goes in `sw.js` SHELL.
- **Public repo:** never commit the eCRF template, the protocol or the paper data collection form (they carry staff
  names). Only the transcribed headers are here. Fake patients only, in tests and demo.
- **Study IDs only:** the app never asks for names, initials or hospital numbers. The Subject ID is exported in the
  template's Enrollment ID column (B).
- **Hospitals:** NTF, NUH, SGH, CGH, TTSH, KTPH, WH (`SITES` in `schema.js`). Each phone picks one in Settings; new
  patients record it (`site`, on the Extra sheet). With sharing, the join code will set it.
- **Scanning old paper forms** (`prewarm/tools/scan/`, README there): phone photo, aligned to the
  blank v3.2 page; ticks by ink; numbers and times read twice by Claude or a local Ollama vision model (`--reader ollama`; crops of de-identified cells only; IDs, dates,
  names and free text are typed by the person scanning); flags; `review.html` where the person confirms every value; then the app's
  own `workbook()`. Field places come from `js/wordform.js` (fill one field, render, diff). Scans, the form and
  `form-data/` stay out of git. Tested on the fake fixture only; the real form, real handwriting and the live reader
  still need a dry run at home.
  Status 15 Oct 2026: tried on real pages with a stand-in reader, with good results (details in the owner's private
  notes). The live API reader has never run (shelved): its accuracy is unmeasured. Key: `--key-file`, never an env var.
- **Scan pages screen and Scan imports** (`js/scan.js`, `js/scan-imports.js`, the scan relay): see [docs/scan-pages.md](docs/scan-pages.md).
- **Blinding:** the randomisation group shows only on the pre-warming screen (and when the patient is created).
- **Columns:** `schema.js` lists fields in template column order; field n is column n. `test/prewarm.test.mjs` pins
  anchor columns. Never insert a template field out of order. Items with no template column go in `EXTRA` (exported
  on the "Extra" sheet).
- **Readings:** saving a timepoint stamps `at_<series>_<point>` with the clock time and initials; the Readings sheet
  is built from those. Gown set temp is NA for the no-pre-warming group and after "Active warming stopped".
- **Join by code:** the hospital comes from the code's prefix (NTF-…), so nobody picks a hospital to join.
- **Service worker:** the page reloads only when an update takes over, never on the first install (a reload wiped the
  initials typed on the join screen).
- **Fast tests**: `tools/test-prewarm.sh` runs everything but sync and rules in about 1½ minutes.
  Edge blocks each start from a fresh browser context and run four at a time (`JOBS=1` for one at a time); the full
  case's three groups run side by side. A failing `assert` on a Playwright handle can hang Node building its diff
  (memory climbs to gigabytes): if a test run is killed, look for a failed assertion comparing an element handle.
- **Alerts** only work while the app is open; locked-phone alerts would need push notifications.
- **Deploys:** a merge that changes `.github/workflows/deploy-firestore-rules.yml` and a rules file together may not
  start a run (it happened with #196); check Actions, and touch the rules file in a later PR if it didn't run.
- **Testing sharing:** `tools/test-rules.sh` (rules, 52 checks) and `tools/test-prewarm-sync.sh` (two phones in a
  browser against the local Firestore and Auth emulators, `?emulator` on localhost only). Never the live project.
- No hand bump of `VERSION`: the deploy stamps it with a hash of the SHELL files (`tools/stamp-versions.mjs`; AGENTS.md).
### The app version starts with the date
Settings (under Refresh now) shows "App version 2026-10-14 (3f9a2c1d)": the day (Singapore time) of the last commit that touched
a file the version hash covers, then the hash. `tools/stamp-versions.mjs` builds it at deploy (`prewarm-2026-10-14-3f9a2c1d`, the
saved copy's name); only prewarm is dated (`DATED` in the script, add an app name to extend). The date moves only when the
files do, so phones don't see extra updates; the Pages workflow now checks out full history (`fetch-depth: 0`) for that
(without history the script uses today's date). The base in `sw.js` stays `prewarm-v79`: bump it only when the worker's own
logic changes, as before. Test tap guard: after a pad closes, a tap within 48 px for 0.7 s is swallowed (the sync test waits).

### No breaking changes
"This is highly important app, it must stay up, so let's skip making breaking changes." Prewarm holds live study data: change it
in small steps that keep every phone working (the same saved data, the same sync and rules, the old addresses redirecting), run
`tools/test-prewarm.sh` and `tools/test-prewarm-sync.sh`, and never merge during a case. Big restyles, new shared kits,
rules changes, moving or renaming files the service worker caches, or anything that could stop the app loading offline need
an explicit go-ahead from the study owner first. The service worker's install is all-or-nothing, so a file listed in `SHELL` that does not
exist blocks every update.

