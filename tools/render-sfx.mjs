import { mkdir, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadKeys } from '../server/server.mjs';

// ponytail: three independent takes per event; increase only after listening reveals repetition.
const sounds = {
  squish: 'A single quiet close-up soft gelatin fingertip press, organic damp texture, muted and delicate, no voice, no music, no sharp click',
  boing: 'A single gentle soft hand pat on yielding jelly, warm and muted, organic texture, no cartoon bounce, no voice, no music',
  plop: 'A single small soft jelly settling onto a padded surface, low and gentle, no splash, no hard impact, no voice, no music',
  stretch: 'A single quiet soft gelatin stretching and releasing, subtle organic texture, no squeak, no voice, no music',
  sparkle: 'A single delicate soft glimmer of light shimmer, warm organic whisper, no chime, no sparkle bell, no voice, no music'
};
const args = process.argv.slice(2);
const env = args[0] === '--env-file' ? args[1] : args[0];
if (!env || !args.includes('--allow-provider')) { console.error('Usage: node render-sfx.mjs [--env-file] <path> --allow-provider'); process.exit(1); }
try {
  const { ELEVENLABS_API_KEY: key } = await loadKeys(env);
  if (!key) throw Error('Missing provider key');
  const dir = fileURLToPath(new URL('../tmp/sfx/candidates/', import.meta.url));
  await mkdir(dir, {recursive:true});
  let generated = 0, attempted = 0;
  for (const [name, text] of Object.entries(sounds)) for (let variant = 1; variant <= 3; variant++) {
    const path = `${dir}${name}-${variant}.mp3`;
    // Reserve before the request: reruns never overwrite or spend on an existing candidate.
    let file;
    try { file = await open(path, 'wx'); }
    catch (err) { if (err.code === 'EEXIST') continue; throw err; }
    try {
      if (++attempted > 15) throw Error('Attempt limit exceeded');
      const response = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {method:'POST',headers:{'xi-api-key':key,'content-type':'application/json'},body:JSON.stringify({text,duration_seconds:.5}),signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length) throw Error('Empty response');
      await file.writeFile(bytes); generated++;
    } catch (err) { await file.close(); await unlink(path); throw err; }
    await file.close();
  }
  console.log(`sfx: ${generated} generated; ${attempted} generations attempted`);
} catch (err) { console.error(`sound generation failed: ${err.message}`); process.exitCode = 1; }
