#!/bin/bash
# Firestore rules tests for prewarm/firestore.rules in the local emulator, with fake
# accounts and the demo project "demo-prewarm": nothing reaches the live Firebase projects and no sign-in is needed.
# Needs Java. The test tools install on first use (below), once per machine, into ~/.cache/anawj-rules.
set -u
cd "$(dirname "$0")/.."
TOOLS="${RULES_TOOLS:-$HOME/.cache/anawj-rules}"
if [ ! -x "$TOOLS/node_modules/.bin/firebase" ]; then
  echo "Installing the emulator test tools into $TOOLS (once)…"
  npm install --silent --prefix "$TOOLS" firebase-tools@13 @firebase/rules-unit-testing firebase || exit 1
fi
# the test files import the packages by name: link them in for the run only
made_link=0
if [ ! -e node_modules ]; then ln -s "$TOOLS/node_modules" node_modules; made_link=1; fi
cfg="$(mktemp -d)/firebase.json"
echo '{ "firestore": { "rules": "prewarm/firestore.rules" }, "emulators": { "firestore": { "port": 8085, "host": "127.0.0.1" }, "ui": { "enabled": false } } }' > "$cfg"
"$TOOLS/node_modules/.bin/firebase" emulators:exec --config "$cfg" --only firestore --project demo-prewarm \
  "cd prewarm && node test/rules.emulator.mjs" 2>&1 | grep -E 'checks passed|^FAIL|^Error:' ; rc=${PIPESTATUS[0]}
[ $made_link = 1 ] && rm -f node_modules
exit $rc
