import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createTouch } from '../web/touch.js';

const hit = (region = 'body', point = [0, .5, .4]) => ({ region, point, normal: [0, 0, 1] });
const ray = (x, y, z = 3) => ({ origin: [x, y, z], dir: [0, 0, -1] });
const tick = (d, start, end, fn = () => {}) => { for (let t = start; t <= end; t += 1000 / 60) fn(d.step(t), t); };
const kinds = d => d.events().map(e => e.kind);
const near = (a, b, epsilon = .025) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
const contract = events => { for (const e of events) {
  const optional=['accel','jerk','release','g','from','to'];
  assert.deepEqual(Object.keys(e).filter(k=>!optional.includes(k)).sort(), ['kind','at','intensity','part','durationMs','path','speed','height','impact','spin','repeat'].sort());
  for(const [key,max] of [['accel',1000],['jerk',100000],['release',50],['g',50]]) if(key in e) assert.ok(Number.isFinite(e[key])&&e[key]>=0&&e[key]<=max,key);
  for(const key of ['from','to']) if(key in e) { assert.equal(e[key].length,2);assert.ok(e[key].every(v=>Number.isFinite(v)&&Math.abs(v)<=100)); }
  assert.ok(['contact','poke','pat','pet','pet_flower','hold','lift','shake','drop','throw','land'].includes(e.kind));
  assert.ok(['crown','forehead','eyeL','eyeR','cheekL','cheekR','mouth','belly','sideL','sideR','back','base','flower'].includes(e.part));
  for (const [key, value] of Object.entries(e)) if (!['kind','part','from','to'].includes(key)) { assert.ok(Number.isFinite(value), key); near(value * 100, Math.round(value * 100), .00001); }
  assert.ok(e.intensity >= 0 && e.intensity <= 4); assert.ok(e.repeat >= 1);
  if (e.kind !== 'land') assert.equal(e.impact, 0);
  if (!['land','throw'].includes(e.kind)) assert.equal(e.spin, 0);
} };

test('cancelHop stops pending and airborne hops without landing events', () => {
  for (const until of [50, 300]) {
    const d = createTouch(); d.step(0); assert.equal(d.hop({to:[1,0]}), true);
    tick(d, 17, until); assert.equal(d.cancelHop(), true);
    assert.equal(d.cancelHop(), false);
    tick(d, until + 17, until + 1500, s => { assert.equal(s.com[1], 0); assert.equal(s.hopping, false); });
    assert.deepEqual(d.events(), []);
  }
});

test('cancelHop is a no-op during manual movement', () => {
  const d = createTouch(); d.step(0); d.pointerDown(hit(), 1, ray(0,.5));
  d.pointerMove(null, ray(0,1.2), 50); tick(d, 60, 200);
  assert.equal(d.cancelHop(), false); assert.equal(d.step(217).state, 'held');
});

test('contact flinches immediately, tap reacts on release; dents persist then decay', () => {
  for (const [region, kind] of [['body','poke'], ['head','pat'], ['flower','pet_flower']]) {
    const d = createTouch(); d.step(0); d.pointerDown(hit(region), 1);
    assert.deepEqual(kinds(d), ['contact']);
    tick(d, 17, 200);
    if (region === 'body') assert.ok(d.step(217).dents[0].depth > .07);
    d.pointerUp(220); const events = d.events(); assert.deepEqual(events.map(e => e.kind), [kind]); contract(events);
    assert.equal(events[0].durationMs, 219);
    tick(d, 234, 2200); assert.ok(d.step(2217).dents.every(v => v.depth < .0008));
  }
});

test('flower flick appears on the first frame and respects reduced motion', () => {
  const motion = reduced => {
    const d = createTouch(); d.setReducedMotion(reduced); d.step(0); d.pointerDown(hit('flower'), 1);
    return Math.hypot(...d.step(16).flower.swing);
  };
  const normal = motion(false), reduced = motion(true);
  assert.ok(normal >= .04 && normal < .06);
  assert.ok(reduced > 0 && reduced < normal / 2);
});

