import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBud } from '../web/character/buds.js';
import { PRIMITIVES } from '../web/perform/emoji.js';
import { createPerformer } from '../web/perform/engine.js';
import * as THREE from 'three';
import { createBody, frontPoint, FACE_ANCHORS, EYE_AIM, restNormal } from '../web/character/body.js';
import { createEffects } from '../web/character/attach/effects.js';
import { FX } from '../web/character/attach/atlas.js';
import { createFace } from '../web/character/attach/face.js';
import { shading } from '../web/character/jelly.js';

test('glass eye contours retain every icon, lid, gaze and pupil control',()=>{
 const plane=new THREE.PlaneGeometry(),face=createFace(THREE,plane,{}),p=createPerformer().update(700);
 try {
  let time=0;
  for(const [icon,index] of ['none','heart','star','spiral','cross','tear','money'].map((x,i)=>[x,i]))for(const open of [0,.1,.5,1,1.4])for(const joy of [0,1]){
   p.eyes={...p.eyes,icon,openL:open,openR:open,smileL:joy,smileR:joy,frown:.7,pupil:1.5,gaze:[.6,-.4]};face.update(p,time+=16);
   for(const eye of face.eyes){const u=eye.material.uniforms;assert.equal(u.icon.value,index);assert.equal(u.openness.value,open);assert.equal(u.joy.value,joy);assert.equal(u.pupil.value,1.5);assert.deepEqual(u.gaze.value.toArray(),[.6,-.4]);assert.equal(eye.material.depthTest,true);}
  }
 }finally{face.dispose();plane.dispose();}
});
test('eye sparkle is a staggered 640ms emotion-edge burst, not a smile/blink loop',()=>{
 const plane=new THREE.PlaneGeometry(),face=createFace(THREE,plane,{}),p=createPerformer().update(0);
 const sparks=()=>face.eyes.map(eye=>eye.material.uniforms.sparkle.value);
 const eyes=patch=>Object.assign(p.eyes,patch);
 try {
  eyes({openL:1,openR:1,smileL:0,smileR:0,frown:0,icon:'none'});
  face.update(p,0);face.update(p,320);assert.deepEqual(sparks(),[0,0]);
  for(const emotion of [{smileL:.7,smileR:.7},{icon:'heart'},{icon:'star'},{openL:1.25,openR:1.25}]){
   eyes({openL:1,openR:1,smileL:0,smileR:0,icon:'none'});face.update(p,0);
   eyes(emotion);face.update(p,100);assert.deepEqual(sparks(),[0,0]);
   face.update(p,420);assert.equal(sparks()[0],1);assert.ok(sparks()[1]>.8&&sparks()[1]<1);
   face.update(p,806);assert.deepEqual(sparks(),[0,0]);
   face.update(p,1600);assert.deepEqual(sparks(),[0,0],'sustained emotion does not retrigger');
  }
  eyes({openL:1,openR:1,smileL:.7,smileR:.7,icon:'none'});face.update(p,2000);face.update(p,2800);
  eyes({smileL:.5,smileR:.5});face.update(p,2900);
  eyes({smileL:.7,smileR:.7});face.update(p,3000);face.update(p,3320);assert.deepEqual(sparks(),[0,0],'smile hysteresis');
  eyes({openL:0,openR:0});face.update(p,3400);eyes({openL:1,openR:1});face.update(p,3500);assert.deepEqual(sparks(),[0,0],'blink does not retrigger smile');
  eyes({smileL:0,smileR:0});face.update(p,3600);eyes({smileL:.7,smileR:.7});face.update(p,3700);face.update(p,4020);assert.equal(sparks()[0],1,'fresh smile rearms');
  eyes({smileL:0,smileR:0});face.update(p,0);face.update(p,320);assert.deepEqual(sparks(),[0,0],'rewind clears the burst');
  eyes({frown:-.8,openL:1.25,openR:1.25});face.update(p,400);face.update(p,720);assert.deepEqual(sparks(),[0,0],'pleading is not awe');
 }finally{face.dispose();plane.dispose();}
});
test('analytic bud normal matches the rest-surface finite difference',()=>{
 const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
 const distance=([x,y,z])=>{const r=.65-.12*y+.014*Math.exp(-(((y-.10)/.28)**2)),q=y-.34,k0=Math.hypot(x/r,q/.79,z/.51),k1=Math.hypot(x/(r*r),q/(.79*.79),z/(.51*.51));return -smin(-k0*(k0-1)/k1,y-.015-.105*(x/.67)**2-.04*(z/.51)**2,.07);};
 for(let i=0;i<300;i++){
  const x=Math.sin(i*7.)*.62,y=.02+(i%37)/37*1.08,z=Math.cos(i*3.)*.49,flare=.014*Math.exp(-(((y-.10)/.28)**2)),r=.65-.12*y+flare,slope=-.12-flare*2*(y-.10)/(.28*.28),q=[x,y-.34,z],r2=[r*r,.79*.79,.51*.51];
  const k0=Math.hypot(...q.map((v,k)=>v/Math.sqrt(r2[k]))),k1=Math.hypot(...q.map((v,k)=>v/r2[k])),a=q.map((v,k)=>v/r2[k]),b=q.map((v,k)=>v/r2[k]**2);a[1]-=x*x*slope/r**3;b[1]-=2*x*x*slope/r**5;
  const e=k0*(k0-1)/k1,f=-y+.015+.105*(x/.67)**2+.04*(z/.51)**2,h=Math.max(0,Math.min(1,.5+.5*(e-f)/.07)),floor=[.21*x/(.67*.67),-1,.08*z/(.51*.51)];
  const g=a.map((v,k)=>floor[k]*(1-h)+(v/k0*(2*k0-1)*k1-k0*(k0-1)*b[k]/k1)/(k1*k1)*h),length=Math.hypot(...g),p=[x,y,z],epsilon=1e-6;
  const n=p.map((_,k)=>{const a=[...p],b=[...p];a[k]+=epsilon;b[k]-=epsilon;return distance(a)-distance(b);}),nl=Math.hypot(...n);
  assert.ok(g.reduce((s,v,k)=>s+v/length*n[k]/nl,0)>.999999,'analytic derivative remains seamless with raster rest normals');
 }
});
test('gummy has one skin pass, shared optical shader and no painted outline/gloss',()=>{
 const scene=new THREE.Scene(),body=createBody({THREE,scene,reducedQuality:true});
 try {assert.equal(scene.children.length,1);assert.equal(scene.children[0].name,'jelly-body');assert.match(shading,/exp\(-absorption\*depth\)/);assert.match(shading,/reflect\(-view,wetNormal\)/);assert.doesNotMatch(shading,/ovalMask|float belly|float contour/);}
 finally{body.dispose();assert.equal(scene.children.length,0);}
});

