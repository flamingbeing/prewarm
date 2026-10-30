// Scan pages: where to cut each field out of the aligned page and what the ink in it is (handwriting, an arrow, two
// marks, a tick), in plain code on 0/1 ink masks (no DOM, no libraries; fake pixels only in tests). Ports of
// tools/scan/scan.py crop_rect, has_writing, arrow_shaft, through_arrow, mark_groups, align.py ink_layer and ticks.py
// read_ticks. Masks are Uint8Array 0/1, row-major; rects are [x0, y0, x1, y1] in page px (x1, y1 exclusive).
import { Q, dilateMask } from './scan-align.js';

// Only what was written: the page's dark marks (alignPage's `dark`) minus the printed form (the quarter-size template,
// printed where < 160, grown ~3 px to forgive a pixel or two), then a 2x2 opening (drops one-pixel specks and lines).
export function inkLayer(dark, w, h, tplQ) {
  const qw = Math.floor(w / Q), printed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const qx = Math.min(qw - 1, (x / Q) | 0), qy = (y / Q) | 0; printed[y * w + x] = tplQ[qy * qw + qx] < 160 ? 1 : 0; }
  const grown = dilateMask(printed, w, h, 3), ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = dark[i] && !grown[i] ? 1 : 0;
  return open2(ink, w, h);
}

// opening with a 2x2 square (as OpenCV anchors it): erode over (x-1..x, y-1..y), then dilate over (x..x+1, y..y+1)
export function open2(m, w, h) {
  const e = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) { const i = y * w + x; e[i] = m[i] & m[i - 1] & m[i - w] & m[i - w - 1]; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; out[i] = e[i] | (x + 1 < w ? e[i + 1] : 0) | (y + 1 < h ? e[i + w] : 0) | (x + 1 < w && y + 1 < h ? e[i + w + 1] : 0);
  }
  return out;
}

// the part of a mask (or grey page) inside rect, as { data, w, h }
export function cut(m, w, rect) {
  const [x0, y0, x1, y1] = rect, cw = Math.max(0, x1 - x0), ch = Math.max(0, y1 - y0), out = new (m.constructor)(cw * ch);
  for (let y = 0; y < ch; y++) out.set(m.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
  return { data: out, w: cw, h: ch };
}

// The picture sent for reading: the field's cell (inner, 3 px inside its lines) with a wide margin around it, the margin
// faded so the reader can tell which cell is the field's. Owner, 30 Oct 2026: writing often runs over the cell's lines,
// and the old crop (5 px past the cell, about 0.6 mm) cut it off. MARGIN is page px (1800 wide = A4, ~0.12 mm a px).
export const MARGIN = [24, 36];
export function readCrop(gray, w, h, inner, m = MARGIN, fade = 0.4) {
  const [ix0, iy0, ix1, iy1] = inner, x0 = Math.max(0, ix0 - m[0]), y0 = Math.max(0, iy0 - m[1]);
  const x1 = Math.min(w, ix1 + m[0]), y1 = Math.min(h, iy1 + m[1]), c = cut(gray, w, [x0, y0, x1, y1]);
  const cx0 = ix0 - 3 - x0, cy0 = iy0 - 3 - y0, cx1 = ix1 + 3 - x0, cy1 = iy1 + 3 - y0;   // the cell with its lines
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) continue;
    const i = y * c.w + x; c.data[i] = 255 - Math.round((255 - c.data[i]) * fade);
  }
  return c;
}

// 8-connected pieces of ink: [{ x, y, w, h, a }] (bounding box and pixel count), like connectedComponentsWithStats
export function components(m, w, h) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    let sp = 0, a = 0, x0 = w, y0 = h, x1 = -1, y1 = -1; stack[sp++] = s; lab[s] = 1;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w; a++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx; if (m[q] && !lab[q]) { lab[q] = 1; stack[sp++] = q; }
      }
    }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, a });
  }
  return out;
}

// Handwriting, not a leftover sliver of a printed line or a table edge: strokes with real size and shape.
export function hasWriting(m, w, h) {
  let area = 0;
  for (const c of components(m, w, h)) {
    if (c.a < 12 || Math.max(c.w, c.h) < 8) continue;
    if (Math.min(c.w, c.h) <= 4 && Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h)) > 6) continue;   // a thin straight line
    area += c.a;
  }
  return area >= 40;
}

// A long vertical stroke through the middle of a cell: the shaft of a 'same as above' arrow.
export const arrowShaft = (m, W, H) => components(m, W, H).some(c => c.h >= 0.6 * H && c.w <= 0.25 * W + 4 && 0.25 * W <= c.x + c.w / 2 && c.x + c.w / 2 <= 0.75 * W);

// An arrow drawn down through a cell that also holds its head or a ditto mark: one stroke spanning nearly the whole cell
// height near the middle (written digits never run from top to bottom of the cell).
export const throughArrow = (m, W, H) => components(m, W, H).some(c => c.h >= 0.90 * H && c.w <= 0.08 * W + 2 && 0.3 * W <= c.x + c.w / 2 && c.x + c.w / 2 <= 0.7 * W);

// Separate pieces of writing side by side (gaps of `gap` empty columns), each with at least `least` ink pixels; the outer
// tenth on each side is left out (a printed line leaking in along the cell's edge is not a mark).
export function markGroups(m, w, h, gap = 6, least = 40) {
  const mg = Math.floor(w / 10), groups = [];
  let run = 0, empty = gap;
  for (let x = mg; x < w - mg; x++) {
    let c = 0; for (let y = 0; y < h; y++) c += m[y * w + x];
    if (c) { if (empty >= gap && run) { groups.push(run); run = 0; } run += c; empty = 0; } else empty++;
  }
  if (run) groups.push(run);
  return groups.filter(g => g >= least).length;
}

