// Hosted-demo guard: Turnstile session cookie, per-IP limits and a global USD/day cap, in front of createApp.
// Pure (no cloudflare:* imports) so test/guard.test.mjs runs it with a fake ledger/storage, clock and fetch; server/worker.mjs wires the Durable Object.
import { AsyncLocalStorage } from 'node:async_hooks';

// Provider prices in USD, checked 2026-11-15. The provider-reported `usd`/`cost` on a usage event always wins; these are the fallback.
//  ElevenLabs STT  Scribe v3 Live  $0.22 per hour                       https://elevenlabs.io/pricing/api
//  ElevenLabs TTS  v4 Turbo $0.04 / v4 $0.08 per 1K characters (v4 rate is the unknown-model default)  same page, pay-as-you-go API rates
//  OpenRouter      deepseek/deepseek-v4.1-flash: endpoint list is $0.051-$0.07 in, $0.567-$1.20 out per 1M; the dearest endpoint is used  https://openrouter.ai/deepseek/deepseek-v4.1-flash
//  System One      Jev (jev-1.14.0) $0.042 per 1M input tokens, output free  https://docs.typesafe.ai/models
export const PRICES = {
  sttPerHour: 0.22,
  ttsPer1k: { eleven_v4_turbo: 0.04, eleven_v4: 0.08, default: 0.08 },
  openrouter: { inPerM: 0.07, outPerM: 1.2 },
  'system-one': { inPerM: 0.042, outPerM: 0 },
};
// The browser ends a voice session after 15 min, but the token is minted before any audio: charge a typical 5 min up front.
// ponytail: a hand-rolled client could stream for hours on one token; Scribe bills by audio time, which only the provider dashboard sees. Upgrade: provider-side usage poll.
export const SESSION_SECONDS = 300;
export const MAX_SAY_CHARS = 600;
const PAID = /^\/api\/(react|say|stt-token)$/, COOKIE = '__Host-mintie', COOKIE_SECONDS = 1800, DAY = 864e5;
const num = v => Number.isFinite(v) && v >= 0;
const micro = usd => Math.ceil(usd * 1e6 - 1e-9);
const ttsRate = model => PRICES.ttsPer1k[model] ?? PRICES.ttsPer1k.default;

// Estimated USD for one `log({stage:'usage',…})` event; unknown providers cost 0.
// An openrouter (llm) or system-one (decision) event with no usd, cost or token counts is charged a conservative flat estimate, never $0:
// a $0 settle would refund the whole reservation. Flat values: one words/sound LLM call ~1.5K in + 0.3K out tokens at the dearest endpoint ~= $0.0005, rounded up;
// one System One decision ~2K input tokens ~= $0.0001, rounded up.
export const FLAT = { openrouter: 0.001, 'system-one': 0.0002 };
export function costOf(e, { ttsModel } = {}) {
  if (e?.stage !== 'usage') return 0;
  const provider = e.provider === 'typesafe' ? 'system-one' : e.provider;
  for (const k of ['usd', 'cost']) if (num(e[k])) return e[k];
  const input = [e.input_tokens, e.prompt_tokens].find(num) ?? 0, output = [e.output_tokens, e.completion_tokens].find(num) ?? 0;
  if (provider === 'elevenlabs') {
    if (e.kind === 'tts') return (num(e.characters) ? e.characters : 0) * ttsRate(ttsModel) / 1000;
    if (e.kind === 'stt') return (num(e.seconds) ? e.seconds : (num(e.sessions) ? e.sessions : 1) * SESSION_SECONDS) / 3600 * PRICES.sttPerHour;
  }
  const counted = [e.input_tokens, e.prompt_tokens, e.output_tokens, e.completion_tokens, e.tokens].some(num);
  if (!counted && FLAT[provider] !== undefined && (provider === 'openrouter' ? e.kind === 'llm' : e.kind === 'decision')) return FLAT[provider];
  if (provider === 'openrouter') return (input * PRICES.openrouter.inPerM + (output || (num(e.tokens) ? e.tokens : 0)) * PRICES.openrouter.outPerM) / 1e6;
  if (provider === 'system-one') return (input || (num(e.tokens) ? e.tokens : 0)) * PRICES['system-one'].inPerM / 1e6;
  return 0;
}

// Per-request reservation, held until the request settles. say's text is known up front; react is a few LLM calls; stt-token is one session.
export const reserveUsd = (route, chars, ttsModel) => route === 'say' ? Math.min(chars, MAX_SAY_CHARS) * ttsRate(ttsModel) / 1000
  : route === 'stt-token' ? SESSION_SECONDS / 3600 * PRICES.sttPerHour : 0.002;

