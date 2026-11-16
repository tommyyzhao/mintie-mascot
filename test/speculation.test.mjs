import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { speakCascade } from '../web/stream.js';
import { STROKE_THRESHOLDS, cuePlan, nodAllowed } from '../web/realizer.js';
import { createPerformer } from '../web/perform/engine.js';
import { CATALOG } from '../web/perform/emoji.js';

const source = await readFile(new URL('../web/main.js', import.meta.url), 'utf8');
const callbacks = source.slice(source.indexOf('function validCue('), source.indexOf('\nconst voice ='));
const reaction = source.slice(source.indexOf('async function react('), source.indexOf('\nfunction localReaction'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let clock = 0, nextTimer = 0;
  const timers = new Map(), requests = [], sounds = [], motions = [];
  const audio = { stop() {}, atMs: x => x,
    playClip: async (kind, { when }) => { sounds.push({ kind, when, at: clock }); return { startAt: typeof when==='function'?when():when, done: Promise.resolve() }; },
    say: async (text, { when }) => { sounds.push({ text, when, at: clock }); return { startAt: typeof when==='function'?when():when, done: Promise.resolve() }; },
  };
  const context = vm.createContext({ cancelArrival(){}, CATALOG, audio, speakCascade, STROKE_THRESHOLDS, cuePlan, nodAllowed, needs:{event(){},mood:()=>({})}, trace: { enabled: false }, t: 0, companionName:'Alex',character:{view:{position:[0,1,4.6]}},dynamics:{com:[0,0,0],state:'idle'},lastTouchTarget:[0,.8,0],touch:{},
    performance: { now: () => clock }, AbortController, DOMException, TextDecoder, Promise,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id), clipsReady: Promise.resolve(), metrics: {}, disposed: false,
    reactionSerial: 0, requestSerial: 0, run: null, request: null, listening: false,
    voiceStartedAt: 0, voiceWanted: true, firstPartialAt: null, history: [],
    performer: { look(){}, predictStroke:()=>390, play: (recipe, options) => { motions.push({ at: clock, recipe, options }); return { id: motions.length, anticipationMs: 180 }; }, cancel() {}, active() { return null; } },
    announce() {}, said() {}, status() {}, audioError() {}, fallback() { throw Error('unexpected fallback'); },
    fetch: async (_url, options) => {
      const req = { ...JSON.parse(options.body), signal: options.signal };
      requests.push(req);
      return new Response(new ReadableStream({ start(controller) {
        req.send = value => {
          if (Object.hasOwn(value,'emoji') && !Object.hasOwn(value,'line')) {
            const speak=value.emoji==='SPEAK';
            controller.enqueue(new TextEncoder().encode(JSON.stringify({emoji:speak?null:value.emoji,gaze:value.gaze??null,hop:value.hop??'none'})+'\n'+JSON.stringify({voice:speak?'words':'none'})+'\n'));return;
          }
          if(Object.hasOwn(value,'line')) {const {emoji,...rest}=value;value={...rest,display:value.display??value.line?.replace(/\[[^\]]*\]/g,'').trim()??null};}
          controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + '\n'));
        };
        req.sendSpeech = speak => controller.enqueue(new TextEncoder().encode(JSON.stringify({voice:speak?'words':'none'})+'\n'));
        req.sendAnimation = emoji => controller.enqueue(new TextEncoder().encode(JSON.stringify({emoji,gaze:null,hop:'none'})+'\n'));
        req.close = () => {controller.enqueue(new TextEncoder().encode('{"cue":null}\n'));controller.close();};
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Cancelled', 'AbortError')), { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } });
    },
  });
  vm.runInContext(reaction + '\n' + callbacks, context);
  return { context, requests, sounds, motions,
    partial(text) { context.input = text; vm.runInContext('onPartial({text:input,at:performance.now()})', context); },
    commit(text) { context.input = text; return vm.runInContext('onCommit({text:input,at:performance.now()})', context); },
    async advance(ms) {
      const end = clock + ms;
      while (true) {
        const due = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        clock = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
      }
      clock = end; await flush();
    },
    motion() { context.run.motionAt = clock; context.run.resolve(clock); },
    async reply(index = requests.length - 1, line = null) { const emoji = line ? 'SPEAK' : '👋'; requests[index].send({ emoji }); await flush(); this.motion(); requests[index].send({ line, ...(line ? {emoji:null} : {}), ms: 20 }); requests[index].close(); await flush(); },
  };
}

test('stream onset metrics use the scheduling conversion despite clock drift',async()=>{
  const f=fixture();let conversions=0;
  f.context.audio.atMs=value=>value+(++conversions)*5;
  const pending=f.commit('hola amiga');await flush();await f.reply(0,'Hola amiga.');await pending;
  assert.ok(conversions>1);
  assert.equal(f.context.run.audioAt,f.context.run.audioTarget);
});

test('touch queue is one in flight, newest pending, expires1.5s; voice wins; contact flinches only',async()=>{
  const f=fixture();vm.runInContext("reactAvailable=true;this.debug={};this.clipsReady=Promise.resolve();",f.context);
  vm.runInContext("onTouch({kind:'contact',at:0,part:'eyeL'},0);pumpTouch(0)",f.context);
  assert.equal(f.requests.length,0);assert.equal(f.motions.length,0);
  assert.equal(vm.runInContext('flinchUntil',f.context),160);
  vm.runInContext("onTouch({kind:'hold',at:0,part:'belly'},0);pumpTouch(0)",f.context);await flush();assert.equal(f.requests.length,1);
  vm.runInContext("onTouch({kind:'pet',at:1},1);onTouch({kind:'shake',at:2},2);pumpTouch(2)",f.context);assert.equal(f.requests.length,1);
  f.requests[0].send({emoji:null});f.requests[0].send({line:null,ms:10});f.requests[0].close();await flush();
  vm.runInContext('pumpTouch(10)',f.context);await flush();assert.equal(f.requests.length,2);
  vm.runInContext('onSpeechStart()',f.context);assert.equal(f.requests[1].signal.aborted,true);
  vm.runInContext("onTouch({kind:'pet',at:20},20);pumpTouch(20)",f.context);assert.equal(f.requests.length,2);
  vm.runInContext('speechActive=false;pendingTouch.at=0;pumpTouch(1600)',f.context);assert.equal(f.requests.length,2);
  assert.equal(vm.runInContext('pendingTouch',f.context),null);
  const entries=vm.runInContext('sendHistory()',f.context);assert.ok(entries.every(x=>Number.isFinite(x.agoMs)&&!Object.hasOwn(x,'at')));
});

test('history keeps recent 10-second touches in addition to 12 conversational entries, bounded at 40',async()=>{
  const f=fixture();vm.runInContext("for(let i=0;i<20;i++)remember({who:'user',text:String(i)});for(let i=0;i<25;i++)remember({who:'touch',kind:'hover',g:5,to:[1,2]});",f.context);
  const entries=vm.runInContext('sendHistory()',f.context);assert.equal(entries.length,37);assert.equal(entries.filter(x=>x.who==='user').length,12);assert.equal(entries.filter(x=>x.who==='touch').length,25);
  await f.advance(10001);assert.equal(vm.runInContext('sendHistory().length',f.context),12);
});
test('scene and motion use camera-relative positions, optional APIs, no cursor gaze',()=>{
  const f=fixture(),looks=[],hops=[];
  f.context.performer.look=(...args)=>looks.push(args);f.context.touch.hop=arg=>{hops.push(arg);return true;};
  vm.runInContext("this.candidate={};applyMotion({gaze:'viewer',hop:'left'},candidate)",f.context);
  assert.deepEqual([...hops[0].to],[-.8,0]);assert.equal(looks[0][0],'viewer');assert.equal(f.context.candidate.hopApplied,true);
  vm.runInContext("character.view.position=[4,1,0];applyMotion({gaze:'touch',hop:'toward_viewer'},candidate)",f.context);
  assert.deepEqual([...hops[1].to],[.8,0]);assert.equal(vm.runInContext('sceneState().viewer.bearing',f.context),'right');
  delete f.context.touch.hop;delete f.context.performer.look;
  assert.doesNotThrow(()=>vm.runInContext("applyMotion({gaze:null,hop:'in_place'},candidate)",f.context));
  assert.ok(!source.includes('gaze = ['));assert.match(source,/viewer:character.view\?\.position, self:dyn.com/);
});
test('touch said records scheduled audio through preemption, reaches next history',async()=>{
  const f=fixture();vm.runInContext("reactAvailable=true;this.debug={};",f.context);

  vm.runInContext("onTouch({kind:'hold',part:'belly'},0);pumpTouch(0)",f.context);await flush();
  f.requests[0].sendAnimation('👋');f.requests[0].sendSpeech(true);await flush();f.motion();
  f.requests[0].send({line:'wiii',ms:10});f.requests[0].close();await flush();vm.runInContext('cancelReaction()',f.context);
  assert.equal(f.context.history.find(x=>x.who==='mintie').said,'wiii');
  vm.runInContext("onTouch({kind:'hold',part:'belly'},1);pumpTouch(1)",f.context);await flush();
  assert.ok(f.requests[1].history.some(x=>x.who==='mintie'&&x.said==='wiii'&&x.agoMs>=0));
  vm.runInContext('cancelReaction()',f.context);
});

test('250ms pause ACK is additive and silent, never commits or cancels an in-flight request',async()=>{
  const f=fixture();vm.runInContext('onSpeechStart({at:0});t=10;onPause({at:700,detectedAt:960})',f.context);
  assert.equal(f.requests.length,0);assert.equal(f.motions.length,0);assert.equal(f.sounds.length,0);
  assert.equal(vm.runInContext('pauseAt',f.context),10);
  vm.runInContext('onSpeechEnd({at:0,detectedAt:600})',f.context);
  const final=f.commit('hola Mintie');await flush();const request=f.requests[0];
  vm.runInContext('speechActive=true;t=200;onPause({at:1000,detectedAt:1500})',f.context);
  assert.equal(request.signal.aborted,false);assert.equal(f.requests.length,1);
  await f.reply();await final;assert.equal(f.motions.at(-1).recipe,'👋');assert.equal(f.sounds.length,0);
});

test('committed phrase reacts immediately without guard; continuation cancels stale audio and newest wins', async () => {
  const f = fixture();
  vm.runInContext('onSpeechEnd({at:0,detectedAt:260}); void onCommit({text:"hola",at:0})', f.context);
  await flush(); f.requests[0].send({emoji:'👋'}); await flush();
  assert.equal(f.motions.length,1,'pause ACK is not a catalog takeover'); f.motion();
  await f.advance(100); vm.runInContext('onSpeechStart()',f.context);
  assert.equal(f.requests[0].signal.aborted,true); assert.equal(f.sounds.length,0);
  vm.runInContext('onSpeechEnd({at:600,detectedAt:860}); void onCommit({text:"hola amiga",at:600})',f.context);
  await flush(); assert.equal(f.requests[1].text,'hola amiga');
  f.requests[1].send({emoji:'👋'}); await flush(); assert.equal(f.motions.length,2); f.motion();
  f.requests[1].send({line:null,ms:20}); f.requests[1].close(); await flush(); assert.equal(f.sounds.length,0);
});

test('null keeps ACK only; SPEAK starts preparatory motion before prose', async () => {
  for (const emoji of [null,'SPEAK']) {
    const f=fixture(); vm.runInContext('onSpeechEnd({at:0,detectedAt:260})',f.context);
    const pending=f.commit('test'); await flush(); f.requests[0].send({emoji}); await flush();
    assert.equal(f.motions.length,emoji===null?0:1);
    if(emoji==='SPEAK') { assert.doesNotThrow(()=>createPerformer().play(f.motions[0].recipe,{reflex:true})); assert.equal(f.motions[0].recipe.body,'perk'); assert.equal(f.motions[0].recipe.mouth,'tinyO'); f.motion(); }
    assert.equal(f.sounds.length,0);
    f.requests[0].send(emoji===null?{line:null,ms:20}:{line:'Aquí estoy contigo.',emoji:null,ms:20}); f.requests[0].close(); await pending;
    assert.equal(f.sounds.length,emoji===null?0:1);
    if(emoji==='SPEAK') assert.equal(f.sounds[0].text,'Aquí estoy contigo.');
  }
});

test('wave plus speech starts motion before words',async()=>{
  const f=fixture(),pending=f.commit('Hola Safi, ¿cómo estás?');await flush();
  f.requests[0].sendAnimation('👋');await flush();f.motion();
  f.requests[0].sendSpeech(true);
  f.requests[0].send({line:'Muy bien, contigo.',ms:20});f.requests[0].close();await pending;
  assert.equal(f.motions[0].recipe,'👋');assert.equal(f.sounds.length,1);assert.equal(f.sounds[0].text,'Muy bien, contigo.');
});
test('decision stream error after wave stays silent',async()=>{
  const f=fixture(),pending=f.commit('hola');await flush();f.requests[0].sendAnimation('👋');await flush();f.motion();
  f.requests[0].send({error:{stage:'react',code:'network'}});f.requests[0].close();await pending;await flush();
  assert.equal(f.sounds.length,0);assert.equal(f.motions.length,1);
});
test('local speech onset cancels selector; partials wait for Flux end', async () => {
  const f = fixture(); void f.commit('turno viejo'); await flush();
  vm.runInContext('onSpeechStart()', f.context); assert.equal(f.requests[0].signal.aborted, true);
  f.partial('nueva frase'); await f.advance(2000); assert.equal(f.requests.length, 1);
});

test('partials never request a reaction before committed Flux end',async()=>{
  const f=fixture();f.partial('hola amiga');await f.advance(5000);
  assert.equal(f.requests.length,0);assert.equal(f.sounds.length,0);
  const pending=f.commit('hola amiga');await flush();assert.equal(f.requests.length,1);
  await f.reply();await pending;
});

test('commit without partial aborts old reaction without audio', async () => {
  const f = fixture();
  const old = f.commit('hola amiga'); await flush();
  f.requests[0].send({ emoji: '👋' }); await flush(); f.motion(); await flush();
  const next = f.commit('saluda con la mano'); await flush();
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.sounds.length, 0);
  await f.reply(); await Promise.all([old, next]);
  assert.equal(f.sounds.length, 0);
});

