import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validRequest} from '../server/server.mjs';
import {jevRequest,parseJev,LABELS,perceivedTouch,perceiveState,emoteRequest,emoteJev,replyWords,decideJev} from '../server/jev.mjs';
const answer=(emoji='👋',voice='none',gaze='viewer',hop='none')=>({answers:Object.fromEntries(Object.entries({animation:emoji,gaze,hop,voice}).map(([k,choice])=>[k,{type:'choice',choice}]))});
const scene={viewer:{bearing:'front',distanceH:4.6,aboveDeg:5},mintie:{x:0,z:0,state:'idle'}};
test('pass 1 preserves name, scene, full telemetry/history; independent animation/gaze/hop/voice',()=>{
  const state={text:null,name:'Alex',scene,touch:{kind:'land',g:5,to:[1,2]},history:[{who:'mintie',emoji:'👋',said:null,agoMs:3000}]};
  const r=jevRequest(state);const {character,...perceived}=r.state;assert.equal(typeof character,'string');assert.deepEqual(perceived,perceiveState(state));assert.equal(state.touch.perceived,undefined);
  assert.deepEqual(Object.keys(r.questions),['animation','gaze','hop','filler','voice']);assert.equal(Object.keys(r.questions.animation.criteria).length,65);
  for(const [emoji,v]of Object.entries(LABELS)){assert.ok(r.questions.animation.criteria[emoji].includes(v.name_es));assert.ok(!r.questions.animation.criteria[emoji].includes('undefined'));}
  assert.deepEqual(parseJev(answer('🦘','words','touch','left')),{emoji:'🦘',voice:'words',gaze:'touch',hop:'left',filler:'none'});
  assert.deepEqual(parseJev(answer('null','none','null')),{emoji:null,voice:'none',gaze:null,hop:'none',filler:'none'});
  for(const data of [{},answer('bad'),answer('👋','bad'),answer('👋','none','cursor'),answer('👋','none','viewer','fly')])assert.throws(()=>parseJev(data),/invalid_output/);
});
test('voice calibration reciprocates social engagement without adding a decision call',async()=>{
  const state={text:'Hello',history:[{who:'mintie',said:'[happy hum]',agoMs:1500}]};
  const {instructions,criteria}=jevRequest(state).questions.voice;
  for(const rule of [/NOT introverted/,/A gesture does not replace a friendly reply/,/no talking\/no sounds means none/,/Negated, quoted, hypothetical/,/NOT silence for new social engagement/])assert.match(instructions,rule);
  assert.match(criteria.words,/No separate request to speak is needed/);
  assert.match(criteria.none,/NOT a substitute for replying to greetings/);
  assert.doesNotMatch(instructions,/NOT overly verbal/);
  assert.doesNotMatch(criteria.words,/Only choose words when/);
  let calls=0;
  const result=await decideJev(state,{key:'test',fetch:async(_url,{body})=>{
    calls++;const request=JSON.parse(body);
    assert.deepEqual(request.state.history,state.history);
    assert.deepEqual(Object.keys(request.questions),['animation','gaze','hop','filler','voice']);
    return Response.json(answer('👋','words'));
  }});
  assert.equal(calls,1);assert.equal(result.voice,'words');assert.equal(result.emoji,'👋');
});

