# Configuration

Requires Node.js 24 or later. Every provider key is optional; the server starts with none. Configuration is read in [server/server.mjs](../server/server.mjs) (`KEY_NAMES`, `CONFIG_ENV`, `configFrom`), and for the Worker in [server/worker.mjs](../server/worker.mjs) and [server/guard.mjs](../server/guard.mjs). [.env.example](../.env.example) is the template.

## Running

```sh
npm start                                                  # no keys: scene, touch, emotes, rules decider
node server/server.mjs --port 8142 --env-file .env         # keys and settings from a file
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--port N` | `8142` | Listen port (1 to 65535). Binds `127.0.0.1` only, unless `--public` is used |
| `--env-file PATH` | none | Read keys and settings from a file; see [how values are loaded](#how-values-are-loaded) |
| `--public ORIGINS` | none | Public mode: bind `0.0.0.0`, accept only these comma-separated `https:` origins, apply per-day request ceilings. Cannot be combined with `--env-file` |
| `--s2-hedge-ms N` | `900` | Launch a second identical LLM request if no token has arrived after N ms (0 to 4000; 0 disables) |
| `--s2-sound-hedge-ms N` | same as `--s2-hedge-ms` | The same hedge for the short nonverbal-sound request |

Any other flag, or an invalid value, prints `server startup failed` and exits with status 1.

## Environment variables

### Provider keys

Secrets. Each is optional.

| Variable | Used for |
| --- | --- |
| `ELEVENLABS_API_KEY` | Speech-to-text token minting (`/api/stt-token`) and text-to-speech (`/api/say`). Without it both routes return `503 missing_key` |
| `OPENROUTER_API_KEY` | The LLM that writes lines, and the tier-2 decision fallback. Sent as `Authorization: Bearer` to `LLM_BASE_URL` |
| `SYSTEM_ONE_API_KEY` | Authorization for the System One endpoint. Not needed for a self-hosted endpoint |
| `TYPESAFE_API_KEY` | Fallback name for `SYSTEM_ONE_API_KEY` (the hosted Jev API's key) |

### Swappable pieces

Plain settings. Whitespace is trimmed and an empty value counts as unset.

| Variable | Default | Effect |
| --- | --- | --- |
| `LLM_MODEL` | `deepseek/deepseek-v4.1-flash` | Model id sent to the LLM for lines and the tier-2 decision |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base; the server calls `<base>/chat/completions` with streaming |
| `SYSTEM_ONE_URL` | `https://api.typesafe.ai/v1/systemone` | The decision endpoint |
| `SYSTEM_ONE_MODEL` | unset | If set, replaces the `model` field of every System One request. If unset the request carries `jev-1.14.0` |
| `ELEVENLABS_VOICE_ID` | `ocZQ262SsZb9RIxcQBOj` | Voice used by `/api/say` |
| `ELEVENLABS_TTS_MODEL` | `eleven_v4_turbo` | TTS model id. Also selects the price used by the spend guard |
| `ELEVENLABS_STT_MODEL` | `scribe_v3_live` | Realtime speech-to-text model; returned to the browser by `/api/stt-token` |
| `SYSTEM_ONE_TIMEOUT_MS` | `800` | Milliseconds before a System One call falls back to the next decider; raise for self-hosted models |

### Cloudflare Worker variables and secrets

Read only by the Worker ([DEPLOY.md](DEPLOY.md)). `ORIGINS`, `TURNSTILE_SITE_KEY` and the three limits are plain `[vars]` in [wrangler.toml](../wrangler.toml); the rest are secrets. The Worker also takes the key and setting variables above as bindings.

| Variable | Default | Effect |
| --- | --- | --- |
| `ORIGINS` | none, required | Comma-separated exact origins allowed to call the API, for example `https://mintie-mascot.<your-subdomain>.workers.dev`. No path, no trailing slash. The Worker fails to start without it |
| `TURNSTILE_SECRET_KEY` | none | Secret. Verifies Turnstile tokens and signs session cookies. Without it every paid call returns `403 human_check` |
| `TURNSTILE_SITE_KEY` | `""` | Public site key, returned by `/api/health` as `turnstile`. If empty, the browser skips the human check and paid calls are refused |
| `IP_SALT` | falls back to `TURNSTILE_SECRET_KEY` | Secret. Salt for the IP hash that keys the ledger and binds the cookie |
| `DAILY_USD` | `5` | Global spend ceiling per UTC day, in USD |
| `IP_USD` | `0.25` | Per-IP spend ceiling per UTC day, in USD |
| `IP_SESSIONS` | `15` | Per-IP voice sessions (`/api/stt-token` calls) per UTC day |

Non-numeric values for the three limits fall back to the defaults.

### Tooling

| Variable | Used by | Effect |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | [tools/cf.mjs](../tools/cf.mjs) | Credentials for the deploy helper. Use a scoped API token |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `npm run check` | Path to a Chromium to use instead of Playwright's download |

## How values are loaded

This differs by run mode and is a common source of "my key is ignored".

| Mode | Where provider keys come from | Where settings come from |
| --- | --- | --- |
| `npm start` (no flags) | Nowhere. Keys are **not** read from the process environment | The process environment |
| `--env-file PATH` | The file only | The file, overridden by the process environment |
| `--public ORIGINS` | The process environment only (host secrets, or Node's `node --env-file=.env` loader) | The process environment |
| Cloudflare Worker | Worker secrets | Worker vars and secrets |

The env-file parser reads only the four key names and the seven settings above. It accepts simple `NAME=value` lines, trims the value and strips one pair of matching outer quotes. There is no `export`, no interpolation, no escapes, no multi-line values and no inline comments. Other lines are ignored. Never commit a `.env` file; it is git-ignored.

Public mode with a file loaded by Node:

```sh
node --env-file=.env server/server.mjs --port 8080 --public https://your-origin.example
```

## What each key turns on

`GET /api/health` reports what is available: `{ok, stt, react, say, decider}`.

| Configured | `stt` | `say` | `react` | `decider` |
| --- | --- | --- | --- | --- |
| nothing | false | false | false | `rules` |
| `OPENROUTER_API_KEY` | false | false | true | `llm` |
| `SYSTEM_ONE_API_KEY` only | false | false | false | `system-one` |
| `ELEVENLABS_API_KEY` only | true | true | false | `rules` |
| ElevenLabs and OpenRouter | true | true | true | `llm` |
| all three | true | true | true | `system-one` |

`react` means "an LLM is configured": a key, or any `LLM_BASE_URL` other than the default. `decider` is the first tier of the [decider chain](ARCHITECTURE.md#the-decider-chain) that is switched on; it can still fall through at request time. The browser enables voice only when `stt`, `say` and `react` are all true, and it only sends touch and speech turns to the server when `react` is true. System One alone therefore changes nothing in the browser; it improves decisions once an LLM is present.

## Validation

Settings are validated at startup. A bad value makes `createApp` throw `invalid_config`, and the process prints `server startup failed` and exits.

| Setting | Rule |
| --- | --- |
| `LLM_BASE_URL`, `SYSTEM_ONE_URL` | A parseable URL. `https:` anywhere; `http:` only for `localhost`, `127.0.0.1` or `[::1]` |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL` | 1 to 64 characters from `A-Z a-z 0-9 . _ : -`. These end up in URLs, so a path or query is rejected |
| `SYSTEM_ONE_TIMEOUT_MS` | An integer from 100 to 30000 |
| `LLM_MODEL` | 1 to 80 characters from `A-Z a-z 0-9 _ . / : @ -` |
| `SYSTEM_ONE_MODEL` | If set, 1 to 80 characters |
| `--public` origins | Each an exact origin (no path), `https:`. `http:` is accepted only for `localhost` and `127.0.0.1` |
| `--s2-hedge-ms`, `--s2-sound-hedge-ms` | A finite number from 0 to 4000 |

## Running a local OpenJev

[OpenJev](https://huggingface.co/openjev/openjev) is an open-weights model that serves the same `/v1/systemone` contract. Its weights are licensed CC BY-NC 4.0 (non-commercial). Follow the model card to serve it; its examples use `http://localhost:3000/v1/systemone` and `"model": "openjev"`. Then:

```sh
SYSTEM_ONE_URL=http://127.0.0.1:3000/v1/systemone
SYSTEM_ONE_MODEL=openjev
# no SYSTEM_ONE_API_KEY needed
```

Put those lines in `.env` and run with `--env-file .env`, or export them before `npm start`.

- A non-default `SYSTEM_ONE_URL` switches tier 1 on without a key. Loopback `http:` is allowed.
- Set `SYSTEM_ONE_MODEL`, or Mintie will send the hosted model name `jev-1.14.0`.
- **Timeout.** Each System One call has an 800 ms limit by default. Raise it with `SYSTEM_ONE_TIMEOUT_MS` (100–30000; for example `3000` for a local OpenJev). A slower decision also delays Mintie's first reaction. If your hardware still cannot meet it, every turn falls through to tier 2 or 3. Open `?debug` and check the `decider` chip and the `ms` figure.
- **Option count.** The OpenJev model card states a limit of 52 options per question, and Mintie's `animation` question lists 65 (64 gestures and `null`). If your server rejects or truncates that question, tier 1 will fall through on every turn. Check against the model card and your server before relying on it. This repository's tests do not run against OpenJev.
- With nothing else configured, the speech path still needs an LLM and ElevenLabs; see [what each key turns on](#what-each-key-turns-on).

## Using another LLM endpoint

Set `LLM_BASE_URL` (and `LLM_MODEL`, and a key if it needs one). The server posts OpenAI-style chat completions with `stream: true`. The request also carries OpenRouter-style `provider` and `reasoning` fields and, for the tier-2 decision, a strict `json_schema` response format. A server that rejects unknown fields will fail those calls; tier 2 falls through and lines will not be written. The `usage` accounting field is added only for hosts under `openrouter.ai`.

## Optional checks

`npm test` needs no provider access. `npm run check` needs a Chromium; see [CONTRIBUTING.md](../CONTRIBUTING.md). It uses synthetic media, does not load `.env` and blocks provider requests.
