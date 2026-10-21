"""Read photographed paper-form pages into a scan.json for the review screen.

  python3 scan.py --form-dir <dir with blank.pdf, fieldmap.json, fields.json> --out <dir> [photo1.jpg ...

Photos can come in any order; each is matched to its page. Writes <out>/scan.json (crops embedded, one file for the
review screen). Real scans and outputs stay out of git (the repo is public)."""
import argparse, base64, glob, json, os, subprocess, sys
import cv2, numpy as np
import align, boxes, ticks, readers, plausible

NEVER_SEND = {'text', 'date', 'word'}      # IDs, dates, names and free text are typed in the review screen, never sent anywhere
MIN_ALIGN = 0.80                            # below this, the photo is rejected: retake it
LEAK_WARN = 15.0                            # printed-ink leakage per 1000 px outside the fields: real good pages measured 0.6-3.6, a dense table page 9.6
TABLE_OK, TABLE_PAGE_MIN = 0.85, 0.70       # a page under MIN_ALIGN is still accepted if every refined table fits this well on its own
HINT_MARGIN = 0.03                          # another page must line up this much better than the phone's page number to win
CHECK_ALIGN = 0.90                          # between the two, the page is read but flagged 'check the crops line up'
JUMP = {'core': 1.0, 'chest': 6.0, 'arm': 6.0, 'thigh': 6.0, 'calf': 6.0}   # °C between neighbouring readings


def has_writing(ink):
    """Handwriting, not a leftover sliver of a printed line or a table edge: strokes with real size and shape."""
    n, _, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    area = 0
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 12 or max(w, h) < 8:
            continue
        if min(w, h) <= 4 and max(w, h) / max(1, min(w, h)) > 6:   # a thin straight line
            continue
        area += a
    return area >= 40


def templates(form_dir):
    files = sorted(glob.glob(f'{form_dir}/page-*.png'), key=lambda f: int(f.rsplit('-', 1)[1][:-4]))
    if not files:
        subprocess.run(['pdftoppm', '-r', '200', '-png', f'{form_dir}/blank.pdf', f'{form_dir}/page'], check=True)
        files = sorted(glob.glob(f'{form_dir}/page-*.png'), key=lambda f: int(f.rsplit('-', 1)[1][:-4]))
    return [cv2.imread(f, cv2.IMREAD_GRAYSCALE) for f in files]


def arrow_shaft(ink):
    """A long vertical stroke through the middle of a cell: the shaft of a 'same as above' arrow. (A thin line along the
    cell's edge is a printed line slipping through, not writing; has_writing ignores both, this one is told apart by
    where it is and how tall.)"""
    n, _, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    H, W = ink.shape
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if h >= 0.6 * H and w <= 0.25 * W + 4 and 0.25 * W <= x + w / 2 <= 0.75 * W:
            return True
    return False


def through_arrow(ink):
    """An arrow drawn down through a cell that also holds its head or a ditto mark: one stroke spanning nearly the whole
    cell height near the middle. Written digits never run from top to bottom of the cell, so this is not a number."""
    n, _, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    H, W = ink.shape
    # measured on real pages: arrow shafts are 0.03-0.05 of the cell wide and 0.95-0.97 tall; written letters and digits
    # that come close are 0.10-0.16 wide
    return any(st[i][3] >= 0.90 * H and st[i][2] <= 0.08 * W + 2 and 0.3 * W <= st[i][0] + st[i][2] / 2 <= 0.7 * W
               for i in range(1, n))


def mark_groups(ink, gap=6, least=40):
    """Separate pieces of writing side by side (gaps of `gap` empty columns), each with at least `least` ink pixels:
    one letter is one group, a crossed-out answer next to a new one is two. The outer tenth on each side is left out: a
    printed line leaking in along the cell's edge is not a mark."""
    m = ink.shape[1] // 10
    cols = ink[:, m:ink.shape[1] - m].sum(axis=0)
    groups, run, empty = [], 0, gap
    for c in cols:
        if c:
            if empty >= gap and run: groups.append(run); run = 0
            run += int(c); empty = 0
        else:
            empty += 1
    if run: groups.append(run)
    return sum(1 for g in groups if g >= least)


