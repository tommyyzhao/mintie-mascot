import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {loadKeys,createApp,generateLine,configureServer,jsonBody,cleanLine,validLine,responseEvents,proseResult,lineRequest,validRequest,repeatedLine,repeatedSound,soundKey,recentSounds,timestampObjects,alignedChunk} from '../server/server.mjs';
import {CATALOG} from '../web/perform/emoji.js';
import {decisionRequest} from '../server/decision.mjs';
const keys={OPENROUTER_API_KEY:'SENTINEL_OPENROUTER_SECRET',ELEVENLABS_API_KEY:'SENTINEL_ELEVEN_SECRET',TYPESAFE_API_KEY:'SENTINEL_TYPESAFE_SECRET'};
const frame=event=>`data: ${JSON.stringify(event)}\n\n`+(event.choices?.[0]?.finish_reason==='stop'?'data: [DONE]\n\n':'');
const delta=delta=>({choices:[{delta:{content:delta},finish_reason:null}]});
const completed={choices:[{delta:{},finish_reason:'stop'}]};
const sse=value=>new Response(frame(delta(typeof value==='string'?value:JSON.stringify(value)))+frame(completed));
const jev=(voice='words',emoji='👋')=>Response.json({answers:{animation:{type:'choice',choice:emoji},gaze:{type:'choice',choice:'viewer'},hop:{type:'choice',choice:'none'},voice:{type:'choice',choice:voice}}});
const words=()=>sse('¡Qué padre!');
const rows=body=>body.trim().split('\n').map(JSON.parse);
const kind=b=>b.questions?'jev':b.response_format?.json_schema?.name??(b.max_tokens===24?'sound':'words');
async function fixture(t,mock=async(url,o)=>url.includes('typesafe')?jev():kind(JSON.parse(o.body))==='sound'?sse('Wiii'):words(),options={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'mintie-s2-')),web=path.join(dir,'web'),three=path.join(dir,'three');
  await mkdir(web);await mkdir(three);await writeFile(path.join(web,'index.html'),'hello');await writeFile(path.join(three,'three.module.js'),'export {}');await writeFile(path.join(dir,'secret'),'outside');await symlink(path.join(dir,'secret'),path.join(web,'escape'));
  const calls=[],logs=[],server=http.createServer(createApp({webRoot:web,threeDir:three,catalog:CATALOG,keys,fetch:async(url,o)=>{calls.push({url,...o,body:o.body?JSON.parse(o.body):undefined});return url.includes('typesafe') && o.body && JSON.parse(o.body).questions.emote?(options.emoteMock?.(url,o)??Response.json({answers:{emote:{type:'choice',choice:'null'},timing:{type:'choice',choice:'none'},word:{type:'choice',choice:Object.keys(JSON.parse(o.body).questions.word.criteria)[0]}}})):mock(url,o);},log:x=>logs.push(x),...options}));
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  async function request(url,{method='POST',body={text:'¿Cómo estás?'},headers={}}={}) {
    return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:url,method,headers:Object.fromEntries(Object.entries({origin,'content-type':'application/json',...headers}).filter(([,v])=>v!==undefined))},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(method==='POST'?(typeof body==='string'?body:JSON.stringify(body)):undefined);});
  }
  return {request,calls,logs,port,origin};
}
test('loadKeys honors explicit names; default excludes OpenAI, includes System One',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mintie-keys-')),file=path.join(dir,'fixture.env');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(file,'OPENAI_API_KEY="test-openai"\r\nELEVENLABS_API_KEY= test-eleven \r\nTYPESAFE_API_KEY=\'test-typesafe\'\r\nOPENROUTER_API_KEY="test-router=a"\r\nOTHER_SECRET=ignored\r\nSYSTEM_ONE_API_KEY=test-system-one\r\n#OPENROUTER_API_KEY=comment\r\n');
  assert.deepEqual(await loadKeys(file),{OPENROUTER_API_KEY:'test-router=a',ELEVENLABS_API_KEY:'test-eleven',TYPESAFE_API_KEY:'test-typesafe',SYSTEM_ONE_API_KEY:'test-system-one'});
  assert.deepEqual(await loadKeys(file,['OPENROUTER_API_KEY']),{OPENROUTER_API_KEY:'test-router=a'});
  assert.deepEqual(await loadKeys(file,[]),{});
});
test('host/origin/JSON/size/static containment and rate limits',async t=>{
  const {request}=await fixture(t,undefined,{now:()=>1000});
  assert.equal((await request('/api/health',{method:'GET',headers:{host:'evil.example'}})).status,400);
  assert.equal((await request('/api/react',{headers:{origin:'http://evil.example'}})).status,403);
  assert.equal((await request('/api/react',{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await request('/api/react',{body:{text:'x'.repeat(33000)}})).status,400);
  for(const url of ['/../secret','/%2e%2e/secret','/escape','/.hidden'])assert.equal((await request(url,{method:'GET'})).status,404);
  assert.match((await request('/vendor/three/three.module.js',{method:'GET'})).headers['content-type'],/^text\/javascript/);
  const html=await request('/',{method:'GET'});assert.equal(html.headers['cache-control'],'no-store');assert.ok(html.headers['content-security-policy']);
  assert.deepEqual(JSON.parse((await request('/api/health',{method:'GET'})).body),{ok:true,stt:true,react:true,say:true,decider:'system-one'});
  for(let i=0;i<8;i++)await request('/api/react');assert.equal((await request('/api/react')).status,429);
});
test('public mode: exact https origin replaces loopback check; daily ceiling resets at UTC midnight',async t=>{
  assert.throws(()=>createApp({webRoot:'.',threeDir:'.',catalog:CATALOG,origins:['http://mintie.example']}),/invalid_origins/);
  assert.throws(()=>createApp({webRoot:'.',threeDir:'.',catalog:CATALOG,origins:['https://mintie.example/']}),/invalid_origins/);
  createApp({webRoot:'.',threeDir:'.',catalog:CATALOG,origins:['http://localhost:8787']}); // loopback http allowed for wrangler dev
  let clock=864e5*20000;
  const {request}=await fixture(t,undefined,{now:()=>clock,origins:['https://mintie.example'],daily:{react:2,say:1,'stt-token':1}});
  const pub={host:'mintie.example',origin:'https://mintie.example'};
  assert.equal((await request('/api/health',{method:'GET'})).status,400);
  assert.equal((await request('/api/react',{headers:{...pub,origin:'http://mintie.example'}})).status,403);
  for(let i=0;i<2;i++)assert.equal((await request('/api/react',{headers:pub})).status,200);
  const capped=await request('/api/react',{headers:pub});assert.equal(capped.status,429);assert.equal(JSON.parse(capped.body).error.code,'daily_limit');
  clock+=864e5;assert.equal((await request('/api/react',{headers:pub})).status,200);
});
test('JSON deadline and native server bounds',async()=>{
  const config={};assert.equal(configureServer(config),config);assert.equal(config.requestTimeout,5000);assert.equal(config.headersTimeout,5000);
  const req=new PassThrough();req.headers={'content-type':'application/json'};req.write('{');const timer=setTimeout(()=>{},1000);
  try{await assert.rejects(jsonBody(req,20));assert.equal(req.destroyed,true);}finally{clearTimeout(timer);}
});
test('two-pass speculative requests start before Jev, plain prose separates caption and TTS',async t=>{
  const {request,calls}=await fixture(t,async(url,o)=>url.includes('typesafe')?jev():kind(JSON.parse(o.body))==='sound'?sse('Wiii'):sse('¡Hola! 🥳 [giggles]'));
  const r=await request('/api/react'),out=rows(r.body);
  assert.deepEqual(out.slice(0,2),[{emoji:'👋',gaze:'viewer',hop:'none'},{voice:'words',filler:'none'}]);assert.equal(out[2].line,'¡Hola! [giggles]');assert.equal(out[2].display,'¡Hola! 🥳');assert.deepEqual(out[3],{cue:null});
  assert.deepEqual(calls.map(c=>c.body.model),['deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash','jev-1.14.0','jev-1.14.0']);
  for(const c of calls.slice(0,2)){assert.equal(c.url,'https://openrouter.ai/api/v1/chat/completions');assert.deepEqual(c.body.reasoning,{enabled:false});assert.deepEqual(c.body.provider,{order:['wafer/us','together','parasail/fp8'],allow_fallbacks:true,sort:'latency'});assert.deepEqual(c.body.usage,{include:true});assert.equal(c.body.service_tier,undefined);assert.equal(c.body.store,undefined);assert.equal(c.body.stream,true);assert.equal(JSON.parse(c.body.messages[1].content).emoji,undefined);}
  assert.match(calls[1].body.messages[0].content,/NEVER mention, describe or deny/);assert.equal(calls[0].signal.aborted,true);
});
test('line flushes before blocked pass 2; pass 2 cue overrides DeepSeek fallback',async t=>{
  let release;const held=new Promise(r=>release=r);t.after(()=>release());
  const {port,origin}=await fixture(t,undefined,{emoteMock:async()=>{await held;return Response.json({answers:{emote:{type:'choice',choice:'❤️'},timing:{type:'choice',choice:'word'},word:{type:'choice',choice:'2: padre'}}});}});
  const out=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/api/react',method:'POST',headers:{origin,'content-type':'application/json'}},res=>{
      let raw='';res.on('data',c=>{raw+=c;if(raw.includes('"line"') && !raw.includes('"cue"')){release();}});res.on('end',()=>resolve(rows(raw)));
    });req.on('error',reject);req.end('{"text":"Hi"}');
  });
  assert.deepEqual(out[3],{cue:{emoji:'❤️',at:5,timing:'word'}});
});
test('pass 2 timeout/failure/null keeps emoji fallback; no fallback leaves initial move sustaining',async t=>{
  for(const mode of ['timeout','error','null']) {
    const {request,logs}=await fixture(t,async(url,o)=>url.includes('typesafe')?jev():kind(JSON.parse(o.body))==='words'?sse('Hello 🥳'):sse('Ay'),{systemOneTimeoutMs:10,emoteMock:async()=>{if(mode==='timeout')return new Promise(()=>{});if(mode==='error')throw Error('private');return Response.json({answers:{emote:{type:'choice',choice:'null'},timing:{type:'choice',choice:'none'},word:{type:'choice',choice:'1: Hello'}}});}});
    assert.deepEqual(rows((await request('/api/react')).body)[3],mode==='null'?{cue:null}:{cue:{emoji:'🎉',at:0}});
    assert.equal(logs.filter(x=>x.stage==='system-one-emote').length,1);
  }
  const {request}=await fixture(t);assert.deepEqual(rows((await request('/api/react')).body)[3],{cue:null});
});
test('words already running while Jev blocked; motion flushes before words complete',async t=>{
  let releaseWords,releaseJev;const held=new Promise(r=>releaseWords=r),jevHeld=new Promise(r=>releaseJev=r);t.after(()=>{releaseWords();releaseJev();});
  const {port,origin,calls}=await fixture(t,async(url,o)=>{if(url.includes('typesafe')){await jevHeld;return jev();}if(kind(JSON.parse(o.body))==='words'){await held;return words();}return sse('Ay');});
  const result=new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:'/api/react',method:'POST',headers:{origin,'content-type':'application/json'}},res=>{let text='';res.on('data',c=>{text+=c;if(text.includes('\n')){assert.equal(rows(text)[0].emoji,'👋');releaseWords();}});res.on('end',()=>resolve(rows(text)));});req.on('error',reject);req.end('{"text":"Hola"}');});
  await new Promise(r=>setTimeout(r,25));assert.equal(calls.length,3);releaseJev();const out=await result;assert.equal(out[2].line,'¡Qué padre!');
});
test('cue guidance shares Jev semantics, anchors optional gestures to words',()=>{
  const r=lineRequest(CATALOG,{text:'¿Qué tal?'},'words');
  assert.match(r.messages[0].content,/Write plain text, NOT JSON/);assert.match(r.messages[0].content,/emojis liberally/);assert.equal(r.response_format,undefined);
  for(const s2HedgeMs of [-1,NaN,4001])assert.throws(()=>createApp({s2HedgeMs}),/invalid_s2_options/);
});
test('both voices mirror latest user language, neutral address, specific replies and brief preference',()=>{
  for(const voice of ['words','sound']) {
    const r=lineRequest(CATALOG,{touch:{kind:'poke'},history:[{who:'user',text:'Hi there',agoMs:1000}]},voice);
    for(const pattern of [/respond in the language of the current state.text/,/if none or unclear, use the language of state.memory facts, else English/,/Never assume anyone's gender, including third parties/,/Never invent facts/,/last FOUR history.said/,/names and details/,/never translate away a pun/])assert.match(r.messages[0].content,pattern);
    assert.doesNotMatch(r.messages[0].content,/No other languages/);assert.equal(JSON.parse(r.messages[1].content).history[0].text,'Hi there');
    if(voice==='words'){assert.match(r.messages[0].content,/Usually one breath/);assert.equal(r.max_tokens,320);}else assert.doesNotMatch(r.messages[0].content,/Spanish-first/);
  }
});
test('sound interjections follow current user language, not prior sounds',()=>{
  const body={text:'Guess what, I just got my dream job!',history:[{who:'user',text:'Hola',agoMs:6000},{who:'mintie',said:'¡Qué padre!',agoMs:5000}]};
  const request=lineRequest(CATALOG,body,'sound'),prompt=request.messages[0].content;
  for(const rule of [/SOUND LANGUAGE:/,/use the language of state.text/,/latest history entry with who=user and text/,/Never copy the language of Mintie's history.said or recentSounds/,/Interjections must belong to the language of the user's latest utterance/,/language-neutral hum\/giggle\/gasp/])assert.match(prompt,rule);
  assert.doesNotMatch(prompt,/Example: \[giggles\] ay/);
  assert.equal(JSON.parse(request.messages[1].content).text,body.text);
  assert.deepEqual(JSON.parse(request.messages[1].content).recentSounds,['¡Qué padre!']);
  assert.equal(request.max_tokens,24);
  assert.doesNotMatch(lineRequest(CATALOG,body,'words').messages[0].content,/SOUND LANGUAGE/);
});

test('phrase guard normalizes case, accents, tags and punctuation; only last three said lines',()=>{
  const history=['Aquí estoy contigo.','¿Cómo va Churro?','[whispers] Todo va bien.','Qué bueno verte.'].map(said=>({who:'mintie',said}));
  for(const line of ['¡Qué BUENO saberlo!','Amix, como va Churro hoy?','[giggles] TODO, va bien.'])assert.equal(repeatedLine(line,history),true);
  for(const line of [null,'Qué','Aquí estoy contigo.','Churro va feliz.','Todo va distinto.'])assert.equal(repeatedLine(line,history),false);
  assert.equal(repeatedLine('One two three',[{who:'user',said:'One two three'},{who:'mintie',said:null}]),false);
  assert.equal(repeatedLine('one two',[{who:'mintie',said:'One two three'},{who:'mintie',said:null}]),true);
});
test('repeat gets exactly one unhedged retry; repeated retry kept, failures retain first',async t=>{
  const history=[{who:'mintie',emoji:null,said:'Aquí estoy contigo.',agoMs:4000}];
  for(const failure of [false,true]) {
    let attempts=0;
    const {request,calls,logs}=await fixture(t,async(url,o)=>{
      if(url.includes('typesafe'))return jev();
      if(kind(JSON.parse(o.body))!=='words')return sse('Wiii');
      if(++attempts===2){await new Promise(r=>setTimeout(r,20));if(failure)throw Error('failure');}
      return sse(attempts===1?'Aquí estoy contigo.':'Aquí estoy, amix.');
    },{s2HedgeMs:10});
    const out=rows((await request('/api/react',{body:{text:'Necesito compañía',history}})).body);
    assert.equal(out[2].line,failure?'Aquí estoy contigo.':'Aquí estoy, amix.');assert.equal(attempts,2);
    assert.equal(calls.filter(c=>kind(c.body)==='words').length,2);assert.equal(logs.filter(x=>x.stage==='s2-repeat').length,1);
    assert.match(calls.filter(c=>kind(c.body)==='words')[1].body.messages[0].content,/Rephrase completely/);
  }
});
test('fresh prose needs no retry',async t=>{
  const {request,calls}=await fixture(t);
  await request('/api/react',{body:{text:'Hola',history:[{who:'mintie',emoji:null,said:'Aquí estoy contigo.',agoMs:4000}]}});
  assert.equal(calls.filter(c=>kind(c.body)==='words').length,1);
});
test('first-delta hedge races completion, aborts loser, only one duplicate',async()=>{
  const request=lineRequest(CATALOG,{text:'hi'}),signals=[],logs=[];let calls=0;
  const output=await generateLine(request,{key:'test',hedgeMs:10,log:x=>logs.push(x),fetch:async(_u,o)=>{signals.push(o.signal);if(++calls===1)return new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));return sse('winner');}});
  assert.equal(output,'winner');assert.equal(calls,2);assert.ok(signals.every(s=>s.aborted));assert.equal(logs.filter(x=>x.stage==='s2-start'&&x.attempt===2).length,1);
  calls=0;await generateLine(request,{key:'test',hedgeMs:10,fetch:async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame(delta('first'))));setTimeout(()=>{c.enqueue(new TextEncoder().encode(frame(completed)));c.close();},30);}}));}});assert.equal(calls,1);
});
test('hedge preserves original winner; abort/disable/failure never starts a later call',async()=>{
  const request=lineRequest(CATALOG,{},'sound');let calls=0;
  const output=await generateLine(request,{key:'test',hedgeMs:5,fetch:async(_u,o)=>++calls===1?new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(new TextEncoder().encode(frame(delta('original'))+frame(completed)));c.close();},15);}})):new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});assert.equal(output,'original');assert.equal(calls,2);
  const controller=new AbortController();calls=0;const pending=generateLine(request,{key:'test',signal:controller.signal,hedgeMs:10,fetch:async()=>{calls++;return new Promise(()=>{});}});controller.abort();await assert.rejects(pending,/network/);await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
  calls=0;await assert.rejects(generateLine(request,{key:'test',hedgeMs:10,fetch:async()=>{calls++;throw Error('failure');}}),/failure/);await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
  calls=0;await generateLine(request,{key:'test',hedgeMs:0,fetch:async()=>{calls++;return sse('sound');}});assert.equal(calls,1);
});
test('synchronous fetch throw leaves no hedge timer',async()=>{
  const timer=mock.method(globalThis,'setTimeout');
  try{await assert.rejects(generateLine(lineRequest(CATALOG,{},'sound'),{key:'test',hedgeMs:900,fetch:()=>{throw Error('sync');}}),/sync/);assert.equal(timer.mock.callCount(),0);}finally{timer.mock.restore();}
});
test('touch only speculates sound; silence aborts unused generation; text speculates both',async t=>{
  const {request,calls}=await fixture(t,async(url)=>url.includes('typesafe')?jev('none'):sse('Wiii'));
  assert.equal(rows((await request('/api/react',{body:{touch:{kind:'poke'}}})).body)[2].line,null);assert.equal(calls.length,2);assert.equal(calls[0].signal.aborted,true);
  calls.length=0;await request('/api/react');assert.equal(calls.length,3);assert.ok(calls.slice(0,2).every(c=>c.signal.aborted));
});
test('Jev timeout/error/malformed falls back to exactly ONE strict DeepSeek decision',async t=>{
  let mode='timeout',jevSignal;
  const {request,calls}=await fixture(t,async(url,o)=>{
    if(url.includes('typesafe')){jevSignal=o.signal;if(mode==='timeout')return new Promise(()=>{});return mode==='http'?new Response('private',{status:503}):new Response('{}');}
    return kind(JSON.parse(o.body))==='decision'?sse({animation:'🤔',gaze:null,hop:'none',voice:'words'}):kind(JSON.parse(o.body))==='words'?words():sse('Ay');
  },{systemOneTimeoutMs:10});
  for(mode of ['timeout','http','malformed']){calls.length=0;const out=rows((await request('/api/react')).body);assert.deepEqual(out.slice(0,2),[{emoji:'🤔',gaze:null,hop:'none'},{voice:'words',filler:'none'}]);assert.equal(calls.filter(c=>kind(c.body)==='decision').length,1);assert.equal(calls.length,5);assert.equal(jevSignal.aborted,true);}
});
test('keyless Jev fallback uses same single decision and speculative words',async t=>{
  const {request,calls}=await fixture(t,async(_u,o)=>kind(JSON.parse(o.body))==='decision'?sse({animation:null,gaze:null,hop:'none',voice:'words'}):words(),{keys:{OPENROUTER_API_KEY:keys.OPENROUTER_API_KEY}});
  assert.equal(rows((await request('/api/react')).body)[2].line,'¡Qué padre!');assert.equal(calls.length,3);
});
test('plain prose validates tags/secrets/length; caption keeps emojis, TTS strips them',()=>{
  const run=value=>proseResult(value,{voice:'words',filler:'none'},[],Object.values(keys));
  for(const bad of [null,'https://example.com',keys.OPENROUTER_API_KEY,'x'.repeat(601)])assert.equal(run(bad).line,null);
  assert.equal(run('[bad] hi').line,'hi');
  assert.deepEqual(run('[whispers] Hello 🥳 friend 😍!'),{line:'[whispers] Hello friend!',display:'Hello 🥳 friend 😍!',fallback:{emoji:'🎉',at:11}});
  assert.equal(run('🌼 hi 🙌').fallback.emoji,'🎉');
  assert.equal(run('123 1️⃣ hello').line,'123 hello');
  assert.equal(run('only words').fallback,null);
});
test('long and truncated prose preserves sentence, tags and emoji boundaries',()=>{
  const sentence='[giggles] '+('dandelion '.repeat(35))+'arrived! 👩🏽‍🚀',raw=sentence+' '+('more '.repeat(100))+'unfinished';
  const result=proseResult(raw,{voice:'words',filler:'none'},[]);assert.equal(result.display,sentence.replace('[giggles] ',''));assert.equal(result.line,'[giggles] '+('dandelion '.repeat(35))+'arrived!');assert.ok(result.line.length<=600 && result.display.length<=600);
  assert.equal(proseResult('A complete sentence. unfinished',{voice:'words',filler:'none'},[],[],true).line,'A complete sentence.');
  assert.equal(proseResult('unfinished words here',{voice:'words',filler:'none'},[],[],true).line,'unfinished words…');
});
test('react emits usable words after length finish',async t=>{
  const story='[giggles] '+('dandelion '.repeat(35))+'arrived! '+('more '.repeat(80))+'unfinished';
  const {request}=await fixture(t,async(url,o)=>url.includes('typesafe')?jev():kind(JSON.parse(o.body))==='words'?new Response(frame(delta(story))+frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n'):sse('Ay'));
  const out=rows((await request('/api/react')).body);const line=out.find(x=>Object.hasOwn(x,'line'));assert.ok(line.line);assert.ok(line.line.length<=600);assert.match(line.line,/arrived!$/);
});
test('sound freshness guards, four-word cap and spelled interjections only',async t=>{
  const history=['wiii','ups','oye','mmm','ay jijí','¡eek!'].map((said,i)=>({who:'mintie',emoji:'🙂',said,agoMs:(6-i)*4000}));
  const r=lineRequest(CATALOG,{history},'sound');assert.deepEqual(JSON.parse(r.messages[1].content).recentSounds,history.map(x=>x.said));assert.equal(r.temperature,1.2);assert.equal(soundKey('¡Áyyy!'),'ay');
  assert.deepEqual(recentSounds(history),history.map(x=>x.said));for(const v of ['[gasps] ay jiji','ayy jeje','Mmm...','eeek'])assert.equal(repeatedSound(v,history),true);assert.equal(repeatedSound('wiii',history),false);
  for(const sound of ['mmm','[unknown] jiji',keys.OPENROUTER_API_KEY])assert.equal(proseResult(sound,{voice:'sound',filler:'none'},history,Object.values(keys)).line,null);
  const {request}=await fixture(t,async(url)=>url.includes('typesafe')?jev('sound'):sse('prrr'));
  assert.equal(rows((await request('/api/react',{body:{touch:{kind:'poke'},history}})).body)[2].line,'prrr');
});
test('cleanLine and SSE framing handle split UTF-8; stream failures sanitized',async t=>{
  assert.equal(cleanLine('🍓🌼❤️‍🇲🇽👍🏽1️⃣'),null);assert.equal(cleanLine('🌼'),null);assert.equal(validLine('[happy hum] hola'),true);assert.equal(validLine('hola 🌼'),false);
  const bytes=new TextEncoder().encode(frame(delta('¡Hola! 🌼'))+frame(completed)),events=[];
  for await(const e of responseEvents(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}})))events.push(e);
  assert.equal(events[0].choices[0].delta.content,'¡Hola! 🌼');
  const {request}=await fixture(t,async(url)=>url.includes('typesafe')?jev():new Response(frame({error:{message:keys.OPENROUTER_API_KEY}})));
  const r=await request('/api/react');assert.deepEqual(rows(r.body).at(-1),{error:{stage:'react',code:'invalid_output'}});assert.ok(!r.body.includes(keys.OPENROUTER_API_KEY));
});
test('say trust boundary validates align flag; PCM unchanged, aligned stream cumulative and sanitized',async t=>{
  assert.equal(validRequest('say',{text:'hola',align:true}),true);for(const align of [false,1,'true',null])assert.equal(validRequest('say',{text:'hola',align}),false);
  const chunks=[{audio_base64:'AQI=',alignment:{characters:['h','o'],character_start_times_seconds:[0,.1]},normalized_alignment:{characters:['SECRET']}},{audio_base64:'AwQ=',alignment:{characters:['l','a'],character_start_times_seconds:[.2,.3]}}];
  const {request,calls}=await fixture(t,async(url)=>url.includes('with-timestamps')?new Response(chunks.map(JSON.stringify).join('\n')):new Response(Uint8Array.of(1,2)));
  let r=await request('/api/say',{body:{text:'hola'}});assert.equal(r.headers['content-type'],'audio/pcm');assert.equal(r.headers['x-sample-rate'],'24000');assert.equal(r.body,'\x01\x02');
  r=await request('/api/say',{body:{text:'hola',align:true}});assert.match(r.headers['content-type'],/^application\/x-ndjson/);assert.deepEqual(rows(r.body),[{pcm:'AQI=',chars:['h','o'],startMs:[0,100]},{pcm:'AwQ=',chars:['l','a'],startMs:[200,300]},{done:true}]);assert.equal(r.headers['x-sample-rate'],'24000');assert.match(calls[1].url,/stream\/with-timestamps\?output_format=pcm_24000$/);assert.equal(calls[1].body.model_id,'eleven_v4_turbo');assert.ok(calls.every(c=>!Object.hasOwn(c.body,'language_code')));
});
test('aligned JSON parser handles arbitrary boundaries, validates chars, sizes, times; errors before/after frame',async t=>{
  const values=[];for await(const v of timestampObjects(new ReadableStream({start(c){const bytes=new TextEncoder().encode(' {"x":"é\\\"}"}\n{"y":2}');for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}})))values.push(v);assert.deepEqual(values,[{x:'é"}'},{y:2}]);
  let data='provider prose';const {request}=await fixture(t,async()=>new Response(data));
  let r=await request('/api/say',{body:{text:'hi',align:true}});assert.equal(r.status,502);assert.deepEqual(JSON.parse(r.body),{error:{stage:'say',code:'invalid_output'}});
  data=JSON.stringify({audio_base64:'AQI=',alignment:{characters:['h'],character_start_times_seconds:[0]}})+'\nprivate';
  r=await request('/api/say',{body:{text:'hi',align:true}});assert.equal(r.status,200);assert.deepEqual(rows(r.body),[{pcm:'AQI=',chars:['h'],startMs:[0]},{error:{stage:'say',code:'invalid_output'}}]);
});
test('alignment rejects malformed PCM, mismatched characters, backwards/nonfinite times and oversized frames',async()=>{
  const ok={audio_base64:'AQI=',alignment:{characters:['h'],character_start_times_seconds:[0]}};
  for(const data of [{...ok,audio_base64:'private prose'},{...ok,audio_base64:'AQ=='},{...ok,alignment:{characters:['x'],character_start_times_seconds:[0]}},{...ok,alignment:{characters:['h'],character_start_times_seconds:[-1]}},{...ok,alignment:{characters:['h'],character_start_times_seconds:[NaN]}},{...ok,alignment:{characters:['h'],character_start_times_seconds:[61]}},{...ok,alignment:{characters:['h'],character_start_times_seconds:['0']}},{...ok,alignment:{characters:['h'],character_start_times_seconds:[]}}])assert.throws(()=>alignedChunk(data,'hi',0,-1),/invalid_output/);
  assert.throws(()=>alignedChunk(ok,'hi',0,20),/invalid_output/);
  await assert.rejects(async()=>{for await(const _ of timestampObjects(new Response(JSON.stringify({x:'x'.repeat(524288)})).body)){}},/invalid_output/);
});
test('keys/provider errors never escape; HTTP bodies cancel; token passthrough',async t=>{
  let mode='throw',cancelled=0;
  const {request,logs}=await fixture(t,async(url)=>{if(url.includes('typesafe'))return jev();if(mode==='throw')throw Error(Object.values(keys).join(' '));if(mode==='http')return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503});return new Response('{"token":"short-lived-token"}');});
  for(const route of ['react','say','stt-token']){const r=await request(`/api/${route}`,{body:route==='stt-token'?{}:{text:'hi'}});for(const k of Object.values(keys))assert.ok(!(r.body+JSON.stringify(logs)).includes(k));assert.equal((route==='react'?rows(r.body).at(-1):JSON.parse(r.body)).error.code,'network');}
  mode='http';const r=await request('/api/say');assert.equal(r.status,502);assert.equal(cancelled,1);mode='token';assert.deepEqual(JSON.parse((await request('/api/stt-token',{body:{}})).body),{token:'short-lived-token',model:'scribe_v3_live'});
});
test('Scribe token: single-use mint from the server key, no-store, CSP allows only the Scribe socket; keyless is unavailable',async t=>{
  const {request,calls,logs}=await fixture(t,async()=>Response.json({token:'sutkn_temporary_123'}));
  const response=await request('/api/stt-token',{body:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(response.body),{token:'sutkn_temporary_123',model:'scribe_v3_live'});
  assert.equal(calls[0].url,'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
  assert.equal(calls[0].method,'POST');assert.equal(calls[0].headers['xi-api-key'],keys.ELEVENLABS_API_KEY);
  assert.deepEqual(calls.slice(1).map(c=>[c.url,c.method??'HEAD',c.headers?.authorization]),[['https://api.typesafe.ai/','HEAD',undefined],['https://openrouter.ai/api/v1/models','HEAD',undefined]]);
  assert.deepEqual(logs.find(x=>x.stage==='usage'),{stage:'usage',provider:'elevenlabs',kind:'stt',sessions:1});
  const csp=response.headers['content-security-policy'];
  assert.ok(csp.includes('connect-src \'self\' wss://api.elevenlabs.io'));assert.ok(csp.includes('https://challenges.cloudflare.com'));
  const keyless=await fixture(t,undefined,{keys:{OPENROUTER_API_KEY:keys.OPENROUTER_API_KEY}});
  assert.equal((await keyless.request('/api/stt-token',{body:{}})).status,503);
  assert.equal(JSON.parse((await keyless.request('/api/health',{method:'GET'})).body).stt,false);
  assert.equal(keyless.calls.length,0);
});
test('token rejects malformed grants and reflected secrets',async t=>{
  for(const data of [{token:'x'},{access_token:'whatever_long_enough'},{token:keys.ELEVENLABS_API_KEY},{token:'has spaces and is long'}]) {
    const {request}=await fixture(t,async()=>Response.json(data));
    const response=await request('/api/stt-token',{body:{}});
    assert.equal(response.status,502);assert.equal(JSON.parse(response.body).error.code,'invalid_output');
  }
});
test('say and react abort exactly owned upstreams on disconnect',async t=>{
  let aborted;const done=new Promise(r=>aborted=r);
  const {port,origin}=await fixture(t,async(_u,o)=>new Response(new ReadableStream({start(c){c.enqueue(Uint8Array.of(1,2));o.signal.addEventListener('abort',()=>{aborted();c.close();},{once:true});}})));
  const req=http.request({host:'127.0.0.1',port,path:'/api/say',method:'POST',headers:{origin,'content-type':'application/json'}},res=>res.once('data',()=>res.destroy()));req.end('{"text":"hi"}');
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('abort timeout')),1000))]);
});

