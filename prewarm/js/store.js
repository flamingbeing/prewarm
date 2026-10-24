// Records and merging. No storage or DOM here (tested in node).
//
// A record (patient or screening row): { id, created, deleted?, f: { fieldId: { v, t, by } } }
// Every field keeps when it was last set (t, ms) and by whom, so copies from different phones merge field by
// field: the newer value wins. A cleared field keeps { v: null, t } so the clearing travels too.

export const FILE_KIND = 'anawj-prewarm';

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, x => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export function newRecord(now = Date.now()) {
  return { id: newId(), created: now, f: {} };
}

export const val = (rec, id) => rec.f[id]?.v ?? null;

export function setVal(rec, id, v, by, now = Date.now()) {
  const empty = v == null || v === '';
  const cur = rec.f[id];
  if ((cur?.v ?? null) === (empty ? null : v)) return false;
  // never go back in time, even if this phone's clock is behind the last writer's
  const t = Math.max(now, (cur?.t || 0) + 1);
  rec.f[id] = { v: empty ? null : v, t, by: by || '' };
  return true;
}

export function lastEdit(rec) {
  let best = null;
  for (const x of Object.values(rec.f)) if (!best || x.t > best.t) best = x;
  return best;
}

const newer = (a, b) => !a || (b && (b.t > a.t || (b.t === a.t && String(b.v) > String(a.v))));

// Merge b into a copy of a. Returns { rec, changed } (number of fields taken from b).
export function mergeRecord(a, b) {
  const rec = { ...a, f: { ...a.f } };
  let changed = 0;
  for (const [k, x] of Object.entries(b.f || {})) {
    if (newer(rec.f[k], x)) { rec.f[k] = x; changed++; }
  }
  if (b.deleted && (!rec.deleted || b.deleted > rec.deleted)) { rec.deleted = b.deleted; changed++; }
  // lock { on, t, by }: set by a study admin; the later one wins
  if (b.lock && (!rec.lock || b.lock.t > rec.lock.t)) { rec.lock = b.lock; changed++; }
  rec.created = Math.min(a.created || Infinity, b.created || Infinity);
  return { rec, changed };
}

// Merge incoming records into a map { id: record }. A record from another phone with a different id but the same
// key (Screening ID, else Enrollment ID) is the same patient entered twice: it merges into the one here.
export function mergeInto(map, incoming, keys) {
  const out = { ...map };
  let added = 0, updated = 0;
  const keyOf = r => { for (const k of keys) { const v = val(r, k); if (v) return k + ':' + String(v).trim().toLowerCase(); } return null; };
  const byKey = new Map();
  for (const r of Object.values(out)) if (!r.deleted) { const k = keyOf(r); if (k) byKey.set(k, r.id); }
  for (const r of incoming) {
    if (!r || typeof r.id !== 'string' || typeof r.f !== 'object') continue;
    let target = out[r.id] ? r.id : null;
    if (!target && !r.deleted) { const k = keyOf(r); if (k && byKey.has(k)) target = byKey.get(k); }
    if (!target) { out[r.id] = { ...r, f: { ...r.f } }; added++; const k = keyOf(r); if (k && !r.deleted) byKey.set(k, r.id); continue; }
    const { rec, changed } = mergeRecord(out[target], r);
    out[target] = rec;
    if (changed) updated++;
  }
  return { map: out, added, updated };
}

// A file another phone can open. Local-only fields (initials) are left out.
export function packFile({ patients = [], screening = [] }, localOnly = [], from = '') {
  const strip = r => {
    const f = { ...r.f };
    for (const k of localOnly) delete f[k];
    return { ...r, f };
  };
  return { kind: FILE_KIND, v: 1, from, at: Date.now(), patients, screening: screening.map(strip) };
}

export function readFile(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('This is not a pre-warming study file.'); }
  if (!d || d.kind !== FILE_KIND) throw new Error('This is not a pre-warming study file.');
  if (d.v > 1) throw new Error('This file is from a newer version of the app. Reload the app and try again.');
  return { patients: Array.isArray(d.patients) ? d.patients : [], screening: Array.isArray(d.screening) ? d.screening : [], from: d.from || '', at: d.at };
}

// Delete and restore (14 Oct 2026). Delete, restore, delete, restore must work every time, even if this phone's
// clock is behind the phone that last deleted or restored: each time is later than the last one seen.
export function markDeleted(rec, now = Date.now()) {
  rec.deleted = Math.max(now, (rec.deleted || 0) + 1, (rec.f?.restored?.t || 0) + 1);
}
export function restore(rec, by, now = Date.now()) {
  // the value changes every time (a repeat of the same value would be skipped and so would the restore)
  const prev = rec.f.restored?.v || 0;
  setVal(rec, 'restored', Math.max(now, +prev + 1, (rec.deleted || 0) + 1), by, Math.max(now, (rec.deleted || 0) + 1));
}

// deleted, and not restored since (a restore is the field "restored": its time is after the delete)
export const isGone = p => !!p.deleted && p.deleted > (p.f?.restored?.t || 0);

// The team's copy of a patient, merged on the server when a save from this phone is sent (the sync engine runs it
// inside a transaction on the server's current copy, so nothing another phone saved meanwhile is overwritten): the
// newest of each field wins, the latest delete wins. Only a study admin's lock or unlock (ops { lock: true }) changes
// lock; anyone else keeps the server's (the rules refuse a change). A locked patient: an admin's save changes only the
// lock, anyone else's is refused. -> the document to write ({ site, created, locked, f, deleted?, lock? })
export function mergeShared(current, record, ops = []) {
  const admin = (ops || []).some(o => o && o.lock);
  const body = r => ({ site: r.site, created: r.created, f: r.f || {}, ...(r.deleted ? { deleted: r.deleted } : {}), ...(r.lock ? { lock: r.lock } : {}) });
  const done = d => { d.locked = !!d.lock?.on; return d; };
  if (!current) { const d = body(record); if (!admin) delete d.lock; return done(d); }
  const cur = body(current);
  if (cur.lock?.on) {
    if (!admin) throw Object.assign(new Error('This patient is locked by the study admin'), { code: 'permission-denied' });
    if (record.lock && record.lock.t > cur.lock.t) cur.lock = record.lock;
    return done(cur);
  }
  const { rec } = mergeRecord(cur, body(record));
  if (!admin) { if (cur.lock) rec.lock = cur.lock; else delete rec.lock; }
  rec.site = cur.site;
  return done(rec);
}
