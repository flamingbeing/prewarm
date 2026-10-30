// Firestore rules checks for prewarm/firestore.rules against the local emulator (fake accounts, demo project only).
// Run with tools/test-rules.sh (it starts the emulator and runs this from prewarm/).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, getDocs, collection, query, where, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-prewarm', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } });
const ADMIN = 'lead@example.com';
const google = (email, verified = true) => env.authenticatedContext('g-' + email, { email, email_verified: verified }).firestore();
const anonUser = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'admins', ADMIN), { name: 'Lead' });
  await setDoc(doc(db, 'codes', 'NUH'), { code: 'NUH-CODE-1', setAt: 1, setBy: ADMIN });
  await setDoc(doc(db, 'codes', 'SGH'), { code: 'SGH-CODE-1', setAt: 1, setBy: ADMIN });
  await setDoc(doc(db, 'patients', 'sgh1'), { updatedAt: 1, site: 'SGH', created: 1, f: {} });
});
let n = 0, fail = 0;
async function t(name, p) { n++; try { await p; } catch (e) { fail++; console.log('FAIL', name, e.message.slice(0, 200)); } }
const adm = google(ADMIN), stranger = google('someone@example.com'), unv = google(ADMIN, false);
const a = anonUser('phoneA'), b = anonUser('phoneB'), c = anonUser('phoneC'), nobody = env.unauthenticatedContext().firestore();
const join = (db, uid, site, code, extra = {}) => setDoc(doc(db, 'members', uid), { site, initials: 'AB', code, joinedAt: 1, ...extra });
// every patient write changes updatedAt (the sync engine's stamp, 24 Oct 2026): U() is a new stamp each time
let stampN = 1000;
const U = () => ++stampN;
const pat = (site, f = {}) => ({ site, created: 1, locked: false, f, updatedAt: U() });

// joining
await t('join with the right code', assertSucceeds(join(a, 'phoneA', 'NUH', 'NUH-CODE-1')));
await t('join with a wrong code', assertFails(join(b, 'phoneB', 'NUH', 'guess')));
await t('join with another hospital code', assertFails(join(b, 'phoneB', 'NUH', 'SGH-CODE-1')));
await t('join a hospital with no code yet', assertFails(join(b, 'phoneB', 'WH', 'anything')));
await t('join an unknown hospital', assertFails(join(b, 'phoneB', 'XYZ', 'NUH-CODE-1')));
await t('join as someone else', assertFails(join(b, 'phoneA', 'NUH', 'NUH-CODE-1')));
await t('join with extra fields', assertFails(join(b, 'phoneB', 'NUH', 'NUH-CODE-1', { admin: true })));
await t('join signed out', assertFails(join(nobody, 'x', 'NUH', 'NUH-CODE-1')));
await t('SGH phone joins', assertSucceeds(join(c, 'phoneC', 'SGH', 'SGH-CODE-1')));
await t('member reads own entry', assertSucceeds(getDoc(doc(a, 'members', 'phoneA'))));
await t('member cannot read another', assertFails(getDoc(doc(a, 'members', 'phoneC'))));
await t('member cannot list members', assertFails(getDocs(collection(a, 'members'))));
await t('member changes initials', assertSucceeds(updateDoc(doc(a, 'members', 'phoneA'), { initials: 'CD' })));
await t('member cannot move hospital', assertFails(updateDoc(doc(a, 'members', 'phoneA'), { site: 'SGH' })));
await t('codes hidden from members', assertFails(getDoc(doc(a, 'codes', 'NUH'))));
await t('codes hidden from strangers', assertFails(getDoc(doc(stranger, 'codes', 'NUH'))));
await t('member cannot set a code', assertFails(setDoc(doc(a, 'codes', 'NUH'), { code: 'MINE-123', setAt: 2, setBy: 'x' })));

// patients
await t('member creates own-hospital patient', assertSucceeds(setDoc(doc(a, 'patients', 'p1'), pat('NUH', { enrol_id: { v: 'S-01', t: 1, by: 'AB' } }))));
await t('member merges a reading', assertSucceeds(setDoc(doc(a, 'patients', 'p1'), { updatedAt: U(), f: { prewarm_0_core: { v: '36.6', t: 2, by: 'AB' } } }, { merge: true })));
await t('member soft-deletes', assertSucceeds(setDoc(doc(a, 'patients', 'p1'), { updatedAt: U(), deleted: 5 }, { merge: true })));
await t('member cannot create other-hospital patient', assertFails(setDoc(doc(a, 'patients', 'p2'), pat('SGH'))));
await t('member cannot move a patient', assertFails(setDoc(doc(a, 'patients', 'p1'), { updatedAt: U(), site: 'SGH' }, { merge: true })));
await t('member cannot read other hospital', assertFails(getDoc(doc(a, 'patients', 'sgh1'))));
await t('member cannot write other hospital', assertFails(setDoc(doc(a, 'patients', 'sgh1'), { updatedAt: U(), f: { x: { v: 1 } } }, { merge: true })));
await t('member lists own hospital', assertSucceeds(getDocs(query(collection(a, 'patients'), where('site', '==', 'NUH'), where('locked', '==', false)))));
await t('member cannot list everything', assertFails(getDocs(collection(a, 'patients'))));
await t('member cannot hard-delete', assertFails(deleteDoc(doc(a, 'patients', 'p1'))));
await t('unknown patient field', assertFails(setDoc(doc(a, 'patients', 'p3'), { ...pat('NUH'), name: 'Real Person' })));
await t('f must be a map', assertFails(setDoc(doc(a, 'patients', 'p3'), { updatedAt: U(), site: 'NUH', created: 1, f: 'x' })));
await t('non-member cannot read', assertFails(getDoc(doc(b, 'patients', 'p1'))));
await t('signed out cannot read', assertFails(getDoc(doc(nobody, 'patients', 'p1'))));
await t('stranger Google account cannot read', assertFails(getDoc(doc(stranger, 'patients', 'p1'))));

