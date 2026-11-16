import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/main.js', import.meta.url), 'utf8');
function setup() {
  let now = 0, timer, speaking = false, ended = [], hidden;
  const context = vm.createContext({
    performance: { now: () => now }, audio: { speaking: () => speaking },
    setInterval: fn => (timer = fn, 1), clearInterval: () => { timer = null; },
    end: reason => { ended.push(reason); context.clearLimits(); },
    document: { visibilityState: 'visible', addEventListener: (_, fn) => { hidden = fn; } },
    voiceWanted: true,
  });
  vm.runInContext(source.slice(source.indexOf('let limitTimer,'), source.indexOf('const voice = createVoice')), context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('visibilitychange'"), source.indexOf('function setReduced')), context);
  return { context, ended, advance(ms) { for (let i = 0; i < ms; i += 250) { now += 250; timer?.(); } },
    speak(value) { speaking = value; }, hide() { context.document.visibilityState = 'hidden'; hidden(); }, active: () => !!timer };
}

test('name submit calls shared starter synchronously, including while health is loading', () => {
  let submit, clicks = 0, message = '', focused = '';
  const nodes = Object.fromEntries(['name-form', 'name-input', 'name-dialog', 'talk', 'end', 'status'].map(id => [id, {}]));
  nodes['name-form'].addEventListener = (_, fn) => { submit = fn; };
  nodes['name-input'].value = 'Alex'; nodes['name-dialog'].close = () => {};
  nodes.talk.click = () => { clicks++; context.voiceWanted = true; };
  for (const id of ['talk', 'end', 'status']) nodes[id].focus = () => { focused = id; };
  const context = vm.createContext({ $: id => nodes[id], companionName:'', end(){context.voiceWanted=false;}, startCall(){if(context.voiceWanted || context.healthAnswered && !context.voiceAvailable)return;clicks++;context.voiceWanted=true;}, validName: () => true, localStorage: { setItem() {} }, interact() {}, status: value => { message = value; }, voiceAvailable: true, voiceWanted: false, healthAnswered: true });
  vm.runInContext(source.slice(source.indexOf("$('name-form').addEventListener"), source.indexOf("$('name-input').addEventListener")), context);
  const send = () => submit({ preventDefault() {} });
  send(); assert.equal(clicks, 1); assert.equal(focused, 'end');
  send(); assert.equal(clicks, 1); // Rename during call.
  context.voiceWanted = false; context.voiceAvailable = false; send(); assert.equal(clicks, 1);
  context.healthAnswered = false; send(); assert.equal(clicks, 2); assert.equal(focused, 'end');
});

test('arrival waits for drawn frames and dialog, plays once without requests', () => {
  const code = source.slice(source.indexOf('  if (arrivalPending && debug.frame.count > 1'), source.indexOf('  frameId = requestAnimationFrame(tick);'));
  const waves = [], history = [];
  const context = vm.createContext({ companionName:'Alex', arrivalPending: true, arrivalWave: null, debug: { frame: { count: 0 } }, $: () => ({ open: context.dialogOpen }), dialogOpen: false,
    performer: { active: () => null, play: emoji => (waves.push(emoji), {}) }, speechActive: false, pointer: null, remember: entry => history.push(entry), fetch: () => { throw Error('unexpected network'); } });
  const frame = count => { context.debug.frame.count = count; vm.runInContext(code, context); };
  frame(0); frame(1); assert.equal(waves.length, 0); // No draw, or first draw only.
  context.dialogOpen = true; frame(2); assert.equal(waves.length, 0);
  context.dialogOpen = false; frame(3); frame(4);
  assert.deepEqual(waves, ['👋']); assert.equal(JSON.stringify(history), '[{"who":"mintie","emoji":"👋","said":null}]');
});

test('quiet timeout and speech reset', () => {
  const x = setup(); x.context.startLimits(); x.advance(119750); assert.equal(x.ended.length, 0);
  x.context.speechActivity(); x.advance(119750); assert.equal(x.ended.length, 0);
  x.advance(250); assert.match(x.ended[0], /two quiet minutes/); assert.equal(x.active(), false);
});

test('Mintie speaking pauses quiet time without resetting it', () => {
  const x = setup(); x.context.startLimits(); x.advance(60000); x.speak(true); x.advance(120000);
  assert.equal(x.ended.length, 0); x.speak(false); x.advance(60000); assert.match(x.ended[0], /two quiet minutes/);
});

test('hidden tab and total duration end conversation', () => {
  const x = setup(); x.context.startLimits(); x.hide(); assert.match(x.ended[0], /tab was hidden/); assert.equal(x.active(), false);
  const y = setup(); y.context.startLimits(); y.speak(true); y.advance(899750); assert.equal(y.ended.length, 0);
  y.advance(250); assert.match(y.ended[0], /15 minutes/); assert.equal(y.active(), false);
});

test('End, dispose and error wire timer cleanup', () => {
  assert.match(source, /function end\([^]*?clearLimits\(\)/);
  assert.match(source, /function dispose\(\)[^]*?\bend\(\)/);
  assert.match(source, /state === 'idle' \|\| state === 'error'[^]*?clearLimits\(\)/);
  assert.match(source, /voice\.start\(\{ inputReady \}\)\.catch\([^]*?clearLimits\(\)/);
  for (const reason of ['end', 'dispose', 'error']) {
    const x = setup(); x.context.startLimits(); x.context.clearLimits(); x.advance(1000000);
    assert.equal(x.active(), false, reason); assert.deepEqual(x.ended, [], reason);
  }
});
