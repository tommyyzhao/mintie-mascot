import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { STROKE_MS, STROKE_THRESHOLDS, cuePlan, nodAllowed, beatsSuppressed } from '../web/realizer.js';
import { CATALOG } from '../web/perform/emoji.js';
import { createPerformer } from '../web/perform/engine.js';
import { sampleStroke } from './support/realizer-strokes.mjs';
import { JEV_QUESTIONS, jevRequest, decideJev } from '../server/jev.mjs';

const source=await readFile(new URL('../web/main.js',import.meta.url),'utf8');
const callbacks=source.slice(source.indexOf('function validCue('),source.indexOf('\nconst voice ='));
function client({now=1000,primary='👋'}={}) {
  const events=[],plays=[];
  const context=vm.createContext({cancelArrival(){},CATALOG,STROKE_MS,STROKE_THRESHOLDS,cuePlan,nodAllowed,
    performance:{now:()=>now},audio:{atMs:x=>x/1000,stop(){}},
    trace:{enabled:true,emit:(type,data)=>events.push({type,...data}),mapping:x=>({at:x*1000})},
    performer:{play:(...args)=>{plays.push(args);return {id:1};},predictStroke:()=>390,look(){},cancel(){},active:()=>null},touch:{hop:()=>true},
    AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,
    reactionSerial:1,requestSerial:0,run:null,request:null,disposed:false,metrics:{},listening:false,
    character:{view:{position:[0,1,4]}},dynamics:{com:[0,0,0]},history:[],companionName:'Alex',needs:{event(){},mood:()=>({})},
    status(){},said(){},t:1000});
  vm.runInContext(callbacks,context);
  context.owner={id:1,emoji:primary,replyAt:0,cues:[],pendingAudio:true,controller:new AbortController(),resolve(){}};
  context.run=context.owner;
  return {context,events,plays,setNow:value=>{now=value;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('hover and idle never request /api/react; deliberate contact does',async()=>{
  const f=client();let requests=0;
  Object.assign(f.context,{debug:{},clipsReady:Promise.resolve(),fetch:async()=>{requests++;throw Error('offline');}});
  vm.runInContext("reactAvailable=true;run=null;for(let i=0;i<20;i++){onTouch({kind:'hover',part:'crown'},1000+i*1600);pumpTouch(1000+i*1600);}pumpTouch(60000)",f.context);
  await flush();assert.equal(requests,0);
  vm.runInContext("onTouch({kind:'hold'},61000);pumpTouch(61000)",f.context);
  await flush();assert.equal(requests,1);
  // Idle needs/timers own local motion only; the sole request site is streamReaction.
  assert.equal((source.match(/fetch\('\/api\/react'/g)||[]).length,2);
});
test('client executes repeated and late choices, aligns feasible strokes, gates local nods',async()=>{
  const f=client();
  vm.runInContext("queueCues(owner,{emoji:'👋',at:0},'hello',{startAt:2,charTime:async()=>2.2})",f.context);
  assert.equal(f.context.owner.cues.length,1);f.context.owner.cues=[];
  vm.runInContext("queueCues(owner,{emoji:'❤️',at:0},'hello',{startAt:2,charTime:async()=>2.2})",f.context);await flush();
  assert.equal(f.context.owner.cues[0].strokeAt,2);
  f.setNow(1610);vm.runInContext('pumpCues(performance.now())',f.context);
  assert.equal(f.plays.length,1);assert.equal(f.plays[0][1].reflex,false);assert.equal(f.plays[0][1].elapsedMs,0);
  const late=client({now:2100});
  vm.runInContext("queueCues(owner,{emoji:'❤️',at:0},'hello',{startAt:2,charTime:async()=>2.2})",late.context);await flush();
  vm.runInContext('pumpCues(performance.now())',late.context);assert.equal(late.plays.length,1);
  vm.runInContext('onSpeechStart({at:0});onPause({at:500,detectedAt:750})',f.context);
  assert.equal(f.events.some(e=>e.type==='backchannel_nod'),false);
  vm.runInContext('onPause({at:700,detectedAt:950})',f.context);
  assert.equal(f.events.filter(e=>e.type==='backchannel_nod').length,1);
  vm.runInContext('onSpeechEnd({at:800,detectedAt:1100})',f.context);
  assert.equal(vm.runInContext('received.speechEndAt',f.context),800);
  vm.runInContext('applyMotion({gaze:null,hop:"none"},{})',f.context);
  assert.equal(vm.runInContext('received',f.context),null);
});
test('realizer re-predicts the stroke from the live pose just before start',async()=>{
  const f=client();let stroke=250;vm.runInContext('performer',f.context).predictStroke=()=>stroke;
  vm.runInContext("queueCues(owner,{emoji:'❤️',at:0},'hello',{startAt:2,charTime:async()=>2.2})",f.context);await flush();
  assert.ok(Math.abs(f.context.owner.cues[0].start-1.75)<1e-9);
  stroke=360;f.setNow(1620);vm.runInContext('pumpCues(performance.now())',f.context);
  assert.equal(f.context.owner.cues[0].strokeMs,360);assert.ok(Math.abs(f.context.owner.cues[0].start-1.64)<1e-9);assert.equal(f.plays.length,0);
  f.setNow(1650);vm.runInContext('pumpCues(performance.now())',f.context);assert.equal(f.plays.length,1);
});
test('realizer: EndOfTurn nods once when no pause nod played; late partials keep a running nod',()=>{
  const f=client();
  vm.runInContext('onSpeechStart({at:0});t=5000;onSpeechEnd({at:800,detectedAt:1100})',f.context);
  assert.equal(vm.runInContext('pauseAt',f.context),5000);
  const g=client();
  vm.runInContext('onSpeechStart({at:0});t=5000;onPause({at:900,detectedAt:1150});t=5100;onSpeechEnd({at:900,detectedAt:1300})',g.context);
  assert.equal(vm.runInContext('pauseAt',g.context),5000);
  vm.runInContext('t=5200;cancelReaction()',g.context);assert.equal(vm.runInContext('pauseAt',g.context),5000);
  vm.runInContext('t=5500;cancelReaction()',g.context);assert.equal(vm.runInContext('pauseAt',g.context),-Infinity);
});

test('checked-in stroke table matches measured seeded normalized body/nub peaks',()=>{
  assert.deepEqual(Object.keys(STROKE_MS),Object.keys(CATALOG));
  for(const emoji of ['👋','😋','🎉','😂','🙂‍↕️','🤸'])assert.equal(STROKE_MS[emoji],sampleStroke(emoji),emoji);
});
test('stroke scheduling targets measured peak without a fixed attack gap',()=>{
  const plan=cuePlan({wordAt:2,wordEnd:2.3,now:1,strokeMs:390});
  assert.ok(Math.abs(plan.start-1.61)<1e-9);assert.equal(plan.strokeAt,2);
  assert.equal(cuePlan({wordAt:2,wordEnd:2.3,now:2,strokeMs:390}),null);
  // Asymmetric T3 window: +125 ms late drops; +90 ms late plays.
  assert.equal(cuePlan({wordAt:2,wordEnd:3,now:1.735,strokeMs:390}),null);
  assert.ok(Math.abs(cuePlan({wordAt:2,wordEnd:3,now:1.7,strokeMs:390}).strokeAt-2.09)<1e-9);
  assert.equal(cuePlan({wordAt:2,wordEnd:2.3,now:1.7,strokeMs:390})?.start,1.7);
  assert.ok(cuePlan({wordAt:2,wordEnd:2.3,now:1,strokeMs:390,primaryAt:1.5}));
  assert.equal(cuePlan({wordAt:2,wordEnd:3,now:1,strokeMs:390,primaryAt:1.5}).strokeAt,2);
  assert.equal(cuePlan({wordAt:NaN,now:1,strokeMs:390}),null);
});
test('live dry-run predicts peaks from non-neutral sustained pose; restores engine and PRNG exactly',()=>{
  const channels=p=>[...p.body.lean,p.body.squash,p.body.twist,...p.body.offset,
    Math.max(0,...p.buds.filter(b=>b.side==='L').map(b=>b.reach)),Math.max(0,...p.buds.filter(b=>b.side==='R').map(b=>b.reach))];
  for(const outgoing of ['🙂','🎉']) for(const emoji of ['😋','👋','😂']) {
    const a=createPerformer({seed:1}),b=createPerformer({seed:1});
    for(const p of [a,b])p.play(outgoing,{sustainUntil:()=>true});
    for(let at=0;at<=1600;at+=10) {a.update(at);b.update(at);}
    const predicted=a.predictStroke(emoji,{nowMs:1600,thresholds:STROKE_THRESHOLDS});
    assert.ok(predicted>0,`${outgoing} → ${emoji}: incoming stroke, not outgoing pose`);
    // Dry run must not change current owner, pose, timers, random streams or later updates.
    assert.deepEqual(a.active(),b.active());assert.deepEqual(a.update(1600),b.update(1600));
    const origin=channels(b.update(1600));
    const start=performance.now(),run=b.play(emoji,{nowMs:1600,sustainUntil:()=>true});
    const curve=[];
    for(let age=0;age<=run.durationMs;age+=1000/60)curve.push([age,Math.max(0,...channels(b.update(1600+age)).map((v,i)=>Math.abs(v-origin[i])/STROKE_THRESHOLDS[i]))]);
    // Same stroke definition as predictStroke: first arrival at 90% of the incoming peak.
    const top=Math.max(...curve.map(([,v])=>v)),measured=curve.find(([,v])=>v>=.9*top)[0];
    assert.ok(Math.abs(predicted-measured)<=1000/60,`${outgoing} → ${emoji}: ${predicted} vs ${measured}`);
    assert.ok(performance.now()-start<1000);
    const control=createPerformer({seed:1});control.play(outgoing,{sustainUntil:()=>true});
    for(let at=0;at<=1600;at+=10)control.update(at);
    control.update(1600);
    for(let at=1610;at<=12000;at+=10)assert.deepEqual(a.update(at),control.update(at));
  }
});
test('near no-op incoming gesture still executes their chosen expression',async()=>{
  const p=createPerformer({seed:1});p.play('🙂',{sustainUntil:()=>true});
  for(let at=0;at<=1600;at+=10)p.update(at);
  const f=client({now:1600,primary:'🙂'});
  f.context.performer.predictStroke=emoji=>p.predictStroke(emoji,{nowMs:1600,thresholds:STROKE_THRESHOLDS});
  vm.runInContext("queueCues(owner,{emoji:'😐',at:0},'hello',{startAt:3,charTime:async()=>3.2})",f.context);await flush();
  assert.equal(f.context.owner.cues[0].strokeMs,0);
  f.setNow(3000);vm.runInContext('pumpCues(performance.now())',f.context);
  assert.equal(f.plays.length,1);assert.equal(p.active().emoji,'🙂');
});
test('nod requires 700ms since admitted speech/last nod plus existing 1200ms refractory',()=>{
  const turn={speechAt:100,detectedAt:1100};
  assert.equal(nodAllowed({...turn,at:799}),false);assert.equal(nodAllowed({...turn,at:800}),true);
  assert.equal(nodAllowed({speechAt:0,at:1600,detectedAt:1900,lastNodAt:1000}),false);
  assert.equal(nodAllowed({speechAt:0,at:1800,detectedAt:2100,lastNodAt:1000}),false);
  assert.equal(nodAllowed({speechAt:0,at:1950,detectedAt:2200,lastNodAt:1000}),true);
  assert.equal(nodAllowed({at:1000,detectedAt:1250}),false);
});
test('semantic stroke vetoes beats inside inclusive ±350ms; default engine remains unchanged',()=>{
  for(const at of [650,1000,1350])assert.equal(beatsSuppressed(at,1000),true);
  for(const at of [649,1351])assert.equal(beatsSuppressed(at,1000),false);
  assert.equal(beatsSuppressed(1000,undefined),false);
  const a=createPerformer({seed:9}),b=createPerformer({seed:9}),off=createPerformer({seed:9});
  for(const p of [a,b,off])p.play('👋');
  for(let at=0;at<=900;at+=10) {
    const speaking=at>=600?.6:0;
    const p=a.update(at,{speaking,suppressBeats:beatsSuppressed(at,730)});
    const q=b.update(at,{speaking});const r=off.update(at,{speaking,suppressBeats:false});
    assert.deepEqual(q,r,'absent optional input is byte-identical');
    if(at===730)assert.ok(q.body.lean[1]>p.body.lean[1]+.039);
  }
  assert.equal(a.suppressedBeats,1);assert.equal(b.suppressedBeats,0);
});
test('received input holds breath, perks eyes/flower; no recipe takeover; next move replaces it',()=>{
  const p=createPerformer({seed:1});p.look('viewer');
  const a=p.update(100,{received:true,listening:true});const b=p.update(300,{received:true,listening:true});
  assert.equal(a.body.squash,-.025);assert.equal(b.body.squash,-.025);
  assert.equal(a.eyes.openL,1.08);assert.equal(a.eyes.openR,1.08);assert.ok(a.flower.perk>=.18);
  assert.equal(p.active(),null);p.play('🎉');assert.equal(p.active().emoji,'🎉');
  assert.notEqual(p.update(600).body.squash,-.025);
});
test('Jev chooses hops on impulse while commands and state boundaries remain',async()=>{
  const state={text:'hello'},request=jevRequest(state);
  assert.equal(request.questions,JEV_QUESTIONS);
  assert.match(request.questions.hop.instructions,/on impulse/);
  assert.match(request.questions.hop.instructions,/Explicit commands win/);
  let sent;
  const out=await decideJev(state,{key:'test',fetch:async(_url,opts)=>{
    sent=JSON.parse(opts.body);
    return Response.json({answers:Object.fromEntries(Object.entries({animation:'👋',gaze:'viewer',hop:'none',voice:'none'}).map(([k,choice])=>[k,{type:'choice',choice}]))});
  }});
  assert.equal(sent.questions.hop.instructions,request.questions.hop.instructions);
  assert.equal(out.hop,'none');
});
test('plateau gestures (✨ holds ~1 s) predict the arrival, not an arbitrary hold frame',()=>{
  const p=createPerformer({seed:1});for(let at=0;at<=1000;at+=10)p.update(at);
  const stroke=p.predictStroke('✨',{nowMs:1000,thresholds:STROKE_THRESHOLDS});
  assert.ok(stroke>=150 && stroke<=450,String(stroke));
});

test('before and after choices run without word alignment; newer choice logs pending cancellation',async()=>{
  const f=client();
  vm.runInContext("queueCues(owner,{emoji:'👋',at:0,timing:'before'},'hi',{});queueCues(owner,{emoji:'❤️',at:0,timing:'after'},'hi',{});pumpCues(performance.now())",f.context);
  assert.equal(f.plays.length,1);assert.equal(f.plays[0][0],'👋');
  vm.runInContext("owner.cues[1].start=1;pumpCues(performance.now())",f.context);
  assert.equal(f.plays.length,2);assert.equal(f.plays[1][0],'❤️');
  vm.runInContext("queueCues(owner,{emoji:'❤️',at:0,timing:'after'},'hi',{});cancelReaction()",f.context);
  assert.ok(f.events.some(e=>e.type==='cue_dropped'&&e.reason==='newer_choice'));
});
test('listener pauses are bounded, stale replies cancelled, no own-speech calls',async()=>{
  const f=client();let requests=0,release;
  f.context.audio.speaking=()=>false;
  f.context.fetch=async()=>{requests++;return new Promise(r=>release=r);};
  vm.runInContext("reactAvailable=true;run=null;speechActive=true;partialText='one two three';listenReaction(4000);listenReaction(5000)",f.context);
  assert.equal(requests,1);
  vm.runInContext("partialText='one two three four'",f.context);release(Response.json({emoji:'👋'}));await flush();assert.equal(f.plays.length,0);
  f.context.audio.speaking=()=>true;
  vm.runInContext("partialText='one two three four five six seven';listenReaction(8000)",f.context);assert.equal(requests,1);
});