// admins
await t('admin checks own entry', assertSucceeds(getDoc(doc(adm, 'admins', ADMIN))));
await t('stranger checks own (absent) entry', assertSucceeds(getDoc(doc(stranger, 'admins', 'someone@example.com'))));
await t('stranger cannot add self', assertFails(setDoc(doc(stranger, 'admins', 'someone@example.com'), { name: 'x' })));
await t('member cannot list admins', assertFails(getDocs(collection(a, 'admins'))));
await t('unverified admin email refused', assertFails(getDoc(doc(unv, 'codes', 'NUH'))));
await t('admin reads codes', assertSucceeds(getDocs(collection(adm, 'codes'))));
await t('admin sets a code', assertSucceeds(setDoc(doc(adm, 'codes', 'WH'), { code: 'WH-NEW-CODE', setAt: 3, setBy: ADMIN })));
await t('code too short', assertFails(setDoc(doc(adm, 'codes', 'WH'), { code: '123', setAt: 3, setBy: ADMIN })));
await t('code for unknown hospital', assertFails(setDoc(doc(adm, 'codes', 'XYZ'), { code: 'XYZ-CODE-1', setAt: 3, setBy: ADMIN })));
await t('admin lists members', assertSucceeds(getDocs(collection(adm, 'members'))));
await t('admin reads all patients', assertSucceeds(getDocs(collection(adm, 'patients'))));
// locking (admins only; a locked patient can't be changed by members)
const L = (on, t = 10) => ({ lock: { on, t, by: ADMIN }, locked: on, updatedAt: U() });
await t('member creates p4', assertSucceeds(setDoc(doc(a, 'patients', 'p4'), pat('NUH'))));
await t('member cannot lock', assertFails(setDoc(doc(a, 'patients', 'p4'), L(true), { merge: true })));
await t('member cannot create a locked patient', assertFails(setDoc(doc(a, 'patients', 'p5'), { ...pat('NUH'), ...L(true) })));
await t('admin locks', assertSucceeds(setDoc(doc(adm, 'patients', 'p4'), L(true), { merge: true })));
await t('member cannot write a locked patient', assertFails(setDoc(doc(a, 'patients', 'p4'), { updatedAt: U(), f: { x: { v: 1, t: 11, by: 'AB' } } }, { merge: true })));
await t('member cannot unlock', assertFails(setDoc(doc(a, 'patients', 'p4'), L(false, 12), { merge: true })));
await t('member cannot read a locked patient', assertFails(getDoc(doc(a, 'patients', 'p4'))));
await t('member query for unlocked patients', assertSucceeds(getDocs(query(collection(a, 'patients'), where('site', '==', 'NUH'), where('locked', '==', false)))));
await t('member query never returns a locked patient', getDocs(query(collection(a, 'patients'), where('site', '==', 'NUH'))).then(r => { if (r.docs.some(d => d.id === 'p4')) throw new Error('locked patient returned'); }, () => {}));
await t('admin reads a locked patient', assertSucceeds(getDoc(doc(adm, 'patients', 'p4'))));
await t('locked must match lock.on', assertFails(setDoc(doc(adm, 'patients', 'p4'), { updatedAt: U(), locked: false }, { merge: true })));
await t('member cannot mark locked without a lock', assertFails(setDoc(doc(a, 'patients', 'p6'), { ...pat('NUH'), locked: true })));
await t('lock must be { on, t, by }', assertFails(setDoc(doc(adm, 'patients', 'p4'), { updatedAt: U(), lock: { on: 'yes', t: 1, by: ADMIN } }, { merge: true })));
await t('admin cannot change a locked patient either', assertFails(setDoc(doc(adm, 'patients', 'p4'), { updatedAt: U(), f: { x: { v: 9, t: 12, by: 'L' } } }, { merge: true })));
await t('admin unlocks', assertSucceeds(setDoc(doc(adm, 'patients', 'p4'), L(false, 13), { merge: true })));
await t('member reads it again once unlocked', assertSucceeds(getDoc(doc(a, 'patients', 'p4'))));
await t('member writes again once unlocked', assertSucceeds(setDoc(doc(a, 'patients', 'p4'), { updatedAt: U(), f: { x: { v: 2, t: 14, by: 'AB' } } }, { merge: true })));
await t('admin writes any hospital', assertSucceeds(setDoc(doc(adm, 'patients', 'sgh1'), { updatedAt: U(), f: { x: { v: 1, t: 1, by: 'L' } } }, { merge: true })));
// the sync engine (24 Oct 2026): stamps, its own id, and the transaction's read before a create
await t('a patient write without updatedAt is refused', assertFails(setDoc(doc(a, 'patients', 'p1'), { f: { x: { v: 3, t: 20, by: 'AB' } } }, { merge: true })));
await t('a new patient without updatedAt is refused', assertFails(setDoc(doc(a, 'patients', 'p7'), { site: 'NUH', created: 1, locked: false, f: {} })));
await t('an update that keeps the old updatedAt is refused (an old app version)', getDoc(doc(adm, 'patients', 'p1')).then(d => assertFails(setDoc(doc(a, 'patients', 'p1'), { updatedAt: d.data().updatedAt, f: { x: { v: 4, t: 21, by: 'AB' } } }, { merge: true }))));
await t('updatedAt must be a number', assertFails(setDoc(doc(a, 'patients', 'p1'), { updatedAt: 'now', f: {} }, { merge: true })));
await t('the engine writes the whole patient with its id', assertSucceeds(setDoc(doc(a, 'patients', 'p8'), { ...pat('NUH'), id: 'p8' })));
await t('…but not another id', assertFails(setDoc(doc(a, 'patients', 'p9'), { ...pat('NUH'), id: 'p1' })));
await t('a member reads a patient id that does not exist yet', assertSucceeds(getDoc(doc(a, 'patients', 'new-one'))));
await t('a stranger cannot', assertFails(getDoc(doc(b, 'patients', 'new-one'))));
await t('a member creates through a transaction (read first)', assertSucceeds(runTransaction(a, async tx => {
  const s = await tx.get(doc(a, 'patients', 'p10')); if (s.exists()) throw new Error('exists');
  tx.set(doc(a, 'patients', 'p10'), { ...pat('NUH'), id: 'p10' });
})));
await t('a member updates through a transaction', assertSucceeds(runTransaction(a, async tx => {
  const s = await tx.get(doc(a, 'patients', 'p10'));
  tx.set(doc(a, 'patients', 'p10'), { ...s.data(), f: { x: { v: 1, t: 5, by: 'AB' } }, updatedAt: U() });
})));
await t('admin removes a member', assertSucceeds(deleteDoc(doc(adm, 'members', 'phoneC'))));
await t('removed member loses access', assertFails(getDoc(doc(c, 'patients', 'sgh1'))));
// managing admins: any admin adds (lower-case email, addedBy themselves) or removes another; nobody removes themselves
const add = (db, em, by = ADMIN, extra = {}) => setDoc(doc(db, 'admins', em), { addedBy: by, addedAt: 1, ...extra });
await t('admin adds an admin', assertSucceeds(add(adm, 'second@example.com')));
await t('admin lists admins', assertSucceeds(getDocs(collection(adm, 'admins'))));
await t('admin add: not an email', assertFails(add(adm, 'not-an-email')));
await t('admin add: upper-case id', assertFails(add(adm, 'Third@example.com')));
await t('admin add: addedBy someone else', assertFails(add(adm, 'third@example.com', 'second@example.com')));
await t('admin add: extra fields', assertFails(add(adm, 'third@example.com', ADMIN, { role: 'owner' })));
await t('admin cannot change an admin entry', assertFails(add(adm, 'second@example.com')));
await t('member cannot add an admin', assertFails(add(a, 'phone@example.com', 'phone@example.com')));
await t('unverified email cannot add an admin', assertFails(add(unv, 'x@example.com')));
const second = google('second@example.com');
await t('new admin is an admin', assertSucceeds(getDocs(collection(second, 'admins'))));
await t('admin cannot remove themselves', assertFails(deleteDoc(doc(adm, 'admins', ADMIN))));
await t('second admin removes the first', assertSucceeds(deleteDoc(doc(second, 'admins', ADMIN))));
await t('removed admin loses access', assertFails(getDocs(collection(adm, 'admins'))));
await t('removed admin cannot re-add self', assertFails(add(adm, ADMIN)));
await t('second admin re-adds the first', assertSucceeds(add(second, ADMIN, 'second@example.com')));
await t('stranger cannot remove an admin', assertFails(deleteDoc(doc(stranger, 'admins', ADMIN))));
// a code change keeps existing members in, and the old code stops working for new phones
// the blank paper form
const form = (extra = {}) => ({ b64: 'UEsDBA==', name: 'form.docx', size: 6, setAt: 5, setBy: ADMIN, ...extra });
await t('admin uploads the blank form', assertSucceeds(setDoc(doc(adm, 'forms', 'blank'), form())));
await t('member reads the blank form', assertSucceeds(getDoc(doc(a, 'forms', 'blank'))));
await t('member reads the scan form map', assertSucceeds(getDoc(doc(a, 'forms', 'scan'))));
await t('admin cannot write the scan form map from the app', assertFails(setDoc(doc(adm, 'forms', 'scan'), { version: '1', map: '{}', templates: [], setAt: 1, setBy: ADMIN })));
await t('stranger cannot read the form', assertFails(getDoc(doc(stranger, 'forms', 'blank'))));
await t('signed out cannot read the form', assertFails(getDoc(doc(nobody, 'forms', 'blank'))));
await t('member cannot replace the form', assertFails(setDoc(doc(a, 'forms', 'blank'), form())));
await t('form only as forms/blank', assertFails(setDoc(doc(adm, 'forms', 'other'), form())));
await t('form with extra fields', assertFails(setDoc(doc(adm, 'forms', 'blank'), form({ note: 'x' }))));
await t('form too big', assertFails(setDoc(doc(adm, 'forms', 'blank'), form({ b64: 'A'.repeat(1000001) }))));
await t('admin changes NUH code', assertSucceeds(setDoc(doc(adm, 'codes', 'NUH'), { code: 'NUH-CODE-2', setAt: 4, setBy: ADMIN })));
await t('existing member still reads', assertSucceeds(getDoc(doc(a, 'patients', 'p1'))));
await t('old code refused', assertFails(join(b, 'phoneB', 'NUH', 'NUH-CODE-1')));
await t('new code works', assertSucceeds(join(b, 'phoneB', 'NUH', 'NUH-CODE-2')));
await t('member leaves', assertSucceeds(deleteDoc(doc(b, 'members', 'phoneB'))));

