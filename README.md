# prewarm

The prewarming study app, served at **prewarmstudy.anawj.com** by this repo's Cloudflare Worker.

- `prewarm/`: the app (a phone web app with offline storage and Firebase sync). Start with `prewarm/README.md`.
- `prewarm-update/`: the "won't update" helper page for phones still on an old copy.
- `worker/`: the Worker. `routes.js` maps the host to `prewarm/`; `scan.js` relays scan photos to the study computer
  behind Cloudflare Access.
- `tools/`: repo checks, version stamping, proof-reading, and the test scripts.

Checks before merging are in [AGENTS.md](AGENTS.md).
