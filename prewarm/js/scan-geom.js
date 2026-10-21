// Scan pages: the picture maths, in plain code on RGBA pixel arrays (no DOM, no libraries; fake pixels only in tests).
// Used by scan.js: guess the page corners, flatten the page with a perspective warp, take out shadows, set the contrast.
export const MAX_EDGE = 2400;
export const PAGE_W = 1800, PAGE_H = 2400; // the flat portrait page that goes to the study computer

// size after scaling the long edge down to `max` (never up)
export function fitSize(w, h, max = MAX_EDGE) { const k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; }

// Stretch the contrast so the paper is white and the pen is dark: one gain and offset for all channels (keeps colour),
// from the 1st percentile of brightness (ink) to the 70th (paper is most of a page). Changes `data` (RGBA) in place.
// A nearly flat image (blank or very dark) is left alone. Returns the levels used.
export function autoLevels(data) {
  const hist = new Uint32Array(256), n = data.length >> 2;
  for (let i = 0; i < data.length; i += 4) hist[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
  const at = q => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * n) return v; } return 255; };
  const lo = at(0.01), hi = at(0.7);
  if (hi - lo < 30) return { lo, hi, changed: false };
  const gain = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, (data[i + c] - lo) * gain));
  return { lo, hi, changed: true };
}

// ---------- corners
// Corners as [{x, y} ×4] in the order top-left, top-right, bottom-right, bottom-left.
export function orderCorners(pts) {
  const by = f => [...pts].sort((a, b) => f(a) - f(b));
  const s = by(p => p.x + p.y), d = by(p => p.y - p.x);
  return [s[0], d[0], s[3], d[3]];
}

// the next corner round the quad: turns the page a quarter (what "Rotate" does)
export const rotateCorners = q => [q[1], q[2], q[3], q[0]];

// A quad can be warped only if it is convex and not collapsed (all turns the same way).
export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

export const quadArea = q => Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;

// Otsu's threshold from a 256-bin histogram
function otsu(hist, n) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0, sb = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wb += hist[i]; if (!wb) continue;
    const wf = n - wb; if (!wf) break;
    sb += i * hist[i];
    const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf);
    if (v > best) { best = v; t = i; }
  }
  return t;
}

// Guess the page: the largest bright blob (Otsu threshold on brightness), then its four extreme points.
// Works on a small copy of the photo (about 300 px is plenty). Returns { corners, found }; when no blob is big enough
// the corners are the whole frame less a margin and found is false.
export function guessCorners(data, w, h) {
  const n = w * h, gray = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const g = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8; gray[i] = g; hist[g]++; }
  const t = otsu(hist, n), lab = new Int32Array(n), stack = new Int32Array(n);
  let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < n; s++) {
    if (gray[s] <= t || lab[s]) continue;
    id++; let sp = 0, area = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && gray[p - 1] > t && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && gray[p + 1] > t && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && gray[p - w] > t && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && gray[p + w] > t && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (area > best) { best = area; bestId = id; }
  }
  const m = 0.06, fallback = [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];
  if (!bestId || best < n * 0.12) return { corners: fallback, found: false };
  let tl, br, tr, bl; // extremes of x+y and y-x
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let p = 0; p < n; p++) {
    if (lab[p] !== bestId) continue;
    const x = p % w, y = (p - x) / w, s = x + y, d = y - x;
    if (s < minS) { minS = s; tl = { x, y }; } if (s > maxS) { maxS = s; br = { x, y }; }
    if (d < minD) { minD = d; tr = { x, y }; } if (d > maxD) { maxD = d; bl = { x, y }; }
  }
  const corners = [tl, tr, br, bl];
  if (!isConvex(corners) || quadArea(corners) < n * 0.1) return { corners: fallback, found: false };
  return { corners, found: true };
}

// ---------- perspective
// Solve the 3x3 projective map taking the 4 points `from` to the 4 points `to`: returns [h0..h7] (h8 is 1), or null.
export function solveHomography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], u = to[i].x, v = to[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c]; if (!f) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]);
}
export function applyH(H, x, y) { const d = H[6] * x + H[7] * y + 1; return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d }; }