// the PACU nurse's link: pacu/{token} (owner, 13 Oct 2026)
const nurse = anonUser('nurse1');
const TK = 'k3m9x7q2w5r8t4y6u2p5n3d7', TK2 = 'z9y8x7w6v5u4t3s2r1q2p3m4';
const pacuDoc = (extra = {}) => ({ site: 'NUH', pid: 'p1', sid: 'S-01', created: 1, f: {}, ...extra });
await t('member makes a PACU link for own hospital', assertSucceeds(setDoc(doc(a, 'pacu', TK), pacuDoc({ f: { pacu_in: { v: '09:10', t: 1, by: 'AB' } } }))));
await t('member cannot make one for another hospital', assertFails(setDoc(doc(a, 'pacu', TK2), pacuDoc({ site: 'SGH' }))));
await t('a short token is refused', assertFails(setDoc(doc(a, 'pacu', 'short'), pacuDoc())));
await t('extra fields are refused', assertFails(setDoc(doc(a, 'pacu', TK2), pacuDoc({ note: 'x' }))));
await t('a non-PACU field is refused', assertFails(setDoc(doc(a, 'pacu', TK2), pacuDoc({ f: { prewarm_0_core: { v: '36', t: 1, by: 'AB' } } }))));
await t('a stranger cannot make a link', assertFails(setDoc(doc(nurse, 'pacu', TK2), pacuDoc())));
await t('the nurse (anonymous, not a member) opens the link', assertSucceeds(getDoc(doc(nurse, 'pacu', TK))));
await t('signed out cannot open it', assertFails(getDoc(doc(nobody, 'pacu', TK))));
await t('nobody lists links', assertFails(getDocs(collection(nurse, 'pacu'))));
await t('a member cannot list links either', assertFails(getDocs(collection(a, 'pacu'))));
await t('admin lists links', assertSucceeds(getDocs(collection(adm, 'pacu'))));
await t('the nurse fills a PACU field', assertSucceeds(setDoc(doc(nurse, 'pacu', TK), { f: { pacu_temp: { v: '36.4', t: 2, by: 'NN', auto: false } } }, { merge: true })));
await t('the nurse ticks PACU complete', assertSucceeds(setDoc(doc(nurse, 'pacu', TK), { f: { sign_pacu: { v: 'NN 13 Oct 2026 09:40', t: 3, by: 'NN' } } }, { merge: true })));
await t('the nurse cannot write a non-PACU field', assertFails(setDoc(doc(nurse, 'pacu', TK), { f: { prewarm_0_core: { v: '36', t: 4, by: 'NN' } } }, { merge: true })));
await t('the nurse cannot move the link to another participant', assertFails(setDoc(doc(nurse, 'pacu', TK), { pid: 'p2' }, { merge: true })));
await t('the nurse cannot change the hospital', assertFails(setDoc(doc(nurse, 'pacu', TK), { site: 'SGH' }, { merge: true })));
await t('the nurse cannot change the Subject ID', assertFails(setDoc(doc(nurse, 'pacu', TK), { sid: 'S-99' }, { merge: true })));
await t('the nurse cannot add other fields', assertFails(setDoc(doc(nurse, 'pacu', TK), { admin: true }, { merge: true })));
await t('the nurse cannot make a new link', assertFails(setDoc(doc(nurse, 'pacu', TK2), pacuDoc())));
await t('the nurse cannot delete the link', assertFails(deleteDoc(doc(nurse, 'pacu', TK))));
await t('a member corrects the Subject ID shown', assertSucceeds(setDoc(doc(a, 'pacu', TK), { sid: 'S-01b' }, { merge: true })));
await t('another hospital cannot delete the link', assertFails(deleteDoc(doc(c, 'pacu', TK))));
await t('the member stops the link', assertSucceeds(deleteDoc(doc(a, 'pacu', TK))));
await t('a stopped link is gone', assertSucceeds(getDoc(doc(nurse, 'pacu', TK)).then(s => { if (s.exists()) throw new Error('still there'); })));

