# Prewarming study app: readings, alerts and entry

How readings are entered, saved, alerted and exported; edge cases and tests. Part of the notes index in [NOTES.md](../NOTES.md).

- **Readings to enter live:** (the Settings section was removed; settings v3 resets every hidden column, so all are always entered live) all on by default, BP / HR / BIS every 15 min included (settings v2
  turned it on once for phones that had it off).
- **Export Excel** is in Settings, not on the home page.
- **Readings saved ahead of time**: a reading opens on the latest due timepoint still unsaved (else
  the next one), and saving one more than 3 min before it is due asks first (probably the wrong timepoint, and the
  real one would never be asked for). Tests that type key times use times relative to now: a fixed clock time
  reads as the next day's once the test runs over 12 h later (`nowFor` picks the nearest day).
- **Long reading numbers**: `fitNums()` shrinks a reading's number until it fits its box (CSS
  container units didn't work under the app's zoom); checked at 320 and 390 px, zoom 1 and 1.25.
- **Two patients at once**: the next patient pre-warms while the last is in surgery, so due alerts
  cover every patient being charted that was opened on this phone in the last 12 hours (not deleted, locked or
  complete; a teammate's patient synced from another theatre doesn't beep here), other patients' alerts start with
  their Subject ID, the screen stays awake on the home list too, and the home list shows each one's reading due within 2 min,
  now or late. The top bar's countdown also shows the other tab's reading once it is due.
- **Unsaved readings survive the app closing**: as a reading is typed (including a temperature with
  the keyboard still up), it is kept in localStorage (`unsaved:<patient>:<series>:<timepoint>`); reopening that
  reading brings it back with a toast, unless any of its boxes was saved since. Save or "Don't save" clears it.
  Toasts let taps through (`pointer-events: none`): they sat over Log, Back and the tabs for 2.6 s.
- **No BP, HR, BIS alarm**: only temperatures and Prewarm off beep, buzz and show the banner.
  BP, HR, BIS due times still show in the top bar countdown and on the tab.
- **Temperature page**: "Core (spot on)" spans both columns, then chest + arm, then thigh + calf.
  One tap on a number opens its box for typing; tapping elsewhere on an empty card fills the starting value (core
  36.5, skin 31.0, room 20.0). The first intra-op reading starts from the last pre-warming one. "Clear all boxes"
  empties the draft (on a saved reading it removes the reading after asking). The strip reads Arrival, then
  "Prewarm on" / "Induction" for 0, then "5 min"…; "Clear" beside a comfort answer. BP, HR, BIS due alarm is a
  Settings toggle, off by default (`settings.remind.haemo`).
