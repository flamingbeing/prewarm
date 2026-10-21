# Scan the paper form (v3.2) into the study workbook

Phone photos of filled-in paper pages → checked values → the same Excel layout the app exports. Local tool: no scans,
no form, no outputs go in git (the repo is public), and nothing is sent anywhere except small crops of **numbers and
times** to Claude for reading. IDs, dates, names, signatures and free text are never cropped to the API, and nothing in a page's header band (the table row holding "Subject ID" / "Date of Entry" in the blank form, found for each
page by `boxes.header_bottom`) is ever cropped; you type
those in the review screen.

## How it works

1. **Find every field** (once per form version). `setup-form.sh` asks the app's own Form view (`js/wordform.js`) to fill
   the blank form one field at a time, renders each, and sees which printed characters appeared. That gives every
   field's place with no hand-made coordinates, and it follows the form whenever `wordform.js` changes.
2. **Line up the photo** (`align.py`): finds the sheet, flattens it onto the blank page, refines with ECC, then finds each
   printed table's own row and column lines in the photo and pulls them onto the template's (a long table over a phone
   lens), and scores how well the printed lines match. A low score rejects the photo: retake it.
3. **Read the page** (`scan.py`):
   - ticks: the slash or cross through each box (`ticks.py`), ticked / empty / unsure; fields whose answers are
     written (Y / N columns, thermal sensation) are read as handwriting, found automatically from the form;
   - handwriting: crop the cell, ask Claude twice (different framing, 2× scale), accept only if both reads agree;
   - checks (`plausible.py`, `scan.py`): ranges (skin temperatures down to 20 °C), 24-hour times, whole numbers,
     option letters, core temperature jumping >1 °C (skin >6 °C) between neighbours, systolic above diastolic, two ticks
     in one question. Anything off is flagged; values with no known range are not. An arrow or ditto ("same as above"),
     and an empty cell an arrow runs through, takes the reading above it in the same column (noted in the review screen);
     an arrow with nothing above it stays flagged. An arrow is found from the ink before any reader sees the cell (a stroke
     running nearly the whole cell height), so a model never turns one into a number. A cell with ink read as empty is
     flagged, and so is a Y / N cell with two marks side by side (a crossed-out answer).
4. **You confirm** (`review.html`): flagged fields first, the photo crop beside each reading. Only values you confirm
   are saved to `patient.reviewed.json`.
5. **Export** (`export-scan.mjs`): reviewed files → the workbook through the app's own `workbook()`, same 572 columns.

## Use

```
pip install opencv-python-headless pdfplumber anthropic        # once (anthropic only for the Claude reader)
# the live reader needs an Anthropic API key (not included in Claude Max): keep it in a private file outside the repo and give
# it to this one run with --key-file (never commit it; do not set it as a user-level environment variable)
sh prewarm/tools/scan/setup-form.sh blank-v3.2.docx form-data   # once per form version
python3 prewarm/tools/scan/scan.py --form-dir form-data --out scans/pt01 --key-file ~/private/anthropic.key photo1.jpg photo2.jpg ...
# open prewarm/tools/scan/review.html, load scans/pt01/scan.json, check, Save reviewed file
node prewarm/tools/scan/export-scan.mjs study.xlsx pt01.reviewed.json pt02.reviewed.json
```

Photos: whole sheet in frame on a plain surface, even light, one page per photo, any order. If a page is picked wrong
or rejected, say which page each photo is with `--pages 7,9,1` (one number per photo, in order). A page that falls just
short of the 0.80 alignment score is still accepted when every table on it fits the printed lines (0.85 or better on its
own) and the page scores 0.70 or better; it is marked `check_alignment`. `--min-align 0.75` lowers the bar to test a page
(its crops then need checking). `scan.json` per-option ticks carry `inks` (inside the box) and `centers` (the middle of it).

