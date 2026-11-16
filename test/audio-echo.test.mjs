import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../web/audio.js', import.meta.url), 'utf8')).replaceAll('export ', '');

test('production sound manifest has three distinct nonempty MP3 variants per event kind', async () => {
  const base = new URL('../web/assets/sfx/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['boing', 'plop', 'sparkle', 'squish', 'stretch']);
  for (const variants of Object.values(manifest)) {
    assert.equal(variants.length, 3); assert.equal(new Set(variants).size, 3);
    for (const file of variants) {
      assert.match(file, /^[a-z]+-\d+\.mp3$/);
      assert.ok((await readFile(new URL(file, base))).length > 1000);
    }
  }
});
test('clip variants follow the injected seeded random sequence', async () => {
  async function selections(seed) {
    let state = seed, fetched = []; const picked = [];
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2**32);
    const node = () => ({ connect(target) { this.target=target; return this; }, disconnect() {}, gain: {} });
    const sandbox = vm.createContext({ performance, AbortController, DOMException, URL, random,
      location: { href: 'http://localhost/' },
      AudioContext: class {
        currentTime = 0; state = 'running'; destination = {};
        addEventListener() {} createGain = node;
        createAnalyser() { return node(); }
        createBufferSource() { return { ...node(), start() { picked.push(this.buffer.url); } }; }
        async decodeAudioData(bytes) { return { duration: .1, url: new TextDecoder().decode(bytes) }; }
      },
      fetch: async url => {
        if (url.href?.endsWith('manifest.json')) return new Response(JSON.stringify({ giggle: ['a.mp3', 'b.mp3', 'c.mp3'] }));
        fetched.push(url); return new Response(url);
      },
    });
    vm.runInContext(source + '\nthis.audio = createAudio({ random });', sandbox);
    await sandbox.audio.loadClips('/manifest.json');
    for (let i = 0; i < 12; i++) await sandbox.audio.playClip('giggle');
    assert.equal(sandbox.audio.speaking(),false,'material sounds are not Mintie voice');
    return picked;
  }
  const first = await selections(42);
  assert.deepEqual(first, await selections(42));
  assert.notDeepEqual(first, await selections(99));
  assert.ok(first.length > 1);
  for(let i=0;i<first.length;i+=3)assert.equal(new Set(first.slice(i,i+3)).size,3);
  for(let i=1;i<first.length;i++)assert.notEqual(first[i],first[i-1]);
});

test('preloaded local speech drives analyser; abort never stops unrelated sound', async () => {
  const gains=[],analysers=[],sources=[],requests=[];
  const node=()=>({connections:new Set(),connect(to){this.connections.add(to);return this;},disconnect(to){if(to)this.connections.delete(to);else this.connections.clear();},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}});
  const sandbox=vm.createContext({performance,AbortController,DOMException,URL,location:{href:'https://offline.invalid/'},AudioContext:class {
    currentTime=0;state='running';destination={};addEventListener(){}
    createGain(){const n=node();gains.push(n);return n;}
    createAnalyser(){const n={...node(),fftSize:512};analysers.push(n);return n;}
    async decodeAudioData(){return{duration:1};}
    createBufferSource(){const n={...node(),start(){},stop(){this.stopped=true;}};sources.push(n);return n;}
  },fetch:async url=>{requests.push(String(url));return String(url).endsWith('manifest.json')?new Response(JSON.stringify({long_clip:['speech.mp3'],squish:['sound.mp3']})):new Response(new Uint8Array(10));}});
  vm.runInContext(source+'\nthis.audio=createAudio();',sandbox);
  await sandbox.audio.loadClips('/manifest.json',{preload:true});assert.equal(requests.length,3);
  const controller=new AbortController();const speech=await sandbox.audio.playClip('long_clip',{line:'Hello there!',signal:controller.signal});
  const sound=await sandbox.audio.playClip('squish');assert.equal(requests.length,3,'no fetch at playback after preload');
  assert.ok(gains[1].connections.has(analysers[0]));assert.ok(gains[1].connections.has(gains[0]));assert.equal(analysers[0].connections.size,0,'analysis tap does not duplicate audible signal');
  assert.ok(gains[2].connections.has(gains[0]));assert.equal(gains[2].connections.size,1);
  controller.abort();await speech.done;assert.equal(sources[0].stopped,true);assert.equal(sources[1].stopped,undefined);sandbox.audio.stop();await sound.done;
});