test('25 words survive react and say; 600 chars bound plain output',async t=>{
  const line=Array(25).fill('word').join(' ');
  const {request,calls}=await fixture(t,async(url,o)=>url.includes('typesafe')?jev():url.includes('elevenlabs')?new Response(Uint8Array.of(1,2)):sse(line));
  const out=rows((await request('/api/react')).body);assert.equal(out[2].line,line);assert.equal(calls[1].body.max_tokens,320);
  assert.equal((await request('/api/say',{body:{text:out[2].line}})).status,200);
  assert.equal(validRequest('say',{text:'x'.repeat(600)}),true);assert.equal(validRequest('say',{text:'x'.repeat(601)}),false);
  assert.equal(proseResult('x'.repeat(601),{voice:'words',filler:'none'},[]).line,null);
});
test('sound tags count as zero words, remain fresh, unknown tags fail closed',()=>{
  for(const tag of ['giggles','laughs','sighs','gasps','happy hum','whispers','squeals','snickers','excited','mischievously','curious']) {
    const line='['+tag+']';assert.equal(validLine(line,0),true);assert.equal(cleanLine(line,0),line);
    assert.equal(proseResult(line,{voice:'sound',filler:'none'},[]).line,line);assert.equal(repeatedSound(line,[{who:'mintie',said:line}]),true);
  }
  assert.equal(proseResult('[unknown]',{voice:'sound',filler:'none'},[]).line,null);
  assert.equal(cleanLine('[giggles] one two three four five',4),'[giggles] one two three four');
});
test('chat SSE rejects length/refusal/error/missing DONE, permits role/comments/usage',async()=>{
  const request=lineRequest(CATALOG,{text:'Hi'}),run=body=>generateLine(request,{key:'fake',fetch:async()=>new Response(body)});
  const length=frame(delta('partial'))+frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n';
  assert.equal(await run(length),'partial');
  for(const strict of [lineRequest(CATALOG,{},'sound'),decisionRequest({text:'Hi'})])await assert.rejects(generateLine(strict,{key:'fake',fetch:async()=>new Response(length)}),/invalid_output/);
  for(const finish_reason of ['content_filter','error'])await assert.rejects(run(frame(delta('partial'))+frame({choices:[{delta:{},finish_reason}]})+'data: [DONE]\n\n'),/invalid_output/);
  for(const body of [frame({error:{message:'private'}}),frame({choices:[{delta:{refusal:'no'}}]}),frame(delta('unfinished'))])await assert.rejects(run(body),/invalid_output/);
  assert.equal(await run(': ping\r\n\r\n'+frame({choices:[{delta:{role:'assistant'}}]})+frame(delta('ok'))+frame({choices:[],usage:{completion_tokens:1}})+frame(completed)),'ok');
});
test('react rejects removed routing fields at the trust boundary',()=>{
  assert.equal(validRequest('react',{text:'hi',flags:['realizer']}),false);
});
test('invented audio tags are dropped, not allowed to silence words; silent prose carries a reason code',()=>{
  const result=proseResult('[smiles] ¡Japón, Alex! [giggles] Sushi y templos 🌸',{voice:'words',filler:'none'},[]);
  assert.equal(result.line,'¡Japón, Alex! [giggles] Sushi y templos');assert.equal(result.display,'¡Japón, Alex! Sushi y templos 🌸');
  assert.equal(proseResult('{"x":1}',{voice:'words',filler:'none'},[]).reason,'json');assert.equal(proseResult('see www.example.com',{voice:'words',filler:'none'},[]).reason,'invalid');
  assert.equal(proseResult('[smiles]',{voice:'sound',filler:'none'},[]).reason,'invalid_tag');assert.equal(proseResult('[smiles]',{voice:'words',filler:'none'},[]).reason,'empty');
});

