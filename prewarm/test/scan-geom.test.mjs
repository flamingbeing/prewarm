// Scan pages: corners, perspective flattening and shadow removal (fake pixels only). node prewarm/test/scan-geom.test.mjs
import assert from 'node:assert/strict';
import { orderCorners, rotateCorners, isConvex, quadArea, guessCorners, solveHomography, applyH, warpPage, removeShadow, autoMode, setContrast, flattenPage, coachFor, quadMove, photoCheck, edgeInfo, snapCorner, snapSide, uprightScore, rotate180, UPRIGHT_LINES } from '../js/scan-geom.js';

const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };

// ordering and shape checks
const sq = [{ x: 10, y: 10 }, { x: 90, y: 12 }, { x: 88, y: 95 }, { x: 8, y: 90 }];
assert.deepEqual(orderCorners([sq[2], sq[0], sq[3], sq[1]]), sq, 'corners ordered TL TR BR BL');
assert.deepEqual(rotateCorners(sq), [sq[1], sq[2], sq[3], sq[0]]);
assert.equal(isConvex(sq), true);
assert.equal(isConvex([sq[0], sq[2], sq[1], sq[3]]), false, 'crossed corners');
assert.equal(isConvex([sq[0], sq[1], { x: 50, y: 50 }, sq[3]]), false, 'dented corner');
near(quadArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]), 50, 1e-9, 'area');

// homography: the unit square onto a skewed quad, and back
const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], skew = [{ x: 5, y: 3 }, { x: 40, y: 8 }, { x: 35, y: 50 }, { x: 2, y: 41 }];
const H = solveHomography(unit, skew);
unit.forEach((p, i) => { const q = applyH(H, p.x, p.y); near(q.x, skew[i].x, 1e-6, 'x' + i); near(q.y, skew[i].y, 1e-6, 'y' + i); });
const Hi = solveHomography(skew, unit), mid = applyH(H, 0.5, 0.5), back = applyH(Hi, mid.x, mid.y);
near(back.x, 0.5, 1e-6, 'round trip x'); near(back.y, 0.5, 1e-6, 'round trip y');
assert.equal(solveHomography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], unit), null, 'collapsed quad has no solution');

// a tilted "page" (white, with a black bar along its top edge) on dark carpet
const W = 320, Hh = 240, page = [{ x: 60, y: 30 }, { x: 250, y: 50 }, { x: 270, y: 210 }, { x: 40, y: 190 }];
const inside = (x, y) => { // point-in-convex-quad
  let s = 0; for (let i = 0; i < 4; i++) { const a = page[i], b = page[(i + 1) % 4], z = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); if (!s) s = Math.sign(z); else if (Math.sign(z) !== s && z !== 0) return false; } return true;
};
const photo = img(W, Hh, (x, y) => inside(x, y) ? [235, 235, 230, 255] : [60, 50, 45, 255]);
const g = guessCorners(photo, W, Hh);
assert.equal(g.found, true, 'page found');
g.corners.forEach((c, i) => { near(c.x, page[i].x, 4, 'guess x' + i); near(c.y, page[i].y, 4, 'guess y' + i); });
// an envelope in the frame's corner touching the page (owner's photos, 30 Oct 2026): the corner stays on the page
const env = (x, y) => x < 85 && y < 45;
const g2 = guessCorners(img(W, Hh, (x, y) => inside(x, y) || env(x, y) ? [235, 235, 230, 255] : [60, 50, 45, 255]), W, Hh);
assert.equal(g2.found, true, 'page found beside the envelope');
g2.corners.forEach((c, i) => { near(c.x, page[i].x, 4, 'envelope x' + i); near(c.y, page[i].y, 4, 'envelope y' + i); });
// a folded corner (bottom right turned under): the corner is where the two sides would meet
const fold = (x, y) => x + y > 440;
const g3 = guessCorners(img(W, Hh, (x, y) => inside(x, y) && !fold(x, y) ? [235, 235, 230, 255] : [60, 50, 45, 255]), W, Hh);
g3.corners.forEach((c, i) => { near(c.x, page[i].x, 4, 'fold x' + i); near(c.y, page[i].y, 4, 'fold y' + i); });
// a page turned 30 degrees still gives its own four corners
const tc = Math.cos(Math.PI / 6), ts = Math.sin(Math.PI / 6), turned = (x, y) => Math.abs((x - 160) * tc + (y - 120) * ts) < 70 && Math.abs(-(x - 160) * ts + (y - 120) * tc) < 90;
const g4 = guessCorners(img(W, Hh, (x, y) => turned(x, y) ? [235, 235, 230, 255] : [60, 50, 45, 255]), W, Hh);
[[-70, -90], [70, -90], [70, 90], [-70, 90]].map(([u, v]) => [160 + u * tc - v * ts, 120 + u * ts + v * tc])
  .forEach(([x, y]) => assert.ok(g4.corners.some(c => Math.hypot(c.x - x, c.y - y) < 4), 'turned corner ' + Math.round(x) + ',' + Math.round(y)));