test('audio echo tail is 150ms; six timed references survive for delayed provider finals', async () => {
  let clock = 1000;
  const sources = [];
  const node = () => ({ connect() { return this; }, disconnect() {}, gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } });
  const context = vm.createContext({ performance: { now: () => clock }, AbortController, DOMException, URL,
    location: { href: 'http://127.0.0.1:8100/' },
    AudioContext: class {
      get currentTime() { return clock / 1000; }
      state = 'running'; destination = {};
      addEventListener() {}
      createGain = node;
      createAnalyser() { return { ...node(), fftSize: 512 }; }
      createBuffer(_channels, length, rate) { return { duration: length / rate, copyToChannel() {} }; }
      createBufferSource() { const source = { ...node(), start(at) { this.at = at; }, stop() { this.onended(); } }; sources.push(source); return source; }
    },
    fetch: async () => new Response(new Uint8Array(4800), { headers: { 'content-type': 'audio/pcm', 'x-sample-rate': '24000' } }),
  });
  vm.runInContext(source + '\nthis.audio = createAudio();', context);
  const audio = context.audio;
  assert.deepEqual([...audio.echoLines], []);
  const scheduled = await audio.say('nunca sonó', { when: 10 });
  audio.stop(0); await scheduled.done;
  assert.deepEqual([...audio.echoLines], [], 'cancelled before playback is not an echo');
  for (let i = 0; i < 8; i++) {
    const result = await audio.say(`línea ${i}`, { when: clock / 1000 + .02 });
    clock = result.startAt * 1000 + 20;
    assert.equal(audio.currentLine, `línea ${i}`);
    assert.ok(audio.echoLines.includes(`línea ${i}`));
    clock += 100; sources.at(-1).onended(); await result.done;
  }
  assert.equal(audio.currentLine, '');
  assert.equal(audio.echoReferences.length, 6); assert.equal(audio.echoReferences[0].line, 'línea 2');
  assert.ok(audio.echoReferences.every(ref => Number.isFinite(ref.startAt) && ref.endAt >= ref.startAt));
  clock += 149; assert.ok(audio.echoLines.includes('línea 7'));
  clock += 1; assert.deepEqual([...audio.echoLines], []);
  assert.ok(audio.echoReferences.length > 0, 'historical timing is not a blanket echo veto');
  clock += 10000; assert.deepEqual([...audio.echoReferences], []);
});

