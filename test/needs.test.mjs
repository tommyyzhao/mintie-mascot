import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNeeds} from '../web/needs.js';
import {validRequest,lineRequest} from '../server/server.mjs';
import {jevRequest} from '../server/jev.mjs';
import {simulate} from './support/needs-sim.mjs';

test('needs determinism, events, bounds and scripted hop exclusion',()=>{
  const run=()=>{const n=createNeeds({seed:42}),out=[];for(let t=0;t<=600000;t+=1000){if(t===20000)n.event('poke',t);if(t===40000)n.event('throw',t);out.push([n.update(t,{scripted:true}),n.mood()]);}return out;};
  assert.deepEqual(run(),run()); assert.ok(run().every(([choice,m])=>choice?.kind!=='hop'&&Object.values(m).every(v=>v>=0&&v<=1)));
  const n=createNeeds();const before=n.mood();n.event('poke',0);assert.ok(n.mood().play>before.play);n.event('throw',0);assert.equal(n.mood().play,0);assert.equal(n.update(8000)?.mode,'away');
});
test('canonical utilities and rolling hop cap',()=>{
  const wary=createNeeds();wary.event('throw',0);assert.deepEqual(wary.update(8000),{kind:'look',mode:'away'});
  const playful=createNeeds();playful.event('poke',0);playful.event('poke',0);assert.equal(playful.update(8000).micro,'wiggle');
  const social=createNeeds({initial:{social:.8}});social.update(31000,{busy:true});assert.equal(social.update(32000).kind,'social');
  const tired=createNeeds({initial:{energy:.1}});assert.notEqual(tired.update(8000).kind,'drowsy');assert.equal(tired.update(40000).kind,'drowsy');
  const active=createNeeds({initial:{energy:.1}});active.event('userSpeech',39000);assert.notEqual(active.update(40000).kind,'drowsy');
  const capped=createNeeds({initial:{curiosity:1}});capped.hopped(0);capped.hopped(1);
  for(let t=8000;t<60000;t+=1000)assert.notEqual(capped.update(t)?.kind,'hop');
});
test('seeded 10-minute timeline meets awake idle gap, action reduction and hop targets',()=>{
  const needs=simulate();
  assert.deepEqual(needs,simulate(),'seed 42 is deterministic');
  const total=(run,kind)=>run.minutes.reduce((sum,m)=>sum+m[kind],0);
  assert.ok(needs.longestEligibleStillness<=25000,JSON.stringify(needs));
  const micro=total(needs,'micro')+total(needs,'look')+total(needs,'social');
  assert.ok(micro<=84*.6,`${micro} visible micro-behaviors must be ≥40% below 84`);
  assert.ok(needs.minutes.every(m=>m.hop<=2),'≤2 hops/minute');
  assert.ok(needs.longestStillness>needs.longestEligibleStillness,'conversation suppression excluded only from eligible gap');
});
test('eligible gaps exclude user/Mintie speech, held and drowsy intervals, including suppressed tails',()=>{
  for(const kind of ['userSpeech','mintieSpeech','held']) {
    const run=simulate({stateAt:t=>({[kind]:t>=100000})});
    assert.ok(run.longestStillness>=500000,kind);
    assert.ok(run.longestEligibleStillness<=25000,kind);
  }
  const sleepy=simulate({stateAt:()=>({held:true})});
  assert.equal(sleepy.longestStillness,600000);assert.equal(sleepy.longestEligibleStillness,0);
});
test('mood is strict data for both models',()=>{
  const mood={social:.2,curiosity:.4,energy:.8,play:.1},body={text:'hi',mood};
  assert.ok(validRequest('react',body));
  for(const bad of [{...mood,play:2},{...mood,play:-1},{...mood,play:null},{...mood,extra:1},{social:0}])assert.ok(!validRequest('react',{...body,mood:bad}));
  assert.deepEqual(jevRequest(body).state.mood,mood);assert.match(jevRequest(body).questions.animation.instructions,/explicit commands win/);
  assert.deepEqual(JSON.parse(lineRequest(null,body).messages[1].content).mood,mood);
  assert.ok(validRequest('react',{text:'hi'}));
});
