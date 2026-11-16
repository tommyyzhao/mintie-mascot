import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createApp } from '../server/server.mjs';
import { CATALOG } from '../web/perform/emoji.js';

export const artifacts = fileURLToPath(new URL('./artifacts/audit/', import.meta.url));
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
export const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const summary = values => ({ p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: values.length ? Math.max(...values) : null });

// Real HTTP/security/NDJSON/audio client paths; only provider transport is replaced.
export async function withAudit(dpr, run, { reducedMotion = 'no-preference', mockMic = false } = {}) {
  const pcm = Buffer.alloc(24000 * 2 * 1.5);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 330 / 24000) * 6000), i * 2);
  const requests = { react: 0, say: 0, token: 0 };
  const fakeFetch = async (url, options) => {
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      requests.react++;
      const request=JSON.parse(options.body),output=request.response_format?.json_schema?.name==='decision'?{animation:'👋',gaze:null,hop:'none',voice:'words'}:request.response_format?{cue:null}:request.max_tokens===24?'mmm':'¡Holiii, qué bonito verte!';
      return new Response(`data: ${JSON.stringify({choices:[{delta:{content:typeof output==='string'?output:JSON.stringify(output)},finish_reason:null}]})}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if (url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
      requests.say++; if (url.includes('/with-timestamps')) return Response.json({ audio_base64: pcm.toString('base64'), alignment: { characters: Array.from(JSON.parse(options.body).text), character_start_times_seconds: Array.from(JSON.parse(options.body).text, (_, i) => i * .015) } });
    return new Response(pcm, { headers: { 'content-type': 'audio/pcm' } });
    }
    if (url === 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe') {
      requests.token++; return Response.json({ token: 'audit-synthetic-single-use-token' });
    }
    if (options.method === 'HEAD') return new Response(null);
    throw new Error(`Unexpected provider path: ${new URL(url).pathname}`);
  };
  const server = http.createServer(createApp({ webRoot, threeDir: path.dirname(fileURLToPath(import.meta.resolve('three'))), catalog: CATALOG,
    keys: { OPENROUTER_API_KEY: 'fake-audit-selector', ELEVENLABS_API_KEY: 'fake-audit-voice' }, fetch: fakeFetch }));
  const profile = await mkdtemp(path.join(tmpdir(), 'mintie-lane-l-'));
  let context;
  try {
    await mkdir(artifacts, { recursive: true });
    server.listen(8143, '127.0.0.1'); await once(server, 'listening');
    assert.ok(server.address().port < 8090 || server.address().port > 8100);
    const base = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true,
      viewport: { width: 1512, height: 982 }, deviceScaleFactor: dpr, reducedMotion, permissions: [],
      args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--enable-precise-memory-info'] });
    const external = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      external.push(url.origin); return route.abort();
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ mockMic }) => {
      window.__audit = { micCalls: 0, stoppedTracks: 0, socketsClosed: 0, contexts: [], longtasks: [] };
      new PerformanceObserver(list => window.__audit.longtasks.push(...list.getEntries().map(e => ({ startTime: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
      navigator.mediaDevices.getUserMedia = async () => {
        window.__audit.micCalls++;
        if (!mockMic) throw new Error('Real microphone forbidden in lane L');
        const context = new AudioContext(); window.__audit.contexts.push(context);
        const stream = context.createMediaStreamDestination().stream;
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { window.__audit.stoppedTracks++; stop(); };
        }
        return stream;
      };
      // No socket ever reaches the network. Native AudioWorklet consumes a silent synthetic track.
      if (mockMic) window.WebSocket = class {
        static OPEN = 1;
        readyState = 1; bufferedAmount = 0;
        constructor() { setTimeout(() => this.onmessage?.({ data: '{"message_type":"session_started"}' }), 10); }
        send() {}
        close() { this.readyState = 3; window.__audit.socketsClosed++; }
      };
    }, { mockMic });
    await page.addInitScript(() => localStorage.setItem('mintie-memory', JSON.stringify({ name: 'Alex', facts: [] })));
    await page.goto(base);
    await page.waitForFunction(() => window.__mintie?.ready && !document.getElementById('talk').disabled);
    const adapter = await page.evaluate(() => window.__mintie.adapter);
    assert.match(adapter?.renderer || '', /Apple|Metal/i, `Hardware renderer required: ${JSON.stringify(adapter)}`);
    const result = await run({ page, context, base, adapter, requests, errors, external });
    assert.deepEqual(errors, [], 'Console/page errors'); assert.deepEqual(external, [], 'External requests');
    return { ...result, adapter, requests, consoleErrors: errors, externalRequests: external, cleanup: 'context closed; temp profile removed; own loopback server closed' };
  } finally {
    try { await context?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
  }
}

async function perf() {
  const results = { measuredAt: new Date().toISOString(), viewport: { width: 1512, height: 982 }, warmupFrames: 120, measuredFrames: 600, runs: [] };
  for (const dpr of [2, 1]) {
    const result = await withAudit(dpr, async ({ page }) => {
      const load = await page.evaluate(() => ({ readyMs: performance.now(), navigation: performance.getEntriesByType('navigation')[0].toJSON(),
        resources: performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname, transferBytes: e.transferSize, bodyBytes: e.encodedBodySize, durationMs: e.duration })) }));
      load.readyMs = await page.evaluate(() => window.__mintie.readyAt);
      const resources = [{ path: '/', transferBytes: load.navigation.transferSize, bodyBytes: load.navigation.encodedBodySize }, ...load.resources];
      load.totalTransferredBytes = resources.reduce((sum, r) => sum + r.transferBytes, 0);
      load.transferredExcludingThree = resources.filter(r => !r.path.startsWith('/vendor/three/')).reduce((sum, r) => sum + r.transferBytes, 0);
      load.largestResources = [...resources].sort((a, b) => b.transferBytes - a.transferBytes).slice(0, 8);
      load.appCodeGzipBytes = 0;
      for (const resource of resources.filter(r => !r.path.startsWith('/vendor/three/') && /\.(js|css)$|^\/$/.test(r.path))) {
        load.appCodeGzipBytes += gzipSync(await readFile(path.join(webRoot, resource.path === '/' ? 'index.html' : resource.path.slice(1)))).length;
      }
      const scenarios = [];
      for (const kind of ['idle', 'palette', 'touch']) {
        // Real mouse down establishes pointer capture; subsequent synthetic coordinates stay in the same DOM/touch path.
        const box = await page.locator('#character').boundingBox();
        if (kind === 'touch') { await page.mouse.move(box.x + box.width / 2, box.y + box.height * .57); await page.mouse.down(); }
        const raw = await page.evaluate(async ({ kind, box }) => {
          const app = window.__mintie, canvas = document.getElementById('character');
          const intervals = [], js = [], gpu = [], heap = [], touchKinds = new Set(), paletteClickMs = [];
          let warmupMaxJsMs = 0;
          const emojis = ['👋', '❤️', '🎉', '😂', '🤗'];
          let index = 0, nextReaction = -Infinity, touchStarted = false, lastCount = -1, cycle = -1, measuredStart;
          const pointer = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true }));
          for (let frame = 0; frame < 720;) {
            await new Promise(requestAnimationFrame);
            if (app.frame.count === lastCount) continue;
            lastCount = app.frame.count;
            if (frame < 120) warmupMaxJsMs = Math.max(warmupMaxJsMs, app.frame.jsMs);
            if (frame === 120) measuredStart = performance.now() - app.frame.intervalMs;
            if (frame >= 120) { intervals.push(app.frame.intervalMs); js.push(app.frame.jsMs); const g = app.stats().gpuMs; if (Number.isFinite(g)) gpu.push(g); heap.push(performance.memory.usedJSHeapSize); }
            if (kind === 'palette' && performance.now() >= nextReaction) {
              const clickAt = performance.now();
              document.querySelector(`[data-emoji="${emojis[index++ % emojis.length]}"]`).click();
              paletteClickMs.push(performance.now() - clickAt); nextReaction = performance.now() + 1200;
            }
            if (kind === 'touch') {
              const phase = frame % 120, x = box.x + box.width / 2, y = box.y + box.height * .57;
              if (Math.floor(frame / 120) !== cycle) { cycle = Math.floor(frame / 120); if (touchStarted) pointer('pointerup', x, y); pointer('pointerdown', x, y); touchStarted = true; }
              if (phase < 65) pointer('pointermove', x + Math.sin(phase / 9) * 32, y - Math.min(phase, 45) * 2);
              if (phase === 65) { pointer('pointerup', x, y - 90); touchStarted = false; }
              if (app.lastTouch) touchKinds.add(app.lastTouch.kind);
            }
            frame++;
          }
          if (touchStarted) pointer('pointerup', box.x + box.width / 2, box.y + box.height * .57);
          return { intervals, js, gpu, heap, warmupMaxJsMs, paletteClickMs, touchKinds: [...touchKinds], longtasks: window.__audit.longtasks.filter(task => task.startTime >= measuredStart) };
        }, { kind, box });
        if (kind === 'touch') await page.mouse.up();
        const intervalMs = summary(raw.intervals), jsMs = summary(raw.js), gpuMs = summary(raw.gpu), heapBytes = summary(raw.heap);
        const longtasks = raw.longtasks;
        if (kind === 'touch') assert.ok(raw.touchKinds.includes('lift') && raw.touchKinds.includes('drop'), 'Touch scenario must actually lift and drop');
        scenarios.push({ kind, intervalMs, jsMs, gpuMs, heapBytes, sustainedFps: 1000 / (raw.intervals.reduce((a, b) => a + b, 0) / raw.intervals.length),
          longtasks, warmupMaxJsMs: raw.warmupMaxJsMs, paletteClickMs: raw.paletteClickMs, touchKinds: raw.touchKinds, budgets: { js: jsMs.p95 <= 2, gpu: gpuMs.p95 !== null && gpuMs.p95 <= 3, heap: heapBytes.max <= 60 * 1024 * 1024, longtasks: longtasks.length === 0, frame: intervalMs.p95 <= 1000 / 60 + .5 } });
        console.log(JSON.stringify({ dpr, ...scenarios.at(-1) }));
      }
      const postReadyLongtasks = await page.evaluate(() => window.__audit.longtasks.filter(task => task.startTime >= window.__mintie.readyAt));
      return { dpr, load, scenarios, postReadyLongtasks, microphoneCalls: await page.evaluate(() => window.__audit.micCalls) };
    });
    assert.equal(result.microphoneCalls, 0);
    results.runs.push(result);
  }
  const audioFiles = [];
  for (const kind of ['sfx']) for (const file of await readdir(path.join(webRoot, 'assets', kind))) {
    if (file.endsWith('.mp3')) audioFiles.push({ path: `/assets/${kind}/${file}`, bytes: (await stat(path.join(webRoot, 'assets', kind, file))).size });
  }
  results.cachedAudio = { bytes: audioFiles.reduce((sum, file) => sum + file.bytes, 0), files: audioFiles.length, budgetBytes: 1.5 * 1024 * 1024 };
  results.cachedAudio.withinBudget = results.cachedAudio.bytes <= results.cachedAudio.budgetBytes;
  await writeFile(path.join(artifacts, 'perf-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await perf();
