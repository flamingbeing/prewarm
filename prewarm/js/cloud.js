// Sharing through Firestore (Firebase project prewarm-study). Phones join with their hospital's code (anonymous
// sign-in); admins sign in with an emailed link. Access is decided by firestore.rules. Demo mode (?demo) never connects.
//
//   members/{uid}  { site, initials, code, joinedAt }       codes/{site}  { code, setAt, setBy }   (admins only)
//   admins/{email} {}                                       patients/{id} { site, created, updatedAt, serverAt, id, locked, deleted?, lock?, f: { id: {v,t,by} } }
//   leaves/patient:{id} { id, kind, data: { id, updatedAt }, deletedAt, site, updatedAt, serverAt }  (a patient an admin
//                  locked: phones that were closed drop it at their next open; admins write, the hospital's team reads)
//   pacu/{token}   { site, pid, sid, created, f }      (the PACU nurse's link: the token is the secret; see firestore.rules)
//   shares/{token} { site, pid, sid, created, by }  guests/{uid}_{pid} { token, pid, joinedAt }  (the Share subject link; see firestore.rules)
//   scanImports/{id} { scan, subject?, createdAt, status, pages, fields: { id: { v, flags, page?, box? } }, reviewedBy?, reviewedAt? }  (Firetop writes, admins read and approve)
//   forms/blank    { b64, name, size, setAt, setBy }        (the blank paper form, .docx; admins upload, members read)
//   payments/{patient id} { site, pid, sid, email?, paynow?, setAt, setBy, emailSent?, paid?, cleared? }  (the team writes,
//                  only admins read, tick and delete the email and PayNow; js/pay.js)

import { FIREBASE_CONFIG } from './firebase-config.js';
import { mergeShared } from './store.js';
import { lockLeave, statusInput } from './sync-rules.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
// the sync engine (patients): an exact version, precached by sw.js
const SYNC = 'https://core.anawj.com/sync/0.4.1/index.js';
const params = new URLSearchParams(location.search);
// ?emulator on localhost: local Firebase emulators with the demo project (browser tests only; never the live project)
const EMU = params.has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname);
export const enabled = !!FIREBASE_CONFIG?.apiKey && !params.has('demo');