// the Share subject link: shares/{token} + a guest pass guests/{uid}_{pid} opens one patient only (owner, 21 Oct 2026)
const PAY_G = { site: 'NUH', sid: 'S-07', email: 'pt@example.com', paynow: '91234567', setAt: 1, setBy: 'GG' };
const SK = 'shr7k2m9q4x8w3v6n5b2c7d9', SK2 = 'shr7k2m9q4x8w3v6n5b2c7d0';
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'patients', 'g1'), pat('NUH', { enrol_id: { v: 'S-07', t: 1, by: 'AB' } }));
  await setDoc(doc(db, 'patients', 'g2'), pat('NUH'));
  await setDoc(doc(db, 'patients', 'g3'), { updatedAt: U(), site: 'NUH', created: 1, locked: true, lock: { on: true, t: 1, by: ADMIN }, f: {} });
});
const share = (extra = {}) => ({ site: 'NUH', pid: 'g1', sid: 'S-07', created: 1, by: 'AB', ...extra });
const pass = (db, uid, pid, token = SK) => setDoc(doc(db, 'guests', uid + '_' + pid), { token, pid, joinedAt: 1 });
const guest = anonUser('phoneG'), other = anonUser('phoneH');
await t('member makes a Share subject link', assertSucceeds(setDoc(doc(a, 'shares', SK), share())));
await t('another hospital cannot make one for its site', assertFails(setDoc(doc(c, 'shares', SK2), share())));
await t('a stranger cannot make one', assertFails(setDoc(doc(guest, 'shares', SK2), share())));
await t('a short share token is refused', assertFails(setDoc(doc(a, 'shares', 'short'), share())));
await t('a share with extra fields is refused', assertFails(setDoc(doc(a, 'shares', SK2), share({ all: true }))));
await t('anyone signed in opens a share', assertSucceeds(getDoc(doc(guest, 'shares', SK))));
await t('signed out cannot open a share', assertFails(getDoc(doc(nobody, 'shares', SK))));
await t('nobody lists shares', assertFails(getDocs(collection(a, 'shares'))));
await t('admin lists shares', assertSucceeds(getDocs(collection(adm, 'shares'))));
await t('before the pass, the guest cannot read the patient', assertFails(getDoc(doc(guest, 'patients', 'g1'))));
await t('a pass for another patient is refused', assertFails(pass(guest, 'phoneG', 'g2')));
await t('a pass in someone else’s name is refused', assertFails(pass(guest, 'phoneH', 'g1')));
await t('a pass with a made-up token is refused', assertFails(pass(guest, 'phoneG', 'g1', SK2)));
await t('the guest takes a pass with the link', assertSucceeds(pass(guest, 'phoneG', 'g1')));
await t('the guest takes it again (opening the link twice)', assertSucceeds(pass(guest, 'phoneG', 'g1')));
await t('the guest reads that patient', assertSucceeds(getDoc(doc(guest, 'patients', 'g1'))));
await t('the guest edits that patient', assertSucceeds(setDoc(doc(guest, 'patients', 'g1'), { updatedAt: U(), site: 'NUH', created: 1, locked: false, f: { prewarm_0_core: { v: '36.5', t: 3, by: 'GG' } } }, { merge: true })));
await t('the guest cannot read another patient', assertFails(getDoc(doc(guest, 'patients', 'g2'))));
await t('the guest cannot edit another patient', assertFails(setDoc(doc(guest, 'patients', 'g2'), { updatedAt: U(), f: { x: { v: 1, t: 1, by: 'G' } } }, { merge: true })));
await t('the guest cannot list the hospital', assertFails(getDocs(query(collection(guest, 'patients'), where('site', '==', 'NUH'), where('locked', '==', false)))));
await t('the guest cannot create a patient', assertFails(setDoc(doc(guest, 'patients', 'g9'), pat('NUH'))));
await t('the guest cannot delete it', assertFails(setDoc(doc(guest, 'patients', 'g1'), { updatedAt: U(), deleted: 9 }, { merge: true })));
await t('the guest cannot lock it', assertFails(setDoc(doc(guest, 'patients', 'g1'), { updatedAt: U(), lock: { on: true, t: 9, by: 'G' }, locked: true }, { merge: true })));
await t('the guest cannot move it', assertFails(setDoc(doc(guest, 'patients', 'g1'), { updatedAt: U(), site: 'SGH' }, { merge: true })));
await t('the guest saves email and PayNow for it', assertSucceeds(setDoc(doc(guest, 'payments', 'g1'), { ...PAY_G, pid: 'g1' }, { merge: true })));
await t('the guest cannot read them back', assertFails(getDoc(doc(guest, 'payments', 'g1'))));
await t('the guest makes its PACU link', assertSucceeds(setDoc(doc(guest, 'pacu', TK2), pacuDoc({ pid: 'g1' }))));
await t('the guest cannot make a PACU link for another patient', assertFails(setDoc(doc(guest, 'pacu', TK), pacuDoc({ pid: 'g2' }))));
await t('the guest cannot stop the share', assertFails(deleteDoc(doc(guest, 'shares', SK))));
await t('a member cannot stop it either', assertFails(deleteDoc(doc(a, 'shares', SK))));
await t('a member corrects the shown Subject ID', assertSucceeds(updateDoc(doc(a, 'shares', SK), { sid: 'S-07b' })));
await t('a member cannot move the share to another patient', assertFails(updateDoc(doc(a, 'shares', SK), { pid: 'g2' })));
// a share whose site doesn't match the patient's opens nothing (an SGH phone naming an NUH patient)
const sgh = anonUser('phoneS');
await t('another SGH phone joins', assertSucceeds(join(sgh, 'phoneS', 'SGH', 'SGH-CODE-1')));
await t('an SGH phone makes a share naming an NUH patient', assertSucceeds(setDoc(doc(sgh, 'shares', SK2), share({ site: 'SGH' }))));
await t('…a pass with it is taken', assertSucceeds(pass(other, 'phoneH', 'g1', SK2)));
await t('…but it opens nothing', assertFails(getDoc(doc(other, 'patients', 'g1'))));
await t('a locked patient is closed to its guest', assertSucceeds(setDoc(doc(a, 'shares', 'shr-locked-0000000000001'), share({ pid: 'g3' }))).then(() => pass(guest, 'phoneG', 'g3', 'shr-locked-0000000000001')).then(() => assertFails(getDoc(doc(guest, 'patients', 'g3')))));
await t('admin stops the share', assertSucceeds(deleteDoc(doc(adm, 'shares', SK))));
await t('a stopped share closes the patient to its guest', assertFails(getDoc(doc(guest, 'patients', 'g1'))));
await t('…and its edits', assertFails(setDoc(doc(guest, 'patients', 'g1'), { updatedAt: U(), f: { prewarm_0_core: { v: '36.6', t: 4, by: 'GG' } } }, { merge: true })));
await t('the team still reads the patient', assertSucceeds(getDoc(doc(a, 'patients', 'g1'))));

