# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on the repository page, Security, then "Report a vulnerability" (a private advisory). Do not open a public issue for a vulnerability. Never post credentials or private recordings in any issue.

Useful reports include the route or file, the request that triggers the problem and the impact. Reports about a leaked key, a way around the guard, or a way to make the server spend provider money without limit are all in scope.

## Keys stay on the server

- Provider keys (`ELEVENLABS_API_KEY`, `OPENROUTER_API_KEY`, `SYSTEM_ONE_API_KEY`, `TYPESAFE_API_KEY`) are read by the server or Worker only and are never sent to the browser or bundled into client code.
- The browser receives a **single-use ElevenLabs token** from `/api/stt-token` and sends microphone audio directly to ElevenLabs. The server rejects a token that contains any configured key before returning it.
- Model output that contains a configured key is rejected before it is spoken or displayed, and keys are redacted by the deploy helper's output.
- `.env` files are git-ignored. `node tools/secret-scan.mjs` scans tracked and unignored files for key-shaped strings and for the values of keys in your environment.
- Rotate any key that may have been exposed.

## The guard model

Browser `Origin` checks stop casual cross-site use; they are **not user authentication**. A public deployment needs more:

- **Hosted Worker** ([server/guard.mjs](server/guard.mjs)): Origin allowlist (`ORIGINS`), a Cloudflare Turnstile challenge exchanged for a 30-minute `__Host-` session cookie (HttpOnly, Secure, SameSite=Strict, signed with HMAC-SHA-256 and bound to a salted hash of the client IP), per-IP USD and voice-session limits, and a global USD-per-day ledger in a Durable Object. Raw IPs are not stored or logged. Details: [ARCHITECTURE.md](docs/ARCHITECTURE.md#hosted-guard).
- **Node `--public` mode**: an Origin allowlist and in-memory per-day request ceilings per route. No human check, no per-visitor limit, counters reset on restart. Put it behind something that authenticates or rate-limits if it is exposed.
- **Both**: request bodies are size-limited (32 KB) with a read deadline, every field is validated before use, routes have timeouts and rate limits, and static file serving rejects dotfiles, backslashes and paths that resolve outside the web root.
- **Limits of the guard.** The server cannot meter speech-to-text audio, which goes from the browser to ElevenLabs. The guard reserves a fixed five minutes per voice session, and a modified client can exceed that on one token. Use dedicated provider keys with provider-side hard spend limits; see [DEPLOY.md](docs/DEPLOY.md#provider-side-spend-limits). Request ceilings do not bound all provider costs.

## Memory and privacy

- Mintie's memory (a name and up to eight short facts) is stored in the visitor's browser (`localStorage`) and sent with each request. The server stores nothing about it. A visitor can clear it with the "Forget me" button in the `?debug` overlay or by clearing site data.
- Memory is validated at the server boundary, extracted by pattern matching rather than a model, and only ever placed in the user-message data, never in a system prompt. This reduces, but does not eliminate, prompt-injection risk. Names are never treated as authentication.
- **Third parties see conversations.** Microphone audio goes to ElevenLabs. Transcripts, recent history, scene, mood and memory go to the configured decision model and LLM provider, and Mintie's lines go to ElevenLabs for speech. Obtain consent from anyone you record and review those providers' retention policies.
- The microphone is requested only after a user gesture (the Talk button) and released when the call ends. The browser limits a call to 15 minutes.
- **Traces.** The optional `?trace=1` client trace can include transcripts (`?trace=text`) and audio timing. `?debug` shows decisions and memory on screen. Do not share either from a session that includes other people's speech.

## Content Security Policy

The server and the Worker send the same policy (`CSP` in [server/server.mjs](server/server.mjs)), along with `X-Content-Type-Options: nosniff`:

```
default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' wss://api.elevenlabs.io; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'
```

Scripts load only from the app's own origin and Turnstile; there is no inline script. The only third-party connection from the page is the ElevenLabs realtime socket. `style-src` allows inline styles. If you add a provider the browser must call directly, extend `connect-src` deliberately.