// All money in integer micro-USD. One instance (one Durable Object) holds the global and every per-IP counter, so the global cap is exact
// and a request is one admit + one settle call. Keys: g:<day> and i:<day>:<ipHash>; the alarm drops past days.
// ponytail: one DO tops out around 1k req/s, far above the $5/day cap's ~0.1 req/s. Upgrade: shard per-IP rows over DOs and keep one global DO.
export class Ledger {
  constructor(storage, { dailyUsd = 5, ipUsd = 0.25, ipSessions = 15 } = {}, now = Date.now) {
    Object.assign(this, { storage, now, cap: micro(dailyUsd), ipCap: micro(ipUsd), ipSessions, armed: false });
  }
  today() { return Math.floor(this.now() / DAY); }
  async admit({ ip, route, cost }) {
    const day = this.today(), gk = `g:${day}`, ik = `i:${day}:${ip}`, rows = await this.storage.get([gk, ik]);
    const g = rows.get(gk) ?? { usd: 0 }, i = rows.get(ik) ?? { usd: 0, sessions: 0 };
    if (g.usd + cost > this.cap) return { ok: false, code: 'daily_limit' };
    if (i.usd + cost > this.ipCap || route === 'stt-token' && i.sessions >= this.ipSessions) return { ok: false, code: 'ip_limit' };
    g.usd += cost; i.usd += cost; if (route === 'stt-token') i.sessions++;
    await this.storage.put({ [gk]: g, [ik]: i });
    await this.arm();
    return { ok: true, day, reserved: cost };
  }
  // Replace the reservation with the actual cost, on the day it was admitted; a pruned day is dropped.
  // refundSession: a failed stt-token mint (status >= 400) gives its per-IP session back.
  async settle({ day, ip, reserved, actual, refundSession }) {
    const delta = actual - reserved; if (!delta && !refundSession) return;
    const gk = `g:${day}`, ik = `i:${day}:${ip}`, rows = await this.storage.get([gk, ik]), put = {};
    for (const [k, row] of rows) put[k] = { ...row, usd: Math.max(0, row.usd + delta), ...(refundSession && k === ik ? { sessions: Math.max(0, (row.sessions ?? 0) - 1) } : {}) };
    if (Object.keys(put).length) await this.storage.put(put);
  }
  async arm() {
    if (this.armed) return;
    if ((await this.storage.getAlarm()) == null) await this.storage.setAlarm((this.today() + 1) * DAY + 5 * 6e4);
    this.armed = true;
  }
  async prune() {
    const today = this.today(), old = [];
    for (const prefix of ['g:', 'i:']) for (const k of (await this.storage.list({ prefix })).keys()) if (Number(k.split(':')[1]) < today) old.push(k);
    for (let n = 0; n < old.length; n += 128) await this.storage.delete(old.slice(n, n + 128));
    this.armed = false; await this.arm();
  }
}

// Usage events from createApp's log() belong to the request that caused them: createGuard runs the app inside als, logUsage reads it.
const als = new AsyncLocalStorage();
export function logUsage(v) {
  const s = als.getStore(); if (!s || v?.stage !== 'usage') return;
  if (!s.settled) s.events.push(v);
  else s.ctx.waitUntil(s.ledger.settle({ day: s.day, ip: s.ih, reserved: 0, actual: micro(costOf(v, s)) })); // late events (hedge losers, background decisions)
}

const enc = new TextEncoder(), hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

