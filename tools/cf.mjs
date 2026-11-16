// Usage: node tools/cf.mjs [--env-file PATH] api|wrangler|secrets ...
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadKeys } from '../server/server.mjs';

const args = process.argv.slice(2);
let envFile;
if (args[0] === '--env-file') { args.shift(); envFile = args.shift(); if (!envFile) throw Error('--env-file requires a path'); }
const [mode, ...rest] = args;
if (!['api', 'wrangler', 'secrets'].includes(mode) || (mode === 'api' && (rest.length < 2 || rest.length > 3)) || (mode === 'wrangler' && !rest.length) || (mode === 'secrets' && rest.length)) throw Error('Invalid mode or arguments');
const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY', 'SYSTEM_ONE_API_KEY', 'TYPESAFE_API_KEY'];
const keys = { ...(envFile ? await loadKeys(envFile, names) : {}), ...Object.fromEntries(names.filter(k => process.env[k]).map(k => [k, process.env[k]])) };
const token = keys.CLOUDFLARE_API_TOKEN || keys.CLOUDFLARE_API_KEY;
if (!token || !keys.CLOUDFLARE_ACCOUNT_ID) throw Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required');
const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: keys.CLOUDFLARE_ACCOUNT_ID };
const redact = s => Object.values(keys).filter(Boolean).reduce((v, secret) => v.split(secret).join('[redacted]'), s);
if (mode === 'api') {
  const [method, path, body] = rest;
  if (!method || !path) throw Error('api requires method and path');
  const r = await fetch(`https://api.cloudflare.com/client/v4/${path.replace('{acct}', keys.CLOUDFLARE_ACCOUNT_ID)}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(30000) });
  console.log(redact(JSON.stringify(await r.json(), null, 1)));
  if (!r.ok) process.exitCode = 1;
} else if (['wrangler', 'secrets'].includes(mode)) {
  let input;
  if (mode === 'secrets') {
    const providerNames = names.slice(3);
    input = JSON.stringify(Object.fromEntries(providerNames.filter(k => keys[k]).map(k => [k, keys[k]])));
    if (input === '{}') throw Error('No provider keys supplied');
  }
  const r = spawnSync('npx', ['--yes', 'wrangler@4', ...(mode === 'wrangler' ? rest : ['secret', 'bulk'])], { env, input, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 1e8 });
  process.stdout.write(redact(r.stdout ?? '')); process.stderr.write(redact(r.stderr ?? '')); process.exitCode = r.status ?? 1;
} else throw Error('Expected api, wrangler or secrets');