test('ambient FX sprites stay outside the eye/mouth band throughout their lifetime',()=>{
 const frame={position:[0,0,0],normal:[0,0,1],up:[0,1,0],scale:1},anchors=Object.fromEntries(['crown','mouth','eyeL','eyeR','cheekL','cheekR'].map(k=>[k,frame]));
 const effects=createEffects(THREE,{names:FX,texture:null});
 try {
  for(const kind of ['hearts','sparkles','confetti','fire','notes','steam','dizzy','sweatdrops'])for(let t=0;t<6000;t+=37){
   effects.update([{kind,intensity:1}],anchors,t);
   const a=effects.mesh.geometry.attributes.position.array;
   for(let i=0;i<effects.mesh.userData.count;i++){
    const x=[0,1,2,3].map(v=>a[i*12+v*3]),y=[0,1,2,3].map(v=>a[i*12+v*3+1]);
    assert.ok(Math.min(...y)>=-.30-1e-7||Math.max(...y)<=-.95+1e-7||Math.min(...x)>=.52-1e-7||Math.max(...x)<=-.52+1e-7,`${kind} at ${t}`);
   }
  }
 } finally {effects.dispose();}
});

test('touch stretch pins the grab; floor, face frames and bud affine stay coherent', () => {
 const body=createBody({THREE,scene:new THREE.Scene(),reducedQuality:true});
 const source=FACE_ANCHORS;
 const grab=[.28,.65,.3], com=[.2,.8,0];
 try {
  for(const stretch of [0,.4,.85])for(const tilt of [-.5,0,.5]) {
   body.update({}, {grab,com,stretch,tilt:[tilt,.1],shear:[.12,-.08],dents:[{p:frontPoint(.2,.5),n:[0,0,1],depth:.085,radius:.21}]}, 500);
   // Without a dent at the grab, the affine pivot is exactly the pointer translation.
   const pivot=new THREE.Vector3().fromArray(grab).applyMatrix4(body.uniforms.uAffine.value).toArray();
   assert.ok(Math.hypot(...pivot.map((v,i)=>v-grab[i]-com[i]))<1e-8);
   for(const [key,p] of Object.entries(source)) {
    const a=body.anchors[key];assert.deepEqual(a.position,body.transform(p));
    assert.ok(Math.abs(Math.hypot(...a.normal)-1)<1e-8);assert.ok(Math.abs(Math.hypot(...a.up)-1)<1e-8);
    assert.ok(Math.abs(a.normal.reduce((s,v,i)=>s+v*a.up[i],0))<1e-8);assert.ok(a.scale>.99&&a.scale<1.01,'decals retain size');
   }
   const affine=body.uniforms.uAffine.value;assert.ok(Math.abs(affine.determinant()-1)<1e-8,'volume-preserving stretch');
   const rest=[-.5,.55,.2],world=body.transform(rest);body.update({}, {grab,com,stretch,tilt:[tilt,.1],shear:[.12,-.08]}, 500);
   const same=new THREE.Vector3().fromArray(rest).applyMatrix4(body.uniforms.uAffine.value).toArray();assert.ok(Math.hypot(...world.map((v,i)=>v-same[i]))<.001,'bud uses the same body affine');
  }
  const restPosition=body.mesh.geometry.attributes.position,renderRest=[];
  for(let i=0;i<restPosition.count;i+=17)renderRest.push(new THREE.Vector3().fromBufferAttribute(restPosition,i).toArray());
  for(const twist of [0,Math.PI/2,Math.PI,Math.PI*2,Math.PI*4])for(const swing of [-1.2,0,1.2]){
   const dynamic={grab,com:[.1,2,0],stretch:.7,tilt:[swing,-swing*.7],dents:[{p:source.eyeR,n:[.2,0,1],depth:.08,radius:.23}]};
   body.update({body:{twist}},dynamic,500);const a=body.uniforms.uAffine.value,det=body.uniforms.uDent.value[0],n=body.uniforms.uDentNormal.value[0];
   assert.equal(body.uniforms.uTwist.value,0,'rigid spin uses the shared affine, not height-dependent skin torsion');
   const gpuWorld=p=>{const w=det.w*Math.exp(-((p[0]-det.x)**2+(p[1]-det.y)**2+(p[2]-det.z)**2)/n.w);return new THREE.Vector3(p[0]-n.x*w,p[1]-n.y*w,p[2]-n.z*w).applyMatrix4(a).toArray();};
   for(const p of [...Object.values(source),...renderRest])assert.ok(Math.hypot(...gpuWorld(p).map((v,i)=>v-body.transform(p)[i]))<1e-10,'CPU anchor matches vertex shader');
   for(const [key,p] of Object.entries(source))assert.deepEqual(body.anchors[key].position,body.transform(p),'face and FX share the shader frame');
   const bud=[.55,.6,.2];assert.ok(Math.hypot(...gpuWorld(bud).map((v,i)=>v-body.transform(bud)[i]))<1e-10,'SDF bud frame includes full rigid twist');
  }
  body.update({}, {},600);const restEye=[...body.anchors.eyeL.position];body.update({body:{twist:2*Math.PI}},{},600);
  assert.ok(Math.hypot(...body.anchors.eyeL.position.map((v,i)=>v-restEye[i]))<1e-10,'full revolution returns every anchor to rest');
  for(const swing of [-3,-1.2,.5,1.2,3]){
   body.update({}, {grab,com:[0,0,0],stretch:.6,tilt:[swing,.1]},700);
   for(let i=0;i<32;i++){const a=i*Math.PI/16;assert.ok(body.transform([.59*Math.cos(a),.015,.51*Math.sin(a)])[1]>=-1e-8,'base clears floor');}
   for(const p of renderRest)assert.ok(body.transform(p)[1]>=-.002,'tumbling skin clears floor');
  }
 } finally { body.dispose(); }
});

