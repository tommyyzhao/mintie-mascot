// All scheduling times are AudioContext seconds; all latency measurements are milliseconds.
export function scheduleChunk(previousEnd, when, arrival, duration) {
  if (![when, arrival, duration].every(Number.isFinite) || duration < 0) throw new RangeError('invalid_schedule');
  // Gapless while data arrives ahead of the cursor. A network underrun is irrecoverable;
  // resume at arrival rather than scheduling a source in the past and silently skipping samples.
  const start = previousEnd == null ? Math.max(when, arrival + 0.02) : Math.max(previousEnd, arrival);
  return { start, end: start + duration };
}

export function decodePCM16(bytes) {
  if (bytes.byteLength % 2) throw new RangeError('unaligned_pcm');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true) / 32768);
}

// releaseMs: mouth close smoothing; 30 ms release keeps mouth closure close to sound end (ALIVE.md §3d).
export function createAudio({ random = Math.random, releaseMs = 30, event = () => {} } = {}) {
  let ctx, master, analyser, waveform, smoothed = 0, smoothedAt = 0;
  const bags=new Map(), lastClips=new Map(), recentFillers=[];
  const manifests = new Map(), buffers = new Map(), jobs = new Set(), recentLines = [];
  function echoReferences() {
    const now = performance.now();
    while (recentLines.length && recentLines[0].endAt + 10000 <= now) recentLines.shift();
    return [...recentLines, ...[...jobs].filter(j => j.line && j.start != null && j.start <= ctx.currentTime && j.end > ctx.currentTime)
      .map(j => ({ line: j.line, startAt: j.startedAt, endAt: now + (j.end - ctx.currentTime) * 1000 }))];
  }
  function echoLines() {
    const now = performance.now();
    return echoReferences().filter(ref => ref.endAt + 150 > now).map(ref => ref.line);
  }
  function context() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
          for (const j of [...jobs]) cancel(j, 0, new Error('audio_interrupted'));
        }
      });
      master = ctx.createGain();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      waveform = new Float32Array(analyser.fftSize);
      master.connect(ctx.destination); // Material sfx must not drive Mintie's mouth or speech detector.
    }
    return ctx;
  }
  const resume = () => context().resume(); // Call directly from Talk/another explicit user gesture.
  function atMs(targetMs) {
    const c = context(), stamp = c.getOutputTimestamp?.();
    if (stamp?.performanceTime > 0) return stamp.contextTime + (targetMs - stamp.performanceTime) / 1000;
    // Estimate audible output time, not a hardware guarantee. OS/Bluetooth latency may be unreported.
    return c.currentTime + (targetMs - performance.now()) / 1000 - (c.outputLatency || 0) - (c.baseLatency || 0);
  }
  async function loadClips(manifestUrl, { preload = false } = {}) {
    const base = new URL(manifestUrl, location.href);
    const response = await fetch(base);
    if (!response.ok) throw new Error(`clips_http_${response.status}`);
    const manifest = await response.json();
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('invalid_manifest');
    const entries = Object.entries(manifest);
    if (entries.some(([kind, files]) => !kind || !Array.isArray(files) || !files.length || files.some(f => typeof f !== 'string' || !f))) {
      throw new Error('invalid_manifest');
    }
    for (const [kind, files] of entries) {
      const urls=files.map(file=>new URL(file,base).href);
      if (urls.some(url => new URL(url).origin !== new URL(location.href).origin)) throw new Error('cross_origin_clip');
      manifests.set(kind,urls);
      if(preload || kind.startsWith('filler_'))await Promise.all(urls.map(clipBuffer));
    }
  }
  function clipBuffer(url) {
    if (!buffers.has(url)) {
      const promise = fetch(url).then(async response => {
        if (!response.ok) throw new Error(`clip_http_${response.status}`);
        return context().decodeAudioData(await response.arrayBuffer());
      }).catch(error => { buffers.delete(url); throw error; });
      buffers.set(url, promise);
    }
    return buffers.get(url);
  }
  function job(line, signal, align = false) {
    const c = context(), controller = new AbortController(), gain = c.createGain();
    gain.connect(master);
    if(line)gain.connect(analyser);
    let resolveReady, rejectReady, resolveDone, rejectDone, resolveEnd;
    // Resolves at stream seal (not onended), so a successor can schedule at the exact last sample.
    const endAt = new Promise(resolve => { resolveEnd = resolve; });
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    // Loading a clip can outlive stop(); its ready promise is returned only after decode.
    ready.catch(() => {});
    // Consumers may only need first-chunk metrics; still prevent orphaned rejection warnings.
    done.catch(() => {});
    const j = { line, controller, gain, sources: new Set(), ready, done, end: null, start: null,
      sealed: false, cancelled: false, settled: false, requestedAt: performance.now(), firstChunkMs: null,
      sealEnd: () => resolveEnd(j.cancelled ? null : j.end) };
    const times = new Map(), spans = [], waiting = new Set();
    let mediaMs = 0, charOffset = 0, lastCharMs = -1;
    function charAt(offset) {
      const ms = times.get(offset), span = spans.find(s => ms >= s.from && ms < s.to);
      return span ? span.start + (ms - span.from) / 1000 : null;
    }
    j.notify = () => { for (const w of waiting) {
      const time = charAt(w.offset);
      if (time !== null || j.sealed || j.cancelled || j.settled) { waiting.delete(w); w.resolve(j.cancelled ? null : time); }
    } };
    j.charTime = offset => {
      if (!Number.isInteger(offset) || offset < 0 || offset >= line.length) return Promise.reject(new RangeError('invalid_char_offset'));
      if (j.cancelled) return Promise.resolve(null);
      const time = charAt(offset);
      if (time !== null || j.sealed || j.settled) return Promise.resolve(time);
      return new Promise(resolve => waiting.add({ offset, resolve }));
    };
    j.alignment = (chars, startMs) => {
      if (!Array.isArray(chars) || !Array.isArray(startMs) || chars.length !== startMs.length || chars.length > 600) throw new Error('invalid_alignment');
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i], ms = startMs[i];
        if (typeof char !== 'string' || !char.length || charOffset + char.length > line.length || line.slice(charOffset, charOffset + char.length) !== char || !Number.isFinite(ms) || ms < lastCharMs || ms < 0 || ms > 120000) throw new Error('invalid_alignment');
        for (let k = 0; k < char.length; k++) times.set(charOffset++, ms);
        lastCharMs = ms;
      }
      j.notify();
    };
    const abort = () => cancel(j, 30);
    function finish(error) {
      if (j.settled) return;
      j.settled = true;
      resolveEnd(error || j.cancelled ? null : j.end);
      j.notify();
      if (j.line && j.start != null && j.start <= c.currentTime) {
        recentLines.push({ line: j.line, startAt: j.startedAt, endAt: performance.now() });
        if (recentLines.length > 6) recentLines.shift();
      }
      signal?.removeEventListener('abort', abort);
      gain.disconnect();
      jobs.delete(j);
      if (error) { rejectReady(error); rejectDone(error); }
      else { resolveDone(); }
    }
    j.finish = finish;
    j.check = () => { if (j.sealed && !j.sources.size) finish(); };
    j.schedule = (buffer, when) => {
      if (j.cancelled) throw new DOMException('Cancelled', 'AbortError');
      let wordWhen=when;
      if(j.line && j.start===null)for(const filler of [...jobs].filter(x=>x.vocal&&!x.cancelled)) {
        const at=Math.max(when,c.currentTime+.02);
        if(filler.end<=at)continue;
        const end=Math.min(filler.end,at+.06);
        filler.gain.gain.cancelScheduledValues(at);
        filler.gain.gain.setValueAtTime(filler.gain.gain.value,at);
        filler.gain.gain.linearRampToValueAtTime(0,end);
        for(const source of filler.sources)source.stop(end);
        filler.end=end;filler.yielded=true;wordWhen=Math.max(wordWhen,end);
        event('filler_yield',{fadeMs:(end-at)*1000,at,end});
      }
      const timing = scheduleChunk(j.end, wordWhen, c.currentTime, buffer.duration);
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      j.sources.add(source);
      source.onended = () => { source.disconnect(); j.sources.delete(source); j.check(); };
      source.start(timing.start);
      j.end = timing.end;
      // ponytail: map each PCM span, not startAt+ms; underruns insert audible gaps.
      if (align) { spans.push({ from: mediaMs, to: mediaMs + buffer.duration * 1000, start: timing.start }); mediaMs += buffer.duration * 1000; j.notify(); }
      if (j.start == null) {
        j.start = timing.start;
        j.startedAt = performance.now() + (timing.start - c.currentTime) * 1000;
        resolveReady({ firstChunkMs: j.firstChunkMs, startAt: j.start, done, endAt, ...(align ? { charTime: j.charTime } : {}) });
      }
    };
    jobs.add(j);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    return j;
  }
  function cancel(j, fadeMs, error) {
    if (j.cancelled || j.settled) return 0;
    j.cancelled = true;
    j.controller.abort();
    const c = context(), playing = j.start != null && j.start <= c.currentTime && j.end > c.currentTime;
    const seconds = playing ? Math.max(0, Math.min(150, fadeMs)) / 1000 : 0;
    j.gain.gain.cancelScheduledValues(c.currentTime);
    j.gain.gain.setValueAtTime(j.gain.gain.value, c.currentTime);
    j.gain.gain.linearRampToValueAtTime(0, c.currentTime + seconds);
    for (const source of j.sources) {
      source.onended = null;
      try { source.stop(c.currentTime + seconds); } catch {}
      source.disconnect();
    }
    j.sources.clear();
    j.sealed = true;
    if (j.start == null) j.finish(error ?? new DOMException('Cancelled', 'AbortError'));
    else j.finish(error);
    return seconds * 1000;
  }
  async function playClip(kind, { when = context().currentTime, signal, line = '' } = {}) {
    if (line && context().state !== 'running') throw new Error('audio_not_running');
    const files = manifests.get(kind);
    if (!files) throw new Error('unknown_clip_kind');
    if (!Number.isFinite(when)) throw new Error('invalid_schedule');
    const vocal=kind.startsWith('filler_');
    let bag=bags.get(kind);
    if(!bag?.length) {
      bag=[...files];
      for(let i=bag.length-1;i>0;i--){const k=Math.floor(random()*(i+1));[bag[i],bag[k]]=[bag[k],bag[i]];}
      bags.set(kind,bag);
    }
    const index=bag.findIndex(url=>(!vocal || !recentFillers.includes(url)) && (files.length===1 || url!==lastClips.get(kind)));
    if(index<0)return null; // All variants heard recently: silence, never repetition.
    const [url]=bag.splice(index,1);
    const j = job(line,signal);j.vocal=vocal;
    if(vocal)j.gain.connect(analyser);
    try {
      const buffer = await clipBuffer(url);
      if(vocal && [...jobs].some(x=>x.line&&x.start!==null&&!x.cancelled)) {cancel(j,0);return null;}
      if(j.cancelled)return j.ready;
      lastClips.set(kind,url);
      if(vocal){recentFillers.push(url);if(recentFillers.length>20)recentFillers.shift();}
      j.firstChunkMs = performance.now() - j.requestedAt;
      j.schedule(buffer, when);
      j.sealed = true;
      j.sealEnd(); j.check();
    } catch (error) { j.finish(error); }
    return j.ready;
  }
  function say(text, { when = context().currentTime, signal, align = false, gate, previous_text } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 600) return Promise.reject(new Error('invalid_text'));
    if (!Number.isFinite(when) && !(gate !== undefined && typeof when === 'function')) return Promise.reject(new Error('invalid_schedule'));
    if (context().state !== 'running') return Promise.reject(new Error('audio_not_running'));
    const j = job(text, signal, align);
    // Warm the HTTP request, not the speaker. False/rejection aborts even before headers arrive.
    const permission = gate === undefined ? null : Promise.resolve(gate).then(allowed => {
      if (allowed !== true) throw new DOMException('Cancelled', 'AbortError');
    });
    permission?.catch(() => cancel(j, 0));
    void (async () => {
      try {
        const response = await fetch('/api/say', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, ...(align ? { align: true } : {}), ...(previous_text !== undefined ? { previous_text } : {}) }), signal: j.controller.signal });
        if (!response.ok) throw new Error(`say_http_${response.status}`);
        const type = response.headers.get('content-type')?.split(';')[0].trim();
        if (align ? type !== 'application/x-ndjson' : type !== 'audio/pcm' && type !== 'audio/mpeg') throw new Error('unsupported_audio_type');
        if (!response.body) throw new Error('missing_audio_body');
        if (permission) {
          await permission;
          if (j.cancelled) return;
          when = typeof when === 'function' ? when() : when;
          if (!Number.isFinite(when)) throw new Error('invalid_schedule');
        }
        const rate = Number(response.headers.get('x-sample-rate'));
        if ((align || type === 'audio/pcm') && (!Number.isInteger(rate) || rate < 8000 || rate > 96000)) throw new Error('invalid_sample_rate');
        const reader = response.body.getReader(), chunks = [], decoder = align ? new TextDecoder() : null;
        let carry = new Uint8Array(0), total = 0, pending = '', ended = false;
        const pcm = bytes => {
          const samples = decodePCM16(bytes);
          if (!samples.length) return;
          j.firstChunkMs ??= performance.now() - j.requestedAt;
          const buffer = context().createBuffer(1, samples.length, rate);
          buffer.copyToChannel(samples, 0); j.schedule(buffer, when);
        };
        function frame(raw) {
          const data = JSON.parse(raw);
          if (!data || typeof data !== 'object' || ended || data.error) throw new Error('say_stream');
          if (data.done === true && Object.keys(data).length === 1) { ended = true; return; }
          if (Object.keys(data).some(k => !['pcm','chars','startMs'].includes(k)) || typeof data.pcm !== 'string' || data.pcm.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.pcm)) throw new Error('invalid_audio_frame');
          pcm(Uint8Array.from(atob(data.pcm), c => c.charCodeAt(0)));
          if (data.chars !== undefined || data.startMs !== undefined) j.alignment(data.chars, data.startMs);
        }
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (j.cancelled) throw new DOMException('Cancelled', 'AbortError');
            if (done) {
              if (align) { pending += decoder.decode(); if (pending.trim()) frame(pending); if (!ended) throw new Error('incomplete_audio'); }
              break;
            }
            if (!value.length) continue;
            total += value.length;
            if (total > 8 * 1024 * 1024) throw new Error('audio_too_large');
            if (align) {
              pending += decoder.decode(value, { stream: true });
              let end;
              while ((end = pending.indexOf('\n')) !== -1) { const raw = pending.slice(0, end); pending = pending.slice(end + 1); if (raw.trim()) frame(raw); }
              if (pending.length > 1024 * 1024) throw new Error('audio_frame_too_large');
              continue;
            }
            j.firstChunkMs ??= performance.now() - j.requestedAt;
            if (type === 'audio/mpeg') { chunks.push(value); continue; }
            const bytes = new Uint8Array(carry.length + value.length);
            bytes.set(carry); bytes.set(value, carry.length);
            const aligned = bytes.length - bytes.length % 2;
            carry = bytes.slice(aligned);
            if (aligned) pcm(bytes.subarray(0, aligned));
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (carry.length) throw new Error('unaligned_pcm');
        if (type === 'audio/mpeg' && total) {
          const bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          j.schedule(await context().decodeAudioData(bytes.buffer), when);
        }
        if (j.start == null) throw new Error('empty_audio');
        j.sealed = true;
        j.sealEnd(); j.notify(); j.check();
      } catch (error) {
        if (j.cancelled) return;
        j.controller.abort();
        for (const source of j.sources) source.stop(context().currentTime);
        // Reject done even if a later chunk fails after ready already resolved.
        j.finish(error);
      }
    })();
    return j.ready;
  }
  function speaking(wordsOnly = false) {
    return !!ctx && [...jobs].some(j => (j.line || !wordsOnly && j.vocal) && !j.cancelled && !j.settled && j.start != null && j.start <= ctx.currentTime && j.end > ctx.currentTime);
  }
  function amplitude() {
    if (!ctx) return 0;
    analyser.getFloatTimeDomainData(waveform);
    const rms = Math.sqrt(waveform.reduce((sum, sample) => sum + sample * sample, 0) / waveform.length);
    const now = performance.now(), dt = Math.min(250, now - smoothedAt);
    const target = Math.min(1, rms * 4);
    smoothed += (target - smoothed) * (1 - Math.exp(-dt / (target > smoothed ? 20 : releaseMs)));
    if (target < .005 && smoothed < .005) smoothed = 0;
    smoothedAt = now;
    return smoothed;
  }
  function stop(fadeMs = 30) {
    const fade = Number.isFinite(fadeMs) ? fadeMs : 30;
    let remaining = 0;
    for (const j of [...jobs]) remaining = Math.max(remaining, cancel(j, j.vocal?0:fade));
    // Render fade plus the output pipeline latency is an estimate of acoustic silence.
    return remaining + (remaining ? ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 : 0);
  }
  async function close() {
    stop(0);
    if (ctx && ctx.state !== 'closed') await ctx.close();
    for (const j of [...jobs]) j.finish();
    master?.disconnect();
    analyser?.disconnect();
  }
  return { resume, loadClips, playClip, say, atMs, amplitude, stop, speaking, speakingWords: () => speaking(true), close,
    get echoReferences() { return echoReferences(); },
    get context() { return context(); },
    get master() { context(); return master; }, // Output-only trace tap; never a microphone.
    get echoLines() { return echoLines(); },
    get currentLine() {
      return [...jobs].reverse().find(j => j.line && !j.settled && j.start != null && j.start <= ctx.currentTime && j.end > ctx.currentTime)?.line || '';
    } };
}
