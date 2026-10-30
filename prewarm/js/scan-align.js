// Scan pages: line the phone's tidied page up with the blank form, in plain code on grey pixel arrays (no DOM, no
// libraries; fake pixels only in tests). The phone already has the page flat (scan-geom.js, PAGE_W x PAGE_H); what is
// left is a small misfit (a few pixels of shift, scale or turn, rows drifting down a long table). Port of
// tools/scan/align.py without find_sheet: a coarse scale+shift search on quarter-size ink, an affine fit to the
// template's printed lines (in place of OpenCV's ECC), refine_tables (each printed table's own row and column lines)
// and line_score (low = retake the page). Templates are quarter size (450x600, darkest pixel of each 4x4 block) from
// tools/scan/make-form-map.py; tables are in full page pixels.
export const Q = 4;                 // template pixels are Q x Q page pixels
export const RETAKE = 0.80, CHECK = 0.90, COARSE_BELOW = 0.85;   // scan.py's MIN_ALIGN, CHECK_ALIGN; align_page's fallback

// grey (0-255) from RGBA, same weights as scan-geom.js
export function toGray(rgba) {
  const n = rgba.length >> 2, g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return g;
}

// ---------- small image helpers (row-major, width w)

// darkest (or brightest with max = true) pixel of each q x q block
export function pool(g, w, h, q = Q, max = false) {
  const qw = Math.floor(w / q), qh = Math.floor(h / q), out = new Uint8Array(qw * qh).fill(max ? 0 : 255);
  for (let y = 0; y < qh * q; y++) {
    const row = y * w, orow = ((y / q) | 0) * qw;
    for (let x = 0; x < qw * q; x++) {
      const v = g[row + x], o = orow + ((x / q) | 0);
      if (max ? v > out[o] : v < out[o]) out[o] = v;
    }
  }
  return out;
}

// mean of each q x q block (Float32)
function meanPool(g, w, h, q) {
  const qw = Math.floor(w / q), qh = Math.floor(h / q), out = new Float32Array(qw * qh);
  for (let y = 0; y < qh * q; y++) { const row = y * w, orow = ((y / q) | 0) * qw; for (let x = 0; x < qw * q; x++) out[orow + ((x / q) | 0)] += g[row + x]; }
  for (let i = 0; i < out.length; i++) out[i] /= q * q;
  return out;
}

// max (or min) over a (2r+1) square window, separable; edges use what is inside the image
export function rankFilter(g, w, h, r, max = true) {
  const tmp = new (g.constructor)(g.length), out = new (g.constructor)(g.length);
  const pick = max ? Math.max : Math.min;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) { let v = g[row + x]; for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) v = pick(v, g[row + k]); tmp[row + x] = v; }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) { let v = tmp[y * w + x]; for (let k = y0; k <= y1; k++) v = pick(v, tmp[k * w + x]); out[y * w + x] = v; }
  }
  return out;
}

// a 0/1 mask grown by r pixels (a fast square dilation for masks)
export function dilateMask(m, w, h, r) {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9; const row = y * w;
    for (let x = 0; x < w + r; x++) { if (x < w && m[row + x]) last = x; const t = x - r; if (t >= 0 && t < w && x - last <= 2 * r) tmp[row + t] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h + r; y++) { if (y < h && tmp[y * w + x]) last = y; const t = y - r; if (t >= 0 && t < h && y - last <= 2 * r) out[t * w + x] = 1; }
  }
  return out;
}