// Cut the quad out of the photo (RGBA `src`, sw x sh) and stretch it flat into a dw x dh page (bilinear). Returns RGBA, or null.
export function warpPage(src, sw, sh, quad, dw = PAGE_W, dh = PAGE_H) {
  const H = solveHomography([{ x: 0, y: 0 }, { x: dw - 1, y: 0 }, { x: dw - 1, y: dh - 1 }, { x: 0, y: dh - 1 }], quad);
  if (!H) return null;
  const out = new Uint8ClampedArray(dw * dh * 4), mx = sw - 1, my = sh - 1;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const d = H[6] * x + H[7] * y + 1;
      let sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
      sx = sx < 0 ? 0 : sx > mx ? mx : sx; sy = sy < 0 ? 0 : sy > my ? my : sy;
      const x0 = sx | 0, y0 = sy | 0, x1 = x0 < mx ? x0 + 1 : x0, y1 = y0 < my ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, e = (y1 * sw + x1) * 4, o = (y * dw + x) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = src[a] * w00 + src[b] * w10 + src[c] * w01 + src[e] * w11;
      out[o + 1] = src[a + 1] * w00 + src[b + 1] * w10 + src[c + 1] * w01 + src[e + 1] * w11;
      out[o + 2] = src[a + 2] * w00 + src[b + 2] * w10 + src[c + 2] * w01 + src[e + 2] * w11;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ---------- lighting
// Shadow removal: estimate how the light falls on the paper, then divide it out. The estimate is made on a coarse grid
// (block averages per channel), widened with a max filter so pen strokes and print don't count as "dark light", smoothed
// with a box blur, and read back with bilinear interpolation. Pixel = pixel / background * 255, per channel (this also
// evens out a coloured light; ink keeps its hue relative to the paper). Changes `data` (RGBA) in place.
export function backgroundGrid(data, w, h, cell, grow = 3, soften = 2) {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), g = [0, 1, 2].map(() => new Float32Array(gw * gh));
  const cnt = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      const gi = gy * gw + ((x / cell) | 0), i = (y * w + x) * 4;
      g[0][gi] += data[i]; g[1][gi] += data[i + 1]; g[2][gi] += data[i + 2]; cnt[gi]++;
    }
  }
  const maxf = (a, r) => { // separable max filter, radius r cells
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(gw - 1, x + r); k++) m = Math.max(m, a[y * gw + k]); t[y * gw + x] = m; }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(gh - 1, y + r); k++) m = Math.max(m, t[k * gw + x]); o[y * gw + x] = m; }
    return o;
  };
  const blur = (a, r) => {
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0, c = 0; for (let k = Math.max(0, x - r); k <= Math.min(gw - 1, x + r); k++) { s += a[y * gw + k]; c++; } t[y * gw + x] = s / c; }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0, c = 0; for (let k = Math.max(0, y - r); k <= Math.min(gh - 1, y + r); k++) { s += t[k * gw + x]; c++; } o[y * gw + x] = s / c; }
    return o;
  };
  const chans = g.map(a => { for (let i = 0; i < a.length; i++) a[i] /= cnt[i] || 1; return blur(maxf(a, grow), soften); });
  return { gw, gh, cell, chans };
}

export function removeShadow(data, w, h, opt = {}) {
  const cell = opt.cell || Math.max(4, Math.round(Math.max(w, h) / 200)), floor = opt.floor || 24;
  const bg = backgroundGrid(data, w, h, cell, opt.grow || 3, opt.soften || 2), { gw, gh, chans } = bg;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(gh - 1, y / cell - 0.5)), y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(gw - 1, x / cell - 0.5)), x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0, i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = chans[c];
        const b = (a[y0 * gw + x0] * (1 - tx) + a[y0 * gw + x1] * tx) * (1 - ty) + (a[y1 * gw + x0] * (1 - tx) + a[y1 * gw + x1] * tx) * ty;
        const v = data[i + c] * 255 / Math.max(b, floor);
        data[i + c] = v > 255 ? 255 : v;
      }
    }
  }
  return bg;
}

// Auto: Colour when there is a fair amount of coloured ink (blue pen, a stamp), else Black and white.
export function autoMode(data) {
  let ink = 0; const n = data.length >> 2;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 50 && mx < 215) ink++;
  }
  return ink / n > 0.0015 ? 'color' : 'bw';
}

