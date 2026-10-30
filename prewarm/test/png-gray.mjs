// Read an 8-bit grey PNG (what tools/scan/parity.py and make-form-map.py write) for the scan tests: { w, h, data }.
// Node only (zlib); the phone decodes its PNGs with the browser.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readGrayPng(path) {
  const b = readFileSync(path);
  let p = 8, w = 0, h = 0, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 0 || d[12] !== 0) throw new Error(`${path}: only 8-bit grey, non-interlaced PNGs`);
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], src = y * (w + 1) + 1, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x ? out[row + x - 1] : 0, up = y ? out[row - w + x] : 0, c = x && y ? out[row - w + x - 1] : 0, v = raw[src + x];
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = up; else if (f === 3) pred = (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[row + x] = (v + pred) & 255;
    }
  }
  return { w, h, data: out };
}
