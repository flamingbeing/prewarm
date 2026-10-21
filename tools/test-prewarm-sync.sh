#!/bin/bash
# Prewarming app: two phones sharing a patient through the local Firestore and Auth emulators (fake data, demo
# project "demo-prewarm"; never the live project). Needs Java, the emulator tools (see tools/test-rules.sh) and a
# static server on the repo root at port 8080 (python3 -m http.server 8080). SHOTS=<dir> saves screenshots.
set -u
cd "$(dirname "$0")/.."
TOOLS="${RULES_TOOLS:-$HOME/.cache/anawj-rules}"
# the emulator reads the rules path relative to the config file, so the config sits in the repo root for the run
cfg="firebase.prewarm-sync.json"
echo '{ "firestore": { "rules": "prewarm/firestore.rules" }, "emulators": { "firestore": { "port": 8085, "host": "127.0.0.1" }, "auth": { "port": 9099, "host": "127.0.0.1" }, "ui": { "enabled": false } } }' > "$cfg"
"$TOOLS/node_modules/.bin/firebase" emulators:exec --config "$cfg" --only firestore,auth --project demo-prewarm \
  "node prewarm/test/sync.emulator.mjs" 2>&1 | grep -E "prewarm sync|Error|FAIL|assert|at file|waiting" ; rc=${PIPESTATUS[0]}
rm -f "$cfg" firebase-debug.log firestore-debug.log
exit $rc
