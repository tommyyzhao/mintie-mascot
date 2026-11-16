// Opt-in only. No microphone, network interception, timers or audio graph changes while off.
export const CHANNELS = ['at', 'leanX', 'leanZ', 'squash', 'twist', 'offsetX', 'offsetY', 'offsetZ', 'eyeL', 'eyeR', 'gazeX', 'gazeY', 'smileL', 'smileR', 'mouth', 'nubL', 'nubR', 'touchX', 'touchY', 'touchZ', 'touchSquash', 'touchTiltX', 'touchTiltZ', 'dent', 'listening', 'thinking', 'speaking', 'pauseAt', 'viewerYaw', 'viewerPitch', 'flowerX', 'flowerZ'];
// Same file, two scopes: browser recorder + CSP-safe AudioWorklet (no extra module).
if (typeof registerProcessor === 'function') registerProcessor('mintie-trace-tap', class extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0]; if (!channels?.length) return true;
    let first = -1, last = -1, sum = 0, peak = 0;
    for (let i = 0; i < channels[0].length; i++) {
      let v = 0; for (const c of channels) v = Math.max(v, Math.abs(c[i]));
      sum += v*v; peak = Math.max(peak, v); if (v > .001) { if (first < 0) first = i; last = i; }
    }
    if (first >= 0) this.port.postMessage({ frame: currentFrame, length: channels[0].length, first, last, peak, rms: Math.sqrt(sum/channels[0].length), rate: sampleRate });
    return true;
  }
});
export function createTrace({ audio, performer, touch, pick, capacity = 72000 } = {}) {
  let enabled = false, includeText = false, ring, count = 0, events = [], droppedEvents = 0, costs = [], indicator;
  let recorder, chunks = [], audioBlob, tap, destination, mute, stopping, ready = Promise.resolve(), cleanup = [], loopbackJsMs = 0, loopbackMessages = 0, lastHopAt;
  const clock = () => performance.now();
  const emit = (type, data = {}, at = clock()) => {
    if (!enabled) return;
    if (events.length >= 120000) { droppedEvents++; return; }
    events.push({ type, at, ...data });
  };
  const textEvent = (type, data = {}) => {
    const { text, at: sourceAt, ...rest } = data ?? {};
    emit(type, { ...rest, ...(sourceAt === undefined ? {} : { sourceAt }), ...(typeof text === 'string' ? { length: text.length, ...(includeText ? { text } : {}) } : {}) });
  };
  function mapping(contextAt) {
    const stamp = audio.context.getOutputTimestamp?.();
    const method = stamp?.performanceTime > 0 ? 'audio.atMs/getOutputTimestamp' : 'audio.atMs/latency-estimate';
    const now = clock();
    return { at: now + (contextAt - audio.atMs(now)) * 1000, method, contextAt };
  }
  function wrap(object, key, handler) {
    if (typeof object[key] !== 'function') return;
    const original = object[key];
    object[key] = function (...args) { return handler(original.bind(this), args); };
    cleanup.push(() => { object[key] = original; });
  }
  async function loopback() {
    // PCM is observed after the real master gain, including sfx, fades, cancellation and gaps.
    // Each render quantum reports exact first/last sample above -60 dBFS, not scheduled-source PCM.
    const ctx = audio.context;
    // Reuse this module in the worklet scope: same-origin script passes the app's strict CSP.
    await ctx.audioWorklet.addModule(new URL('./trace.js', import.meta.url).href);
    if (!enabled) return;
    tap = new AudioWorkletNode(ctx, 'mintie-trace-tap');
    mute = ctx.createGain(); mute.gain.value = 0;
    audio.master.connect(tap); tap.connect(mute); mute.connect(ctx.destination);
    tap.port.onmessage = ({ data }) => {
      const before = clock(), start = mapping(data.frame / data.rate);
      emit('loopback', { ...data, ...start, firstAt: start.at + data.first / data.rate * 1000, lastAt: start.at + data.last / data.rate * 1000 }, start.at);
      loopbackJsMs += clock() - before; loopbackMessages++;
    };
    destination = ctx.createMediaStreamDestination(); audio.master.connect(destination);
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : {});
    recorder.onstart = () => emit('recording_start', { ...mapping(ctx.currentTime), observedAt: clock() });
    recorder.ondataavailable = ({ data, timecode }) => { if (data.size) chunks.push(data); emit('recording_chunk', { bytes: data.size, timecode }); };
    recorder.start(1000);
    emit('loopback_start', { ...mapping(ctx.currentTime), mimeType: recorder.mimeType, sampleRate: ctx.sampleRate, threshold: .001 });
  }
  function controls() {
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;background:#fff;color:#111;padding:8px;border:2px solid #111;font:14px sans-serif';
    const label = document.createElement('span'); label.textContent = 'Recording trace + page audio (no microphone recording). ';
    label.setAttribute('role', 'status');
    const download = document.createElement('button'); download.textContent = 'Stop + download'; download.onclick = () => api.download();
    indicator.append(label, download); document.body.append(indicator);
  }
  function start(options = {}) {
    if (stopping) return stopping.then(() => start(options));
    if (enabled) return ready;
    recorder = tap = destination = mute = undefined; lastHopAt = undefined;
    enabled = true; includeText = options.text === true || new URLSearchParams(globalThis.location?.search ?? '').get('trace') === 'text';
    ring = new Float64Array(capacity * CHANNELS.length); count = 0; events = []; costs = []; chunks = []; audioBlob = null; droppedEvents = 0; loopbackJsMs = 0; loopbackMessages = 0;
    controls(); emit('trace_start', { text: includeText, timeOrigin: performance.timeOrigin });
    for (const key of ['play', 'cancel', 'look', 'hop']) wrap(performer, key, (original, args) => {
      emit(`performer_${key}`, key === 'play' ? { emoji: typeof args[0] === 'string' ? args[0] : null } : key === 'look' ? { gaze: args[0] } : {});
      return original(...args);
    });
    if (touch) wrap(touch, 'hop', (original, args) => { const result = original(...args); emit('touch_hop', { options: args[0], accepted: !!result }); return result; });
    wrap(audio, 'say', async (original, args) => {
      textEvent('tts_request', { text: args[0], align: !!args[1]?.align });
      try {
        const result = await original(...args);
        emit('audio_start', { ...mapping(result.startAt), firstChunkMs: result.firstChunkMs });
        result.done.then(() => emit('audio_end'), () => emit('audio_error'));
        if (result.charTime) {
          const charTime = result.charTime;
          result.charTime = async offset => {
            const at = await charTime(offset); emit('aligned_char', { offset, wordAt: at === null ? null : mapping(at).at }); return at;
          };
        }
        return result;
      } catch (error) { emit('tts_error', { name: error.name }); throw error; }
    });
    wrap(audio.context, 'createBufferSource', (original, args) => {
      const source = original(...args), originalStart = source.start;
      source.start = function (when = 0, ...rest) {
        emit('audio_chunk_scheduled', { ...mapping(when), scheduledAt: clock(), durationMs: (source.buffer?.duration ?? 0) * 1000 });
        return originalStart.call(this, when, ...rest);
      };
      return source;
    });
    ready = loopback().catch(error => { emit('loopback_error', { name: error.name, message: error.message }); if (indicator) indicator.querySelector('span').textContent = 'Recording trace; PAGE AUDIO FAILED. No microphone recording. '; });
    return ready;
  }
  function sample(at, pose, dyn, inputs) {
    if (!enabled) return;
    const before = clock(), i = count++ % capacity * CHANNELS.length, b = pose.body, e = pose.eyes;
    ring[i] = at; ring[i+1] = b.lean[0]; ring[i+2] = b.lean[1]; ring[i+3] = b.squash; ring[i+4] = b.twist;
    ring[i+5] = b.offset[0]; ring[i+6] = b.offset[1]; ring[i+7] = b.offset[2];
    ring[i+8] = e.openL; ring[i+9] = e.openR; ring[i+10] = e.gaze[0]; ring[i+11] = e.gaze[1];
    ring[i+12] = e.smileL; ring[i+13] = e.smileR; ring[i+14] = pose.mouth.open;
    ring[i+15] = 0; ring[i+16] = 0;
    for (const bud of pose.buds) { const k = bud.side === 'L' || bud.side === 'left' || bud.side === -1 ? 15 : 16; ring[i+k] = Math.max(ring[i+k], bud.reach); }
    ring[i+17] = dyn.com[0]; ring[i+18] = dyn.com[1]; ring[i+19] = dyn.com[2]; ring[i+20] = dyn.squash;
    ring[i+21] = dyn.tilt[0]; ring[i+22] = dyn.tilt[1]; ring[i+23] = Math.max(0, ...dyn.dents.map(d => d.depth));
    ring[i+24] = +inputs.listening; ring[i+25] = +inputs.thinking; ring[i+26] = inputs.speaking; ring[i+27] = Number.isFinite(inputs.pauseAt) ? inputs.pauseAt : -1;
    const viewer = inputs.viewer ?? [0,.65,7], self = inputs.self ?? [0,0,0], dx = viewer[0]-self[0], dy = viewer[1]-self[1]-.65, dz = viewer[2]-self[2];
    ring[i+28] = Math.atan2(dx,dz); ring[i+29] = Math.max(-.45,Math.min(.45,Math.atan2(dy,Math.hypot(dx,dz))/.65));
    ring[i+30] = dyn.flower?.swing?.[0] ?? 0; ring[i+31] = dyn.flower?.swing?.[1] ?? 0;
    const hop = touch?.lastHop;
    if (hop && hop.at !== lastHopAt) { lastHopAt = hop.at; const { at: engineAt, ...beat } = hop; emit('hop_beat', { ...beat, engineAt }, at); }
    if (costs.length < capacity) costs.push(clock() - before);
  }
  function dump() {
    const frames = [], retained = Math.min(count, capacity);
    for (let n = count - retained; n < count; n++) { const i = n % capacity * CHANNELS.length; frames.push(Array.from(ring.subarray(i, i + CHANNELS.length))); }
    const sorted = [...costs].sort((a, b) => a-b), pct = p => sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))] ?? null;
    return { version: 1, clock: 'performance.now milliseconds', timeOrigin: performance.timeOrigin, text: includeText,
      events: [...events].sort((a,b) => a.at-b.at), frames: { columns: CHANNELS, rows: frames, dropped: Math.max(0, count-capacity) },
      costMs: { p50: pct(.5), p95: pct(.95), p99: pct(.99), max: sorted.at(-1) ?? null, samples: costs.length, loopbackJsMs, loopbackMessages }, droppedEvents };
  }
  function stop() {
    if (stopping) return stopping;
    stopping = finish().finally(() => { stopping = undefined; }); return stopping;
  }
  async function finish() {
    await ready;
    if (!enabled) return dump();
    emit('trace_stop');
    if (recorder && recorder.state !== 'inactive') await new Promise(resolve => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    audioBlob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    enabled = false; cleanup.splice(0).reverse().forEach(fn => fn());
    if (tap) { audio.master.disconnect(tap); tap.disconnect(); tap.port.close(); } mute?.disconnect();
    if (destination) { audio.master.disconnect(destination); destination.stream.getTracks().forEach(track => track.stop()); }
    indicator?.remove(); indicator = null;
    return dump();
  }
  function save(blob, name) { const link = document.createElement('a'), href = URL.createObjectURL(blob); link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }
  const api = { start, stop, dump, emit, textEvent, sample, mapping, pick(x,y) { return enabled ? pick?.(x,y) : null; }, get enabled() { return enabled; }, get ready() { return ready; },
    async audioBase64() { const blob = audioBlob ?? new Blob(chunks, { type: recorder?.mimeType }); return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); }); },
    async download() { const data = await stop(); save(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'mintie-trace.json'); if (audioBlob?.size) save(audioBlob, 'mintie-output.webm'); } };
  if (['1', 'text'].includes(new URLSearchParams(globalThis.location?.search ?? '').get('trace'))) void start();
  return api;
}
