// One paid end-to-end qualification of Scribe v3 Live through the real server route and the real client URL/chunk code.
// Usage: node tools/qualify-stt.mjs --env-file PATH --base http://127.0.0.1:8143 --ledger PATH --server-log PATH [--out PATH]
// Never a microphone: ElevenLabs TTS makes three synthetic utterances, streamed as paced PCM over the real Scribe socket. No retries.
//
// PRE-REGISTERED GATES (fixed before the first paid call):
//   G1 accuracy   word error rate (case/accent/punctuation-insensitive) <= 0.15 per utterance and <= 0.10 mean
//   G2 commit     every utterance gets exactly one non-empty committed_transcript from turn prediction (no manual commit sent)
//   G3 latency    commit arrives <= 1.5 s (median) and <= 3.0 s (max) after the last speech sample was sent
//   G4 partials   >= 1 partial_transcript precedes each commit
//   G5 spend      whole lane <= $2.00, every paid call logged to the ledger
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { loadKeys } from '../server/server.mjs';
import { scribeUrl, scribeChunk, normalizeText } from '../web/voice.js';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [envFile, base, ledger, serverLog, out] = ['--env-file', '--base', '--ledger', '--server-log', '--out'].map(arg);
if (!envFile || !base || !ledger || !serverLog) throw Error('Usage: qualify-stt.mjs --env-file PATH --base URL --ledger PATH --server-log PATH [--out PATH]');
const { ELEVENLABS_API_KEY: key } = await loadKeys(envFile, ['ELEVENLABS_API_KEY']);
const VOICE = 'ocZQ262SsZb9RIxcQBOj', TTS_MODEL = 'eleven_v4_turbo', PRICE = { sttPerHour: 0.22, ttsPer1kChars: 0.30 /* estimate: plan-dependent */ };
const UTTERANCES = [
  { lang: 'en', text: 'Hello Mintie, can you tell me why the sky is blue today?' },
  { lang: 'es', text: 'Hola Mintie, ¿me puedes decir por qué el cielo es azul hoy?' },
  { lang: 'ru', text: 'Привет, Минти, расскажи мне, почему сегодня небо голубое?' },
];
const spend = []; const log = async (provider, what, usd) => { const row = { ts: new Date().toISOString(), lane: 'pipeline', provider, what, usd: Number(usd.toFixed(6)) }; spend.push(row); await appendFile(ledger, JSON.stringify(row) + '\n'); };
const wer = (ref, hyp) => {
  const r = normalizeText(ref).split(' '), h = normalizeText(hyp).split(' '), d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
};
async function synth(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?output_format=pcm_16000`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text, model_id: TTS_MODEL }) });
  if (!res.ok) throw Error(`tts_http_${res.status}`);
  await log('elevenlabs', `tts ${text.length} chars`, text.length * PRICE.ttsPer1kChars / 1000);
  return Buffer.from(await res.arrayBuffer());
}
async function transcribe(pcm) {
  const minted = await fetch(`${base}/api/stt-token`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' });
  if (!minted.ok) throw Error(`token_http_${minted.status}`);
  const { token, model } = await minted.json();
  const ws = new WebSocket(scribeUrl({ token, model }));
  const events = []; let speechEndAt = null, committed = null, sentMs = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data), at = performance.now(); events.push({ type: m.message_type, text: m.text, at }); if (m.message_type === 'committed_transcript' && !committed) committed = { text: m.text, at }; };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('socket_error')); });
  const chunk = 3200, tick = () => new Promise(r => setTimeout(r, 100));
  for (let o = 0; o < pcm.length; o += chunk) { ws.send(scribeChunk(pcm.subarray(o, o + chunk))); sentMs += 100; await tick(); }
  speechEndAt = performance.now();
  // Silence tail, still paced real time, until the provider commits on its own (max 6 s).
  for (let i = 0; i < 60 && !committed; i++) { ws.send(scribeChunk(Buffer.alloc(chunk))); sentMs += 100; await tick(); }
  ws.close();
  await log('elevenlabs', `stt ${(sentMs / 1000).toFixed(1)} s realtime scribe_v3_live`, sentMs / 3.6e6 * PRICE.sttPerHour);
  return { events, committed, latencyMs: committed ? Math.round(committed.at - speechEndAt) : null, partials: events.filter(e => e.type === 'partial_transcript' && e.text).length, others: [...new Set(events.map(e => e.type))], audioSeconds: sentMs / 1000 };
}

const rows = [];
for (const u of UTTERANCES) {
  const pcm = await synth(u.text);
  const r = await transcribe(pcm);
  const hyp = r.committed?.text ?? '';
  rows.push({ lang: u.lang, ref: u.text, hyp, wer: Number(wer(u.text, hyp).toFixed(3)), latencyMs: r.latencyMs, partials: r.partials, commits: r.events.filter(e => e.type === 'committed_transcript').length, eventTypes: r.others, audioSeconds: r.audioSeconds });
}
// One real /api/react text turn (System One + LLM + debug + memory), costed from the server's own usage log.
const turn = await fetch(`${base}/api/react`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hi! My name is Sam. Why is the sky blue?', debug: true, memory: { name: null, facts: [] } }) });
const frames = (await turn.text()).trim().split('\n').map(l => JSON.parse(l));
const usage = (await readFile(serverLog, 'utf8')).split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x?.stage === 'usage' && x.provider !== 'elevenlabs');
for (const u of usage) await log(u.provider, `react ${u.kind} ${u.tokens ?? 0} tokens`, u.usd ?? (u.provider === 'system-one' ? 0.0005 /* estimate, no usd in response */ : 0));
const total = spend.reduce((n, r) => n + r.usd, 0), lat = rows.map(r => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b), median = lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null;
const gates = {
  G1: rows.every(r => r.wer <= 0.15) && rows.reduce((n, r) => n + r.wer, 0) / rows.length <= 0.10,
  G2: rows.every(r => r.commits === 1 && r.hyp.trim()),
  G3: median !== null && median <= 1500 && lat.length === rows.length && Math.max(...lat) <= 3000,
  G4: rows.every(r => r.partials >= 1),
  G5: total <= 2,
};
const result = { rows, medianLatencyMs: median, totalUsd: Number(total.toFixed(5)), gates, react: { frameKinds: frames.map(f => Object.keys(f)[0]), debugDecider: frames.find(f => f.debug)?.debug.decider, memory: frames.find(f => f.memory)?.memory, line: frames.find(f => f.line)?.line } };
console.log(JSON.stringify(result, null, 2));
if (out) await writeFile(out, JSON.stringify(result, null, 2) + '\n');
process.exitCode = Object.values(gates).every(Boolean) ? 0 : 1;
