import { CATALOG } from './perform/emoji.js';
import { createPerformer } from './perform/engine.js';
import { createCharacter } from './character/index.js';
import { createTouch } from './touch.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';
import { createTrace } from './trace.js';
import { STROKE_THRESHOLDS, cuePlan, nodAllowed, beatsSuppressed } from './realizer.js';
import { createNeeds } from './needs.js';
import { speakCascade } from './stream.js';
import { createMemory } from './memory.js';
import { ensureSession } from './turnstile.js';

const elements = new Map([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const $ = id => elements.get(id);
const text = (id, value) => { const node = $(id); if (node.textContent !== value) node.textContent = value; };
const emojiButtons = new Map();
let selectedButton;
const audio = createAudio({event:(type,data)=>{if(trace.enabled)trace.emit(type,{fadeMs:data.fadeMs,startAt:trace.mapping(data.at).at,endAt:trace.mapping(data.end).at});}}), touch = createTouch(), needs = createNeeds();
let t = 0, lastFrame = performance.now(), frameId, character;
let listening = false, dynamics = {com:[0,0,0],state:'idle'}, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Memory lives in this browser only: {name, facts}. The server learns it from the conversation and sends full replacements.
const memory = createMemory(localStorage);
const debugPanel = new URLSearchParams(location.search).has('debug') ? (await import('./debug.js')).createDebugPanel({ memory }) : null;
let voiceState = 'idle', voiceStartedAt = null, firstPartialAt = null, voiceAvailable = false, voiceWanted = false, healthAnswered = false, callSerial = 0;
let request = null, requestSerial = 0, reactionSerial = 0, run = null, pointer = null, disposed = false;
let arrivalPending = true, arrivalWave = null;
function cancelArrival() { arrivalPending = false; if (arrivalWave) performer.cancel(arrivalWave.id); arrivalWave = null; }
let stateShown = '', history = [];
const metrics = { selectorMs: null, replyMotionMs: null, commitMotionMs: null, motionAudioMs: null, ttsMs: null, partialMs: null, commitMs: null, speechEndToMotionMs: null, lastPartialAt: null, commitAt: null, emojiAt: null, motionAt: null,
  localSpeechEndAt: null, speechEndDetectedAt: null, ackMotionAt: null, speechEndToAckMs: null, speechEndToCommitMs: null, speechEndToEmojiMotionMs: null, transcriptFallback: false,
  echoDropped: 0, mergedTurnsTrimmed: 0, cancelledTurns: 0, msBlockedAfterSpeech: 0 };
const performer = createPerformer({ now: () => t });
const trace = createTrace({ audio, performer, touch, pick: (x,y) => character?.pick(x,y) });
const traced = (type, fn) => data => { if (trace.enabled) trace.textEvent(type, data); return fn(data); };
// Guard errors (contract 11): the provider-side limits pause voice, never touch or emotes.
const GUARD = { daily_limit: 'Mintie’s voice is resting until tomorrow — you can still play.', ip_limit: 'Mintie needs a little breather — try again in a minute. You can still play.', human_check: 'Mintie could not confirm you are a person. Reload to try again — you can still play.' };
const FAILURE = /^(Their (response|voice)|Could not (connect|start)|Audio could not|That was too)/;
let resting = null, restingTimer;
const status = value => {
  if (resting && FAILURE.test(value)) value = GUARD[resting];
  $('status').textContent = value;
  $('status').classList.toggle('sr-only', !/^(No |Voice |Microphone |Could not |Tap again|Local sounds|Conversation ended|Mintie)/.test(value));
};
function guardNotice(code) {
  if (!GUARD[code] || disposed) return;
  resting = code; clearTimeout(restingTimer);
  // A daily ceiling stays until reload; a per-IP rate limit clears after a minute.
  if (code === 'daily_limit') { voiceAvailable = false; reactAvailable = false; }
  else restingTimer = setTimeout(() => { resting = null; $('controls').dataset.resting = 'false'; debugPanel?.setResting(null); status('Tap Talk to chat.'); }, 60000);
  $('controls').dataset.resting = 'true';
  debugPanel?.setResting(code); status(GUARD[code]); showVoiceState();
}
// Paid routes need a human-check cookie (hosted demo only; ensureSession is a no-op on local Node). Retry once after human_check.
// ponytail: one fetch wrapper covers react/say/stt-token without threading a client through audio.js/voice.js; same-origin paths only.
const nativeFetch = window.fetch.bind(window), PAID = /^\/api\/(react|say|stt-token)$/;
const errorCode = response => response.clone().json().then(body => body?.error?.code, () => null);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href);
  if (url.origin !== location.origin || !PAID.test(url.pathname)) return nativeFetch(input, init);
  try { await ensureSession(); } catch { guardNotice('human_check'); return Response.json({ error: { stage: 'session', code: 'human_check' } }, { status: 403 }); }
  let response = await nativeFetch(input, init);
  if (response.status === 403 && await errorCode(response) === 'human_check') {
    try { await ensureSession({ force: true }); response = await nativeFetch(input, init); } catch { /* falls through to the notice below */ }
  }
  if (!response.ok && [403, 429].includes(response.status)) guardNotice(await errorCode(response));
  return response;
};
const hint = $('hint');
function hideHint() {
  if (hint.hidden || hint.dataset.show === 'false') return;
  hint.dataset.show = 'false'; try { localStorage.setItem('mintie-hint', '1'); } catch {}
  setTimeout(() => { hint.hidden = true; }, 500);
}
let warmed = false;
function interact() {
  hideHint(); if (!warmed) { warmed = true; void ensureSession().catch(() => {}); } // Warm the human check on the first gesture, before the first paid call.
  audio.resume().catch(() => status('Tap again to turn on audio.'));
}
function showVoiceState() {
  $('controls').dataset.available = String(voiceAvailable);
  const speaking = audio.speaking();
  const state = voiceState === 'error' ? 'error' : speaking ? 'speaking' : voiceState;
  if (stateShown !== state) {
    stateShown = state;
    $('controls').dataset.state = $('voice-state').dataset.state = state;
    $('voice-state').textContent = { idle: 'Idle', connecting: 'Connecting', listening: 'Listening', speaking: 'Speaking', error: 'Disconnected' }[state] || state;
  }
  const talkDisabled = !voiceAvailable || voiceWanted;
  const endDisabled = !voiceWanted && !speaking && !run?.pendingAudio && !request;
  const ending = voiceWanted;
  const focused = document.activeElement === $('talk') || document.activeElement === $('end');
  if ($('talk').disabled !== talkDisabled) $('talk').disabled = talkDisabled;
  if ($('end').disabled !== endDisabled) $('end').disabled = endDisabled;
  if ($('talk').hidden !== ending) {
    $('talk').hidden = ending; $('end').hidden = !ending;
    if (focused) $(ending ? 'end' : 'talk').focus();
  }
}
// ponytail: explicit emote vocabulary avoids deleting parenthetical speech; extend for new audio tags.
const captionText = value => String(value ?? '')
  .replace(/\[[^\]]*(?:\]|$)/g, ' ')
  .replace(/\((?:giggles?|laughs?|sighs?|gasps?|snickers?|chuckles?|whispers?|hums?|happy hum)\)|\*(?:giggles?|laughs?|sighs?|gasps?|snickers?|chuckles?|whispers?|hums?|happy hum)\*/gi, ' ')
  .replace(/\s+/g, ' ').replace(/^\s*[,;:.!?]+\s*/, '').replace(/\s+([,;:.!?])/g, '$1').trim();