test('every press emits contact; stationary hold fires once at 700ms', () => {
  const d = createTouch(); d.step(0); d.pointerDown(hit(), 10); tick(d, 17, 1800);
  const events = d.events(); assert.deepEqual(events.map(e => e.kind), ['contact','hold']);
  assert.ok(events[1].durationMs >= 700 && events[1].durationMs < 718); contract(events);
  d.pointerUp(1810); assert.deepEqual(d.events(), []);
  for (const t of [2000, 2200, 2400]) { d.pointerDown(hit(), t); d.pointerUp(t + 50); }
  const taps = d.events().filter(e => e.kind === 'poke'); assert.deepEqual(taps.map(e => e.repeat), [1,2,3]);
  d.pointerDown(hit(), 7000); d.pointerUp(7050); assert.equal(d.events().at(-1).repeat, 1);
});

test('drag starts in any direction, follows 2H sideways and 1.5H up, stays at its landing', () => {
  const d = createTouch(); d.step(0); d.pointerDown(hit(), 1, ray(0,.5));
  d.pointerMove(null, ray(.04,.5), 30); assert.deepEqual(kinds(d), ['contact','lift']);
  d.pointerMove(null, ray(2,2), 300); tick(d, 17, 900);
  near(d.step(917).com[0], 2); near(d.step(934).com[1], 1.5);
  assert.ok(d.step(951).tilt.every(x => Math.abs(x) <= 1.2));
  d.pointerUp(960); assert.deepEqual(kinds(d), ['drop']);
  let lands = [], bounce = 0, landed = false;
  tick(d, 967, 5000, p => { const events = d.events(); contract(events); lands.push(...events.filter(e => e.kind === 'land')); if (lands.length) { landed = true; bounce = Math.max(bounce, p.com[1]); } });
  const end = d.step(5017); assert.equal(lands.length, 1); assert.equal(lands[0].durationMs, 0); assert.ok(lands[0].impact > 4);
  assert.ok(landed && bounce > .08); near(end.com[0], 2); assert.ok(Math.abs(end.tilt[0]) < .01); assert.equal(end.grab, null);
});

test('drag plane passes through live world hit, camera-facing at fixed depth, re-grab has no origin jump', () => {
  const d = createTouch(); d.step(0);
  const contact = {...hit(), worldPoint:[0,.5,.4]}, cameraRay = x => ({origin:[5,1+x,4],dir:[-1,0,-1],normal:[-1,0,-1]});
  d.pointerDown(contact, 1, cameraRay(0)); d.pointerMove(null, cameraRay(.7), 100); tick(d, 17, 700);
  const out = d.step(717); near(out.com[1], .7); near(out.com[0], 0); near(out.com[2], 0);
  const fallback = createTouch(); fallback.step(0); fallback.pointerDown(hit(), 1); fallback.pointerMove(null,ray(0,.5),20); fallback.pointerMove(null,ray(-2,2),200); tick(fallback,17,800);
  near(fallback.step(817).com[0], -2); near(fallback.step(834).com[1], 1.5);
  fallback.pointerUp(900); tick(fallback,917,3500); const before = fallback.step(3517).com;
  fallback.pointerDown({...hit(),worldPoint:[before[0],.5,.4]},3520,ray(before[0],.5));fallback.pointerMove(null,ray(before[0]+.4,.8),3620);tick(fallback,3534,4200);
  near(fallback.step(4217).com[0], before[0]+.4);
});

test('head strokes pet at most once per 1.5s; leaving the head or rising lifts; flower tap/stroke/lift', () => {
  const d = createTouch(); d.step(0); const head=hit('head',[0,.85,.2]); d.pointerDown(head,1,ray(0,.85));
  for (const [x,t] of [[.1,100],[.2,300],[-.1,900],[.1,1600],[.2,1700]]) d.pointerMove(head,ray(x,.85),t);
  const events=d.events(); assert.deepEqual(events.map(e=>e.kind),['contact','pet','pet']); assert.equal(events[2].at-events[1].at,1500); contract(events);
  d.pointerMove(null,ray(1,.85),1800); assert.deepEqual(kinds(d),['lift']); d.pointerUp(1850); assert.equal(d.events()[0].kind,'throw');
  const f=createTouch(); f.step(0); const flower=hit('flower',[-.28,.86,.2]); f.pointerDown(flower,1,ray(0,.86)); f.pointerMove(flower,ray(.1,.86),100); f.pointerUp(120);
  assert.deepEqual(kinds(f),['contact','pet_flower']);
  f.pointerDown(flower,200,ray(0,.86));f.pointerMove(null,ray(0,1.2),300);assert.deepEqual(kinds(f),['contact','lift']);
  f.pointerUp(600);assert.deepEqual(kinds(f),['drop']);
});

