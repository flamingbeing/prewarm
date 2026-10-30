"""python3 parity.py <out dir>: made-up pages for the phone's alignment and crop code (js/scan-align.js, js/scan-crop.js)
to be compared with this folder's Python (align.py, scan.py). Writes prewarm/test/scan-parity/ by default.

Everything is made up: a made-up form (two tables, tick boxes, printed labels) drawn here, filled with synth.py's
pretend handwriting, then "tidied by the phone" with a small known misfit (shift, scale, turn, rows drifting down a
long table, uneven light, blur). For each page it records what Python makes of it: the alignment score (as scan.aligned
keeps it), the per-table scores, and where each field's crop rectangle lands on the phone's page (1800x2400 px).
The JS tests read the same pages and must land within 3 px of these (test/scan-parity.test.mjs)."""
import importlib.util, json, os, sys
import cv2, numpy as np
import align, synth

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('make_form_map', f'{HERE}/make-form-map.py')
mfm = importlib.util.module_from_spec(spec); spec.loader.exec_module(mfm)
TW, TH = 1654, 2339            # the template page at 200 dpi (A4), as setup-form.sh renders it
PW, PH = mfm.PAGE_W, mfm.PAGE_H


def made_up_form():
    """A blank page with a header, a long table, a small table and a row of tick boxes; returns (gray, tables, cells, ticks)."""
    t = np.full((TH, TW), 255, np.uint8)
    cv2.putText(t, 'MADE-UP TEST FORM', (430, 150), cv2.FONT_HERSHEY_SIMPLEX, 2.0, 0, 4, cv2.LINE_AA)
    cv2.rectangle(t, (150, 220), (1500, 330), 0, 2)
    cv2.putText(t, 'Sample ID', (170, 290), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2, cv2.LINE_AA)
    tables = []
    xs = [150, 330, 470, 610, 750, 890, 1030, 1200, 1350, 1500]
    ys = [420, 500, 545] + [545 + 44 * k for k in range(1, 26)]
    tables.append(dict(bbox=(xs[0], ys[0], xs[-1], ys[-1]), xs=xs, ys=ys))
    xs2 = [150, 500, 850, 1200, 1500]; ys2 = [1800, 1860, 1920, 1980, 2040, 2100]
    tables.append(dict(bbox=(xs2[0], ys2[0], xs2[-1], ys2[-1]), xs=xs2, ys=ys2))
    cells = []
    for tb in tables:
        for y in tb['ys']: cv2.line(t, (tb['xs'][0], y), (tb['xs'][-1], y), 0, 2)
        for x in tb['xs']: cv2.line(t, (x, tb['ys'][0]), (x, tb['ys'][-1]), 0, 2)
        for y0, y1 in zip(tb['ys'], tb['ys'][1:]):
            for x0, x1 in zip(tb['xs'], tb['xs'][1:]):
                cells.append((x0, y0, x1, y1))
    for i, y in enumerate(ys[3:-1]):
        cv2.putText(t, f'{5 * i:>3}', (180, y + 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 2, cv2.LINE_AA)
    for j, x in enumerate(xs[1:-1]):
        cv2.putText(t, 'abcdefgh'[j] * 3, (x + 20, 470), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 2, cv2.LINE_AA)
    ticks = []
    for k, x in enumerate((200, 520, 840)):
        cv2.rectangle(t, (x, 1700), (x + 30, 1730), 0, 2)
        cv2.putText(t, f'option {k + 1}', (x + 45, 1726), cv2.FONT_HERSHEY_SIMPLEX, 0.9, 0, 2, cv2.LINE_AA)
        ticks.append(dict(rect=(x, 1700, x + 30, 1730), label=str(k + 1)))
    return t, tables, cells, ticks


def made_up_fields(tables):
    """Field places as locate.py would find them (where the field's text lands: a small box inside its cell)."""
    fmap, fields = {}, []
    tb = tables[0]
    for i, (y0, y1) in enumerate(zip(tb['ys'][3:-1], tb['ys'][4:])):
        for j, (x0, x1) in enumerate(zip(tb['xs'][1:-1], tb['xs'][2:])):
            if (i + j) % 3: continue
            fid = f'demo_{5 * i}_c{j}'
            fmap[fid] = dict(page=0, rect=[x0 + 10, y0 + 8, x0 + 60, y1 - 8], options={})
            fields.append(dict(id=fid, type='num', label=f'Made-up reading {j}', unit='°C', series='demo', col=f'c{j}', point=str(5 * i)))
    t2 = tables[1]
    for i, (y0, y1) in enumerate(zip(t2['ys'][:-1], t2['ys'][1:])):
        fid = f'demo_time_{i}'
        fmap[fid] = dict(page=0, rect=[t2['xs'][1] + 10, y0 + 10, t2['xs'][1] + 90, y1 - 10], options={})
        fields.append(dict(id=fid, type='time', label=f'Made-up time {i}'))
    fmap['demo_tick'] = dict(page=0, options={'1': [200, 1700, 230, 1730], '2': [520, 1700, 550, 1730], '3': [840, 1700, 870, 1730]})
    fields.append(dict(id='demo_tick', type='code', label='Made-up choice', opts=[[1, 'one'], [2, 'two'], [3, 'three']]))
    fmap['demo_id'] = dict(page=0, rect=[400, 250, 700, 300], options={})
    fields.append(dict(id='demo_id', type='text', label='Sample ID'))
    return dict(fields=fmap, header_bottom={'0': 340}), {f['id']: f for f in fields}


def phone_page(filled, rng, shift, scale, turn, drift, table):
    """The filled page as the phone's tidied 1800x2400 page with a small misfit. Returns (page, true map phone->template)."""
    yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
    kx, ky = TW / PW, TH / PH
    c, s = np.cos(turn), np.sin(turn)
    u, v = xx - PW / 2, yy - PH / 2
    tx = (c * u - s * v) * scale + PW / 2 + shift[0]
    ty = (s * u + c * v) * scale + PH / 2 + shift[1]
    y0, y1 = table['bbox'][1] / ky, table['bbox'][3] / ky
    inside = (ty > y0 - 40) & (ty < y1 + 40)
    ty = ty + np.where(inside, drift * np.sin(np.clip((ty - y0) / (y1 - y0), 0, 1) * np.pi), 0)
    img = cv2.remap(filled, (tx * kx).astype(np.float32), (ty * ky).astype(np.float32), cv2.INTER_LINEAR, borderValue=255).astype(np.float32)
    light = 0.9 + 0.1 * (xx / PW * rng.uniform(-1, 1) + yy / PH * rng.uniform(-1, 1))
    img = cv2.GaussianBlur(img * np.clip(light, 0.82, 1.0), (0, 0), 1.0)
    return np.clip(img, 0, 255).astype(np.uint8)


def ecc(flat, tpl):
    """align._align_from with no sheet corners, also returning the ECC warp (template px -> flat px) or None."""
    a, t = align.flatten_illumination(flat), align.flatten_illumination(tpl)
    warp = np.eye(3, dtype=np.float32)
    for scale in (0.2, 0.35):
        sa = cv2.GaussianBlur(cv2.resize(a, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), (0, 0), 2)
        st = cv2.GaussianBlur(cv2.resize(t, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), (0, 0), 2)
        W = warp.copy(); W[:2, 2] *= scale; W[2, :2] /= scale
        try:
            _, W = cv2.findTransformECC(st, sa, W, cv2.MOTION_HOMOGRAPHY, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
        except cv2.error:
            break
        W[:2, 2] /= scale; W[2, :2] *= scale; warp = W
    h, w = tpl.shape
    fine = cv2.warpPerspective(flat, warp, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderValue=255)
    s0, s1 = align.line_score(flat, tpl), align.line_score(fine, tpl)
    return (fine, s1, warp) if s1 >= s0 else (flat, s0, None)


def table_maps(flat, tpl, tables):
    """align.refine_tables, also returning each refined table's (region, fx, fy) so points can be mapped."""
    out, n = align.refine_tables(flat, tpl, tables)
    maps = []
    if n:   # same steps as refine_tables, kept only to know the map (refine_tables returns the picture)
        bw = (align.flatten_illumination(flat) < 150).astype(np.float32); h, w = flat.shape
        for tb in tables:
            x0, y0, x1, y1 = tb['bbox']; m = 60
            rx0, ry0, rx1, ry1 = max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)
            sub = bw[ry0:ry1, rx0:rx1]
            cx0, cx1 = max(0, x0 - rx0 + 8), min(sub.shape[1], x1 - rx0 - 8); cy0, cy1 = max(0, y0 - ry0 + 8), min(sub.shape[0], y1 - ry0 - 8)
            rows = align._runs(sub[:, cx0:cx1].mean(1), 0.30); cols = align._runs(sub[cy0:cy1, :].mean(0), 0.30)
            my = align._match_lines([v - ry0 for v in tb['ys']], rows, 10); mx = align._match_lines([v - rx0 for v in tb['xs']], cols, 10)
            if len(my) < 0.7 * len(tb['ys']) or len(mx) < 0.7 * len(tb['xs']): continue
            ky = sorted((tb['ys'][j] - ry0, v) for j, v in my.items()); kx = sorted((tb['xs'][j] - rx0, v) for j, v in mx.items())
            maps.append(((rx0, ry0, rx1, ry1), kx, ky))
    return out, n, maps


def knot_map(ks, u):
    t = [k[0] for k in ks]; v = [k[1] for k in ks]
    if u < t[0]: return v[0] + (u - t[0])
    if u > t[-1]: return v[-1] + (u - t[-1])
    return float(np.interp(u, t, v))


def python_fit(page, tpl, tables):
    """What scan.aligned does to a phone page (no sheet finding: the page is already flat): returns the score, table
    scores and a function mapping template px to phone-page px."""
    flat = cv2.resize(page, (TW, TH), interpolation=cv2.INTER_AREA)
    out, score, warp = ecc(flat, tpl)
    if score < 0.85:    # align_page's fallback: slide and scale over the template, refine from there
        for quad in align.coarse_quads(flat, tpl):
            M = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [TW, 0], [TW, TH], [0, TH]], np.float32))
            f2 = cv2.warpPerspective(flat, M, (TW, TH), flags=cv2.INTER_AREA, borderValue=255)
            o2, s2, w2 = ecc(f2, tpl)
            if s2 > score:
                Mi = np.linalg.inv(M)
                out, score, warp = o2, s2, (Mi @ w2 if w2 is not None else Mi)
            if score >= 0.9: break
    fine, n, maps = table_maps(out, tpl, tables)
    tscores = []
    if n:
        s2 = align.line_score(fine, tpl)
        if s2 > score:
            score, tscores = s2, [align.line_score(fine, tpl, tb['bbox']) for tb in tables]
        else:
            maps = []
    else:
        maps = []

    def to_page(x, y):
        for (rx0, ry0, rx1, ry1), kx, ky in reversed(maps):   # a later table wins where they overlap
            if rx0 <= x < rx1 and ry0 <= y < ry1:
                x, y = knot_map(kx, x - rx0) + rx0, knot_map(ky, y - ry0) + ry0
                break
        if warp is not None:
            p = warp @ np.array([x, y, 1.0]); x, y = p[0] / p[2], p[1] / p[2]
        return x * PW / TW, y * PH / TH
    return score, tscores, to_page