// box blur of radius r (Float32), separable, edges clamped; run it twice or three times for a gaussian-like blur
export function boxBlur(f, w, h, r) {
  const tmp = new Float32Array(f.length), out = new Float32Array(f.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w; let s = 0;
    for (let k = -r; k <= r; k++) s += f[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) { tmp[row + x] = s / n; s += f[row + Math.min(w - 1, x + r + 1)] - f[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

const blur = (f, w, h, r, times = 3) => { for (let i = 0; i < times; i++) f = boxBlur(f, w, h, r); return f; };

// bilinear sample (paper white outside the image)
function sample(g, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
  const x0 = Math.min(w - 2, x | 0), y0 = Math.min(h - 2, y | 0), fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

// Divide out shadows and uneven light so paper is ~255 everywhere (align.py flatten_illumination: the paper level is
// the brightest pixel nearby, smoothed over ~50 px). Large pages do it at quarter size and scale the level back up.
export function flattenIllumination(g, w, h) {
  const k = Math.min(w, h) >= 400 ? Q : 1, sw = Math.floor(w / k), sh = Math.floor(h / k);
  const small = k === 1 ? Float32Array.from(g) : meanPool(g, w, h, k);
  let bg = rankFilter(small, sw, sh, Math.max(1, Math.round(7 / k)), true);
  bg = blur(bg, sw, sh, Math.max(1, Math.round(12 / k)), 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = k === 1 ? bg[y * w + x] : sample(bg, sw, sh, Math.min(sw - 1, (x + 0.5) / k - 0.5), Math.min(sh - 1, (y + 0.5) / k - 0.5));
    out[y * w + x] = Math.min(255, Math.round(g[y * w + x] * 255 / Math.max(1, b)));
  }
  return out;
}

const below = (g, t) => { const m = new Uint8Array(g.length); for (let i = 0; i < g.length; i++) m[i] = g[i] < t ? 1 : 0; return m; };

// ---------- the score

// Share of the template's printed ink that has dark pixels under it on the page (align.py line_score), counted on the
// quarter grid: `hitQ` = page ink within 2 px, any in each block (from hitGrid); box = [x0, y0, x1, y1] in page px.
export function hitGrid(dark, w, h) { return pool(dilateMask(dark, w, h, 2), w, h, Q, true); }
export function lineScore(hitQ, tplQ, qw, qh, box = null) {
  const [x0, y0, x1, y1] = box ? box.map(v => Math.round(v / Q)) : [0, 0, qw, qh];
  let t = 0, hit = 0;
  for (let y = Math.max(0, y0); y < Math.min(qh, y1); y++) for (let x = Math.max(0, x0); x < Math.min(qw, x1); x++) {
    const i = y * qw + x; if (tplQ[i] < 140) { t++; if (hitQ[i]) hit++; }
  }
  return hit / Math.max(1, t);
}

// ---------- coarse: slide and scale the ink profiles (align.py _best_scale_shift, coarse_quads)

// [{corr, scale, shift}] best first: photo profile pa stretched by scale about its centre, slid by shift samples
export function bestScaleShift(pa, pt, scales, maxShift) {
  const n = pt.length, out = []; let tm = 0; for (const v of pt) tm += v; tm /= n;
  const interp = u => { const i = Math.min(n - 2, Math.floor(u)), f = u - i; return pa[i] * (1 - f) + pa[i + 1] * f; };
  for (const sc of scales) for (let sh = -maxShift; sh <= maxShift; sh++) {
    const vs = [], ts = [];
    for (let x = 0; x < n; x++) { const src = (x - n / 2 - sh) / sc + n / 2; if (src >= 0 && src <= n - 1) { vs.push(interp(src)); ts.push(pt[x] - tm); } }
    if (vs.length < 0.6 * n) continue;
    const mv = vs.reduce((a, b) => a + b, 0) / vs.length, mt = ts.reduce((a, b) => a + b, 0) / ts.length;
    let num = 0, dv = 0, dt = 0;
    for (let i = 0; i < vs.length; i++) { const a = vs[i] - mv, b = ts[i] - mt; num += a * b; dv += a * a; dt += b * b; }
    const den = Math.sqrt(dv * dt);
    if (den > 0) out.push({ corr: num / den, scale: sc, shift: sh });
  }
  return out.sort((a, b) => b.corr - a.corr || b.scale - a.scale || b.shift - a.shift);
}

function profiles(ink, qw, qh) {
  const rows = new Float32Array(qh), cols = new Float32Array(qw);
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) { const v = ink[y * qw + x]; rows[y] += v / qw; cols[x] += v / qh; }
  const sm = p => p.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < p.length) { s += p[j] * [1, 4, 6, 4, 1][k + 2]; n += [1, 4, 6, 4, 1][k + 2]; } } return s / n; });
  return { rows: sm(rows), cols: sm(cols) };
}

// starting affines (template quarter px -> page quarter px) from the ink profiles, best first
export function coarseStarts(pageInkQ, tplInkQ, qw, qh, top = 2) {
  const a = profiles(pageInkQ, qw, qh), t = profiles(tplInkQ, qw, qh), scales = [];
  for (let s = 0.85; s < 1.31; s += 0.025) scales.push(+s.toFixed(3));
  const ys = bestScaleShift(a.rows, t.rows, scales, 60).slice(0, top), xs = bestScaleShift(a.cols, t.cols, scales, 45).slice(0, top), out = [];
  // template position u sees the page at (u - n/2 - shift) / scale + n/2
  for (const y of ys) for (const x of xs) out.push([1 / x.scale, 0, qw / 2 - (qw / 2 + x.shift) / x.scale, 0, 1 / y.scale, qh / 2 - (qh / 2 + y.shift) / y.scale]);
  return out;
}

