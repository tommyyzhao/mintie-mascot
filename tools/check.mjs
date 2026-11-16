import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { dirname } from 'node:path';
import { createApp } from '../server/server.mjs';
import { CATALOG } from '../web/perform/emoji.js';
import { percentile } from './perf-app.mjs';

const {values}=parseArgs({options:{quick:{type:'boolean'},port:{type:'string',default:'0'}}});
const portOption=Number(values.port);
assert(Number.isInteger(portOption)&&portOption>=0&&portOption<=65535,'Invalid port');
const run = promisify(execFile), quick = !!values.quick;
const root = fileURLToPath(new URL('../', import.meta.url));
const out = fileURLToPath(new URL('./artifacts/check/', import.meta.url));
const server = http.createServer(createApp({ webRoot: `${root}web`, threeDir: dirname(fileURLToPath(import.meta.resolve('three'))), catalog: CATALOG, keys: {}, fetch: () => { throw Error('Provider forbidden'); } }));
const rows = [], started = performance.now();
let browser;
async function check(name, fn) {
  try { const detail = await fn(); rows.push({ check: name, status: 'PASS', detail: detail ?? '' }); }
  catch (error) { rows.push({ check: name, status: 'FAIL', detail: String(error.stack || error) }); }
}
try {
  server.listen(portOption, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  assert(port < 8090 || port > 8120, 'Unexpected reserved ephemeral port');
  const base = `http://127.0.0.1:${port}`;
  await check('unit', async () => {
    const files = (await readdir(`${root}test`)).filter(f => f.endsWith('.test.mjs')).sort().map(f => `${root}test/${f}`);
    const { stdout } = await run(process.execPath, ['--test', ...files], { timeout: 60000, maxBuffer: 4e6 });
    return stdout.match(/ℹ tests \d+/)?.[0] ?? 'passed';
  });
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), headless: true, args: ['--enable-gpu', '--enable-webgl', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])], ignoreDefaultArgs: ['--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2, permissions: [] });
  const errors = [], external = [];
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); external.push(url.href); return route.abort(); });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.__micCalls = 0; navigator.mediaDevices.getUserMedia = () => { window.__micCalls++; return Promise.reject(Error('Microphone forbidden')); }; });
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, stt: true, react: true, say: true } }));
  await page.route('**/api/stt-token', route => route.fulfill({ status: 403, body: '{}' }));
  await check('smoke', async () => {
    await page.goto(base); await page.waitForFunction(() => window.__mintie?.ready);
    assert.equal(await page.locator('#name-dialog').isVisible(),true);
    await page.waitForFunction(() => !document.getElementById('talk').disabled);
    await page.locator('#name-input').fill('Alex');await page.locator('#name-input').press('Enter');
    assert.equal(await page.evaluate(() => window.__micCalls), 1);
    await page.route('**/api/health', route => route.fulfill({ json: { ok: false, stt: false, react: false, say: false } }));
    await page.reload(); await page.waitForFunction(() => window.__mintie?.ready);
    assert.equal(await page.locator('#name-dialog').isVisible(),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('mintie-name')),'Alex');
    await page.locator('#emotions').click(); await page.locator('#edit-name').click();await page.locator('#name-input').fill('María');await page.locator('#name-input').press('Enter');
    assert.equal(await page.evaluate(()=>localStorage.getItem('mintie-name')),'María');
    assert.equal(await page.locator('[data-emoji]').count(), Object.keys(CATALOG).length);
    assert.deepEqual(await page.locator('#character').boundingBox(), { x: 0, y: 0, width: 1512, height: 982 });
    assert.equal(await page.locator('#slow, #reduced, .readouts, #live-status, .panel').count(), 0);
    const dock = await page.locator('#controls').boundingBox();
    assert.ok(Math.abs(dock.x + dock.width / 2 - 756) < 1 && dock.y > 850 && dock.height >= 60);
    await page.locator('#emotions').click();
    await page.waitForFunction(() => document.getElementById('emotions').getAttribute('aria-expanded') === 'true');
    for (const button of ['#emotions', '#edit-name', '[data-emoji="👋"]']) {
      const target = await page.locator(button).boundingBox(); assert.ok(target.width >= 44 && target.height >= 44, button);
    }
    assert.equal(await page.locator('.masthead, #last-reaction').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
    assert.equal(await page.evaluate(() => document.elementFromPoint(15, innerHeight / 2).id), 'character');
    for (const emoji of ['👋', '❤️', '😂']) { await page.locator(`[data-emoji="${emoji}"]`).click(); await page.waitForFunction(e => window.__mintie.performer.active()?.emoji === e, emoji); }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('emotions').getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'emotions');
    const box = await page.locator('#character').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * .57);
    await page.waitForFunction(() => window.__mintie.lastTouch?.kind === 'poke');
    assert.equal(await page.evaluate(() => window.__mintie.history().some(x=>x.who === 'touch' && x.kind === 'poke')), true);
    assert.equal(await page.evaluate(() => window.__mintie.lastRun?.source === 'touch'), false); // Keyless: physics/sfx only.
    await page.locator('#character').focus();
    for (const [key, kind] of [[' ', 'poke'], ['p', 'pat'], ['f', 'pet_flower']]) { await page.keyboard.press(key); await page.waitForFunction(k => window.__mintie.lastTouch?.kind === k, kind); }
    await page.keyboard.down('l'); await page.waitForFunction(() => window.__mintie.lastTouch?.kind === 'lift'); await page.keyboard.up('l');
    const lastTouch = await page.evaluate(() => window.__mintie.lastTouch); assert.ok(lastTouch.durationMs >= 0 && lastTouch.path >= 0 && Number.isFinite(lastTouch.height));
    await page.mouse.move(box.x + box.width * .85, box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .85 - 270, box.y + box.height * .2, { steps: 12 }); await page.mouse.up(); await page.mouse.wheel(0, -200);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true');
    assert.equal(await page.evaluate(() => window.__micCalls), 0); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    return 'full-viewport stage, centered glass dock, 44px targets, popover/Escape focus, palette, poke, keyboard, automatic reduced motion';
  });
  await check('captions and mobile dock', async () => {
    await page.reload(); await page.waitForFunction(() => window.__mintie?.ready);
    for (const [input, expected] of [
      ['[giggles] ay qué cute', 'ay qué cute'], ['(laughs) no way', 'no way'],
      ['*sighs* okay', 'okay'], ["I said (that's mine) ok", "I said (that's mine) ok"],
      ['hola [gig', 'hola'], ['[giggles] , ay', 'ay'],
    ]) {
      await page.evaluate(value => window.__mintie.captions.said(value), input);
      assert.equal(await page.locator('#said').textContent(), expected);
      assert.equal(await page.locator('#caption-announcement').textContent(), `Mintie: ${expected}`);
    }
    const beforeSilent = await page.locator('#caption-announcement').textContent();
    await page.evaluate(() => window.__mintie.captions.said('[giggles]'));
    assert.equal(await page.locator('#said').isHidden(), true);
    assert.equal(await page.locator('#caption-announcement').textContent(), beforeSilent);
    await page.evaluate(() => window.__mintie.captions.heard('[giggles] hola [gig', true));
    assert.equal(await page.locator('#heard').textContent(), 'you: hola');
    assert.equal(await page.locator('#caption-announcement').textContent(), 'You: hola');
    await page.evaluate(() => window.__mintie.captions.said('[gasps] ¡Ay, jijí! [giggles]'));
    assert.equal(await page.locator('#said').textContent(), '¡Ay, jijí!');
    const announcement = await page.locator('#caption-announcement').textContent();
    await page.evaluate(() => window.__mintie.simulatePartial('hola, Mintie'));
    assert.equal(await page.locator('#heard').textContent(), 'you: hola, Mintie');
    assert.equal(await page.locator('#caption-announcement').textContent(), announcement);
    assert.equal(await page.locator('#heard').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#caption').getAttribute('aria-live'), 'polite');
    await page.route('**/api/react', route => route.fulfill({ contentType: 'application/x-ndjson', body: '{"emoji":null,"gaze":null,"hop":"none"}\n{"voice":"none"}\n{"line":null,"display":null,"ms":0}\n{"cue":null}\n' }));
    await page.evaluate(() => window.__mintie.simulateCommit('hola, Mintie, ¿cómo estás?'));
    await page.unroute('**/api/react');
    assert.equal(await page.locator('#heard').textContent(), 'you: hola, Mintie, ¿cómo estás?');
    assert.equal(await page.locator('#caption-announcement').textContent(), 'You: hola, Mintie, ¿cómo estás?');
    assert.equal(await page.locator('#caption').evaluate(n => getComputedStyle(n).pointerEvents), 'none');
    await page.waitForTimeout(7300);
    assert.equal(await page.locator('#caption').evaluate(n => getComputedStyle(n).opacity), '0');
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.waitForFunction(() => window.__mintie?.ready);
    assert.deepEqual(await page.locator('#character').boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
    const dock = await page.locator('#controls').boundingBox();
    assert.ok(Math.abs(dock.x + dock.width / 2 - 195) < 1 && dock.y > 740 && dock.x >= 16 && dock.x + dock.width <= 374);
    await page.locator('#emotions').click();
    await page.waitForFunction(() => document.getElementById('emotions').getAttribute('aria-expanded') === 'true');
    const picker = await page.locator('#emotion-picker').boundingBox();
    assert.ok(picker.y >= 0 && picker.y + picker.height < dock.y && picker.x >= 0 && picker.x + picker.width <= 390);
    const row = await page.locator('#palette').evaluate(node => {
      const box = node.getBoundingClientRect(), buttons = [...node.children].map(button => button.getBoundingClientRect());
      return { rows: new Set(buttons.map(b => Math.round(b.top))).size, scrolls: node.scrollWidth > node.clientWidth, small: buttons.some(b => b.width < 44 || b.height < 44) };
    });
    assert.equal(row.rows, 1); assert.equal(row.scrolls, true); assert.equal(row.small, false);
    // The strip never covers Mintie: no ray through its top edge or centre line hits them.
    const covered = await page.evaluate(box => { for (let x = box.x; x <= box.x + box.width; x += 8) for (const y of [box.y, box.y + box.height / 2]) if (window.__mintie.pick(x, y)) return [x, y]; return null; }, picker);
    assert.equal(covered, null, 'emoji strip covers Mintie');
    assert.notEqual(await page.locator('#palette').evaluate(node => getComputedStyle(node).maskImage), 'none');
    await page.locator('[data-emoji]').last().scrollIntoViewIfNeeded();
    const reachable = await page.locator('[data-emoji]').last().boundingBox(), palette = await page.locator('#palette').boundingBox();
    assert.ok(reachable.x >= palette.x - 1 && reachable.x + reachable.width <= palette.x + palette.width + 1);
    await page.waitForFunction(() => document.getElementById('palette').classList.contains('at-end'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('emotions').getAttribute('aria-expanded') === 'false');
    await page.evaluate(() => { window.__mintie.captions.said('Aquí estoy.'); window.__mintie.captions.heard('hola'); });
    await page.waitForFunction(() => document.getElementById('caption').getBoundingClientRect().bottom < document.getElementById('controls').getBoundingClientRect().top);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => window.__micCalls), 0);
    await page.setViewportSize({ width: 1512, height: 982 });
    return 'partials silent, commits announced, tags stripped, fade, mobile centered dock/popover within viewport, captions above dock, no scroll';
  });
  for (const [name, emoji] of [['rest', null], ['two buds', '❤️']]) await check(name, async () => {
    await page.reload(); await page.waitForFunction(() => window.__mintie?.ready);
    await page.waitForFunction(() => window.__mintie.frame.count > 2 && !window.__mintie.performer.active());
    if (emoji) { await page.locator('#emotions').click(); await page.locator(`[data-emoji="${emoji}"]`).click(); await page.keyboard.press('Escape'); }
    // Exercise the UI lane's full-viewport surface, not the old constrained stage.
    await page.evaluate(() => { const c=document.getElementById('character');document.body.append(c);c.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;pointer-events:none';window.dispatchEvent(new Event('resize')); });
    const samples = await page.evaluate(async emoji => {
      const app = window.__mintie, intervals = [], js = [], gpu = []; let last = -1;
      for (let frame = 0; frame < 210;) {
        await new Promise(requestAnimationFrame); if (app.frame.count === last) continue; last = app.frame.count;
        if (emoji && frame % 60 === 0) document.querySelector(`[data-emoji="${emoji}"]`).click();
        if (frame >= 30) { intervals.push(app.frame.intervalMs); js.push(app.frame.jsMs); const g = app.stats().gpuMs; if (Number.isFinite(g)) gpu.push(g); }
        frame++;
      }
      return { intervals, js, gpu };
    }, emoji);
    const fps = 1000 * samples.intervals.length / samples.intervals.reduce((a, b) => a + b, 0), js = percentile(samples.js, .95), gpu = percentile(samples.gpu, .95);
    const detail = `${fps.toFixed(1)} fps, JS ${js?.toFixed(2)} ms, GPU ${gpu?.toFixed(2)} ms (${samples.gpu.length} samples)`;
    assert.ok(fps >= 60 && js <= 2 && gpu !== null && gpu <= 3, detail); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    return `full viewport DPR 2: ${detail}`;
  });
  await check('trace overhead', async () => {
    await page.reload(); await page.waitForFunction(() => window.__mintie?.ready);
    const result = await page.evaluate(async () => {
      const app = window.__mintie;
      await app.trace.start(); app.trace.scripted = true;
      await app.audio.resume();
      const oscillator = app.audio.context.createOscillator(), gain = app.audio.context.createGain(); gain.gain.value = .03;
      oscillator.connect(gain); gain.connect(app.audio.master); oscillator.start();
      const total = [];
      for (let i = 0; i < 240; i++) { await new Promise(requestAnimationFrame); if (i % 60 === 0) app.performer.play('👋'); total.push(app.frame.jsMs); }
      oscillator.stop(); oscillator.disconnect(); gain.disconnect();
      const on = await app.trace.stop(), bytes = (await app.trace.audioBase64()).length;
      await app.trace.start(); await app.trace.stop(); // Same-origin module can be reused; no leaked graph.
      return { cost: on.costMs, total, frames: on.frames.rows.length, events: on.events.length, loopback: on.events.some(e => e.type === 'loopback'), workletErrors: on.events.filter(e => e.type === 'loopback_error'), bytes, mic: window.__micCalls };
    });
    assert.equal(result.mic, 0); assert.ok(result.frames >= 200, JSON.stringify(result));
    assert.deepEqual(result.workletErrors, []); assert.equal(result.loopback, true); assert.ok(result.bytes > 1000);
    assert.ok(result.cost.p99 <= .2, JSON.stringify(result)); assert.deepEqual(errors, []);
    return `trace OFF measured above unchanged; ON sampler p50/p95/p99 ${result.cost.p50.toFixed(3)}/${result.cost.p95.toFixed(3)}/${result.cost.p99.toFixed(3)} ms (${result.frames} frames); total tick p95 ${percentile(result.total, .95).toFixed(2)} ms; loopback callbacks ${result.cost.loopbackJsMs.toFixed(2)} ms/${result.cost.loopbackMessages}; output bytes ${result.bytes}; mic calls 0`;
  });
} catch (error) { rows.push({ check: 'setup', status: 'FAIL', detail: String(error.stack || error) }); }
finally {
  await browser?.close();
  if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mkdir(out, { recursive: true });
  const result = { quick, runtimeSeconds: (performance.now() - started) / 1000, rows };
  await writeFile(`${out}latest.json`, JSON.stringify(result, null, 2) + '\n');
  console.table(rows); console.log(`Runtime: ${result.runtimeSeconds.toFixed(1)}s`);
  if (rows.some(row => row.status === 'FAIL')) process.exitCode = 1;
}
