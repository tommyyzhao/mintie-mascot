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

test('arrival waits for drawn frames, plays once without requests', () => {
  const code = source.slice(source.indexOf('  if (arrivalPending && debug.frame.count > 1'), source.indexOf('  frameId = requestAnimationFrame(tick);'));
  const waves = [], history = [];
  const context = vm.createContext({ arrivalPending: true, arrivalWave: null, debug: { frame: { count: 0 } },
    performer: { active: () => null, play: emoji => (waves.push(emoji), {}) }, speechActive: false, pointer: null, remember: entry => history.push(entry), fetch: () => { throw Error('unexpected network'); } });
  const frame = count => { context.debug.frame.count = count; vm.runInContext(code, context); };
  frame(0); frame(1); assert.equal(waves.length, 0); // No draw, or first draw only.
  frame(2); frame(3);
  assert.deepEqual(waves, ['👋']); assert.equal(JSON.stringify(history), '[{"who":"mintie","emoji":"👋","said":null}]');
});

test('no name prompt anywhere in the shell', async () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  for (const [file, text] of [['main.js', source], ['index.html', html], ['styles.css', css]]) assert.doesNotMatch(text, /name-dialog|name-input|name-form|edit-name|companionName|mintie-name|name-link/, file);
  assert.doesNotMatch(html + source, /sunflower|pet_flower|'flower'|orbit/);
});

test('guard errors map to kind copy, only for failures, and never touch the dock buttons', () => {
  const code = source.slice(source.indexOf('const GUARD ='), source.indexOf('const hint ='));
  const texts = [], classes = {}, nodes = { status: { set textContent(v) { texts.push(v); }, classList: { toggle: (k, v) => { classes[k] = v; } } }, controls: { dataset: {} } };
  const context = vm.createContext({ $: id => nodes[id], debugPanel: null, disposed: false, voiceAvailable: true, reactAvailable: true, showVoiceState() {}, setTimeout: () => 1, clearTimeout() {},
    window: { fetch: () => {} , location: {} }, location: { origin: 'x', href: 'x' }, URL, Response, ensureSession: async () => {}, document: {} });
  vm.runInContext(code.slice(0, code.indexOf('// Paid routes')), context);
  vm.runInContext("status('Tap Talk to chat.')", context); assert.equal(texts.at(-1), 'Tap Talk to chat.');
  vm.runInContext("guardNotice('daily_limit')", context);
  assert.match(texts.at(-1), /resting until tomorrow — you can still play/); assert.equal(nodes.controls.dataset.resting, 'true');
  assert.equal(context.voiceAvailable, false);
  vm.runInContext("status('Their response did not come through. Try again.')", context); assert.match(texts.at(-1), /resting until tomorrow/);
  vm.runInContext("status('Microphone off. You can keep playing.')", context); assert.equal(texts.at(-1), 'Microphone off. You can keep playing.');
  vm.runInContext("guardNotice('nope')", context); // unknown codes are ignored
  assert.match(source, /!response\.ok && \[403, 429\]\.includes\(response\.status\)/);
});

test('paid routes get one human-check retry; other routes and origins pass straight through', async () => {
  const code = source.slice(source.indexOf('const nativeFetch ='), source.indexOf('const hint ='));
  const calls = [], sessions = [], notices = [];
  let replies = [];
  const context = vm.createContext({ URL, Response, location: { origin: 'http://a', href: 'http://a/' }, guardNotice: c => notices.push(c),
    ensureSession: async o => { sessions.push(o?.force ?? false); },
    window: { fetch: async (url) => { calls.push(String(url)); return replies.shift(); } } });
  context.window.fetch.bind = () => context.window.fetch;
  vm.runInContext(code + '\nthis.go = window.fetch;', context);
  const err = (status, code) => Response.json({ error: { stage: 's', code } }, { status });
  replies = [new Response('ok')]; await context.go('/api/health'); assert.deepEqual(sessions, []); // free route: no check
  replies = [err(403, 'human_check'), new Response('ok')];
  assert.equal((await context.go('/api/react', {})).status, 200); assert.deepEqual(sessions, [false, true]); assert.equal(calls.length, 3); assert.deepEqual(notices, []);
  sessions.length = 0; replies = [err(429, 'daily_limit')];
  assert.equal((await context.go('/api/say', {})).status, 429); assert.deepEqual(notices, ['daily_limit']);
  replies = [err(403, 'human_check'), err(403, 'human_check')];
  await context.go('/api/stt-token', {}); assert.deepEqual(notices, ['daily_limit', 'human_check']);
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