def crop_rect(rect, cells, shape):
    """(outer, inner): inner is where handwriting is looked for; outer is a little bigger, so digits that overrun the
    cell are not cut off in the crop."""
    x0, y0, x1, y1 = rect; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    inside = [c for c in cells if c[0] <= cx <= c[2] and c[1] <= cy <= c[3] and c[2] - c[0] < 500]
    if inside:
        c = min(inside, key=lambda c: (c[2] - c[0]) * (c[3] - c[1]))
        inner = (c[0] + 3, c[1] + 3, c[2] - 3, c[3] - 3)
        grow = (5, 5)       # 2 px beyond the cell: enough that an overrunning digit isn't cut, too little to pull in the row above
    else:
        inner = (x0 - 20, y0 - 20, x1 + 60, y1 + 20)
        grow = (4, 8)
    clamp = lambda r: (max(0, r[0]), max(0, r[1]), min(shape[1], r[2]), min(shape[0], r[3]))
    return clamp((inner[0] - grow[0], inner[1] - grow[1], inner[2] + grow[0], inner[3] + grow[1])), clamp(inner)


def png(img):
    return cv2.imencode('.png', img)[1].tobytes()


def read_cell(reader, f, crop_gray):
    a = reader.read(png(crop_gray), f, 0)
    big = cv2.resize(crop_gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    b = reader.read(png(big), f, 1)
    return [a, b]


def field_box(loc, w, h):
    """a field's place on its page as fractions of the page {x, y, w, h}: its cell and option boxes together. The phone's tidied
    page is the whole sheet too, so the same fractions find the field on it (coordinates only, never a picture)."""
    rs = ([loc['rect']] if loc.get('rect') else []) + list(loc.get('options', {}).values())
    if not rs: return None
    x0, y0, x1, y1 = min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)
    return {'x': round(x0 / w, 4), 'y': round(y0 / h, 4), 'w': round((x1 - x0) / w, 4), 'h': round((y1 - y0) / h, 4)}


def process_page(page_no, flat, tpl, fmap, fields, cells, reader, header_bottom=0):
    ink = align.ink_layer(flat, tpl)
    out = {}
    for fid, loc in fmap['fields'].items():
        if loc['page'] != page_no:
            continue
        f = fields[fid]
        top = min([r[1] for r in loc['options'].values()] + ([loc['rect'][1]] if loc.get('rect') else []))
        typical = sorted(fmap.get('header_bottom', {}).values())[len(fmap.get('header_bottom', {})) // 2] if fmap.get('header_bottom') else 0
        if top < max(header_bottom or typical, fmap.get('header_bottom', {}).get(str(page_no), 0)):   # the page header: Subject ID and Date of Entry are identifiers, never cropped or sent
            out[fid] = dict(kind='text', value=None, flags=['in the page header: not read'], crop=b'', reads=[])
            continue
        if loc['options'] and (loc.get('written') or f.get('col') == 'ts'):   # Y/N columns and thermal sensation are written, not ticked
            rs = list(loc['options'].values())
            loc = dict(loc, options={}, rect=[min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)])
        if loc['options']:
            res = {o: ticks.read_ticks(ink, [dict(rect=r, label=o)])[0] for o, r in loc['options'].items()}
            on = [o for o, r in res.items() if r['state'] == 'ticked']
            unsure = [o for o, r in res.items() if r['state'] == 'unsure']
            flags = [f'unsure tick: {o}' for o in unsure] + (['more than one ticked'] if len(on) > 1 else [])
            # two boxes with some ink (a slash running past its box): the one the slash crosses the MIDDLE of wins, flagged
            crossed = [o for o, r in res.items() if r['center'] >= 0.6]
            if len(on) + len(unsure) > 1 and len(crossed) == 1 and all(r['center'] <= 0.15 for o, r in res.items() if o != crossed[0]):
                on, flags = [crossed[0]], ['more than one box has ink: took the one the slash crosses the middle of, check']
            r0 = next(iter(loc['options'].values()))
            (cx0, cy0, cx1, cy1), _ = crop_rect([min(r[0] for r in loc['options'].values()), r0[1], max(r[2] for r in loc['options'].values()), r0[3]], cells, flat.shape)
            out[fid] = dict(kind='tick', value=on[0] if len(on) == 1 else None, flags=flags, inks={o: r['ink'] for o, r in res.items()}, centers={o: r['center'] for o, r in res.items()},
                            crop=png(flat[cy0:cy1, cx0:cx1]))
            continue
        (x0, y0, x1, y1), (ix0, iy0, ix1, iy1) = crop_rect(loc['rect'], cells, flat.shape)
        crop, cink = flat[y0:y1, x0:x1], ink[iy0:iy1, ix0:ix1]
        filled = has_writing(cink)
        e = dict(kind='text', value=None, flags=[], crop=png(crop), reads=[])
        if filled and f['type'] in NEVER_SEND:
            e['flags'].append('type this in (not sent anywhere)')
        elif f['type'] != 'text' and (arrow_shaft(cink) if not filled else through_arrow(cink)):   # an arrow: not a number
            e['flags'].append('arrow or ditto: same as the reading above?')
        elif filled and getattr(reader, 'reads_nothing', False):
            read_cell(reader, f, crop)       # the exporter keeps the crop; a no-read run keeps nothing
            e['flags'].append('type this in (not read)')
        elif filled:
            reads = read_cell(reader, f, crop)
            e['reads'] = [r['text'] for r in reads]
            vals = [plausible.clean(f, r['text']) for r in reads]
            if not all(r['legible'] for r in reads): e['flags'].append('hard to read')
            if str(vals[0][0]) != str(vals[1][0]): e['flags'].append('two reads disagree')
            e['value'] = vals[0][0]
            e['flags'] += sorted({p for _, ps in vals for p in ps})
            if e['value'] is None and not any(r['text'].strip() for r in reads):
                e['flags'].append('ink in the cell but read as empty')
            if f.get('opts') and len(f['opts']) <= 3 and mark_groups(cink) > 1:
                e['flags'].append('two marks in the cell (one crossed out?)')
        out[fid] = e
    return out


