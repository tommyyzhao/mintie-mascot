import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, Ledger, logUsage, costOf, reserveUsd, PRICES, SESSION_SECONDS } from '../server/guard.mjs';

const ORIGIN = 'https://mintie.example', PASS = '1x0000000000000000000000000000000AA', FAIL = '2x0000000000000000000000000000000AA', SPENT = '3x0000000000000000000000000000000AA';
const DAY = 864e5, T0 = 20400 * DAY + 3600e3;
function storage() {
  const m = new Map(); let alarm = null, calls = 0;
  return {
    m, get calls() { return calls; }, get alarm() { return alarm; },
    async get(k) { calls++; return Array.isArray(k) ? new Map(k.filter(x => m.has(x)).map(x => [x, structuredClone(m.get(x))])) : structuredClone(m.get(k)); },
    async put(o) { calls++; for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    async delete(ks) { calls++; for (const k of ks) m.delete(k); },
    async list({ prefix }) { return new Map([...m].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return alarm; }, async setAlarm(t) { alarm = t; },
  };
}
// Cloudflare's documented test secrets decide the siteverify answer; the fake fetch mirrors them, one use per token for SPENT-style replay.
function rig(opts = {}, secret = PASS) {
  let t = T0; const upstream = [], verifies = [], spentTokens = new Set(), store = storage(), cfg = { dailyUsd: 5, ipUsd: 0.25, ipSessions: 15, ...opts.caps };
  const ledger = new Ledger(store, cfg, () => t), tasks = [];
  const fetch = async (url, init) => {
    const p = new URLSearchParams(init.body); verifies.push({ url, secret: p.get('secret'), remoteip: p.get('remoteip') });
    const s = p.get('secret'), tok = p.get('response'), replay = spentTokens.has(tok); spentTokens.add(tok);
    return Response.json({ success: s === PASS && !replay });
  };
  const env = { ORIGINS: ORIGIN, TURNSTILE_SECRET_KEY: secret, TURNSTILE_SITE_KEY: '1x00000000000000000000BB', ...opts.env };
  const guard = createGuard({ env, ledger, fetch, now: () => t });
  const next = opts.next ?? (async req => {
    const path = new URL(req.url).pathname; upstream.push(path);
    if (path === '/api/health') return Response.json({ ok: true, stt: true });
    for (const e of opts.events ?? []) logUsage(e);
    return new Response('ok');
  });
  const ctx = { waitUntil: p => tasks.push(p) };
  const call = async (path, { ip = '1.2.3.4', cookie, method = 'POST', body = '{}', origin = ORIGIN } = {}) => {
    const r = await guard.handle(new Request(`${ORIGIN}${path}`, { method, headers: { origin, 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) }, body: method === 'GET' ? undefined : body }), ctx, next);
    const text = await r.text(); await Promise.all(tasks.splice(0)); return { r, status: r.status, text, json: () => JSON.parse(text) };
  };
  const login = async (ip = '1.2.3.4', token = `tok-${Math.random()}`) => { const x = await call('/api/session', { ip, body: JSON.stringify({ token }) }); return x.r.headers.get('set-cookie')?.split(';')[0]; };
  return { call, login, upstream, verifies, store, ledger, tick: ms => { t += ms; }, set: v => { t = v; }, now: () => t };
}
const code = x => x.json().error.code;

test('paid routes: no cookie -> 403 human_check before any ledger or upstream call', async () => {
  const g = rig();
  for (const route of ['react', 'say', 'stt-token']) { const x = await g.call(`/api/${route}`); assert.equal(x.status, 403); assert.deepEqual(x.json(), { error: { stage: route, code: 'human_check' } }); }
  assert.deepEqual(g.upstream, []); assert.equal(g.store.calls, 0);
  const forged = await g.call('/api/react', { cookie: `__Host-mintie=${Math.floor(T0 / 1000) + 600}.${'A'.repeat(43)}` });
  assert.equal(forged.status, 403); assert.equal(g.store.calls, 0); assert.deepEqual(g.upstream, []);
});

test('session: siteverify pass sets a hardened 30 min cookie; fail, replay, bad origin, bad body are refused', async () => {
  const g = rig(); const x = await g.call('/api/session', { body: '{"token":"a"}' });
  assert.equal(x.status, 200);
  const c = x.r.headers.get('set-cookie'); assert.match(c, /^__Host-mintie=\d+\.[\w-]{43}; Path=\/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict$/);
  assert.deepEqual(g.verifies, [{ url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', secret: PASS, remoteip: '1.2.3.4' }]);
  assert.equal((await g.call('/api/session', { body: '{"token":"a"}' })).status, 403); // replay
  assert.equal((await g.call('/api/session', { body: '{"token":"b"}', origin: 'https://evil.example' })).status, 403);
  for (const body of ['', '{}', '{"token":1}', '{"token":"x","y":1}', 'nope']) assert.equal((await g.call('/api/session', { body })).status, 400);
  assert.equal(g.upstream.length, 0);
  const bad = rig({}, FAIL); assert.equal((await bad.call('/api/session', { body: '{"token":"a"}' })).status, 403);
  assert.equal(await bad.login(), undefined);
  const spent = rig({}, SPENT); assert.equal((await spent.call('/api/session', { body: '{"token":"a"}' })).status, 403);
});

test('cookie: valid passes; expiry, other IP, tampered expiry and wrong secret fail', async () => {
  const g = rig(), c = await g.login();
  assert.equal((await g.call('/api/stt-token', { cookie: c })).status, 200);
  assert.equal((await g.call('/api/stt-token', { cookie: c, ip: '9.9.9.9' })).status, 403); // bound to the IP hash
  const [name, val] = c.split('='), [exp, sig] = val.split('.');
  assert.equal((await g.call('/api/stt-token', { cookie: `${name}=${Number(exp) + 600}.${sig}` })).status, 403);
  assert.equal((await g.call('/api/stt-token', { cookie: `${name}=${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}` })).status, 403);
  assert.equal((await g.call('/api/stt-token', { cookie: `${name}=${Number(exp) + 99999}.${sig}` })).status, 403); // beyond the 30 min horizon
  const other = rig({}, '1x0000000000000000000000000000000AA' + 'x'); assert.equal((await other.call('/api/stt-token', { cookie: c })).status, 403);
  g.tick(1801e3); assert.equal((await g.call('/api/stt-token', { cookie: c })).status, 403);
});

test('health carries the site key when configured, and only then', async () => {
  const g = rig(); const x = await g.call('/api/health', { method: 'GET' });
  assert.deepEqual(x.json(), { ok: true, stt: true, turnstile: '1x00000000000000000000BB' });
  const off = rig({ env: { TURNSTILE_SITE_KEY: '' } }); assert.deepEqual((await off.call('/api/health', { method: 'GET' })).json(), { ok: true, stt: true });
});

test('global cap: admit while estimate + reservation fits, then 429 daily_limit; ip hashes are never raw', async () => {
  const g = rig({ caps: { dailyUsd: 0.05, ipUsd: 1 } }), a = await g.login('1.1.1.1'), b = await g.login('2.2.2.2');
  const r = []; for (const [ip, c] of [['1.1.1.1', a], ['2.2.2.2', b], ['1.1.1.1', a], ['2.2.2.2', b]]) r.push((await g.call('/api/stt-token', { ip, cookie: c })).status);
  assert.deepEqual(r, [200, 200, 429, 429]); // 2 x $0.0183 fits under $0.05, a third does not
  assert.equal(code(await g.call('/api/stt-token', { cookie: a, ip: '1.1.1.1' })), 'daily_limit');
  assert.ok(![...g.store.m.keys()].some(k => k.includes('1.1.1.1')));
  const react = await g.call('/api/react', { cookie: a, ip: '1.1.1.1' }); assert.equal(react.status, 200); // $0.002 still fits in the remaining $0.0134
});

test('settle replaces the reservation with the actual cost (usd wins) and keeps it when no usage is logged', async () => {
  const g = rig({ events: [{ stage: 'usage', provider: 'openrouter', kind: 'words', cost: 0.0004 }, { stage: 'usage', provider: 'system-one', kind: 'pass1', input_tokens: 1000 }] }), c = await g.login();
  assert.equal((await g.call('/api/react', { cookie: c })).status, 200);
  const day = Math.floor(T0 / DAY), g1 = g.store.m.get(`g:${day}`).usd; assert.equal(g1, Math.ceil((0.0004 + 1000 * 0.042 / 1e6) * 1e6 - 1e-9));
  const quiet = rig(), qc = await quiet.login(); await quiet.call('/api/react', { cookie: qc });
  assert.equal(quiet.store.m.get(`g:${Math.floor(T0 / DAY)}`).usd, 2000);
});

test('say reserves by text length and settles on character-cost; late usage events still land', async () => {
  const text = 'a'.repeat(100), g = rig({ events: [{ stage: 'usage', provider: 'elevenlabs', kind: 'tts', characters: 40 }] }), c = await g.login();
  await g.call('/api/say', { cookie: c, body: JSON.stringify({ text }) });
  assert.equal(g.store.m.get(`g:${Math.floor(T0 / DAY)}`).usd, 1600); // 40 chars x $0.04/1k
  // A usage event after the response settled (hedge loser) still lands, via the async context captured in the request.
  const l = rig({ next: async () => { setTimeout(() => logUsage({ stage: 'usage', provider: 'openrouter', kind: 'words', usd: 0.01 }), 5); return new Response('x'); } });
  const lc = await l.login(); await l.call('/api/react', { cookie: lc }); await new Promise(r => setTimeout(r, 30));
  assert.equal(l.store.m.get(`g:${Math.floor(T0 / DAY)}`).usd, 2000 + 10000);
});

test('settle runs when a streamed body is read to the end or cancelled', async () => {
  const mk = () => new ReadableStream({ pull(c) { logUsage({ stage: 'usage', provider: 'elevenlabs', kind: 'tts', characters: 10 }); c.enqueue(new TextEncoder().encode('x')); c.close(); } });
  const g = rig({ next: async () => new Response(mk()) }), c = await g.login();
  await g.call('/api/say', { cookie: c, body: '{"text":"hello"}' });
  assert.equal(g.store.m.get(`g:${Math.floor(T0 / DAY)}`).usd, 400);
});

test('per-IP caps: voice sessions and dollars -> 429 ip_limit; other IPs unaffected', async () => {
  const g = rig({ caps: { ipUsd: 10, ipSessions: 3 } }), a = await g.login('1.1.1.1'), b = await g.login('2.2.2.2');
  for (let i = 0; i < 3; i++) assert.equal((await g.call('/api/stt-token', { cookie: a, ip: '1.1.1.1' })).status, 200);
  assert.equal(code(await g.call('/api/stt-token', { cookie: a, ip: '1.1.1.1' })), 'ip_limit');
  assert.equal((await g.call('/api/react', { cookie: a, ip: '1.1.1.1' })).status, 200); // react does not use a voice session
  assert.equal((await g.call('/api/stt-token', { cookie: b, ip: '2.2.2.2' })).status, 200);
  const d = rig({ caps: { ipUsd: 0.003 } }), dc = await d.login(); assert.equal((await d.call('/api/react', { cookie: dc })).status, 200);
  assert.equal(code(await d.call('/api/react', { cookie: dc })), 'ip_limit');
  const before = d.store.calls; await d.call('/api/react', { cookie: dc }); assert.equal(d.store.calls, before); // remembered denial costs no ledger request
});

test('day rollover resets caps; the alarm prunes past days and re-arms', async () => {
  const g = rig({ caps: { ipUsd: 0.003 } }), c = await g.login();
  await g.call('/api/react', { cookie: c }); assert.equal(code(await g.call('/api/react', { cookie: c })), 'ip_limit');
  assert.equal(g.store.alarm, (Math.floor(T0 / DAY) + 1) * DAY + 3e5);
  g.set((Math.floor(T0 / DAY) + 1) * DAY + 1000); const c2 = await g.login(); // cookie from yesterday may still be valid; log in anyway
  assert.equal((await g.call('/api/react', { cookie: c2 })).status, 200);
  assert.equal([...g.store.m.keys()].filter(k => k.startsWith('g:')).length, 2);
  await g.ledger.prune();
  assert.deepEqual([...g.store.m.keys()].map(k => k.split(':')[0] + ':' + k.split(':')[1]).sort(), [`g:${Math.floor(T0 / DAY) + 1}`, `i:${Math.floor(T0 / DAY) + 1}`]);
  assert.ok(g.store.alarm > g.now());
});

test('pricing: provider-reported usd wins; table fallbacks; unknown providers are free', () => {
  assert.equal(costOf({ stage: 'usage', provider: 'openrouter', usd: 0.5, prompt_tokens: 9e9 }), 0.5);
  assert.equal(costOf({ stage: 'usage', provider: 'openrouter', cost: 0.001 }), 0.001);
  assert.equal(costOf({ stage: 'usage', provider: 'elevenlabs', kind: 'tts', characters: 1000 }, { ttsModel: 'eleven_v4_turbo' }), 0.04);
  assert.equal(costOf({ stage: 'usage', provider: 'elevenlabs', kind: 'tts', characters: 1000 }, { ttsModel: 'eleven_v4' }), 0.08);
  assert.equal(costOf({ stage: 'usage', provider: 'elevenlabs', kind: 'stt', seconds: 3600 }), PRICES.sttPerHour);
  assert.equal(costOf({ stage: 'usage', provider: 'elevenlabs', kind: 'stt', sessions: 1 }), SESSION_SECONDS / 3600 * PRICES.sttPerHour);
  assert.equal(costOf({ stage: 'usage', provider: 'system-one', kind: 'decision', input_tokens: 1e6 }), 0.042);
  assert.equal(costOf({ stage: 'usage', provider: 'typesafe', input_tokens: 1e6 }), 0.042);
  assert.equal(costOf({ stage: 'usage', provider: 'openrouter', kind: 'llm', prompt_tokens: 1e6, completion_tokens: 1e6 }), 0.07 + 1.2);
  assert.equal(costOf({ stage: 'usage', provider: 'unknown', calls: 1 }), 0); assert.equal(costOf({ stage: 's2-end' }), 0);
  assert.ok(reserveUsd('say', 99999, 'eleven_v4_turbo') <= 0.025 && reserveUsd('stt-token') > 0);
});

test('non-paid routes pass through untouched', async () => {
  const g = rig(); assert.equal((await g.call('/api/other', { method: 'GET' })).status, 200); assert.deepEqual(g.upstream, ['/api/other']);
});
