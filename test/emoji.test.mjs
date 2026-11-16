import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG,EXCLUDED,PRIMITIVES,FAMILY_DEFAULTS,FX_KINDS,ACCESSORIES,resolveRecipe,canonical} from '../web/perform/emoji.js';
import {makeTrials} from '../web/playtest.js';

// Frozen pre-D-031 catalog: coverage must not disappear while selectable labels shrink.
const FORMER='😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😶‍🌫️ 😏 😒 🙄 😬 😮‍💨 🤥 🫨 🙂‍↔️ 🙂‍↕️ 😌 😔 😪 🤤 😴 🥱 🫩 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 ❤️‍🩹 💕 💖 💗 💘 💝 💞 💓 💟 ❣️ 💋 💌 💯 💢 💥 💫 💦 💨 💤 💬 💭 👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 🫷 🫸 🤌 🤏 ✌️ 🤞 🤟 🤙 👈 👉 👆 👇 ☝️ 👍 👎 🫹 🫺 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 💪 🦾 🙋 🙆 🙅 🤷 🤦 💁 🙇 🙍 🙎 🧏 ✨ 🎉 🎊 🔥 👀 🌻 🌸 ❓ ❗ ‼️ ⁉️ 🎵 🎶 ⭐ 🌟 💡 🏆 🎂 🍿 ☕ 👑 🍀 🌈 ☀️ 🌧️ ❄️ ⚡ 🎁 🫧 💃 🏃 🎈 🥂 💰 💸 🦋 🐰 🌙 🔴'.split(' ');
const NO_ANIMATION='👽 🤖 🤌 💨 🌻 🌸 🎂 🍿 ☕ 🍀 🌈 ☀️ 🌧️ ❄️ 🎁 🫧 🏃 🎈 💰 💸 🦋 🐰 🌙 🔴 🌹 🌺 🌷 💐 🌞 🍎 🍕 🍔 🍰 🧁 🧋 🍵 🏳️ 🏴 🏳️‍🌈 🏳️‍⚧️ 🇲🇽 🇪🇸 🇺🇸 🇧🇷'.split(' ');
const counts={
  0:'😅 😂 🙂 😉 😘 😋 😜 🤑 😐 🤨 😏 🙄 😌 😴 😷 🤢 🥵 🥶 😵‍💫 😎 😟 😮 😳 🥺 😭 😱 😞 😫 😠 💔 ✨ 🔥 👀 🙂‍↕️ 🙂‍↔️ 🦘 🤸',
  1:'🤫 🤔 🫡 🤧 👋 🤏 ✌️ 🤞 🤙 👉 👍 👎 💪 🤦 🧏 💡',
  2:'🤗 🙈 🙉 ❤️ 👏 🤝 🙏 🙅 🤷 🎉 💃',
};
test('catalog: fully-qualified intent labels, complete references, safe finite vocabulary',t=>{
  assert.equal(Object.keys(CATALOG).length,64);
  t.diagnostic(`System One labels: 253 → ${Object.keys(CATALOG).length} (+ null)`);
  const rgi=/^\p{RGI_Emoji}$/v;
  for (const [emoji,entry] of Object.entries(CATALOG)) {
    assert.ok(rgi.test(emoji),`invalid emoji ${emoji}`);
    assert.ok(!EXCLUDED.includes(emoji),`excluded ${emoji}`);
    assert.ok(entry.name_es.trim()&&entry.name_en.trim(),`names ${emoji}`);
    assert.ok(Object.hasOwn(FAMILY_DEFAULTS,entry.family));
    const r=entry.recipe;
    for (const key of ['face','mouth','body','buds','fx','tint','accessory'])
      assert.ok(Object.hasOwn(PRIMITIVES[key],r[key]),`${emoji} ${key} ${r[key]}`);
    assert.ok(PRIMITIVES.fx[r.fx].every(f=>FX_KINDS.includes(f.kind)));
    assert.ok(ACCESSORIES.includes(r.accessory));
    assert.ok(r.anticipationMs>0&&r.anticipationMs<r.durationMs);
    assert.ok(r.durationMs-r.anticipationMs>=700);
    assert.equal(typeof r.loop,'string');
    assert.deepEqual(resolveRecipe({...r}),r);
    assert.ok(Object.isFrozen(entry.recipe));
  }
  for (const emoji of EXCLUDED) assert.ok(!Object.hasOwn(CATALOG,emoji));
});
test('common conversational emojis canonicalize without extra recipes',()=>{
  for(const [input,label]of Object.entries({'😭':'😭','🥹':'😭','🙌':'🎉','💯':'👍','😍':'❤️','🥳':'🎉','😩':'😫','🫠':'😳','🤭':'😂','👀':'👀','😤':'😠','🙏':'🙏','💀':'😂','🌚':'😏','🥀':'💔'}))assert.equal(canonical(input),label,input);
});
test('all 253 former catalog keys, common variants, excluded and unknown resolve to label or null',()=>{
  assert.equal(FORMER.length,253);assert.equal(new Set(FORMER).size,253);
  const noAnimation=new Set(NO_ANIMATION);
  for (const input of FORMER) {
    const key=canonical(input);
    assert.equal(key===null,noAnimation.has(input),`unexpected null ${input}`);
    if (key!==null) {assert.ok(Object.hasOwn(CATALOG,key),input);assert.equal(canonical(key),key);assert.equal(resolveRecipe(input),CATALOG[key].recipe);}
    else assert.throws(()=>resolveRecipe(input));
    for (const variant of [input.replace(/️/g,''),input.replace(/️/g,'')+'🏽',input+'‍♀️',input+'‍♂'])
      assert.equal(canonical(variant),key,variant);
  }
  for (const [input,key] of [['🤦🏽‍♀️','🤦'],['🤷‍♂','🤷'],['👋🏿','👋'],['✌','✌️'],['🏆','✌️'],['🥇','✌️'],['😑','😐'],['😶','😐'],['❤️‍🔥','❤️'],['❤‍🔥','❤️'],['♥️','❤️'],['👁️','👀'],['✅','👍'],['🙂‍↕️','🙂‍↕️'],['🕺','💃'],['🍻','🎉'],['🫂','🤗'],['🫱🏽‍🫲🏿','🤝']]) assert.equal(canonical(input),key,input);
  for (const e of [...EXCLUDED,...NO_ANIMATION]) for (const variant of [e,e.replace(/️/g,''),e.replace(/️/g,'')+'🏽',e+'‍♀️']) assert.equal(canonical(variant),null,variant);
  for (const value of [null,undefined,{},[],0,'','constructor','__proto__','toString','🙂🙂','hello']) assert.equal(canonical(value),null);
});
test('one label per wave, laugh, cry, love, point, approval and celebration intent',()=>{
  for (const [label,list] of [
    ['👋','🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🙋'],['😂','😆 🤣 🤭 😹 💀 ☠️'],['😭','🥲 🥹 😢 😿'],
    ['❤️','🥰 😍 😻 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 ❤️‍🔥 ❤️‍🩹 💕 💖 💗 💘 💝 💞 💓 💟 ❣️ 💌 🤟 🫶'],
    ['👉','👈 👆 👇 ☝️ 💁'],['👍','🫹 🫺 🙆 💯 ✅'],['🎉','🥳 🎊 🙌 🥂 🍻'],['✌️','🏆 🥇'],['😐','😑 😶'],
  ]) for (const alias of list.split(' ')) {assert.equal(canonical(alias),label);assert.ok(!Object.hasOwn(CATALOG,alias),alias);}
  for (const [a,b] of [['😅','😂'],['😳','😱'],['🤔','🤷'],['❤️','💔'],['🥺','🙏'],['👍','👎'],['👋','🫡'],['👀','🧏'],['✌️','🎉'],['😐','🙄'],['😐','🤨']]) {
    assert.equal(canonical(a),a);assert.equal(canonical(b),b);assert.notDeepEqual(resolveRecipe(a),resolveRecipe(b));
  }
  assert.equal(CATALOG['🤔'].recipe.buds,'chin');assert.equal(CATALOG['🤷'].recipe.buds,'shrug');
  assert.equal(CATALOG['✌️'].recipe.buds,'peace');assert.equal(CATALOG['✌️'].recipe.face,'smug');
  const neutral=CATALOG['😐'].recipe;
  assert.equal(neutral.face,'blank');assert.equal(neutral.mouth,'hidden');assert.equal(neutral.body,'still');
  assert.equal(neutral.buds,'none');assert.equal(neutral.fx,'none');
});
test('jelly nubs: minimal fields, bud count, meaningful contacts and loops',()=>{
  assert.deepEqual(Object.values(counts).flatMap(x=>x.split(' ')).sort(),Object.keys(CATALOG).sort());
  for (const [count,list] of Object.entries(counts)) for (const emoji of list.split(' ')) {
    const hands=PRIMITIVES.buds[CATALOG[emoji].recipe.buds];
    assert.equal(hands.poses.length,Number(count),`bud count ${emoji}`);
    for (const h of hands.poses) {
      assert.deepEqual(Object.keys(h).sort(),['side','dir','height','reach','contact','bulge'].sort());
      assert.equal(h.dir.length,3);assert.ok(h.dir.every(Number.isFinite));
      for(const key of ['height','reach','bulge'])assert.ok(h[key]>=0&&h[key]<=1);
    }
  }
  const hands=e=>PRIMITIVES.buds[CATALOG[e].recipe.buds];
  for (const [e,m] of [['👋','wave'],['👏','clap'],['🎉','raise']]) assert.equal(hands(e).motion,m);
  assert.ok(hands('🤝').poses.find(b=>b.side==='R').dir[2]>0.9);
  for (const e of ['❤️','🙏']) assert.ok(hands(e).poses.every(b=>b.contact==='chest'));
  for (const [e,c] of [['🤫','mouth'],['🤧','mouth'],['🤔','chin'],['🤦','eye'],['🫡','brow']]) assert.equal(hands(e).poses[0].contact,c);
  assert.ok(hands('💪').poses[0].bulge>0.5);
  assert.ok(hands('🤗').poses.every(b=>b.height>=.5&&b.contact==='none'&&Math.abs(b.dir[0])>.7));
});
test('catalog entries have distinct visual recipes',()=>{
  const seen=new Map();
  for (const [emoji,{recipe}] of Object.entries(CATALOG)) {
    const {anticipationMs,durationMs,...visual}=recipe,key=JSON.stringify(visual);
    assert.ok(!seen.has(key),`${emoji} duplicates ${seen.get(key)}`);seen.set(key,emoji);
  }
});
test('reduced label catalog still constructs 20 playtest trials with four distinct families',()=>{
  for (const seed of ['system-one',0,1,253]) {
    const trials=makeTrials(seed);assert.equal(trials.length,20);
    for (const trial of trials) {assert.ok(Object.hasOwn(CATALOG,trial.emoji));assert.equal(new Set(trial.choices.map(e=>CATALOG[e].family)).size,4);}
  }
});
test('custom recipe validation rejects invalid admission, never mutates caller',()=>{
  for (const value of [null,[],17,'nope',...EXCLUDED,...NO_ANIMATION,{face:'constructor'},{body:'__proto__'},
    {vocal:'laugh'},{anticipationMs:NaN},{durationMs:Infinity},{loop:'forever'},{durationMs:200}]) assert.throws(()=>resolveRecipe(value));
  const custom={face:'happy',body:'hop'};
  assert.equal(resolveRecipe(custom).loop,'bounce');assert.deepEqual(custom,{face:'happy',body:'hop'});
});
