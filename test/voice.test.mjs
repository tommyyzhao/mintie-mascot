import test from 'node:test';
import assert from 'node:assert/strict';
import { pcm16, downsample, createDownsampler } from '../web/audio-worklet.js';
import { scheduleChunk, decodePCM16 } from '../web/audio.js';
import { createVoice, fuzzyEchoMatch, normalizeText, fluxUrl } from '../web/voice.js';

const sine = (hz, seconds = 1, rate = 48000) => Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin(2 * Math.PI * hz * i / rate));
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);

test('48 kHz → 16 kHz has correct length, preserves voice-band signal, rejects alias', () => {
  const voice = downsample(sine(1000), 48000);
  const alias = downsample(sine(12000), 48000);
  assert.equal(voice.length, 16000);
  assert.ok(Math.abs(rms(voice.subarray(100)) - Math.SQRT1_2) < 0.01);
  assert.ok(rms(alias.subarray(100)) < 0.01, '12 kHz input must not alias into speech band');
  assert.throws(() => downsample([1], 8000), /invalid_sample_rate/);
});

test('streaming resampling preserves phase/filter history across render quanta', () => {
  for (const rate of [44100, 48000]) {
    const input = sine(1600, 1, rate), once = downsample(input, rate), resample = createDownsampler(rate), chunks = [];
    for (let i = 0; i < input.length; i += 128) chunks.push(...resample(input.subarray(i, i + 128)));
    assert.deepEqual(Float32Array.from(chunks), once);
    assert.ok(Math.abs(chunks.length - 16000) <= 1);
  }
});

test('PCM16 clamps, handles non-finite samples, decodes little-endian with byte offsets', () => {
  assert.deepEqual([...pcm16([-2, -1, -0.5, 0, 0.5, 1, 2, NaN, Infinity])],
    [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0]);
  const bytes = Uint8Array.from([255, 0, 128, 255, 127, 0, 0, 255]);
  assert.deepEqual([...decodePCM16(bytes.subarray(1, 7))], [-1, 32767 / 32768, 0]);
  assert.throws(() => decodePCM16(new Uint8Array(1)), /unaligned_pcm/);
});

test('chunks schedule gaplessly; first respects animation lead and 20 ms buffer', () => {
  let timing = scheduleChunk(null, 4, 3, 0.1);
  assert.equal(timing.start, 4);
  for (let i = 0; i < 30; i++) {
    const next = scheduleChunk(timing.end, 4, 3.02 + i * 0.01, 0.1);
    assert.equal(next.start, timing.end);
    timing = next;
  }
  assert.equal(scheduleChunk(null, 1, 3, 0.1).start, 3.02);
  assert.equal(scheduleChunk(1, 0, 2, 0.1).start, 2, 'late chunks cannot schedule in the past');
  assert.throws(() => scheduleChunk(null, NaN, 0, 1), /invalid_schedule/);
});

test('normalization handles Spanish accents, punctuation, whitespace, decomposed marks', () => {
  assert.equal(normalizeText('  ¡Holá, MINTIE! ¿Cómo estás?  '), 'hola mintie como estas');
  assert.equal(normalizeText('NIÑO\n cómo… Sí; pingüino.'), 'nino como si pinguino');
  assert.equal(normalizeText('¿Qué? [giggles] 123'), 'que giggles 123');
  assert.equal(normalizeText(null), '');
});