def leak_ratio(ink, fmap, page_no):
    """Ink far from every field is printed text the template failed to cancel (a template that doesn't match the paper's
    layout: different fonts or row heights). Share of such ink per 1000 page pixels; high = don't trust this page's ticks."""
    mask = np.zeros(ink.shape, np.uint8)
    for loc in fmap['fields'].values():
        if loc['page'] != page_no: continue
        for r in ([loc['rect']] if loc.get('rect') else []) + list(loc['options'].values()):
            mask[max(0, r[1] - 40):r[3] + 40, max(0, r[0] - 60):r[2] + 60] = 1
    return float(ink[mask == 0].sum()) / max(1, (mask == 0).sum()) * 1000


def point_order(p):
    """Order of a series' timepoints (p = (field id, point key)): baseline first, then the minutes, end of surgery last."""
    k = p[1]
    return -1 if k == 'base' else int(k) if k.isdigit() else 10 ** 6


def arrow_gaps(fields_out, fields):
    """An empty cell sitting between two 'same as above' arrows, or below one and above another reading in the same column,
    is probably covered by the arrow too: flag it instead of leaving it silently empty."""
    cols = {}
    for fid, e in fields_out.items():
        f = fields[fid]
        if f.get('series') == 'iotemp' and f.get('col') in ('under', 'gown', 'room', 'core', 'chest', 'arm', 'thigh', 'calf'):
            cols.setdefault((f['series'], f['col']), []).append((fid, f['point']))
    key = point_order
    for pts in cols.values():
        pts.sort(key=key)
        state = [('arrow' if any('arrow' in t for t in fields_out[fid]['flags']) else 'value' if fields_out[fid].get('value') not in (None, '') else 'empty') for fid, _ in pts]
        for i, (fid, _) in enumerate(pts):
            if state[i] != 'empty' or fields_out[fid]['flags']:
                continue
            above = next((state[j] for j in range(i - 1, -1, -1) if state[j] != 'empty'), None)
            below = next((state[j] for j in range(i + 1, len(pts)) if state[j] != 'empty'), None)
            if above == 'arrow' and below in ('arrow', 'value'):
                fields_out[fid]['flags'].append('empty between arrows: same as the reading above?')


def fill_arrows(fields_out, fields):
    """A 'same as above' arrow (or an empty cell the arrow runs through) repeats the reading above it in the same column:
    copy that value in and note it, so the person sees where it came from. An arrow with nothing above it stays flagged."""
    cols = {}
    for fid in fields_out:
        f = fields[fid]
        if f.get('series') and f.get('col'):
            cols.setdefault((f['series'], f['col']), []).append((fid, f['point']))
    for pts in cols.values():
        pts.sort(key=point_order)
        last, doubtful = None, False
        for fid, _ in pts:
            e = fields_out[fid]
            marks = [t for t in e['flags'] if 'same as the reading above' in t]
            if marks and e.get('value') in (None, '') and last is not None:
                e['value'] = last
                e['flags'] = [t for t in e['flags'] if t not in marks]
                e.setdefault('notes', []).append('arrow: copied from the reading above')
                if doubtful:      # never pass a reading that needs checking down the column silently
                    e['flags'].append('arrow: copied from a reading that needs checking')
            elif e.get('value') not in (None, ''):
                last, doubtful = e['value'], bool(e['flags'])


