import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG} from '../web/perform/emoji.js';
import {DECISION_PROMPT,decisionRequest,parseDecision} from '../server/decision.mjs';
test('one DeepSeek strict fallback covers all 64 labels plus null, no model override',()=>{
  const r=decisionRequest({text:'Hola',history:[]});
  assert.equal(r.model,'deepseek/deepseek-v4.1-flash');assert.equal(r.temperature,1);assert.equal(r.stream,true);assert.equal(r.store,undefined);assert.equal(r.service_tier,undefined);assert.deepEqual(r.reasoning,{enabled:false});assert.deepEqual(r.provider,{order:['wafer/us','together','parasail/fp8'],allow_fallbacks:true,sort:'latency'});
  assert.deepEqual(r.response_format.json_schema.schema.properties.animation.enum,[...Object.keys(CATALOG),null]);assert.equal(r.response_format.json_schema.strict,true);
  assert.deepEqual(JSON.parse(r.messages[1].content),{text:'Hola',history:[]});
  for(const [k,v]of Object.entries(CATALOG))assert.ok(DECISION_PROMPT.includes(`${k} ${v.name_es}/${v.name_en}`));
});
test('strict fallback independently parses animation/gaze/hop/voice, rejects sequences',()=>{
  for(const voice of ['none','sound','words'])for(const animation of [null,'👋'])assert.deepEqual(parseDecision(JSON.stringify({animation,gaze:'viewer',hop:'left',voice})),{emoji:animation,gaze:'viewer',hop:'left',voice});
  for(const value of [null,[],{}, {animation:'unknown',voice:'words'},{animation:'👋🏽',voice:'words'},{animation:null,voice:'invalid'},{animation:'🙂',voice:'words',extra:'😉'}])assert.deepEqual(parseDecision(JSON.stringify(value)),{emoji:null,gaze:null,hop:'none',voice:'none',invalid:true});
});
