# Deploying to Cloudflare Workers

This guide self-hosts Mintie on a Cloudflare Worker at a `workers.dev` address, with the spend guard in front of the paid routes. Read [the hosted guard](ARCHITECTURE.md#hosted-guard) first for what the guard does and does not cover.

Deploying changes remote infrastructure and the paid providers bill you. Nothing here is required to run Mintie locally.

## What gets deployed

[wrangler.toml](../wrangler.toml) defines:

- **Static assets.** `tools/cf-build.mjs` runs as the build command. It copies `web/` and Three.js's two ES modules into `.cf/assets` and writes a `_headers` file with the same [CSP](../SECURITY.md#content-security-policy) the Node server sends.
- **The Worker.** [server/worker.mjs](../server/worker.mjs) handles `/api/*` (`run_worker_first = ["/api/*"]`). It runs the same `createApp` as the Node server through the `node:http` bridge, behind [server/guard.mjs](../server/guard.mjs).
- **A Durable Object**, `Budget`, with SQLite storage. One global instance holds the USD-per-day counter and every per-IP row.
- No routes or custom domains. A deploy goes to `workers.dev` only. Attaching a domain is a separate, deliberate step in your own account.

## Prerequisites

- A Cloudflare account, with a `workers.dev` subdomain registered (Workers and Pages, Overview).
- Node.js 24 or later. The helper and commands below run Wrangler 4 through `npx`.
- Keys for [ElevenLabs](https://elevenlabs.io/), [OpenRouter](https://openrouter.ai/) and a System One endpoint ([docs.typesafe.ai](https://docs.typesafe.ai), or your own server; see [CONFIGURATION.md](CONFIGURATION.md)). A Worker cannot reach a model on your laptop's loopback, so a self-hosted decision model must be reachable over `https:`.

## Provider-side spend limits

**Create dedicated provider keys for the deployment and set a hard spend limit on each, in the provider's dashboard.** Do this before the first deploy. The guard is a best-effort limit, not a billing control:

- Speech-to-text audio goes from the browser directly to ElevenLabs. The server only mints the token, so it cannot meter STT seconds. The guard reserves five minutes of audio per `/api/stt-token` call. A modified client can keep a session open much longer than that on one token. Only ElevenLabs sees the real usage.
- Other cost estimates use a built-in price table (`PRICES` in `server/guard.mjs`), which can go stale. Provider-reported cost is used when the provider sends it.
- A request reserves an estimate and settles to the actual cost afterwards, so the actual cost of a request can exceed its reservation.

A key shared with other projects, or with no limit, makes the guard's `DAILY_USD` the only protection. Do not rely on that.

## Steps

### 1. Pick the Worker name and origin

`name` in `wrangler.toml` is `mintie-mascot`. The deployed address is:

```
https://mintie-mascot.<your-subdomain>.workers.dev
```

### 2. Set the variables

Edit the `[vars]` block of `wrangler.toml`:

```toml
[vars]
ORIGINS = "https://mintie-mascot.<your-subdomain>.workers.dev"
TURNSTILE_SITE_KEY = ""        # filled in at step 3
DAILY_USD = "5"
IP_USD = "0.25"
IP_SESSIONS = "15"
```

| Variable | Meaning |
| --- | --- |
| `ORIGINS` | Comma-separated exact origins allowed to call `/api`. Must contain your own `workers.dev` origin. Replace whatever the file shipped with; entries that are not yours are origins you are allowing to spend your budget |
| `TURNSTILE_SITE_KEY` | The public Turnstile site key (not secret) |
| `DAILY_USD` | Global ceiling in USD per UTC day, across all visitors |
| `IP_USD` | Ceiling per visitor IP per UTC day |
| `IP_SESSIONS` | Voice sessions per visitor IP per UTC day |

Choose ceilings that you would be content to lose in a day, and keep them at or below the provider-side limits above.

### 3. Create the Turnstile widget

In the Cloudflare dashboard, Turnstile, add a widget:

- Hostname: `mintie-mascot.<your-subdomain>.workers.dev` (and any other hostname you serve from).
- Widget mode: Managed. The client renders it with `appearance: 'interaction-only'`, so most visitors see nothing.

Copy the **site key** into `TURNSTILE_SITE_KEY` in `wrangler.toml`. Keep the **secret key** for the next step. Without a site key the browser skips the human check and the paid routes answer `403 human_check`; without the secret key the guard cannot verify anything.

### 4. Set secrets

Secrets go in on **stdin**, never as command-line arguments (arguments show up in process listings and shell history). Write a JSON file readable only by you, outside the repository, and feed it to `wrangler secret bulk`:

```sh
umask 077
cat > "$HOME/mintie-secrets.json" <<'EOF'
{
  "ELEVENLABS_API_KEY": "...",
  "OPENROUTER_API_KEY": "...",
  "SYSTEM_ONE_API_KEY": "...",
  "TURNSTILE_SECRET_KEY": "...",
  "IP_SALT": "<a long random string>"
}
EOF
npx --yes wrangler@4 secret bulk < "$HOME/mintie-secrets.json"
shred -u "$HOME/mintie-secrets.json" 2>/dev/null || rm -P "$HOME/mintie-secrets.json"
```

Omit `SYSTEM_ONE_API_KEY` if your decision endpoint needs none (and set `SYSTEM_ONE_URL`, see below). `IP_SALT` is optional; if unset, the Turnstile secret is used as the salt. Use `TYPESAFE_API_KEY` instead of `SYSTEM_ONE_API_KEY` if you prefer that name.

Settings such as `SYSTEM_ONE_URL`, `SYSTEM_ONE_MODEL`, `LLM_MODEL`, `LLM_BASE_URL`, `ELEVENLABS_VOICE_ID` and the model ids are plain variables; add them to `[vars]`. See [CONFIGURATION.md](CONFIGURATION.md#cloudflare-worker-variables-and-secrets).

The repository helper reads `.env` and pipes the four provider keys to `wrangler secret bulk` on stdin for you:

```sh
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node tools/cf.mjs --env-file .env secrets
```

It does not set `TURNSTILE_SECRET_KEY` or `IP_SALT`; add those with the command above. Use a scoped API token rather than a global key.

### 5. Deploy

```sh
npx --yes wrangler@4 deploy
```

Or through the helper: `node tools/cf.mjs --env-file .env wrangler deploy`. The first deploy creates the Durable Object class from the `v1` migration.

### 6. Check

```sh
curl -s https://mintie-mascot.<your-subdomain>.workers.dev/api/health
```

Expect `{"ok":true,"stt":true,"react":true,"say":true,"decider":"system-one","turnstile":"<site key>"}`. A missing field points at a missing secret or variable; see [what each key turns on](CONFIGURATION.md#what-each-key-turns-on). Then open the page and press Talk. The first press runs the Turnstile challenge.

For debugging, append `?debug` to the URL. The overlay's health flags show the human-check state and, after a limit is hit, the resting reason.

## Operating

- **Limits users see.** Over `IP_USD` or `IP_SESSIONS`: `429 ip_limit`, shown as a short rest, retried after a minute. Over `DAILY_USD`: `429 daily_limit`, and the page stops offering voice until reload. Touch and emotes keep working.
- **Logs.** `observability` is enabled. The server logs JSON lines for provider usage (token and character counts), decisions and timings. Raw IPs are not logged. Transcripts are not logged by the server.
- **Rotation.** Rotate a key at the provider, then `wrangler secret bulk` again. If a key leaks, rotate it at once; see [SECURITY.md](../SECURITY.md).
- **Custom domains.** If you attach one, add its origin to `ORIGINS` and its hostname to the Turnstile widget.
- **Removing.** `npx wrangler@4 delete` removes the Worker; delete the Turnstile widget and revoke the provider keys separately.

## Without Cloudflare

The Node server has a `--public` mode for a host you run yourself, with in-memory per-day request ceilings and no human check or USD ledger. It is weaker than the Worker guard; see [CONFIGURATION.md](CONFIGURATION.md#running) and [SECURITY.md](../SECURITY.md#the-guard-model).