- **Quick-entry pads** (`js/keypad.js`): tapping a temperature, BP, HR or BIS box opens a number pad
  (Back, Clear, OK; BP, HR, BIS also Next); tapping a key time opens a time pad (Now, digits: the fourth digit saves,
  731 = 07:31; Back, Clear asks first). The display is a real input (`inputmode="none"`), so a computer keyboard
  works (Enter = OK, Esc = Back) and Playwright `fill()` still works: tests fill `input.num` / `#evtime` and press
  Enter. Tapping an alarm banner goes to that reading's screen only; the top-bar countdown also opens
  its first box (or the key time's pad). PACU in / To ward are on the PACU page only (not in the key-times row or the Log button); Still to fill
  lists them once surgery has ended. The tap guard (`lockTaps`) also runs after a pad saves, so tests wait 0.8 s.
- **Due time warms up**: the "due hh:mm" beside each timepoint is plain until 2 min before,
  then an amber pill with a slow pulse (soon), an orange-red pill with a stronger pulse from due to 5 min past (now),
  and a red pill with a fast pulse after that (late); plain once the reading is saved. Reduced motion: colours only.
- **Bug hunt**: "Update available" (and an update taken in another tab) asks to save an unsaved
  reading before reloading (`afterAsking`). Tapping an empty key time while an earlier key time is still empty asks
  first (a stray Surgery end would stop intra-op readings counting as due); Log next always goes in order. Key times
  going backwards (over 12 h counts as past midnight) are listed in Still to fill as "Times out of order".
  Follow-ups: `isShown` also needs the question's own question shown (a follow-up of a follow-up hides when the first
  answer is No), and a hidden follow-up's stored value is left out of the Excel and Word exports (`shownValue`; kept
  stored, so switching back brings it back). BMI is worked out from weight and height like the TXA total (unless
  typed). The no-pre-warming group exports NA for active warming start. Perioperative data starts with "Subject ID
  and group" to correct mistakes: the ID can't be blank or a duplicate; the group asks first and can't be cleared.
  Save refuses an all-blank reading (it would stop the timepoint counting as missed) and asks when some boxes are
  blank; saved readings with blank boxes and readings hidden in Settings are listed in Still to fill.
  Typed form answers (Intra-op details, PACU, Perioperative data): letters refused where a number is asked; a
  temperature outside 25–45 °C asks first; 366 reads as 36.6 (`typedValue`). Due alerts (banner, vibrate, beep) run on
  every patient screen for every series (a BP reading falling due on the Temperatures tab or a form alerts too), and
  the screen-awake lock is taken again after switching apps (`startAlerts`, started from `topBar`).
  Sync: the server keeps whichever write arrives last, not the newest, so `watch()` heals: any
  field this phone holds newer (`t`) than the copy it just heard is sent again; both phones and the server settle on
  the newest (proven in the emulator test: without it, server 60 / A 60 / B 70). On the first server word each
  session, patients the server never had are sent whole, and pending entries from an earlier session are dropped
  (they were just re-sent if still newer). Save sends only the boxes that changed (plus the save time); a reading
  changed on the other phone while open here asks before writing over it (Cancel shows theirs). `push` always sends
  `auto`, so a typed BMI / TXA total / NuDESC isn't recalculated over elsewhere. A member's patient locked with
  unsent changes stays on the phone with a warning. Clearing a time asks first; an emptied time picker doesn't clear.
  The home list flags two records with the same Subject ID (same site): readings may be split. Locking warns about
  patients changed in the last 3 hours and not marked complete. A failed local write shows a sticky red bar
  (`#storefull`) instead of a toast that "… saved" would replace. A team listener refused right after a wrong join code
  rechecks membership and stops quietly (it used to overwrite "That code isn't right" with "Not allowed").
  A reading first saved more than 5 min after it was due asks what time it was taken (due time filled in; `askTime`):
  that time is the reading's time on the Word form and Readings sheet. A saved reading shows "Taken hh:mm (saved by
  XX) · Change time". `fullcase.e2e.mjs` runs a whole case per group and checks every op-day cell is exported.
  Delete / restore: a patient is gone only if deleted after its last "restored" field (`isGone` in store.js; no rules
  change). Settings › Delete participants lists deleted ones with Restore (to every phone in the team). A deleted
  patient can't be opened (back to the list with a note), so nobody charts into a record the export leaves out.
  Prewarm off falling due alerts like a reading (banner, vibrate, beep); alerts due in the same second share one
  banner, with three loud beeps (sound resumed on every tap, as phones suspend it after an app switch). AF "specify"
  on discharge is New onset / Existing (chips), so it always ticks the Word form.
  Underbody / gown warming yes / no: a reading due after its logged start time defaults to Yes until someone picks;
  saved readings still saying No after the start are listed in Still to fill.
  Taps (UI stress test): after a tap that moves or redraws the screen (Save, Log, a time box, a comfort
  answer) a second tap within 0.7 s and 48 px is ignored (`lockTaps`): a double tap used to save the next timepoint
  too or log the next event. "Tap again to delete" ignores a second tap within 0.6 s. `render()` blurs a box being
  typed in first, so a swipe or the phone's back button commits it (the leave prompt sees it; a form answer saves).
  A typed temperature goes back in place at once and the screen redraws 0.4 s later (a full redraw swapped Save
  under a finger already on its way, so the first Save tap was lost). The due banner floats over the page under the
  bar (`showBanner`) instead of pushing it down. Comfort answers change but don't clear on a second tap.
- **Nothing easy to miss intra-op**: intra-op Baseline (temps and BP / HR / BIS) is due at In OT,
  End at Surgery end, so the top bar asks for them and they count as missed. "Still to fill" (`gaps()`, patient
  screen above Mark data collection as complete, refreshed every second) lists readings missed by over 5 min (link to
  the first), essential times skipped, warming marked Yes with no start time, Induction not logged 20 min after In OT,
  Intra-op details / PACU unanswered once Surgery end / PACU in is logged, and the comfort questions. Intra-op details
  and PACU boxes show "n to answer". Mark data collection as complete lists the gaps and asks first.
