// One-off: stamp serverAt (the server's time) on every patient and leave entry that has none, so phones can later read
// only what changed by the server's clock (app-sync 0.3.0 server stamps, 24 Oct 2026). Dry run by default: prints
// counts and changes nothing. Run with the Admin SDK and credentials from the environment
// (GOOGLE_APPLICATION_CREDENTIALS or gcloud's), never a key in this repo:
//   npm install --prefix /tmp/bf firebase-admin@12 && NODE_PATH=/tmp/bf/node_modules node tools/backfill-server-at.mjs           # counts only
//   ... node tools/backfill-server-at.mjs --write          # stamps them (the owner's go first)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 ... --project demo-prewarm --write   # try it on the emulator
// Only serverAt is written: updatedAt stays (conflict checks and leave entries compare it), so phones listening by
// updatedAt hear nothing. Prints only counts: no patient data.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const write = args.includes('--write');
const projectId = args[args.indexOf('--project') + 1] && args.includes('--project') ? args[args.indexOf('--project') + 1] : 'prewarm-study';
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore();

const unstamped = async coll => (await db.collection(coll).get()).docs.filter(d => d.get('serverAt') == null);
let left = 0;
for (const coll of ['patients', 'leaves']) {
  const snap = await db.collection(coll).get();
  const missing = snap.docs.filter(d => d.get('serverAt') == null);
  console.log(`${projectId} ${coll}: ${snap.size} documents, ${missing.length} without serverAt${write ? '' : ' (dry run: nothing changed; --write to stamp)'}`);
  if (!write || !missing.length) { left += missing.length; continue; }
  // batches of 400; update() touches only serverAt, so a phone's save landing meanwhile is kept
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch();
    for (const d of missing.slice(i, i + 400)) batch.update(d.ref, { serverAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  const after = (await unstamped(coll)).length;
  left += after;
  console.log(`${coll}: stamped ${missing.length}; ${after} left without serverAt`);
}
process.exitCode = write && left ? 1 : 0;