test('back-and-forth head pet survives crossing its anchor; moving dent, shear, squash and long lean follow the hand', () => {
  const d=createTouch();d.step(0);const head=x=>hit('head',[x,.86,.25]);d.pointerDown(head(0),1,ray(0,.86));
  for(const [x,t]of [[.1,100],[.04,300],[0,500],[-.08,650],[.12,900],[.18,1700]]){
    d.pointerMove(head(x),ray(x,.86),t);tick(d,t,t+80);
    assert.equal(d.step(t+90).state,'pet');assert.equal(d.step(t+95).com[1],0);
  }
  tick(d,1800,2000);const out=d.step(2010);assert.ok(out.dents[0].depth>.025);near(out.dents[0].p[0],.18,.001);
  assert.ok(out.shear[0]>.02);assert.ok(out.squash>.025&&out.squash<.05);assert.ok(out.tilt[0]>.03);
  const events=d.events();assert.deepEqual(events.map(e=>e.kind),['contact','pet','pet']);contract(events);
  assert.equal(events[1].part,'forehead');assert.equal(events[1].durationMs,99);assert.equal(events[1].path,.1);near(events[1].speed,1.01,.01);
  assert.equal(events[2].durationMs,1699);assert.equal(events[2].path,.54);assert.equal(events[2].at-events[1].at,1600);
  d.pointerUp(2020);assert.deepEqual(d.events(),[]);tick(d,2034,3600);assert.ok(d.step(3617).dents.every(v=>v.depth<.001));
});

test('soft-surface pick gaps tolerate <100ms and <.06H, but leaving the silhouette lifts', () => {
  const head=hit('head',[0,.86,.25]),d=createTouch();d.step(0);d.pointerDown(head,1,ray(0,.86));
  d.pointerMove(head,ray(.1,.86),100);d.pointerMove(null,ray(.11,.86),120);tick(d,17,150);assert.equal(d.step(167).state,'pet');
  d.pointerMove(head,ray(.12,.86),180);d.pointerMove(null,ray(.13,.86),200);d.pointerMove(null,ray(.14,.86),301);tick(d,184,350);assert.equal(d.step(367).state,'held');
  assert.deepEqual(kinds(d),['contact','pet','lift']);
});

test('surface arcs and head/flower boundaries stay pets; upward pull, silhouette exit, body drag and hold-then-move lift', () => {
  const head=hit('head',[0,.86,.25]),flower=hit('flower',[-.2,.86,.25]);
  const d=createTouch();d.step(0);d.pointerDown(head,1,ray(0,.86));
  d.pointerMove(head,ray(.16,.96),200);tick(d,17,250);assert.equal(d.step(267).state,'pet');
  d.pointerMove(flower,ray(.18,.96),300);tick(d,284,350);assert.equal(d.step(367).state,'pet');
  assert.deepEqual(kinds(d),['contact','pet','pet_flower']);
  for(const [start,next,x,y,wait]of [[head,head,0,1.02,100],[head,null,.1,.86,100],[hit(),hit(),.08,.5,100],[head,head,.08,.86,800]]){
    const c=createTouch();c.step(0);c.pointerDown(start,1,ray(0,start.point[1]));tick(c,17,wait-17);c.pointerMove(next,ray(x,y),wait);tick(c,wait+17,wait+100);
    assert.equal(c.step(wait+117).state,'held');const events=kinds(c);assert.ok(events.includes('lift'));assert.ok(!events.includes('pet'));
  }
});