def true_to_page(params, x, y):
    """Where template px (x, y) is on the made-up phone page (inverse of phone_page's map, by iteration)."""
    shift, scale, turn, drift, table = params
    kx, ky = TW / PW, TH / PH
    gx, gy = x / kx, y / ky                     # wanted (tx, ty), in phone-frame units
    y0, y1 = table['bbox'][1] / ky, table['bbox'][3] / ky
    c, s = np.cos(turn), np.sin(turn)
    px, py = gx, gy
    for _ in range(60):
        u, v = px - PW / 2, py - PH / 2
        tx = (c * u - s * v) * scale + PW / 2 + shift[0]; ty = (s * u + c * v) * scale + PH / 2 + shift[1]
        if y0 - 40 < ty < y1 + 40: ty += drift * np.sin(min(1, max(0, (ty - y0) / (y1 - y0))) * np.pi)
        px, py = px - (tx - gx) * 0.8, py - (ty - gy) * 0.8
    return float(px), float(py)


CASES = [   # shift (phone px), scale, turn (radians), row drift down the long table (phone px)
    ((6, -9), 1.006, 0.002, 0),
    ((-14, 11), 0.992, -0.004, 10),
    ((22, 18), 1.012, 0.003, 16),
]


def main(out):
    os.makedirs(out, exist_ok=True)
    tpl, tables, cells, ticks = made_up_form()
    fmap, fields = made_up_fields(tables)
    fm = mfm.form_map(fmap, fields, [dict(size=(TW, TH), tables=tables, cells=cells, header_bottom=340)])
    mfm.write(out, fm, [tpl])
    rng = np.random.default_rng(11)
    grid = [c for c in cells if any(c[0] <= (l['rect'][0] + l['rect'][2]) / 2 <= c[2] and c[1] <= (l['rect'][1] + l['rect'][3]) / 2 <= c[3]
                                    for l in fmap['fields'].values() if l.get('rect'))]
    expected = []
    for k, (shift, scale, turn, drift) in enumerate(CASES):
        filled, _ = synth.fill(tpl, ticks, grid, rng)
        page = phone_page(filled, rng, shift, scale, turn, drift, tables[0])
        cv2.imwrite(f'{out}/page-{k + 1}.png', page, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        score, tscores, to_page = python_fit(page, tpl, tables)
        kx, ky = TW / PW, TH / PH
        crops, truth = {}, {}
        for f in fm['fields']:
            x0, y0, x1, y1 = f['crop']
            crops[f['id']] = [round(v, 2) for p in (to_page(x0 * kx, y0 * ky), to_page(x1 * kx, y1 * ky)) for v in p]
            truth[f['id']] = [round(v, 2) for p in (true_to_page((shift, scale, turn, drift, tables[0]), x0 * kx, y0 * ky),
                                                     true_to_page((shift, scale, turn, drift, tables[0]), x1 * kx, y1 * ky)) for v in p]
        err = max(abs(a - b) for f in crops for a, b in zip(crops[f], truth[f]))
        print(f'page {k + 1}: python score {score:.3f}, tables {[round(t, 3) for t in tscores]}, worst crop corner off the truth {err:.1f} px')
        expected.append(dict(page=f'page-{k + 1}.png', score=round(score, 4), table_scores=[round(t, 4) for t in tscores], crops=crops, truth=truth))
    json.dump(dict(note='made-up pages from tools/scan/parity.py; Python align.py/scan.py results', pages=expected),
              open(f'{out}/expected.json', 'w', encoding='utf-8'), separators=(',', ':'))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'test', 'scan-parity'))
