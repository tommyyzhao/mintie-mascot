export function normalizeText(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function echoPrefixWords(text, line) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const spoken = normalizeText(line).split(' ').filter(Boolean);
  let best = 0;
  for (let offset = 0; offset < spoken.length; offset++) {
    let matched = 0;
    while (matched < words.length && words[matched] === spoken[offset + matched]) matched++;
    // Ordered fragments need three words; a complete short line still is echo evidence.
    if (matched >= 3 || matched > 0 && matched === spoken.length) best = Math.max(best, matched);
  }
  return best;
}

export function fuzzyEchoMatch(partial, line) {
  const words = normalizeText(partial).split(' ').filter(Boolean);
  return words.length > 0 && echoPrefixWords(partial, line) === words.length;
}

// Local energy only earns its keep for the 250 ms backchannel nod (C5).
// Flux owns onset/end admission; energy never commits a transcript.
export function createEnergyVAD({ onPause = () => {}, onOnset = () => {}, onBlocked = () => {}, pauseMs = 250 } = {}) {
  const noise = [];
  let floor = .003, warmup = 0, voiced = 0, silence = 0, active = false, paused = false, lastSpeechAt = null, blockedUntil = -Infinity;
  function reset() { voiced = silence = 0; active = paused = false; lastSpeechAt = null; }
  return {
    reset,
    push(bytes, at, speaking = false) {
      if (speaking) blockedUntil = at + 100;
      if (speaking || at < blockedUntil) {
        if (!speaking) onBlocked({ msBlockedAfterSpeech: bytes.byteLength / 32 });
        reset(); return;
      }
      const view = new DataView(bytes), duration = bytes.byteLength / 32;
      for (let offset = 0; offset < view.byteLength; offset += 640) {
        const end = Math.min(offset + 640, view.byteLength), ms = (end - offset) / 32;
        let sum = 0;
        for (let i = offset; i < end; i += 2) sum += (view.getInt16(i, true) / 32768) ** 2;
        const energy = Math.sqrt(sum / ((end - offset) / 2));
        if (!active && !voiced) {
          noise.push(energy); if (noise.length > 150) noise.shift();
          floor = Math.max(.001, Math.min(warmup < 1000 ? .01 : Infinity,
            [...noise].sort((a, b) => a - b)[Math.floor((noise.length - 1) * .1)]));
        }
        warmup += ms;
        // ponytail: energy is not a speech classifier; persistent music needs a trained VAD.
        if (energy > Math.max(.008, floor * 3)) {
          voiced += ms; silence = 0; paused = false;
          lastSpeechAt = at - duration + end / 32;
          // Onset fires once per turn, ~120 ms after voicing; Flux StartOfTurn arrives 300–520 ms later.
          if (voiced >= 120 && !active) { active = true; onOnset({ at: lastSpeechAt - voiced, detectedAt: at }); }
        } else {
          if (!active) { voiced = 0; continue; }
          silence += ms;
          if (!paused && silence >= pauseMs) { paused = true; onPause({ at: lastSpeechAt, detectedAt: at }); }
        }
      }
    },
  };
}

// https://developers.deepgram.com/docs/flux/quickstart
export function fluxUrl({ eot = 0.5 } = {}) {
  const url = new URL('wss://api.deepgram.com/v2/listen');
  url.search = new URLSearchParams({ model: 'flux-general-multi', encoding: 'linear16',
    sample_rate: '16000', eot_threshold: String(eot), eot_timeout_ms: '5000' });
  url.searchParams.append('language_hint', 'en');
  url.searchParams.append('language_hint', 'es');
  url.searchParams.append('language_hint', 'ru');
  return url.href;
}