// IPv4 and unknown pass through; IPv6 becomes its /64 (first 4 hextets after expanding `::`). IPv4-mapped (::ffff:a.b.c.d) is treated as IPv4.
export function ipKey(ip) {
  if (typeof ip !== 'string' || !ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); if (mapped) return mapped[1];
  const [head, tail, extra] = ip.split('::'); if (extra !== undefined) return ip;
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  if (tail === undefined ? a.length !== 8 : a.length + b.length > 7) return ip;
  const full = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return full.slice(0, 4).map(h => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// env: ORIGINS, TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY, ELEVENLABS_TTS_MODEL (strings). ledger: object with admit/settle (the DO stub, or a Ledger in tests).
export function createGuard({ env, ledger, fetch = globalThis.fetch, now = Date.now, headers = {} }) {
  const origins = new Set((env.ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean)), secret = env.TURNSTILE_SECRET_KEY, siteKey = env.TURNSTILE_SITE_KEY || undefined;
  const ttsModel = env.ELEVENLABS_TTS_MODEL || 'eleven_v4_turbo';
  let denied = { day: -1, seen: new Map() };
  const fail = (status, stage, code) => Response.json({ error: { stage, code } }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
  // Never store or log raw IPs: a salted hash keys the ledger and binds the cookie.
  // IPv6 clients roam within their /64, so only that prefix is hashed.
  const ipHash = async ip => hex(await crypto.subtle.digest('SHA-256', enc.encode(`${env.IP_SALT || secret}|ip|${ipKey(ip)}`))).slice(0, 32);
  const sign = async (exp, ih) => b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`session-v1|${exp}|${ih}`)));
  async function validCookie(request, ih) {
    const raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const [exp, sig, ...rest] = raw?.split('.') ?? [], t = now() / 1000;
    if (!secret || rest.length || !/^\d{1,12}$/.test(exp ?? '') || !(exp > t && exp <= t + COOKIE_SECONDS) || !/^[\w-]{43}$/.test(sig ?? '')) return false;
    return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(sig), enc.encode(`session-v1|${exp}|${ih}`));
  }
  const originOk = request => origins.has(request.headers.get('origin'));

  async function session(request) {
    if (!originOk(request)) return fail(403, 'request', 'bad_request');
    let token; try { const text = await request.text(); const body = text.length <= 4096 ? JSON.parse(text) : null; token = Object.keys(body ?? {}).join() === 'token' ? body.token : null; } catch {}
    if (typeof token !== 'string' || !token || token.length > 2048) return fail(400, 'session', 'bad_request');
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!secret) return fail(403, 'session', 'human_check');
    let ok; try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(5000) });
      ok = (await r.json())?.success === true; // Cloudflare spends each token once: a replay comes back success:false.
    } catch { return fail(502, 'session', 'http_error'); }
    if (!ok) return fail(403, 'session', 'human_check');
    const exp = Math.floor(now() / 1000) + COOKIE_SECONDS, cookie = `${COOKIE}=${exp}.${await sign(exp, await ipHash(ip))}; Path=/; Max-Age=${COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
    return Response.json({ ok: true }, { headers: { 'set-cookie': cookie, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
  }

  async function paid(route, request, ctx, next) {
    if (!originOk(request)) return fail(403, 'request', 'bad_request');
    const ih = await ipHash(request.headers.get('cf-connecting-ip') ?? 'unknown');
    if (!(await validCookie(request, ih))) return fail(403, route, 'human_check'); // before any DO or upstream call
    const day = Math.floor(now() / DAY); if (denied.day !== day || denied.seen.size > 5000) denied = { day, seen: new Map() };
    const remembered = denied.seen.get(`${ih}|${route}`) ?? denied.seen.get(`*|${route}`); // a known-over cap costs no DO request
    if (remembered) return fail(429, route, remembered);
    let chars = MAX_SAY_CHARS;
    if (route === 'say' && !(Number(request.headers.get('content-length')) > 8192)) try { const t = (await request.clone().json()).text; if (typeof t === 'string') chars = t.length; } catch {}
    const got = await ledger.admit({ ip: ih, route, cost: micro(reserveUsd(route, chars, ttsModel)) });
    if (!got.ok) { denied.seen.set(got.code === 'daily_limit' ? `*|${route}` : `${ih}|${route}`, got.code); return fail(429, route, got.code); }
    const s = { events: [], settled: false, ih, ctx, ledger, ttsModel, day: got.day };
    const settle = async status => {
      if (s.settled) return; s.settled = true;
      const actual = s.events.length ? micro(s.events.reduce((sum, e) => sum + costOf(e, s), 0)) : status < 400 ? got.reserved : 0; // success with no usage event: keep the reservation
      await ledger.settle({ day: got.day, ip: ih, reserved: got.reserved, actual, refundSession: route === 'stt-token' && status >= 400 });
    };
    let res; try { res = await als.run(s, () => next(request)); } catch (e) { ctx.waitUntil(settle(500)); throw e; }
    if (!res.body) { ctx.waitUntil(settle(res.status)); return res; }
    const reader = res.body.getReader(), done = () => ctx.waitUntil(settle(res.status));
    return new Response(new ReadableStream({
      async pull(c) { try { const r = await reader.read(); if (r.done) { c.close(); done(); } else c.enqueue(r.value); } catch (e) { c.error(e); done(); } },
      cancel(why) { done(); return reader.cancel(why); },
    }), res);
  }

  return {
    async handle(request, ctx, next) {
      const { pathname } = new URL(request.url);
      if (request.method === 'GET' && pathname === '/api/health') {
        const res = await next(request), body = siteKey && res.ok ? await res.clone().json().catch(() => null) : null;
        if (!body) return res;
        const h = new Headers(res.headers); h.delete('content-length');
        return new Response(JSON.stringify({ ...body, turnstile: siteKey }), { status: res.status, headers: h });
      }
      if (request.method !== 'POST') return next(request);
      if (pathname === '/api/session') return session(request);
      const route = PAID.exec(pathname)?.[1];
      return route ? paid(route, request, ctx, next) : next(request);
    },
  };
}
