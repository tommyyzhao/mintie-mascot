import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnergyVAD, createVoice } from '../web/voice.js';

const frame = (energy, ms = 100) => {
  const bytes = new ArrayBuffer(ms * 32), view = new DataView(bytes);
  for (let i = 0; i < bytes.byteLength; i += 2) view.setInt16(i, Math.round(energy * 32767) * (i % 4 ? -1 : 1), true);
  return bytes;
};
test('energy VAD only emits 250ms pause nods, once per pause; suppresses TTS and 100ms tail', () => {
  let clock = 0; const pauses = [];
  const vad = createEnergyVAD({ onPause: x => pauses.push(x) });
  const push = (energy, ms, speaking = false) => { clock += ms; vad.push(frame(energy, ms), clock, speaking); };
  push(.002, 500); push(.08, 100); push(0, 400); assert.equal(pauses.length, 0);
  push(.08, 500); push(0, 240); assert.equal(pauses.length, 0);
  push(0, 20); assert.equal(pauses.length, 1); assert.equal(pauses[0].detectedAt - pauses[0].at, 260);
  push(0, 5000); assert.equal(pauses.length, 1);
  push(.08, 500); push(0, 260); assert.equal(pauses.length, 2);
  push(.08, 500, true); push(.08, 80); push(0, 600); assert.equal(pauses.length, 2);
  vad.reset(); push(0, 1000); assert.equal(pauses.length, 2);
});
test('energy VAD pause threshold is configurable', () => {
  let clock = 0; const pauses = [];
  const vad = createEnergyVAD({ onPause: x => pauses.push(x), pauseMs: 200 });
  const push = (energy, ms) => { clock += ms; vad.push(frame(energy, ms), clock); };
  push(.002, 500); push(.08, 500); push(0, 180); assert.equal(pauses.length, 0); push(0, 20); assert.equal(pauses.length, 1);
});

