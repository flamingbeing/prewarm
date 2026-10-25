# Prewarming study app: sharing, sync and updates

Team sharing (Firestore), admin sign-in, locking, the PACU nurse link, updates and the address move. Part of the notes index in [NOTES.md](../NOTES.md).

- **Log out** (replaced "Stop sharing on this phone" and the admins' "Sign out"): warns first (how many
  patients will go), tries to sync for a few seconds, and warns again naming any patient with changes the server
  hasn't confirmed (`pending`, kept across reloads; cleared when Firestore's waitForPendingWrites resolves). Then it
  leaves the team / signs out, deletes every patient, the outbox and Firestore's offline copy on the phone (app-sync
  `forgetDevice`), keeps settings, reloads.
- **Admin screen:** the blank Word form card is at the bottom.
- **Admin join codes**: the code is shown big; tapping it copies it. "New code" is a small link
  and warns first: the old code, link and QR stop working for new phones; phones already in stay in (use Remove).
- **Last synced**: home page and Settings show "Synced just now / N min ago / at 14:20 / 12 Oct
  14:20", or "Not synced: N patients waiting for signal. Last synced …" (amber). `lastSync` is set when nothing is
  pending and the server has confirmed the phone's copy (a server snapshot, a confirmed push, or waitForPendingWrites).
