# Prewarming study app: scan pages and scan imports

Moved out of [../NOTES.md](../NOTES.md) to keep the read-first notes short. Scanning old paper forms on a computer
(`tools/scan/`) is in [../tools/scan/README.md](../tools/scan/README.md).

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
