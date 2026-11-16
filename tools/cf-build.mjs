// Worker assets (wrangler.toml [build]): web/ minus dotfiles, three's two ES modules, and the Node server's headers.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../server/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), out = path.join(root, '.cf/assets'), three = path.dirname(fileURLToPath(import.meta.resolve('three')));
await rm(path.join(root, '.cf'), { recursive: true, force: true });
await cp(path.join(root, 'web'), out, { recursive: true, filter: src => !path.basename(src).startsWith('.') });
await mkdir(path.join(out, 'vendor/three'), { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) await cp(path.join(three, file), path.join(out, 'vendor/three', file));
await cp(path.join(three, '../LICENSE'), path.join(out, 'vendor/three/LICENSE'));
await writeFile(path.join(out, '_headers'), `/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n/\n  Cache-Control: no-store\n/*.html\n  Cache-Control: no-store\n`);
