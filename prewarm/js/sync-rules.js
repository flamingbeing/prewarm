// Sync rules shared by cloud.js and the screens. No storage, DOM or Firebase here (tested in node:
// test/sync-rules.test.mjs).

// An admin's lock, in the lock's own transaction (app-sync 0.4.0 onCommit): a leave entry carrying the locked version,
// so a member's phone that was closed drops the patient at its next open (an unlock is newer, so it shows again). One
// transaction, so no phone ever sees the lock without its entry. before / after: the server's copy and what is written
// (null: a delete); fields: the stamps for the entry (updatedAt and serverAt, as the patient's). leaveEntry: app-sync's.
export function lockLeave({ before, after, fields }, leaveEntry) {
  if (!after?.lock?.on || (before?.lock?.on && before.lock.t === after.lock.t)) return [];
  return [{ path: ['leaves', 'patient:' + after.id], data: { ...leaveEntry('patient', after, fields.updatedAt), site: after.site, ...fields } }];
}

// An update's take-over reload (app-update canReload) waits while a reading is half entered (guard), a sheet or
// question is open, someone is typing, or saves are still sending; it is tried again once they have gone.
export const reloadOk = ({ guard = false, dialogOpen = false, typing = false, pending = 0 } = {}) =>
  !guard && !dialogOpen && !typing && !(pending > 0);

// What cloud.js hands app-sync's syncStatus: at-risk only while offline (online, the saves are on their way), and
// unknown, not synced, until the server has answered once since the page opened (confirmed).
export const statusInput = ({ online = true, pending = 0, attention = 0, persisted = true, stale = false, confirmed = true } = {}) =>
  ({ online, pending, attention, persisted, stale, confirmed, atRiskOnlyOffline: true });

// The app-bar sync chip (owner, 13 Oct 2026): [text, small text, look, tooltip]. sharing: this phone shares with a
// team; waiting: patients not sent yet; bad: [[subject, why]] not saved to the team; st: syncStatus's state; text: the
// "Synced …" line.
export function chipState({ sharing, waiting = 0, bad = [], st, online = true, text = '' }) {
  if (!sharing) return ['Local', 'this phone', 'local', 'Data stays on this phone: not shared with a team'];
  if (bad.length) return [`${bad.length} not saved`, 'tap for why', 'bad', bad.map(([s, why]) => `${s}: ${why}`).join('; ')];
  const n = waiting, pl = n === 1 ? '' : 's';
  if (n && st === 'at-risk') return [`${n} at risk`, 'not sent', 'bad', `${n} patient${pl} not sent yet, and this browser may clear its storage: get signal, or add the app to the home screen`];
  if (n) return [`${n} waiting`, 'to send', 'wait', `${n} patient${pl} not sent to the team yet`];
  if (!online) return ['Offline', 'no signal', 'wait', 'No signal: changes send when it returns'];
  if (st === 'stale') return ['Checking', 'tap to refresh', 'wait', 'The team’s changes haven’t come through lately: tap to refresh'];
  if (st === 'unknown') return ['Checking', 'not heard yet', 'wait', 'The team’s list hasn’t come from the server yet since the app opened'];
  return ['Synced', 'with team', 'ok', text];
}
