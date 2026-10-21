// Fill text into a Word form (word/document.xml) without touching its layout: tick its tick boxes (☐ → ☒, and the
// Word check-box control's checked flag), type over its blank lines (______), type into empty table cells. Works on
// the XML as text: a small parser that keeps every byte it doesn't change, so the file stays exactly as designed.
// No DOM needed (runs in the browser and in Node tests).

// ---- XML: elements { name, attrs (raw text), kids, parent, self, i }, text { text (escaped), parent }, other { raw }
export function parseXml(xml) {
  const root = { name: '#root', attrs: '', kids: [], parent: null };
  let cur = root, i = 0;
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/[^>]+>|<[^>]+>|[^<]+/g;
  for (const m of xml.matchAll(re)) {
    const s = m[0];
    if (s[0] !== '<') cur.kids.push({ text: s, parent: cur });
    else if (s[1] === '?' || s[1] === '!') cur.kids.push({ raw: s, parent: cur });
    else if (s[1] === '/') cur = cur.parent;
    else {
      const self = s.endsWith('/>');
      const mm = /^<([^\s/>]+)([\s\S]*?)\/?>$/.exec(s);
      const el = { name: mm[1], attrs: mm[2], kids: [], parent: cur, self, i: i++ };
      cur.kids.push(el);
      if (!self) cur = el;
    }
  }
  return root;
}
export function serialize(n) {
  if (n.text != null) return n.text;
  if (n.raw != null) return n.raw;
  if (n.name === '#root') return n.kids.map(serialize).join('');
  if (n.self && !n.kids.length) return `<${n.name}${n.attrs}/>`;
  return `<${n.name}${n.attrs}>${n.kids.map(serialize).join('')}</${n.name}>`;
}
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
  : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
export function all(n, name, out = []) {
  for (const k of n.kids || []) { if (k.name === name) out.push(k); all(k, name, out); }
  return out;
}
const kidsNamed = (n, name) => n.kids.filter(k => k.name === name);
const up = (n, name) => { for (let p = n.parent; p; p = p.parent) if (p.name === name) return p; return null; };
const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();

