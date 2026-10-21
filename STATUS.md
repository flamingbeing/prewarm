# Status

## Now
- Moved from anawj-site (21 Oct 2026). Code, tests and Worker are here; prewarmstudy.anawj.com is still served by the
  old Worker until the cut-over.

## Waiting on the owner
- Cut-over: connect this repo to the `prewarm` Worker in Workers Builds (build command
  `node tools/stamp-versions.mjs`, deploy command `npx wrangler deploy`) and move prewarmstudy.anawj.com off the old
  Worker, when no case is being collected.
- The scan relay's service token (`SCAN_CLIENT_ID`, `SCAN_CLIENT_SECRET`) on the `prewarm` Worker.
- The rules deployer's sign-in permission (Workload Identity User on the service account), then the rules workflow
  gets its push trigger.

## Next (in order)
1. After the cut-over: check sign-in, a scan upload and the update helper on prewarmstudy.anawj.com.
2. Add the push trigger to the rules workflow once a manual run passes.

## Recently done
- 21 Oct 2026: imported from anawj-site; all prewarm tests pass here.

## Decisions (dated, one line each)
- 21 Oct 2026: rules deploy uses keyless OIDC sign-in, not a stored service-account key.