test('echo guard requires ordered prefix evidence, not word containment', () => {
  assert.ok(fuzzyEchoMatch('Hola, cómo estás', '¡Holá! ¿Cómo estás hoy?'));
  assert.ok(!fuzzyEchoMatch('Hola, cómo', '¡Holá! ¿Cómo estás hoy?'));
  assert.ok(fuzzyEchoMatch('¡Qué ONDA!', 'Que onda'));
  assert.ok(!fuzzyEchoMatch('uno dos tres cuatro cinco', 'uno dos tres'));
  assert.ok(!fuzzyEchoMatch('tres dos uno', 'uno dos tres'));
  assert.ok(!fuzzyEchoMatch('yes', 'I said yes today'));
  assert.ok(!fuzzyEchoMatch('uno dos tres cuatro cinco', 'uno dos'));
  assert.ok(!fuzzyEchoMatch('Me puedes saludar con la mano', '¡Holiii! ¿Qué onda?'));
  assert.ok(!fuzzyEchoMatch('', 'hola'));
  assert.ok(!fuzzyEchoMatch('hola', ''));
});

test('Flux query selects multilingual v2 PCM; token stays out of URL', () => {
  const url = new URL(fluxUrl());
  assert.equal(url.origin, 'wss://api.deepgram.com');
  assert.equal(url.pathname, '/v2/listen');
  assert.equal(url.searchParams.get('model'), 'flux-general-multi');
  assert.equal(url.searchParams.get('encoding'), 'linear16');
  assert.equal(url.searchParams.get('sample_rate'), '16000');
  assert.deepEqual(url.searchParams.getAll('language_hint'), ['en', 'es', 'ru']);
  assert.equal(url.searchParams.get('eot_threshold'), '0.5');
  assert.ok(!url.searchParams.has('token'));
});

