// One-off: stamp updatedAt (ms) on every patient that has none, so the sync engine's phones can listen only for what
// changed (app-sync, 24 Oct 2026). Dry run by default: prints counts and changes nothing. Run with the Admin SDK and
// credentials from the environment (GOOGLE_APPLICATION_CREDENTIALS or gcloud's), never a key in this repo:
//   npm install --prefix /tmp/bf firebase-admin@12 && NODE_PATH=/tmp/bf/node_modules node tools/backfill-updated-at.mjs           # counts only
//   ... node tools/backfill-updated-at.mjs --write          # stamps them (the owner's go first)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 ... --project demo-prewarm --write   # try it on the emulator
// Prints only counts: no patient data.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const write = args.includes('--write');
const projectId = args[args.indexOf('--project') + 1] && args.includes('--project') ? args[args.indexOf('--project') + 1] : 'prewarm-study';
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore();

const snap = await db.collection('patients').get();
const missing = snap.docs.filter(d => typeof d.get('updatedAt') !== 'number');
console.log(`${projectId}: ${snap.size} patients, ${missing.length} without updatedAt${write ? '' : ' (dry run: nothing changed; --write to stamp)'}`);
if (write && missing.length) {
  const now = Date.now();
  // batches of 400; update() touches only updatedAt, so a phone's save landing meanwhile is kept
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch();
    for (const d of missing.slice(i, i + 400)) batch.update(d.ref, { updatedAt: now });
    await batch.commit();
  }
  const after = (await db.collection('patients').get()).docs.filter(d => typeof d.get('updatedAt') !== 'number').length;
  console.log(`stamped ${missing.length}; ${after} left without updatedAt`);
}
