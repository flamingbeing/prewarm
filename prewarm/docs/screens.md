# Prewarming study app: screens and forms

How the patient screen, key times, sign-offs, forms and look work. Part of the notes index in [NOTES.md](../NOTES.md).

- **Screens follow the day**: opening a patient lands on one main screen: the event times as a
  compact grid (tap an empty one = now; tap a set one to change or clear it), then all temperatures with a
  Induction room / Intra-op switch (opens on Induction room until the patient is in OT, for every group), then links to the other forms in the
  order they're filled in (BP/HR/BIS, intra-op details, PACU, satisfaction, form view).
- **Induction room tab** (owner, 21 Oct 2026; was the Pre-warming tab): general induction-room things plus the
  pre-warming temperatures. Start on a new patient opens it, in every group. The internal route stays `prewarm`.
- **Email and PayNow** button under consent on the Induction room tab (owner, 21 Oct 2026): its own page; details in
  [sharing-and-sync.md](sharing-and-sync.md).
- **New patient** (owner, 21 Oct 2026): Start needs the Subject ID and group. **Save draft** and **Patient declined**
  need only the Subject ID (declined sets `consent_st` 0). **Share subject** / **Share to PACU** save a draft first, so a
  case can be shared before it starts. A draft (no group, not declined) shows "Draft" with a dashed edge on the list and
  reopens the form (`#/new/<id>`); it has no POD due lines.
- **Home list order** (owner, 21 Oct 2026): by Subject ID, largest on top, numbers compared as numbers (S-10 above S-9).
  "All but X (latest)" still means the latest edited.
- **Consent** (owner, 21 Oct 2026): first on the Induction room tab (moved from Pre-op), `consent_st` (Extra sheet):
  1 = consented, duplicate form given to the patient; 0 = declined to participate. Shown in place of the comfort
  question until answered (one card tall, so Save stays on screen); once consented, the comfort question shows with
  "✓ Consented · Change" on its label line; a declined patient is asked nothing more there. A declined patient's home-list line is grey, the ID struck through,
  "Declined to participate". The Screening ID is no longer asked (`NOT_ASKED`); its column stays.