export function createVoice({ audio, eot = 0.5, pauseMs = 250, onOnset = () => {}, onPartial = () => {}, onCommit = () => {}, onSpeechStart = () => {}, onSpeechEnd = () => {}, onSpeechCancel = () => {}, onPause = () => {}, onDiagnostic = () => {}, onState = () => {}, onError = () => {} }) {
  let current = null, state = 'idle', lastPartial = '';
  function setState(next) { state = next; onState(next, { at: performance.now() }); }
  function cleanup(session) {
    clearTimeout(session.timeout);
    session.controller.abort();
    if (session.worklet) { session.worklet.port.onmessage = null; session.worklet.port.close(); session.worklet.disconnect(); }
    session.source?.disconnect();
    session.stream?.getTracks().forEach(track => track.stop());
    if (session.socket) {
      session.socket.onopen = session.socket.onmessage = session.socket.onerror = session.socket.onclose = null;
      session.socket.close();
    }
  }
  function fail(session, code, status) {
    if (current !== session) return;
    current = null;
    cleanup(session);
    session.reject?.(Object.assign(new Error(code), { code }));
    setState('error');
    onError({ stage: 'stt', code, ...(status ? { status } : {}) });
  }
  function stop() {
    const session = current;
    current = null; lastPartial = '';
    if (session) {
      cleanup(session);
      session.reject?.(new DOMException('Cancelled', 'AbortError'));
    }
    if (state !== 'idle') setState('idle');
  }
  function holdInput(session, inputReady) {
    if (!inputReady) return;
    session.inputEnabled = false;
    setState('connecting');
    const gate = session.inputGate = Promise.resolve(inputReady);
    gate.then(() => {
      if (current !== session || session.inputGate !== gate) return;
      session.inputEnabled = true;
      if (session.source) setState('listening');
    }, () => { if (current === session) fail(session, 'input_gate_failed'); });
  }
  function start({ inputReady } = {}) {
    if (current) { holdInput(current, inputReady); return current.promise; }
    // Calling code must request capture directly within a user gesture, never on load/timers.
    if (!navigator.userActivation?.isActive) return Promise.reject(new Error('user_gesture_required'));
    const session = { controller: new AbortController(), stream: null, source: null, worklet: null,
      socket: null, ready: false, inputEnabled: true };
    current = session; lastPartial = '';
    holdInput(session, inputReady);
    session.endedTurn = session.startedTurn = -1;
    session.echoTurns = new Map();
    session.vad = createEnergyVAD({ onPause: result => {
      if (session.startedTurn > session.endedTurn) onPause(result);
      else session.pendingPause = result;
    }, onOnset, onBlocked: onDiagnostic, pauseMs });
    // Resume synchronously within the gesture, before getUserMedia/token awaits.
    let resumed, media;
    try {
      resumed = audio.resume();
      resumed.catch(() => {});
      media = navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
    } catch (error) {
      fail(session, error.name === 'NotAllowedError' ? 'microphone_denied' : 'capture_failed');
      return Promise.reject(error);
    }
    setState('connecting');
    // Fresh 30-second token starts only on Talk, parallel to permission/worklet setup.
    const token = fetch('/api/stt-token', { method:'POST', headers:{'Content-Type':'application/json'},
      body:'{}', signal:session.controller.signal });
    token.catch(()=>{});
    const context = audio.context;
    const capture = (async()=>{
      const stream = await media;
      if (current !== session) { stream.getTracks().forEach(track=>track.stop()); return; }
      session.stream = stream;
      await resumed;
      await context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url));
    })();
    capture.catch(error=>{if(current===session)fail(session,error.name==='NotAllowedError'?'microphone_denied':'capture_failed');});
    session.promise = (async () => {
      try {
        const response = await token;
        if (!response.ok) { fail(session, 'token_http', response.status); return; }
        const data = await response.json();
        if (typeof data.token !== 'string' || !data.token) throw new Error('invalid_token_response');
        if (current !== session) return;
        await new Promise((resolve, reject) => {
          session.reject = reject;
          session.timeout = setTimeout(() => fail(session, 'connection_timeout'), 15000);
          const socket = session.socket = new WebSocket(fluxUrl({ eot }), ['bearer', data.token]);
          socket.onmessage = async event => {
            if (current !== session) return;
            let message;
            try { message = JSON.parse(event.data); } catch { fail(session, 'invalid_message'); return; }
            if (!message || typeof message !== 'object') { fail(session, 'invalid_message'); return; }
            if (message.type === 'Connected') {
              if (session.ready) return;
              session.ready = true;
              clearTimeout(session.timeout);
              try { await capture; await session.inputGate; } catch { return; }
              if (current !== session) return;
              session.source = context.createMediaStreamSource(session.stream);
              session.worklet = new AudioWorkletNode(context, 'mintie-mic-pcm');
              session.worklet.port.onmessage = ({ data: frame }) => {
                if (current !== session || !session.inputEnabled || socket.readyState !== WebSocket.OPEN) return;
                if (socket.bufferedAmount > 64000) { fail(session, 'audio_backpressure'); return; }
                const at = performance.now();
                session.samples ??= 0;
                session.audioStartedAt = at - (session.samples + frame.byteLength) / 32;
                session.samples += frame.byteLength;
                // Fillers have no lexical echo; they must not extend local onset suppression.
                session.vad.push(frame, at, audio.speakingWords?.() ?? audio.speaking());
                socket.send(frame);
              };
              session.source.connect(session.worklet).connect(context.destination); // Worklet outputs silence.
              if (session.inputEnabled) setState('listening');
              resolve();
              session.reject = null;
            } else if (message.type === 'TurnInfo') {
              if (!session.inputEnabled) return;
              let { transcript: text } = message;
              const { turn_index: turn, event: kind } = message;
              if (typeof text !== 'string' || !Number.isInteger(turn) || turn < 0) { fail(session, 'invalid_message'); return; }
              if (turn <= session.endedTurn) return;
              const at = performance.now();
              let echoTurn = session.echoTurns.get(turn);
              if (!echoTurn) {
                const start = message.words?.[0]?.start;
                const heardAt = Number.isFinite(start) && start >= 0 && session.audioStartedAt != null
                  ? Math.min(at, session.audioStartedAt + start * 1000) : at;
                // Pin references to this turn, not the session: old lines cannot poison later replies.
                const lines = audio.echoReferences
                  ? audio.echoReferences.filter(ref => heardAt >= ref.startAt && heardAt <= ref.endAt + 150).map(ref => ref.line)
                  : (audio.echoLines ?? [audio.currentLine]).filter(Boolean);
                echoTurn = { lines, trimmed: false };
                session.echoTurns.set(turn, echoTurn);
                if (session.echoTurns.size > 16) session.echoTurns.delete(session.echoTurns.keys().next().value);
              }
              const words = normalizeText(text).split(' ').filter(Boolean);
              let prefix = 0;
              for (const line of echoTurn.lines) {
                const matched = echoPrefixWords(text, line);
                prefix = Math.max(prefix, matched);
              }
              const echo = prefix > 0 && prefix === words.length;
              if (echo) onDiagnostic({ echoDropped: 1 });
              else if (prefix) {
                // Strip an evidenced, ordered echo prefix; preserve the user's remainder verbatim.
                const tokens = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)];
                text = text.slice(tokens[prefix]?.index ?? text.length).trim();
                if (!echoTurn.trimmed) { echoTurn.trimmed = true; onDiagnostic({ mergedTurnsTrimmed: 1 }); }
              }
              const normalized = normalizeText(text);
              if (kind === 'EndOfTurn') {
                const admitted = session.startedTurn === turn;
                session.endedTurn = turn; lastPartial = ''; session.vad.reset(); session.pendingPause = null;
                for (const index of session.echoTurns.keys()) if (index <= turn) session.echoTurns.delete(index);
                if (echo || !normalized) {
                  onDiagnostic({ cancelledTurns: 1 });
                  if (admitted) onSpeechCancel();
                  return;
                }
                if (!admitted) { session.startedTurn = turn; onSpeechStart({ at }); if (audio.speaking()) audio.stop(); }
                const end = Array.isArray(message.words) ? message.words.at(-1)?.end : null;
                const speechEndAt = Number.isFinite(end) && end >= 0 && session.audioStartedAt != null
                  ? Math.min(at, session.audioStartedAt + end * 1000) : at;
                onSpeechEnd({ at: speechEndAt, detectedAt: at });
                onCommit({ text, at, speechEndAt, committedAt: at, fallback: false });
                return;
              }
              if (echo) return;
              // Wait for evidence on an ambiguous short playback prefix, never discard its final.
              if (normalized && words.length < 3 && (audio.speakingWords?.() ?? audio.speaking())
                && echoTurn.lines.some(line => normalizeText(line).startsWith(normalized + ' '))) return;
              // A bare onset during playback could be their echo. Admit it on the first non-echo words.
              if (session.startedTurn !== turn && (normalized || kind === 'StartOfTurn' && !audio.speaking())) {
                session.startedTurn = turn; lastPartial = '';
                onSpeechStart({ at });
                if (session.pendingPause) { onPause(session.pendingPause); session.pendingPause = null; }
                if (audio.speaking()) audio.stop();
              }
              if (normalized && normalized !== lastPartial) {
                lastPartial = normalized;
                onPartial({ text, at });
              }

            } else if (message.type === 'FatalError') {
              // Never forward provider prose, which can contain text/secrets.
              fail(session, 'provider_error');
            }
          };
          socket.onerror = () => fail(session, 'socket_error');
          socket.onclose = event => fail(session, 'socket_closed', event.code);
        });
      } catch (error) {
        if (current === session) fail(session, error.name === 'NotAllowedError' ? 'microphone_denied' : 'connection_failed');
      }
    })();
    // A rejected resume must not become an unhandled rejection while permission prompt is open.
    resumed.catch(() => {});
    return session.promise;
  }
  return { start, stop };
}