test('usage logs counts from mocked providers without content',async t=>{
  const logs=[];
  const usage={prompt_tokens:120,completion_tokens:4,cost:0.001};
  const stream=`data: ${JSON.stringify(delta('hello'))}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage})}\n\ndata: [DONE]\n\n`;
  await generateLine({max_tokens:320},{key:'fake',log:x=>logs.push(x),fetch:async()=>new Response(stream)});
  assert.deepEqual(logs.find(x=>x.stage==='usage'),{stage:'usage',provider:'openrouter',kind:'llm',voice:'words',tokens:124,usd:0.001});
  const f=await fixture(t,async(url)=>url.includes('typesafe')?Response.json({usage:{input_tokens:123},answers:{animation:{type:'choice',choice:'🙂‍↕️'}}}):new Response('pcm',{headers:{'character-cost':'7'}}));
  await f.request('/api/react',{body:{listening:true,text:'private test input'}});
  await f.request('/api/say',{body:{text:'private'}});
  assert.deepEqual(f.logs.filter(x=>x.stage==='usage'),[{stage:'usage',provider:'system-one',kind:'decision',pass:'listen',tokens:123,input_tokens:123},{stage:'usage',provider:'elevenlabs',kind:'tts',characters:7}]);
});

test('listener runs one Jev only, rate limited to one per 3s',async t=>{
  let clock=1000;
  const {request,calls,logs}=await fixture(t,async()=>Response.json({answers:{animation:{type:'choice',choice:'🙂‍↕️'}}}),{now:()=>clock});
  const body={text:'I feel happy',listening:true};
  const first=await request('/api/react',{body});
  assert.equal(first.status,200);assert.deepEqual(JSON.parse(first.body),{emoji:'🙂‍↕️'});
  assert.equal(calls.length,1);assert.ok(logs.some(x=>x.stage==='system-one-listen'));assert.ok(logs.some(x=>x.stage==='usage' && x.provider==='system-one' && x.pass==='listen'));
  assert.equal((await request('/api/react',{body})).status,429);assert.equal(calls.length,1);
  clock+=3000;assert.equal((await request('/api/react',{body})).status,200);assert.equal(calls.length,2);
});