- **Home list Share and PACU buttons** (owner, 21 Oct 2026; replaced the admins' Form view icon): stacked at the right of
  every card except declined ones. Share opens Share subject, PACU opens Share to PACU (`#/p/<id>/share/h`,
  `/pacushare/h`: back returns to the list). Both are fixed links per participant: the subject link is the hospital's join
  code plus the patient (it changes only if an admin makes a new join code); the PACU nurse link is made the first time
  its page opens and then stays the same on every team phone; only an admin can stop it.
- **Email / PayNow** button beside New patient (owner, 21 Oct 2026; was PACU view): admins go to the payments list,
  team phones to a list of participants that opens each one's Email and PayNow page. `#/pacu` (PACU view) still works.
- **Tapping a patient** (owner, 21 Oct 2026) opens the first section in the tick order that isn't ticked: the chart while
  a temperature section is open, then BP, HR, BIS, Pre-op, Intra-op details, PACU, POD1 / POD2 / Discharge once their
  day has come, then Email and PayNow (`nextHref`). Completed patients open the chart (after the warning tap).
- **Notes** on Intra-op details is a full-width text box (`long: true` fields). On PACU (and the nurse's page) the five
  comfort answers are two per row with Neutral alone in the middle (`roomy`); the Induction room tab keeps them in one row.
- **Patient comfort** (owner, 20 Oct 2026): the before-surgery question is at the top of the Induction room tab
  (after consent), the after-surgery one at the top of the PACU page (no separate screen); one line once answered; Still to fill links to
  each question's screen. "Sheet view" (was Spreadsheet view, earlier Form view) is a text link under the other forms.
- **Look:** the NUHS design system's app theme (`nuhsdesign/tokens.css`, Open Sans): white app bar with the four-quarter band (orange / red / stripe
  blue #178fd7 / navy), grey #f3f3f3 ground, white cards with 14px corners and hairlines, 10px controls, navy as the
  only accent (Save, selected chips, active tab), bold navy titles, 44px tap targets, dark toast at the top.
  Links are navy (link blue is under 4.5:1 on the grey page).
- **One screen per timepoint**: the main screen fits a 390 × 844 phone down to Save without
  scrolling (e2e checks it): − value + on one row, chip rows with the label on the left, the "set the start time"
  hint in the due slot. Patients are deleted only on Settings → Delete participants, nowhere else.
- **Timer and next event**: the patient screen's app bar shows a running timer (from warming on,
  else gown on, during pre-warming; from induction, else in OT, intra-op; the clock time before either) and the next
  event to note (the first unset of gown on, warming on, warming off, in OT, induction, surgery end, PACU arrival,
  to ward, after the last one set; warming off shows its expected time, 30 or 10 min after warming on).
- **Quick controls**: a navy Log button in the app bar (main screen, BP / HR / BIS, intra-op details and PACU, with the timer) sets the next event to now (it replaced
  the Spreadsheet view icon; Spreadsheet view is the text link at the bottom). Big ‹ › buttons either side of the tabs
  and timepoint strip go to the previous / next timepoint. Event time boxes are squarer, six per row (two rows).
- **Mark data collection as complete**: one button at the very bottom of the patient's main
  screen (below the links and a divider, so it isn't tapped by accident), stored as `done` ("AB 12 Oct 2026 14:20").
  Once marked: a green line at the top of the main screen and "✓ Data collection complete" in the patient list; Undo at
  the bottom. In the patient list, tapping a completed patient warns first (amber row: who marked it and when); a
  second tap opens it. The Word form's sign-off lines use it on op-day pages with data that have no sign-off of their own. The
  per-section sign-offs stay on the BP / HR / BIS screen and the other forms.
- **Patient screen layout**: key times at the top on both tabs, then the Temperatures / Others
  tab bar, then the tab's readings; the bottom part (Intra-op details, PACU, Perioperative data, Form / Sheet view,
  Still to fill, Mark complete) is the same on both tabs. The no-pre-warming group keeps the Induction room tab
  (consent, comfort) with a note that there are no pre-warming temperatures. Intra-op time 0 is induction (`io_knife`, labelled Induction; the paper form's row reads
  "Knife-to-skin start time (Induction)").
- **Three parts, reset, PACU view**: the patient screen has three bordered parts with their
  own backgrounds (key times blue-grey; tab bar and readings; shared bottom part beige). Swipe changes tab only in
  the middle part (a touch starting on a −/+ button is its hold-to-repeat, not a swipe). The second tab is named
  "BP, HR, BIS". "Reset this subject" (small, bottom part) asks twice, then clears every entry except the Subject
  ID, group and hospital, on every phone. PACU view (`#/pacu`, no longer on the home page): tapping a participant opens only their
  PACU page (to hand the phone to the PACU nurse); back returns to that list.
- **PACU page times; temperature ticks**: the PACU page starts with PACU in / To ward boxes
  (tap logs now, tap again to change) so the PACU nurse logs them there. The Temperatures tab has "Mark pre-warming
  temps complete" (not for the no-pre-warming group) and "Mark intra-op temps complete" (`sign_prewarm`,
  `sign_iotemp`, already in the export and the Word form).
- **Complete means closed**: a section marked complete (pre-warming / intra-op temps, BP HR BIS,
  Intra-op details, PACU) is read only for everyone until its tick is undone (Undo asks first); its due alerts and
  countdown stop. "Data collection complete" closes every op-day screen (key times, Log, readings, forms) but not
  Perioperative data (filled in later from the chart). Each temps tick shows only on its own sub-tab.
- **Progress and Perioperative data tick** : the patient list shows a
  list of ticks on each patient in the patient list (read only; they mirror the existing complete ticks, in this order: pre-warming temps, intra-op temps, BP HR BIS, Pre-op,
  Intra-op details, PACU, POD1, POD2, Discharge, and PayNow, ticked once the email and PayNow are saved, not for declined patients). Perioperative data has its own tick (`sign_periop`, exported as
  "Complete: Perioperative data") that locks only that page; "data collection complete" does not lock it.
