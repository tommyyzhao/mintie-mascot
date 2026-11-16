import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createApp, streamHead, proseResult, validRequest, generateLine } from '../server/server.mjs';
import { speakCascade } from '../web/stream.js';
import { CATALOG } from '../web/perform/emoji.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const delta = content => `data: ${JSON.stringify({choices:[{delta:{content},finish_reason:null}]})}\n\n`;
const end = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const sse = text => new Response(delta(text) + end);
const headText = '[giggles] Three little birds.';
const fullText = headText + ' They found a sunflower. 🌻';
const choice = value => ({ type:'choice', choice:value });

// No socket/provider calls: exercise the complete route with in-memory HTTP streams.
function route(fetchImpl) {
  const logs = [], frames = [], headers = {}, res = new EventEmitter();
  Object.assign(res, { destroyed:false, headersSent:false, writableFinished:false,
    setHeader(k,v) { headers[k]=v; }, getHeader:k=>headers[k],
    writeHead(status,values) { res.statusCode=status;Object.assign(headers,values);res.headersSent=true; },
    write(raw) { if(typeof raw==='string')frames.push(JSON.parse(raw));return true; },
    end(raw) { if(raw)frames.push(JSON.parse(raw));res.writableFinished=true; },
  });
  const app = createApp({catalog:CATALOG,keys:{OPENROUTER_API_KEY:'router-secret',TYPESAFE_API_KEY:'jev-secret',ELEVENLABS_API_KEY:'tts-secret'},s2HedgeMs:0,log:x=>logs.push(x),fetch:fetchImpl});
  return { frames,logs,res, async request(body,path='/api/react') {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method:'POST',url:path,socket:{localPort:8135},headers:{host:'127.0.0.1:8135',origin:'http://127.0.0.1:8135','content-type':'application/json'}});
    await app(req,res);return frames;
  } };
}
function provider(words, { voice='words', jevGate, retry }={}) {
  let attempts=0;
  return async (url,options) => {
    const body=JSON.parse(options.body);
    if(url.includes('typesafe')) {
      if(body.questions.emote)return Response.json({answers:{emote:choice('null'),word:choice(Object.keys(body.questions.word.criteria)[0])}});
      if(jevGate)await jevGate;
      return Response.json({answers:{animation:choice('👋'),gaze:choice('viewer'),hop:choice('none'),voice:choice(voice)}});
    }
    if(body.max_tokens===24)return sse('[giggles]');
    return ++attempts>1 && retry ? sse(retry) : typeof words==='function' ? words() : sse(words);
  };
}

test('stream head detects first complete ≥3-word sentence, strips emojis, preserves audio tags/display', () => {
  for(const punctuation of ['.','!','?','…']) {
    const raw=`[happy hum] Three little birds${punctuation} 🐥 They sing.`;
    const head=streamHead(raw);
    assert.deepEqual(head,{line:`[happy hum] Three little birds${punctuation}`,display:`Three little birds${punctuation}`});
    assert.ok(proseResult(raw,{voice:'words'}).line.startsWith(head.line));
  }
  for(const raw of ['Just two.','Three little birds.','Three little birds. 🌻','Three little birds. [giggles]','Hi! Three little birds.','Two words. Then more.'])assert.equal(streamHead(raw),null,raw);
  for(const raw of ['Three little birds https://bad.test. Next sentence.','Three little birds router-secret. More words.'])assert.equal(streamHead(raw,[],['router-secret']),null);
  // Invented stage directions are dropped (2f424d1), never spoken; the head stays a prefix of the final line.
  assert.deepEqual(streamHead('Three little birds [unknown]. More words.'),{line:'Three little birds.',display:'Three little birds.'});
  assert.equal(streamHead('Three little birds. Next word.',[{who:'mintie',said:'Three little birds.'}]),null);
});

test('stream clause waits until ~120 characters and a following word; brackets/decimals never split', () => {
  const phrase='These tiny birds gathered every yellow petal they could find beside the winding river to build their magnificent sunflower palace';
  for(const punctuation of [',',';',':']) {
    const head=streamHead(`${phrase}${punctuation} then celebrated. They sang.`);
    assert.equal(head.line,phrase+punctuation);
  }
  assert.equal(streamHead(`${phrase}, then celebrated.`),null);
  assert.equal(streamHead('Three little birds, then they sing.'),null);
  assert.equal(streamHead('There were 3.14 tiny birds'),null);
  assert.equal(streamHead('[unknown. bracket] Three little birds. More words.').line,'Three little birds.');
});

