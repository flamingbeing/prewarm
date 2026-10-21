"""Phone photo of a printed form page -> the template's pixel grid, plus an ink-only layer.

align_page(photo, template) finds the sheet in the photo, flattens it onto the template's size, then refines with ECC
(an iterative image-registration fit) so the printed lines sit on the template's lines. The returned score is how much
of the template's printed ink lands on printed ink in the photo: low means retake the photo, never guess."""
import cv2
import numpy as np


def _order(pts):
    pts = pts.reshape(4, 2).astype(np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], np.float32)  # tl tr br bl


def find_sheet(gray):
    """The four corners of the paper (largest bright quadrilateral), or None if the photo is cropped to the page."""
    small = cv2.resize(gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(small, (9, 9), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cs, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.25 * small.shape[0] * small.shape[1]:
        return None
    for eps in (0.02, 0.03, 0.05, 0.08):
        q = cv2.approxPolyDP(c, eps * cv2.arcLength(c, True), True)
        if len(q) == 4:
            return _order(q) * 4
    return None


def find_sheet_colour(bgr):
    """Second guess at the paper's corners from colour: white, unsaturated pixels (the table, a hand or a shadow's edge
    do not fool it the way brightness alone can). Returns the corners of the convex hull's four-sided fit, or None."""
    small = cv2.resize(bgr, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(cv2.GaussianBlur(small, (7, 7), 0), cv2.COLOR_BGR2HSV)
    m = ((hsv[..., 1] < 70) & (hsv[..., 2] > 120)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.25 * m.shape[0] * m.shape[1]:
        return None
    hull = cv2.convexHull(c)
    for eps in (0.02, 0.03, 0.05, 0.08):
        q = cv2.approxPolyDP(hull, eps * cv2.arcLength(hull, True), True)
        if len(q) == 4:
            return _order(q) * 4
    return None


def flatten_illumination(gray):
    """Divide out shadows and uneven light so paper is ~255 everywhere."""
    bg = cv2.medianBlur(cv2.dilate(gray, np.ones((15, 15), np.uint8)), 51)
    return cv2.divide(gray, bg, scale=255)


def line_score(aligned_gray, template_gray, box=None):
    """Share of the template's printed ink (thickened a little) that has dark pixels under it in the photo (inside box
    = (x0, y0, x1, y1) if given: used to judge one table on its own)."""
    if box is not None:
        x0, y0, x1, y1 = box
        aligned_gray, template_gray = aligned_gray[y0:y1, x0:x1], template_gray[y0:y1, x0:x1]
    t = (template_gray < 140).astype(np.uint8)
    a = (flatten_illumination(aligned_gray) < 150).astype(np.uint8)
    hit = cv2.dilate(a, np.ones((5, 5), np.uint8))
    return float((t & hit).sum() / max(1, t.sum()))


def _align_from(gray, quad, template_gray):
    """Flatten onto the template using the sheet corners `quad` (None: the photo is already cropped to the page), refine with
    ECC, and return (aligned page, score)."""
    h, w = template_gray.shape
    if quad is not None:
        M = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32))
        flat = cv2.warpPerspective(gray, M, (w, h), flags=cv2.INTER_AREA, borderValue=255)
    else:
        flat = cv2.resize(gray, (w, h), interpolation=cv2.INTER_AREA)
    # ECC refinement on shadow-flattened, blurred images (coarse then fine)
    a, t = flatten_illumination(flat), flatten_illumination(template_gray)
    warp = np.eye(3, dtype=np.float32)
    for scale in (0.2, 0.35):
        sa = cv2.GaussianBlur(cv2.resize(a, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), (0, 0), 2)
        st = cv2.GaussianBlur(cv2.resize(t, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), (0, 0), 2)
        W = warp.copy(); W[:2, 2] *= scale; W[2, :2] /= scale
        try:
            _, W = cv2.findTransformECC(st, sa, W, cv2.MOTION_HOMOGRAPHY,
                                        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
        except cv2.error:
            break
        W[:2, 2] /= scale; W[2, :2] *= scale; warp = W
    fine = cv2.warpPerspective(flat, warp, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderValue=255)
    s0, s1 = line_score(flat, template_gray), line_score(fine, template_gray)
    return (fine, s1) if s1 >= s0 else (flat, s0)


def _best_scale_shift(pa, pt, scales, max_shift):
    """1-D: stretch the photo's ink profile `pa` by each scale about its centre and slide it over the template's `pt`; return
    the [(correlation, scale, shift)] list, best first (shift in profile samples, to move the photo onto the template)."""
    n = len(pt); x = np.arange(n, dtype=np.float32); tn = pt - pt.mean(); out = []
    for sc in scales:
        # photo sample at template position u is pa[(u - n/2 - shift)/sc + n/2]
        for sh in range(-max_shift, max_shift + 1):
            src = (x - n / 2 - sh) / sc + n / 2
            ok = (src >= 0) & (src <= n - 1)
            if ok.sum() < 0.6 * n: continue
            v = np.interp(src[ok], x, pa) - 0; t = tn[ok]
            den = np.sqrt(((v - v.mean()) ** 2).sum() * ((t - t.mean()) ** 2).sum())
            if den > 0: out.append((float(((v - v.mean()) * (t - t.mean())).sum() / den), float(sc), float(sh)))
    out.sort(reverse=True)
    return out


def coarse_quads(gray, template_gray, top=4):
    """The photo is framed a little off the template (the page fills 85-130% of the frame, shifted a few percent): ECC cannot
    recover from that. Match the photo's row and column ink profiles to the template's over a range of scales and shifts, and
    return the best placements as quads for _align_from to refine."""
    h, w = template_gray.shape
    H, W = gray.shape
    ink = lambda im: (flatten_illumination(im) < 170).astype(np.float32)
    flat = cv2.resize(gray, (w, h), interpolation=cv2.INTER_AREA)
    a, t = ink(flat), ink(template_gray)
    f = 4  # profiles at quarter resolution
    prof = lambda m, ax: cv2.GaussianBlur(cv2.resize(m, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_AREA).mean(ax).reshape(-1, 1), (1, 5), 0).ravel()
    scales = np.arange(0.85, 1.31, 0.025)
    ys = _best_scale_shift(prof(a, 1), prof(t, 1), scales, int(240 / f))[:top]
    xs = _best_scale_shift(prof(a, 0), prof(t, 0), scales, int(180 / f))[:top]
    quads = []
    for _, sy, dy in ys[:2]:
        for _, sx, dx in xs[:2]:
            dxp, dyp = dx * f, dy * f
            # template corners seen in the (template-sized) photo, then in the real photo's pixels
            q = np.array([[(0 - w / 2 - dxp) / sx + w / 2, (0 - h / 2 - dyp) / sy + h / 2],
                          [(w - w / 2 - dxp) / sx + w / 2, (0 - h / 2 - dyp) / sy + h / 2],
                          [(w - w / 2 - dxp) / sx + w / 2, (h - h / 2 - dyp) / sy + h / 2],
                          [(0 - w / 2 - dxp) / sx + w / 2, (h - h / 2 - dyp) / sy + h / 2]], np.float32)
            quads.append((q * np.array([W / w, H / h])).astype(np.float32))
    return quads


def align_page(photo_bgr, template_gray):
    """Try each guess at the sheet (brightness corners, colour corners, the whole photo as already cropped) and keep the
    best-aligned. A shadow or a hand can fool one guess (a shaded edge cuts a corner off); rarely all of them. If none lines
    up, slide and scale the photo over the template to find where the page sits and refine from there."""
    gray = cv2.cvtColor(photo_bgr, cv2.COLOR_BGR2GRAY)
    best = None
    for quad in (find_sheet(gray), find_sheet_colour(photo_bgr), None):
        out, score = _align_from(gray, quad, template_gray)
        if best is None or score > best[1]:
            best = (out, score)
        if score >= 0.9:
            return best
    if best[1] < 0.85:
        for quad in coarse_quads(gray, template_gray):
            out, score = _align_from(gray, quad, template_gray)
            if score > best[1]:
                best = (out, score)
            if best[1] >= 0.9:
                break
    return best


def ink_layer(aligned_gray, template_gray):
    """Only what was written: the photo's dark marks minus the printed form (thickened to forgive a pixel or two)."""
    dark = (flatten_illumination(aligned_gray) < 150).astype(np.uint8)
    printed = cv2.dilate((template_gray < 160).astype(np.uint8), np.ones((7, 7), np.uint8))
    ink = dark & (1 - printed)
    return cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))


def guess_page(photo_bgr, templates):
    """Which template page this photo shows: flatten roughly (no ECC) and compare line patterns at low resolution."""
    scores = []
    for t in templates:
        h, w = t.shape
        gray = cv2.cvtColor(photo_bgr, cv2.COLOR_BGR2GRAY)
        quad = find_sheet(gray)
        if quad is not None:
            M = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32))
            flat = cv2.warpPerspective(gray, M, (w, h), flags=cv2.INTER_AREA, borderValue=255)
        else:
            flat = cv2.resize(gray, (w, h), interpolation=cv2.INTER_AREA)
        q = lambda im: cv2.resize(im, None, fx=0.2, fy=0.2, interpolation=cv2.INTER_AREA)
        a = (q(flatten_illumination(flat)) < 190).astype(np.float32); b = (q(t) < 190).astype(np.float32)
        a, b = cv2.GaussianBlur(a, (0, 0), 2), cv2.GaussianBlur(b, (0, 0), 2)
        scores.append(float((a * b).sum() / max(1e-6, np.sqrt((a * a).sum() * (b * b).sum()))))
    return int(np.argmax(scores)), scores