let fb = null, starting = null;
// one start even when several calls arrive together (a second initializeApp would throw)
function sdk() { return fb ? Promise.resolve(fb) : (starting ||= start()); }
async function start() {
  const [app, auth, fs, sync] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'), import(SYNC)]);
  const a = app.initializeApp(EMU ? { ...FIREBASE_CONFIG, projectId: 'demo-prewarm' } : FIREBASE_CONFIG);
  let db;
  // keep a copy on the phone so saving works without signal and syncs later
  try { db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch { db = fs.getFirestore(a); }
  fb = { auth: auth.getAuth(a), db, A: auth, F: fs, S: sync };
  if (EMU) { fs.connectFirestoreEmulator(db, '127.0.0.1', 8085); auth.connectAuthEmulator(fb.auth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
  engine = makeEngine(fb);
  return fb;
}

// ---- the sync engine (app-sync, 24 Oct 2026): patients only. Every save goes to an outbox on this phone first, then to
// the server one at a time, merged there field by field (store.js mergeShared), so a save never waits in Firestore's own
// queue and is never lost with its cache. Opens listen only for patients changed since the last sync (updatedAt), with
// a copy of the list on the phone. Members, codes, admins, forms, payments, PACU links and shares stay direct writes.
// Server stamps (app-sync 0.3.0, 24 Oct 2026): every save also carries serverAt (the server's clock); the hub still
// listens by updatedAt until every patient has serverAt (tools/backfill-server-at.mjs) and the rules require it.
// app-sync 0.4.0 (25 Oct 2026): the stamp only moves forward (max(now, the server copy's + 1), in the transaction), an
// admin's lock writes its leave entry in the same transaction, and a patient that leaves the list while it still has
// saves not sent stays on this phone and is reported (prewarm-sync-left); since 0.4.1 also when its leave entry arrives.
let engine = null;
const listeners = new Set();   // watchPatients callbacks, so the watchdog can start them again
function makeEngine({ db, F, S, auth }) {
  const watchdog = S.createWatchdog({
    // a fresh listener (from this phone's copy: only what changed since) for every open list
    relisten: async () => { await hub.stopAll(); for (const l of listeners) l.restart(); },
    cycle: async () => { try { await F.disableNetwork(db); } finally { await F.enableNetwork(db); } },
    quiet: () => !queue.pending(),
  });
  const fs = S.createFirestoreBackend({
    sdk: async () => ({ db, F }), path: (_site, coll) => [coll], stampMode: 'server',
    // members: their hospital's unlocked patients and its leave entries (the rules refuse anything else); admins
    // (scope ''): every patient, locked too, so no leave entries (site '' matches none: they would drop locked ones)
    where: (site, coll) => coll === 'leaves' ? [['site', '==', site]] : site ? [['site', '==', site], ['locked', '==', false]] : [],
    // stamped by app-sync: never older than the server's copy, even from a phone whose clock is behind (an unlock must
    // be newer than the lock's leave entry, or a member's phone would take the unlocked patient for the copy that left)
    merge: { patients: (current, record, _base, ops) => mergeShared(current, record, ops) },
    // an admin's lock: its leave entry in the same transaction (sync-rules.js lockLeave)
    onCommit: ctx => ctx.coll === 'patients' ? lockLeave(ctx, S.leaveEntry) : [],
    onSnapshotMeta: (_coll, meta) => watchdog.heard(meta),
  });
  const stores = S.createStores({ prefix: 'prewarm-store:', colls: ['patients'], metaOnly: ['leaves'] });
  // no recycle bin collection; leaves: patients locked since this phone's last sync (they left its query, which a
  // listener never hears of). Until every patient carries updatedAt (the backfill), opens read in full
  // a patient with saves not sent yet (waiting, refused or in conflict) that leaves the list (locked meanwhile) stays here
  const hub = S.createSyncHub({ openStore: stores.openStore, listen: fs.listen, fetchOne: fs.fetchOne, bin: null, feeds: { leaves: { patient: 'patients' } }, unstamped: 'full',
    unsent: (_scope, coll, id) => coll === 'patients' && queue.unsent('patient', id),
    onLeave: (_scope, coll, id) => { if (coll === 'patients') dispatchEvent(new CustomEvent('prewarm-sync-left', { detail: { id } })); },
    onError: e => dispatchEvent(new CustomEvent('prewarm-sync-error', { detail: e })) });
  S.replanOnWake(hub);
  const outbox = S.createOutbox({ name: 'prewarm-outbox' });
  const queue = S.createWriteQueue({
    store: outbox, getOwner: () => auth.currentUser?.uid || null,
    backend: (_owner, _kind, record, base, extra) => fs.commit('', 'patients', record, base, extra),
    online: () => navigator.onLine !== false,
  });
  addEventListener('online', () => { queue.kick(); watchdog.event(); });
  addEventListener('pageshow', () => watchdog.event());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { queue.kick(); watchdog.event(); } });
  setInterval(() => watchdog.check(), 30000);
  let persisted = true;
  S.persistGuard().then(r => { persisted = !r.supported || r.persisted; queue.kick(); });
  return { hub, queue, stores, watchdog, fs, S, persisted: () => persisted };
}
// the write queue's saves for this phone's account (activated once signed in), or null before the engine started
export async function queue() {
  const { auth } = await sdk();
  if (auth.currentUser) await engine.queue.activate(auth.currentUser.uid);
  return engine.queue;
}
// the sync status rules (app-sync status.js): { state, count }, state one of attention, at-risk, offline, saving, stale,
// unknown, synced. confirmed: the team's list has come from the server since this page opened (else unknown, not synced)
export function status({ confirmed = true } = {}) {
  if (!engine) return null;
  const q = engine.queue;
  return engine.S.syncStatus(statusInput({ online: navigator.onLine !== false, pending: q.pending(), attention: engine.S.attentionCount(q.entries()), persisted: engine.persisted(), stale: engine.watchdog.stale(), confirmed }));
}
// saves in this phone's outbox still being sent (0 before the engine started): an update's reload waits for them. Not
// queue.pending(), which also counts refused saves and conflicts: those wait for a person, and would hold an update for good
export const pendingCount = () => engine ? engine.queue.entries().filter(x => x.state === 'pending').length : 0;
// "Refresh now": a moment the phone came back, for the watchdog (listen again if the server went quiet)
export function nudge() { if (engine) { engine.queue.kick(); engine.watchdog.event(); } }

// Firestore rejects undefined; a JSON round trip drops it
const plain = o => JSON.parse(JSON.stringify(o));
// ctx 'save' (a patient save) and 'pacu' (the nurse link) say what to do; the default is the join / admin wording
const friendly = (e, ctx) => {
  if (ctx === 'pacu' && (e?.code === 'permission-denied' || e?.code === 'not-found')) return 'This link has stopped working. Ask the study team for a new link.';
  if (ctx === 'pay' && e?.code === 'permission-denied') return 'Not allowed: only this hospital’s team can save these, and only study admins can tick or delete them.';
  if (ctx === 'save' && e?.code === 'permission-denied') return 'Not saved to the team: this patient may be locked, or this phone is no longer on the team. Ask a study admin.';
  if (e?.code === 'permission-denied') return 'Not allowed. Check the hospital and code.';
  if (e?.code === 'unavailable') return 'No connection. Try again with signal.';
  if (e?.code === 'auth/invalid-action-code' || e?.code === 'auth/expired-action-code') return 'That sign-in link has expired or was used already. Send a new one.';
  if (e?.code === 'auth/invalid-email') return 'Check the email address.';
  if (['auth/wrong-password', 'auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(e?.code)) return 'Wrong email or password. A password only works once it is set: sign in by email link first, then set one.';
  if (e?.code === 'auth/too-many-requests') return 'Too many tries. Wait a few minutes, or use the emailed link.';
  if (e?.code === 'auth/weak-password') return 'Use at least 8 characters.';
  if (e?.code === 'auth/requires-recent-login') return 'For safety, sign out and sign in again, then set the password.';
  if (e?.code === 'auth/operation-not-allowed') return 'Email-link sign-in isn’t switched on in Firebase yet.';
  return ctx ? 'Couldn’t save. Check your signal and try again.' : 'Something went wrong: ' + (e?.message || e);
};
export { friendly };

export async function onUser(cb) {
  const { auth, A } = await sdk();
  A.onAuthStateChanged(auth, cb);
}

// the signed-in user with a fresh token (after the owner changed the admin list or the rules)
export async function whoAmI() {
  const { auth } = await sdk();
  const u = auth.currentUser;
  try { await u?.getIdToken(true); } catch { /* offline: keep what we have */ }
  return u;
}

export async function member() {
  const { auth, db, F } = await sdk();
  if (!auth.currentUser) return null;
  const ref = F.doc(db, 'members', auth.currentUser.uid);
  // ask the server: the phone's own copy can hold a join the rules are about to refuse; offline, trust the copy
  try { const s = await F.getDocFromServer(ref); return s.exists() ? s.data() : null; }
  catch (e) {
    if (e?.code === 'permission-denied') return null;
    try { const s = await F.getDocFromCache(ref); return s.exists() ? s.data() : null; } catch { return null; }
  }
}

export async function isAdmin() {
  const { auth, db, F } = await sdk();
  const u = auth.currentUser;
  if (!u?.email) return false;
  try { return (await F.getDoc(F.doc(db, 'admins', u.email.toLowerCase()))).exists(); } catch { return false; }
}

export async function join(site, code, initials) {
  const { auth, db, F, A } = await sdk();
  if (!auth.currentUser) await A.signInAnonymously(auth);
  await F.setDoc(F.doc(db, 'members', auth.currentUser.uid), { site, code: code.trim(), initials: initials || '', joinedAt: Date.now() });
}

export async function setInitials(initials) {
  const { auth, db, F } = await sdk();
  if (auth.currentUser) await F.updateDoc(F.doc(db, 'members', auth.currentUser.uid), { initials });
}

export async function leave() {
  const { auth, db, F, A } = await sdk();
  if (auth.currentUser && !auth.currentUser.isAnonymous) return A.signOut(auth);
  if (auth.currentUser) { try { await F.deleteDoc(F.doc(db, 'members', auth.currentUser.uid)); } catch { /* removed already */ } }
  await A.signOut(auth);
}

// Every change sent from this phone has reached the server (false if not within ms: no signal): the outbox is empty
// (in every tab) and Firestore's own writes (members, PACU links, …) are acknowledged
export async function flushed(ms = 5000) {
  const { db, F } = await sdk();
  const q = await queue();
  const fsDone = Promise.race([F.waitForPendingWrites(db).then(() => true), new Promise(ok => setTimeout(() => ok(false), ms))]);
  return (await q.flush(ms)) && await fsDone;
}
// Log out: leave the team (or sign out an admin) and delete the study data on this phone (app-sync forgetDevice): stop
// listening, sign out, then the engine's copy of the list, the outbox's saves for this account (the screen warned about
// unsent ones), Firestore's own copy, and the app's (extra). The page reloads afterwards (Firestore can't be used again
// once its copy is cleared). A step that fails doesn't stop the others.
export async function logOut({ extra = null } = {}) {
  await sdk();
  const { hub, queue: q, stores, fs, S } = engine;
  // signing out comes before the wipe (it needs Firestore, which the wipe ends); it goes ahead even if leaving fails
  const proceed = async () => { try { await leave(); } catch { /* signed out anyway, or removed already */ } return true; };
  return S.forgetDevice({ hub, stores, queue: q, proceed, keep: [], clearBackendCache: fs.clearCache, extra });
}

// Admins sign in with an emailed link (no Google pop-up: phone browsers block the pop-up's helper page on
// prewarm-study.firebaseapp.com from passing the result back to anawj.com). The link opens the app again.
const EMAIL_KEY = 'prewarm:adminEmail';
export async function sendAdminLink(email) {
  const { auth, A } = await sdk();
  const url = location.origin + location.pathname + (EMU ? '?emulator&adminlink' : '?adminlink');
  await A.sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* asked again when the link opens */ }
}
export function isAdminLink() { return /[?&]oobCode=/.test(location.href) && /[?&]mode=signIn/.test(location.href); }
export function savedAdminEmail() { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } }
export async function finishAdminLink(email) {
  const { auth, A } = await sdk();
  if (auth.currentUser?.isAnonymous) { try { await leave(); } catch { /* signed out anyway */ } }
  await A.signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* fine */ }
  // drop the one-time code from the address
  history.replaceState(null, '', location.pathname + (EMU ? '?emulator' : '') + '#/admin');
}