test('head flushes after words decision, before complete prose; one sentence unsplit', async () => {
  let push;
  const f=route(provider(()=>new Response(new ReadableStream({start(c){push=c; c.enqueue(new TextEncoder().encode(delta(fullText.slice(0,-12))));}}))));
  const pending=f.request({text:'Tell a story'});
  await flush();
  assert.deepEqual(f.frames.map(x=>Object.keys(x)[0]),['emoji','voice','head']);
  assert.equal(f.frames[2].head.line,headText);
  push.enqueue(new TextEncoder().encode(delta(fullText.slice(-12))+end));push.close();await pending;
  assert.deepEqual(f.frames.map(x=>Object.keys(x)[0]),['emoji','voice','head','line','cue']);
  assert.ok(f.frames[3].line.startsWith(f.frames[2].head.line));
  assert.equal(f.frames[3].line,proseResult(fullText,{voice:'words'}).line);
  for(const text of ['Three little birds.']) {
    const g=route(provider(text));await g.request({text:'Tell a story',});
    assert.deepEqual(g.frames.map(x=>Object.keys(x)[0]),['emoji','voice','line','cue']);
  }
});

test('buffered head never precedes pass 1 and is suppressed for sound/none', async () => {
  for(const voice of ['words','sound','none']) {
    const gate=deferred(), f=route(provider(fullText,{voice,jevGate:gate.promise}));
    const pending=f.request({text:'Hello'});await flush();assert.equal(f.frames.length,0);
    gate.resolve();await pending;
    assert.equal(f.frames.some(x=>x.head),voice==='words');
    assert.deepEqual(f.frames.slice(0,2).map(x=>Object.keys(x)[0]),['emoji','voice']);
  }
});

test('emitted head is never rewritten by the anti-repeat retry: no extra call, final keeps the spoken prefix', async () => {
  const initial='Three little birds. They found a sunflower.', replacement='A tiny cloud adopted them.';
  const f=route(provider(initial,{retry:replacement}));
  await f.request({text:'Story please',history:[{who:'mintie',emoji:null,said:'They found a sunflower.',agoMs:4000}]});
  assert.equal(f.frames[2].head.line,'Three little birds.');
  assert.equal(f.frames[3].line,initial);
  assert.equal(f.logs.find(x=>x.stage==='stream-final').prefix,true);
  assert.equal(f.logs.filter(x=>x.stage==='s2-repeat').length,0);
});

test('onDelta hedge locks first winner, never mixes losing deltas', async () => {
  const calls=[],deltas=[];
  const fetch=async (_url,options)=>new Response(new ReadableStream({start(c){calls.push({c,signal:options.signal});}}));
  const pending=generateLine({max_tokens:320},{key:'fake',fetch,hedgeMs:5,onDelta:x=>deltas.push(x)});
  await new Promise(r=>setTimeout(r,15));assert.equal(calls.length,2);
  calls[1].c.enqueue(new TextEncoder().encode(delta('Winner.')));await flush();
  assert.equal(calls[0].signal.aborted,true);
  calls[0].c.enqueue(new TextEncoder().encode(delta('Loser.')+end));calls[0].c.close();
  calls[1].c.enqueue(new TextEncoder().encode(end));calls[1].c.close();
  assert.equal(await pending,'Winner.');assert.deepEqual(deltas,['Winner.']);
});

function cascadeFixture() {
  const requests=[], firstEnd=deferred(), firstDone=deferred(), tailDone=deferred(), gate=deferred(), head=deferred(), line=deferred(), owner=new AbortController();
  const audio={atMs:ms=>ms/1000,say(text,options){
    const index=requests.length, entry={text,options};requests.push(entry);
    const result=Promise.resolve(options.gate).then(ok=>{
      if(!ok || options.signal.aborted)throw new DOMException('Cancelled','AbortError');
      return {startAt:options.when(),endAt:index===0?firstEnd.promise:Promise.resolve(5),done:index===0?firstDone.promise:tailDone.promise,charTime:offset=>Promise.resolve((index===0?10:20)+offset)};
    });entry.result=result;return result;
  }};
  const events=[];
  const result=speakCascade(audio,head.promise,line.promise,{gate:gate.promise,when:()=>1.2,signal:owner.signal,event:(...x)=>events.push(x)});
  return {requests,firstEnd,firstDone,tailDone,gate,head,line,owner,result,events};
}

