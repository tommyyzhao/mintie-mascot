import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scan = fileURLToPath(new URL('../tools/secret-scan.mjs', import.meta.url));
const cf = fileURLToPath(new URL('../tools/cf.mjs', import.meta.url));
test('scanner checks key values without reading sensitive files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mintie-scan-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
    const secret = 'fixture-secret-value-12345';
    for (const name of ['.env', '.dev.vars', '.dev.vars.local', '.mintie-voice.json', 'MintieConfig.json']) writeFileSync(join(dir, name), secret);
    writeFileSync(join(dir, '.env.example'), 'safe');
    writeFileSync(join(dir, 'public.txt'), secret);
    const run = () => spawnSync(process.execPath, [scan], { cwd: dir, env: { PATH: process.env.PATH, OPENAI_API_KEY: secret }, encoding: 'utf8' });
    const found = run(); assert.equal(found.status, 1); assert.match(found.stdout, /public\.txt/); assert.doesNotMatch(found.stdout, /fixture-secret-value|\.env/);
    writeFileSync(join(dir, 'public.txt'), 'safe'); assert.equal(run().status, 0);
    writeFileSync(join(dir, '.env.example'), secret); assert.equal(run().status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Cloudflare rejects missing credentials without invoking provider', () => {
  const result = spawnSync(process.execPath, [cf, 'wrangler', 'deploy'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /CLOUDFLARE_API_TOKEN/);
  const invalid = spawnSync(process.execPath, [cf, 'secrets', 'unexpected'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Invalid mode or arguments/);
});