def series_checks(fields_out, fields):
    """Things a nurse's pen can get wrong that a rule can spot: a temperature jumping, BP upside down, time going back."""
    by = {}
    for fid, e in fields_out.items():
        f = fields[fid]
        if f.get('series') and e.get('value') not in (None, 'NA') and f['col'] in ('core', 'chest', 'arm', 'thigh', 'calf'):
            by.setdefault((f['series'], f['col']), []).append((fid, f['point'], e['value']))
    for (_, col), pts in by.items():
        pts.sort(key=point_order)
        for (a, _, va), (b, _, vb) in zip(pts, pts[1:]):
            try:
                if abs(float(va) - float(vb)) > JUMP[col]:
                    for k in (a, b): fields_out[k]['flags'].append(f'jumps >{JUMP[col]:g} °C from the neighbouring reading')
            except (TypeError, ValueError):
                pass
    for fid, e in fields_out.items():
        if fid.endswith('_sbp'):
            d = fields_out.get(fid[:-4] + '_dbp', {})
            try:
                if float(e['value']) <= float(d['value']):
                    for k in (fid, fid[:-4] + '_dbp'): fields_out[k]['flags'].append('systolic not above diastolic')
            except (TypeError, ValueError, KeyError):
                pass


def aligned(img, tpl, tables):
    """Align the photo to the page, then pull each printed table onto the template's rows and columns; keep whichever
    fits the printed lines better. Also returns how well each refined table fits on its own."""
    flat, score = align.align_page(img, tpl)
    if tables:
        fine, n = align.refine_tables(flat, tpl, tables)
        if n:
            s2 = align.line_score(fine, tpl)
            if s2 > score:
                return fine, s2, [align.line_score(fine, tpl, tb['bbox']) for tb in tables]
    return flat, score, []


def best_page(img, tpls, tables_of, forced=None, hint=None):
    """Align the photo to its most likely pages and keep the best fit: page look-alikes (big tables) fool a quick guess.
    hint: the page number the phone gave the photo; it is tried too and kept unless another page fits clearly better
    (by HINT_MARGIN), so a photo taken out of order in a burst is put on its real page."""
    if forced:
        pg = forced - 1; flat, score, ts = aligned(img, tpls[pg], tables_of(pg)); return pg, flat, score, ts
    _, guess = align.guess_page(img, tpls)
    tries = sorted(range(len(tpls)), key=lambda i: -guess[i])[:3]
    h = hint - 1 if hint and 0 < hint <= len(tpls) else None
    if h is not None and h not in tries: tries.append(h)
    fits = {pg: aligned(img, tpls[pg], tables_of(pg)) for pg in tries}
    pg = max(fits, key=lambda i: fits[i][1])
    if h is not None and fits[pg][1] - fits[h][1] < HINT_MARGIN: pg = h
    return (pg, *fits[pg])