test('aligned NDJSON splits, PCM scheduling, streamed char times survive underrun; stop releases waiters',async()=>{
  let clock=1000,stream,request;const sources=[];
  const node=()=>({connect(){return this;},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}});
  const sandbox=vm.createContext({performance:{now:()=>clock},AbortController,DOMException,TextDecoder,atob,
    AudioContext:class {
      get currentTime(){return clock/1000;} state='running';destination={};addEventListener(){} createGain=node;
      createAnalyser(){return {...node(),fftSize:512,getFloatTimeDomainData(a){a.fill(.1);}};}
      createBuffer(_n,length,rate){return {duration:length/rate,copyToChannel(samples){this.samples=samples;}};}
      createBufferSource(){const s={...node(),start(at){this.at=at;},stop(){this.onended?.();}};sources.push(s);return s;}
    },
    fetch:async(_url,options)=>{request=JSON.parse(options.body);return new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'content-type':'application/x-ndjson','x-sample-rate':'24000'}});},
  });
  vm.runInContext(source+'\nthis.audio=createAudio();',sandbox);const audio=sandbox.audio;
  const pending=audio.say('hola',{when:1.5,align:true});await new Promise(r=>setImmediate(r));
  const bytes=Buffer.alloc(4800);bytes.writeInt16LE(16384,0);
  const raw=JSON.stringify({pcm:bytes.toString('base64'),chars:['h'],startMs:[0]})+'\n';
  for (let i=0;i<raw.length;i+=31) stream.enqueue(new TextEncoder().encode(raw.slice(i,i+31)));
  const result=await pending;assert.deepEqual(request,{text:'hola',align:true});assert.equal(result.startAt,1.5);
  assert.equal(sources[0].buffer.samples[0],.5);assert.equal(await result.charTime(0),1.5);
  let resolved=false;const second=result.charTime(1).then(x=>{resolved=true;return x;});await Promise.resolve();assert.equal(resolved,false);
  clock=2000;stream.enqueue(new TextEncoder().encode(JSON.stringify({pcm:bytes.toString('base64'),chars:['o'],startMs:[100]})+'\n'));
  assert.equal(await second,2,'underrun maps to second scheduled span, not startAt+.1');assert.equal(sources[1].at,2);
  assert.equal(audio.speaking(),true);assert.ok(audio.amplitude()>0);
  const waiting=result.charTime(3);audio.stop();assert.equal(await waiting,null);assert.equal(audio.speaking(),false);await result.done;
  stream.close();await assert.rejects(result.charTime(-1),/invalid_char_offset/);
});
test('aligned stream terminal errors reject done, missing alignment resolves null at done',async()=>{
  for(const tail of [{done:true},{error:{stage:'say',code:'upstream'}}]) {
    const node=()=>({connect(){return this;},disconnect(){},gain:{}}),sources=[];
    const sandbox=vm.createContext({performance,AbortController,DOMException,TextDecoder,atob,AudioContext:class{
      currentTime=0;state='running';destination={};addEventListener(){}createGain=node;createAnalyser=node;
      createBuffer(_n,n,rate){return{duration:n/rate,copyToChannel(){}};}
      createBufferSource(){const s={...node(),start(){},stop(){this.onended?.();}};sources.push(s);return s;}
    },fetch:async()=>new Response(JSON.stringify({pcm:Buffer.alloc(4800).toString('base64')})+'\n'+JSON.stringify(tail)+'\n',{headers:{'content-type':'application/x-ndjson','x-sample-rate':'24000'}})});
    vm.runInContext(source+'\nthis.audio=createAudio();',sandbox);const result=await sandbox.audio.say('hola',{align:true});
    assert.equal(await result.charTime(2),null);
    if(tail.error)await assert.rejects(result.done,/say_stream/);else {sources[0].onended();await result.done;}
  }
});
test('stop and audio interruption settle playback without onended', async () => {
  let clock = 1000;
  const sources = [];
  const node = () => ({ connect() { return this; }, disconnect() { this.disconnected = true; }, gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } });
  const sandbox = vm.createContext({ performance: { now: () => clock }, AbortController, DOMException,
    AudioContext: class {
      get currentTime() { return clock / 1000; }
      state = 'running'; destination = {};
      addEventListener(_name, callback) { this.statechange = callback; }
      createGain = node;
      createAnalyser() { return { ...node(), fftSize: 512 }; }
      createBuffer(_channels, length, rate) { return { duration: length / rate, copyToChannel() {} }; }
      createBufferSource() { const source = { ...node(), start() {}, stop() { throw new Error('already stopped'); } }; sources.push(source); return source; }
    },
    fetch: async () => new Response(new Uint8Array(4800), { headers: { 'content-type': 'audio/pcm', 'x-sample-rate': '24000' } }),
  });
  vm.runInContext(source + '\nthis.audio = createAudio();', sandbox);
  const audio = sandbox.audio;
  for (const action of ['stop', 'suspended', 'interrupted']) {
    audio.context.state = 'running';
    const result = await audio.say(action);
    clock = result.startAt * 1000 + 10;
    assert.equal(audio.speaking(), true);
    if (action === 'stop') audio.stop();
    else { audio.context.state = action; audio.context.statechange(); }
    assert.equal(audio.speaking(), false);
    assert.equal(audio.currentLine, '');
    assert.equal(sources.at(-1).disconnected, true);
    // stop() settles quietly; a suspended/interrupted context rejects so main.js clears the caption (no silent "success").
    if (action === 'stop') await result.done; else await assert.rejects(result.done, /audio_interrupted/);
  }
  audio.context.state = 'suspended'; await assert.rejects(audio.say('late'), /audio_not_running/);
});

