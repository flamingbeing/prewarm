# Notes

Lasting rules, owner preferences and lessons (never task chatter), and how to test. The app's own notes are in
`prewarm/NOTES.md`.

- Moved from anawj-site on 21 Oct 2026 (repo split, no history). anawj-site is now the landing site and keeps
  only the old-address forward in `prewarm/`; change the app only here.
- Tests import JSZip from `prewarm/js/vendor/jszip.min.js`; `prewarm/js/vendor/package.json` marks that folder as
  CommonJS so Node can load it (this repo's `package.json` says `"type": "module"`).
- The service worker's SHELL lists the design kit's `tokens.css` by full address; `tools/check.mjs` and
  `tools/stamp-versions.mjs` skip such entries.
- Rules deploy: `.github/workflows/deploy-firestore-rules.yml` signs in to Google Cloud with GitHub's OIDC token
  (Workload Identity Federation, provider `github/prewarm-repo` in project `prewarm-study`, only this repo) as
  `firebase-rules-deployer@prewarm-study.iam.gserviceaccount.com` (Firebase Rules Admin only). No key is stored.
- Local Worker check: `npx wrangler@4 dev --local --port 8799` treats requests as prewarmstudy.anawj.com; curl real
  paths. `/scan-api/` answers 503 there (no settings locally).