test('head prefetch respects gate; tail fetched before head seals, schedules at exact job end, maps offsets', async () => {
  const f=cascadeFixture();f.head.resolve({line:headText});await flush();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].text,headText);
  let started=false;f.requests[0].result.then(()=>{started=true;});await flush();assert.equal(started,false);
  f.gate.resolve(true);await flush();assert.equal(started,true);
  const full=headText+' Tail text.';f.line.resolve({line:full});await flush();
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].text,' Tail text.');assert.equal(f.requests[1].options.previous_text,headText);
  const result=await f.result;
  assert.equal(await result.charTime(3),13);
  const tailChar=result.charTime(headText.length+2);
  f.firstEnd.resolve(3.141592653589793);await flush();
  assert.equal((await f.requests[1].result).startAt,3.141592653589793);
  assert.equal(await tailChar,22);await assert.rejects(result.charTime(full.length),RangeError);
  let done=false;result.done.then(()=>{done=true;});f.firstDone.resolve();await flush();assert.equal(done,false);
  f.tailDone.resolve();await result.done;assert.equal(done,true);assert.equal(f.events[0][0],'stream_seam');
});

test('head mismatch cancels only head; replacement speaks full line, no previous_text; barge-in aborts both', async () => {
  const f=cascadeFixture();f.head.resolve({line:headText});f.gate.resolve(true);await flush();
  f.line.resolve({line:'A replacement story.'});await f.result;
  assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(f.requests[1].text,'A replacement story.');
  assert.equal(f.requests[1].options.previous_text,undefined);assert.equal(f.events[0][0],'stream_mismatch');
  const g=cascadeFixture();g.head.resolve({line:headText});g.gate.resolve(true);g.line.resolve({line:headText+' Tail.'});await g.result;
  g.owner.abort();assert.equal(g.requests[0].options.signal.aborted,true);assert.equal(g.requests[1].options.signal.aborted,true);
  g.firstEnd.resolve(null);g.firstDone.resolve();g.tailDone.resolve();
});

test('no head waits for motion; cancellation never speaks', async () => {
  const f=cascadeFixture();f.head.resolve(null);f.line.resolve({line:'Three little birds.'});await flush();assert.equal(f.requests.length,0);
  f.gate.resolve(true);await f.result;assert.equal(f.requests.length,1);
  const g=cascadeFixture();g.head.resolve({line:headText});g.gate.resolve(false);g.line.resolve({line:headText+' Tail.'});await assert.rejects(g.result,{name:'AbortError'});
});

test('main parser admits head after words; cancellation settles blocked head', async () => {
  const source=await readFile(new URL('../web/main.js',import.meta.url),'utf8');
  async function fixture() {
    const frames=[],sounds=[],head=deferred(),line=deferred();let wire;
    const context=vm.createContext({cancelArrival(){},CATALOG,needs:{event(){},mood:()=>({})},speakCascade,trace:{enabled:false},performance:{now:()=>1000},AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,
      disposed:false,reactionSerial:0,requestSerial:0,run:null,request:null,listening:true,metrics:{},history:[],voiceWanted:true,companionName:'Alex',thinkingUntil:0,received:null,t:1000,
      audio:{stop(){},atMs:ms=>ms/1000,say(text,options){sounds.push({text,options});return Promise.resolve({startAt:1.2,endAt:Promise.resolve(3),done:new Promise(()=>{}),charTime:offset=>Promise.resolve(offset)});}},
      performer:{play:()=>({id:1,anticipationMs:180}),active:()=>null,cancel(){}},queueBlinks(){},announce(){},said(){},status(){},audioError(){},fallback(){throw Error('unexpected fallback');},applyMotion(){},sceneState:()=>({}),sendHistory:()=>[],remember:x=>x,
      fetch:async()=>new Response(new ReadableStream({start(c){wire=c;}}),{headers:{'content-type':'application/x-ndjson'}}),
    });
    vm.runInContext(source.slice(source.indexOf('async function react('),source.indexOf('\nfunction localReaction'))+'\n'+source.slice(source.indexOf('async function streamReaction('),source.indexOf('\nfunction partialCaption')),context);
    context.candidate={text:'A story',commitAt:1000};
    const done=vm.runInContext('streamReaction(candidate,1000,900)',context);
    const send=value=>{frames.push(value);wire.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));};
    await flush();send({emoji:'👋',gaze:null,hop:'none'});send({voice:'words'});await flush();
    vm.runInContext('run.resolve(1000)',context);await flush();
    return {context,sounds,done,send,close:()=>wire.close()};
  }
  const f=await fixture();f.send({head:{line:headText,display:'Three little birds.'}});await flush();
  assert.equal(f.sounds[0].text,headText,'head fetched before full line');
  f.send({line:headText+' Tail.',display:'Three little birds. Tail.',ms:10});f.send({cue:null});f.close();await f.done;
  assert.equal(f.sounds[1].text,' Tail.');assert.equal(f.sounds[1].options.previous_text,headText);
  f.context.run.controller.abort();assert.ok(f.sounds.every(x=>x.options.signal.aborted));
  const h=await fixture();h.send({error:{stage:'react',code:'network'}});h.close();await h.done;
  assert.equal(h.context.candidate.failed,true);assert.equal(h.context.run.controller.signal.aborted,true);assert.equal(h.sounds.length,0);
});