- **Edge cases** (stress test; `prewarm/test/edge.e2e.mjs`): times are minutes after midnight, so every
  "now vs due" compare uses `nowFor(p, s)` (the clock on the same day as the series' start): a case past midnight
  counts right. Readings due after their stage ended (into OT for pre-warming, surgery end for intra-op temps and
  BP) aren't counted as missed, alerted or counted down (`expected`). BP / HR / BIS / room temp: numbers only;
  outside usual ranges (`SANE`) Save asks first. Leaving an unsaved reading: each history entry carries `state.i`;
  back / a link is stepped back while the prompt is up and redone after, so the phone's back button never leaves the
  app past an unsaved reading. The automatic set-temp NA (after Log Prewarm off) doesn't count as a change.
- **BP, HR, BIS are typed boxes**: no − / + (the numbers are big); plain boxes that stay boxes
  (no redraw while typing), so tapping the next box or Enter ("next" on the keyboard) keeps the keyboard up. Save as before.
- **Ask before leaving an unsaved reading**: readings (temperatures, BP / HR / BIS) still save only
  on Save (carried-over values count once someone confirms them; no auto-save). Changing a value and then leaving
  (another timepoint, ‹ ›, the tabs, BP, HR, BIS, back, Sign-off, a team update) asks "Save the 5 min reading?": Save /
  Don't save / Stay here (`leaveGuard` + `askLeave` in `render()`). A team update doesn't redraw over unsaved changes;
  the "New readings" bar shows instead.
- **Defaults on tap:** an empty room temp becomes 20.0; an empty temperature becomes 36.5 (anywhere on its card) (then + / −, or tap again to type); an empty time becomes now.
- Gown set temp follows "Warming off" (NA for later timepoints) until someone picks a value on that screen.
- - **Entry screen:** option B ("change what moved"): values carry over from the last saved timepoint; + / − nudges;
  tap the number to type ("365" → 36.5). Hidden readings (Settings) stay blank.
- **Last warming reading**: Save on the 10 min reading (arm 2) or the 30 min one (arm 1) marks
  Pre-warming temps complete (`sign_prewarm`, needs initials) and opens the intra-op temps. Undo the tick to edit.
  Once complete, `pointsFor` drops the later 5-min points (past 10 / 30 min) unless already saved, so they aren't
  asked for or listed in Still to fill; their export cells stay blank.
- **Defaults in light grey**: a temperature or choice that is only carried over from the last reading
  (or filled by a rule: gown set NA, underbody / gown Yes) and not yet saved for this timepoint has the `dflt` class
  (grey text, grey pressed chip). Saving makes it normal. The later warming points (past 10 / 30 min) are also dropped
  once that last warming reading is saved, even without initials (`pointsFor`).
### Export NA, file name, safer updates
- **Export:** pre-warming reading cells past the warming (after 10 min in the 10 min group, after 30 in the 30 min
  group) with nothing saved export as `NA`. The no-pre-warming group and a patient with no group stay
  as before; the Downloaded columns stay empty. `WARM_MIN` now lives in schema.js. A typed decimal comma ("37,5") exports
  as a number. The file is named with the phone's local date and the patient count (`prewarming-study-2026-10-14-3pt.xlsx`);
  it used the UTC date, so a Singapore phone before 8 am got yesterday's.
- **Updates:** the service worker's install is all-or-nothing for the app's own files (one failed download fails the
  install, the browser retries, the phone keeps the old complete copy); Firebase SDK files stay optional. The 3 s
  fallback only clears the saved copy if `sw.js` can be fetched right then. Base `prewarm-v79`.

### The number pad chains through the boxes
On the temperature and BP/HR/BIS screens the pad has a Next button for every box that takes a number (not the gown set
temp or yes/no boxes), and three digits of a temperature (like 366) save it and open the next box's pad by themselves:
about 5 taps fewer per reading. Back closes the chain. Edge tests close the next pad after a 3-digit entry. Not done: the
late-reading time still uses the browser's `prompt()` (`askTime`), because the save flow waits for its answer.

### Off-protocol note
Intra-op details ends with a free-text "Anything unusual or off-protocol" (`io_dev`, exported in the Extra sheet): a
missed reading and why, a monitor fault, warming stopped early. A fuller deviation form (codes, per-reading reasons, a
log of group changes) is still open and needs the study team's wording.

### Carried-over measurements are not saved 
A temperature (core, chest, arm, thigh, calf) or BP / HR / BIS that is only the grey carried-over value, untouched, is
left out on Save (it is never stored as a new reading). Typing it, tapping the value and OK, using a stepper or tapping the
box to fill it all count as confirming it (`touched`; the grey goes away). Saving with some boxes still blank asks
first, as before, and a reading with nothing but carried boxes is the "blank" case. The set temp, warming Yes / No and room
temp still carry as before. Tests confirm grey boxes first (`confirmDefaults` in edge.e2e, the fullcase `temps()`).