const empty = guessCorners(img(100, 100, () => [120, 120, 120, 255]), 100, 100);
assert.equal(empty.found, false, 'plain frame: no page, whole frame less a margin');

// warping that page gives an all-white rectangle (a little inside its edges)
const flat = warpPage(photo, W, Hh, page.map(p => ({ x: p.x + (p.x < 150 ? 2 : -2), y: p.y + (p.y < 120 ? 2 : -2) })), 90, 120);
let minV = 255; for (let i = 0; i < flat.length; i += 4) minV = Math.min(minV, flat[i]);
assert.ok(minV > 225, 'warped page has no carpet in it, darkest ' + minV);
// the corners land on the right places: put a dark dot at the page's top-left and see it in the output's top-left
const dotted = img(W, Hh, (x, y) => (x - 70) ** 2 + (y - 40) ** 2 < 16 ? [0, 0, 0, 255] : inside(x, y) ? [235, 235, 230, 255] : [60, 50, 45, 255]);
const fd = warpPage(dotted, W, Hh, page, 90, 120);
const dp = applyH(solveHomography(page, [{ x: 0, y: 0 }, { x: 89, y: 0 }, { x: 89, y: 119 }, { x: 0, y: 119 }]), 70, 40);
assert.ok(fd[(Math.round(dp.y) * 90 + Math.round(dp.x)) * 4] < 120, 'the dot lands where the corners say');
assert.ok(dp.x < 10 && dp.y < 12, 'and that is near the top-left');
assert.ok(fd[(110 * 90 + 80) * 4] > 200, 'bottom-right region is paper');

// shadow removal: even paper (200) darkened by a left-to-right shadow (100% down to 45%) with ink lines (40)
const sw = 400, sh = 300, ink = (x, y) => y % 60 < 3 && x > 40 && x < 360;
const shade = x => 1 - 0.55 * (x / sw);
const shaded = img(sw, sh, (x, y) => { const v = ink(x, y) ? 40 * shade(x) : 200 * shade(x); return [v, v, v, 255]; });
const paperAt = (d, x) => { let s = 0, c = 0; for (let y = 10; y < sh; y += 60) for (let k = 0; k < 8; k++) { s += d[((y + 20) * sw + x + k) * 4]; c++; } return s / c; };
const beforeL = paperAt(shaded, 10), beforeR = paperAt(shaded, 380);
assert.ok(beforeL - beforeR > 60, 'shadow is strong before');
removeShadow(shaded, sw, sh);
const afterL = paperAt(shaded, 10), afterR = paperAt(shaded, 380), afterM = paperAt(shaded, 200);
assert.ok(afterL > 245 && afterR > 245 && afterM > 245, `paper even and white after: ${afterL} ${afterM} ${afterR}`);
const inkAfter = shaded[(60 * sw + 300) * 4];
assert.ok(inkAfter < 130, 'ink stays dark, ' + inkAfter);
// blank paper: nothing to remove, stays white
const blank = img(60, 60, () => [180, 180, 180, 255]); removeShadow(blank, 60, 60);
assert.ok(blank.every((v, i) => i % 4 === 3 ? v === 255 : v > 250), 'blank page goes white, not noisy');
// a coloured light (warm) is evened out to neutral paper
const warm = img(60, 60, () => [220, 180, 120, 255]); removeShadow(warm, 60, 60);
assert.ok(Math.abs(warm[0] - warm[2]) < 6, 'warm tint removed from the paper');