// Admins can also sign in with an email and password (owner, 13 Oct 2026): no pop-up and no helper page, so phones
// don't block it. A password exists only for an account that has already signed in once by emailed link (that proves
// the email, which the rules need); it is set or changed from Settings while signed in, or by an emailed reset link.
export async function adminPasswordSignIn(email, password) {
  const { auth, A } = await sdk();
  if (auth.currentUser?.isAnonymous) { try { await leave(); } catch { /* signed out anyway */ } }
  await A.signInWithEmailAndPassword(auth, email, password);
}
export async function sendPasswordReset(email) {
  const { auth, A } = await sdk();
  await A.sendPasswordResetEmail(auth, email, { url: location.origin + location.pathname });
}
export async function setMyPassword(password) {
  const { auth, A } = await sdk();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw Object.assign(new Error('not signed in'), { code: 'auth/requires-recent-login' });
  await A.updatePassword(auth.currentUser, password);
}

// Patients of one hospital (or all, for an admin); cb gets the changed records and meta { server, removed }, removed:
// patients that left the list (for a member: locked by an admin). The engine hands over its whole list each time; the
// changes are worked out here, so the screens hear the same as before.
export async function watchPatients(site, cb, onError) {
  await sdk();
  const { hub } = engine;
  let held = new Map(), off = null, stopped = false;
  const l = {
    restart() { if (stopped) return; off?.(); off = hub.watch(site || '', 'patients', onList); },
  };
  function onList(list, flags) {
    const next = new Map(list.map(r => [r.id, JSON.stringify(r)]));
    const changed = list.filter(r => held.get(r.id) !== next.get(r.id)).map(r => ({ ...r }));
    const removed = [...held.keys()].filter(id => !next.has(id));
    held = next;
    cb(changed, { server: !flags.fromCache && !flags.hasPendingWrites, removed });
  }
  // the hub reports listener errors (a missing index: failed-precondition; refused: permission-denied) to onError too
  // a listener that failed is never heard from again: stop the engines, so the next watch (or the watchdog) starts afresh
  const errs = e => { hub.stopAll().finally(() => onError?.(e.detail)); };
  window.addEventListener('prewarm-sync-error', errs);
  listeners.add(l); l.restart();
  return () => { stopped = true; off?.(); listeners.delete(l); window.removeEventListener('prewarm-sync-error', errs); };
}