let captionTimer;
function caption(id, value, final = true) {
  const clean = captionText(value), node = $(id);
  text(id, clean ? `${id === 'heard' ? 'you: ' : ''}${clean}` : ''); node.hidden = !clean;
  if (final && clean) text('caption-announcement', `${id === 'heard' ? 'You' : 'Mintie'}: ${clean}`);
  $('caption').classList.toggle('visible', !$('heard').hidden || !$('said').hidden);
  clearTimeout(captionTimer);
  // ponytail: one inactivity clock for both lines; add per-turn history only if captions become a transcript.
  captionTimer = setTimeout(() => $('caption').classList.remove('visible'), 6500);
}
const heard = (value, final = false) => caption('heard', value, final);
const said = (value, final = true) => caption('said', value, final);
function announce(emoji, line) {
  if (emoji === 'SPEAK') {
    said(line);
    selectedButton?.setAttribute('aria-pressed','false'); selectedButton = null;
    return;
  }
  const name = CATALOG[emoji]?.name_en ?? emoji;
  $('announcement').textContent = line ? '' : `Mintie: ${emoji} ${name}`;
  said(line ?? '', Boolean(line));
  const button = emojiButtons.get(emoji);
  if (selectedButton !== button) {
    selectedButton?.setAttribute('aria-pressed', 'false');
    button?.setAttribute('aria-pressed', 'true');
    selectedButton = button;
  }
}
function audioError(error, id) {
  if (disposed || id !== reactionSerial || error?.name === 'AbortError') return;
  clearTimeout(run?.captionTimer); said('');
  status(error?.message === 'audio_not_running' || error?.message === 'audio_interrupted' ? 'Tap again to turn on audio.' : 'Audio could not play. Their reaction is still here.');
}
async function react({ emoji, line = null, recipe }, { replyAt = performance.now(), commitAt = null, source = 'local', lineReady = null, speechEndAt = null, candidate = null } = {}) {
  if (emoji !== 'SPEAK' && !Object.hasOwn(CATALOG, emoji)) return null;
  cancelArrival();
  if (source === 'local') { cancelReaction(); localTurn = false; }
  received=null;
  acknowledgement = null;
  const id = ++reactionSerial;
  clearTimeout(run?.captionTimer); run?.controller.abort(); run?.resolve(null);
  audio.stop();
  const handle = performer.play(recipe ?? (emoji === 'SPEAK' ? {face:'awe',mouth:'tinyO',body:'perk',loop:'breathe',buds:'none',anticipationMs:0,durationMs:1200} : emoji), { reflex: source === 'touch' || emoji === 'SPEAK',
    sustainUntil: () => id === reactionSerial && run?.pendingAudio && (candidate ? candidate.voice !== 'none' : !!line) });
  if(emoji==='🦘' && !candidate?.hopApplied)realizerHop({hop:'in_place',emoji:candidate?.emoji??emoji});
  metrics.replyMotionMs = metrics.commitMotionMs = metrics.motionAudioMs = metrics.ttsMs = null;
  announce(emoji, null);
  const started = new Promise(resolve => { run = { id, emoji, handle, resolve, replyAt, commitAt, source, speechEndAt, candidate, controller: new AbortController(), cues: [], motionAt: null, audioAt: null, pendingAudio: true }; });
  const thisRun = run;
  if (candidate) {
    const gate = started.then(motionAt => {
      if (motionAt === null || id !== reactionSerial || disposed || thisRun.controller.signal.aborted) return false;
      thisRun.audioTarget = Math.max(motionAt + (source === 'touch' ? 0 : handle.anticipationMs), performance.now());
      return true;
    });
    candidate.audio = speakCascade(audio, candidate.headReady, candidate.rawLine, {
      gate, when: () => (thisRun.audioWhen = audio.atMs(thisRun.audioTarget)), signal: thisRun.controller.signal,
      event: (type, data) => { if(trace.enabled)trace.emit(type, data?.headEnd === undefined ? data ?? {} : { headEnd:trace.mapping(data.headEnd).at,tailStart:trace.mapping(data.tailStart).at,gapMs:data.gapMs }); },
    });
    candidate.audio.catch(() => {});
  }
  const motionAt = await started;
  if (motionAt === null || id !== reactionSerial || disposed) return null;
  const action = remember({who:'mintie',emoji:emoji === 'SPEAK' ? null : emoji,said:null});
  // Scheduling waits for the tick that submitted this performance, never just play() admission.
  try {
    let display=line;
    if (lineReady) ({ line, display } = await lineReady);
    if (id !== reactionSerial || disposed) return null;
    const target = thisRun.audioTarget ?? Math.max(motionAt + (source === 'touch' ? 0 : handle.anticipationMs), performance.now());
    const when = audio.atMs(target);
    const audioRequestedAt = performance.now();
    const result = candidate?.audio ? await candidate.audio : line ? await audio.say(line, { when, signal: thisRun.controller.signal }) : null;
    if (result) {
      needs.event('mintieSpeech',t);
      action.said = line; action.at = performance.now();
      if (!history.includes(action)) remember({who:'mintie',emoji:action.emoji,said:line});
    }
    if (id !== reactionSerial || disposed) return null;
    if (result) {
      // Caption with the first audible sample (startAt is on the audio clock), not when say() resolves.
      const showCaption = () => {
        if (id !== reactionSerial || disposed || thisRun.controller.signal.aborted) return;
        const delay = (result.startAt - (audio.context?.currentTime ?? result.startAt)) * 1000;
        if (delay > 0) { thisRun.captionTimer = setTimeout(showCaption, delay); return; }
        announce(emoji, display);
      };
      showCaption();
      if(result.charTime)queueBlinks(thisRun,line,result);
      if(candidate?.cueReady && result.charTime)void candidate.cueReady.then(cue=>{if(cue && !thisRun.controller.signal.aborted && id===reactionSerial){queueCues(thisRun,cue,line,result);if(cue.timing==='after'&&!thisRun.pendingAudio)thisRun.cues.at(-1).start=audio.atMs(performance.now());}});
      // Use the scheduling conversion, not a second clock sample, for onset metrics.
      thisRun.audioAt = target + (result.startAt - (thisRun.audioWhen ?? when)) * 1000;
      thisRun.audioStartContext = result.startAt; candidate?.turn?.mark('audio', thisRun.audioAt);
      thisRun.audioTarget = target;
      metrics.motionAudioMs = thisRun.audioAt - motionAt;
      metrics.ttsMs = line ? thisRun.audioAt - audioRequestedAt : null;
      const settle = () => {
        clearTimeout(thisRun.captionTimer);
        thisRun.pendingAudio = false;
        for(const cue of thisRun.cues)if(cue.timing==='after')cue.start=audio.atMs(performance.now());
        if (id !== reactionSerial) return;
        thinkingUntil = 0;
        const active = performer.active(); if (active) performer.cancel(active.id);
        pumpCues(performance.now());
      };
      result.done.then(settle, error => { settle(); audioError(error, id); });
    } else { thisRun.pendingAudio = false; metrics.motionAudioMs = null; metrics.ttsMs = null; }
    return { ...thisRun, resolve: undefined, candidate: undefined };
  } catch (error) {
    if (id !== reactionSerial || disposed || error?.name === 'AbortError') { thisRun.pendingAudio = false; return null; }
    thisRun.pendingAudio = false; said('');
    if (source !== 'fallback') return fallback('Their voice did not come through. Try again.');
    audioError(error, id); return null;
  }
}
function localReaction(reaction) {
  cancelReaction(); localTurn = false; acknowledgement = null; interact();
  return react(reaction);
}
function fallback(message) {
  status(message);
  return react({ emoji: '🤔' }, { source: 'fallback' });
}
function validCue(cue,line) {
  if(cue===null)return true;
  if(!cue || Object.keys(cue).some(k=>!['emoji','at','timing'].includes(k)) || ![undefined,'before','word','after'].includes(cue.timing) || !Object.hasOwn(CATALOG,cue.emoji) || !Number.isInteger(cue.at) || typeof line!=='string')return false;
  const plain=line.replace(/\[[^\]]*\]/g,tag=>' '.repeat(tag.length));
  return [...plain.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].some(word=>word.index===cue.at);
}
function queueCues(owner, chosen, line, result) {
  if(chosen.timing==='before' || chosen.timing==='after') {
    const cue={emoji:chosen.emoji,timing:chosen.timing,start:chosen.timing==='before'?audio.atMs(performance.now()):Infinity,strokeMs:0};
    owner.cues.push(cue);return;
  }
  const word=line.slice(chosen.at).match(/^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/u)?.[0];
  if(!word)return;
  const first=!line.slice(0,chosen.at).replace(/\[[^\]]*\]/g,'').trim();
  const end=chosen.at+word.length, terminal=end>=line.length;
  const cue={emoji:chosen.emoji,anticipationMs:CATALOG[chosen.emoji].recipe.anticipationMs,first,start:Infinity,moving:true};
  owner.cues.push(cue);
  void (async()=>{
    try {
      const wordAt=first?result.startAt:await result.charTime(chosen.at);
      if(owner.controller.signal.aborted || owner.id!==reactionSerial){dropCue(owner,cue,'newer_choice');return;}
      if(wordAt===null){cue.start=audio.atMs(performance.now());cue.strokeMs=0;cue.timing='unaligned';return;}
      cue.wordAt=wordAt;cue.wordEnd=Infinity;cue.endPending=true;
      const endReady=result.charTime(terminal?end-1:end).then(wordEnd=>{
        cue.wordEnd=wordEnd===null?wordAt+.10:wordEnd+(terminal?.10:0);cue.endPending=false;
      }).catch(()=>{cue.wordEnd=wordAt;cue.endPending=false;});
      // Wait for the word end too: an unknown endpoint cannot authorize a late stroke.
      await endReady;
      if(owner.controller.signal.aborted || owner.id!==reactionSerial){dropCue(owner,cue,'newer_choice');return;}
      cue.strokeMs=performer.predictStroke(cue.emoji,{nowMs:t,inputs:{...lastRealizerInputs,speaking:0,suppressBeats:true,thinking:false},thresholds:STROKE_THRESHOLDS});
      cue.strokeMs??=0;
      const plan=cuePlan({wordAt,wordEnd:cue.wordEnd,now:audio.atMs(performance.now()),strokeMs:cue.strokeMs,primaryAt:audio.atMs(owner.replyAt)});
      // Late affiliate: preserve their choice, play now rather than silently discard it.
      cue.start=plan?.start??audio.atMs(performance.now());cue.strokeAt=plan?.strokeAt??cue.start+cue.strokeMs/1000;
      if (trace.enabled) trace.emit('cue_scheduled', { run: owner.id, emoji: cue.emoji, offset: chosen.at, anticipationMs: cue.anticipationMs, wordAt: trace.mapping(wordAt).at, startAt: trace.mapping(cue.start).at, strokeMs:cue.strokeMs,strokeAt:trace.mapping(cue.strokeAt).at });
    } catch {dropCue(owner,cue,'alignment_unavailable');} finally {cue.moving=false;}
  })();
}
function dropCue(owner,cue,reason) {
  cue.dropped=true;
  if(trace.enabled)trace.emit('cue_dropped',{run:owner.id,emoji:cue.emoji,reason});
}
// Realizer: blink just after commas/periods while speaking (ALIVE.md T12; speaking blink rate was 3–6/min).
function queueBlinks(owner,line,result) {
  owner.blinks=[];
  for(const m of line.matchAll(/[,.!?…;:](?=\s+\S)/gu))void result.charTime(m.index).then(at=>{if(at!==null && owner.id===reactionSerial)owner.blinks.push(at+.08);if(trace.enabled)trace.emit('blink_queued',{run:owner.id,ok:at!==null&&owner.id===reactionSerial});}).catch(()=>{});
}
function pumpCues(now) {
  if (!run || run.controller.signal.aborted || run.id !== reactionSerial) return;
  const contextNow = audio.atMs(now);
  if (run.blinks?.some(at => contextNow >= at)) { run.blinks = run.blinks.filter(at => contextNow < at); const ok = performer.blink(t); if (trace.enabled) trace.emit('cue_blink', { run: run.id, ok }); }
  for (const cue of run.cues) {
    if (!cue.timing && !cue.played && !cue.dropped && !cue.moving && !cue.fresh && contextNow >= cue.start - .15) {
      // Re-predict from the live pose <=150 ms ahead: schedule-time predictions run 0.2–3.7 s early, before the primary pose moved (✨ predicted 250, landed ~365 ms).
      cue.fresh = true;
      const strokeMs = performer.predictStroke(cue.emoji, { nowMs: t, inputs: { ...lastRealizerInputs, speaking: 0, suppressBeats: true, thinking: false }, thresholds: STROKE_THRESHOLDS });
      const plan = strokeMs === null ? null : cuePlan({ wordAt: cue.wordAt, wordEnd: cue.wordEnd, now: contextNow, strokeMs, primaryAt: audio.atMs(run.replyAt) });
      cue.strokeMs = strokeMs??0; cue.start = plan?.start??contextNow; cue.strokeAt = plan?.strokeAt??contextNow+cue.strokeMs/1000;
    }
    if (cue.played || cue.dropped || cue.moving || contextNow < cue.start || cue.endPending && contextNow > cue.wordAt + .10) continue;
    const owner = run;
    cue.played = performer.play(cue.emoji, { reflex: false, elapsedMs: 0,
      sustainUntil: () => owner.id === reactionSerial && owner.pendingAudio });
    cue.strokeAt=contextNow+cue.strokeMs/1000;
    if(cue.emoji==='🦘' && !realizerHop({hop:'in_place',emoji:cue.emoji}))dropCue(owner,cue,'physical_impossibility');
    cue.startedAt = contextNow;
    if (trace.enabled) trace.emit('cue_played', { run: run.id, emoji: cue.emoji, timing:cue.timing??'word',wordAt: Number.isFinite(cue.wordAt)?trace.mapping(cue.wordAt).at:null, startAt: trace.mapping(contextNow).at });
  }
}
function onPause({ at, detectedAt }) {
  void listenReaction(detectedAt);
  if (!speechActive || !Number.isFinite(at) || !Number.isFinite(detectedAt) || detectedAt - lastBackchannelAt < 1200) return;
  if(!nodAllowed({speechAt,at,detectedAt,lastNodAt:lastBackchannelAt}))return;
  lastBackchannelAt = detectedAt; pauseAt = t;
  if(trace.enabled)trace.emit('backchannel_nod',{speechAt,sourceAt:at});
  metrics.localSpeechEndAt = at;metrics.speechEndDetectedAt = detectedAt;
  metrics.ackMotionAt = metrics.speechEndToAckMs = null;
  acknowledgement = { local: true, speechEndAt: at, motionAt: null };
}
// Listener attends at the speaker's turn start (Kendon 1967); local energy beats the first provider partial by ~300–500 ms.
function onLocalOnset() { if (!disposed) performer.look('viewer', { durationMs: 1500 }); }
function onSpeechStart({at=performance.now()}={}) {
  cancelArrival();
  speechAt=at;listenerWords=0;
  needs.event('userSpeech',t);
  speechActive = true; pendingTouch = null;
  cancelReaction(); localTurn = false;
  acknowledgement = null; listening = true;
}
function onSpeechEnd({ at, detectedAt = performance.now() }) {
  if (disposed || !Number.isFinite(at)) return;
  speechActive = false; localTurn = true;
  metrics.localSpeechEndAt = at; metrics.speechEndDetectedAt = detectedAt;
  metrics.speechEndToCommitMs = metrics.speechEndToEmojiMotionMs = null;
  metrics.transcriptFallback = false;
  // The 250ms pause already nodded; endpoint admission must not replace it or cancel a request.
  listening = true; status('…');
  receivedHold(at,detectedAt);
}
function receivedHold(speechEndAt,detectedAt=performance.now()) {
  if(received)return;
  received={speechEndAt,detectedAt,submitted:false};
  // Uptake nod at EndOfTurn (T1) unless a pause nod played in the last 1.2 s; never cut a running nod.
  const now=performance.now();if(now-lastBackchannelAt>=1200){pauseAt=t;lastBackchannelAt=now;}
  const active=performer.active();if(active)performer.cancel(active.id);
  performer.look('viewer',{durationMs:6000});
}
function onPartial({ text, at }) {
  if (typeof text !== 'string' || !text.trim() || !Number.isFinite(at)) return;
  if (text.length > 500) { cancelReaction(); partialText = ''; partialAt = null; listening = true; return; }
  const normalized = normalizeTranscript(text);
  if (!normalized || normalized === partialText) return; // Repeated provider partials are not barge-ins.
  if (localTurn) { partialText = normalized; partialAt = at; metrics.lastPartialAt = at; return; }
  if (!listening) firstPartialAt = null;
  cancelReaction(); // New words stop pending sound, not the already-visible performance.
  partialText = normalized; partialAt = at;
  metrics.lastPartialAt = at;
  metrics.speechEndToMotionMs = null;
  listening = true;
  firstPartialAt ??= at;
  metrics.partialMs = voiceStartedAt === null ? null : firstPartialAt - voiceStartedAt;
}
async function onCommit({ text, at, speechEndAt: localEndAt = null, committedAt = at, fallback: transcriptFallback = false }) {
  speechActive = false;
  if (typeof text !== 'string' || !normalizeTranscript(text) || text.length > 500 || !Number.isFinite(at)) {
    cancelReaction(); partialText = ''; partialAt = null; listening = false;
    return fallback('That was too long or unclear. Try something shorter.');
  }
  metrics.commitMs = voiceStartedAt === null || committedAt === null ? null : committedAt - voiceStartedAt;
  metrics.commitAt = committedAt;
  metrics.transcriptFallback = transcriptFallback;
  const speechEndAt = localEndAt ?? (localTurn ? metrics.localSpeechEndAt : partialAt);
  metrics.speechEndToCommitMs = speechEndAt === null || committedAt === null ? null : committedAt - speechEndAt;
  localTurn = false;
  partialText = ''; partialAt = null;
  cancelReaction();
  receivedHold(speechEndAt??at,committedAt??at);
  return requestReaction({ text, at, speechEndAt });
}
let partialText = '', partialAt = null;
let localTurn = false, acknowledgement = null;
let reactAvailable = false, speechActive = false, pendingTouch = null, flinchUntil = 0;
let thinkingUntil = 0, pauseAt = -Infinity, lastBackchannelAt = -Infinity;
let speechAt=null, received=null, tracedSuppressedBeats=0;
let listenerRequest=null, lastListenerAt=-Infinity, listenerWords=0;
let lastRealizerInputs={};
function retainedHistory(now,exclude) {
  const entries=history.filter(x=>x!==exclude),conversation=entries.filter(x=>x.who!=='touch').slice(-12);
  // ponytail: 28 recent contacts plus 12 conversational entries; oldest touch evicted only on overflow.
  return [...conversation,...entries.filter(x=>x.who==='touch' && now-x.at<=10000).slice(-(40-conversation.length))].sort((a,b)=>a.at-b.at);
}
function remember(entry) {
  const record={...entry,at:performance.now()};history.push(record);history=retainedHistory(record.at);return record;
}
function sendHistory(exclude) {
  const now=performance.now();
  return retainedHistory(now,exclude).map(({at,...entry})=>({...entry,agoMs:Math.max(0,Math.round(now-at))}));
}
function sceneState() {
  const self=dynamics.com,view=character?.view,position=view?.position??[-3.77,2.92,5.39];
  const dx=position[0]-self[0],dz=position[2]-self[2],dy=position[1]-(self[1]+.53),angle=Math.atan2(dx,dz);
  const bearings=['front','front-right','right','back-right','back','back-left','left','front-left'];
  return {viewer:{bearing:bearings[(Math.round(angle/(Math.PI/4))+8)%8],distanceH:Math.hypot(dx,dy,dz),aboveDeg:Math.atan2(dy,Math.hypot(dx,dz))*180/Math.PI},mintie:{x:self[0],z:self[2],state:dynamics.state==='held'?'held':['falling','airborne'].includes(dynamics.state)||self[1]>.01?'airborne':'idle'}};
}
function realizerHop({hop,emoji,to=null}) {
  const accepted=touch.hop?.({to})===true;
  if(!accepted && trace.enabled)trace.emit('cue_dropped',{emoji,reason:'physical_impossibility',hop});
  return accepted;
}
function applyMotion(reply,candidate) {
  received=null;
  const position=character?.view?.position??[-3.77,2.92,5.39],self=dynamics.com;
  const target=reply.gaze==='touch'?lastTouchTarget:position;
  performer.look?.(reply.gaze,{target,durationMs:2500});
  if(reply.hop==='none')return;
  const dx=position[0]-self[0],dz=position[2]-self[2],length=Math.hypot(dx,dz)||1;
  const toward=[dx/length,dz/length];
  const direction={toward_viewer:toward,away_from_viewer:toward.map(v=>-v),left:[-toward[1],toward[0]],right:[toward[1],-toward[0]]}[reply.hop];
  const to=direction?[self[0]+.8*direction[0],self[2]+.8*direction[1]]:null;
  candidate.hopApplied=realizerHop({hop:reply.hop,emoji:reply.emoji,to});
}
function onTouch(event, now) {
  needs.event(event.kind,t);
  debug.lastTouch = event;
  if (trace.enabled) trace.emit('touch', { ...event, engineAt: event.at, at: now });
  const compact = {who:'touch',kind:event.kind};
  for(const k of ['part','durationMs','speed','height','impact','repeat','intensity','path','spin','accel','jerk','release','g','from','to'])if(event[k] !== undefined)compact[k]=event[k];
  const entry = remember(compact);
  if(event.kind === 'contact') {flinchUntil = now + 160; return;}
  const sfx = {poke:'squish',pat:'boing',pet:'sparkle',lift:'stretch',drop:'plop',throw:'stretch',land:'plop'}[event.kind];
  if(sfx) void clipsReady.then(()=>audio.playClip(sfx)).then(result=>result?.done).catch(()=>{});
  if(reactAvailable && ['poke','pat','pet','lift','throw','shake','hold','drop','land'].includes(event.kind)) pendingTouch = {touch:event,at:now,entry};
}
function pumpTouch(now) {
  if(!pendingTouch || request || speechActive || localTurn || partialText || run?.pendingAudio) return;
  const pending = pendingTouch; pendingTouch = null;
  if(now-pending.at > 1500 || !reactAvailable) return;
  const candidate = {touch:pending.touch,commitAt:pending.at,failed:false,entry:pending.entry};
  void streamReaction(candidate,pending.at,null);
}
async function listenReaction(now) {
  const count=partialText.split(/\s+/).filter(Boolean).length;
  if(!reactAvailable || !speechActive || audio.speaking() || run?.pendingAudio || count-listenerWords<3 || now-lastListenerAt<3000)return;
  lastListenerAt=now;listenerWords=count;
  listenerRequest?.abort();
  const controller=listenerRequest=new AbortController(), current=partialText;
  const timer=setTimeout(()=>controller.abort(),1000);
  try {
    if(trace.enabled)trace.emit('listen_request',{words:count});
    const response=await fetch('/api/react',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:current,listening:true,localHour:new Date().getHours(),history:sendHistory(),scene:sceneState(),mood:needs.mood(),memory:memory.get()}),signal:controller.signal});
    if(!response.ok)return;
    const reply=await response.json();
    if(controller.signal.aborted || disposed || !speechActive || partialText!==current || audio.speaking() || run?.pendingAudio)return;
    if(Object.keys(reply).length!==1 || !(reply.emoji===null || Object.hasOwn(CATALOG,reply.emoji)))return;
    if(reply.emoji!==null) {
      if(reply.emoji==='🦘'&&!realizerHop({hop:'in_place',emoji:reply.emoji}))return;
      performer.play(reply.emoji);
      if(trace.enabled)trace.emit('listener_gesture',{emoji:reply.emoji});
    }
  } catch {} finally {clearTimeout(timer);if(listenerRequest===controller)listenerRequest=null;}
}
function normalizeTranscript(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function cancelReaction() {
  thinkingUntil = 0;
  listenerRequest?.abort();listenerRequest=null;
  for(const cue of run?.cues??[])if(!cue.played&&!cue.dropped)dropCue(run,cue,'newer_choice');
  // Realizer: late partials (words before the pause) must not erase a nod already playing.
  if (!(t - pauseAt < 420)) pauseAt = -Infinity;
  received=null;
  clearTimeout(run?.captionTimer); run?.controller.abort(); audio.stop(); said(''); ++reactionSerial; run?.resolve(null); if (run) run.pendingAudio = false;
  ++requestSerial; request?.abort(); request = null;
}
function requestReaction({ text, at, speechEndAt = null }) {
  pendingTouch = null;
  return streamReaction({text,commitAt:at,failed:false,entry:remember({who:'user',text})}, at, speechEndAt);
}
async function streamReaction(candidate, at, speechEndAt) {
  if(!candidate.touch) listening = true;
  const serial = ++requestSerial;
  request?.abort();
  const controller = request = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), 6000);
  let emoji, voiceMode, performanceReady, finishLine, finishCue, finishHead, headReceived=false, lineValue, lineReceived=false, finished = false;
  candidate.headReady=new Promise(resolve=>{finishHead=resolve;});
  candidate.cueReady=new Promise(resolve=>{finishCue=resolve;});
  const streamedLine = new Promise(resolve => { finishLine = resolve; });
  candidate.rawLine = streamedLine;
  // Fresh voice waits for submitted motion. Cancellation never releases stale sound.
  const lineReady = streamedLine.then(line => {
    if (!lineReceived || controller.signal.aborted || serial !== requestSerial) throw new DOMException('Cancelled','AbortError');
    return line;
  });
  lineReady.catch(()=>{});
  status('One moment…');
  const turn = candidate.turn = debugPanel?.begin({ kind: candidate.touch ? 'touch' : 'speech', commitAt: candidate.commitAt });
  try {
    if (trace.enabled) trace.emit('react_request', { serial, length: candidate.text?.length ?? 0, touch: candidate.touch?.kind });
    const response = await fetch('/api/react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(candidate.touch ? {touch:candidate.touch} : {text:candidate.text}), localHour:new Date().getHours(), history:sendHistory(candidate.entry), memory:memory.get(), ...(debugPanel?{debug:true}:{}), scene:sceneState(), mood:needs.mood() }), signal: controller.signal });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) throw new Error('selector_http');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (serial !== requestSerial || disposed) return null;
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw new Error('invalid_reply');
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (trace.enabled) trace.emit('react_frame', { serial, frameType: ['emoji','voice','head','line','cue','memory','debug','error'].find(k => Object.hasOwn(reply, k)) ?? 'unknown', keys: Object.keys(reply), ...(Object.hasOwn(reply, 'emoji') ? { emoji: reply.emoji, gaze: reply.gaze, hop: reply.hop } : {}), ...(Object.hasOwn(reply, 'cue') ? { cue: reply.cue } : {}), ...(['none','sound','words'].includes(reply.voice) ? { voice: reply.voice } : {}) });
          // Side-channel frames (contracts 5/6) may arrive anywhere, even after the cue; they never gate the reply.
          if (Object.keys(reply).length === 1 && (Object.hasOwn(reply, 'memory') || Object.hasOwn(reply, 'debug'))) {
            if (Object.hasOwn(reply, 'memory')) memory.set(reply.memory); else turn?.set(reply.debug);
            continue;
          }
          if (reply.error || finished) throw new Error('selector_stream');
          if (emoji === undefined) {
            if (Object.keys(reply).length !== 3 || !(reply.emoji === null || Object.hasOwn(CATALOG, reply.emoji)) || ![null,'viewer','away','down','up','touch'].includes(reply.gaze) || !['none','in_place','toward_viewer','away_from_viewer','left','right'].includes(reply.hop)) throw new Error('invalid_reply');
            emoji = candidate.emoji = reply.emoji; turn?.mark('frame');
            applyMotion(reply,candidate);
            const replyAt = performance.now();
            if (serial !== requestSerial || disposed) return null;
            metrics.selectorMs = replyAt - at; metrics.emojiAt = replyAt;
            listening = false;
            // null leaves only the silent local ACK; no fallback gesture or cached vocal.
            performanceReady = emoji === null ? Promise.resolve(null) : react({ emoji }, { replyAt, commitAt: candidate.commitAt, source: candidate.touch ? 'touch' : 'voice', lineReady, speechEndAt, candidate });
          } else if (voiceMode === undefined) {
            if (Object.keys(reply).some(k=>!['voice','filler'].includes(k)) || ![undefined,'none','thinking','acknowledging','amused','surprised','sympathetic','excited','curious'].includes(reply.filler) || !['none','sound','words'].includes(reply.voice)) throw new Error('invalid_reply');
            voiceMode = candidate.voice = reply.voice;
            if (voiceMode === 'words') thinkingUntil = Infinity;
            if (voiceMode !== 'none' && emoji === null) performanceReady = react({emoji:'SPEAK'}, {replyAt:performance.now(),commitAt:candidate.commitAt,source:'voice',lineReady,speechEndAt,candidate});
            if(voiceMode==='words' && reply.filler && reply.filler!=='none') {
              const fillerTimer=setTimeout(()=>{if(!lineReceived&&!headReceived&&!controller.signal.aborted)void fillerReady.then(()=>{if(lineReceived||headReceived||controller.signal.aborted)return null;return audio.playClip('filler_'+reply.filler,{signal:controller.signal});}).then(result=>{if(result&&trace.enabled)trace.emit('filler_start',{serial,kind:reply.filler,startAt:trace.mapping(result.startAt).at});}).catch(()=>{});},35);
              controller.signal.addEventListener('abort',()=>clearTimeout(fillerTimer),{once:true});
            }
          } else if(!lineReceived && !headReceived && Object.hasOwn(reply,'head')) {
            const head=reply.head;
            if(voiceMode!=='words' || Object.keys(reply).length!==1 || !head || Object.keys(head).length!==2 || typeof head.line!=='string' || !head.line.trim() || head.line.length>600 || /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍︎️⃣]/u.test(head.line) || typeof head.display!=='string' || head.display.length>600 || /[\[\]]/.test(head.display))throw Error('invalid_reply');
            headReceived=true;turn?.mark('head');finishHead(head);
          } else if(!lineReceived) {
            if (Object.keys(reply).length!==3 || !Object.hasOwn(reply,'line') || !Object.hasOwn(reply,'display') || !Number.isFinite(reply.ms) || reply.ms<0 || !(reply.line === null || typeof reply.line === 'string' && reply.line.length <= 600 && !/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍︎️⃣]/u.test(reply.line)) || !(reply.line===null?reply.display===null:typeof reply.display==='string' && reply.display.length<=600 && !/[\[\]]/.test(reply.display)) || voiceMode === 'none' && reply.line !== null || voiceMode === 'sound' && typeof reply.line === 'string' && reply.line.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).length > 4) throw new Error('invalid_reply');
            lineReceived = true;turn?.mark('line');lineValue=reply.line;finishHead?.(null);finishLine({line:reply.line,display:reply.display});
            status(voiceWanted ? 'They are listening. You can interrupt them.' : 'Here is their response.');
          } else {
            if(Object.keys(reply).length!==1 || !Object.hasOwn(reply,'cue') || !validCue(reply.cue,lineValue))throw Error('invalid_reply');
            finished=true;
            if(reply.cue?.timing==='before' && run?.candidate===candidate) {queueCues(run,reply.cue,lineValue,{});pumpCues(performance.now());finishCue(null);}
            else finishCue(reply.cue);
          }
        }
        if (done) break;
      }
      if (!finished || buffer.trim()) throw new Error('invalid_reply');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    clearTimeout(timeout);
    return await performanceReady;
  } catch (error) {
    candidate.failed = true;
    if (serial !== requestSerial || disposed) return null;
    if (controller.signal.aborted && controller.signal.reason !== 'timeout') return null;
    if (candidate.touch) return null; // No invented response to failed touch.
    if (emoji !== undefined) {
      status('Their voice did not come through. Their reaction is still here.');
      return null;
    }
    metrics.selectorMs = performance.now() - at;
    return fallback('Their response did not come through. Try again.');
  } finally {
    finishHead?.(null);finishLine({line:null,display:null});finishCue(null);
    if(candidate.failed && run?.candidate===candidate)run.controller.abort();
    if (serial === requestSerial) { listening = false; if (!run?.pendingAudio) thinkingUntil = 0; }
    clearTimeout(timeout);
    if (request === controller) request = null;
  }
}
function partialCaption(result) {
  if (typeof result.text === 'string' && result.text.length <= 500 && Number.isFinite(result.at)) heard(result.text);
  return onPartial(result);
}
function commitCaption(result) {
  if (typeof result.text === 'string' && result.text.length <= 500 && Number.isFinite(result.at)) heard(result.text, true);
  return onCommit(result);
}
let limitTimer, limitLast, silentMs, limitStarted;
function clearLimits() { clearInterval(limitTimer); limitTimer = null; }
function speechActivity() { silentMs = 0; limitLast = performance.now(); }
function startLimits() {
  clearLimits(); limitLast = limitStarted = performance.now(); silentMs = 0;
  limitTimer = setInterval(() => {
    const now = performance.now();
    if (!audio.speaking()) silentMs += now - limitLast;
    limitLast = now;
    if (now - limitStarted >= 900000) end('Conversation ended after 15 minutes. Tap Talk to start again.');
    else if (silentMs >= 120000) end('Conversation ended after two quiet minutes. Tap Talk to start again.');
  }, 250);
}
const voice = createVoice({ audio,
  onDiagnostic(data) {
    for (const key of ['echoDropped', 'mergedTurnsTrimmed', 'cancelledTurns', 'msBlockedAfterSpeech']) {
      if (Number.isFinite(data[key])) metrics[key] += data[key];
    }
    if (trace.enabled) trace.emit('stt_diagnostic', data);
  },
  onPartial: traced('stt_partial', result => { speechActivity(); return partialCaption(result); }), onCommit: traced('stt_commit', result => { speechActivity(); return commitCaption(result); }),
  onOnset: traced('stt_onset', onLocalOnset),
  onSpeechStart: traced('stt_speech_start', result => { speechActivity(); onSpeechStart(result); }), onSpeechEnd: traced('stt_speech_end', onSpeechEnd), onPause: traced('stt_pause', onPause),
  onSpeechCancel() {
    speechActive = localTurn = false; partialText = ''; partialAt = null;
    cancelReaction(); listening = true;
  },
  onState(state) {
    voiceState = state;
    if (state === 'listening') {
      listening = true;
      status('They are listening. Speak naturally.');
    }
    if (state === 'idle' || state === 'error') {
      clearLimits();
      cancelReaction();
      partialText = ''; partialAt = null;
      localTurn = false; acknowledgement = null;
      listening = speechActive = false; voiceWanted = false;
    }
    showVoiceState();
  },
  onError({ code }) {
    voiceWanted = false;
    const message = code === 'microphone_denied' ? 'Microphone permission denied. Tap Talk to try again.' : 'Could not connect the microphone. Check permission and try again.';
    fallback(message);
  },
});
const fillerReady=audio.loadClips('/assets/fillers/manifest.json').catch(()=>{});
const clipsReady = audio.loadClips('/assets/sfx/manifest.json')
  .catch(() => { status('Local sounds are unavailable. Emotions still work.'); });

