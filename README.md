# Mintie

Mintie is a talking slime-blob companion built with Three.js and realtime voice.

## Get started

Requires Node.js 24 or later and npm.

```sh
npm ci
npm start
```

Open <http://127.0.0.1:8142/>. Without keys, rendering, touch, emoji and the playtest work; voice does not. For voice, configure your own keys as described in the [configuration guide](docs/CONFIGURATION.md):

```sh
cp .env.example .env
# Edit .env locally; never commit credentials.
node server/server.mjs --port 8142 --env-file .env
```

Talk requests microphone permission and starts a call; use End to stop it. Provider requests can incur charges.

```sh
npm test       # local unit tests
npm run check  # browser checks; see configuration guide for browser setup
```

The browser app communicates with the Node server or Cloudflare Worker for voice services. See [SOUL](SOUL.md) and [security](SECURITY.md). Contributions are welcome; run the relevant checks and describe your changes in a pull request.

Source code is licensed under [MIT](LICENSE). Bundled MP3 recordings are excluded from that grant; redistribution rights are unverified. Third-party software retains its own license.