// Contrast for a shadow-free page. 'color' keeps the ink colour (one gain for all channels); 'bw' goes to grey, paper white,
// ink dark; 'auto' picks one of the two. Changes `data` in place and returns the mode used.
export function setContrast(data, mode = 'auto') {
  const use = mode === 'auto' ? autoMode(data) : mode;
  if (use === 'bw') {
    for (let i = 0; i < data.length; i += 4) { const g = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8; data[i] = data[i + 1] = data[i + 2] = g; }
    autoLevels(data);
    for (let i = 0; i < data.length; i += 4) { const v = (data[i] - 50) * 255 / 160; data[i] = data[i + 1] = data[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v; }
  } else autoLevels(data);
  return use;
}

// The whole thing from a photo to the page that is sent: flat RGBA (dw x dh) with the shadow taken out, not yet contrasted.
export function flattenPage(src, sw, sh, quad, dw = PAGE_W, dh = PAGE_H) {
  const flat = warpPage(src, sw, sh, quad, dw, dh);
  if (flat) removeShadow(flat, dw, dh);
  return flat;
}

// ---------- live camera and photo checks (owner, 20 Oct 2026)
// What to tell the person holding the phone, from guessCorners on a small live frame (w x h): { ok, say }.
// ok means the whole page is in view and big enough; the screen then waits for it to be held still.
export function coachFor(g, w, h) {
  if (!g.found) return { ok: false, say: 'Looking for the page: whole sheet in view, on a darker surface' };
  const m = Math.min(w, h) * 0.02;
  if (g.corners.some(p => p.x < m || p.y < m || p.x > w - 1 - m || p.y > h - 1 - m)) return { ok: false, say: 'Move back: a corner is cut off' };
  if (quadArea(g.corners) < w * h * 0.25) return { ok: false, say: 'Move closer' };
  return { ok: true, say: 'Hold steady' };
}

// how far the outline moved between two frames: the biggest corner move as a share of the frame's diagonal
export const quadMove = (a, b, w, h) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) / Math.hypot(w, h);

// Right after a shot (blur cannot be fixed later): sharpness is the variance of the 4-neighbour Laplacian of brightness,
// light the mean brightness, both inside the page (the quad's box less a tenth each side). Measure on a copy about
// 1000 px long so the numbers compare between phones. Thresholds are a first guess (the browser tests' fake page scores
// about 1300, and a 5 px blur of it is flagged); change them here if real pages say otherwise.
export const BLUR_MIN = 60, DARK_MIN = 70;
export function photoCheck(data, w, h, quad) {
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x1 - x0) / 10, my = (y1 - y0) / 10;
  x0 = Math.max(1, Math.round(x0 + mx)); x1 = Math.min(w - 2, Math.round(x1 - mx));
  y0 = Math.max(1, Math.round(y0 + my)); y1 = Math.min(h - 2, Math.round(y1 - my));
  const g = i => (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  let n = 0, s = 0, s2 = 0, lit = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, c = g(i), l = g(i - 1) + g(i + 1) + g(i - w) + g(i + w) - 4 * c;
    n++; s += l; s2 += l * l; lit += c;
  }
  if (!n) return { sharp: 0, light: 0, blurry: false, dark: false };
  const sharp = s2 / n - (s / n) ** 2, light = lit / n;
  return { sharp: Math.round(sharp), light: Math.round(light), blurry: sharp < BLUR_MIN, dark: light < DARK_MIN };
}

// ---------- snapping and turning upright (owner, 20 Oct 2026)
// Edges of a small copy of the photo (about 800 px long): Sobel gradient size per pixel and a Harris corner response
// (structure tensor over a 5x5 box), so a dragged corner can snap onto the paper's corner and a dragged side onto its edge.
export function edgeInfo(data, w, h) {
  const n = w * h, g = new Float32Array(n), mag = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  const xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
  let maxMag = 0, maxR = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    mag[i] = Math.hypot(gx, gy); if (mag[i] > maxMag) maxMag = mag[i];
    xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
  }
  const box = a => { // 5x5 box sum, separable
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x; t[i] = a[i - 2] + a[i - 1] + a[i] + a[i + 1] + a[i + 2]; }
    for (let y = 2; y < h - 2; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = t[i - 2 * w] + t[i - w] + t[i] + t[i + w] + t[i + 2 * w]; }
    return o;
  };
  const sx = box(xx), sy = box(yy), sxy = box(xy);
  for (let i = 0; i < n; i++) { const r = sx[i] * sy[i] - sxy[i] * sxy[i] - 0.05 * (sx[i] + sy[i]) ** 2; R[i] = r; if (r > maxR) maxR = r; }
  return { w, h, mag, R, maxMag, maxR };
}

