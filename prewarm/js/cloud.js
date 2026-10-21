// Sharing through Firestore (Firebase project prewarm-study). Phones join with their hospital's code (anonymous
// sign-in); admins sign in with an emailed link. Access is decided by firestore.rules. Demo mode (?demo) never connects.
//
//   members/{uid}  { site, initials, code, joinedAt }       codes/{site}  { code, setAt, setBy }   (admins only)
//   admins/{email} {}                                       patients/{id} { site, created, deleted?, lock?, f: { id: {v,t,by} } }
//   pacu/{token}   { site, pid, sid, created, f }      (the PACU nurse's link: the token is the secret; see firestore.rules)
//   shares/{token} { site, pid, sid, created, by }  guests/{uid}_{pid} { token, pid, joinedAt }  (the Share subject link; see firestore.rules)
//   scanImports/{id} { scan, subject?, createdAt, status, pages, fields: { id: { v, flags, page?, box? } }, reviewedBy?, reviewedAt? }  (Firetop writes, admins read and approve)
//   forms/blank    { b64, name, size, setAt, setBy }        (the blank paper form, .docx; admins upload, members read)
//   payments/{patient id} { site, pid, sid, email?, paynow?, setAt, setBy, emailSent?, paid?, cleared? }  (the team writes,
//                  only admins read, tick and delete the email and PayNow; js/pay.js)

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const params = new URLSearchParams(location.search);
// ?emulator on localhost: local Firebase emulators with the demo project (browser tests only; never the live project)
const EMU = params.has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname);
export const enabled = !!FIREBASE_CONFIG?.apiKey && !params.has('demo');

let fb = null, starting = null;
// one start even when several calls arrive together (a second initializeApp would throw)
function sdk() { return fb ? Promise.resolve(fb) : (starting ||= start()); }
async function start() {
  const [app, auth, fs] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  const a = app.initializeApp(EMU ? { ...FIREBASE_CONFIG, projectId: 'demo-prewarm' } : FIREBASE_CONFIG);
  let db;
  // keep a copy on the phone so saving works without signal and syncs later
  try { db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch { db = fs.getFirestore(a); }
  fb = { auth: auth.getAuth(a), db, A: auth, F: fs };
  if (EMU) { fs.connectFirestoreEmulator(db, '127.0.0.1', 8085); auth.connectAuthEmulator(fb.auth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
  return fb;
}

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

// Every change sent from this phone has reached the server (false if not within ms: no signal)
export async function flushed(ms = 5000) {
  const { db, F } = await sdk();
  return Promise.race([F.waitForPendingWrites(db).then(() => true), new Promise(ok => setTimeout(() => ok(false), ms))]);
}
// Log out: leave the team (or sign out an admin) and delete Firestore's copy of the study data on this phone.
// The page reloads afterwards (Firestore can't be used again once its copy is cleared).
export async function logOut() {
  const { db, F } = await sdk();
  try { await leave(); } catch { /* signed out below anyway */ }
  try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch { /* cleared on the next start */ }
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

// Patients of one hospital (or all, for an admin); cb gets the changed records
export async function watchPatients(site, cb, onError) {
  const { db, F } = await sdk();
  // members only get their hospital's unlocked patients (the rules refuse anything else); admins get everything
  const q = site ? F.query(F.collection(db, 'patients'), F.where('site', '==', site), F.where('locked', '==', false)) : F.collection(db, 'patients');
  // metadata changes too, so the app hears when the phone's copy is confirmed by the server (its "last synced")
  // removed: patients that left the query (for a member: locked by an admin)
  return F.onSnapshot(q, { includeMetadataChanges: true }, snap => {
    const ch = snap.docChanges();
    cb(ch.filter(c => c.type !== 'removed').map(c => ({ id: c.doc.id, ...c.doc.data() })),
      { server: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites, removed: ch.filter(c => c.type === 'removed').map(c => c.doc.id) });
  }, onError);
}

// Send changed fields of a record; merges into the shared copy field by field
export async function push(rec, ids, withLock = false) {
  const { db, F } = await sdk();
  const f = {};
  // auto always sent: the merge is deep, so a typed value would otherwise keep an old auto flag and be recalculated over
  for (const k of ids) if (rec.f[k]) f[k] = { ...rec.f[k], auto: !!rec.f[k].auto };
  // never send an empty f: merging {} would replace the patient's readings on the server with nothing
  const body = { site: rec.site, created: rec.created, locked: !!rec.lock?.on };
  if (Object.keys(f).length) body.f = f;
  if (rec.deleted) body.deleted = rec.deleted;
  // only an admin's lock / unlock sends it (the rules refuse it from anyone else)
  if (withLock && rec.lock) body.lock = rec.lock;
  await F.setDoc(F.doc(db, 'patients', rec.id), plain(body), { merge: true });
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
    if (snap.exists()) cb([{ id: snap.id, ...snap.data() }], { server, removed: [] });
    else cb([], { server, removed: server ? [pid] : [] });
  }, onError);
}