test('filler manifest covers seven categories with ten distinct clips each',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../web/assets/fillers/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(),['acknowledging','amused','curious','excited','surprised','sympathetic','thinking'].map(k=>'filler_'+k));
  const bytes=[];
  for(const files of Object.values(manifest)) {
    assert.equal(files.length,10);
    for(const file of files) {const clip=await readFile(new URL('../web/assets/fillers/'+file,import.meta.url));assert.ok(clip.length>100);assert.ok(!bytes.some(x=>x.equals(clip)));bytes.push(clip);}
  }
});
test('filler history forbids last 20, yields within 60ms, stop is immediate',async()=>{
  let clock=1000;const picked=[],sources=[],events=[];
  const node=()=>({connect(){return this;},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}});
  const sandbox=vm.createContext({performance:{now:()=>clock},AbortController,DOMException,URL,location:{href:'http://localhost/'},
    AudioContext:class {
      get currentTime(){return clock/1000;}state='running';destination={};addEventListener(){}createGain=node;createAnalyser=node;
      async decodeAudioData(bytes){return {duration:.5,url:new TextDecoder().decode(bytes)};}
      createBuffer(_c,n,rate){return {duration:n/rate,copyToChannel(){}};}
      createBufferSource(){const s={...node(),start(at){this.at=at;picked.push(this.buffer.url);},stop(at){this.stopped=at;}};sources.push(s);return s;}
    },
    fetch:async(url)=>url.href?.endsWith('manifest.json')?Response.json({filler_thinking:Array.from({length:10},(_,i)=>`a${i}.mp3`),filler_curious:Array.from({length:10},(_,i)=>`b${i}.mp3`),filler_amused:Array.from({length:10},(_,i)=>`c${i}.mp3`)}):url==='/api/say'?new Response(new Uint8Array(4800),{headers:{'content-type':'audio/pcm','x-sample-rate':'24000'}}):new Response(String(url)),
  });
  sandbox.events=events;
  vm.runInContext(source+'\nthis.audio=createAudio({random:()=>.3,event:(type,data)=>events.push({type,...data})});',sandbox);const audio=sandbox.audio;
  await audio.loadClips('/manifest.json');
  for(let i=0;i<10;i++)await audio.playClip('filler_thinking');
  assert.equal(await audio.playClip('filler_thinking'),null);
  for(let i=0;i<10;i++)await audio.playClip('filler_curious');
  for(let i=0;i<10;i++)await audio.playClip('filler_amused');
  for(let i=0;i<picked.length;i++)assert.ok(!picked.slice(Math.max(0,i-20),i).includes(picked[i]));
  const filler=await audio.playClip('filler_thinking');
  const words=await audio.say('hello');
  assert.ok(words.startAt<await filler.endAt,'words never wait for natural filler end');
  assert.ok(words.startAt<=1.080001,'first PCM adds at most 60ms plus scheduling pad');
  assert.equal(sources.at(-2).stopped,words.startAt,'no filler/words overlap');
  assert.ok(events.length>0 && events.every(e=>e.type==='filler_yield'&&e.fadeMs<=60.0001));
  clock=1050;assert.equal(audio.speaking(),true);audio.stop();
  assert.equal(sources.at(-2).stopped,clock/1000);await filler.done;await words.done;
});