- **Warming time labels**: Gown on (pre-warming gown put on), Prewarm on, Prewarm off, Underbody
  warm, Gown warm (the intra-op Bair Huggers). Those are all the Bair Hugger items on the paper form. They are coloured warm
  lavender once set (`.tchip.warm.set`: #ebe5f7, labels #4f2f86; was beige, too like the amber "due soon" alarm; light grey #e6e6e6 until tapped, labels #50565c); the
  other times stay blue. The time boxes are numbered in the order they happen (1 Gown on … 11 To ward; renumbered
  without the pre-warming ones for the no-pre-warming group), a small number in each box's top corner.
- **Two tabs**: a thin tab bar under the top bar on the patient screen: **Temperatures** (the
  main screen: times, pre-warming / intra-op temps, comfort, Form view / Sheet view) and **Others** (BP, HR, BIS,
  plus the Intra-op details and PACU boxes and a full-width **Perioperative data** box, formerly "Other data"). The tab you're not on warms up and pulses when its next
  reading falls due. "Still to fill" and Mark data collection as complete are on both tabs. On Others, the BP, HR, BIS tick sits right under the readings, above Intra-op details (it covers only the vitals).
  Swipe left / right on either tab to switch. Pull-to-refresh is off (`overscroll-behavior-y: none`). Intra-op
  details, PACU and Perioperative data go back to the Others tab. Sign-offs name their section ("Mark BP, HR, BIS complete", "Mark PACU
  complete"…) and show a ticked green box with who and when once marked (`tickHtml`).
- **Top bar**: the next thing to log and a countdown, centred between the title and the sync chip: the reading due most recently
  on this screen (Temp or BP, until the next is due) or the next one, or warming off, whichever is first ("Temp 20 min · in 1:42" /
  "now" / "late 5:29"), coloured and pulsing like the due time; before anything is due (no Prewarm on / Induction yet) there is
  no countdown. The "Time now" clock was removed on 20 Oct 2026 (owner). Then the sync chip. The old "Prewarm + 12:34" elapsed timer is gone.
- **Other data**: a small box beside Form view / Sheet view opens the remaining template pages
  (pre-op, pre-op medication, pre-op investigations, day 1 and 2 chart review and analgesia, discharge) on one page
  (`#/p/<id>/data`), each a collapsible header (folded except the first unfinished one, owner 21 Oct 2026; Enter past a section's last
  question unfolds the next) over every field in template order (`OTHER_PAGES`; no
  sign-off). The box has no caption. Keyboard entry on a computer: Enter / ↓ next question, Shift+Enter / ↑ previous;
  on a row of choices ← → move, Enter picks (never clears) and moves on, Space picks or clears; date and time boxes keep
  their own arrow keys. At ≥700 px each label sits beside its box. The main screen stays the op-day bedside screen.
- **Vital signs data collected** (paper form, intra-op readings page; no template column): ticked on the Word form
  once any BP / HR / BIS value is in; the BP screen says so. The BP, HR, BIS box on the main screen warms up and
  pulses like the due time for its next 15-min reading (misses older than 15 min are let go).
- **Screen size** (Settings, this phone only): Smaller / Small / Normal / Large / Larger zooms the whole app
  (`--ui-zoom` on body). Normal by default.
- **Form view**: the study's real paper form (data collection form v3.2, .docx) with text put in:
  ☐ → ☒ (and the Word tick box's checked flag), values over the blank lines and into empty cells, Subject ID on every
  page, Date of Entry and the sign-off (Name, Date) on pages with data; every page kept, unfilled ones blank.
  "Download Word file" gives the exact file; "Save as PDF / Print" shows it with docx-preview (Calibri via Carlito) and
  prints. docx-preview doesn't paginate like Word, so a long section can run onto an extra printed page.
  - The blank form is uploaded once by an admin (admin screen) to `forms/blank` (base64; members and admins read it;
    Firestore keeps a copy for offline use). Its file details (creator, last edited by, company) are removed on
    upload; never commit the form (staff name in its file details). The upload lists places the map didn't find.
  - Without an uploaded form (or not sharing), the Form view shows the older simple HTML version. Demo: choose a blank
    .docx on the Form view; it stays in that browser tab.
  - Subject ID: one character per box; longer IDs get the five boxes merged into one.
- **Perioperative data in four parts**: on the patient screen Pre-op sits left of Intra-op details and PACU, and
  POD1, POD2 and Discharge share the line under them (21 Oct 2026). Pre-op (`#/p/<id>/data`: Subject ID and group,
  pre-op, meds, bloods; tick `sign_periop`, label "Pre-op and patient details"), POD1 (`/data/day1`: chart review,
  analgesia; `sign_pod1`), POD2 (`/data/day2`: chart review, analgesia; `sign_pod2`) and Discharge (`/data/dc`;
  `sign_dc`, split from POD2 on 21 Oct 2026: patients whose POD2 was ticked before then show Discharge unticked).
  Every section starts open. Questions and order unchanged (`DATA_PARTS` in ui-data.js). Each tick locks only its page;
  "data collection complete" closes none of them. Progress ticks on the list and the export's "Complete: …" columns
  (Extra sheet) have all four.
- **Thermal Sensation Scale**: the study's original table (scale, words, comments) sits under Save on a pre-warming
  reading, the picked row marked; under Save so Save stays on a phone screen.
- **Email and PayNow** button: under the consent line on the Induction room tab, once consent and the before-surgery
  comfort question are answered.
- **Read only hides empty timepoints**: once a section is marked complete (or data collection is),
  `pointsFor` shows only the timepoints that have a time or a reading (all, if none has), so no time is offered for
  logging and the strip has no empty tabs; opening a hidden one goes to the default point. The bottom of Settings and
  home shows the app version (the saved copy's name) to spot a phone stuck on an old one.
- **"Subject ID:" label**: patients are named "Subject ID: 85" in the patient list, PACU view and
  delete lists (`sidL`), and the app bar shows a small "Subject ID" above the ID (`setTitle`) so it doesn't crowd the
  countdown and Log. The PACU nurse's page keeps its own "PACU · ID" title.
- **Patient list tools**: admins get a Form view icon on every line (`.formlink`, beside the
  card). "Select to export" (everyone) beside "Select to lock" (admins): tick cases, "Select all" / "Select none" chips,
  "Export N to Excel" (the same file as Settings → Export, for just those). In the lock view the chips (dashed, "All
  but the latest" / "Select none") sit on their own row above Lock / Unlock. The "Study IDs only" line was removed.
  "Downloaded" (pre-op `pre_dl` and day 2 `d2_dl`) is no longer asked (`NOT_ASKED`); its template columns stay empty.
### Done looks done
The bottom shortcuts on the patient screen turn solid green once their section is marked complete (no tick). The PACU
Mark complete is a full-width navy button. Day 1 / Day 2 are called POD1 / POD2 everywhere (the Word template's own
"Day 1" labels are unchanged).

### Done shortcuts also show a ✓
The green "complete" shortcuts on the patient screen also get a ✓ before the label (not colour alone, red-green colour
blindness), and their spoken label is "POD1, complete" instead of just "complete". Taller tap targets for the reading
tabs were tried and dropped: they push Save below the fold on a phone (the e2e test pins that).

### Patient list: POD due, search, unsent badge; runbook
The list shows "POD1 due today / overdue" and "POD2 ..." from the Surgery date field (else the day the patient was
started on this phone) until the section's Complete tick. A Subject ID search box appears above 5 patients (hides rows,
no redraw). A patient waiting to send, or whose save was refused, has a red "Not sent yet" / "Not saved to the team"
line. `RUNBOOK.md` is the one-page study-day routine for the team.

### Ready for a case? card
Top of Settings (when sharing is available): ✓ / ✗ rows for online, initials, on a team, hospital set, nothing waiting
or refused, synced in the last 15 minutes, app up to date, each with what to do. It only reads state the app already
keeps; it does not test the PACU link (do that by hand, see `RUNBOOK.md`). Checked in the sync emulator test.
Still to fill (patient screen) also lists "POD1 / POD2 chart review due today / overdue" with how many questions have an answer,
once due and not ticked complete.

### Less scrolling on the sub-pages
Hybrid, ease of entry first (a hybrid: ease of entry first). On a phone (under 700 px), on Intra-op
details, PACU, Pre-op, POD1, POD2 and the nurse's PACU page: boxes (numbers, dates, text) sit two to a row with the label above;
a Yes / No or 0 1 2 question keeps its own row with the label on the left and big buttons on the right (`.fld.short`, or two
chips by `:has()`); questions with 3 or more answers (ASA, Smoker, ECG, pain 0-10), long answers (`.fld.longopt`: GA
(Inhalational) / GA (TIVA), the adverse events list) and every non-question take the full row. No taps added, nothing
collapsed. At 390 px: Pre-op 5.0 to 3.2 screens, POD1 2.5 to 1.6, POD2 3.8 to 2.6, PACU 2.2 to 1.7, Intra-op 1.7 to 1.4. (All boxes
and answers two to a row gave 2.9 / 1.5 / 2.4 / 1.5 / 1.3, but smaller buttons: not worth it.) The Temp and BP, HR, BIS screens
are unchanged. An odd box before a full-width question leaves a half-empty row; `grid-auto-flow: dense` would reorder, so not done.