// The strongest corner within r px of p (small-copy px), or null when nothing there looks like a corner.
export function snapCorner(e, p, r) {
  let best = 0, at = null;
  const x0 = Math.max(2, Math.round(p.x - r)), x1 = Math.min(e.w - 3, Math.round(p.x + r));
  const y0 = Math.max(2, Math.round(p.y - r)), y1 = Math.min(e.h - 3, Math.round(p.y + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
    const v = e.R[y * e.w + x]; if (v > best) { best = v; at = { x, y }; }
  }
  return at && best >= e.maxR * 0.02 ? at : null;
}

// How far to move the side a-b (along its normal, up to r px) to lie on the strongest straight edge near it:
// {dx, dy}, or null when no edge there is clearly stronger. Only the middle 80 % of the side is sampled (corners vary).
export function snapSide(e, a, b, r) {
  const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 4) return null;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, steps = Math.max(8, Math.round(len / 2));
  const along = off => {
    let s = 0, c = 0;
    for (let i = 0; i <= steps; i++) {
      const t = 0.1 + 0.8 * i / steps, x = Math.round(a.x + (b.x - a.x) * t + nx * off), y = Math.round(a.y + (b.y - a.y) * t + ny * off);
      if (x < 1 || y < 1 || x >= e.w - 1 || y >= e.h - 1) continue;
      s += e.mag[y * e.w + x]; c++;
    }
    return c > steps / 2 ? s / c : 0;
  };
  let best = along(0), bo = 0;
  for (let o = -Math.round(r); o <= r; o++) { const v = along(o); if (v > best) { best = v; bo = o; } }
  return bo && best >= e.maxMag * 0.2 ? { dx: nx * bo, dy: ny * bo } : null;
}

// Is the flat page upside down? Printed English has many more strokes above the letters' middle band (capitals, b d f h k l
// t) than below it (g j p q y). Ink pixels in long straight runs (table rules, boxes) are left out; the page is cut into
// 6 strips so a slight slant or two columns still give level lines. Each text line's middle band is the rows at least half
// as inked as its busiest row; ink above it counts up, ink below counts down. Returns { score (-1..1, plus = upright),
// lines, flip } where flip is set only when the evidence is clear (enough lines and a clearly negative score).
export const UPRIGHT_LINES = 12, UPRIGHT_FLIP = -0.2;
export function uprightScore(data, w, h) {
  const n = w * h, ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = ((data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8) < 140 ? 1 : 0;
  // long straight runs (gaps up to 3 px bridged, so a slightly slanted or broken rule still counts), widened 2 px across
  const longH = Math.round(w / 15), longV = Math.round(h / 40), rule = new Uint8Array(n), gap = 3, wide = 2;
  const runs = (len, cnt, at, min, mark) => { // walk each row (or column) a; mark runs of at least min px
    for (let a = 0; a < cnt; a++) {
      let s = -1, last = -1;
      for (let b = 0; b <= len; b++) {
        if (b < len && ink[at(a, b)]) { if (s < 0) s = b; last = b; }
        if (s >= 0 && (b === len || b - last > gap)) { if (last - s + 1 >= min) mark(a, s, last); s = -1; }
      }
    }
  };
  runs(w, h, (y, x) => y * w + x, longH, (y, s, e) => { for (let k = Math.max(0, y - wide); k <= Math.min(h - 1, y + wide); k++) rule.fill(1, k * w + s, k * w + e + 1); });
  runs(h, w, (x, y) => y * w + x, longV, (x, s, e) => { for (let y = s; y <= e; y++) for (let k = Math.max(0, x - wide); k <= Math.min(w - 1, x + wide); k++) rule[y * w + k] = 1; });
  const keep = new Uint8Array(n); for (let i = 0; i < n; i++) keep[i] = ink[i] && !rule[i] ? 1 : 0;
  const strips = 6, sw = Math.floor(w / strips), minH = Math.max(4, Math.round(h / 300)), maxH = Math.round(h / 30);
  let up = 0, down = 0, lines = 0;
  for (let s = 0; s < strips; s++) {
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) { let c = 0; for (let x = s * sw; x < (s + 1) * sw; x++) c += keep[y * w + x]; prof[y] = c; }
    const floor = Math.max(1, sw * 0.004);
    for (let y = 0; y < h;) {
      if (prof[y] < floor) { y++; continue; }
      let e = y; while (e < h && prof[e] >= floor) e++;
      const lh = e - y;
      if (lh >= minH && lh <= maxH) {
        let peak = 0, tot = 0; for (let k = y; k < e; k++) { peak = Math.max(peak, prof[k]); tot += prof[k]; }
        if (tot > sw * 0.15) { // enough ink to be a line of letters, not a stray speck
          let c0 = y; while (prof[c0] < peak / 2) c0++;
          let c1 = e - 1; while (prof[c1] < peak / 2) c1--;
          let a = 0, b = 0; for (let k = y; k < c0; k++) a += prof[k]; for (let k = c1 + 1; k < e; k++) b += prof[k];
          up += a; down += b; lines++;
        }
      }
      y = e;
    }
  }
  const score = up + down ? (up - down) / (up + down) : 0;
  return { score: +score.toFixed(3), lines, flip: lines >= UPRIGHT_LINES && score < UPRIGHT_FLIP };
}

// turn an RGBA image half a turn, in place
export function rotate180(data) { new Uint32Array(data.buffer, data.byteOffset, data.length >> 2).reverse(); return data; }