- **Locking**: a study admin taps "Select to lock" on the home page, picks patients (or "All
  but <latest>": everyone except the most recently edited), then Lock / Unlock. A locked patient is hidden from team
  phones completely: the rules let members read only `locked == false` records, their query asks for that, and a
  patient that leaves the query is deleted from the phone (it comes back when unlocked), unless it still has saves the
  server never took: then it stays, with a warning (app-sync `unsent` / `onLeave`). The lock writes
  `leaves/patient:{id}` in the same transaction (app-sync 0.4.0 `onCommit`), so a phone that was closed drops the
  patient at its next open. Admins (anyone in demo mode)
  open it read only (body.ro). Locked records are read only for everyone; an admin can only change `lock` / `locked`.
  `locked` (bool) mirrors `lock.on` on every record; older records got it from each phone's one-off resend
  (`resync2`), and stay hidden from members until then. Lock icon: an inline SVG padlock, no emoji.
  - Lesson: no `get(field, default)` in a read rule that guards a query: Firestore treats fields the query doesn't
    constrain as missing, so the default lets an unfiltered query through. Require the field (`locked == false`).
- **Share subject link** (owner, 21 Oct 2026; replaced the join-and-open link `#/join/{site}/{code}/p/{id}`, which
  still works for old links): `#/s/<token>` (24 random characters = the secret), one fixed link per participant, made
  the first time its Share page opens (`share_token` syncs to every team phone); only a study admin stops it.
  Firestore `shares/{token}` names the patient `{ site, pid, sid, created, by }`. A phone that opens it signs in
  anonymously and writes a guest pass `guests/{uid}_{pid}`; the rules (`guestOf`) then let it get and update that one
  patient by id (not create, lock, delete, list or query), save its email and PayNow and make its PACU link, while the
  share exists, names the same hospital and the patient is unlocked. Stopping the link (deleting the share) ends every
  guest's access; the guest phone drops the subject when its listener is refused. The phone keeps the opened subjects
  in `guest` (local storage) and listens to each one by id (`cloud.watchPatient`); a team member or admin opening the
  link just goes to the subject. Tests: `test/rules.emulator.mjs`, `test/sync.emulator.mjs`.
- **PACU nurse link**: on a participant's PACU page a member (or admin) makes a link and QR code
  (`#/nurse/<token>`, 24 random characters = the secret). Firestore `pacu/{token}` holds a copy of that participant's
  PACU answers (`PACU_KEYS` in `js/schema.js`; the rules allow exactly that list, checked by a unit test): anyone
  signed in (the nurse's phone signs in anonymously, joins nothing) who has the token reads it and writes only those
  fields; nobody can list tokens except admins; members of the hospital make and stop (delete) it. The nurse's page
  shows only that participant's PACU in / To ward, answers and complete tick (the Subject ID in its title), with
  initials. Team phones subscribe to the `pacu_token` of their patients and merge newer fields (and push their own
  PACU edits to the link copy), so both directions settle on the newest write. `pacu_token` is a field on the patient.
  Anyone holding the link can edit those PACU answers until the link is stopped. One fixed link per participant (owner,
  21 Oct 2026): Share to PACU makes it by itself the first time it opens (Try again without signal) and shows the same
  link after that; only an admin sees "Stop this link" (the rules still let members stop it; no rules change). Tests: `rules.emulator.mjs` (24
  checks), `sync.emulator.mjs` (a third phone opens the link). Rules deploy on merge to main.
- **Email and PayNow** (owner, 21 Oct 2026; `js/pay.js`): a button under the Induction room tab's readings opens
  `#/p/<id>/pay` (not shown for a declined patient). The team types the email and a PayNow mobile (8 digits, 8 or 9;
  +65 and spaces dropped) and saves to `payments/<patient id>` (merge, no read: the rules let team phones write but not
  read). The patient record keeps only when and by whom (`pay_saved`, `pay_cleared`; kept on Reset), never the values,
  so they never reach the export, Form view or the team's other phones. Admins see the values on the same page and in
  Settings › Email and PayNow (`#/payments`, still to pay first; done ones folded), tick **Email sent** and **Payment
  sent** (`{ t, by }`), and **Delete email and PayNow** once Payment sent is ticked; the ticks stay. Offline, the save
  waits in Firestore's queue on that phone and goes when there is signal (as readings do).
- **Never send an empty `f`**: `setDoc(…, { f: {} }, { merge: true })` replaces the server's
  `f` with an empty map (an empty map is a leaf in the merge). Lock / unlock / delete sent one and wiped the server
  copy's readings; push now omits an empty `f`, lock sends the full record, and each phone resends all its patients
  once after its first server snapshot (`resync1`). The sync emulator test checks the server copy keeps its readings.
- **Sharing** (`js/cloud.js`, `firestore.rules`, Firebase project `prewarm-study`):
  - Phones join with their hospital's code (anonymous sign-in); the rules accept a `members/{uid}` entry only with that
    hospital's current code. Members read and write only their hospital's patients. A new code stops new joins with
    the old one; phones already in stay in until an admin removes them.
  - **Managing admins**: the admin screen's "Study admins" card lists `admins/{email}`
    ({ addedBy, addedAt }); any admin adds one by email (confirm first) or removes one (confirm first); nobody removes
    themselves (rules), so there's always one. All admins are equal. The new admin signs in from Settings ("Study
    admin? Sign in by email").
  - Admins sign in with an emailed link (Firebase "Email link" sign-in), not Google: phone browsers block the
    Google pop-up's helper page on `prewarm-study.firebaseapp.com` ("missing initial state"), and the self-hosted
    helper at `anawj.com/__/auth` belongs to the logbook's project. `admins/{email}` (lower-case email) lists them. The first admin is added by hand in the
    Firebase console; after that admins can add others there. Admins see every hospital, make codes, remove phones.
  - **Join links**: the admin screen shares `prewarmstudy.anawj.com/#/join/{site}/{code}` (old links at `anawj.com/prewarm/#/join/…` move across and still work) or shows it as
    a QR code (vendored qrcode-generator, as in evals). The code sits after the `#`, so it never reaches a server, and
    the app drops it from the address bar once joined. Codes stay long (8 characters); a link means nobody types them.
  - Each patient is one document; each field is merged on its own (`f.<id>: {v, t, by}`), newest edit wins when
    copies meet. localStorage stays the phone's working copy; Firestore keeps its own offline cache and sends when
    there is signal.
  - Membership is checked on the server, not the local cache (a refused join briefly shows in the cache).
  - Remote changes redraw the list, patient and form-view screens; on reading and form screens a bar offers to show
    them, so a half-entered reading is never lost.
- **Update check** ("Update available" didn't appear until the app was closed and reopened): browsers
  look for a new service worker only when the page is opened, and the phones keep the app open for hours. The page now
  calls `reg.update()` when it comes back to the front, when signal returns and every 10 min (not tested in the browser
  suite: the worker isn't registered in demo mode).
- **Admin password sign-in** (Google stays off, see above): Settings has email + password boxes
  with Sign in, "Email me a sign-in link" and "Forgot password? Email me a reset link". A password exists only on an
  account that signed in once by emailed link (that proves the email, which the rules need): once signed in, Settings →
  Password → Save password (8+ characters). Rules unchanged (admins list + verified email). Needs Email/Password on
  in the Firebase console (it is, for email links). Covered by the two-phone sync test.
- **Refresh now**: a button at the bottom of the home page and in Settings (when sharing is on).
  It re-checks who the phone is (fresh token, member / admin list, so a newly added admin entry counts without
  logging out), re-subscribes to the team's patients, sends anything waiting, and checks for a new app version (shows
  "Update available" if one is ready). It never deletes anything on the phone.
- **Update helper** (Firefox on the phone kept the old version after closing and reopening):
  `anawj.com/prewarm-update/` is a plain page outside the app's service-worker scope (`/prewarm/`), so the old worker
  can't serve it. "Get the latest version" first checks the app is reachable, then unregisters the prewarm worker and
  deletes the `prewarm-*` caches, then opens `/prewarm/` again. Patients and readings (localStorage, IndexedDB) are
  never touched. Also linked from Settings under Refresh now. Tell the user to open it by typing the address when a
  phone is stuck on an old version.
- **Stale banner and bare times**: (1) "Update available" posted `skipWaiting` to the worker it had
  captured, which can be replaced by a newer one when several updates ship in a row, so on Firefox the tap did nothing.
  It now asks the current waiting worker, hides the banner, and if nothing takes over in 3 s clears the app's saved
  copy (never the patients) and reloads. (2) A blank or cleared save leaves a bare `at_…` time with no readings; a point
  counts as having data only if it has a reading (`hasData`), and `p.f[...]` truthiness is never used (cleared records stay).
- **Sync status replaces Log in the bar**: the top-right chip shows Synced / N waiting / Offline
  (or Local when not sharing); a tap runs Refresh now. The one-tap Log shortcut is gone: key times are set from their
  boxes in the key-times row (pad with a Now button). Tests set times that way (`tapNow`); logging one while an earlier
  key time is empty asks first.
- **Move to prewarmstudy.anawj.com** (plan in `SUBDOMAINS.md`, step 3; done between cases only):
  - Why: the browser keeps a phone's saved copy, unsent readings and sign-in per web address, so the study app has its own
    address. The repo folder stays `prewarm/`; the host serves only it (the design kit comes from `design.anawj.com/v1/`).
  - The old address (`anawj.com/prewarm/`, `www.`) runs `moveCheck()` once, 1.5 s after the app opens (never mid-entry,
    top-level windows only). It moves the phone only when: no half-entered reading (`unsaved:` drafts), nothing waiting
    (`pending` empty and `cloud.flushed()`), the phone is on a team (or has no patients), it is online and the new
    address answers. Otherwise a bar says why, with Try again. Demo mode moves at once. It never moves a phone mid-case
    unless the app was just opened or updated: a running phone only gets the new code by "Update available" or a reload.
  - The redirect keeps path and query and the `#` part (nurse links, join links, admin sign-in links). A team member's
    phone sends `#/join/{site}/{its code}/{initials}` (read from its own `members` record) so it rejoins on the new
    address with one tap; admins sign in again there (email link or password). Nothing in Firestore or the rules changes;
    the old address's saved copy is left as it was (no data deleted).
  - New address: `update.html` in the app folder is the update helper (the SW lets it through to the network);
    the old address keeps `anawj.com/prewarm-update/` (outside the old worker's scope; it clears the old copy and
    reopens `/prewarm/`, which then moves on). The sign-in domain stays `prewarm-study.firebaseapp.com`;
    `prewarmstudy.anawj.com` is an authorised domain (added in the Firebase console).
  - Tests: edge block AJ (redirect keeps path, query, `#`; no loop; update helper), sync test (a half-entered reading
    keeps the phone; then the join code and initials arrive on the new address and the team's patient shows). In tests
    `?oldhost=<new address>` on localhost pretends to be the old address.
- **Admin hospital**: signed-in admins had no way to set "their" hospital (the chips only showed in
  demo mode), so patients they started had no hospital and never synced. Settings now shows the hospital chips to admins
  (members' hospital stays fixed by their team). Workaround before this ships: open the team's join link while signed in.

### Saves that don't reach the team are shown
`sync()` keeps a `failed` map (patient -> reason, saved on the phone). A patient with no hospital, a refused save
(locked, or the phone left the team) or another save error turns the sync chip red ("N not saved", tap says why) until
a later save reaches the team; Log out also warns about them. Before, a no-hospital patient showed "Synced" and a
refused save only toasted. `friendly(e, ctx)` words errors by place: `'save'` and `'pacu'` (a stopped link says "This
link has stopped working. Ask the study team for a new link."). `pacuPush` uses `updateDoc`, not a merging `setDoc`:
a save onto a stopped link would otherwise become a create, which the rules refuse as "Not allowed" (a likely cause of
the 13 Oct nurse failure, not proven).

### Delete / restore and alerts
`markDeleted` and `restore` (store.js) give each delete and restore a time later than the last one seen, so delete,
restore, delete, restore always works, even from a phone whose clock is behind (the old restore wrote the same value
`1` again, which `setVal` skipped, so the second restore did nothing). Lock times never go backwards either.
Due alerts now repeat every 2 minutes while a reading is due and unsaved, for 10 minutes after its time (the banner
says "overdue" after 5), and a phone that slept checks the moment it is back in front. The `nag` key (last buzz per
reading) replaces `alerted`. Still only while the app is open: a lock-screen alarm needs a push server.