test('heart hues reach the shared jelly material without a green pigment overlay',()=>{
 const body=createBody({THREE,scene:new THREE.Scene(),reducedQuality:true});
 try {
  for(const kind of ['red','pink']){
   const engine=createPerformer();engine.play({tint:kind},{nowMs:0});const p=engine.update(700);assert.equal(p.tint.kind,kind);assert.ok(p.tint.amount>.6);
   body.update(p);const c=body.uniforms.uTint.value;
   assert.ok(c.r>=0&&c.g>=0&&c.b>=0);
   if(kind==='red')assert.ok(c.r>c.g*2&&c.r>c.b*2);
   if(kind==='pink')assert.ok(c.r>c.g*2&&c.b>c.g*2);
  }
 } finally {body.dispose();}
});

test('touch owns airborne body channels and releases without a landing snap', () => {
 const body=createBody({THREE,scene:new THREE.Scene(),reducedQuality:true});
 const pose={body:{squash:.3,lean:[.4,.3],offset:[.2,.3,0],twist:.4,wobble:0,puff:0}},p=frontPoint(0,.4);
 try {
  const run=(dyn,from,to)=>{for(let t=from;t<=to;t+=16)body.update(pose,dyn,t);};
  run({state:'held',com:[0,.6,0]},10,250);const held=body.transform(p);assert.ok(Math.abs(held[1]-p[1]-.6)<1e-8,'physics owns the pose once the yaw hand-off (160ms) completes');
  body.update(pose,{state:'falling',com:[0,.2,0]},266);
  body.update(pose,{state:'idle'},282);assert.ok(Math.hypot(...body.transform(p).map((v,i)=>v-p[i]))<1e-8);
  run({state:'idle'},298,660);assert.ok(Math.hypot(...body.transform(p).map((v,i)=>v-p[i]))<1e-8);
  run({state:'idle'},676,1000);
  assert.ok(body.transform(p)[1]>p[1]+.1,'authored pose blends back after landing hold');
 } finally {body.dispose();}
});
test('physics hop keeps companion pose and travel yaw in the shared anchor affine', () => {
 const body=createBody({THREE,scene:new THREE.Scene(),reducedQuality:true});
 const pose={body:{squash:.12,twist:Math.PI/3}},dynamic={state:'falling',hopping:true,com:[1,.5,0],twist:Math.PI/2,facing:1};
 try {
  body.update(pose,dynamic,0);const world=body.transform([0,.5,.4]);
  assert.ok(Math.abs(world[0]-(1+.4/Math.sqrt(1-.12*.65)))<1e-8);assert.ok(Math.abs(world[2])<1e-8);
  assert.ok(world[1]<1,'hop does not mute the anticipation/landing squash');
  const affine=body.uniforms.uAffine.value;assert.ok(Math.abs(affine.determinant()-1)<1e-8);
  for(const [key,p]of Object.entries(FACE_ANCHORS))assert.deepEqual(body.anchors[key].position,body.transform(p));
  body.update(pose,{...dynamic,state:'idle',hopping:false,com:[1,0,0],twist:0,facing:0},1000);
  const returned=body.transform([0,.5,.4]);assert.ok(Math.abs(returned[0]-(1+.4*Math.sin(Math.PI/3)/Math.sqrt(1-.12*.65)))<1e-8);
 } finally {body.dispose();}
});

