"""python3 make-form-map.py --form-dir <form-data> --out <dir>: the phone's copy of the form, once per form version.

Writes <out>/form-map.json and <out>/template-N.png (one per page, 450x600 grey) from the same form-data scan.py uses
(fieldmap.json, fields.json, blank.pdf, page-N.png; see setup-form.sh). Everything is in the phone's page frame: the
tidied page is 1800x2400 (js/scan-geom.js PAGE_W x PAGE_H), so template pixels are scaled to it. The template PNGs keep
the printed lines dark at quarter size (each pixel is the darkest of its 4x4 block), so thin lines do not fade away.

form-map.json: { page: {w, h}, quarter: 4, pages: [{ page (1-based), template, header_bottom, tables: [{bbox, xs, ys}],
cells }], fields: [{ id, type, page, kind ('cell' | 'tick'), rect, crop, inner, options, written, send, unit, opts,
label, series, col, point, box }] }. `crop` is where to cut the picture, `inner` where to look for handwriting (scan.py's
crop_rect); `send` is false for IDs, dates, names, free text and anything in the page header: those are never sent.
The output comes from the real form: keep it out of git, like form-data."""
import argparse, glob, json, os
import cv2, numpy as np

PAGE_W, PAGE_H, Q = 1800, 2400, 4
SEND = {'num', 'int', 'code', 'time'}     # numbers, codes and times only (scan.py's NEVER_SEND is the rest)


def crop_rect(rect, cells, shape):
    import scan     # scan.py's own rule, so the two never drift apart
    return scan.crop_rect(rect, cells, shape)


def scale_rect(r, kx, ky):
    return [round(r[0] * kx), round(r[1] * ky), round(r[2] * kx), round(r[3] * ky)]


def template_png(tpl_gray):
    """The template page stretched to the phone's page, then the darkest pixel of each 4x4 block (450x600)."""
    big = cv2.resize(tpl_gray, (PAGE_W, PAGE_H), interpolation=cv2.INTER_LINEAR)
    return big.reshape(PAGE_H // Q, Q, PAGE_W // Q, Q).min(axis=(1, 3))


def form_map(fmap, fields, pages):
    """fmap: fieldmap.json; fields: {id: field}; pages: [{size: (w, h) of the template, tables, cells, header_bottom}] in
    template pixels (from boxes.py). Returns the form-map dict in the phone's page frame."""
    hb_all = {int(k): v for k, v in fmap.get('header_bottom', {}).items()}
    typical = sorted(hb_all.values())[len(hb_all) // 2] if hb_all else 0
    out_pages, out_fields = [], []
    for pi, pg in enumerate(pages):
        tw, th = pg['size']; kx, ky = PAGE_W / tw, PAGE_H / th
        out_pages.append(dict(page=pi + 1, template=f'template-{pi + 1}.png',
                              header_bottom=round(max(pg.get('header_bottom') or typical, hb_all.get(pi, 0)) * ky),
                              tables=[dict(bbox=scale_rect(t['bbox'], kx, ky), xs=[round(v * kx) for v in t['xs']],
                                           ys=[round(v * ky) for v in t['ys']]) for t in pg['tables']],
                              cells=[scale_rect(c, kx, ky) for c in pg['cells']]))
    for fid, loc in fmap['fields'].items():
        pi = loc['page']
        if fid not in fields or pi >= len(pages):
            continue
        f, pg = fields[fid], pages[pi]
        tw, th = pg['size']; kx, ky = PAGE_W / tw, PAGE_H / th
        opts = loc.get('options') or {}
        top = min([r[1] for r in opts.values()] + ([loc['rect'][1]] if loc.get('rect') else []))
        in_header = top < max(pg.get('header_bottom') or typical, hb_all.get(pi, 0))
        written = bool(opts) and bool(loc.get('written') or f.get('col') == 'ts')
        rect = loc.get('rect')
        if written:      # Y / N columns and thermal sensation are written, not ticked: one cell over all the options
            rs = list(opts.values())
            rect = [min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)]
        kind = 'tick' if opts and not written else 'cell'
        if kind == 'tick':
            r0 = next(iter(opts.values()))
            outer, inner = crop_rect([min(r[0] for r in opts.values()), r0[1], max(r[2] for r in opts.values()), r0[3]], pg['cells'], (th, tw))
        else:
            outer, inner = crop_rect(rect, pg['cells'], (th, tw))
        rs = ([loc['rect']] if loc.get('rect') else []) + list(opts.values())
        x0, y0, x1, y1 = min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)
        out_fields.append(dict(
            id=fid, type=f['type'], page=pi + 1, kind=kind,
            rect=scale_rect(rect, kx, ky) if rect else None,
            crop=scale_rect(outer, kx, ky), inner=scale_rect(inner, kx, ky),
            options={o: scale_rect(r, kx, ky) for o, r in opts.items()} if kind == 'tick' else {},
            written=written, send=(f['type'] in SEND and not in_header),
            unit=f.get('unit'), opts=f.get('opts'), label=f.get('label'),
            series=f.get('series'), col=f.get('col'), point=f.get('point'),
            box={'x': round(x0 / tw, 4), 'y': round(y0 / th, 4), 'w': round((x1 - x0) / tw, 4), 'h': round((y1 - y0) / th, 4)}))
    return dict(page=dict(w=PAGE_W, h=PAGE_H), quarter=Q, pages=out_pages, fields=out_fields)


def write(out, fm, tpls):
    os.makedirs(out, exist_ok=True)
    for i, t in enumerate(tpls):
        cv2.imwrite(f'{out}/template-{i + 1}.png', template_png(t), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    json.dump(fm, open(f'{out}/form-map.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--form-dir', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    import boxes, scan
    fmap = json.load(open(f'{a.form_dir}/fieldmap.json', encoding='utf-8'))
    fields = {f['id']: f for f in json.load(open(f'{a.form_dir}/fields.json', encoding='utf-8'))}
    tpls = scan.templates(a.form_dir)
    pdf = f'{a.form_dir}/blank.pdf'
    pages = [dict(size=(t.shape[1], t.shape[0]), tables=boxes.tables(pdf, i), cells=boxes.cells(pdf, i),
                  header_bottom=boxes.header_bottom(pdf, i)) for i, t in enumerate(tpls)]
    fm = form_map(fmap, fields, pages)
    write(a.out, fm, tpls)
    print(f'{len(fm["fields"])} fields on {len(pages)} pages ({sum(f["send"] for f in fm["fields"])} may be sent) in {a.out}')


if __name__ == '__main__':
    main()
