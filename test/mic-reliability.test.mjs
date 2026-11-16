import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createVoice as currentVoice } from '../web/voice.js';

const createVoice = process.env.MIC_BASELINE_SOURCE
  ? (await import(pathToFileURL(process.env.MIC_BASELINE_SOURCE))).createVoice : currentVoice;
const baseline = !!process.env.MIC_BASELINE_SOURCE;
const results = [];

async function fixture(t) {
  const keys = ['performance', 'navigator', 'WebSocket', 'AudioWorkletNode', 'fetch'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let clock = 0, socket, worklet, playing = false, filler = false, refs = [], stops = 0;
  const starts = [], commits = [], cancels = [], diagnostics = [], partials = [], onsets = [];
  const connectable = () => ({ connect() { return this; }, disconnect() {} });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { isActive: true }, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  globalThis.fetch = async () => Response.json({ token: 'synthetic' });
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor() { socket = this; this.readyState = 1; this.bufferedAmount = 0; setImmediate(() => this.onmessage({ data: '{"message_type":"session_started"}' })); }
    close() {}
    send() {}
  };
  globalThis.AudioWorkletNode = class { constructor() { worklet = this; Object.assign(this, connectable(), { port: { close() {} } }); } };
  const audio = {
    get echoLines() { return refs.filter(r => clock <= r.endAt + 4000).map(r => r.line); },
    get echoReferences() { return refs; },
    speaking: () => playing || filler, speakingWords: () => playing,
    stop() { playing = filler = false; stops++; }, resume: async () => {},
    context: { audioWorklet: { addModule: async () => {} }, createMediaStreamSource: connectable, destination: {} },
  };
  const voice = createVoice({ audio, onSpeechStart: x => starts.push(x), onCommit: x => commits.push(x), onPartial: x => partials.push(x), onSpeechCancel: () => cancels.push(true), onDiagnostic: x => diagnostics.push(x), onOnset: x => onsets.push(x) });
  t.after(() => { voice.stop(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await voice.start();
  return { starts, commits, cancels, diagnostics, partials, onsets, stops: () => stops,
    at(at) { clock = at; },
    playback(line, startAt, endAt) { refs = [{ line, startAt, endAt }]; playing = clock >= startAt && clock < endAt; },
    filler() { filler = true; },
    frame(energy = .08, ms = 100) {
      clock += ms;
      const bytes = new ArrayBuffer(ms * 32), view = new DataView(bytes);
      // Synthetic user's energy plus 15% output leakage; never a real microphone.
      for (let i = 0; i < bytes.byteLength / 2; i++) view.setInt16(i * 2, Math.round(32767 * (energy * Math.sin(2 * Math.PI * 220 * i / 16000) + (playing || filler ? .015 : 0) * Math.sin(2 * Math.PI * 440 * i / 16000))), true);
      worklet.port.onmessage({ data: bytes });
    },
    turn(event, transcript = '') { socket.onmessage({ data: JSON.stringify(event === 'EndOfTurn' ? { message_type: 'committed_transcript', text: transcript } : { message_type: 'partial_transcript', text: transcript }) }); },
  };
}

test('synthetic playback boundary matrix preserves short replies and merged barge-ins', async t => {
  for (const phase of ['start', 'end']) for (const offset of [0, 100, 250, 500, 1000, 2000, 4000]) {
    await t.test(`${phase}+${offset}ms`, async t => {
      const f = await fixture(t), at = (phase === 'end' ? 5000 : 0) + offset;
      f.at(at); f.playback('Hello there, yes I feel that way too', 0, 5000);
      f.frame(.08, 20);
      for (const [turn, text] of ['hello', 'yes', 'me too'].entries()) {
        f.turn('StartOfTurn', text, turn); f.turn('EndOfTurn', text, turn);
      }
      const lost = 4 - f.commits.reduce((n, x) => n + x.text.split(/\s+/).length, 0);
      results.push({ scenario: `${phase}+${offset}`, userWordsLost: lost, turnsLost: 3 - f.commits.length, cancelledTurns: f.cancels.length, admissionMs: f.starts.length ? f.starts[0].at - (at + 20) : null });
      if (!baseline) { assert.equal(lost, 0); assert.equal(f.commits.length, 3); assert.equal(f.starts.length, 3); }
    });
  }
  await t.test('echo prefix followed by one user word', async t => {
    const f = await fixture(t); f.at(1500); f.playback('I like sunshine and warm summer days', 0, 5000); f.frame();
    const text = 'I like sunshine and warm summer days yes';
    f.turn('StartOfTurn', text); f.turn('EndOfTurn', text);
    results.push({ scenario: 'merged', userWordsLost: f.commits.some(x => x.text === 'yes') ? 0 : 1, turnsLost: 1 - f.commits.length, cancelledTurns: f.cancels.length, admissionMs: f.starts.length ? f.starts[0].at - 1600 : null });
    if (!baseline) { assert.equal(f.commits[0]?.text, 'yes'); assert.equal(f.partials[0]?.text, 'yes'); assert.equal(f.stops(), 1); assert.equal(f.diagnostics.filter(x => x.mergedTurnsTrimmed).length, 1); }
  });
});

test('own voice suppressed, delayed final retained, subsequent turn admitted', async t => {
  const f = await fixture(t); f.at(500); f.playback('I like sunshine and warm summer days', 0, 1000); f.frame();
  f.turn('StartOfTurn', 'I'); f.turn('Update', 'I like');
  if (!baseline) { assert.equal(f.starts.length, 0); assert.equal(f.stops(), 0); }
  f.turn('Update', 'I like sunshine');
  f.at(6000); f.playback('', 0, 0);
  f.turn('EndOfTurn', 'I like sunshine and warm summer days');
  assert.equal(f.commits.length, 0);
  f.turn('StartOfTurn', 'yes', 1); f.turn('EndOfTurn', 'yes', 1);
  assert.equal(f.commits.length, 1);
});

test('playback observed without a provider turn cannot poison a later reply', async t => {
  const f = await fixture(t); f.at(500); f.playback('I like sunshine and warm summer days', 0, 1000); f.frame();
  f.at(6000); f.playback('I like sunshine and warm summer days', 0, 1000);
  f.turn('StartOfTurn', 'I like sunshine and warm summer days');
  f.turn('EndOfTurn', 'I like sunshine and warm summer days');
  results.push({ scenario: 'session-cache', userWordsLost: f.commits.length ? 0 : 7, turnsLost: 1 - f.commits.length });
  if (!baseline) assert.equal(f.commits.length, 1);
});

test('timed references protect delayed finals without poisoning a later overlapping reply', async t => {
  const f = await fixture(t); f.at(500); f.playback('I like sunshine and warm summer days', 0, 1000); f.frame();
  f.turn('StartOfTurn', 'I like sunshine');
  f.at(6000);
  f.turn('EndOfTurn', 'I like sunshine and warm summer days');
  assert.equal(f.commits.length, 0);
  f.turn('StartOfTurn', 'I like sunshine and warm summer days', 1);
  f.turn('EndOfTurn', 'I like sunshine and warm summer days', 1);
  results.push({ scenario: 'expired-reference', turnsLost: 1 - f.commits.length });
  if (!baseline) assert.equal(f.commits.length, 1);
});

test('ordered echo suffix is removed, final-only user turn still barges in', async t => {
  const f = await fixture(t); f.at(1500); f.playback('I like sunshine and warm summer days', 0, 5000); f.frame();
  f.turn('EndOfTurn', 'warm summer days No, please stop!');
  if (!baseline) { assert.equal(f.commits[0]?.text, 'No, please stop!'); assert.equal(f.starts.length, 1); assert.equal(f.stops(), 1); }
});

test('partial echo prefix followed by user words keeps remainder; pure echo cancels diagnostically', async t => {
  const f = await fixture(t); f.at(1500); f.playback('I like sunshine and warm summer days', 0, 5000); f.frame();
  f.turn('StartOfTurn', 'I like sunshine no thanks'); f.turn('EndOfTurn', 'I like sunshine no thanks');
  if (!baseline) assert.equal(f.commits[0]?.text, 'no thanks');
  f.turn('StartOfTurn', 'I like sunshine', 1); f.turn('EndOfTurn', 'I like sunshine', 1);
  if (!baseline) {
    assert.equal(f.commits.length, 1);
    assert.equal(f.diagnostics.reduce((n, x) => n + (x.cancelledTurns ?? 0), 0), 1);
    assert.equal(f.diagnostics.reduce((n, x) => n + (x.echoDropped ?? 0), 0), 2);
    for (const entry of f.diagnostics) for (const value of Object.values(entry)) assert.equal(typeof value, 'number');
  }
});

test('bare onset plus short reply must not cancel the admitted user turn', async t => {
  const f = await fixture(t); f.at(1500); f.playback('Yes I like sunshine', 0, 1000);
  f.turn('StartOfTurn'); f.turn('Update', 'yes'); f.turn('EndOfTurn', 'yes');
  results.push({ scenario: 'admitted-cancellation', turnsLost: 1 - f.commits.length, cancelledTurns: f.cancels.length });
  if (!baseline) { assert.equal(f.commits[0]?.text, 'yes'); assert.equal(f.cancels.length, 0); }
});

test('local onset recovers promptly after speech stops', async t => {
  const f = await fixture(t); f.playback('I like sunshine', 0, 100); f.frame(.08, 100);
  f.playback('I like sunshine', 0, 100);
  for (let i = 0; i < 25; i++) f.frame(.08, 20);
  const onsetMsAfterSpeech = f.onsets[0]?.detectedAt - 100;
  results.push({ scenario: 'local-recovery', onsetMsAfterSpeech });
  if (!baseline) assert.ok(onsetMsAfterSpeech <= 220);
});

test('post-playback local blocking is measured without blocking provider admission', async t => {
  const f = await fixture(t); f.playback('I like sunshine', 0, 200); f.frame(.08, 200);
  f.at(200); f.playback('I like sunshine', 0, 200); f.frame(.08, 20);
  f.turn('StartOfTurn', 'yes'); f.turn('EndOfTurn', 'yes');
  if (!baseline) { assert.equal(f.diagnostics.reduce((n, x) => n + (x.msBlockedAfterSpeech ?? 0), 0), 20); assert.equal(f.commits.length, 1); }
});

test('filler energy does not block local onset; diagnostics contain numbers only', async t => {
  const f = await fixture(t); f.filler(); f.frame(); f.frame();
  results.push({ scenario: 'filler', onsets: f.onsets.length });
  if (!baseline) assert.equal(f.onsets.length, 1);
  for (const entry of f.diagnostics) for (const value of Object.values(entry)) assert.equal(typeof value, 'number');
});

test.after(async () => {
  if (process.env.MIC_EVIDENCE) await writeFile(process.env.MIC_EVIDENCE, JSON.stringify(results, null, 2) + '\n');
});