async function fixture(t, options = {}) {
  const saved = Object.fromEntries(['navigator', 'WebSocket', 'AudioWorkletNode', 'fetch', 'performance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let socket, worklet, clock = 0, tracksStopped = 0, stops = 0, speaking = false;
  const connectable = () => ({ connect() { return this; }, disconnect() {} });
  const sent = [], ends = [], starts = [], commits = [], errors = [], states = [], pauses = [], cancels = [];
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { isActive: true }, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { tracksStopped++; } }] }) } } });
  globalThis.fetch = async () => Response.json({ token: 'fake' });
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor(url, protocols) { socket = this; this.readyState = 1; this.bufferedAmount = 0; setImmediate(() => this.onmessage({ data: '{"message_type":"session_started"}' })); }
    close() {}
    send(value) { sent.push(value); }
  };
  globalThis.AudioWorkletNode = class { constructor() { worklet = this; Object.assign(this, connectable(), { port: { close() {} } }); } };
  const audio = { echoLines: [], speaking: () => speaking, stop() { stops++; speaking = false; }, resume: async () => {}, context: { audioWorklet: { addModule: async () => {} }, createMediaStreamSource: connectable, destination: {} } };
  const voice = createVoice({ audio, onSpeechEnd: x => ends.push(x), onSpeechStart: x => starts.push(x), onCommit: x => commits.push(x), onError: x => errors.push(x), onState: x => states.push(x), onPause: x => pauses.push(x), onSpeechCancel: () => cancels.push(true), ...options });
  t.after(() => { voice.stop(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await voice.start();
  return { voice, audio, sent, starts, ends, commits, errors, states, pauses, cancels,
    advance(ms) { clock += ms; },
    speaking(value) { speaking = value; }, stops: () => stops, tracksStopped: () => tracksStopped,
    send(message) { socket.onmessage?.({ data: JSON.stringify(message) }); },
    turn(event, transcript = '') { if (event === 'EndOfTurn') this.send({ message_type: 'committed_transcript', text: transcript }); else if (transcript) this.send({ message_type: 'partial_transcript', text: transcript }); },
    frame(energy, ms = 100) { clock += ms; worklet.port.onmessage?.({ data: frame(energy, ms) }); },
    socket: () => socket,
  };
}
test('base64 PCM chunks, first words open a turn, commit closes it; speech end is the last voiced frame', async t => {
  const f = await fixture(t);
  f.frame(.08, 600); f.turn('StartOfTurn', 'hola');
  f.frame(0, 1000); assert.equal(f.ends.length, 0); assert.equal(f.commits.length, 0); assert.equal(f.pauses.length, 1);
  assert.ok(f.sent.every(x => JSON.parse(x).message_type === 'input_audio_chunk' && JSON.parse(x).commit === false));
  f.turn('EndOfTurn', 'hola');
  assert.equal(f.starts.length, 1); assert.equal(f.ends.length, 1); assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].speechEndAt, 600); assert.equal(f.commits[0].committedAt, 1600);
  f.turn('EndOfTurn', ''); assert.equal(f.commits.length, 1); assert.equal(f.starts.length, 1); // silence commit opens nothing
  f.turn('Update', 'hola de nuevo'); f.turn('EndOfTurn', 'hola de nuevo');
  assert.equal(f.commits.length, 2); assert.equal(f.starts.length, 2);
});
test('echo onset during playback waits for non-echo words; barge-in stops audio once; echo final consumed', async t => {
  const f = await fixture(t); f.audio.echoLines = ['hola bonita']; f.speaking(true);
  f.turn('StartOfTurn'); f.turn('Update', 'hola bonita'); assert.equal(f.starts.length, 0); assert.equal(f.stops(), 0);
  f.turn('Update', 'please wave'); assert.equal(f.starts.length, 1); assert.equal(f.stops(), 1);
  f.turn('Update', 'please wave again'); assert.equal(f.starts.length, 1);
  f.turn('EndOfTurn', 'please wave again'); assert.equal(f.commits.length, 1);
  f.turn('EndOfTurn', 'hola bonita', 1); assert.equal(f.commits.length, 1); assert.equal(f.ends.length, 1);
  f.audio.echoLines = []; f.turn('EndOfTurn', 'hola bonita', 2); assert.equal(f.commits.length, 2);
});
test('delayed echo remains suppressed after playback references expire; admitted empty turn cancels', async t => {
  const f = await fixture(t); f.audio.echoLines = ['hola bonita']; f.speaking(true); f.frame(.08);
  f.turn('StartOfTurn', 'hola bonita'); f.speaking(false); f.audio.echoLines = []; f.advance(5000);
  f.turn('EndOfTurn', 'hola bonita'); assert.equal(f.commits.length, 0);
  f.turn('Update', 'hola'); f.turn('EndOfTurn', '');
  assert.equal(f.cancels.length, 1); assert.equal(f.ends.length, 0);
});
test('pause predating provider onset replays once on admission; capture interruptions update sample clock', async t => {
  const f = await fixture(t); f.frame(.08, 600); f.frame(0, 300);
  assert.equal(f.pauses.length, 0);
  f.turn('StartOfTurn', 'hello'); assert.equal(f.pauses.length, 1);
  f.turn('Update', 'hello there'); assert.equal(f.pauses.length, 1);
  f.advance(3000); f.frame(.08, 100); f.frame(0, 300);
  f.turn('EndOfTurn', 'hello there');
  assert.equal(f.commits[0].speechEndAt, 4000);
});
test('fatal provider prose sanitized; owned resources stop; fresh user start reconnects', async t => {
  const f = await fixture(t);
  f.send({ message_type: 'quota_exceeded', error: 'private token and transcript' });
  assert.deepEqual(f.errors, [{ stage: 'stt', code: 'provider_error' }]);
  assert.equal(f.tracksStopped(), 1); assert.equal(f.states.at(-1), 'error');
  await f.voice.start(); assert.equal(f.states.at(-1), 'listening');
  f.socket().onclose({ code: 1006, reason: 'private' });
  assert.deepEqual(f.errors.at(-1), { stage: 'stt', code: 'socket_closed', status: 1006 });
});
test('malformed input and audio backpressure fail closed', async t => {
  const f = await fixture(t); f.send(null); assert.equal(f.errors.at(-1).code, 'invalid_message');
  await f.voice.start(); f.send({ message_type: 'partial_transcript', text: 5 }); assert.equal(f.errors.at(-1).code, 'invalid_message');
  await f.voice.start(); f.socket().bufferedAmount = 64001; f.frame(.08); assert.equal(f.errors.at(-1).code, 'audio_backpressure');
});
test('energy VAD onset fires once per turn after 120 ms of voicing, never during TTS', () => {
  let clock = 0; const onsets = [];
  const vad = createEnergyVAD({ onOnset: x => onsets.push(x) });
  const push = (energy, ms, speaking = false) => { clock += ms; vad.push(frame(energy, ms), clock, speaking); };
  push(.002, 500); push(.08, 100); assert.equal(onsets.length, 0);
  push(.08, 100); assert.equal(onsets.length, 1); assert.equal(onsets[0].detectedAt, 700); assert.ok(onsets[0].at <= 520);
  push(0, 400); push(.08, 300); assert.equal(onsets.length, 1);
  vad.reset(); push(.08, 500, true); push(.08, 80); assert.equal(onsets.length, 1);
  push(0, 400); push(.08, 200); assert.equal(onsets.length, 2);
});