// modes: blue pen is colour, black pen is black and white
const paperBlue = img(100, 100, (x, y) => y < 5 ? [30, 60, 200, 255] : [255, 255, 255, 255]);
const paperBlack = img(100, 100, (x, y) => y < 5 ? [20, 20, 20, 255] : [255, 255, 255, 255]);
assert.equal(autoMode(paperBlue), 'color'); assert.equal(autoMode(paperBlack), 'bw');
const c = Uint8ClampedArray.from(paperBlue); assert.equal(setContrast(c, 'auto'), 'color');
assert.ok(c[2] > c[0] + 80, 'blue ink keeps its colour');
const b = Uint8ClampedArray.from(paperBlue); setContrast(b, 'bw');
assert.ok(b[0] === b[1] && b[1] === b[2], 'black and white is grey');
assert.equal(b[(50 * 100) * 4], 255, 'paper white');
assert.ok(b[0] < 60, 'ink dark in black and white');

// the whole thing: a photographed page at an angle with a shadow across it comes out flat and evenly lit
const lit = img(W, Hh, (x, y) => { if (!inside(x, y)) return [60, 50, 45, 255]; const s = 1 - 0.5 * Math.max(0, (x - 120) / 200); const t = y < 80 && y > 70 && x > 100 ? 30 : 235; return [t * s, t * s, t * s * 0.97, 255]; });
const full = flattenPage(lit, W, Hh, page.map(p => ({ x: p.x + (p.x < 150 ? 3 : -3), y: p.y + (p.y < 120 ? 3 : -3) })), 120, 160);
setContrast(full, 'bw');
const row = y => { const a = []; for (let x = 10; x < 110; x += 10) a.push(full[(y * 120 + x) * 4]); return a; };
const spread = Math.max(...row(100)) - Math.min(...row(100));
assert.ok(spread < 12 && Math.min(...row(100)) > 240, 'even paper across the shadow, spread ' + spread);
// live camera coach line, steadiness, and the blur / dark check after a shot
assert.equal(coachFor({ found: false }, 100, 100).ok, false, 'no page: keep looking');
assert.match(coachFor({ found: true, corners: [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }] }, 100, 100).say, /cut off/, 'corner on the edge');
assert.match(coachFor({ found: true, corners: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] }, 100, 100).say, /closer/, 'page too small');
assert.equal(coachFor({ found: true, corners: [{ x: 10, y: 8 }, { x: 88, y: 10 }, { x: 90, y: 92 }, { x: 12, y: 90 }] }, 100, 100).ok, true, 'page found and big');
near(quadMove(sq, sq.map(p => ({ x: p.x + 3, y: p.y + 4 })), 60, 80), 0.05, 1e-9, 'move is a share of the diagonal');
const lined = (x, y) => (y % 6 < 2 ? [30, 30, 30, 255] : [235, 235, 230, 255]); // ruled lines: sharp
const sharpCheck = photoCheck(img(200, 200, lined), 200, 200, [{ x: 0, y: 0 }, { x: 199, y: 0 }, { x: 199, y: 199 }, { x: 0, y: 199 }]);
assert.ok(!sharpCheck.blurry && !sharpCheck.dark, 'sharp lines pass: ' + JSON.stringify(sharpCheck));
const soft = img(200, 200, (x, y) => { const v = 130 + 100 * Math.sin(y / 12); return [v, v, v, 255]; }); // smooth shading only: blurry
assert.ok(photoCheck(soft, 200, 200, [{ x: 0, y: 0 }, { x: 199, y: 0 }, { x: 199, y: 199 }, { x: 0, y: 199 }]).blurry, 'smooth image is blurry');
const dim = img(200, 200, (x, y) => (y % 6 < 2 ? [5, 5, 5, 255] : [50, 50, 50, 255]));
assert.ok(photoCheck(dim, 200, 200, [{ x: 0, y: 0 }, { x: 199, y: 0 }, { x: 199, y: 199 }, { x: 0, y: 199 }]).dark, 'dim page is dark');