// scan imports (Firetop writes them with its own sign-in, which bypasses rules; the app only reads and approves)
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'scanImports', 'scan1'), { scan: 'scan1', createdAt: 1, status: 'pending', pages: [], fields: { age: { v: '67', flags: [] } } });
});
const review = (db, extra = {}) => updateDoc(doc(db, 'scanImports', 'scan1'), { status: 'approved', reviewedBy: ADMIN, reviewedAt: 5, ...extra });
await t('admin reads scan imports', assertSucceeds(getDocs(collection(adm, 'scanImports'))));
await t('member cannot read scan imports', assertFails(getDoc(doc(a, 'scanImports', 'scan1'))));
await t('stranger cannot read scan imports', assertFails(getDoc(doc(stranger, 'scanImports', 'scan1'))));
await t('unverified admin email cannot read scan imports', assertFails(getDoc(doc(unv, 'scanImports', 'scan1'))));
await t('nobody signed out reads scan imports', assertFails(getDoc(doc(nobody, 'scanImports', 'scan1'))));
await t('admin cannot create a plain scan import', assertFails(setDoc(doc(adm, 'scanImports', 'scan2'), { scan: 'scan2', createdAt: 1, status: 'pending', fields: {} })));
await t('member cannot create a plain scan import', assertFails(setDoc(doc(a, 'scanImports', 'scan2'), { scan: 'scan2', createdAt: 1, status: 'pending', fields: {} })));
// read on the phone (30 Oct 2026): a signed-in phone creates a pending one of its own, then can't touch it
const PH = 'scan2-phone-abc1';
const phone = (by, extra = {}) => ({ scan: 'scan2', subject: 'DEMO-01', createdAt: 1, status: 'pending', via: 'phone', by, pages: [{ page: 1, accepted: true, score: 0.9 }], fields: { age: { v: '67', flags: [] } }, ...extra });
await t('member creates a pending import read on the phone', assertSucceeds(setDoc(doc(a, 'scanImports', PH), phone('phoneA'))));
await t('admin creates one read on the phone', assertSucceeds(setDoc(doc(adm, 'scanImports', 'scan3-phone-abc1'), phone('g-' + ADMIN, { scan: 'scan3' }))));
await t('…not in another phone’s name', assertFails(setDoc(doc(a, 'scanImports', 'scan2-phone-abc2'), phone('phoneB'))));
await t('…not already approved', assertFails(setDoc(doc(a, 'scanImports', 'scan2-phone-abc3'), phone('phoneA', { status: 'approved' }))));
await t('…not marked as from Firetop', assertFails(setDoc(doc(a, 'scanImports', 'scan2-phone-abc4'), phone('phoneA', { via: 'firetop' }))));
await t('…not with a review in it', assertFails(setDoc(doc(a, 'scanImports', 'scan2-phone-abc5'), phone('phoneA', { reviewedBy: ADMIN }))));
await t('…not under a Firetop-style id', assertFails(setDoc(doc(a, 'scanImports', 'scan9'), phone('phoneA'))));
await t('…not without its pages', assertFails(setDoc(doc(a, 'scanImports', 'scan2-phone-abc6'), (({ pages, ...r }) => r)(phone('phoneA')))));
await t('stranger cannot create one', assertFails(setDoc(doc(stranger, 'scanImports', 'scan2-phone-abc7'), phone('g-someone@example.com'))));
await t('signed out cannot create one', assertFails(setDoc(doc(nobody, 'scanImports', 'scan2-phone-abc8'), phone(''))));
await t('the phone cannot read it back', assertFails(getDoc(doc(a, 'scanImports', PH))));
await t('…or change it', assertFails(updateDoc(doc(a, 'scanImports', PH), { status: 'approved' })));
await t('…or overwrite it', assertFails(setDoc(doc(a, 'scanImports', PH), phone('phoneA', { createdAt: 2 }))));
await t('…or delete it', assertFails(deleteDoc(doc(a, 'scanImports', PH))));
await t('admin approves the phone’s import', assertSucceeds(updateDoc(doc(adm, 'scanImports', PH), { status: 'approved', reviewedBy: ADMIN, reviewedAt: 5 })));
await t('admin cannot change the scanned values', assertFails(updateDoc(doc(adm, 'scanImports', 'scan1'), { fields: { age: { v: '99', flags: [] } } })));
await t('admin cannot approve in someone else’s name', assertFails(review(adm, { reviewedBy: 'other@example.com' })));
await t('admin cannot set another status', assertFails(review(adm, { status: 'pending' })));
await t('member cannot approve', assertFails(review(a)));
await t('admin approves a pending import', assertSucceeds(review(adm)));
await t('an approved import cannot be changed again', assertFails(review(adm, { status: 'rejected' })));
await t('admin deletes an import', assertSucceeds(deleteDoc(doc(adm, 'scanImports', 'scan1'))));
await t('member cannot delete an import', assertFails(deleteDoc(doc(a, 'scanImports', 'scan1'))));