test('flower stroke swings across flower/head boundary; nearby crown pets sway flower; telemetry throttles', () => {
  const d=createTouch();d.step(0);const flower=hit('flower',[-.2,.86,.25]),head=hit('head',[-.1,.86,.25]);d.pointerDown(flower,1,ray(-.2,.86));
  for(const[x,t]of [[-.14,100],[-.2,300],[-.12,1700]]){d.pointerMove(head,ray(x,.86),t);tick(d,t,t+100);assert.equal(d.step(t+117).state,'pet');}
  assert.ok(d.step(1834).flower.swing.some(v=>Math.abs(v)>.01));const events=d.events();assert.deepEqual(events.map(e=>e.kind),['contact','pet_flower','pet_flower']);
  assert.equal(events[1].part,'flower');assert.equal(events[1].durationMs,99);assert.equal(events[1].path,.06);near(events[1].speed,.61,.01);assert.equal(events[2].path,.2);contract(events);
  const c=createTouch();c.step(0);c.pointerDown(head,1,ray(-.1,.86));tick(c,17,180);c.pointerMove({...head,worldPoint:[-.05,.86,.25],anchors:{flower:{position:[-.2,.86,.25]}}},ray(-.05,.86),200);tick(c,200,280);
  assert.ok(c.step(297).flower.swing.some(v=>Math.abs(v)>.005));
});

test('flower taps share the stroke throttle across presses', () => {
  const d=createTouch(),flower=hit('flower');d.step(0);
  for(const t of [1,200,1600]){d.pointerDown(flower,t);d.pointerUp(t+50);}
  const events=d.events().filter(e=>e.kind==='pet_flower');assert.equal(events.length,2);assert.equal(events[1].at-events[0].at,1599);contract(events);
});

test('throw preserves linear/angular momentum, bounces, self-rights; shake requires reversals', () => {
  const d=createTouch();d.step(0);d.pointerDown(hit('body',[.3,.7,.3]),1,ray(.3,.7));d.pointerMove(null,ray(.3,2),200);tick(d,17,400);
  d.pointerMove(null,ray(.8,2),420);tick(d,417,500);d.pointerMove(null,ray(-.3,2),520);tick(d,517,600);d.pointerMove(null,ray(.3,2.2),650);tick(d,617,700);d.pointerUp(710);
  const events=d.events();assert.ok(events.some(e=>e.kind==='shake'));const thrown=events.find(e=>e.kind==='throw');assert.ok(thrown?.speed>=2);assert.ok(thrown.spin>0);contract(events);
  let maxX=0,maxY=0,lands=[];tick(d,717,6500,p=>{maxX=Math.max(maxX,p.com[0]);maxY=Math.max(maxY,p.com[1]);lands.push(...d.events().filter(e=>e.kind==='land'));});
  assert.ok(maxX>1);assert.ok(maxY>1.2);assert.equal(lands.length,1);assert.ok(lands[0].spin>0);contract(lands);
  const end=d.step(6517);assert.ok(Math.abs(end.com[0])>.5);assert.ok(end.tilt.every(x=>Math.abs(x)<.02));
});

test('nearest live anchors classify moved face; geometry labels are viewer-left/right', () => {
  const anchors=Object.fromEntries(['eyeL','eyeR','mouth','cheekL','cheekR','flower','crown'].map((key,i)=>[key,{position:[i*2,1,1]}]));
  const d=createTouch();let t=0;
  for (const [key,a] of Object.entries(anchors)) { d.pointerDown({...hit(),worldPoint:[a.position[0]+.02,1,1],anchors},t++);d.pointerUp(t++);assert.equal(d.events()[0].part,key); }
  for(const [point,part] of [[[0,.1,.3],'base'],[[0,.5,-.4],'back'],[[-.5,.4,.2],'sideL'],[[.5,.4,.2],'sideR'],[[0,.8,.2],'forehead'],[[0,.4,.4],'belly']]){
    d.pointerDown(hit('body',point),t++);d.pointerUp(t++);assert.equal(d.events()[0].part,part);
  }
});

