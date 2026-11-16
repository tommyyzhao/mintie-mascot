// Cloudflare Worker. Static files are Workers assets (tools/cf-build.mjs); /api/* runs the same createApp via the node:http bridge.
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { DurableObject, env } from 'cloudflare:workers';
import { createApp, CSP, DAILY } from './server.mjs';
import { CATALOG } from '../web/perform/emoji.js';

const keys = Object.fromEntries(['OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'TYPESAFE_API_KEY'].filter(k => env[k]).map(k => [k, env[k]]));
const node = httpServerHandler(createServer(createApp({ webRoot: '/nonexistent', threeDir: '/nonexistent', catalog: CATALOG, keys, origins: env.ORIGINS.split(','), log: v => console.log(JSON.stringify(v)) })));

// Per-UTC-day ceilings across every isolate; createApp's token buckets stay per isolate (burst only).
// ponytail: one global counter; old day keys are never pruned (3 tiny keys/day). Upgrade: alarm cleanup or per-IP budgets if abused.
export class Budget extends DurableObject {
  async admit(route) {
    const key = `${Math.floor(Date.now() / 864e5)}:${route}`, used = (await this.ctx.storage.get(key)) ?? 0;
    if (used >= DAILY[route]) return false;
    await this.ctx.storage.put(key, used + 1); return true;
  }
}

export default {
  async fetch(request, env, ctx) {
    const route = request.method === 'POST' && /^\/api\/(react|say|stt-token)$/.exec(new URL(request.url).pathname)?.[1];
    if (route && !(await env.BUDGET.get(env.BUDGET.idFromName('global')).admit(route)))
      return Response.json({ error: { stage: route, code: 'daily_limit' } }, { status: 429, headers: { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
    return node.fetch(request, env, ctx);
  },
};