// Send a patient: the whole record goes to this phone's outbox, then to the server, where it is merged with the
// server's copy field by field (store.js mergeShared). ids: the fields changed (kept with the save). withLock: an
// admin's lock or unlock. Resolves once the save is stored on this phone (and sent, if that is quick); throws when the
// server refused it (e.g. locked meanwhile: code permission-denied) or it can't be stored here.
export async function push(rec, ids, withLock = false) {
  const q = await queue();
  const { auth } = await sdk();
  // every field says whether it was worked out (auto) or typed: a typed BMI sent without auto: false kept the server's
  // old auto: true, and other phones then worked it out again over the typed one
  const f = Object.fromEntries(Object.entries(rec.f || {}).map(([k, x]) => [k, x && typeof x === 'object' ? { ...x, auto: !!x.auto } : x]));
  const body = { id: rec.id, site: rec.site, created: rec.created, f };
  if (rec.deleted) body.deleted = rec.deleted;
  if (rec.lock) body.lock = rec.lock;
  try { await q.save('patient', auth.currentUser.uid, plain(body), null, { ops: { ids, ...(withLock ? { lock: true } : {}) } }); }
  catch (e) {
    const job = q.entries().find(x => x.kind === 'patient' && x.record.id === rec.id);
    throw Object.assign(new Error(e.message), { code: /locked|permission|insufficient/i.test(job?.error || e.message) ? 'permission-denied' : e.code || 'failed' });
  }
}