test('C9 path and peak speed accumulate; all event values finite and rounded', () => {
  const d=createTouch();d.step(0);d.pointerDown(hit(),1,ray(0,.5));d.pointerMove(null,ray(.3,.9),101);d.pointerMove(null,ray(.6,.9),301);d.pointerUp(320);
  const events=d.events();contract(events);const release=events.at(-1);assert.equal(release.durationMs,319);near(release.path,.8);near(release.speed,5);assert.equal(release.kind,'drop');
});

test('reduced motion caps swing and bounce without restricting drag', () => {
  const d=createTouch();d.setReducedMotion(true);d.step(0);d.pointerDown(hit(),1,ray(0,.5));d.pointerMove(null,ray(2,2),200);
  tick(d,17,900,p=>{assert.ok(p.tilt.every(x=>Math.abs(x)<=.1));assert.ok(p.stretch<=.4);});near(d.step(917).com[0],2);d.pointerUp(1000);
  let landed=false,bounce=0;tick(d,1017,3500,p=>{if(d.events().some(e=>e.kind==='land'))landed=true;if(landed)bounce=Math.max(bounce,p.com[1]);});assert.ok(landed);assert.ok(bounce<.04);
});

test('10k seeded pointer events remain finite, generous bounds; malformed input ignored', () => {
  const d=createTouch();let seed=1234567,t=0;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<10000;i++){
    t+=random()*20;const p=[random()-.5,random(),random()-.5];
    if(i%3===0)d.pointerDown(hit(['body','head','flower'][i%3],p),t,ray(p[0],p[1]));else if(i%3===1)d.pointerMove(null,ray((random()-.5)*20,random()*8),t);else d.pointerUp(t);
    const out=d.step(t),numbers=[...out.com,out.squash,...out.shear,...out.tilt,out.stretch,...out.flower.swing,...out.dents.map(x=>x.depth)];
    assert.ok(numbers.every(Number.isFinite));assert.ok(out.com[1]>=0&&out.com[1]<=4);assert.ok(Math.abs(out.com[0])<=6&&Math.abs(out.com[2])<=6);assert.ok(Math.abs(out.squash)<=.5);assert.ok(out.stretch>=0&&out.stretch<=1);assert.ok(out.dents.length<=4);contract(d.events());
  }
  const bad=createTouch();bad.pointerDown(hit('body',[NaN,1,0]),1);bad.pointerDown({...hit(),normal:[0,0,0]},2);bad.pointerDown(hit(),NaN);assert.deepEqual(bad.events(),[]);
  const hold=createTouch();hold.pointerDown(hit(),1);hold.pointerUp(701);assert.deepEqual(kinds(hold),['contact','hold']);
});

test('physics hops anticipate, reach a bounded target, bounce/settle, preserve history without user events', () => {
  for(const to of [null,[0,1.2],[1.2,0],[40,0]]) {
    const d=createTouch();d.step(0);assert.equal(d.hop({to}),true);
    const history=d.lastHop;assert.ok(Math.hypot(...history.to)<=1.5+1e-8);let height=0,anticipation=0,turn=0;
    tick(d,17,3000,(p,t)=>{height=Math.max(height,p.com[1]);if(t<140)anticipation=Math.max(anticipation,p.squash);turn=Math.max(turn,Math.abs(p.twist));});
    const end=d.step(3017);near(end.com[0],history.to[0],.001);near(end.com[2],history.to[1],.001);near(end.com[1],0,.001);
    assert.ok(height>.43&&height<.58);assert.ok(anticipation>.1);assert.equal(end.state,'idle');assert.equal(end.hopping,false);
    if(to?.[0]) assert.ok(turn>1);near(end.twist,0,.01);assert.deepEqual(d.events(),[]);assert.deepEqual(d.lastHop,history);
    history.to[0]=99;assert.notEqual(d.lastHop.to[0],99);
  }
});

