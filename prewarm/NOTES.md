# Prewarming study app: notes

Lasting rules and conventions. Topic detail is in `docs/`:

- [docs/screens.md](docs/screens.md): patient screen, key times, sign-offs, forms, look.
- [docs/readings-and-alerts.md](docs/readings-and-alerts.md): readings, alerts, entry pads, export, edge cases.
- [docs/sharing-and-sync.md](docs/sharing-and-sync.md): sharing, sync, admin sign-in, locking, PACU link, updates, address move.

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
- **Scan pages screen** (`js/scan.js`, route `#/scan`, Settings › Scan pages (beta), off by default): scanner-style capture (live camera by default: page outline on the video, coach line, auto photo once the page is found and still (off after 20 s, or by a per-phone switch), shutter button, torch where the phone has one, full-resolution still via ImageCapture else the biggest video frame (size shown and kept with the page), blur and dark check after each camera shot with Retake; per-phone "Use phone camera app" switch, also offered when the camera will not open; test `test/scan-live.e2e.mjs` with a fake camera. Or the photo picker. Then four draggable
  corners with a loupe, perspective flatten to 1800x2400, shadow removal, Auto / Black and white / Colour; maths in `js/scan-geom.js`, plain canvas code;
  original kept beside the tidied copy; press and hold a page to select several, then All / None / Delete / Cancel), page numbers 1–14 that move on by themselves, held in IndexedDB on that phone.
  Tidy + pages (owner, 20 Oct 2026): when the outline is sure (whole sheet found, clear of the photo's edges) the corners step is skipped and the flat page shows with one tap **Looks right**
  (Adjust corners for the crop step); corner handles 44 px plus side handles (move a whole side), both snap onto the paper's corner or edge on letting go (`edgeInfo`,
  `snapCorner`, `snapSide`); the lighting style is remembered on the phone; output always portrait 1800x2400; **auto-rotate upright** (`uprightScore`: print has more
  strokes above the letters' middle band than below; table rules left out; turns only on clear evidence, 12+ line pieces and score below -0.2; never after a manual
  Rotate). Benchmarked on made-up printed pages (240 synthetic photos): no upright page ever turned, about 3 in 4 upside-down pages turned, the rest left as photographed;
  tune `UPRIGHT_*` from real pages. **Several pages in a row** (per-phone switch, on by default): pick a range ("3 to 7"), each shot takes the next number, the live
  camera stays open and waits for the sheet to change; pages are tidied beside it with the remembered style and marked **Check** (`needs`: blurry, dark, corners
  guessed); with the camera app each tap takes the next page; from the gallery the picked photos take the range in order. **14-slot grid**: empty (tap to take just
  that page), Tidying…, taken, sent, Check; tap a taken page for Retake / Choose from gallery / Delete, Adjust corners, page number, and Looks right on a Check page.
  Tests: `test/scan-burst.e2e.mjs` (fake camera shared in `test/fake-camera.mjs`). **Sending** (only on prewarmstudy.anawj.com,
  not demo; owner, 20 Oct 2026): the sign-in is checked as the screen opens (a note with Sign in / I have signed in until it is
  done); each page is sent as soon as it is ready (per-phone switch "Send each page when it is ready", on), a queue over every
  subject's unsent pages, retried after 15 s, 1 min, then every 5 min and at once when the signal returns; pages marked Check
  wait for a look unless sent by hand (Send now, Retry); a page number used twice waits. Each upload carries the Subject ID
  (`X-Scan-Subject`). The status route (polled every 20 s while a page waits to be read, else 2 min, while the screen is open)
  gives each slot its state under the photo: On phone, Sending…, Not sent, Sent, Reading…, Read · n · k flags, Retake (a
  button straight to the camera for that page, with the study computer's reason), Approved, Rejected. A photo the study
  computer matched to another page number moves to that slot once ("was 7"), only into a free slot. When every page is on
  the study computer a box says it is safe to clear them from the phone (keep them until approved: Scan imports' photo
  beside each value comes from the phone's copy); pages approved or rejected over 7 days ago clear by themselves. The
  queue runs while the Scan pages screen is open. Uploads go to `/scan-api/` (`worker/scan.js`): Cloudflare Access on that path
  (email allowlist, one-time PIN), the Worker re-checks the Access token, then passes the photo on to the study computer's `tools/scan/inbox.py`
  with a service token only the Worker holds; nothing is stored in Cloudflare. The service worker never caches `/scan-api/`. Worker settings
  are listed at the top of `worker/scan.js`; without them the route answers 503. **Scan imports** (PR C, 20 Oct): `tools/scan/watch.py` on Firetop reads each received scan with the local model and files values and flags in
  `scanImports/{scan}` (rules: admins read and approve only; Firetop creates with its own token). Photos arriving after a
  read (a retake, a late page) are read on their own and filed as `{scan}-2`, `-3`… The phone's page numbers are a hint:
  `scan.py --hint-pages` keeps each unless another page lines up clearly better (0.03), which is how a burst page shot out
  of order is corrected. `watch.py` writes `status.json` per folder (per photo: page found, score, accepted or why not,
  value and flag counts, import id; review state of each import looked up every 5 min) and `inbox.py` serves it as the
  status route: numbers and states only, never values. Admin screen `js/scan-imports.js`, route
  `#/scanimports` (Settings › Scan imports, admins, with Scan pages on), phone-first (owner, 20 Oct 2026): imports grouped by
  Subject ID (rounds `-2`, `-3` with their first read); the patient picked from the Subject ID sent with the scan (`subject`,
  from meta.json via watch.py), else found by typing (no dropdown); values grouped by form page in form order, only those to
  check shown (flagged, or replacing a saved value: Now saved beside Scanned), the rest folded under "n look fine"; Next to
  check (and Enter) walks them; a value is edited in place (that ticks it) with "Scanner read: …" kept beside it, and the edit
  changes only what is copied into the patient, never the import; the photo of each value is cut from this phone's own tidied
  page (`box`, the field's place as fractions of the page, from scan.py's field map), else "Photo only on the phone that
  scanned it". Approve; nothing reaches a patient before that.
  Next (owner's call): in-app email allowlist (PB2).
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