test('previous_text same validLine boundary, <=600, forwarded to ElevenLabs only when supplied', async () => {
  for(const previous_text of [headText,'x'.repeat(600)])assert.equal(validRequest('say',{text:'Tail.',align:true,previous_text}),true);
  for(const previous_text of [null,12,'',' ','x'.repeat(601),'🙂','<tag>','[unknown]','https://bad.test'])assert.equal(validRequest('say',{text:'Tail.',previous_text}),false);
  for(const previous_text of [undefined,headText]) {
    let sent;
    const f=route(async (url,options)=>{assert.ok(url.includes('elevenlabs'));sent=JSON.parse(options.body);return new Response(new Uint8Array([1,0]));});
    await f.request({text:'Tail.',...(previous_text===undefined?{}:{previous_text})},'/api/say');
    assert.deepEqual(sent,{text:'Tail.',model_id:'eleven_v4_turbo',...(previous_text===undefined?{}:{previous_text})});
  }
});

test('audio exposes endAt at stream seal before playback ends; tail first sample uses that end', async () => {
  const source=(await readFile(new URL('../web/audio.js',import.meta.url),'utf8')).replaceAll('export ','');
  const starts=[],nodes=[],bodies=[],streams=[];
  const node=()=>({connect(){},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}});
  const context=vm.createContext({performance,AbortController,DOMException,TextDecoder,atob,
    fetch:async (_url,options)=>{bodies.push(JSON.parse(options.body));return new Response(new ReadableStream({start(c){streams.push(c);}}),{headers:{'content-type':'application/x-ndjson','x-sample-rate':'24000'}});},
    AudioContext:class {currentTime=0;state='running';destination={};addEventListener(){}createGain(){return node();}createAnalyser(){return {...node(),fftSize:512};}createBuffer(_n,len,rate){return {duration:len/rate,copyToChannel(){}};}createBufferSource(){const n={...node(),start:at=>starts.push(at),stop(){}};nodes.push(n);return n;}},
  });
  vm.runInContext(source+'\nthis.audio=createAudio();',context);const audio=context.audio;
  const pcm=Buffer.alloc(48000).toString('base64');
  const first=audio.say('Head.',{when:1,align:true});await flush();
  streams[0].enqueue(new TextEncoder().encode(JSON.stringify({pcm})+'\n'));const head=await first;
  let sealed=false;head.endAt.then(()=>{sealed=true;});await flush();assert.equal(sealed,false);
  streams[0].enqueue(new TextEncoder().encode('{"done":true}\n'));streams[0].close();assert.equal(await head.endAt,2);
  let ended=false;head.done.then(()=>{ended=true;});await flush();assert.equal(ended,false);
  const tail=audio.say(' Tail.',{when:()=>2,gate:head.endAt.then(()=>true),align:true,previous_text:'Head.'});await flush();
  streams[1].enqueue(new TextEncoder().encode(JSON.stringify({pcm})+'\n{"done":true}\n'));streams[1].close();await tail;
  assert.deepEqual(starts,[1,2]);assert.equal(bodies[1].previous_text,'Head.');
  audio.stop(0);await head.done;
});