function buildPalette() {
  for (const [emoji, entry] of Object.entries(CATALOG)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'emoji';
    button.dataset.emoji = emoji;
    button.textContent = emoji; button.title = entry.name_en;
    button.setAttribute('aria-label', `${emoji} ${entry.name_en}`); button.setAttribute('aria-pressed', 'false');
    emojiButtons.set(emoji, button);
    button.addEventListener('click', () => localReaction({ emoji }));
    $('palette').append(button);
  }
  const palette = $('palette'), fade = () => palette.classList.toggle('at-end', palette.scrollLeft + palette.clientWidth >= palette.scrollWidth - 1);
  palette.addEventListener('scroll', fade, { passive: true });
  // A mouse wheel scrolls the one-row strip sideways; trackpads already send deltaX.
  palette.addEventListener('wheel', event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { palette.scrollLeft += event.deltaY; event.preventDefault(); } }, { passive: false });
  $('emotion-picker').addEventListener('toggle', fade);
}
buildPalette();
$('emotion-picker').addEventListener('toggle', event => $('emotions').setAttribute('aria-expanded', String(event.newState === 'open')));
const dockSize = new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--dock-height', `${entry.target.getBoundingClientRect().height}px`));
dockSize.observe($('controls'));
const viewportResize = () => character?.resize();
window.addEventListener('resize', viewportResize);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  clearTimeout(captionTimer); dockSize.disconnect(); window.removeEventListener('resize', viewportResize);
});
function startCall({ inputReady } = {}) {
  if (disposed || document.hidden) return;
  if (voiceWanted) { if (inputReady) void voice.start({ inputReady }); return; }
  if (healthAnswered && !voiceAvailable) { status('Voice is unavailable. Try their emotions.'); return; }
  const serial = ++callSerial;
  interact(); voiceWanted = true; voiceStartedAt = performance.now(); firstPartialAt = null; startLimits();
  partialText = ''; partialAt = null;
  metrics.partialMs = metrics.commitMs = metrics.lastPartialAt = metrics.commitAt = metrics.emojiAt = metrics.motionAt = metrics.speechEndToMotionMs = null;
  localTurn = false; acknowledgement = null;
  metrics.localSpeechEndAt = metrics.speechEndDetectedAt = metrics.ackMotionAt = metrics.speechEndToAckMs = metrics.speechEndToCommitMs = metrics.speechEndToEmojiMotionMs = null;
  metrics.transcriptFallback = false;
  voice.start({ inputReady }).catch(error => {
    if (serial !== callSerial || error.name === 'AbortError' || voiceState === 'error') return;
    clearLimits(); voiceWanted = false; voiceState = 'error';
    const message = 'Could not start the conversation. Tap Talk to try again.';
    fallback(message);
    showVoiceState();
  });
  showVoiceState();
}
$('talk').addEventListener('click', () => startCall());
function end(message = 'Microphone off. You can keep playing.') {
  ++callSerial;
  voice.stop();
  clearLimits();
  cancelReaction(); partialText = ''; partialAt = null;
  ++reactionSerial; run?.resolve(null); run = null;
  audio.stop(0); voiceWanted = false; listening = speechActive = false;
  status(message); showVoiceState();
}
$('end').addEventListener('click', () => end());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (voiceWanted) end('Conversation ended because the tab was hidden. Tap Talk to start again.'); }
});
function setReduced(value) {
  reducedMotion = value; touch.setReducedMotion(value);
  document.documentElement.dataset.reducedMotion = String(value);
}
setReduced(reducedMotion);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const preferenceChanged = event => setReduced(event.matches);
motionPreference.addEventListener('change', preferenceChanged);
const canvas = $('character');
function keyboardTouch(kind) {
  if (!character || pointer !== null) return;
  cancelArrival(); interact();
  const hit = { region: kind === 'pat' || kind === 'crown' ? 'head' : 'body', point: [0, kind === 'pat' || kind === 'crown' ? .85 : .5, .3], normal: [0, 0, 1] };
  const keyRay = (y, x = 0) => ({ origin: [x, y, 3], dir: [0, 0, -1] });
  touch.pointerDown(hit, t, keyRay(hit.point[1]));
  if (kind === 'lift') {
    pointer = 'keyboard';
    touch.pointerMove(null, keyRay(hit.point[1] + .8), t);
  } else if (kind === 'crown') {
    // A short stroke across the head: the same path a finger takes, so it reads as `pet`, not `pat`.
    for (const [dx, dt] of [[.08, 40], [-.08, 80], [.08, 120]]) touch.pointerMove({ ...hit, point: [dx, hit.point[1], hit.point[2]] }, keyRay(hit.point[1], dx), t + dt);
    touch.pointerUp(t + 160);
  } else touch.pointerUp(t);
}
canvas.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === '+' || event.key === '=' || event.key === '-') { event.preventDefault(); character?.dolly?.(event.key === '-' ? 1.18 : .85); return; }
  const kind = { ' ': 'poke', p: 'pat', c: 'crown', l: 'lift' }[event.key.toLowerCase()];
  if (!kind) return;
  event.preventDefault();
  if (!event.repeat) keyboardTouch(kind);
});
const keyboardRelease = () => { if (pointer === 'keyboard') { touch.pointerUp(t); pointer = null; } };
canvas.addEventListener('keyup', event => { if (event.key.toLowerCase() === 'l') keyboardRelease(); });
canvas.addEventListener('blur', keyboardRelease);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('emotion-picker').matches(':popover-open')) {
    $('emotion-picker').hidePopover(); $('emotions').focus(); event.preventDefault();
  }
});
// Fixed camera: empty-space drag does nothing, dragging Mintie is touch physics, wheel/pinch zoom, the cursor only steers their gaze.
const cameraPointers = new Map(); let pinching = false, pinch = 0, lastTouchTarget = null;
window.addEventListener('pagehide', () => { cameraPointers.clear(); pinching = false; pinch = 0; });
const pinchDistance = () => { const [a,b] = [...cameraPointers.values()]; return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : 0; };
// Normalized viewport coordinates: (0,0) centre, x right, y up, each in [-1,1] (contract 2).
const aim = event => character?.setPointer?.(Math.max(-1, Math.min(1, event.clientX / innerWidth * 2 - 1)), Math.max(-1, Math.min(1, 1 - event.clientY / innerHeight * 2)));
const unaim = () => character?.setPointer?.(null);
window.addEventListener('pointermove', aim, { passive: true });
document.documentElement.addEventListener('pointerleave', unaim); window.addEventListener('blur', unaim);
canvas.addEventListener('pointerdown', event => {
  if (!character || event.button !== 0 || pointer === 'keyboard') return;
  cameraPointers.set(event.pointerId, {x:event.clientX,y:event.clientY}); canvas.setPointerCapture(event.pointerId);
  if (cameraPointers.size > 1) { if (pointer !== null) touch.pointerUp(t); pointer = null; pinching = true; pinch = pinchDistance(); return; }
  const hit = character.pick(event.clientX, event.clientY);
  if (hit) cancelArrival();
  interact();
  touch.pointerHover?.(null,t);
  if (!hit) return;
  pointer = event.pointerId; lastTouchTarget = hit.worldPoint ?? hit.point;
  touch.pointerDown(hit, t, character.ray(event.clientX, event.clientY));
});
canvas.addEventListener('pointermove', event => {
  if (!character) return;
  if(event.pointerType==='mouse' && !event.buttons && pointer===null) {
    const hit=character.pick(event.clientX,event.clientY);
    touch.pointerHover?.(hit,t); canvas.classList.toggle('over', !!hit);
    if(hit)lastTouchTarget=hit.worldPoint??hit.point;
  }
  if (!cameraPointers.has(event.pointerId)) return;
  cameraPointers.set(event.pointerId, {x:event.clientX,y:event.clientY});
  if (cameraPointers.size > 1) { const next = pinchDistance(); if (pinching && pinch > 0 && next > 0) character.dolly?.(pinch/next); pinch = next; return; }
  if (pointer === event.pointerId) touch.pointerMove(character.pick(event.clientX,event.clientY),character.ray(event.clientX,event.clientY),t);
});
canvas.addEventListener('wheel', event => { if (!character) return; event.preventDefault(); character.dolly?.(Math.exp(Math.max(-500,Math.min(500,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1)))*.001)); }, {passive:false});
$('stage').addEventListener('pointerdown', event => {
  if (event.button === 0 && event.target !== canvas) interact();
});
const release = event => {
  cameraPointers.delete(event.pointerId);
  if (event.pointerId === pointer) { touch.pointerUp(t); pointer = null; }
  if (cameraPointers.size < 2) { pinching = false; pinch = 0; }
  if (event.pointerType !== 'mouse') unaim(); // A lifted finger has no cursor to follow.
};
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('pointerleave', () => touch.pointerHover?.(null,t));
const resize = new ResizeObserver(() => character?.resize()); resize.observe($('stage'));
function tick(now) {
  if (disposed) return;
  const tickStart = performance.now();
  const delta = Math.max(0, now - lastFrame); lastFrame = now;
  t += Math.min(delta, 100);
  const dyn = dynamics = touch.step(t);
  for (const event of touch.events()) onTouch(event,now);
  pumpTouch(now);
  const speaking = audio.speaking();
  if (speaking) thinkingUntil = 0;
  pumpCues(now);
  const choice=needs.update(t,{userSpeech:speechActive,mintieSpeech:speaking,held:dyn.state==='held'||dyn.state==='falling',scripted:!!(trace.enabled&&trace.scripted),busy:!!(listening||request||run?.pendingAudio||performer.active()||pointer!==null)});
  if(choice?.kind==='look')performer.look(choice.mode);
  if(choice?.kind==='social'){performer.look('viewer');performer.micro('hum-sway');}
  if(choice?.kind==='micro')performer.micro(choice.micro);
  if(choice?.kind==='hop' && !reducedMotion && touch.hop({to:[dyn.com[0]+.4,dyn.com[2]]}))needs.hopped(t);
  const inputs = { viewer:character.view?.position, self:dyn.com, attend:character.view?.gaze, listening: speechActive || listening, pauseAt, thinking: now < thinkingUntil, talking: speaking, speaking: audio.amplitude(), reducedMotion, needsDrowsy:needs.drowsy() };
  inputs.received=!!received;inputs.thinking=inputs.thinking&&!received;
  const contextNow=audio.atMs(now);
  inputs.suppressBeats=!!run && !run.controller.signal.aborted && run.cues.some(c=>!c.dropped&&beatsSuppressed(contextNow*1000,c.strokeAt*1000));

  const pose = performer.update(t, inputs);
  lastRealizerInputs=inputs;
  if(trace.enabled && performer.suppressedBeats!==tracedSuppressedBeats) {
    trace.emit('beat_suppressed',{count:performer.suppressedBeats-tracedSuppressedBeats});tracedSuppressedBeats=performer.suppressedBeats;
  }
  if (acknowledgement?.local && acknowledgement.motionAt === null && t > pauseAt) {
    acknowledgement.motionAt = metrics.ackMotionAt = performance.now();
    metrics.speechEndToAckMs = metrics.ackMotionAt - acknowledgement.speechEndAt;
  }
  if(dyn.state === 'pet') flinchUntil = 0;
  if(now < flinchUntil) {pose.eyes.openL = Math.min(pose.eyes.openL,.12);pose.eyes.openR = Math.min(pose.eyes.openR,.12);}
  character.update(pose, dyn, t);
  if(received && !received.submitted) {
    received.submitted=true;
    if(trace.enabled) {
      const submittedAt=performance.now();
      trace.emit('received_hold',{speechEndAt:received.speechEndAt,detectedAt:received.detectedAt,speechEndMs:submittedAt-received.speechEndAt,detectedMs:submittedAt-received.detectedAt});
    }
  }
  if (trace.enabled) trace.sample(performance.now(), pose, dyn, inputs);
  if (run && run.motionAt === null && t > performer.active()?.startMs) {
    run.motionAt = performance.now();
    metrics.replyMotionMs = run.motionAt - run.replyAt;
    metrics.commitMotionMs = run.commitAt === null ? null : run.motionAt - run.commitAt;
    if (run.source === 'voice') { metrics.motionAt = run.motionAt; const latency = run.speechEndAt === null ? null : run.motionAt - run.speechEndAt; metrics.speechEndToEmojiMotionMs ??= latency; metrics.speechEndToMotionMs ??= latency; }
    run.resolve(run.motionAt);
  }
  showVoiceState();
  debug.frame.intervalMs = delta;
  debug.frame.jsMs = performance.now() - tickStart;
  debug.frame.count++;
  if (arrivalPending && debug.frame.count > 1) {
    arrivalPending = false;
    if (!performer.active() && !speechActive && pointer === null) { arrivalWave = performer.play('👋'); remember({who:'mintie',emoji:'👋',said:null}); }
  }
  frameId = requestAnimationFrame(tick);
}
const debug = window.__mintie = { performer, metrics, audio, trace, frame: { count: 0, intervalMs: 0, jsMs: 0 }, stats: () => character.stats(), history: () => history.map(entry => ({ ...entry })),
  get adapter() { return character?.adapter; },
  pick: (x, y) => character?.pick(x, y)?.region ?? null,
  get memory() { return memory.get(); },
  view: () => character?.view,
  get interaction() { return { pointer, voiceWanted, voiceState }; },
  get lastRun() { return run ? { ...run, resolve: undefined, candidate: undefined } : null; },
  get clock() { return { t, scale: 1 }; },
  captions: { heard, said },
  simulatePartial(text) { voiceStartedAt ??= performance.now(); partialCaption({ text, at: performance.now() }); },
  simulateCommit(text) { return commitCaption({ text, at: performance.now() }); },
  simulateSpeechStart() { onSpeechStart(); },
  simulatePause() { onPause({ at: performance.now() - 160, detectedAt: performance.now() }); },
  simulateSpeechEnd() { onSpeechEnd({ at: performance.now(), detectedAt: performance.now() }); },
  lastTouch: null,
};
async function health() {
  try {
    const response = await fetch('/api/health'); if (!response.ok) throw new Error();
    const health = await response.json();
    reactAvailable = health.react === true; debugPanel?.setHealth(health);
    voiceAvailable = health.ok === true && health.stt === true && health.react === true && health.say === true;
    if (!voiceWanted) status(voiceAvailable ? 'Tap Talk to chat.' : 'Voice is unavailable. Try their emotions.');
  } catch { if (!voiceWanted) status('Could not reach the server. Try their emotions.'); }
  healthAnswered = true; showVoiceState();
}
function dispose() {
  disposed = true; cancelAnimationFrame(frameId); end(); resize.disconnect();
  motionPreference.removeEventListener('change', preferenceChanged);
  character?.dispose(); audio.close().catch(() => {});
}
function pageHidden(event) {
  if (!event.persisted) { dispose(); return; }
  end(); // bfcache retains the renderer, event handlers and rAF owner for restore.
  touch.pointerUp(t); pointer = null;
  pendingTouch = null;
}
window.addEventListener('pagehide', pageHidden);
try {
  // Construct the output graph during load, not a 140 ms first-touch task. No mic or playback;
  // resume() remains exclusively in explicit interaction handlers.
  // New contexts already obey autoplay restrictions; do not queue an explicit startup suspend.
  void audio.context;
  character = await createCharacter({ canvas });
  character.resize(); lastFrame = performance.now(); frameId = requestAnimationFrame(tick);
  debug.readyAt = performance.now(); debug.ready = true;
  try { if (!localStorage.getItem('mintie-hint')) { hint.hidden = false; hint.dataset.show = 'true'; } } catch {}
  await health();
} catch { status('Could not draw Mintie. Reload to try again.'); voiceState = 'error'; showVoiceState(); }