// The blank paper data collection form (null if none yet). Firestore keeps a copy on the phone for offline use.
export async function blankForm() {
  const { db, F } = await sdk();
  const ref = F.doc(db, 'forms', 'blank');
  let s;
  try { s = await F.getDoc(ref); } catch (e) { if (e?.code === 'permission-denied') return null; throw e; }
  return s.exists() ? s.data() : null;
}
export async function setBlankForm(b64, name, size) {
  const { auth, db, F } = await sdk();
  await F.setDoc(F.doc(db, 'forms', 'blank'), { b64, name, size, setAt: Date.now(), setBy: auth.currentUser.email.toLowerCase() });
}

// ---- admin
export async function codes() {
  const { db, F } = await sdk();
  const s = await F.getDocs(F.collection(db, 'codes'));
  return Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
}
export async function setCode(site, code) {
  const { auth, db, F } = await sdk();
  await F.setDoc(F.doc(db, 'codes', site), { code, setAt: Date.now(), setBy: auth.currentUser.email.toLowerCase() });
}
export async function members() {
  const { db, F } = await sdk();
  const s = await F.getDocs(F.collection(db, 'members'));
  return s.docs.map(d => ({ uid: d.id, ...d.data() }));
}
// study admins (owner, 12 Oct 2026): any admin adds or removes others by email; nobody removes themselves
export async function admins() {
  const { db, F } = await sdk();
  const s = await F.getDocs(F.collection(db, 'admins'));
  return s.docs.map(d => ({ email: d.id, ...d.data() }));
}
export async function addAdmin(email) {
  const { auth, db, F } = await sdk();
  await F.setDoc(F.doc(db, 'admins', email.trim().toLowerCase()), { addedBy: auth.currentUser.email.toLowerCase(), addedAt: Date.now() });
}
export async function removeAdmin(email) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'admins', email));
}
// scan imports (owner, 20 Oct 2026): Firetop's reading of a received scan; an admin approves it before anything reaches a patient
export async function scanImports() {
  const { db, F } = await sdk();
  const s = await F.getDocs(F.collection(db, 'scanImports'));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export async function reviewScanImport(id, status) {
  const { auth, db, F } = await sdk();
  await F.updateDoc(F.doc(db, 'scanImports', id), { status, reviewedBy: auth.currentUser.email.toLowerCase(), reviewedAt: Date.now() });
}
// Email and PayNow (js/pay.js). The team's save merges into payments/{pid} without reading it (they can't); it resolves
// once the server has it, so the caller shows "Saved" after a short wait without signal (Firestore sends it later).
export async function payPut(pid, { site, sid, email, paynow, by }) {
  const { db, F } = await sdk();
  const body = { site, pid, sid, setAt: Date.now(), setBy: by };
  if (email) body.email = email; else body.email = F.deleteField();
  if (paynow) body.paynow = paynow; else body.paynow = F.deleteField();
  await F.setDoc(F.doc(db, 'payments', pid), body, { merge: true });
}
// admins only: from the server, so a list never shows values already deleted elsewhere
export async function payList() {
  const { db, F } = await sdk();
  const s = await F.getDocsFromServer(F.collection(db, 'payments'));
  return s.docs.map(d => ({ ...d.data(), pid: d.id }));
}
export async function payGet(pid) {
  const { db, F } = await sdk();
  const s = await F.getDocFromServer(F.doc(db, 'payments', pid));
  return s.exists() ? { ...s.data(), pid } : null;
}
const stamp = auth => ({ t: Date.now(), by: auth.currentUser.email.toLowerCase() });
export async function payTick(pid, key, on) {
  const { auth, db, F } = await sdk();
  await F.updateDoc(F.doc(db, 'payments', pid), { [key]: on ? stamp(auth) : F.deleteField() });
}
export async function payClear(pid) {
  const { auth, db, F } = await sdk();
  await F.updateDoc(F.doc(db, 'payments', pid), { email: F.deleteField(), paynow: F.deleteField(), cleared: stamp(auth) });
}
export async function myEmail() {
  const { auth } = await sdk();
  return auth.currentUser?.email?.toLowerCase() || '';
}
export async function removeMember(uid) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'members', uid));
}

