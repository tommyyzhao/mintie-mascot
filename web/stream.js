// One head + one tail; full-line offsets stay in the original UTF-16 coordinate space.
export async function speakCascade(audio, headReady, lineReady, { gate, when, signal, event = () => {} }) {
  const head = await headReady;
  if (!head) {
    const { line } = await lineReady;
    if (!line) return null;
    if (!await gate) return null;
    return audio.say(line, { gate, when, signal, align: true });
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const first = audio.say(head.line, { gate, when, signal: controller.signal, align: true });
  first.catch(error => event('stream_error', { code: /^(?:say_http_\d{3}|say_stream|invalid_alignment|incomplete_audio|empty_audio)$/.test(error.message) ? error.message : error.name }));
  try {
    const { line } = await lineReady;
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (typeof line !== 'string' || !line.startsWith(head.line)) {
      controller.abort();
      event('stream_mismatch');
      // Allow the cancelled head's 30ms fade to finish before the replacement begins.
      return line ? await audio.say(line, { gate, when: () => Math.max(when(), audio.atMs(performance.now() + 30)), signal, align: true }) : null;
    }
    const rest = line.slice(head.line.length);
    if (!rest.trim()) return await first;
    let end;
    const tailGate = Promise.all([gate, first.then(job => job.endAt)]).then(([allowed, at]) => {
      end = at;
      return allowed && at !== null && !signal.aborted;
    });
    const tail = audio.say(rest, { gate: tailGate, when: () => end, signal, align: true, previous_text: head.line });
    tail.catch(error => event('stream_error', { code: /^(?:say_http_\d{3}|say_stream|invalid_alignment|incomplete_audio|empty_audio)$/.test(error.message) ? error.message : error.name }));
    const job = await first;
    const done = Promise.all([job.done, tail.then(next => next.done)]).then(() => {});
    done.catch(() => {});
    void tail.then(next => event('stream_seam', { headEnd: end, tailStart: next.startAt, gapMs: (next.startAt - end) * 1000 }), () => {});
    return { ...job, done, charTime: offset => {
      if (!Number.isInteger(offset) || offset < 0 || offset >= line.length) return Promise.reject(new RangeError('invalid_char_offset'));
      return offset < head.line.length ? job.charTime(offset) : tail.then(next => next.charTime(offset - head.line.length));
    } };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    // Keep the relay through playback: caller's signal also owns the already-scheduled head.
    void first.then(job => job.done, () => {}).then(() => signal.removeEventListener('abort', abort), () => signal.removeEventListener('abort', abort));
  }
}