// email and PayNow (owner, 21 Oct 2026): the team writes, only admins read, tick and delete
const PAY = { site: 'NUH', pid: 'p1', sid: 'S-01', email: 'pt@example.com', paynow: '91234567', setAt: 1, setBy: 'AB' };
const payDoc = db => doc(db, 'payments', 'p1');
const d = anonUser('phoneD');
await t('an SGH phone joins', assertSucceeds(join(d, 'phoneD', 'SGH', 'SGH-CODE-1')));
await t('the SGH phone reads its own entry', assertSucceeds(getDoc(doc(d, 'members', 'phoneD'))));
await t('member saves email and PayNow', assertSucceeds(setDoc(payDoc(a), PAY, { merge: true })));
await t('member cannot read them back', assertFails(getDoc(payDoc(a))));
await t('member cannot list them', assertFails(getDocs(collection(a, 'payments'))));
await t('another hospital cannot read them', assertFails(getDoc(payDoc(d))));
await t('stranger cannot read them', assertFails(getDoc(payDoc(stranger))));
await t('unverified admin email cannot read them', assertFails(getDoc(payDoc(unv))));
await t('another hospital cannot write them', assertFails(setDoc(payDoc(d), { ...PAY, paynow: '80000000' }, { merge: true })));
await t('another hospital cannot create one for its own site under the id', assertFails(setDoc(doc(d, 'payments', 'p1'), { ...PAY, site: 'SGH' }, { merge: true })));
await t('member replaces them', assertSucceeds(setDoc(payDoc(a), { ...PAY, paynow: '81234567', setAt: 2 }, { merge: true })));
await t('member cannot tick Payment sent', assertFails(setDoc(payDoc(a), { paid: { t: 1, by: 'AB' } }, { merge: true })));
await t('member cannot create with a tick', assertFails(setDoc(doc(a, 'payments', 'p2'), { ...PAY, pid: 'p2', paid: { t: 1, by: 'AB' } })));
await t('member cannot move it to another hospital', assertFails(setDoc(payDoc(a), { site: 'SGH' }, { merge: true })));
await t('id and pid must match', assertFails(setDoc(doc(a, 'payments', 'p3'), PAY)));
await t('no extra fields', assertFails(setDoc(doc(a, 'payments', 'p4'), { ...PAY, pid: 'p4', nric: 'x' })));
await t('member cannot delete', assertFails(deleteDoc(payDoc(a))));
await t('an SGH phone saves for an SGH patient', assertSucceeds(setDoc(doc(d, 'payments', 'q1'), { ...PAY, site: 'SGH', pid: 'q1' }, { merge: true })));
await t('admin reads them', assertSucceeds(getDoc(payDoc(adm))));
await t('admin lists them', assertSucceeds(getDocs(collection(adm, 'payments'))));
await t('admin ticks Email sent', assertSucceeds(updateDoc(payDoc(adm), { emailSent: { t: 5, by: ADMIN } })));
await t('admin ticks Payment sent', assertSucceeds(updateDoc(payDoc(adm), { paid: { t: 6, by: ADMIN } })));
await t('a tick must be { t, by }', assertFails(updateDoc(payDoc(adm), { paid: true })));
await t('member cannot untick', assertFails(setDoc(payDoc(a), { ...PAY }, { merge: false })));
await t('admin cannot move it to another hospital', assertFails(updateDoc(payDoc(adm), { site: 'SGH' })));
await env.withSecurityRulesDisabled(async ctx => { if (!(await getDoc(doc(ctx.firestore(), 'payments', 'p1'))).data().paid) throw new Error('tick lost'); });
await t('admin deletes the email and PayNow', assertSucceeds(updateDoc(payDoc(adm), { email: deleteField(), paynow: deleteField(), cleared: { t: 7, by: ADMIN } })));
await env.withSecurityRulesDisabled(async ctx => { const d = (await getDoc(doc(ctx.firestore(), 'payments', 'p1'))).data(); if (d.email || d.paynow || !d.paid || !d.emailSent) throw new Error('not cleared as expected'); });
await t('admin deletes the entry', assertSucceeds(deleteDoc(payDoc(adm))));