test('local palette stays silent and cancels stale selector', async () => {
  const f=fixture(), old=f.commit('hola amiga'); await flush();
  const local=vm.runInContext('react({emoji:"👋"},{source:"local"})',f.context); await flush();
  assert.equal(f.requests[0].signal.aborted,true);f.motion();await Promise.all([old,local]);assert.equal(f.sounds.length,0);
});

test('oversize partial cancels the current request without sending unbounded text',async()=>{
  const f=fixture();void f.commit('hola amiga');await flush();
  f.partial('palabra '.repeat(80));assert.equal(f.requests[0].signal.aborted,true);
  await f.advance(2000);assert.equal(f.requests.length,1);assert.equal(f.sounds.length,0);
});

test('TTS starts from line before cue frame; captions preserve emoji; cue validation uses word offsets',async()=>{
  const f=fixture(),pending=f.commit('hola');await flush();f.requests[0].sendAnimation('👋');await flush();f.motion();
  f.requests[0].sendSpeech(true);await flush();assert.equal(vm.runInContext('thinkingUntil',f.context),Infinity);
  f.requests[0].send({line:'Hola amiga',display:'Hola amiga 🥹',ms:10});await flush();assert.equal(f.sounds.length,1);
  f.requests[0].close();await pending;
  assert.equal(vm.runInContext("validCue({emoji:'👍',at:5},'Hola amiga')",f.context),true);
  assert.equal(vm.runInContext("validCue({emoji:'👍',at:6},'Hola amiga')",f.context),false);
  assert.equal(vm.runInContext("validCue({emoji:'bad',at:0},'Hola amiga')",f.context),false);
});
test('persisted pagehide ends voice and releases touch, retains renderer; final navigation disposes', () => {
  const lifecycle = source.slice(source.indexOf('function pageHidden('), source.indexOf('\ntry {', source.indexOf('function pageHidden(')));
  let ends = 0, disposals = 0, releases = 0, handler;
  const context = vm.createContext({ end() { ends++; }, dispose() { disposals++; }, touch: { pointerUp() { releases++; } },
    t: 100, pointer: 7, greeting: { queued: {} }, window: { addEventListener(name, callback) { assert.equal(name, 'pagehide'); handler = callback; } },
  });
  vm.runInContext(lifecycle, context);
  handler({ persisted: true });
  assert.equal(ends, 1); assert.equal(disposals, 0); assert.equal(releases, 1);
  assert.equal(context.pointer, null);
  handler({ persisted: true }); assert.equal(ends, 2); assert.equal(disposals, 0);
  handler({ persisted: false }); assert.equal(disposals, 1);
});

test('25-word replies and tag-only sounds reach client audio without clipping',async()=>{
  for(const [voice,line] of [['words',Array(25).fill('word').join(' ')],['sound','[giggles]']]) {
    const f=fixture(),pending=f.commit('hello');await flush();f.requests[0].sendAnimation('👋');await flush();f.motion();
    f.requests[0].send({voice});f.requests[0].send({line,ms:10});f.requests[0].close();await pending;
    assert.equal(f.sounds[0].text,line);
  }
});