test('hop refuses contact/held/airborne/reduced motion and invalid targets', () => {
  const d=createTouch();d.step(0);d.pointerDown(hit(),1,ray(0,.5));assert.equal(d.hop({to:null}),false);
  d.pointerMove(null,ray(0,1.2),100);assert.equal(d.hop(),false);tick(d,17,500);d.pointerUp(510);assert.equal(d.hop(),false);
  const reduced=createTouch();reduced.step(0);reduced.setReducedMotion(true);assert.equal(reduced.hop(),false);
  const invalid=createTouch();invalid.step(0);for(const options of [{to:[NaN,0]},{to:[0,0,0]},{height:NaN},{height:0}])assert.equal(invalid.hop(options),false);
});

test('user-release land carries g/to, release and derivative telemetry stay in C9 ranges', () => {
  const d=createTouch();d.step(0);d.pointerDown(hit(),1,ray(0,.5));
  d.pointerMove(null,ray(.8,1.8),101);tick(d,17,600);d.pointerMove(null,ray(2,1.8),620);d.pointerUp(630);
  const events=d.events();tick(d,634,4000,()=>events.push(...d.events()));contract(events);
  const lift=events.find(e=>e.kind==='lift'),release=events.find(e=>e.kind==='throw'),land=events.find(e=>e.kind==='land');
  assert.ok(lift.accel>0&&lift.jerk>0);assert.ok(release.release>0);assert.ok(land.g>0);assert.deepEqual(land.from,[0,0]);assert.ok(land.to[0]>1.2);
  const held=createTouch();held.step(0);held.pointerDown(hit(),1,ray(0,.5));held.pointerMove(null,ray(0,1.5),101);tick(held,17,600);held.pointerUp(700);assert.equal(held.events().find(e=>e.kind==='drop').release,0);
});

test('hover emits only head episodes, at 250ms then 1.5s, no press overlap', () => {
  const d=createTouch();d.step(0);
  for(const p of [[0,.4,.4],[.4,.4,.2],[0,.5,-.4]]){d.pointerHover(hit('body',p),1);d.pointerHover(null,400);assert.deepEqual(d.events(),[]);}
  d.pointerHover(hit('head',[0,.85,.25]),500);d.pointerHover(null,700);assert.deepEqual(d.events(),[]);
  d.pointerHover(hit('head',[0,.85,.25]),800);tick(d,801,1100);const first=d.events();assert.equal(first.length,1);assert.equal(first[0].kind,'hover');assert.equal(first[0].part,'forehead');assert.ok(first[0].durationMs>=250);
  d.pointerHover(hit('head',[.1,.85,.25]),1200);tick(d,1201,2800);const more=d.events();assert.equal(more.length,1);assert.ok(more[0].path>0&&more[0].speed>0);assert.ok(more[0].at-first[0].at>=1500);
  d.pointerHover(null,2810);d.events();tick(d,2817,5000);assert.deepEqual(d.events(),[]);
  for(const part of ['eyeL','eyeR','crown','flower']){const h={...hit('body',[0,.5,.4]),worldPoint:[0,1,0],anchors:{[part]:{position:[0,1,0]}}};d.pointerHover(h,5100);d.pointerHover(null,5400);const e=d.events();assert.equal(e.length,1);assert.equal(e[0].part,part);}
  d.pointerDown(hit('head',[0,.85,.25]),5500);d.events();d.pointerHover(hit('head',[0,.85,.25]),5800);assert.deepEqual(d.events(),[]);
});

test('touch-device head sweep remains a pet/pat, never a lift', () => {
  const d=createTouch();d.step(0);const head=hit('head',[0,.85,.25]);d.pointerDown(head,1,ray(0,.85));
  for(const [x,t]of [[.05,80],[.12,160],[.02,240],[-.06,320]])d.pointerMove(head,ray(x,.85),t);
  d.pointerUp(350);const events=kinds(d);assert.ok(events.includes('pet'));assert.ok(!events.includes('lift'));
});

test('step mean cost', () => {
  const d=createTouch();d.step(0);const n=20000,start=performance.now();for(let i=1;i<=n;i++)d.step(i*1000/60);
  const mean=(performance.now()-start)/n;console.log(`step mean: ${mean.toFixed(5)} ms`);assert.ok(mean<=.02,`${mean} ms`);
});