// ---------- fine: affine fit of the page's ink onto the template's printed lines (Gauss-Newton, in place of ECC)

const mapA = (A, x, y) => [A[0] * x + A[1] * y + A[2], A[3] * x + A[4] * y + A[5]];

function solve(M, b) {   // Gaussian elimination with partial pivoting, n x n
  const n = b.length, a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = a[r][c] / a[c][c]; for (let j = c; j <= n; j++) a[r][j] -= k * a[c][j]; }
  }
  return a.map((r, i) => r[n] / r[i]);
}

// T, I: Float32 ink images (0 paper, 1 ink) of the same size; A: template -> page affine to start from. Returns the fit.
export function fitAffine(T, I, w, h, A0, iters = 40, use = null) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; gx[i] = (I[i + 1] - I[i - 1]) / 2; gy[i] = (I[i + w] - I[i - w]) / 2; }
  const pts = [];   // template pixels near printed lines (where the fit is decided), every other one is plenty
  for (let y = 2; y < h - 2; y += 1) for (let x = 2 + (y & 1); x < w - 2; x += 2) {
    const i = y * w + x; if (Math.abs(T[i + 1] - T[i - 1]) + Math.abs(T[i + w] - T[i - w]) > 0.02 && (!use || use(x, y))) pts.push(i);
  }
  const cx = w / 2, cy = h / 2, smp = (f, x, y) => {
    if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return 0;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + w] * (1 - fx) + f[i + w + 1] * fx) * fy;
  };
  let A = A0.slice();
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: 6 }, () => new Float64Array(6)), b = new Float64Array(6);
    for (const i of pts) {
      const x = i % w, y = (i - x) / w, [u, v] = mapA(A, x, y);
      const ix = smp(gx, u, v), iy = smp(gy, u, v), e = T[i] - smp(I, u, v), dx = x - cx, dy = y - cy;
      const J = [ix * dx, ix * dy, ix, iy * dx, iy * dy, iy];
      for (let r = 0; r < 6; r++) { b[r] += J[r] * e; for (let c = r; c < 6; c++) H[r][c] += J[r] * J[c]; }
    }
    for (let r = 0; r < 6; r++) for (let c = 0; c < r; c++) H[r][c] = H[c][r];
    for (let r = 0; r < 6; r++) H[r][r] *= 1.0001;
    const d = solve(H.map(r => [...r]), [...b]); if (!d) break;
    // the step is in centred coordinates: u = (a0 + d0)(x) ... with x = dx + cx
    A = [A[0] + d[0], A[1] + d[1], A[2] + d[2] - d[0] * cx - d[1] * cy, A[3] + d[3], A[4] + d[4], A[5] + d[5] - d[3] * cx - d[4] * cy];
    if (Math.abs(d[2]) + Math.abs(d[5]) < 0.002 && Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[3]) + Math.abs(d[4]) < 1e-5) break;
  }
  return A;
}

// an affine on a k times coarser grid -> the finer grid (pixel centres: fine X = k x + (k - 1) / 2), and back
function finer(a, k = Q) {
  const o = (k - 1) / 2;
  return [a[0], a[1], k * a[2] + o - o * (a[0] + a[1]), a[3], a[4], k * a[5] + o - o * (a[3] + a[4])];
}
function coarser(a, k) {
  const o = (k - 1) / 2;
  return [a[0], a[1], (a[2] - o + o * (a[0] + a[1])) / k, a[3], a[4], (a[5] - o + o * (a[3] + a[4])) / k];
}
const fullAffine = a => finer(a, Q);

// ---------- tables (align.py refine_tables, _runs, _match_lines)

export function runs(prof, thr, gap = 3) {
  const groups = [];
  prof.forEach((v, i) => { if (v < thr) return; const g = groups[groups.length - 1]; if (g && i - g[g.length - 1] <= gap) g.push(i); else groups.push([i]); });
  return groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
}