// ---- PACU nurse link (owner, 13 Oct 2026)
// An anonymous sign-in is enough for the nurse's phone: knowing the token is what opens the document.
export async function ensureSignedIn() {
  const { auth, A } = await sdk();
  if (!auth.currentUser) await A.signInAnonymously(auth);
}
export async function pacuCreate(token, data) {
  const { db, F } = await sdk();
  await F.setDoc(F.doc(db, 'pacu', token), plain(data));
}
export async function pacuPush(token, f) {
  const { db, F } = await sdk();
  const out = {};
  for (const [k, x] of Object.entries(f)) out[k] = { ...x, auto: !!x.auto };
  if (!Object.keys(out).length) return;
  // updateDoc, not a merging setDoc: if the link was stopped, a merging set turns into a create, which the rules
  // refuse as "Not allowed"; an update says not-found, which the nurse page words as "link stopped" (14 Oct 2026)
  const upd = {};
  for (const [k, x] of Object.entries(plain(out))) upd['f.' + k] = x;
  await F.updateDoc(F.doc(db, 'pacu', token), upd);
}
// cb(data | null (no such link), { server, pending })
export async function pacuWatch(token, cb, onError) {
  const { db, F } = await sdk();
  return F.onSnapshot(F.doc(db, 'pacu', token), { includeMetadataChanges: true },
    snap => cb(snap.exists() ? snap.data() : null, { server: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites, pending: snap.metadata.hasPendingWrites }), onError);
}
export async function pacuStop(token) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'pacu', token));
}

// ---- Share subject link (owner, 21 Oct 2026): shares/{token} names one patient; a phone that opens it signs in
// anonymously and records a guest pass (guests/{uid}_{pid}), which lets it read and edit only that patient.
export async function shareCreate(token, data) {
  const { db, F } = await sdk();
  await F.setDoc(F.doc(db, 'shares', token), plain(data));
}
// the link's { site, pid, sid } from the server (null: stopped or never made)
export async function shareGet(token) {
  const { db, F } = await sdk();
  try { const s = await F.getDocFromServer(F.doc(db, 'shares', token)); return s.exists() ? s.data() : null; }
  catch (e) { if (e?.code === 'permission-denied') return null; throw e; }
}
export async function shareStop(token) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'shares', token));
}
// resolves once the server has the pass (the patient can't be read before that)
export async function guestJoin(token, pid) {
  const { auth, db, F, A } = await sdk();
  if (!auth.currentUser) await A.signInAnonymously(auth);
  await F.setDoc(F.doc(db, 'guests', auth.currentUser.uid + '_' + pid), { token, pid, joinedAt: Date.now() });
}
// one patient by id, for a guest phone; cb as in watchPatients (removed: the patient is gone)
export async function watchPatient(pid, cb, onError) {
  const { db, F } = await sdk();
  return F.onSnapshot(F.doc(db, 'patients', pid), { includeMetadataChanges: true }, snap => {
    const server = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    // serverAt (a Firestore Timestamp) as ms, as the sync engine hands it over
    if (snap.exists()) { const d = snap.data(); cb([{ id: snap.id, ...d, ...(d.serverAt?.toMillis ? { serverAt: d.serverAt.toMillis() } : {}) }], { server, removed: [] }); }
    else cb([], { server, removed: server ? [pid] : [] });
  }, onError);
}