// server stamps (app-sync 0.3.0, 24 Oct 2026): serverAt is optional until the backfill, and must be the server's time
await t('a new patient with serverAt = the server time', assertSucceeds(setDoc(doc(a, 'patients', 's1'), { ...pat('NUH'), id: 's1', serverAt: serverTimestamp() })));
await t('a save with serverAt = the server time', assertSucceeds(setDoc(doc(a, 'patients', 's1'), { ...pat('NUH'), id: 's1', serverAt: serverTimestamp(), f: { x: { v: 1, t: 30, by: 'AB' } } })));
await t('an older app version still saves without serverAt', assertSucceeds(setDoc(doc(a, 'patients', 's1'), { ...pat('NUH'), id: 's1', f: { x: { v: 2, t: 31, by: 'AB' } } })));
// a phone clock a minute behind (Date.now() itself could land on the server's very millisecond: then it is the server time)
await t('serverAt from the phone clock is refused', assertFails(setDoc(doc(a, 'patients', 's1'), { ...pat('NUH'), id: 's1', serverAt: Timestamp.fromMillis(Date.now() - 60000) })));
await t('serverAt as a number is refused', assertFails(setDoc(doc(a, 'patients', 's1'), { ...pat('NUH'), id: 's1', serverAt: Date.now() })));
const SL = (on, t) => ({ updatedAt: U(), serverAt: serverTimestamp(), locked: on, lock: { on, t, by: ADMIN } });
await t('admin locks with serverAt', assertSucceeds(setDoc(doc(adm, 'patients', 's1'), SL(true, 40), { merge: true })));
await t('admin unlocks with serverAt', assertSucceeds(setDoc(doc(adm, 'patients', 's1'), SL(false, 41), { merge: true })));
await t('member still cannot lock with serverAt', assertFails(setDoc(doc(a, 'patients', 's1'), SL(true, 42), { merge: true })));

