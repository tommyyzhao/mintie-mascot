import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG,FX_KINDS,ACCESSORIES} from '../web/perform/emoji.js';
import {createPerformer} from '../web/perform/engine.js';
import {FACE_YAW} from '../web/character/view.js';

function valid(p) {
  const range=(x,min=0,max=1)=>assert.ok(Number.isFinite(x)&&x>=min-1e-10&&x<=max+1e-10,`${x} outside ${min}..${max}`);
  range(p.body.squash,-0.5,0.5);p.body.lean.forEach(x=>range(x,-0.5,0.5));
  p.body.offset.forEach((x,i)=>range(x,i===1?0:-0.5,i===1?1:0.5));
  assert.ok(Number.isFinite(p.body.twist));range(p.body.wobble);range(p.body.puff,-0.3,0.4);
  for (const k of ['openL','openR']) range(p.eyes[k],0,1.4);
  for (const k of ['smileL','smileR']) range(p.eyes[k]);
  range(p.eyes.frown,-1,1);range(p.eyes.pupil,0.6,1.5);p.eyes.gaze.forEach(x=>range(x,-1,1));
  assert.ok(['none','heart','star','spiral','cross','tear','money'].includes(p.eyes.icon));
  range(p.mouth.open);range(p.mouth.smile,-1,1);range(p.mouth.width);
  assert.ok(['none','smile','o','laugh','frown','wobble','flat','tongue','kiss','teeth','cat','zip'].includes(p.mouth.shape));
  range(p.cheeks.blush);assert.ok(p.buds.length<=2);
  assert.equal(new Set(p.buds.map(x=>x.side)).size,p.buds.length);
  for (const b of p.buds) {
    assert.ok(['L','R'].includes(b.side));
    for (const k of ['height','reach','bulge']) range(b[k]);
    assert.equal(b.dir.length,3);b.dir.forEach(x=>range(x,-1,1));
    assert.ok(Math.abs(Math.hypot(...b.dir)-1)<1e-8);
    assert.deepEqual(Object.keys(b).sort(),['side','dir','height','reach','contact','bulge'].sort());
    assert.ok(['none','mouth','chin','brow','eye','ear','cheek','chest','other'].includes(b.contact));
  }
  assert.deepEqual(Object.keys(p).sort(),['body','buds','cheeks','eyes','fx','mouth','accessory','tint'].sort());
  assert.ok(p.fx.length<=3);for (const f of p.fx) {assert.ok(FX_KINDS.includes(f.kind));range(f.intensity);}
  assert.ok(['none','red','blue','pale','pink','gold'].includes(p.tint.kind));range(p.tint.amount);
  assert.ok(ACCESSORIES.includes(p.accessory));
}

