// Cloudflare Worker. Static files are Workers assets (tools/cf-build.mjs); /api/* runs the same createApp via the node:http bridge,
// behind server/guard.mjs (Turnstile cookie, per-IP limits, global USD/day cap).
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { DurableObject, env } from 'cloudflare:workers';
import * as app from './server.mjs';
import { CATALOG } from '../web/perform/emoji.js';
import { createGuard, Ledger, logUsage } from './guard.mjs';

// wrangler.toml ships a `<your-subdomain>` placeholder: `new URL` on it throws, so fail with a message that names the setting.
const origins = String(env.ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
for (const o of origins) { try { new URL(o); } catch { throw Error(`ORIGINS is invalid (${JSON.stringify(o)}): set it in wrangler.toml [vars] to your https origin, e.g. https://mintie-mascot.example.workers.dev`); } }
if (!origins.length) throw Error('ORIGINS is empty: set it in wrangler.toml [vars] to your https origin');
const keys = Object.fromEntries(app.KEY_NAMES.filter(k => env[k]).map(k => [k, env[k]]));
const log = v => { console.log(JSON.stringify(v)); logUsage(v); };
const node = httpServerHandler(createServer(app.createApp({ webRoot: '/nonexistent', threeDir: '/nonexistent', catalog: CATALOG, keys, origins, config: app.configFrom(env), log })));
const num = (v, d) => Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d;

// One global instance: the $/day cap and every per-IP row live in its SQLite-backed storage (see guard.mjs).
export class Budget extends DurableObject {
  ledger = new Ledger(this.ctx.storage, { dailyUsd: num(this.env.DAILY_USD, 5), ipUsd: num(this.env.IP_USD, 0.25), ipSessions: num(this.env.IP_SESSIONS, 15) });
  admit(req) { return this.ledger.admit(req); }
  settle(req) { return this.ledger.settle(req); }
  alarm() { return this.ledger.prune(); }
}

const secHeaders = { 'content-security-policy': app.CSP };
export default {
  fetch(request, env, ctx) {
    const guard = createGuard({ env, ledger: env.BUDGET.get(env.BUDGET.idFromName('global')), headers: secHeaders });
    return guard.handle(request, ctx, r => node.fetch(r, env, ctx));
  },
};
