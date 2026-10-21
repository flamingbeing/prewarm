"""python3 locate.py <dir from locate.mjs>: render the one-field-at-a-time forms and find where each field's text landed.
Writes fieldmap.json: { header_bottom: { page: px below which the page header ends }, fields: { id: { page, rect:[x0,y0,x1,y1] (px at 200 dpi), options: { value: rect },
written: true when the options are written letters/numbers rather than ticked boxes } }, unplaced: [ {key, why} ] }.
A character that is new compared with the same form without that field is the field's mark.
Rendering and reading the PDFs use all CPU cores (set LOCATE_JOBS to change). RENDERER=word renders with Microsoft Word
(docx2pdf) instead of LibreOffice, so the layout matches the printed paper exactly."""
import concurrent.futures as cf, glob, json, os, subprocess, sys, tempfile
from pathlib import Path
import pdfplumber

PT = 200 / 72
TICKS = set('☒☑✓✔✗✘')     # ballot-box X, ballot-box check, check marks, crosses
JOBS = int(os.environ.get('LOCATE_JOBS') or os.cpu_count() or 2)
d = sys.argv[1] if len(sys.argv) > 1 else ''   # importable for tests


def convert_chunk(files):
    profile = Path(tempfile.mkdtemp()).as_uri()      # its own LibreOffice profile, so several can run side by side
    subprocess.run(['soffice', f'-env:UserInstallation={profile}', '--headless', '--convert-to', 'pdf', '--outdir', d, *files],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def convert():
    # only what has no PDF yet, or whose PDF is older than its .docx (Word and LibreOffice are both slow)
    todo = [f for f in sorted(glob.glob(f'{d}/*.docx'))
            if not os.path.exists(f[:-5] + '.pdf') or os.path.getmtime(f[:-5] + '.pdf') < os.path.getmtime(f)]
    if not todo:
        return
    if os.environ.get('RENDERER') == 'word':   # Microsoft Word itself (pip install docx2pdf; Windows or Mac): the layout of the printed paper
        from docx2pdf import convert as word_convert   # Word converts a whole folder in one session
        import shutil
        tmp = tempfile.mkdtemp()
        for f in todo: shutil.copy(f, tmp)
        word_convert(tmp)
        for f in todo: shutil.move(os.path.join(tmp, os.path.basename(f)[:-5] + '.pdf'), f[:-5] + '.pdf')
        return
    chunks = [todo[i::JOBS] for i in range(JOBS) if todo[i::JOBS]]
    with cf.ThreadPoolExecutor(len(chunks) or 1) as ex:
        list(ex.map(convert_chunk, chunks))


def chars(name):
    """Every printed character as a small tuple: (page, x0, top, text, x1, bottom)."""
    try:
        with pdfplumber.open(f'{d}/{name}.pdf') as pdf:
            return name, [(pi, round(c['x0'], 1), round(c['top'], 1), c['text'], c['x1'], c['bottom']) for pi, p in enumerate(pdf.pages) for c in p.chars]
    except Exception as e:  # a form that failed to render
        return name, str(e)


def choose_glyphs(cands):
    """cands: { option: [rect, ...] } box glyphs that appeared for each option of one ticked question. An option can tick
    more than one box (No pre-warming also ticks 'Not applicable' further down the page). The options of one question sit
    in one row (or one column), so keep the candidate on the same row as the others' boxes (same column if they are
    stacked); only if none lines up, the one nearest. Returns { option: rect }."""
    centre = lambda r: ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
    singles = [centre(c[0]) for c in cands.values() if len(c) == 1]
    ys, xs = sorted(c[1] for c in singles), sorted(c[0] for c in singles)
    medy, medx = (ys[len(ys) // 2], xs[len(xs) // 2]) if singles else (None, None)
    spread_y = (ys[-1] - ys[0]) if singles else 0
    spread_x = (xs[-1] - xs[0]) if singles else 0
    out = {}
    for o, rects in cands.items():
        if len(rects) == 1 or not singles:
            out[o] = sorted(rects, key=lambda r: (r[1], r[0]))[0]
            continue
        h = lambda r: r[3] - r[1]
        same_row = [r for r in rects if abs(centre(r)[1] - medy) <= max(8, 0.4 * h(r))] if spread_y <= spread_x else []
        same_col = [r for r in rects if abs(centre(r)[0] - medx) <= max(8, 0.4 * (r[2] - r[0]))] if spread_x < spread_y else []
        pool = same_row or same_col or rects
        out[o] = min(pool, key=lambda r: (centre(r)[0] - sum(c[0] for c in singles) / len(singles)) ** 2 + (centre(r)[1] - sum(c[1] for c in singles) / len(singles)) ** 2)
    return out


def new_marks(variant, base):
    seen = {}
    for pi, x, y, t, *_ in base:
        seen[(pi, x, y, t)] = seen.get((pi, x, y, t), 0) + 1
    out = []
    for c in variant:
        k = c[:4]
        if seen.get(k, 0): seen[k] -= 1
        else: out.append(c)
    return out


if __name__ == '__main__':
    convert()
    meta = json.load(open(f'{d}/variants.json', encoding='utf-8'))
    names = sorted({v['name'] for v in meta['variants']} | {v['base'] for v in meta['variants']})
    with cf.ProcessPoolExecutor(JOBS) as ex:
        cache = dict(ex.map(chars, names, chunksize=8))
    unplaced = [dict(key=k, why='the form has no place for it (the filled form was identical)') for k in meta['unplaced']]
    found = []
    for v in meta['variants']:
        a, b = cache[v['name']], cache[v['base']]
        if isinstance(a, str) or isinstance(b, str):
            unplaced.append(dict(key=v['field'] + (':' + v['option'] if v.get('option') is not None else ''), why='did not render: ' + str(a if isinstance(a, str) else b)))
            continue
        found.append((v, new_marks(a, b)))
    # marks that turn up in most fills are the header (Subject ID, Date of Entry) or page furniture, not this field's own
    freq, on_page = {}, {}
    for v, marks in found:
        for pi in {m[0] for m in marks}: on_page[pi] = on_page.get(pi, 0) + 1
        for k in {m[:4] for m in marks}: freq[k] = freq.get(k, 0) + 1
    common = {k for k, n in freq.items() if on_page[k[0]] >= 4 and n > 0.25 * on_page[k[0]]}
    # the header (Subject ID / Date of Entry): where it ends on each page, read from the blank form itself
    header_bottom = {}
    if os.path.exists(f'{d}/blank.pdf'):
        import boxes
        with pdfplumber.open(f'{d}/blank.pdf') as pdf:
            for pi in range(len(pdf.pages)):
                hb = boxes.header_bottom(f'{d}/blank.pdf', pi)
                if hb: header_bottom[pi] = hb
            if header_bottom:           # every page has the same header: a page where the labels were not found gets the typical value
                typical = sorted(header_bottom.values())[len(header_bottom) // 2]
                for pi in range(len(pdf.pages)): header_bottom.setdefault(pi, typical)
    fmap, ticked, cands = {}, {}, {}
    for v, marks in found:
        key = v['field'] + (':' + v['option'] if v.get('option') is not None else '')
        own = [m for m in marks if m[:4] not in common]
        if not own:
            unplaced.append(dict(key=key, why='no new characters' if not marks else f'its {len(marks)} new characters look like page furniture (seen in most fills)'))
            continue
        page = own[0][0]
        ms = [m for m in own if m[0] == page]
        glyphs = [[round(m[1] * PT), round(m[2] * PT), round(m[4] * PT), round(m[5] * PT)] for m in ms if m[3] in TICKS]   # a ticked option: just its box(es); its label text can shift and would overlap the next option
        if glyphs and v.get('option') is not None:
            ms = [m for m in ms if m[3] in TICKS]
        rect = [round(min(m[1] for m in ms) * PT), round(min(m[2] for m in ms) * PT), round(max(m[4] for m in ms) * PT), round(max(m[5] for m in ms) * PT)]
        if rect[1] < header_bottom.get(page, 0):   # Subject ID / Date of Entry live up here: never a field to read or send
            unplaced.append(dict(key=key, why='lands in the page header band (Subject ID / Date of Entry)'))
            continue
        f = fmap.setdefault(v['field'], dict(page=page, options={}))
        if v.get('option') is not None:
            f['options'][v['option']] = rect
            ticked[v['field']] = ticked.get(v['field'], False) or any(m[3] in TICKS for m in ms)
            if glyphs: cands.setdefault(v['field'], {})[v['option']] = glyphs
        else:
            f['rect'] = rect
    for fid, c in cands.items():          # a ticked question: one box per option
        if fid in fmap and ticked.get(fid):
            fmap[fid]['options'].update(choose_glyphs(c))
    for fid, f in fmap.items():
        if f['options'] and not ticked.get(fid):
            f['written'] = True      # the option's mark is a letter or number (Y/N, thermal sensation), not a ticked box
    json.dump(dict(fields=fmap, header_bottom={str(k): v for k, v in header_bottom.items()}, unplaced=sorted(unplaced, key=lambda u: u['key'])), open(f'{d}/fieldmap.json', 'w', encoding='utf-8'), indent=1)
    by_why = {}
    for u in unplaced: by_why[u['why'].split(' (')[0][:60]] = by_why.get(u['why'].split(' (')[0][:60], 0) + 1
    print(len(fmap), 'fields placed;', len(unplaced), 'variants not placed:', by_why)