// ---- paragraphs: their text, and where each character lives
function para(p) {
  const segs = []; let text = '';
  for (const t of all(p, 'w:t')) {
    const s = unesc(t.kids.map(k => k.text ?? '').join(''));
    segs.push({ t, start: text.length, end: text.length + s.length, s }); text += s;
  }
  return { p, text, segs };
}
function setT(seg, s) {
  seg.t.kids = s ? [{ text: esc(s), parent: seg.t }] : [];
  if (!/xml:space=/.test(seg.t.attrs)) seg.t.attrs += ' xml:space="preserve"';
  seg.t.self = false;
}
// replace the paragraph's characters [start, end) with str (str goes into the run that held start)
function replace(P, start, end, str) {
  let placed = false;
  for (const g of P.segs) {
    const hit = start === end ? !placed && g.start <= start && start <= g.end : g.start < end && g.end > start;
    if (!hit) continue;
    const a = Math.max(start, g.start) - g.start, b = Math.min(end, g.end) - g.start;
    setT(g, g.s.slice(0, a) + (placed ? '' : str) + g.s.slice(b));
    placed = true;
  }
  return placed;
}
function tickAt(P, k) {
  replace(P, k, k + 1, '☒');
  const g = P.segs.find(x => x.start <= k && k < x.end);
  const sdt = g && up(g.t, 'w:sdt');
  const ch = sdt && all(sdt, 'w14:checked')[0];
  if (ch) ch.attrs = ch.attrs.replace(/w14:val="[^"]*"/, 'w14:val="1"');
}
// type a value into an empty cell: a new run, formatted like the cell's paragraph mark
function cellText(tc, v) {
  const p = all(tc, 'w:p')[0]; if (!p) return false;
  const ppr = kidsNamed(p, 'w:pPr')[0];
  const rpr = ppr && kidsNamed(ppr, 'w:rPr')[0];
  // keep the font and size, not a colour (some boxes are set pale grey for a placeholder)
  const props = rpr ? rpr.kids.filter(k => k.name !== 'w:color' && k.name !== 'w:highlight').map(serialize).join('') : '';
  const frag = parseXml(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(v)}</w:t></w:r>`).kids[0];
  frag.parent = p; p.kids.push(frag); p.self = false;
  return true;
}

// ---- the form: rows of every table in document order, with a cursor so labels can repeat (Day 1, Day 2)
export class WordForm {
  constructor(xml) {
    this.root = parseXml(xml);
    this.rows = all(this.root, 'w:tr').map(tr => {
      const cells = kidsNamed(tr, 'w:tc');
      return { tr, cells, label: norm(cells[0] ? all(cells[0], 'w:p').map(p => para(p).text).join(' ') : '') };
    });
    this.at = -1;
    this.missed = [];
  }
  xml() { return serialize(this.root); }
  find(label, { exact = false } = {}) {
    const l = norm(label);
    const k = this.rows.findIndex((r, j) => j > this.at && (exact ? r.label === l : r.label.startsWith(l)));
    if (k < 0) { this.missed.push('row: ' + label); return null; }
    this.at = k;
    return this.rows[k];
  }
  seek(label) { this.find(label); return this; }
  // a row's value cell (by default the second cell)
  row(label, cell = 1) { const r = this.find(label); return new Cell(this, r?.cells[cell], label); }
  // a grid: the table holding the next row labelled `label`
  table(label, opts) {
    const r = this.find(label, opts); if (!r) return new Grid(this, null, []); // not on this form: fills nothing
    const tbl = r.tr.parent;
    const rows = this.rows.filter(x => x.tr.parent === tbl);
    this.at = this.rows.indexOf(rows[rows.length - 1]);
    return new Grid(this, tbl, rows);
  }
  // tick the first box in the paragraph containing `phrase` (one outside the tables, e.g. "☐ Vital Signs Data Collected")
  tickParagraph(phrase) {
    const P = all(this.root, 'w:p').map(para).find(x => norm(x.text).includes(norm(phrase)));
    const k = P ? P.text.search(/[☐☒]/) : -1;
    if (k < 0) { this.missed.push('paragraph: ' + phrase); return; }
    tickAt(P, k);
  }
  // Every paragraph with "Name: … Signature: … Date:", in order
  signLines() { return all(this.root, 'w:p').map(para).filter(P => /Name:/.test(P.text) && /Signature:/.test(P.text) && /Date:/.test(P.text)); }
  cell(tc, v) { if (v != null && v !== '') cellText(tc, String(v)); }
  // join boxes into one cell (for a value longer than its boxes): widths add up, the last box's right border stays
  merge(tcs) {
    if (tcs.length < 2) return tcs[0];
    const [first, ...rest] = tcs;
    const pr = n => kidsNamed(n, 'w:tcPr')[0];
    const width = tcs.reduce((w, tc) => w + +(/w:w="(\d+)"/.exec(serialize(kidsNamed(pr(tc), 'w:tcW')[0] || { name: 'x', attrs: '', kids: [] }))?.[1] || 0), 0);
    const fp = pr(first), last = pr(tcs[tcs.length - 1]);
    const w = kidsNamed(fp, 'w:tcW')[0];
    if (w) w.attrs = w.attrs.replace(/w:w="\d+"/, `w:w="${width}"`);
    const span = parseXml(`<w:gridSpan w:val="${tcs.length}"/>`).kids[0]; span.parent = fp;
    fp.kids.splice(w ? fp.kids.indexOf(w) + 1 : 0, 0, span);
    const right = last && all(last, 'w:right')[0];
    if (right) {
      let b = kidsNamed(fp, 'w:tcBorders')[0];
      if (!b) { b = parseXml('<w:tcBorders></w:tcBorders>').kids[0]; b.parent = fp; fp.kids.splice(fp.kids.indexOf(span) + 1, 0, b); }
      b.kids = b.kids.filter(k => k.name !== 'w:right');
      const r = parseXml(serialize(right)).kids[0]; r.parent = b; b.kids.push(r); b.self = false;
    }
    for (const tc of rest) tc.parent.kids.splice(tc.parent.kids.indexOf(tc), 1);
    return first;
  }
  cellLabel(tc) { return norm(all(tc, 'w:p').map(p => para(p).text).join(' ')); }
  // a sign-off "AB 12 Oct 2026 10:30" onto a Name / Signature / Date line (the signature stays for a pen)
  sign(P, s) {
    const m = /^(\S+)\s+(.+?)(?:\s+\d{1,2}:\d{2})?$/.exec(String(s).trim()); if (!m) return;
    const k = P.text.indexOf('Name:') + 5, spaces = /^ */.exec(P.text.slice(k))[0].length, put = ' ' + m[1];
    replace(P, k, k + Math.max(0, Math.min(spaces - 2, put.length)), put);
    const Q = para(P.p), d = Q.text.lastIndexOf('Date:') + 5;
    replace(Q, d, d, ' ' + m[2]);
  }
  // document-order position, to tell which page something is on
  order(n) { while (n && n.i == null) n = n.parent; return n?.i ?? -1; }
}

class Cell {
  constructor(form, tc, where) { this.form = form; this.tc = tc; this.where = where; }
  paras(within) {
    if (!this.tc) return [];
    const ps = all(this.tc, 'w:p').map(para);
    return within ? ps.filter(P => norm(P.text).includes(norm(within))) : ps;
  }
  miss(what) { this.form.missed.push(`${this.where}: ${what}`); return this; }
  // tick the box in front of `option` (☐ Yes, ☐ GA (TIVA), …)
  tick(option, { in: within } = {}) {
    if (option == null || option === '') return this;
    const o = norm(String(option));
    for (const P of this.paras(within)) {
      for (const m of P.text.matchAll(/[☐☒]/g)) {
        if (norm(P.text.slice(m.index + 1)).startsWith(o)) { tickAt(P, m.index); return this; }
      }
    }
    return this.miss('tick ' + option);
  }
  // type over the nth blank line (______)
  line(v, { in: within, n = 0 } = {}) {
    if (v == null || v === '') return this;
    let k = 0;
    for (const P of this.paras(within)) {
      for (const m of P.text.matchAll(/_{3,}/g)) {
        if (k++ === n) { replace(P, m.index, m.index + m[0].length, ' ' + v + ' '); return this; }
      }
    }
    return this.miss('line ' + v);
  }
  // __ __ : __ __ (24 hour clock)
  time(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); if (!m) return this;
    for (const P of this.paras()) {
      const x = /_+ ?_+\s*:\s*_+ ?_+/.exec(P.text);
      if (x) { replace(P, x.index, x.index + x[0].length, `${m[1].padStart(2, '0')}  :  ${m[2]}`); return this; }
    }
    return this.miss('time ' + v);
  }
  text(v) { if (v == null || v === '') return this; return this.tc && cellText(this.tc, String(v)) ? this : this.miss('cell ' + v); }
}

class Grid {
  constructor(form, tbl, rows) { this.form = form; this.tbl = tbl; this.rows = rows; }
  // column index of the header cell starting with `text`, in the header row (by default the first)
  col(text, header = 0) {
    const r = this.rows[header];
    if (!r) return -1;
    const k = r.cells.findIndex(c => norm(all(c, 'w:p').map(p => para(p).text).join(' ')).startsWith(norm(text)));
    if (k < 0) this.form.missed.push('column ' + text);
    return k;
  }
  rowOf(label) { return this.rows.find(r => r.label === norm(String(label))) || this.rows.find(r => r.label.startsWith(norm(String(label)))); }
  set(row, col, v) {
    if (v == null || v === '' || col < 0) return;
    const r = typeof row === 'number' ? this.rows[row] : this.rowOf(row);
    if (!r || !r.cells[col]) { this.form.missed.push(`cell ${row}/${col}`); return; }
    cellText(r.cells[col], String(v));
  }
  // make sure there are at least n rows after the header, copying the last (empty) row
  grow(n) {
    while (this.tbl && this.rows.length && this.rows.length - 1 < n) {
      const last = this.rows[this.rows.length - 1];
      const copy = parseXml(serialize(last.tr)).kids[0];
      copy.parent = this.tbl;
      this.tbl.kids.splice(this.tbl.kids.indexOf(last.tr) + 1, 0, copy);
      this.rows.push({ tr: copy, cells: kidsNamed(copy, 'w:tc'), label: last.label });
    }
  }
}

// Remove who made or edited the file (docProps): the blank form is shared with the study's teams
export function cleanProps(xml) {
  return xml.replace(/<(dc:creator|cp:lastModifiedBy|Company|Manager)>[^<]*<\/\1>/g, '<$1></$1>');
}