def main(argv=None, reader=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--form-dir', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--pages', help='page number of each photo, in order, e.g. 7,9,1 (otherwise worked out from the photo)')
    ap.add_argument('--hint-pages', help='likely page number of each photo, in order (the phone\'s numbers; x for none): kept unless another page lines up clearly better')
    ap.add_argument('--export-crops', metavar='DIR', help='no reading: write the handwritten crops to DIR for someone to read')
    ap.add_argument('--readings', metavar='FILE', help='use readings made from the exported crops, as {field id: text}, instead of the API')
    ap.add_argument('--readings2', metavar='FILE', help='a second, independent reading of the same crops: the two are compared and any disagreement is flagged')
    ap.add_argument('--no-read', action='store_true', help='nobody reads the handwriting: ticks are read, every written value is typed in the review screen')
    ap.add_argument('--min-align', type=float, default=MIN_ALIGN, help=f'lowest page alignment score to accept (default {MIN_ALIGN}); lower it only to test a page, and check its crops')
    ap.add_argument('--reader', choices=['claude', 'ollama'], default='claude', help='who reads the handwriting: Claude through the API (default) or a local vision model through Ollama (nothing leaves this computer)')
    ap.add_argument('--model', help='model for the reader (default: SCAN_MODEL, else claude-sonnet-5-5 / gemma4:12b)')
    ap.add_argument('--key-file', metavar='FILE', help='file holding the Anthropic API key, read by this process only (instead of the ANTHROPIC_API_KEY environment variable)')
    ap.add_argument('photos', nargs='+')
    a = ap.parse_args(argv)
    fmap = json.load(open(f'{a.form_dir}/fieldmap.json', encoding='utf-8'))
    fields = {f['id']: f for f in json.load(open(f'{a.form_dir}/fields.json', encoding='utf-8'))}
    tpls = templates(a.form_dir)
    forced = [int(x) for x in a.pages.split(',')] if a.pages else [None] * len(a.photos)
    if len(forced) != len(a.photos): ap.error('--pages needs one page number per photo')
    hints = [int(x) if x.isdigit() else None for x in a.hint_pages.split(',')] if a.hint_pages else [None] * len(a.photos)
    if len(hints) != len(a.photos): ap.error('--hint-pages needs one page number (or x) per photo')
    if a.readings2 and not a.readings: ap.error('--readings2 needs --readings')
    reader = reader or (readers.CropExporter(a.export_crops) if a.export_crops else readers.NoReader() if a.no_read
                        else readers.FileReader(a.readings, a.readings2) if a.readings else readers.OllamaReader(a.model) if a.reader == 'ollama'
                        else readers.AnthropicReader(a.model, key_file=a.key_file))
    _tables = {}
    tables_of = lambda pg: _tables.setdefault(pg, boxes.tables(f'{a.form_dir}/blank.pdf', pg))
    result, pages = {}, []
    for ph, fp, hp in zip(a.photos, forced, hints):
        img = cv2.imread(ph)
        pg, flat, score, tscores = best_page(img, tpls, tables_of, fp, hp)
        # a page can fall just short overall while its refined tables sit right on the printed lines: accept that, but say so
        by_tables = bool(tscores) and min(tscores) >= TABLE_OK and score >= TABLE_PAGE_MIN
        ok = score >= a.min_align or by_tables
        pages.append(dict(photo=os.path.basename(ph), page=pg + 1, score=round(score, 3), accepted=ok, table_scores=[round(t, 3) for t in tscores],
                          check_alignment=ok and (score < CHECK_ALIGN or score < a.min_align)))
        if not ok:
            print(f'{ph}: best fit is page {pg + 1} but it did not line up (score {score:.2f}): retake the photo, or say which page it is with --pages', file=sys.stderr); continue
        if score < CHECK_ALIGN or score < a.min_align:
            print(f'{ph}: page {pg + 1} lined up only moderately (score {score:.2f}): check the crops in the review screen', file=sys.stderr)
        leak = leak_ratio(align.ink_layer(flat, tpls[pg]), fmap, pg)
        pages[-1]['leak'] = round(leak, 1)
        if leak > LEAK_WARN:
            pages[-1]['template_mismatch'] = True
            print(f'{ph}: page {pg + 1}: printed text is leaking into the ink layer ({leak:.0f}); the template does not match the paper layout (fonts / row heights): ticks on this page are less reliable', file=sys.stderr)
        got = process_page(pg, flat, tpls[pg], fmap, fields, boxes.cells(f'{a.form_dir}/blank.pdf', pg), reader, boxes.header_bottom(f'{a.form_dir}/blank.pdf', pg))
        th, tw = tpls[pg].shape[:2]
        for fid, e in got.items():
            e['page'] = pg + 1          # which page each value came from (the phone's per-page counts)
            e['box'] = field_box(fmap['fields'][fid], tw, th)   # where on the page, for the crop the admin sees from the phone's copy
        result.update(got)
    arrow_gaps(result, fields)
    fill_arrows(result, fields)
    series_checks(result, fields)
    if hasattr(reader, 'finish'):
        reader.finish()
        print(f'{len(reader.items)} handwritten crops, contact sheets a-NN.png and b-NN.png and manifest.json in {a.export_crops}')
    if getattr(reader, 'missing', None):
        print(f'{len(reader.missing)} written cells had no reading in the readings file(s): they are flagged "hard to read"', file=sys.stderr)
    for fid, e in result.items():
        e['label'] = fields[fid]['label']; e['type'] = fields[fid]['type']
        e['opts'] = fields[fid].get('opts'); e['unit'] = fields[fid].get('unit')
        e['crop'] = base64.b64encode(e['crop']).decode()
    os.makedirs(a.out, exist_ok=True)
    json.dump(dict(pages=pages, fields=result), open(f'{a.out}/scan.json', 'w', encoding='utf-8'))
    print(f'{len(result)} fields from {sum(p["accepted"] for p in pages)} of {len(pages)} photos; '
          f'{sum(bool(e["flags"]) for e in result.values())} flagged')
    return result


if __name__ == '__main__':
    main()