test('new moves keep hop translation in physics and a complete spin in the pose',()=>{
  for (const emoji of ['🙂‍↕️','🙂‍↔️','🦘','🤸']) {
    const p=createPerformer(),r=p.play(emoji),frames=[];
    for(let t=0;t<r.durationMs;t+=20) frames.push(p.update(t));
    if(emoji==='🦘') { assert.ok(frames.every(x=>x.body.offset[1]===0));assert.ok(Math.max(...frames.map(x=>x.body.squash))>.1); }
    if(emoji==='🤸') assert.ok(Math.max(...frames.map(x=>x.body.twist))>=Math.PI*2-FACE_YAW);
    if(emoji==='🙂‍↕️') {assert.ok(frames.every(x=>x.body.offset[1]===0));assert.ok(Math.max(...frames.map(x=>x.body.lean[1]))>=0.34);assert.ok(Math.max(...frames.map(x=>x.body.squash))>=0.35);const dips=frames.filter((x,i)=>i>0&&i<frames.length-1&&x.body.lean[1]>0.1&&x.body.lean[1]>frames[i-1].body.lean[1]&&x.body.lean[1]>frames[i+1].body.lean[1]);assert.ok(dips.length>=2&&dips.length<=3);}
    if(emoji==='🙂‍↔️') {assert.ok(Math.max(...frames.map(x=>x.body.twist))-frames[0].body.twist>=0.35);assert.ok(Math.min(...frames.map(x=>x.body.twist))-frames[0].body.twist<=-0.35);}
  }
  const s=createPerformer();assert.equal(s.update(0,{speaking:0.001}).mouth.shape,'o');assert.equal(s.update(1).mouth.shape,'none');
  for (const emoji of '🙈 👋 👍 👎 👏 🤝 🙏 💪 🙅 🤷 🤦 🧏 🤏 ✌️ 🤞 🤙 👉 🫡 ❤️ 💔 🔥 💡 💃 🙉 😴 😌 😎 🙂 😉 🤨 🙄 😐 😞 😟 😠 🥺 😳'.split(' ')) {
    const e=createPerformer();e.play(emoji);assert.equal(e.update(600).mouth.shape,'none',emoji);assert.equal(e.update(601,{speaking:0.5}).mouth.shape,'o',emoji);
  }
});
test('all catalog performances: finite C1 pose, complete release, near-idle',()=>{
  for (const emoji of Object.keys(CATALOG)) {
    const engine=createPerformer({seed:23}), idle=createPerformer({seed:23});
    const {durationMs,anticipationMs}=engine.play(emoji);
    assert.ok(anticipationMs>0&&anticipationMs<durationMs);
    for (let t=0;t<=durationMs+500;t+=1000/60) {
      const pose=engine.update(t),rest=idle.update(t);
      try {valid(pose);} catch(e) {throw new Error(`${emoji} at ${t}: ${e.message}`,{cause:e});}
      if (t>=durationMs) {
        assert.equal(engine.active(),null,emoji);
        assert.deepEqual(pose,rest,`${emoji} did not settle`);
      }
    }
  }
});
test('world-aware look modes track orbited viewers, target self-relative points, expire and clear',()=>{
  const viewer=[6,1.2,Math.sqrt(12)],self=[0,0,0];
  const settle=(p,inputs,start=0,end=1200)=>{let pose;for(let t=start;t<=end;t+=20)pose=p.update(t,inputs);return pose;};
  const p=createPerformer();p.look('viewer');let pose=settle(p,{viewer,self});valid(pose);
  assert.ok(Math.abs(pose.body.twist-(Math.PI/3-FACE_YAW))<.015,'body yaws so the FACE points at the viewer');assert.ok(Math.abs(pose.eyes.gaze[0])<.03);
  p.look('away');pose=settle(p,{viewer,self},1220,2400);assert.ok(pose.body.twist>Math.PI/3-FACE_YAW+.7);assert.ok(pose.eyes.gaze[0]>.85);
  p.look('down');pose=settle(p,{viewer,self},2420,3600);assert.ok(pose.eyes.gaze[1]<-.85);
  p.look('up');pose=settle(p,{viewer,self},3620,4800);assert.ok(pose.eyes.gaze[1]>.85);
  p.look('touch',{target:[2,0,2]});pose=settle(p,{viewer,self:[2,0,0]},4820,6000);assert.ok(Math.abs(pose.body.twist+FACE_YAW)<.02);assert.ok(pose.eyes.gaze[1]<-.4);
  p.look(null);pose=settle(p,{viewer,self},6020,7200);assert.ok(Math.abs(pose.eyes.gaze[1])<.5);
  const expiry=createPerformer();expiry.look('down',{durationMs:400});pose=settle(expiry,{},0,1400);assert.ok(pose.eyes.gaze[1]>-.5);
  const listening=createPerformer();pose=settle(listening,{viewer,self,listening:true});assert.ok(Math.abs(pose.body.twist-(Math.PI/3-FACE_YAW))<.015);
  const speaking=createPerformer();pose=settle(speaking,{viewer,self,talking:true,speaking:.2});assert.ok(Math.abs(pose.body.twist-(Math.PI/3-FACE_YAW))<.015);
  for(const [mode,opts]of [['bad',{}],['touch',{}],['touch',{target:[NaN,0,0]}],['viewer',{durationMs:-1}]])assert.throws(()=>p.look(mode,opts),RangeError);
});