// {template line index: page position}: the scale and shift that make the two sets agree best, then the nearest within tol
export function matchLines(tpl, found, tol) {
  if (found.length < 3) return {};
  let best = null;
  for (let k = 0; k < 49; k++) {
    const a = 0.94 + 0.12 * k / 48;
    for (let b = -120; b <= 120; b += 2) {
      let hit = 0, sum = 0;
      for (const t of tpl) { const m = a * t + b; let d = Infinity; for (const f of found) d = Math.min(d, Math.abs(m - f)); if (d < tol) hit++; sum += Math.min(40, d); }
      const score = hit - 0.002 * sum;
      if (!best || score > best[0]) best = [score, a, b];
    }
  }
  const [, a, b] = best, out = {};
  tpl.forEach((t, j) => { let k = 0; for (let i = 1; i < found.length; i++) if (Math.abs(found[i] - (a * t + b)) < Math.abs(found[k] - (a * t + b))) k = i; if (Math.abs(found[k] - (a * t + b)) < tol) out[j] = found[k]; });
  return out;
}

// piecewise straight between knots [[template, page]], the nearest offset carries on outside them
export function knotMap(ks, u) {
  if (u <= ks[0][0]) return ks[0][1] + (u - ks[0][0]);
  const l = ks[ks.length - 1]; if (u >= l[0]) return l[1] + (u - l[0]);
  let i = 1; while (ks[i][0] < u) i++;
  const [t0, v0] = ks[i - 1], [t1, v1] = ks[i];
  return v0 + (v1 - v0) * (u - t0) / (t1 - t0);
}

// dark: 0/1 ink mask of the aligned page. Returns [{region: [x0, y0, x1, y1], kx, ky}] for each table whose lines were
// found (knots in region-local px), in the tables' order.
export function refineTables(dark, w, h, tables) {
  const out = [];
  for (const tb of tables) {
    const [x0, y0, x1, y1] = tb.bbox, m = 60;
    const rx0 = Math.max(0, x0 - m), ry0 = Math.max(0, y0 - m), rx1 = Math.min(w, x1 + m), ry1 = Math.min(h, y1 + m), sw = rx1 - rx0, sh = ry1 - ry0;
    const cx0 = Math.max(0, x0 - rx0 + 8), cx1 = Math.min(sw, x1 - rx0 - 8), cy0 = Math.max(0, y0 - ry0 + 8), cy1 = Math.min(sh, y1 - ry0 - 8);
    const rowP = new Float32Array(sh), colP = new Float32Array(sw);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const v = dark[(y + ry0) * w + x + rx0]; if (!v) continue;
      if (x >= cx0 && x < cx1) rowP[y]++;
      if (y >= cy0 && y < cy1) colP[x]++;
    }
    for (let y = 0; y < sh; y++) rowP[y] /= Math.max(1, cx1 - cx0);
    for (let x = 0; x < sw; x++) colP[x] /= Math.max(1, cy1 - cy0);
    const my = matchLines(tb.ys.map(v => v - ry0), runs(rowP, 0.30), 10), mx = matchLines(tb.xs.map(v => v - rx0), runs(colP, 0.30), 10);
    if (Object.keys(my).length < 0.7 * tb.ys.length || Object.keys(mx).length < 0.7 * tb.xs.length) continue;
    const knots = (tpl, got, off) => Object.entries(got).map(([j, v]) => [tpl[j] - off, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    out.push({ region: [rx0, ry0, rx1, ry1], kx: knots(tb.xs, mx, rx0), ky: knots(tb.ys, my, ry0) });
  }
  return out;
}

// ---------- the whole page

// a point on the template (page px) -> where it is on the phone's page: inside a refined table through its row and
// column knots and the page affine, elsewhere through `outer` (the affine refitted to what lies outside the tables)
const inRegion = (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
export function mapPoint(fit, x, y) {
  for (let i = fit.tables.length - 1; i >= 0; i--) {   // a later table wins where they overlap, as in refine_tables
    const { region, kx, ky } = fit.tables[i];
    if (inRegion(region, x, y)) { const [u, v] = mapA(fit.affine, knotMap(kx, x - region[0]) + region[0], knotMap(ky, y - region[1]) + region[1]); return { x: u, y: v }; }
  }
  const [u, v] = mapA(fit.outer || fit.affine, x, y);
  return { x: u, y: v };
}

// resample `g` (page px) onto the template's grid through the fit
export function warpTo(g, w, h, fit) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = mapPoint(fit, x, y); out[y * w + x] = Math.round(sample(g, w, h, p.x, p.y)); }
  return out;
}

