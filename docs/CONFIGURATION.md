# Configuration

Requires Node.js 24 or later. For local voice, copy `.env.example` to `.env`, fill in all four keys, then run:

```sh
node server/server.mjs --port 8142 --env-file .env
```

| Variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Speech recognition |
| `ELEVENLABS_API_KEY` | Speech synthesis |
| `OPENROUTER_API_KEY` | Text generation |
| `TYPESAFE_API_KEY` | Perception and decisions |

Without keys, `npm start` supports rendering, touch, emoji and playtest, but not voice. No `.env` is loaded automatically. The app's `--env-file` reads only these four keys and does not merge process environment variables. It accepts simple `NAME=value` lines, trimming value whitespace and matching outer quotes; no `export`, interpolation, escapes, multiline values or inline comments. Never commit credentials.

Models and voice settings are code constants in [the server](../server/server.mjs) and [Worker](../server/worker.mjs), not environment settings.

## Public hosting

`--public https://your-origin.example` binds all interfaces, checks origins and applies daily ceilings. **The app rejects combining `--public` with its own `--env-file`.** Set the four provider keys in the process environment, using your host's secret store or Node's loader before the script name:

```sh
node --env-file=.env server/server.mjs --port 8080 --public https://your-origin.example
```

Origins can be comma-separated. Public mode is not user authentication; read [security](../SECURITY.md) before exposing a paid backend. Node budgets are in memory per process.

The Cloudflare Worker uses the same four secret bindings, comma-separated `ORIGINS`, and the `BUDGET` Durable Object binding in [wrangler.toml](../wrangler.toml). Review deployment settings before deploying. The optional helper uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the process environment or an explicitly supplied file; process values take precedence. Use a scoped API token, not a global API key.

```sh
node tools/cf.mjs --env-file .env secrets
node tools/cf.mjs --env-file .env wrangler deploy
```

Deployment changes remote infrastructure and may incur charges.

## Optional checks

`npm test` needs no provider access.

For `npm run check`, install Chromium with `npx playwright install chromium`, or export `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible browser. The browser check does not load `.env`; it uses synthetic media and blocks external provider requests.