test('all catalog performances reduced: no hop, no spin; buds retain gesture reach',()=>{
  for (const emoji of Object.keys(CATALOG)) {
    const engine=createPerformer({seed:3});
    const {durationMs}=engine.play(emoji);
    for (let t=0;t<=durationMs+500;t+=1000/60) {
      const p=engine.update(t,{reducedMotion:true});valid(p);
      assert.equal(p.body.offset[1],0,emoji);assert.equal(p.body.twist,0);
    }
  }
  const a=createPerformer(),b=createPerformer();a.play('👋');b.play('👋');
  assert.equal(a.update(600).buds[0].reach,b.update(600,{reducedMotion:true}).buds[0].reach);
});
test('determinism: same seed, time, interruption, cancellation and inputs',()=>{
  const a=createPerformer({seed:'girasol'}),b=createPerformer({seed:'girasol'});
  let owned;
  for (let i=0;i<1500;i++) {
    const t=i*1000/60;
    if (i%93===0) {const e=Object.keys(CATALOG)[(i*7)%Object.keys(CATALOG).length];assert.deepEqual(a.play(e),owned=b.play(e));}
    if (i%147===0&&owned) assert.equal(a.cancel(owned.id),b.cancel(owned.id));
    const inputs={listening:i%71<30,speaking:i%41<10?0.6:0,gaze:i%19<8?[0.6,-0.3]:null,reducedMotion:i%131<22};
    assert.deepEqual(a.update(t,inputs),b.update(t,inputs));assert.deepEqual(a.active(),b.active());
  }
  assert.notDeepEqual(createPerformer({seed:1}).update(0),createPerformer({seed:2}).update(0));
});
test('120ms newest-wins blend keeps squash, lean and bud reach continuous',()=>{
  const keys=Object.keys(CATALOG),dt=1000/60;
  for (let i=0;i<keys.length;i++) {
    const engine=createPerformer({seed:8});engine.play(keys[i]);
    let before=engine.update(600);
    const newest=engine.play(keys[(i+83)%keys.length]);
    assert.equal(engine.active().id,newest.id);
    for (let t=600;t<850;t+=dt) {
      const after=engine.update(t);
      assert.ok(Math.abs(after.body.squash-before.body.squash)<0.16,`${keys[i]} squash`);
      for (let j=0;j<2;j++) assert.ok(Math.abs(after.body.lean[j]-before.body.lean[j])<0.17,`${keys[i]} lean`);
      for (const side of ['L','R']) {
        const reach=p=>p.buds.find(x=>x.side===side)?.reach??0;
        assert.ok(Math.abs(reach(after)-reach(before))<0.25,`${keys[i]} reach`);
      }
      before=after;
    }
  }
});
test('anticipation, nub growth, direction waggle, melt and cancellation ownership',()=>{
  const engine=createPerformer(),{id}=engine.play('👋');
  const anticipation=engine.update(90);assert.ok(anticipation.eyes.openL<1);assert.equal(anticipation.buds.length,0);
  const growing=engine.update(200).buds[0];assert.ok(growing.reach<0.6);assert.ok(growing.dir[1]>0);
  const full=engine.update(700).buds[0];assert.ok(full.reach>0.8);assert.ok(full.dir[1]>.7);assert.notDeepEqual(full.dir,growing.dir);
  const melting=engine.update(1800).buds[0];assert.ok(melting.reach<0.3);
  const second=engine.play('😂');assert.equal(engine.cancel(id),false);assert.equal(engine.active().id,second.id);
  assert.equal(engine.cancel(second.id),true);assert.equal(engine.cancel(second.id),false);
  engine.update(2200);assert.equal(engine.active(),null);
});
test('mouth audio ownership, pointer priority, dictated gaze, listening attention',()=>{
  const a=createPerformer(),b=createPerformer();a.play('😭');b.play('😭');
  for (const t of [0,100,500,1400,1900]) {
    const spoken=a.update(t,{speaking:0.73}),silent=b.update(t);
    // Voice aperture tracks energy independently of the recipe.
    assert.equal(spoken.mouth.open,0.73);assert.equal(spoken.mouth.shape,'o');
    assert.equal(spoken.mouth.width,0.45+0.73*0.45);
  }
  const e=createPerformer();assert.deepEqual(e.update(0,{gaze:[0.8,-0.8]}).eyes.gaze,[0.8,-0.8]);
  e.play('🙄');assert.ok(e.update(600,{gaze:[0,-1]}).eyes.gaze[1]>0.9);
  e.play('😊');assert.deepEqual(e.update(1200,{gaze:[0.8,-0.8]}).eyes.gaze,[0.8,-0.8]);
  const resting=createPerformer({seed:2}),listening=createPerformer({seed:2});resting.update(0);listening.update(0);
  listening.update(800,{listening:true});
  const rest=resting.update(1000),listen=listening.update(1000,{listening:true});
  assert.ok(listen.eyes.openL>rest.eyes.openL);assert.ok(Math.abs(listen.eyes.gaze[0])<Math.abs(rest.eyes.gaze[0]));
});
test('idle subtle motion, natural single/double blinks, output not aliased',()=>{
  const e=createPerformer({seed:7});let closed=0,frames=0;
  for (let t=0;t<40000;t+=1000/60) {
    const p=e.update(t);assert.ok(Math.abs(p.body.squash)<=0.055);
    assert.equal(p.buds.length,0);assert.equal(p.mouth.shape,'none');
    if (p.eyes.openL<0.1) closed++;frames++;
  }
  assert.ok(closed>10&&closed/frames<0.1);
  for (const emoji of ['👋','🤫','🤔']) {
    const growing=createPerformer();growing.play(emoji);
    for (let t=180;t<500;t+=5) {
      const p=growing.update(t);valid(p);assert.ok(p.buds.every(b=>b.reach>0));
    }
  }
  const first=e.update(60000);first.body.lean[0]=999;first.eyes.gaze[0]=999;
  e.play('👋');valid(e.update(60000));
});
test('needs-selected micros retain six gestures and no autonomous timer',()=>{
  const kinds=['look','wiggle','bud-wave','hum-sway','stretch','double-blink'];
  for(const kind of kinds) {
    const a=createPerformer({seed:1}),b=createPerformer({seed:1});
    a.update(0);b.update(0);a.micro(kind);
    let changed=false;
    for(let t=10;t<=1600;t+=10){const p=a.update(t),q=b.update(t);valid(p);if(JSON.stringify(p)!==JSON.stringify(q))changed=true;}
    assert.ok(changed,kind);
  }
});
test('idle gestures never run during a performance, cancellation, or its 2s cooldown',()=>{
  for (const cancel of [false,true]) {
    const a=createPerformer({seed:1}),base=createPerformer({seed:1});
    for (let t=0;t<5400;t+=10) {a.update(t);base.update(t,{speaking:0.021});}
    const run=a.play('👋',{nowMs:5400});base.play('👋',{nowMs:5400});
    const end=cancel?6350:5400+run.durationMs;
    for (let t=5400;t<=end+2000;t+=10) {
      if (cancel&&t===6000) {a.cancel(run.id);base.cancel(run.id);}
      const p=a.update(t),q=base.update(t,{speaking:0.021});
      // The existing newest-wins 120ms blend may carry the incoming idle pose, never its timeline.
      if (t<5520) continue;
      assert.deepEqual(p.body,q.body,`body at ${t}`);assert.deepEqual({...p.eyes,gaze:[]},{...q.eyes,gaze:[]},`eyes at ${t}`); // Speech now aims at the viewer.
    }
  }
});
test('needs controls drowsy pose; inactivity never sleeps independently',()=>{
  const e=createPerformer();e.update(0);
  const awake=e.update(75000);assert.deepEqual(awake.fx,[]);assert.equal(awake.mouth.shape,'none');
  const drowsy=e.update(80000,{needsDrowsy:true});assert.ok(drowsy.eyes.openL<=.571);assert.ok(drowsy.eyes.gaze[1]<0);
  assert.equal(drowsy.body.offset[1],0);assert.deepEqual(drowsy.fx,[]);
});
test('every activity wakes with a 300ms startle; static pointer and sub-threshold audio do not',()=>{
  for (const kind of ['play','gaze','listening','speaking']) {
    const e=createPerformer();e.update(0);e.update(75000);assert.equal(e.state(),'asleep');
    const inputs=kind==='gaze'?{gaze:[0.1,0.2]}:kind==='listening'?{listening:true}:kind==='speaking'?{speaking:0.03}:{};
    if (kind==='play') {const {id}=e.play('🙂',{nowMs:75000});e.cancel(id);}
    e.update(75000,inputs);assert.equal(e.state(),'awake');
    // A performance owns their pose above the wake layer; the other triggers reveal it directly.
    if (kind!=='play') {
      const wake=e.update(75150,inputs);assert.ok(wake.eyes.openL>=1.19);assert.ok(wake.body.offset[1]>0.024);
      assert.ok(wake.body.puff>0.04);assert.deepEqual(wake.fx,[]);
      assert.equal(e.update(75300,inputs).body.offset[1],0);
    }
  }
  const e=createPerformer();e.update(0,{gaze:[0.1,0.1]});
  for (let t=1000;t<=75000;t+=1000) e.update(t,{gaze:[0.11,0.11],speaking:0.02});
  assert.equal(e.state(),'asleep');
  e.update(75001,{gaze:[0.14,0.1]});assert.equal(e.state(),'awake');
  e.update(115001);assert.equal(e.state(),'drowsy');
  e.update(115002,{listening:true});assert.equal(e.state(),'awake');
  e.update(155002);assert.equal(e.state(),'drowsy');
  e.update(155003,{gaze:[0,0]});assert.equal(e.state(),'awake');
});
test('reduced motion scales idle, listening, sleep and wake by 0.35, never hops',()=>{
  const a=createPerformer({seed:11}),b=createPerformer({seed:11});
  for (let t=0;t<=80000;t+=20) {
    const inputs=t>=76000?{listening:true}:{};
    const p=a.update(t,inputs),q=b.update(t,{...inputs,reducedMotion:true});valid(q);
    for (const key of ['squash','puff','wobble']) assert.ok(Math.abs(q.body[key]-p.body[key]*0.35)<1e-10,key);
    p.body.lean.forEach((v,i)=>assert.ok(Math.abs(q.body.lean[i]-v*0.35)<1e-10));
    assert.equal(q.body.offset[1],0);assert.equal(q.body.twist,0);
  }
});
test('listening has steady forward attention, slow blinks, pause-driven nods, occasional tiny tilts',()=>{
  const a=createPerformer({seed:13}),base=createPerformer({seed:13});
  let min=1,max=-1,tilt=0;const peaks=[];let prior=0,before=0;
  for (let t=0;t<16000;t+=10) {
    const p=a.update(t,{listening:true,pauseAt:Math.floor(t/1500)*1500}),q=base.update(t,{speaking:0.021});
    if (t<1000) continue;
    const nod=p.body.lean[1];min=Math.min(min,nod);max=Math.max(max,nod);
    tilt=Math.max(tilt,Math.abs(p.body.lean[0]-q.body.lean[0]));
    assert.ok(Math.hypot(...p.eyes.gaze)<.001); // Default viewer is directly ahead; both speech/listening face it.
    assert.ok(p.eyes.smileL>=0.0999);
    if (prior>before&&prior>nod) peaks.push(t-10);before=prior;prior=nod;
  }
  assert.ok(max-min>0.044);assert.ok(tilt>0.024&&tilt<=0.025);assert.ok(peaks.length>8);
  for (let i=1;i<peaks.length;i++) assert.ok(peaks[i]-peaks[i-1]>=1100&&peaks[i]-peaks[i-1]<=1600);
  assert.equal(a.state(),'awake');
});
test('update mean cost stays below 0.01ms in Node',()=>{
  const e=createPerformer({seed:5}),inputs={};let t=0;
  for (let i=0;i<10000;i++) e.update(t+=16.67,inputs);
  const count=100000,start=performance.now();
  for (let i=0;i<count;i++) {
    inputs.listening=i%20000<10000;
    if (i%10000===0) e.play('🙂');
    e.update(t+=16.67,inputs);
  }
  const mean=(performance.now()-start)/count;console.log(`performer update mean: ${mean.toFixed(5)} ms`);
  assert.ok(mean<=0.01,`${mean} ms/update`);
});
test('touch reflex skips anticipation; face and body attack within 100ms, blend/release/buds preserved',()=>{
  for (const value of ['😂',{...CATALOG['😂'].recipe,anticipationMs:0,durationMs:700}]) {
    const e=createPerformer({seed:4}),idle=createPerformer({seed:4});e.update(0);idle.update(0);
    const run=e.play(value,{reflex:true});assert.equal(run.anticipationMs,0);assert.equal(e.active().anticipationMs,0);
    assert.deepEqual(e.update(0),idle.update(0),'existing pose blends in at admission');
    const first=e.update(16),rest=idle.update(16);
    assert.notEqual(first.eyes.openL,rest.eyes.openL);assert.notEqual(first.body.squash,rest.body.squash);
    const face=e.update(100),plain=idle.update(100);
    assert.ok(Math.abs(face.eyes.openL-plain.eyes.openL)>0.2);assert.ok(face.mouth.open>0.2);
    for (let t=120;t<=run.durationMs;t+=20) valid(e.update(t));
    e.update(run.durationMs);assert.equal(e.active(),null);
  }
  const hand=createPerformer();hand.update(0);hand.play('👋',{reflex:true});
  assert.ok(hand.update(100).buds[0].reach>0);assert.ok(hand.update(600).buds[0].reach>0.8);
  const e=createPerformer();e.update(0);e.update(75000);assert.equal(e.state(),'asleep');
  const recipe={...CATALOG['😂'].recipe,anticipationMs:0,durationMs:700},saved={...recipe};
  assert.throws(()=>e.play(recipe));assert.equal(e.state(),'asleep');
  e.play(recipe,{reflex:true});assert.equal(e.state(),'awake');assert.deepEqual(recipe,saved);
  for (const anticipationMs of [-1,NaN,Infinity,351]) {
    const id=e.active().id;assert.throws(()=>e.play({...recipe,anticipationMs},{reflex:true}));assert.equal(e.active().id,id);
  }
  for (const durationMs of [699,NaN,Infinity,6001]) assert.throws(()=>e.play({...recipe,durationMs},{reflex:true}));
  for (const anticipationMs of [0,20,79,80,350]) {
    assert.equal(e.play({...recipe,anticipationMs,durationMs:1050},{reflex:true}).anticipationMs,0);
  }
  assert.equal(e.play('😂').anticipationMs,CATALOG['😂'].recipe.anticipationMs);
});
test('speech onsets add subtle beats, refractory 300ms, reduced motion zero; no stuck pulse',()=>{
  const beat=createPerformer({seed:9}),base=createPerformer({seed:9});beat.play('👋');base.play('👋');
  for (let t=0;t<600;t+=10) {beat.update(t);base.update(t);}
  beat.update(600,{speaking:.6});base.update(600,{speaking:.021});
  const p=beat.update(730,{speaking:.6}),q=base.update(730,{speaking:.021});
  assert.ok(Math.abs(p.body.lean[1]-q.body.lean[1]-.04)<1e-10);
  assert.ok(Math.abs(p.body.squash-q.body.squash-.03)<1e-10);
  assert.deepEqual(p.buds,q.buds);assert.ok(p.mouth.open>=.6);
  beat.update(740);base.update(740,{speaking:.021});
  beat.update(800,{speaking:.6});base.update(800,{speaking:.021});
  assert.deepEqual(beat.update(890,{speaking:.6}).body,base.update(890,{speaking:.021}).body,'refractory ignores second rise');
  beat.update(900);base.update(900,{speaking:.021});
  beat.update(920,{speaking:.6});base.update(920,{speaking:.021});
  assert.ok(beat.update(1050,{speaking:.6}).body.lean[1]>base.update(1050,{speaking:.021}).body.lean[1]+.039);
  const a=createPerformer(),b=createPerformer();
  a.update(0,{speaking:.6,reducedMotion:true});b.update(0,{speaking:.021,reducedMotion:true});
  assert.deepEqual(a.update(130,{speaking:.6,reducedMotion:true}).body,b.update(130,{speaking:.021,reducedMotion:true}).body);
});
test('thinking layers gaze, alternating tilt, blink, slow sway; never hands; lasts until speech',()=>{
  const a=createPerformer(),b=createPerformer();a.play('💪');b.play('💪');
  a.update(0,{thinking:true});b.update(0);
  const blink=a.update(130,{thinking:true}),plain=b.update(130);assert.ok(blink.eyes.openL<plain.eyes.openL*.3);
  const p=a.update(500,{thinking:true}),q=b.update(500);
  assert.deepEqual(p.buds,q.buds);assert.deepEqual(p.mouth,q.mouth);
  assert.ok(p.eyes.gaze[0]>.8&&p.eyes.gaze[1]>.7);assert.ok(p.body.lean[0]>q.body.lean[0]+.07);
  for(let t=600;t<=2600;t+=100){a.update(t,{thinking:true});b.update(t);}
  assert.ok(a.update(2700,{thinking:true}).eyes.gaze[1]>.7);
  const release=a.update(2800,{speaking:.5});assert.ok(release.eyes.gaze[0]<p.eyes.gaze[0]);
  a.update(3200);a.update(3300,{thinking:true});assert.ok(a.update(3800,{thinking:true}).eyes.gaze[0]<-.8);
});
test('sustain softens the latest pose until audio ends, beats/mouth additive, smooth recovery, 6s cap',()=>{
  let pending=true;const a=createPerformer(),b=createPerformer();
  const run=a.play('👋',{sustainUntil:()=>pending});b.play('👋',{sustainUntil:()=>pending});
  for(let t=0;t<=3000;t+=20){a.update(t);b.update(t);}
  const hold=a.update(3200),base=b.update(3200);assert.equal(a.active().id,run.id);
  assert.ok(hold.buds[0].reach>.5&&hold.buds[0].reach<.8);
  a.update(3300,{speaking:.6});b.update(3300);
  const beat=a.update(3430,{speaking:.6}),quiet=b.update(3430);
  assert.ok(beat.body.lean[1]>quiet.body.lean[1]+.039);assert.ok(beat.mouth.open>=.6);assert.deepEqual(beat.buds,quiet.buds);
  pending=false;const release=a.update(3450);assert.equal(a.active().cancelling,true);
  assert.ok(Math.abs(release.buds[0].reach-base.buds[0].reach)<.05);a.update(3800);assert.equal(a.active(),null);
  const cap=createPerformer();cap.play('🎉',{sustainUntil:()=>true});
  for(let t=0;t<=6000;t+=20) valid(cap.update(t));assert.equal(cap.active().cancelling,true);
  cap.update(6350);assert.equal(cap.active(),null);
});
test('closed-mouth catalog cues never suppress the speaking mouth',()=>{
  const e=createPerformer();e.play({mouth:'zip',face:'flat',body:'still'});const p=e.update(500,{speaking:.7});
  assert.equal(p.mouth.shape,'o');assert.ok(p.mouth.open>=.7);
});
test('listening stop releases forward lean without a snap',()=>{
  const a=createPerformer(),b=createPerformer();
  for(let t=0;t<=1000;t+=10){a.update(t,{listening:true});b.update(t);}
  const p=a.update(1010),q=b.update(1010);assert.ok(p.body.lean[1]>.025);
  a.update(1250);b.update(1250);const settled=a.update(1500),idle=b.update(1500);
  assert.ok(settled.body.lean[1]<p.body.lean[1]*.2);assert.ok(Math.abs(settled.body.lean[1]-idle.body.lean[1])<.006);
});
test('invalid recipe cannot preempt; clock callback, explicit time, hostile numbers bounded',()=>{
  let clock=1000;const e=createPerformer({now:()=>clock});
  const a=e.play('👋');assert.equal(e.active().startMs,1000);
  assert.throws(()=>e.play({body:'missing'}));assert.equal(e.active().id,a.id);
  clock=1200;e.play('😂');assert.equal(e.active().startMs,1200);
  e.play('🙂',{nowMs:1400});assert.equal(e.active().startMs,1400);
  for (const t of [NaN,Infinity,-100,1500,1499]) valid(e.update(t,{gaze:[NaN,Infinity],speaking:NaN}));
  assert.throws(()=>e.play('🙂',{nowMs:NaN}));assert.throws(()=>createPerformer({now:1}));
});
test('performance-origin clocks and cancel before first update stay bounded',()=>{
  const e=createPerformer({now:()=>1000000000000});const a=e.play('👋');
  assert.equal(e.cancel(a.id),true);valid(e.update(1000000000000));
  e.update(1000000000500);assert.equal(e.active(),null);
  valid(e.update(1000000000000000));
  const f=createPerformer();f.play('😂',{nowMs:200});f.play('👋',{nowMs:400});
  valid(f.update(400));valid(f.update(500));
});
test('blink(): closes eyes now, then refractory 1.2 s; default schedule untouched when unused', () => {
  const p = createPerformer({ seed: 3 }); for (let at = 0; at <= 3000; at += 10) p.update(at);
  assert.equal(p.blink(3000), true); const closed = p.update(3075).eyes.openL; assert.ok(closed < .3, String(closed));
  assert.equal(p.blink(3500), false); assert.equal(p.blink(4300), true);
  // A sustained talking face blends idle eyes away; the cue blink must still close them.
  const s = createPerformer({ seed: 3 }); let at = 0; for (; at <= 3000; at += 16) s.update(at, { talking: true, speaking: .4 });
  s.play('🙂', { nowMs: at, sustainUntil: () => true }); for (; at <= 6000; at += 16) s.update(at, { talking: true, speaking: .4 });
  assert.equal(s.blink(at), true); assert.ok(s.update(at + 75, { talking: true, speaking: .4 }).eyes.openL < .3);
  // An open expression mouth always eases into speech over 60ms.
  {
    const m = createPerformer({ seed: 4 }); let at = 0; for (; at <= 2000; at += 16) m.update(at);
    m.play('😮', { nowMs: at, sustainUntil: () => true }); for (const end = at + 900; at < end; at += 16) m.update(at);
    const before = m.update(at).mouth.open; at += 16; const first = m.update(at, { talking: true, speaking: .1 }).mouth.open;
    assert.ok(first > .1 && first < before); at += 64; assert.equal(m.update(at, { talking: true, speaking: .1 }).mouth.open, .1);
  }
  // A hidden idle mouth is never blended: speech opens at once.
  { const m = createPerformer({ seed: 4 }); let at = 0; for (; at <= 2000; at += 16) m.update(at); assert.equal(m.update(at + 16, { talking: true, speaking: .3 }).mouth.open, .3); }
  // Cue blinks hide icon eyes (hearts/stars ignore the lid); tears stay.
  { const m = createPerformer({ seed: 4 }); let at = 0; for (; at <= 2000; at += 16) m.update(at); m.play('😍', { nowMs: at, sustainUntil: () => true }); for (const end = at + 900; at < end; at += 16) m.update(at);
    assert.notEqual(m.update(at).eyes.icon, 'none'); assert.equal(m.blink(at), true); assert.equal(m.update(at + 75).eyes.icon, 'none'); assert.notEqual(m.update(at + 200).eyes.icon, 'none'); }
  // Wrapped play (trace) is never called by a dry run.
  const w = createPerformer({ seed: 3 }); let calls = 0; const play = w.play; w.play = (...a) => { calls++; return play(...a); };
  w.update(0); assert.ok(w.predictStroke('✨', { nowMs: 16, thresholds: [.06,.06,.065,.08,.025,.025,.025,.12,.12] }) > 0); assert.equal(calls, 0);
  const a = createPerformer({ seed: 5 }), b = createPerformer({ seed: 5 });
  for (let at = 0; at <= 8000; at += 16) assert.deepEqual(a.update(at).eyes, b.update(at).eyes);
});
test('viewer awareness: eyes lead a damped body, pointer offset moves the gaze, saccades live, reduced motion stays calm',()=>{
  const self=[0,0,0],cam=[-3.8,2.9,5.4],run=(attend,reducedMotion=false,seed=3)=>{
    const p=createPerformer({seed});let pose,maxStep=0,prev=null;
    for(let t=0;t<=6000;t+=1000/60){pose=p.update(t,{viewer:cam,attend:t<3000?cam:attend,self,reducedMotion});valid(pose);
      if(t>3000&&prev)maxStep=Math.max(maxStep,Math.abs(pose.eyes.gaze[0]-prev));prev=pose.eyes.gaze[0];}
    return {pose,maxStep};};
  const centre=run(cam).pose,right=run([cam[0]+2.4*.84,cam[1],cam[2]+2.4*.55]).pose,left=run([cam[0]-2.4*.84,cam[1],cam[2]-2.4*.55]).pose;
  assert.ok(Math.abs(centre.eyes.gaze[0])<.12,'camera centre looks at the viewer');
  assert.ok(right.eyes.gaze[0]>centre.eyes.gaze[0]+.1&&left.eyes.gaze[0]<centre.eyes.gaze[0]-.1,'pointer offset moves the eyes the right way');
  assert.ok(Math.abs(right.body.twist-centre.body.twist)<Math.abs(right.eyes.gaze[0]-centre.eyes.gaze[0])*.65+.2,'body follows less than the eyes');
  assert.ok(run([cam[0]+2,cam[1]+1.5,cam[2]]).maxStep<.12,'a target jump glides: no one-frame gaze snap');
  // Saccades: the gaze keeps moving while the target is still.
  const p=createPerformer({seed:5});let lo=1,hi=-1;for(let t=0;t<30000;t+=1000/60){const g=p.update(t,{viewer:cam,attend:cam,self}).eyes.gaze;if(t>2000){lo=Math.min(lo,g[0]);hi=Math.max(hi,g[0]);}}
  assert.ok(hi-lo>.03,'micro-movements');assert.ok(hi-lo<.6,'but never wanders off');
  // Reduced motion: the body never turns, and eye motion is damped.
  const calm=createPerformer({seed:5});let twist=0;for(let t=0;t<6000;t+=1000/60)twist=Math.max(twist,Math.abs(calm.update(t,{viewer:cam,attend:cam,self,reducedMotion:true}).body.twist));
  assert.equal(twist,0);
  // No attend input: the legacy wandering idle gaze is unchanged (no awareness state leaks in).
  const a=createPerformer({seed:9}),b=createPerformer({seed:9});for(let t=0;t<4000;t+=50)assert.deepEqual(a.update(t,{viewer:cam,self}).eyes.gaze,b.update(t,{viewer:cam,self,attend:null}).eyes.gaze);
});
