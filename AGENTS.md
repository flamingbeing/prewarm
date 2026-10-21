# prewarm

Instructions for every AI assistant working here (Claude Code reads this through `CLAUDE.md`).

The prewarming study app (`prewarm/`) at prewarmstudy.anawj.com: the study team records each patient's warming,
temperatures and readings on their phones, synced through Firebase (project `prewarm-study`). Moved here from
anawj-site in the repo split (21 Oct 2026); the app's own notes are in `prewarm/` (`NOTES.md`, `PLAN.md`, `RUNBOOK.md`,
`STATUS.md`, `docs/`).

## Public here, private elsewhere

Anything merged here is public. Keep only code, docs, general rules and **made-up** sample data. Never commit
secrets, tokens, personal data, real names or patient details. Private notes belong in the owner's private notes
repo; never copy anything from there into this repo, a PR or an issue (neutral pointers like "ask the owner" are fine).

## Rules that bite

- **Vital app (live study data):** full tests before merging (below), and nothing merged while the owner says a case
  is being collected. Fake data only in tests and screenshots.
- The service worker's `VERSION` stays plain (`prewarm-vN`); the Workers Builds build command stamps it per deploy
  (`node tools/stamp-versions.mjs`). Don't commit a stamped one.
- The design kit loads from `https://design.anawj.com/v1/` (another repo); don't copy it in.
- `worker/scan.js` relays scan photos to the study computer behind Cloudflare Access. Its settings (`ACCESS_TEAM`,
  `SCAN_ACCESS_AUD`, `SCAN_ORIGIN`, `SCAN_CLIENT_ID`, `SCAN_CLIENT_SECRET`) live in the Cloudflare dashboard, never here.
- Firestore rules are in `prewarm/firestore.rules`; `.github/workflows/deploy-firestore-rules.yml` deploys them
  with its own service account (keyless, GitHub's OIDC sign-in). Run the rules tests before changing them.

## Checks before merging

```
node tools/check.mjs        # repo checks + Worker tests (CI runs this and the unit tests)
node tools/proofread.mjs    # page and doc mistakes
tools/test-prewarm.sh       # unit tests + the six browser tests (~2 min; needs PLAYWRIGHT_PATH, CHROMIUM_PATH)
tools/test-rules.sh         # Firestore rules in the emulator (needs Java)
tools/test-prewarm-sync.sh  # two phones through the emulators (needs Java; tools from test-rules.sh)
```

## Working with the owner

- Instructions mostly come from a phone. Work through a request to the end; ask only when a decision is genuinely
  the owner's. When asked to plan, plan and wait.
- Keep each PR small and finished on its own. Start PR titles with the app: "<App>: …".
- Merge your own PRs once the checks pass, then report with the PR link (merge by the number the PR creation
  returned). After opening a PR, call `unsubscribe_pr_activity` at once: each PR event re-sends the whole context.
- Push once per finished step, not after every small commit (limited build minutes).
- Each app keeps `NOTES.md` (lasting decisions, how to test) and `STATUS.md` (now, waiting on the owner, next,
  dated decisions). Read them before starting; update them when a task finishes. Cheap end of session: `quick-save`.
- Plain words, short; explain technical terms briefly the first time.

## Token savers

- One repo per session: `.claude/settings.json` is only read when a session has exactly one repo attached.
- `.claude/settings.json` denies reading `__/` and `vendor/` folders. Add generated files and very large files to its
  `deny` list (edit their build scripts instead), and say so here. Ask the owner if one is really needed.
- Run only the touched app's tests while iterating and the full run once before merge. Screenshots only for visual
  changes (one, viewport-sized); debug logic with text.