# ---- tables: find the table's own lines in the photo and warp each row / column band onto the template's ----

def _runs(prof, thr, gap=3):
    idx = np.where(prof >= thr)[0]; groups = []
    for i in idx:
        if groups and i - groups[-1][-1] <= gap: groups[-1].append(i)
        else: groups.append([i])
    return [float(np.mean(g)) for g in groups]


def _match_lines(tpl_lines, found, tol):
    """Map each template line to a detected one: first find the scale and shift that make the two sets agree best, then take
    the nearest detected line within tol. Returns {template line index: photo position} (some may be missing)."""
    t = np.array(tpl_lines, float); f = np.array(found, float)
    if len(f) < 3: return {}
    best = None
    for a in np.linspace(0.94, 1.06, 49):
        for b in range(-120, 121, 2):
            m = a * t + b
            d = np.abs(m[:, None] - f[None, :]).min(1)
            score = float((d < tol).sum()) - 0.002 * float(d.clip(0, 40).sum())
            if best is None or score > best[0]: best = (score, a, b)
    _, a, b = best
    out = {}
    for j, tj in enumerate(t):
        d = np.abs(f - (a * tj + b)); k = int(d.argmin())
        if d[k] < tol: out[j] = float(f[k])
    return out


def refine_tables(flat, template_gray, tables):
    """Rows and columns of a printed table seldom land exactly where the template says (a long table over a phone-lens
    curve; a different row height). Find the table's lines in the photo, match them to the template's, and resample the
    table so every row and column sits where the template has it. Returns the (possibly) refined page and how many tables
    were refined."""
    bw = (flatten_illumination(flat) < 150).astype(np.float32)
    out = flat.copy(); n = 0
    h, w = flat.shape
    for tb in tables:
        x0, y0, x1, y1 = tb['bbox']; m = 60
        rx0, ry0, rx1, ry1 = max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)
        sub = bw[ry0:ry1, rx0:rx1]
        # rows: dark across most of the table's width; columns: dark down most of its height
        cx0, cx1 = max(0, x0 - rx0 + 8), min(sub.shape[1], x1 - rx0 - 8)
        cy0, cy1 = max(0, y0 - ry0 + 8), min(sub.shape[0], y1 - ry0 - 8)
        rows = _runs(sub[:, cx0:cx1].mean(1), 0.30); cols = _runs(sub[cy0:cy1, :].mean(0), 0.30)
        my = _match_lines([v - ry0 for v in tb['ys']], rows, 10); mx = _match_lines([v - rx0 for v in tb['xs']], cols, 10)
        if len(my) < 0.7 * len(tb['ys']) or len(mx) < 0.7 * len(tb['xs']):
            continue
        def knots(tpl, got, off):
            ks = sorted((tpl[j] - off, v) for j, v in got.items())
            t = np.array([k[0] for k in ks]); v = np.array([k[1] for k in ks])
            return t, v
        ty, vy = knots(tb['ys'], my, ry0); tx, vx = knots(tb['xs'], mx, rx0)
        yy = np.arange(sub.shape[0], dtype=np.float32); xx = np.arange(sub.shape[1], dtype=np.float32)
        # between knots straight lines; outside them the nearest offset carries on
        fy = np.interp(yy, ty, vy, left=None, right=None)
        fy = np.where(yy < ty[0], vy[0] + (yy - ty[0]), np.where(yy > ty[-1], vy[-1] + (yy - ty[-1]), fy))
        fx = np.interp(xx, tx, vx)
        fx = np.where(xx < tx[0], vx[0] + (xx - tx[0]), np.where(xx > tx[-1], vx[-1] + (xx - tx[-1]), fx))
        mapx = np.tile(fx[None, :], (sub.shape[0], 1)).astype(np.float32) + rx0
        mapy = np.tile(fy[:, None], (1, sub.shape[1])).astype(np.float32) + ry0
        out[ry0:ry1, rx0:rx1] = cv2.remap(flat, mapx, mapy, cv2.INTER_LINEAR, borderValue=255)
        n += 1
    return out, n
