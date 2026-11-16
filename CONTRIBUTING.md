# Contributing

## Set up

Node.js 24 or later.

```sh
npm ci
npm test         # node --test test/*.test.mjs; no keys, no network
```

CI runs `npm test` on Node 24 and 26.

## Browser checks

```sh
npx playwright install chromium    # or point at an existing browser:
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium
npm run check                      # node tools/check.mjs --quick
```

`npm run check` starts the server with no keys and synthetic media, blocks provider requests and drives the real page in headless Chromium. It writes screenshots to `tmp/renders/` and reports to `tools/artifacts/`, both git-ignored. It is not part of CI.

## Style

- Terse. Short names, few comments, no wrappers for a single use. Prefer the standard library and platform features over a new dependency; `three` is the only runtime dependency.
- A comment starting with `ponytail:` marks a deliberate simplification and names its ceiling and the upgrade path. Keep that format when you cut a corner on purpose, and do not remove one without meeting the ceiling.
- Validate input at trust boundaries (request bodies, provider responses, anything from the browser). Never put provider keys, transcripts or raw IPs in logs.
- Memory and state are data, never instructions: do not move them into a system prompt.
- Non-trivial logic gets a test in `test/*.test.mjs`, written with `node:test` and `node:assert`. Tests must not call a provider.
- Docs make claims that can be checked against the code. Cite the file. Do not add numbers you have not measured.

## Pull requests

- One change per pull request, with a short description of what changed and why.
- `npm test` passes. Run `npm run check` if you touched rendering, audio, voice or the page.
- Update the docs that describe the behaviour you changed, for example the frame table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) or the variables in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
- Do not commit keys, `.env` files, recordings of people or generated output. `node tools/secret-scan.mjs` checks for key-shaped strings.
- Report security problems privately; see [SECURITY.md](SECURITY.md).