{
// snapping: a white sheet (60,40)-(240,200) on a dark table; a dragged corner snaps back onto the sheet's corner, a side onto its edge
const sheet = img(300, 240, (x, y) => (x >= 60 && x < 240 && y >= 40 && y < 200 ? [230, 230, 225, 255] : [50, 45, 40, 255]));
const ei = edgeInfo(sheet, 300, 240);
const c0 = snapCorner(ei, { x: 68, y: 33 }, 14);
assert.ok(c0 && Math.hypot(c0.x - 60, c0.y - 40) <= 2.5, 'corner snaps onto the sheet corner: ' + JSON.stringify(c0));
assert.equal(snapCorner(ei, { x: 150, y: 120 }, 14), null, 'no corner in the middle of the sheet: stays put');
const sd = snapSide(ei, { x: 60, y: 52 }, { x: 240, y: 52 }, 20); // the top side dragged 12 px down
assert.ok(sd && Math.abs(sd.dx) < 0.5 && Math.abs(52 + sd.dy - 40) <= 1.5, 'side snaps onto the top edge: ' + JSON.stringify(sd));
assert.equal(snapSide(ei, { x: 100, y: 120 }, { x: 200, y: 120 }, 10), null, 'no edge near the middle: stays put');

// upright: fake lines of "letters" (a middle band with strokes above for capitals and b d f h k l t, a few below for g j p q y)
const textPage = (w, h, lines) => {
  const d = img(w, h, () => [255, 255, 255, 255]), ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([20, 20, 20, 255], (y * w + x) * 4); };
  for (let l = 0; l < lines; l++) {
    const base = 80 + l * 90;
    for (let x = 30, i = 0; x < w - 40; x += 14, i++) {
      if (i % 7 === 6) continue; // a space between words
      ink(x, base - 12, x + 9, base); // the middle band
      if (i % 3 === 0) ink(x, base - 22, x + 3, base - 12); // an ascender
      if (i % 9 === 4) ink(x + 6, base, x + 9, base + 9); // a descender
    }
    if (l % 4 === 1) ink(20, base + 18, w - 20, base + 21); // a table rule (left out)
  }
  return d;
};
const TW = 1200, TH = 1600, up = textPage(TW, TH, 14), u0 = uprightScore(up, TW, TH);
assert.ok(u0.score > 0.3 && !u0.flip && u0.lines >= UPRIGHT_LINES, 'upright page reads upright: ' + JSON.stringify(u0));
const u1 = uprightScore(rotate180(up.slice()), TW, TH);
assert.ok(u1.score < -0.3 && u1.flip, 'upside-down page is turned: ' + JSON.stringify(u1));
const few = uprightScore(rotate180(textPage(TW, TH, 1)), TW, TH);
assert.ok(!few.flip, 'one line of text is too little to go on: left as it is: ' + JSON.stringify(few));
const empty = uprightScore(img(TW, TH, () => [255, 255, 255, 255]), TW, TH);
assert.ok(!empty.flip && empty.lines === 0, 'blank page: left as it is');
const r2 = img(2, 1, x => [x, 0, 0, 255]); rotate180(r2); assert.deepEqual([...r2], [1, 0, 0, 255, 0, 0, 0, 255], 'half turn swaps pixels');

}

console.log('scan geometry tests passed');