// { outer, inner }: inner is where handwriting is looked for (the smallest table cell holding the field's centre, 3 px
// in); outer is a little bigger, so digits that overrun the cell are not cut off. size = { w, h } of the page.
export function cropRect(rect, cells, size) {
  const [x0, y0, x1, y1] = rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const inside = cells.filter(c => c[0] <= cx && cx <= c[2] && c[1] <= cy && cy <= c[3] && c[2] - c[0] < 500);
  let inner, grow;
  if (inside.length) {
    const c = inside.reduce((a, b) => (b[2] - b[0]) * (b[3] - b[1]) < (a[2] - a[0]) * (a[3] - a[1]) ? b : a);
    inner = [c[0] + 3, c[1] + 3, c[2] - 3, c[3] - 3]; grow = [5, 5];
  } else {
    inner = [x0 - 20, y0 - 20, x1 + 60, y1 + 20]; grow = [4, 8];
  }
  const clamp = r => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(size.w, r[2]), Math.min(size.h, r[3])];
  return { outer: clamp([inner[0] - grow[0], inner[1] - grow[1], inner[2] + grow[0], inner[3] + grow[1]]), inner: clamp(inner) };
}

// Where a tick box's printed outline really is, near where the template puts it (owner's photo, 30 Oct 2026: a row
// on a slightly bent page sat 15 px low, so the outline was taken for ink and two empty boxes read as ticked). Slides
// the template's printed lines inside the box up to r px over the dark mask and keeps the place where most of them are
// dark. Returns { rect, dx, dy, moved }: moved only when the print fits clearly better there than where it was, and
// by more than one template pixel (Q page px).
export function snapBox(dark, w, h, rect, tplQ, r = 20) {
  const [x0, y0, x1, y1] = rect, qw = Math.floor(w / Q), pts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (tplQ[((y / Q) | 0) * qw + Math.min(qw - 1, (x / Q) | 0)] < 160) pts.push(x, y);
  if (pts.length < 40) return { rect, dx: 0, dy: 0, moved: false };
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && dark[y * w + x];
  const fit = (dx, dy) => { let on = 0; for (let k = 0; k < pts.length; k += 2) { const x = pts[k] + dx, y = pts[k + 1] + dy; on += at(x, y) || at(x - 2, y) || at(x + 2, y) || at(x, y - 2) || at(x, y + 2) ? 1 : 0; } return on / (pts.length / 2); };
  const here = fit(0, 0); let best = here, bx = 0, by = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {   // ties: the smaller step
    const f = fit(dx, dy); if (f > best + 1e-9 || (f > best - 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(bx) + Math.abs(by))) { best = f; bx = dx; by = dy; }
  }
  const moved = best >= 0.6 && best - here >= 0.2 && Math.max(Math.abs(bx), Math.abs(by)) > Q;   // within a template pixel: in place
  return moved ? { rect: [x0 + bx, y0 + by, x1 + bx, y1 + by], dx: bx, dy: by, moved } : { rect, dx: 0, dy: 0, moved };
}

// readTicks for one box that snapBox moved: the dark pixels in it less the template's print moved by the same step
export function readMovedTick(dark, w, h, tplQ, snap, label) {
  const [x0, y0, x1, y1] = snap.rect, bw = x1 - x0, bh = y1 - y0, qw = Math.floor(w / Q), printed = new Uint8Array(bw * bh), loc = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = x0 + x - snap.dx, Y = y0 + y - snap.dy;   // the template's place for this pixel
    printed[y * bw + x] = X >= 0 && Y >= 0 && X < w && Y < h && tplQ[((Y / Q) | 0) * qw + Math.min(qw - 1, (X / Q) | 0)] < 160 ? 1 : 0;
  }
  const grown = dilateMask(printed, bw, bh, 3);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const X = x0 + x, Y = y0 + y; loc[y * bw + x] = X >= 0 && Y >= 0 && X < w && Y < h && dark[Y * w + X] && !grown[y * bw + x] ? 1 : 0; }
  return { ...readTicks(open2(loc, bw, bh), bw, bh, [{ rect: [0, 0, bw, bh], label }])[0], rect: snap.rect, moved: true };
}

// Tick or no tick for each box (ticks.py): stroke pixels inside the box / its side; a slash or cross is well above
// CLEAR_TICK, an empty box near 0, anything between is 'unsure'. `center` is the same for the box's middle half.
export const CLEAR_TICK = 0.5, CLEAR_EMPTY = 0.15;
export function readTicks(ink, w, h, boxes, pad = 0) {
  const sum = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) { s += ink[y * w + x]; n++; } return [s, n]; };
  const r2 = v => Math.round(v * 100) / 100;
  return boxes.map(b => {
    const [x0, y0, x1, y1] = b.rect, side = Math.max(1, x1 - x0, y1 - y0);
    const [s, n] = sum(x0 - pad, y0 - pad, x1 + pad, y1 + pad), score = n ? s / side : 0;
    const qx = Math.floor((x1 - x0) / 4), qy = Math.floor((y1 - y0) / 4), [ms, mn] = sum(x0 + qx, y0 + qy, x1 - qx, y1 - qy);
    const state = score >= CLEAR_TICK ? 'ticked' : score <= CLEAR_EMPTY ? 'empty' : 'unsure';
    return { ...b, ink: r2(score), center: r2(mn ? ms / (0.5 * side) : 0), state };
  });
}