test('voice drops echoes and repeated partials before barge-in; new words stop audio, commit resets turn', async t => {
  const saved = Object.fromEntries(['navigator', 'WebSocket', 'AudioWorkletNode', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const connectable = () => ({ connect() { return this; }, disconnect() {} });
  let socket, stops = 0;
  const partials = [], commits = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    userActivation: { isActive: true }, mediaDevices: { getUserMedia: async () => ({
      getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ getSettings: () => ({}) }],
    }) },
  } });
  globalThis.fetch = async () => new Response(JSON.stringify({ token: 'fake' }), { headers: { 'content-type': 'application/json' } });
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor(url, protocols) { assert.deepEqual(protocols, ['bearer', 'fake']); socket = this; setImmediate(() => this.onmessage({ data: '{"type":"Connected"}' })); }
    close() {}
  };
  globalThis.AudioWorkletNode = class { constructor() { Object.assign(this, connectable(), { port: { close() {} } }); } };
  const audio = { currentLine: 'hola bonita', speaking: () => true, stop() { stops++; }, resume: async () => {}, context: { audioWorklet: { addModule: async () => {} }, createMediaStreamSource: connectable, destination: {} } };
  const voice = createVoice({ audio, onPartial: value => partials.push(value.text), onCommit: value => commits.push(value.text) });
  t.after(() => voice.stop());
  await voice.start();
  let turn = 0;
  const send = (text, event = 'Update', index = turn) => socket.onmessage({ data: JSON.stringify({ type: 'TurnInfo', event, transcript: text, turn_index: index }) });
  send('hola bonita'); assert.equal(stops, 0); assert.equal(partials.length, 0);
  send('saluda con la mano', 'StartOfTurn'); assert.equal(stops, 1); assert.equal(partials.length, 1);
  send('¡Salúda con la mano!'); assert.equal(stops, 1); assert.equal(partials.length, 1);
  send('saluda con la mano ahora'); assert.equal(stops, 1); assert.equal(partials.length, 2);
  send('saluda con la mano ahora', 'EndOfTurn'); assert.equal(commits.length, 1);
  send('saluda con la mano ahora', 'EndOfTurn'); send('late partial'); assert.equal(commits.length, 1); assert.equal(partials.length, 2);
  turn++; send('saluda con la mano ahora'); assert.equal(stops, 2); assert.equal(partials.length, 3);
  send('saluda con la mano ahora', 'EndOfTurn');
  turn++; audio.currentLine = ''; audio.echoLines = ['hola bonita', 'mi flor es un girasol'];
  send('mi flor es un girasol'); send('mi flor es un girasol', 'EndOfTurn');
  assert.equal(commits.length, 2); assert.equal(partials.length, 3); assert.equal(stops, 2);
  audio.echoLines = []; turn++;
  send('mi flor es un girasol', 'EndOfTurn'); assert.equal(commits.length, 3);
});
test('gesture requests one microphone immediately; input gate blocks input/turns; late permission cannot resurrect stopped calls', async t => {
  const keys=['navigator','WebSocket','AudioWorkletNode','fetch'];
  const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  const flush=()=>new Promise(r=>setImmediate(r));
  let media=deferred(),mic=0,tokens=0,sources=0,stops=0,commits=0,socket,gesture=true;
  const connectable=()=>({connect(){return this;},disconnect(){}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userActivation:{get isActive(){return gesture;}},mediaDevices:{getUserMedia(){assert.equal(gesture,true);mic++;return media.promise;}}}});
  globalThis.fetch=async()=>{tokens++;return new Response(JSON.stringify({token:'fake'}));};
  globalThis.WebSocket=class{static OPEN=1;constructor(){socket=this;this.readyState=1;setImmediate(()=>this.onmessage?.({data:'{"type":"Connected"}'}));}send(){throw Error('no PCM expected');}close(){}};
  globalThis.AudioWorkletNode=class{constructor(){Object.assign(this,connectable(),{port:{close(){}}});}};
  const states=[];
  const audio={resume:async()=>{},speaking:()=>false,context:{audioWorklet:{addModule:async()=>{}},createMediaStreamSource(){sources++;return connectable();},destination:{}}};
  const voice=createVoice({audio,onState:s=>states.push(s),onCommit(){commits++;}});t.after(()=>voice.stop());
  const gate=deferred(),stream={getTracks:()=>[{stop(){stops++;}}]};
  const started=voice.start({inputReady:gate.promise});assert.equal(mic,1);gesture=false;media.resolve(stream);await flush();await flush();
  assert.equal(sources,0);socket.onmessage({data:JSON.stringify({type:'TurnInfo',event:'EndOfTurn',transcript:'interrupt gate',turn_index:0})});assert.equal(commits,0);
  gate.resolve();await started;assert.equal(sources,1);assert.equal(states.filter(s=>s==='listening').length,1);
  const retry=deferred();voice.start({inputReady:retry.promise});assert.equal(mic,1);assert.equal(tokens,1);retry.resolve();await flush();assert.equal(sources,1);
  voice.stop();assert.equal(stops,1);
  media=deferred();gesture=true;const pending=voice.start();assert.equal(mic,2);gesture=false;voice.stop();media.resolve(stream);await pending;await flush();assert.equal(stops,2);assert.equal(sources,1);assert.equal(states.at(-1),'idle');
  media=deferred();gesture=true;const later=deferred(),waiting=voice.start({inputReady:later.promise});media.resolve(stream);await flush();await flush();voice.stop();later.resolve();await waiting;await flush();assert.equal(sources,1);assert.equal(states.at(-1),'idle');
  media=deferred();gesture=true;globalThis.fetch=async()=>new Response('{}',{status:503});const failed=voice.start();await failed;assert.equal(states.at(-1),'error');const before=stops;media.resolve(stream);await flush();assert.equal(stops,before+1);assert.equal(sources,1);assert.equal(states.at(-1),'error');
  globalThis.navigator.mediaDevices.getUserMedia=()=>{throw new DOMException('denied','NotAllowedError');};await assert.rejects(voice.start(),{name:'NotAllowedError'});assert.equal(states.at(-1),'error');
});

test('fluxUrl eot option; default stays 0.7', () => {
  assert.equal(new URL(fluxUrl()).searchParams.get('eot_threshold'), '0.5');
  assert.equal(new URL(fluxUrl({ eot: 0.5 })).searchParams.get('eot_threshold'), '0.5');
});