const hold=emoji=>{const p=createPerformer();p.play(emoji,{nowMs:0});return p.update(700);};
test('contact nubs: lateral roots, rounded tips ahead of face, unbranched capsules',()=>{
 for(const emoji of ['🤧','🤫','🤔','🫡','🤦','🙈','❤️','🙏','👏'])for(const b of hold(emoji).buds){
  const {segments}=buildBud(b);assert.equal(segments.length,3,emoji);
  assert.ok(Math.abs(segments[0].a[0])>.35,`${emoji} lateral root`);
  const tip=segments.at(-1).b;
  assert.ok(tip[2]>frontPoint(tip[0],tip[1])[2]+.08,`${emoji} nub ahead of skin/decals`);
  for(const [i,s] of segments.entries()){
   assert.ok([...s.a,...s.b,s.ra,s.rb,s.k].every(Number.isFinite));assert.ok(s.ra>0&&s.rb>0&&s.k>0);
   if(i){assert.deepEqual(s.a,segments[i-1].b);assert.equal(s.ra,segments[i-1].rb);}
  }
  assert.ok(segments.at(-1).rb>=segments.at(-1).ra,'soft fat tip, not a finger');
 }
 const shush=buildBud(hold('🤫').buds[0]).segments.at(-1).b;
 assert.ok(Math.hypot(shush[0]-FACE_ANCHORS.mouth[0],shush[1]-FACE_ANCHORS.mouth[1])<.04,'nub at lips');
 const b=hold('🫡').buds[0],salute=buildBud(b).segments.at(-1).b,eye=FACE_ANCHORS[b.side==='L'?'eyeL':'eyeR'];
 assert.ok(salute[1]>eye[1]+.18&&Math.abs(salute[0]-eye[0])<.01,'nub at brow');
});
test('contact nubs cover eyes/ears, phone stays off-eye, crossed arms pass midline',()=>{
 const tips=e=>hold(e).buds.map(b=>buildBud(b).segments.at(-1).b);
 for(const eye of [FACE_ANCHORS.eyeL,FACE_ANCHORS.eyeR]){
  assert.ok(tips('🙈').some(p=>Math.hypot(p[0]-eye[0],p[1]-eye[1])<.02),'🙈 covers eye');
  assert.ok(tips('🤙').every(p=>Math.hypot(p[0]-eye[0],p[1]-eye[1])>.15),'🤙 off eye');
 }
 assert.ok(tips('🙉').every(p=>Math.abs(p[0])>.5&&p[1]>.5),'🙉 covers lateral ears');
 const cross=tips('🙅');assert.equal(cross.length,2);assert.ok(cross[0][0]>0&&cross[1][0]<0,'🙅 crosses midline');
});
test('heart and prayer nubs meet at chest; clap opens and closes; pleading stays budless',()=>{
 for(const emoji of ['❤️','🙏']){
  const tips=hold(emoji).buds.map(b=>buildBud(b).segments.at(-1));
  assert.ok(Math.hypot(...tips[0].b.map((v,i)=>v-tips[1].b[i]))<tips[0].rb+tips[1].rb,`${emoji} tips meet`);
 }
 const e=createPerformer();e.play('👏',{nowMs:0});const gaps=[];
 for(let t=450;t<1200;t+=20){const p=e.update(t).buds.map(b=>buildBud(b).segments.at(-1));gaps.push(Math.abs(p[0].b[0]-p[1].b[0])-p[0].rb-p[1].rb);}
 assert.ok(Math.min(...gaps)<0&&Math.max(...gaps)>.01,'clap alternates meeting and separated tips');
 const p=hold('🥺');assert.deepEqual(p.buds,[]);assert.equal(p.eyes.pupil,1.5);assert.equal(p.mouth.shape,'none');assert.ok(p.body.puff<0&&p.body.lean[1]>0);
});
test('all primitive nubs grow and melt with finite bounds, shared roots, three spans only',()=>{
 for(const {poses} of Object.values(PRIMITIVES.buds))for(const b of poses)for(const reach of [0,.01,.2,.45,.65,1]){
  const data=buildBud({...b,reach});
  if(!reach){assert.equal(data.segments.length,0);continue;}
  assert.equal(data.segments.length,3);
  for(const [i,s] of data.segments.entries()){
   assert.ok([...s.a,...s.b,s.ra,s.rb,s.k,...data.min,...data.max].every(Number.isFinite));
   if(i)assert.deepEqual(s.a,data.segments[i-1].b,'one continuous unbranched arm');
   for(let k=0;k<3;k++)for(const key of ['a','b']){assert.ok(s[key][k]-s[key==='a'?'ra':'rb']>=data.min[k]);assert.ok(s[key][k]+s[key==='a'?'ra':'rb']<=data.max[k]);}
  }
 }
});
test('listening nod dips actual eye midpoint 3–4% H; steady listening leans .05rad',()=>{
 const a=createPerformer(),b=createPerformer(),body=createBody({THREE,scene:new THREE.Scene()}),base=createBody({THREE,scene:new THREE.Scene()});
 let dip=0;
 for(let t=0;t<=1800;t+=10){const p=a.update(t,{listening:true,pauseAt:1000}),q=b.update(t,{listening:true});body.update(p,{},t);base.update(q,{},t);
  const mid=x=>(x.anchors.eyeL.position[1]+x.anchors.eyeR.position[1])/2;dip=Math.max(dip,mid(base)-mid(body));}
 assert.ok(dip>=.03&&dip<=.04,`${dip} H`);assert.ok(Math.abs(a.update(1810,{listening:true}).body.lean[1]-.05)<.001);
 body.dispose();base.dispose();
});
test('voice aperture overrides laugh mouth, not its face; opaque buds write depth before tested decals',async()=>{
 const p=createPerformer();p.play('😂',{nowMs:0});
 p.update(600,{speaking:.08});const pose=p.update(700,{speaking:.08});assert.equal(pose.mouth.shape,'o');assert.equal(pose.mouth.open,.08);assert.ok(pose.eyes.openL<=.12&&pose.eyes.smileL===1);assert.ok(pose.fx.some(x=>x.kind==='tears'));
 const face=await readFile(new URL('../web/character/attach/face.js',import.meta.url),'utf8'),buds=await readFile(new URL('../web/character/buds.js',import.meta.url),'utf8');
 assert.match(buds,/gl_FragDepth=clip.z\/clip.w/);assert.doesNotMatch(face,/depthTest\s*:\s*false/);assert.doesNotMatch(buds,/transparent\s*:\s*true/);
 assert.match(buds,/edgeCoverage=1\./);
 // See-through jelly: the body samples the real scene behind it, not a fake opaque minimum depth.
 const jelly=await readFile(new URL('../web/character/jelly.js',import.meta.url),'utf8');
 assert.doesNotMatch(buds,/max\(thickness,\.70\)/);assert.match(jelly,/texture2D\(uTransmission,/);
});
test('centred pose gaze aims both pupils at the viewer once the body yaws the face toward them',()=>{
 const mid=['eyeL','eyeR','mouth'].map(k=>{const n=restNormal(FACE_ANCHORS[k]);return Math.atan2(n[0],n[2]);});
 assert.ok(Math.abs((mid[0]+mid[1])/2-FACE_YAW)<.03,'FACE_YAW is the measured eye-midpoint bearing');assert.ok(Math.abs(mid[2]-FACE_YAW)<.1,'mouth agrees');
 for(const [i,k] of ['eyeL','eyeR'].entries()){const n=restNormal(FACE_ANCHORS[k]);assert.ok(Math.abs(Math.atan2(n[0],n[2])-FACE_YAW+EYE_AIM[i]*.65)<1e-9,k);}
 const face=createFace(THREE,new THREE.PlaneGeometry(),{}),p=createPerformer().update(700);p.eyes={...p.eyes,gaze:[0,.2]};
 face.update(p,16,EYE_AIM);face.eyes.forEach((eye,i)=>assert.deepEqual(eye.material.uniforms.gaze.value.toArray(),[EYE_AIM[i],.2]));face.dispose();
});

import { FACE_YAW, cameraPosition, gazeTarget, damp, AZIMUTH, ELEVATION, ZOOM_MIN, ZOOM_MAX } from '../web/character/view.js';
test('fixed camera sits 3/4 left, 20° above; gaze target is the camera plus the pointer offset in its right/up plane', () => {
 const target=[0,.53,0],d=7,pos=cameraPosition(target,d);
 assert.ok(pos[0]<0&&pos[1]>target[1]&&pos[2]>0,'left of, above and in front of Mintie');
 assert.ok(Math.abs(Math.atan2(pos[1]-target[1],Math.hypot(pos[0],pos[2]))-20*Math.PI/180)<1e-9);assert.ok(Math.abs(Math.hypot(pos[0],pos[1]-target[1],pos[2])-d)<1e-9);
 assert.equal(ELEVATION,20*Math.PI/180);assert.ok(AZIMUTH<0);assert.ok(ZOOM_MIN<1&&ZOOM_MAX>1);
 // Camera basis for the same pose (what the renderer reads from camera.matrixWorld).
 const cam=new THREE.PerspectiveCamera();cam.position.fromArray(pos);cam.lookAt(...target);cam.updateMatrixWorld();
 const right=new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld,0).toArray(),up=new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld,1).toArray();
 assert.deepEqual(gazeTarget(pos,right,up,0,0),pos,'centre pointer looks straight at the camera');
 const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 const r=gazeTarget(pos,right,up,1,0),u=gazeTarget(pos,right,up,0,1),c=gazeTarget(pos,right,up,-1,-1);
 assert.ok(r[0]>pos[0]-1e-9&&Math.abs(dist(r,pos)-2.4)<1e-9,'right edge offsets along camera-right');assert.ok(u[1]>pos[1],'top edge offsets up');
 assert.ok(c[1]<pos[1]&&dist(c,pos)>2.4,'corner combines both axes');
 assert.deepEqual(gazeTarget(pos,right,up,9,0),gazeTarget(pos,right,up,1,0),'pointer is clamped to the viewport');
 assert.deepEqual(gazeTarget(pos,right,up,NaN,NaN),pos);
 // Zooming out (larger distance) at a fixed world spread means a smaller gaze angle, zooming in a larger one.
 const angle=distance=>{const p=cameraPosition(target,distance),cr=new THREE.PerspectiveCamera();cr.position.fromArray(p);cr.lookAt(...target);cr.updateMatrixWorld();
  const g=gazeTarget(p,new THREE.Vector3().setFromMatrixColumn(cr.matrixWorld,0).toArray(),[0,1,0],1,0);return Math.atan(dist(g,p)/distance);};
 assert.ok(angle(4.2)>angle(7)&&angle(7)>angle(11.5));
});
test('damp is critically damped: no overshoot, continuous velocity, frame-rate independent', () => {
 for(const dt of [1/240,1/60,1/20]){
  const s={x:0,v:0};let max=0;for(let t=0;t<2;t+=dt)max=Math.max(max,damp(s,1,.15,dt));
  assert.ok(max<=1+1e-9,'no overshoot');assert.ok(Math.abs(s.x-1)<1e-3,'settles');
 }
 const a={x:0,v:0},b={x:0,v:0};for(let i=0;i<60;i++)damp(a,1,.2,1/60);for(let i=0;i<240;i++)damp(b,1,.2,1/240);assert.ok(Math.abs(a.x-b.x)<.01);
 const s={x:.5,v:0};let prev=s.x,step=0;for(let i=0;i<30;i++){damp(s,1,.2,1/60);step=Math.max(step,Math.abs(s.x-prev));prev=s.x;}assert.ok(step<.05,'a target jump glides');
});

import { createFloor } from '../web/character/floor.js';
test('grid floor shares the backdrop radiance, is antialiased by a mipmapped anisotropic tile, fades out, and follows the framed point', () => {
 const scene=new THREE.Scene(),bg=new THREE.Color('#e2dfda'),floor=createFloor(THREE,scene,bg);
 try {
  const src=floor.mesh.material.fragmentShader;
  assert.match(src,/texture2D/);assert.equal(floor.uniforms.uMap.value.anisotropy,2);assert.ok(floor.uniforms.uMap.value.generateMipmaps,'mipmapped: the sampler antialiases');assert.match(src,/smoothstep\(2\.4,10\./);assert.deepEqual(floor.uniforms.uBase.value.toArray(),bg.toArray(),'same linear base as the backdrop: no horizon seam');
  floor.update(new THREE.Vector3(2,.5,-1));assert.deepEqual(floor.mesh.position.toArray(),[2,0,-1]);assert.deepEqual(floor.uniforms.uCenter.value.toArray(),[2,-1]);
  floor.capture(true);assert.equal(floor.mesh.visible,false);floor.capture(false);assert.equal(floor.mesh.visible,true);
 } finally {floor.dispose();}
});