// leave entries (a patient an admin locked): admins write them, the hospital's team reads them
const LV = (pid, site = 'NUH', extra = {}) => ({ id: 'patient:' + pid, kind: 'patient', data: { id: pid, updatedAt: 1234 }, deletedAt: 1235, site, updatedAt: 1235, serverAt: serverTimestamp(), ...extra });
await t('admin writes a leave entry', assertSucceeds(setDoc(doc(adm, 'leaves', 'patient:s1'), LV('s1'))));
await t('admin writes it again (a newer lock)', assertSucceeds(setDoc(doc(adm, 'leaves', 'patient:s1'), { ...LV('s1'), deletedAt: 1300 })));
await t('admin writes one without serverAt (until the backfill)', assertSucceeds(setDoc(doc(adm, 'leaves', 'patient:sgh1'), (({ serverAt, ...r }) => r)(LV('sgh1', 'SGH')))));
await t('member cannot write a leave entry', assertFails(setDoc(doc(a, 'leaves', 'patient:p1'), LV('p1'))));
await t('a leave entry under another id is refused', assertFails(setDoc(doc(adm, 'leaves', 'patient:s1'), LV('p1'))));
await t('a leave entry with extra fields is refused', assertFails(setDoc(doc(adm, 'leaves', 'patient:s1'), LV('s1', 'NUH', { f: {} }))));
await t('a leave entry with patient data is refused', assertFails(setDoc(doc(adm, 'leaves', 'patient:s1'), LV('s1', 'NUH', { data: { id: 's1', updatedAt: 1, f: {} } }))));
await t('a leave entry with a phone-clock serverAt is refused', assertFails(setDoc(doc(adm, 'leaves', 'patient:s1'), LV('s1', 'NUH', { serverAt: Timestamp.fromMillis(1) }))));
await t('member lists its hospital\'s leave entries', assertSucceeds(getDocs(query(collection(a, 'leaves'), where('site', '==', 'NUH'), where('deletedAt', '>', 0)))));
await t('member lists them by serverAt too', assertSucceeds(getDocs(query(collection(a, 'leaves'), where('site', '==', 'NUH'), where('serverAt', '>', Timestamp.fromMillis(0))))));
await t('member cannot list another hospital\'s', assertFails(getDocs(query(collection(a, 'leaves'), where('site', '==', 'SGH')))));
await t('member cannot list them all', assertFails(getDocs(collection(a, 'leaves'))));
await t('a stranger cannot read them', assertFails(getDoc(doc(b, 'leaves', 'patient:s1'))));
await t('admin lists them all', assertSucceeds(getDocs(collection(adm, 'leaves'))));
await t('member cannot delete one', assertFails(deleteDoc(doc(a, 'leaves', 'patient:s1'))));

await env.cleanup();
console.log(`prewarm rules: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