**Local model, no Claude** (`--reader ollama`): the crops go to a vision model in [Ollama](https://ollama.com) on the
same computer, so nothing leaves it. Same two reads and agreement rule; `--model` (or `SCAN_MODEL`) picks the model, which
must accept images (`ollama show <model>` lists "vision"; default `gemma4:12b`, about 1.5 s per cell on a 16 GB Radeon
with thinking switched off, as the reader does; a model that ignores `think: false`, such as the thinking build of
`qwen3-vl:8b`, is slow). Measure it before trusting it:
`python3 bench.py --form-dir form-data --crops crops/ --truth pt01.reviewed.json --model <model>` reads crops exported with
`--export-crops` whose values a person has confirmed, and prints how many were right, flagged (sent to the person) and
WRONG (unflagged and wrong: the number that matters). It prints counts and field ids only.

**Without any model reading** (Claude Max has no API): three ways, see [READ-CROPS.md](READ-CROPS.md).
`scan.py --export-crops crops/ ...` aligns the photos, reads the ticks, and writes every handwritten crop to `crops/` with
a manifest and numbered contact sheets; a Claude Code session or a person reads them into `readings-a.json`; a second,
independent pass (the bigger `b-NN` sheets, a fresh session) into `readings-b.json`; then
`scan.py --readings readings-a.json --readings2 readings-b.json ...` compares the two and flags every disagreement. With only
`--readings` there is one read and no second opinion; with `--no-read` the person scanning types every written value in the review
screen.

**The template must look like the paper.** Field places and the alignment template are rendered from the blank `.docx`. If
the render is not the same layout as the printed paper (different fonts, different row heights, a different page
count), alignment scores drop and printed text leaks into the ink layer, which makes ticks unreliable. Check: the
template pages should say "Page n of 14" like the paper. Fix: render with Microsoft Word itself (`pip install docx2pdf`,
then `RENDERER=word sh setup-form.sh ...`), or with LibreOffice after installing the Carlito font (Calibri-metric).
`scan.py` prints a warning, and puts `template_mismatch` in `scan.json`, for a page whose ink layer is full of printed text.

`readings.json` entries may be text or `{"text": "34.0", "legible": false}`: use the second form for a cell that is hard
to read, so it is flagged "hard to read".

**Windows**: run the shell steps in Git Bash; the tool needs `soffice` (LibreOffice) and `pdftoppm` (poppler) on PATH. Use
`PYTHON=python sh setup-form.sh ...` if `python3` is the Store stub. `setup-form.sh` uses all cores (`LOCATE_JOBS=n` to
change); it prints why any field was not placed (the paper form has no per-reading BP / HR / BIS grid, only a "Vital Signs Data Collected" tick, so `haemo_*` readings after the baseline are rightly unplaced). The model is Sonnet by default; `SCAN_MODEL=claude-opus-5-5` for hard pages.

## Tests (all fake data)

- `node prewarm/test/scan-export.test.mjs` (in CI): reviewed values → the right workbook cells.
- `python3 grid_test.py` (a table whose rows and columns are not where the template says is warped back onto it)
- `python3 unit.py` (the small rules; no photos needed)
- `python3 test.py <dir>` (alignment + ticks on synthetic phone photos) and `python3 e2e.py <form dir>` (whole read
  with a stand-in reader, one deliberate misread that must be flagged). Needs OpenCV, LibreOffice, `pdftoppm`.
- `node prewarm/tools/scan/review.e2e.mjs <scan.json>` (review page at phone size, axe), static server on 8080.

## Where it stands

Tried on a handful of real pages with a stand-in reader (a person-equivalent reading the saved crops, via
`--export-crops` / `--readings`): alignment, ticks and crop placement all held, and every misread was flagged (trial
numbers are in the owner's private notes).

**The live reader (`readers.AnthropicReader`) has never run, so its accuracy and cost are unmeasured.** It is shelved
for now; every reading so far was a stand-in, and both reads in a stand-in run are the same text,
so there is no second opinion. Check a sample of temperatures against the paper.

Still to prove: a "No pre-warming" patient's page 4 (the option whose tick also ticks "Not applicable"), other handwriting and other patients (a bigger batch), and the live reader.

## Receiving phone uploads (study computer)

`python inbox.py` (bound to 127.0.0.1; `SCAN_INBOX` folder, `SCAN_PORT` default 8788) receives the photos the app's Scan pages
screen sends through the Worker (`worker/scan.js`) and Cloudflare's tunnel: `SCAN_INBOX/<scan>/page-<n>.jpg|png` plus `meta.json`
(who, when, the Subject ID typed on the phone). A new photo removes `import-error.txt` so the reader tries again. Its status
route answers the phone from `status.json` (below): per page received / reading / read / retake (why) / approved / rejected,
the page the study computer found it to be, its score and value and flag counts; numbers and states only, never values.

`python watch.py` (also on the study computer; needs Ollama, `gcloud` signed in as the owner, and `SCAN_FORM_DIR` from `setup-form.sh`) waits until a received
folder has been quiet for `SCAN_QUIET` seconds (90), runs `scan.py --reader ollama` on it, and files the values and flags with the Subject ID from the phone and each value's form page and place on it (`box`, fractions of the page; no photos, crops or labels)
as `scanImports/<scan>` in `prewarm-study` with status `pending`, using gcloud's token (so no app user can create one). The phone's page
numbers go in as `--hint-pages`: kept unless another page lines up clearly better, so a page shot out of order is put right (and the
phone moves it to its slot). Photos that arrive after a read (a retake, a late page) are read on their own and filed as `<scan>-2`, `-3`...;
an import is never overwritten. `status.json` in the folder records each photo's result (and, every 5 minutes for 14 days, the review state of
each pending import); `imported.json` notes the last import; three failures on the same photos write `import-error.txt` (a new upload, or deleting it, retries). An admin approves it in the app (Settings › Scan imports):
choose the patient, tick the values to save; flagged values and ones that would replace a saved value start unticked. `python3 watch_test.py` checks it on fake data.
`python3 inbox_test.py` checks its rules on fake photos. The inbox folder stays out of git.