const IDENT = [1, 0, 0, 0, 1, 0];

// Line the phone's flat page (grey, w x h, normally 1800x2400) up with a page of the form: tplQ is its quarter-size
// template, tables its printed tables (page px; from form-map.json). Returns { gray: the aligned page, dark: its ink
// mask (for inkLayer), score, tableScores, retake, check, fit: { affine, tables } (mapPoint gives where a template
// point is on the input page) }.
export function alignPage(gray, w, h, tplQ, tables = [], opt = {}) {
  const qw = Math.floor(w / Q), qh = Math.floor(h / Q);
  const flat = flattenIllumination(gray, w, h), flatQ = pool(flat, w, h);
  const toInk = g => { const f = new Float32Array(g.length); for (let i = 0; i < g.length; i++) f[i] = Math.max(0, Math.min(1, (235 - g[i]) / 140)); return f; };
  const Ti = toInk(tplQ), Ii = toInk(flatQ);
  const scoreOf = A => { const fit = { affine: fullAffine(A), tables: [] }, d = below(warpTo(flat, w, h, fit), 150); return { fit, dark: d, score: lineScore(hitGrid(d, w, h), tplQ, qw, qh) }; };
  // a pyramid: 1/16 and 1/8 of the page pull in a misfit of ~50 px (more than a table row), the quarter settles it
  const levels = [[4, 1, 40], [2, 1, 40], [1, 2, 30], [1, 1, 30]].map(([k, r, it]) => {
    const lw = Math.floor(qw / k), lh = Math.floor(qh / k);
    return { k, it, lw, lh, T: blur(k === 1 ? Ti : meanPool(Ti, qw, qh, k), lw, lh, r), I: blur(k === 1 ? Ii : meanPool(Ii, qw, qh, k), lw, lh, r) };
  });
  const refine = A => {
    for (const L of levels) A = finer(fitAffine(L.T, L.I, L.lw, L.lh, coarser(A, L.k), L.it), L.k);
    return A;
  };
  let best = scoreOf(IDENT);
  const tryA = A => { const s = scoreOf(A); if (s.score > best.score) best = s; };
  tryA(refine(IDENT));
  if (best.score < COARSE_BELOW) {
    const inkQ = g => { const m = new Float32Array(g.length); for (let i = 0; i < g.length; i++) m[i] = g[i] < 170 ? 1 : 0; return m; };
    for (const A of coarseStarts(inkQ(flatQ), inkQ(tplQ), qw, qh)) { tryA(refine(A)); if (best.score >= CHECK) break; }
  }
  let { fit, dark, score } = best, tableScores = [];
  if (tables.length && !opt.noTables) {
    const ts = refineTables(dark, w, h, tables);
    if (ts.length) {
      const f2 = { affine: fit.affine, tables: ts }, d2 = below(warpTo(flat, w, h, f2), 150), hq = hitGrid(d2, w, h), s2 = lineScore(hq, tplQ, qw, qh);
      if (s2 > score) { fit = f2; dark = d2; score = s2; tableScores = tables.map(tb => lineScore(hq, tplQ, qw, qh, tb.bbox)); }
      // a long table's drifting rows pull the page affine; what lies outside the tables gets its own fit (if it has enough lines)
      if (fit === f2) {
        const L = levels[levels.length - 1], out = (x, y) => !ts.some(t => inRegion(t.region, Q * x + 1.5, Q * y + 1.5));
        let n = 0; for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) if (tplQ[y * qw + x] < 140 && out(x, y)) n++;
        if (n >= 400) {
          const outer = finer(fitAffine(L.T, L.I, L.lw, L.lh, coarser(fit.affine, Q), 30, out), Q);
          const f3 = { ...fit, outer }, d3 = below(warpTo(flat, w, h, f3), 150), s3 = lineScore(hitGrid(d3, w, h), tplQ, qw, qh);
          if (s3 >= score) { fit = f3; dark = d3; score = s3; }
        }
      }
    }
  }
  return { gray: warpTo(gray, w, h, fit), dark, score, tableScores, fit, retake: score < RETAKE && !tableOk(score, tableScores), check: score < CHECK };
}

// scan.py: a page under RETAKE is still taken if every refined table fits well on its own (TABLE_OK, TABLE_PAGE_MIN)
export const tableOk = (score, ts) => ts.length > 0 && Math.min(...ts) >= 0.85 && score >= 0.70;
