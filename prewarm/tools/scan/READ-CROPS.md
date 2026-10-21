# Reading the handwritten crops without the API

For a Claude Code session (your Max plan; no API credits) or a person. `scan.py --export-crops DIR ...` writes, for one
patient's photos, the handwritten cells it found (numbers, times, Y/N, thermal sensation). Nothing in a page's header band
(Subject ID, Date of Entry), no IDs, dates, names, signatures or free text is ever cropped.

```
DIR/manifest.json     {field id: {label, type, unit, allowed}}: what each cell is and what it can be
DIR/a-01.png ...      contact sheets, 24 cells each: the crop, then under it the field id and its label
DIR/b-01.png ...      the same cells again, bigger and in a different layout (for an independent second reading)
DIR/<field id>.png    each crop on its own, for any cell that needs a closer look
```

## The reading (one person or session)

Read every cell on the `a-NN.png` sheets and write `readings-a.json`:

```json
{ "iotemp_5_core": "36.5",
  "iotemp_5_arm": { "text": "34.0", "legible": false },
  "iotemp_10_room": "ARROW",
  "iotemp_10_under": "N" }
```

Rules (they are what keeps the data right):

1. **Read only the handwriting in the middle of the crop.** Ignore printed text, lines, tick boxes and the edges of a
   neighbouring cell. A cell with nothing written is `""`.
2. **Write exactly what is on the paper**: digits and a decimal point for numbers (`36.5`), `HH:MM` for times (`07:05`),
   the letter for Y/N (`Y`, `N`), `-3` to `3` for thermal sensation. Do not tidy, round, convert or infer from the cells
   around it; do not "fix" a value that looks odd (the tool flags odd values for the owner to judge).
3. **If you are not certain of every character, say so**: `{"text": "<best reading>", "legible": false}`. A struck-out or
   overwritten number: read what it was rewritten as and mark it not legible.
4. **An arrow, a long vertical line or a ditto mark** ("same as above") is `"ARROW"`. Do not copy the value from above.
5. Use the `allowed` text in `manifest.json` as a check, not as a hint: never make a reading fit it.

## The second, independent reading (this is the second opinion)

Without the API there is no second read unless you make one. In a **fresh session or by a different person**, who has not
seen `readings-a.json`, read the `b-NN.png` sheets the same way into `readings-b.json`. Then:

```
python3 prewarm/tools/scan/scan.py --form-dir form-data --out scans/pt01 --readings readings-a.json --readings2 readings-b.json photo1.jpg ...
```

Wherever the two readings differ, the cell is flagged "two reads disagree"; a cell either reader marked not legible is
"hard to read"; a written cell missing from `readings-a.json` is flagged too. With only `--readings`, one reading stands in
for both and nothing can disagree: the review screen is then the only check (say so when you report accuracy).

## Or type it yourself

`scan.py --no-read ...` reads the ticks and finds every written cell, but leaves each value empty and flagged "type this
in (not read)". In `review.html` each cell shows its photo crop beside a box: type what you see and press Enter.

Either way: the owner confirms every value in `review.html` before anything is exported.
