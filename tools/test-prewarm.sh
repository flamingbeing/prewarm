#!/bin/bash
# Every check the prewarming app needs before merging, in one go (fake data only, about 1½ minutes):
#   tools/test-prewarm.sh
# Repo check and unit tests first, then the browser tests (e2e, edge, gaps, full case, scan) side by side; each one's
# output goes to $OUT and the tail is shown if it fails. Starts a static server on port 8080 if none is running.
# The two-phone sync test (tools/test-prewarm-sync.sh) and the rules (tools/test-rules.sh) are run on their own.
set -u
cd "$(dirname "$0")/.."
OUT="${E2E_OUT:-${TMPDIR:-/tmp}/prewarm-tests}"; mkdir -p "$OUT"
fail=0
if ! curl -s -o /dev/null http://localhost:${PORT:-8080}/prewarm/; then
  python3 -m http.server ${PORT:-8080} >/dev/null 2>&1 & SERVER=$!; trap 'kill $SERVER 2>/dev/null' EXIT; sleep 1
fi
start=$(date +%s)
node tools/check.mjs || fail=1
for f in prewarm/test/*.test.mjs; do node "$f" || fail=1; done
# browser tests in parallel; a hung one is stopped after 10 minutes
pids=()
for t in e2e edge.e2e gaps.e2e fullcase.e2e scan.e2e scan-live.e2e scan-burst.e2e; do
  timeout -s KILL 600 node "prewarm/test/$t.mjs" >"$OUT/$t.txt" 2>&1 & pids+=("$!:$t")
done
for pt in "${pids[@]}"; do
  if wait "${pt%%:*}"; then tail -1 "$OUT/${pt#*:}.txt" | cut -c1-100
  else echo "FAIL ${pt#*:} (full output: $OUT/${pt#*:}.txt)"; grep -v '^\s*at ' "$OUT/${pt#*:}.txt" | tail -8 | cut -c1-300; fail=1; fi
done
echo "$( [ $fail = 0 ] && echo 'all prewarm checks passed' || echo 'SOME PREWARM CHECKS FAILED' ) in $(( $(date +%s) - start ))s"
exit $fail
