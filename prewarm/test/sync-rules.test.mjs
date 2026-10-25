// Run with: node prewarm/test/sync-rules.test.mjs  (fake data only)
// The sync rules shared by cloud.js and the screens (js/sync-rules.js): the leave entry a lock writes in the lock's own
// transaction, when an update may reload the page, and the sync chip's words for app-sync's states.
import assert from 'node:assert/strict';
import { lockLeave, reloadOk, chipState, statusInput } from '../js/sync-rules.js';

// app-sync 0.4.0 leaveEntry: deletedAt = max(at, the record's updatedAt + 1)
const leaveEntry = (kind, r, at) => ({ id: kind + ':' + r.id, kind, data: { id: String(r.id), updatedAt: r.updatedAt }, deletedAt: Math.max(at, r.updatedAt + 1) });
const fields = { updatedAt: 500, serverAt: 'SERVER-TIME' };
const open = { id: 'p1', site: 'NUH', updatedAt: 400, locked: false, f: {} };
const locked = { ...open, updatedAt: 500, locked: true, lock: { on: true, t: 450, by: 'lead@example.com' } };

// an admin's lock: one leave entry, in the same transaction (onCommit), naming the locked version
const w = lockLeave({ before: open, after: locked, fields }, leaveEntry);
assert.equal(w.length, 1, 'a lock writes one leave entry');
assert.deepEqual(w[0].path, ['leaves', 'patient:p1']);
assert.equal(w[0].data.site, 'NUH', 'readable by the hospital’s team');
assert.equal(w[0].data.data.updatedAt, 500, 'names the locked version');
assert.ok(w[0].data.deletedAt > 500, 'after the version it removes');
assert.equal(w[0].data.serverAt, 'SERVER-TIME', 'stamped like the patient (same server time)');
assert.equal(w[0].data.updatedAt, 500);
assert.ok(!w[0].merge && !w[0].delete, 'the whole entry, replaced');
// a new lock on a patient locked before (newer lock time): the entry again
assert.equal(lockLeave({ before: locked, after: { ...locked, updatedAt: 600, lock: { ...locked.lock, t: 590 } }, fields }, leaveEntry).length, 1);
// nothing for: an unlock, a member's save, a delete, a save that keeps the same lock
assert.deepEqual(lockLeave({ before: locked, after: { ...locked, locked: false, lock: { on: false, t: 600, by: 'x' } }, fields }, leaveEntry), [], 'unlock');
assert.deepEqual(lockLeave({ before: open, after: { ...open, updatedAt: 450 }, fields }, leaveEntry), [], 'member save');
assert.deepEqual(lockLeave({ before: locked, after: null, fields }, leaveEntry), [], 'delete');
assert.deepEqual(lockLeave({ before: locked, after: { ...locked, updatedAt: 700 }, fields }, leaveEntry), [], 'same lock');
assert.equal(lockLeave({ before: null, after: locked, fields }, leaveEntry).length, 1, 'created locked');

// an update's reload waits while someone is entering something or saves are still sending
assert.equal(reloadOk({}), true, 'nothing open, nothing sending');
assert.equal(reloadOk({ guard: true }), false, 'a half-entered reading');
assert.equal(reloadOk({ dialogOpen: true }), false, 'a sheet or question open');
assert.equal(reloadOk({ typing: true }), false, 'someone typing');
assert.equal(reloadOk({ pending: 2 }), false, 'saves sending');
assert.equal(reloadOk({ pending: 0, guard: false, dialogOpen: false, typing: false }), true);

// what cloud.js hands app-sync's syncStatus: at-risk only while offline, unknown until the server has answered
const si = statusInput({ online: true, pending: 1, attention: 0, persisted: false, stale: false, confirmed: false });
assert.equal(si.atRiskOnlyOffline, true);
assert.equal(si.confirmed, false);
assert.equal(si.pending, 1);
assert.equal(statusInput({ confirmed: true }).confirmed, true);

// the sync chip: [text, small text, look]
const chip = o => chipState({ sharing: true, waiting: 0, bad: [], online: true, text: 'Synced just now.', ...o }).slice(0, 3);
assert.deepEqual(chip({ sharing: false }), ['Local', 'this phone', 'local']);
assert.deepEqual(chip({}), ['Synced', 'with team', 'ok']);
assert.deepEqual(chip({ st: 'unknown' }), ['Checking', 'not heard yet', 'wait'], 'never Synced before the server has answered');
assert.deepEqual(chip({ st: 'stale' }), ['Checking', 'tap to refresh', 'wait']);
assert.deepEqual(chip({ waiting: 2, st: 'at-risk' }), ['2 at risk', 'not sent', 'bad']);
assert.deepEqual(chip({ waiting: 2, st: 'saving' }), ['2 waiting', 'to send', 'wait']);
assert.deepEqual(chip({ online: false }), ['Offline', 'no signal', 'wait']);
assert.deepEqual(chip({ bad: [['P-1', 'refused']] }), ['1 not saved', 'tap for why', 'bad']);
assert.match(chipState({ sharing: true, waiting: 0, bad: [['P-1', 'refused'], ['P-2', 'no hospital']], online: true })[3], /P-1: refused; P-2: no hospital/);

console.log('prewarm sync rules: ok');
