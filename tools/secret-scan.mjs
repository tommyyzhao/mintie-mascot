// Scans current tracked and nonignored untracked text; not diffs or Git history.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadKeys } from '../server/server.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--env-file' || !args[1])) throw Error('Usage: secret-scan.mjs [--env-file PATH]');
const names = ['OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_API_TOKEN', 'GROQ_API_KEY', 'SONIOX_API_KEY', 'ASSEMBLYAI_API_KEY', 'SPEECHMATICS_API_KEY', 'CARTESIA_API_KEY'];
const values = { ...(args.length ? await loadKeys(args[1], names) : {}), ...Object.fromEntries(names.filter(k => process.env[k]).map(k => [k, process.env[k]])) };
const keys = Object.values(values).filter(v => v.length >= 12);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean);
const patterns = [new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----'), /\bsk-(?:proj-|or-v1-)[A-Za-z0-9_-]{32,}\b/, /\bghp_[A-Za-z0-9]{36}\b/];
const leaks = new Set(); let checked = 0, skipped = 0;
const scan = (name, text) => { checked++; if (keys.some(k => text.includes(k)) || patterns.some(p => p.test(text))) leaks.add(name); };
for (const file of new Set(files)) {
  const name = basename(file);
  if ((/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') || /^\.dev\.?vars(?:\.|$)/i.test(name) || /^(?:\.mintie-voice\.json|MintieConfig\.json)$/i.test(name) || /(^|\/)(?:node_modules|artifacts|dist|build|coverage)(?:\/|$)/i.test(file) || /(?:^|[._-])(?:credentials?|secrets?|private|id_rsa)(?:[._-]|$)/i.test(name) || (args.length && resolve(root, file) === resolve(args[1]))) { skipped++; continue; }
  try {
    const path = resolve(root, file), stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) { skipped++; continue; }
    const data = readFileSync(path);
    if (data.includes(0) || !Buffer.from(data.toString('utf8')).equals(data)) { skipped++; continue; }
    scan(file, data.toString('utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; skipped++; }
}
// Diffs can contain sensitive files; omit them rather than reading their contents indirectly.
// ponytail: deleted/staged-only content needs a separate history-aware audit.
console.log(keys.length ? `${keys.length} key values available; pattern checks enabled` : 'no key values available; pattern checks enabled');
console.log(`${checked} text files checked, ${skipped} skipped; ${leaks.size} files flagged${leaks.size ? ': ' + [...leaks].join(', ') : ''}`);
process.exitCode = leaks.size ? 1 : 0;
