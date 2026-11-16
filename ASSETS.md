# Asset licensing

[MIT](LICENSE) covers the project's source code. The bundled recordings and third-party software are covered as below.

## Bundled audio

- `web/assets/fillers/*.mp3`: 70 short nonverbal filler clips (thinking, acknowledging, amused, surprised, sympathetic, excited, curious), listed in `web/assets/fillers/manifest.json`.
- `web/assets/sfx/*.mp3`: 15 touch sound effects (squish, boing, plop, stretch, sparkle), listed in `web/assets/sfx/manifest.json`.

All of them were generated with ElevenLabs by the project's authors. [tools/render-fillers.mjs](tools/render-fillers.mjs) and [tools/render-sfx.mjs](tools/render-sfx.mjs) show how; they need your own ElevenLabs key and are not run by tests.

The maintainers believe these AI-generated recordings are not subject to copyright; verify for your jurisdiction. This is the maintainers' position, not legal advice, and the recordings, like third-party materials, are outside the scope of the MIT license in [LICENSE](LICENSE), which covers the project's source code. Check ElevenLabs' terms for your own use. A voice ID in the configuration does not grant rights to a voice; the default `ELEVENLABS_VOICE_ID` is simply a voice available to the maintainers' account, so set your own.

If you want a different guarantee, regenerate the clips with your own key and replace the files.

## Third-party software

- [Three.js](https://threejs.org/) is MIT-licensed. The Worker build copies its license next to the vendored modules (`vendor/three/LICENSE`).
- [Playwright](https://playwright.dev/) is Apache-2.0 and is a development dependency used only by `npm run check`.
- Preserve both notices when you redistribute.
- OpenJev model weights, if you choose to self-host them as the decision model, are licensed CC BY-NC 4.0 by their authors and are not part of this repository.