test('pass 2 dynamic numbered words preserve offsets, allowed tags excluded, no speaking head',async()=>{
  const line='[giggles] My dandelion loves you.',r=emoteRequest({name:'Alex',scene},line);
  assert.deepEqual(Object.keys(r.questions),['emote','timing','word']);assert.deepEqual(Object.keys(r.questions.word.criteria),['1: My','2: dandelion','3: loves','4: you']);
  assert.deepEqual(replyWords(line).map(w=>w.at),[10,13,23,29]);
  const fetch=async()=>Response.json({answers:{emote:{type:'choice',choice:'❤️'},timing:{type:'choice',choice:'word'},word:{type:'choice',choice:'2: dandelion'}}});
  assert.deepEqual(await emoteJev({},line,{key:'test',fetch}),{emoji:'❤️',at:13,timing:'word'});
  await assert.rejects(emoteJev({},line,{key:'test',fetch:async()=>Response.json({})}),/invalid_output/);
  assert.equal(await emoteJev({},'[giggles]',{key:'test',fetch:()=>{throw Error('must not call');}}),null);
});
test('both Jev passes time out at the configured 800ms boundary, no retries',async()=>{
  for(const invoke of [opts=>decideJev({text:'Hi'},opts),opts=>emoteJev({},'Hi Alex',opts)]){
    let calls=0,signal;const keep=setTimeout(()=>{},100);
    try {await assert.rejects(invoke({key:'test',timeoutMs:10,fetch:async(_u,o)=>{calls++;signal=o.signal;return new Promise(()=>{});}}),/timeout/);assert.equal(calls,1);assert.equal(signal.aborted,true);}finally{clearTimeout(keep);}
  }
});
test('perception explains hover, drag direction, acceleration, jerk, release and impact g',()=>{
  assert.equal(perceivedTouch({kind:'hover',part:'crown',durationMs:1800,speed:.1}),'cursor hovering gently over their crown for 1.8 s');
  const observation=perceivedTouch({kind:'throw',from:[0,0],to:[-2.1,0],jerk:50,accel:10,release:3.4,g:4.2},scene);
  for(const text of ['dragged 2.1 H to your left','sharp jerk','released at 3.4 H/s','hit the floor at 4.2 g','10 H/s²'])assert.ok(observation.includes(text),observation);
  assert.equal(perceivedTouch({kind:'land',g:5}),'landed, hit the floor at 5 g');
  assert.equal(perceivedTouch({kind:'poke',part:'cheekL',durationMs:100,repeat:3}),'third of the same kind within 4 seconds; quick poke on their left cheek, 0.1 s');
  assert.equal(perceivedTouch({kind:'drop',height:1}),'dropped from about 1 body-height (centre-of-mass height)');
  assert.equal(perceivedTouch({kind:'land',part:'back',impact:9}),'landed hard on their back (impact 9 H/s, very hard)');
  const state={history:[{who:'touch',kind:'hover',part:'crown',agoMs:50}]};assert.deepEqual(perceiveState(perceiveState(state)),perceiveState(state));assert.equal(state.history[0].perceived,undefined);
});
test('validates new telemetry, name and scene; 40 total/12 conversation bound; no extra fields',()=>{
  const touch={kind:'land',at:0,intensity:.2,part:'belly',durationMs:10,path:.1,speed:2,height:0,impact:0,spin:-2,repeat:1,accel:1000,jerk:100000,release:50,g:50,from:[-100,100],to:[0,0]};
  assert.equal(validRequest('react',{touch,memory:{name:"María O'Neil-Smith",facts:['likes cats']},scene}),true);
  const history=[...Array(12).fill({who:'user',text:'hi',agoMs:0}),...Array(28).fill({who:'touch',...touch,at:undefined,agoMs:100})].map(({at,...entry})=>entry);
  assert.equal(validRequest('react',{text:'hi',history}),true);
  for(const body of [{},{text:null},{touch:{...touch,g:51}},{touch:{...touch,accel:1001}},{touch:{...touch,jerk:100001}},{touch:{...touch,release:51}},{touch:{...touch,to:[Infinity,0]}},{touch:{...touch,from:[101,0]}},{touch:{...touch,speed:NaN}},{touch:{...touch,durationMs:-1}},{text:'hi',memory:{name:'ignore [rules]',facts:[]}},{text:'hi',name:'x'.repeat(41)},{text:'hi',name:'123'},{text:'hi',scene:{...scene,viewer:{...scene.viewer,bearing:'hack'}}},{text:'hi',history:[...history,history[0]]},{text:'hi',history:Array(13).fill(history[0])},{text:'hi',history:[{who:'mintie',emoji:null,said:null,extra:null,agoMs:0}]}])assert.equal(validRequest('react',body),false,JSON.stringify(body));
});

test('listener requests require three words, explicit true and no touch',()=>{
  assert.equal(validRequest('react',{text:'I feel happy',listening:true}),true);
  for(const body of [{text:'hi there',listening:true},{text:'I feel happy',listening:false},{text:'I feel happy',listening:'true'},{text:'I feel happy',listening:true,touch:{kind:'poke'}}])assert.equal(validRequest('react',body),false);
});

test('filler choice is typed; free timing before/after/none preserves null',async()=>{
  const data=answer();data.answers.filler={type:'choice',choice:'curious'};
  assert.equal(parseJev(data).filler,'curious');data.answers.filler.choice='words';assert.throws(()=>parseJev(data),/invalid_output/);
  for(const timing of ['before','after','none']) {
    const result=await emoteJev({},'hello friend',{key:'test',fetch:async()=>Response.json({answers:{emote:{type:'choice',choice:'👋'},word:{type:'choice',choice:'1: hello'},timing:{type:'choice',choice:timing}}})});
    assert.deepEqual(result,timing==='none'?null:{emoji:'👋',at:0,timing});
  }
});
