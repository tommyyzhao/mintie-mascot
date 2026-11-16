import { PRIMITIVES, resolveRecipe } from './emoji.js';
import { FACE_YAW } from '../character/view.js';

const TAU=Math.PI*2;
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const clamp=(v,lo=0,hi=1)=>Math.min(hi,Math.max(lo,finite(v)));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>(t=clamp(t))*t*(3-2*t);
const ease=t=>1-(1-clamp(t))**3;
// Smoothstep attack: peak slope 1.5/attack, zero onset velocity (the old cubic-out had 3/attack at frame 0, a ~25% one-frame jump).
const attackCurve=smooth;
const lerpArray=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
const worldPoint=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?v:null;
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
function normalize(v) {
  const length=Math.hypot(...v);
  return length>1e-8?v.map(x=>x/length):[0,0,1];
}
function randomSource(seed) {
  let state=2166136261;
  for (const c of String(seed)) state=Math.imul(state^c.codePointAt(0),16777619);
  const random=()=>{
    let x=state=(state+0x6D2B79F5)>>>0;
    x=Math.imul(x^(x>>>15),x|1);
    x^=x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  };
  random.state=()=>state;random.restore=value=>{state=value;};
  return random;
}
function copy(p) {
  return {
    body:{...p.body,lean:[...p.body.lean],offset:[...p.body.offset]},
    eyes:{...p.eyes,gaze:[...p.eyes.gaze]},mouth:{...p.mouth},cheeks:{...p.cheeks},
    buds:p.buds.map(b=>({...b,dir:[...b.dir]})),
    fx:p.fx.map(f=>({...f})),tint:{...p.tint},accessory:p.accessory,
  };
}
function blend(a,b,t) {
  const p=copy(b);
  for (const key of ['squash','twist','wobble','puff']) p.body[key]=mix(a.body[key],b.body[key],t);
  p.body.lean=lerpArray(a.body.lean,b.body.lean,t);
  p.body.offset=lerpArray(a.body.offset,b.body.offset,t);
  for (const key of ['openL','openR','smileL','smileR','frown','pupil']) p.eyes[key]=mix(a.eyes[key],b.eyes[key],t);
  p.eyes.gaze=lerpArray(a.eyes.gaze,b.eyes.gaze,t);
  p.eyes.icon=t<0.5?a.eyes.icon:b.eyes.icon;
  for (const key of ['open','smile','width']) p.mouth[key]=mix(a.mouth[key],b.mouth[key],t);
  p.mouth.shape=t<0.5?a.mouth.shape:b.mouth.shape;
  p.cheeks.blush=mix(a.cheeks.blush,b.cheeks.blush,t);
  p.buds=[];
  for (const side of ['L','R']) {
    const from=a.buds.find(x=>x.side===side), to=b.buds.find(x=>x.side===side);
    if (!from && !to) continue;
    const start=from??{...to,reach:0}, end=to??{...from,reach:0};
    const bud={...end};
    for (const key of ['height','reach','bulge']) bud[key]=mix(start[key],end[key],t);
    bud.dir=lerpArray(start.dir,end.dir,t);
    bud.contact=t<0.5?start.contact:end.contact;
    if (bud.reach>0.0001) p.buds.push(bud);
  }
  // Merge effects by kind, preserving at most the three strongest during crossfades.
  const effects=new Map(a.fx.map(f=>[f.kind,f.intensity*(1-t)]));
  for (const f of b.fx) effects.set(f.kind,(effects.get(f.kind)??0)+f.intensity*t);
  p.fx=[...effects].map(([kind,intensity])=>({kind,intensity})).filter(f=>f.intensity>0.001)
    .sort((x,y)=>y.intensity-x.intensity).slice(0,3);
  p.tint.kind=t<0.5?a.tint.kind:b.tint.kind;
  p.tint.amount=a.tint.kind===b.tint.kind?mix(a.tint.amount,b.tint.amount,t):
    t<0.5?a.tint.amount*(1-2*t):b.tint.amount*(2*t-1);
  p.accessory=t<0.5?a.accessory:b.accessory;
  return p;
}
function bound(p,reduced) {
  p.body.squash=clamp(p.body.squash,-0.5,0.5);
  p.body.lean=p.body.lean.map(x=>clamp(x,-0.5,0.5));
  p.body.offset=p.body.offset.map((x,i)=>i===1?(reduced?0:clamp(x,0,1)):clamp(x,-0.5,0.5));
  p.body.twist=reduced?0:finite(p.body.twist);
  p.body.wobble=clamp(p.body.wobble); p.body.puff=clamp(p.body.puff,-0.3,0.4);
  for (const key of ['openL','openR']) p.eyes[key]=clamp(p.eyes[key],0,1.4);
  for (const key of ['smileL','smileR']) p.eyes[key]=clamp(p.eyes[key]);
  p.eyes.frown=clamp(p.eyes.frown,-1,1); p.eyes.pupil=clamp(p.eyes.pupil,0.6,1.5);
  p.eyes.gaze=p.eyes.gaze.map(x=>clamp(x,-1,1));
  p.mouth.open=clamp(p.mouth.open); p.mouth.smile=clamp(p.mouth.smile,-1,1); p.mouth.width=clamp(p.mouth.width);
  p.cheeks.blush=clamp(p.cheeks.blush);
  for (const b of p.buds) {
    for (const key of ['height','reach','bulge']) b[key]=clamp(b[key]);
    b.dir=normalize(b.dir.map(x=>clamp(x,-1,1)));
  }
  for (const f of p.fx) f.intensity=clamp(f.intensity);
  p.tint.amount=clamp(p.tint.amount);
  return p;
}
// One owner, one clock. `now` is optional for event-time admission between update()s.
export function createPerformer({seed=1,now}={}) {
  if (now!==undefined && typeof now!=='function') throw new TypeError('now must be a function');
  const random=randomSource(seed), phase=random()*TAU;
  let lastTime=0, serial=0, current=null, previous=null, idleOrigin=null;
  let nextBlink=2000+random()*4000, blinkStart=-1000, doubleBlink=false, cueBlink=-1e9, talkStart=null, talkFrom=null;
  let nextGaze=0, gazeStart=0, gazeFrom=[0,0], gazeTo=[0,0];
  const listenRandom=randomSource(`${seed}:listen`);
  let micro=null, blockedUntil=0, requestedMicro=null;
  let lastActivity=null, lastInputGaze=null, wakeStart=-Infinity;
  let listenStart=null, listenPhase=0, listenTilt=0, attention=0;
  let lastAmplitude=0, beatAt=-Infinity, beatAttemptAt=-Infinity, beatCount=0, suppressedBeats=0, thinkingAt=null, thought=0, thoughtSide=-1;
  let lookRequest=null, lookYaw=0, lookWeight=0, lookGaze=[0,0], lookInit=false;
  // Viewer awareness: eyes chase `inputs.attend` (camera + pointer offset) on a fast critically damped spring and lead the
  // slower body yaw; saccades and micro-drift keep them alive. Eye state is advanced once per update(), never in sample().
  const awareRandom=randomSource(`${seed}:aware`);
  const AMBIENT_FOLLOW=.5, BODY_PITCH=.18;
  let aw={eye:[{x:0,v:0},{x:0,v:0}],saccade:[0,0],saccadeAt:0,pitch:0,active:false};
  function attendAngles(inputs,self) {
    const point=worldPoint(inputs.attend);if(!point)return null;
    const delta=point.map((v,i)=>v-self[i]-(i===1?.65:0));
    return {yaw:Math.atan2(delta[0],delta[2]),pitch:Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))};
  }
  // Critically damped (no overshoot, continuous velocity): a cursor jump becomes a fast glide, never a one-frame snap.
  function spring(s,target,smoothTime,dt) {
    const w=2/smoothTime,x=w*dt,e=1/(1+x+.48*x*x+.235*x*x*x),change=s.x-target,temp=(s.v+w*change)*dt;
    s.v=(s.v-w*temp)*e;s.x=target+(change+temp)*e;
  }
  function aware(time,dt,inputs) {
    const self=worldPoint(inputs.self)||[0,0,0],a=attendAngles(inputs,self);
    aw.active=!!a;if(!a)return;
    const amount=inputs.reducedMotion?.35:1;
    if (time>=aw.saccadeAt) {
      // Fixational saccades: small, abrupt (the spring turns them into ~80ms flicks), 0.5-2.5 s apart.
      const big=awareRandom()<.18;
      aw.saccade=[(awareRandom()-.5)*(big?.30:.10),(awareRandom()-.5)*(big?.16:.05)];
      aw.saccadeAt=time+500+awareRandom()*2000;
    }
    const sec=time/1000,drift=[Math.sin(sec*1.9+phase)*.012+Math.sin(sec*5.3)*.005,Math.sin(sec*1.3+phase*2)*.010+Math.sin(sec*4.1)*.004];
    const target=[clamp(angle(a.yaw-FACE_YAW-(inputs.reducedMotion?0:lookYaw))/.65,-.9,.9),clamp(a.pitch/.65,-.5,.6)];
    aw.pitch=a.pitch;
    for (let i=0;i<2;i++) spring(aw.eye[i],target[i]+(aw.saccade[i]+drift[i])*amount,.07,dt/1000);
  }
  // Body faces the camera; the pointer offset turns it only part of the way, the eyes take the rest.
  const ambientYaw=(inputs,viewerYaw,self)=>{const a=attendAngles(inputs,self);return a?viewerYaw+angle(a.yaw-viewerYaw)*AMBIENT_FOLLOW:viewerYaw;};
  function orient(p,time,dt,inputs) {
    if (lookRequest && time>=lookRequest.until) lookRequest=null;
    const self=worldPoint(inputs.self)||[0,0,0], viewer=worldPoint(inputs.viewer)||[0,.65,7];
    const delta=viewer.map((v,i)=>v-self[i]-(i===1?.65:0)), viewerYaw=Math.atan2(delta[0],delta[2]);
    const explicit=lookRequest?.mode, mode=explicit||((inputs.listening||inputs.talking||clamp(inputs.speaking)>.02)&&!inputs.thinking?'viewer':null);
    let yaw=mode==='viewer'||!inputs.attend?viewerYaw:ambientYaw(inputs,viewerYaw,self), gaze=[0,0];
    if (mode==='away') { yaw+=.8;gaze=[.9,.10]; }
    if (mode==='down') gaze=[.12,-.9];
    if (mode==='up') gaze=[-.15,.9];
    if (mode==='touch') {
      const target=lookRequest.target.map((v,i)=>v-self[i]-(i===1?.65:0));
      yaw=Math.atan2(target[0],target[2]);
      gaze=[0,clamp(Math.atan2(target[1],Math.hypot(target[0],target[2]))/.65,-1,1)];
    }
    yaw-=FACE_YAW; // the face, not the body's forward axis, is what should point at the target
    if (!lookInit) {lookYaw=yaw;lookInit=true;} // start already facing it: no turn-in swing on load
    // ponytail: yaw plus two-axis eye aim, not an articulated neck; upgrade only with a neck rig.
    lookYaw+=angle(yaw-lookYaw)*(1-Math.exp(-dt/(inputs.reducedMotion?600:240)));
    lookWeight+=((mode?1:0)-lookWeight)*(1-Math.exp(-dt/160));
    const residual=angle(yaw-(inputs.reducedMotion?0:lookYaw)); // reduced motion never turns the body, so the eyes take the whole angle
    gaze[0]=clamp(gaze[0]+Math.sin(residual)*.9,-1,1);
    if(mode==='viewer') gaze[1]=clamp(Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))/.65,-.45,.45);
    lookGaze=lerpArray(lookGaze,gaze,1-Math.exp(-dt/110));
    p.body.twist+=lookYaw;
    if (aw.active&&!mode) p.body.lean[1]-=clamp(aw.pitch-.25,-.35,.35)*BODY_PITCH*(inputs.reducedMotion?.35:1);
    p.body.lean[1]+=(explicit==='down'?-.045:explicit==='away'?-.025:explicit?.025:0)*lookWeight*(inputs.reducedMotion?.35:1);
    p.eyes.gaze=lerpArray(p.eyes.gaze,lookGaze,lookWeight);
    return bound(p,!!inputs.reducedMotion);
  }
  function conversation(p,time,dt,inputs) {
    const amplitude=clamp(inputs.speaking), reduced=!!inputs.reducedMotion;
    if (amplitude>0.16 && amplitude-lastAmplitude>0.055 && time-(inputs.suppressBeats?beatAttemptAt:beatAt)>=300) {
      beatAttemptAt=time;
      if(inputs.suppressBeats) suppressedBeats++;
      else {beatAt=time;beatCount++;}
    }
    lastAmplitude=amplitude;
    // ponytail: energy accents, not phoneme/prosody inference; upgrade only with prosody data.
    const pulse=(age,duration)=>age>=0&&age<duration?Math.sin(Math.PI*age/duration)**2:0;
    const beat=reduced||inputs.suppressBeats?0:pulse(time-beatAt,260);
    const nod=reduced||!inputs.listening?0:pulse(time-finite(inputs.pauseAt,-Infinity),420);
    p.body.lean[1]+=0.04*beat+0.10*nod;p.body.squash+=0.03*beat+0.13*nod;
    if (beatCount%3===1) { p.eyes.openL+=0.045*beat;p.eyes.openR+=0.045*beat; }
    if (inputs.thinking && thinkingAt===null) { thinkingAt=time;thoughtSide*=-1; }
    const thoughtAge=time-(thinkingAt??time), target=inputs.thinking&&amplitude<=0.02?1:0;
    thought+=(target-thought)*(1-Math.exp(-dt/(target?100:180)));
    if (!inputs.thinking) thinkingAt=null;
    if (inputs.listening) p.eyes.gaze=p.eyes.gaze.map(v=>v*(1-0.95*attention));
    // ponytail: formulation owns gaze/tilt, never hands; alternate sides without a second animator.
    p.eyes.gaze=lerpArray(p.eyes.gaze,[thoughtSide*.85,.75],thought);
    const blink=inputs.thinking?pulse(thoughtAge,260)*.85:0;
    for (const key of ['openL','openR']) p.eyes[key]=mix(p.eyes[key],1.08,thought)*(1-blink);
    for (const key of ['smileL','smileR']) p.eyes[key]=mix(p.eyes[key],.10,thought);
    const amount=reduced?.35:1;
    p.body.lean[0]+=(thoughtSide*.12+Math.sin(thoughtAge/1000*1.8)*.025)*thought*amount;
    p.body.squash=mix(p.body.squash,p.body.squash+.02*amount,thought);
    if(inputs.received) {
      // Local uptake, not another recipe: hold the breath and viewer attention until pass 1.
      p.body.squash=-.025*(reduced?.35:1);p.body.lean[1]+=.025*(reduced?.35:1);
      p.eyes.openL=p.eyes.openR=1.08;
    }
    return bound(p,reduced);
  }
  function lifeState(time) {
    const quiet=lastActivity===null?0:time-lastActivity;
    return quiet>=75000?'asleep':quiet>=40000?'drowsy':'awake';
  }
  function activity(time) {
    if (lifeState(time)!=='awake') { wakeStart=time; micro=null; }
    lastActivity=time;
  }
  function microBehavior(p,time,amount,allowed) {
    if (!allowed) { micro=null; return; }
    if (requestedMicro!==null) {
      micro={kind:requestedMicro,start:time,duration:1400,gaze:[.45,.2]}; requestedMicro=null;
    }
    if (!micro) return;
    const u=(time-micro.start)/micro.duration;
    if (u>=1) {micro=null;return;}
    const anticipation=Math.sin(Math.PI*clamp(u/0.14))*(u<0.14?1:0);
    const w=smooth((u-0.14)/0.18)*(1-smooth((u-0.66)/0.34))*amount;
    const swing=Math.sin((u-0.14)*TAU*1.5)*w;
    p.body.squash+=0.009*anticipation*amount;
    switch (micro.kind) {
      case 0: // A thought catches their eye; the body follows a beat behind.
        p.eyes.gaze=lerpArray(p.eyes.gaze,micro.gaze,w);
        p.eyes.openL+=0.09*w;p.eyes.openR+=0.09*w;
        p.body.lean[0]+=micro.gaze[0]*0.045*w;
        break;
      case 1:
        p.body.squash+=0.026*swing;p.body.lean[0]+=0.022*swing;
        p.body.puff+=0.02*Math.sin((u-0.22)*TAU*1.5)*w;
        break;
      case 2: { // A bud pops out and waves hello, then tucks back.
        const bud=Math.sin(Math.PI*clamp((u-0.14)/0.72))**1.5*amount;
        p.buds=[{side:'R',height:0.48,reach:0.7*bud,dir:[0.5+0.3*Math.sin((u-0.3)*TAU*2.2)*bud,0.85,0.1],contact:'none',bulge:0}].filter(b=>b.reach>0.0001);
        p.eyes.gaze=lerpArray(p.eyes.gaze,[0.35,0.3],w);p.body.lean[0]-=0.012*w;p.body.squash-=0.02*w;
        p.eyes.smileL+=0.12*w;p.eyes.smileR+=0.12*w;
        break; }
      case 3:
        p.body.lean[0]+=0.028*swing;p.body.squash-=0.012*swing;
        p.eyes.openL*=1-0.22*w;p.eyes.openR*=1-0.22*w;
        p.eyes.smileL+=0.3*w;p.eyes.smileR+=0.3*w;
        break;
      case 4:
        p.body.puff+=0.045*w;p.body.squash-=0.04*w;
        p.eyes.openL*=1-0.16*w;p.eyes.openR*=1-0.16*w;
        break;
      case 5: {
        const close=center=>Math.sin(Math.PI*clamp((u-center)/0.11))**2;
        const blink=Math.max(close(0.24),close(0.46))*amount;
        p.eyes.openL*=1-blink;p.eyes.openR*=1-blink;
        p.eyes.smileL+=0.16*w;p.eyes.smileR+=0.16*w;
        break;
      }
    }
  }
  function idle(time,inputs) {
    const absoluteTime=time, state=lifeState(time), quiet=time-(lastActivity??time);
    if (idleOrigin===null) idleOrigin=time;
    time-=idleOrigin;
    // ponytail: a suspended tab skips obsolete events; resume with a fresh natural interval.
    if (time-nextBlink>10000) nextBlink=time+2000+random()*4000;
    if (time-nextGaze>10000) {nextGaze=time;gazeStart=time;}
    while (time>=nextBlink) {
      blinkStart=nextBlink; doubleBlink=random()<0.18;
      nextBlink+=(state==='drowsy'?4000:2000)+random()*4000;
    }
    const blinkAge=time-blinkStart, blinkDuration=state==='drowsy'?330:inputs.listening?280:150;
    const close=age=>age>=0&&age<blinkDuration?Math.sin(Math.PI*age/blinkDuration)**2:0;
    const blink=Math.max(close(blinkAge),doubleBlink?close(blinkAge-220):0);
    while (time>=nextGaze) {
      gazeFrom=gazeTo; gazeTo=[(random()-0.5)*0.7,(random()-0.5)*0.35];
      gazeStart=nextGaze; nextGaze+=1800+random()*2600;
    }
    const amount=inputs.reducedMotion?0.35:1, sec=time/1000;
    const drowsy=inputs.needsDrowsy?1:0;
    const breath=TAU*(sec*0.25-Math.max(0,quiet-40000)/1000*0.06-Math.max(0,quiet-75000)/1000*0.01)+phase;
    const lids=1-0.43*drowsy;
    const p={
      // Two incommensurate sines plus a slow depth swell: breathing never repeats exactly (the single sine did every 4 s).
      body:{squash:(Math.sin(breath)*(0.02+0.006*drowsy)*(1+.22*Math.sin(sec*.113+phase*3))+.004*Math.sin(sec*.43+phase*2))*amount,
        lean:[Math.sin(sec*0.37+phase)*0.008*amount*(1-0.75*drowsy),0],
        offset:[0,0,0],twist:0,wobble:0.035*amount*(1-0.7*drowsy),puff:0},
      eyes:{openL:lids*(1-blink),openR:lids*(1-blink),
        smileL:0,smileR:0,frown:0,
        gaze:lerpArray(aw.active?[aw.eye[0].x,aw.eye[1].x]:lerpArray(gazeFrom,gazeTo,smooth((time-gazeStart)/1200)),[0,-0.36],drowsy*0.85),
        pupil:1,icon:'none'},
      mouth:{open:0,smile:0,width:0.5,shape:'none'},cheeks:{blush:0},buds:[],
      fx:[],tint:{kind:'none',amount:0},accessory:'none',
    };
    microBehavior(p,absoluteTime,amount,!inputs.needsDrowsy&&!current&&absoluteTime>=blockedUntil&&
      !inputs.listening&&clamp(inputs.speaking)<=0.02&&absoluteTime-wakeStart>=300);
    if (inputs.listening && listenStart===null) {
      listenStart=absoluteTime;listenPhase=listenRandom()*TAU;listenTilt=(listenRandom()<0.5?-1:1)*0.025;
    }
    if (attention>0.0001) {
      const age=absoluteTime-(listenStart??absoluteTime), w=attention;
      p.body.lean[1]+=0.05*w*amount;
      p.body.lean[0]+=listenTilt*Math.max(0,Math.sin(age/6700*TAU+listenPhase))**4*w*amount;
      p.eyes.gaze=p.eyes.gaze.map(v=>v*(1-0.95*w));
      p.eyes.openL+=0.08*w;p.eyes.openR+=0.08*w;
      p.eyes.smileL+=0.1*w;p.eyes.smileR+=0.1*w;
      p.body.squash-=0.012*w*amount;
    } else if (!inputs.listening) listenStart=null;
    const wakeAge=absoluteTime-wakeStart;
    if (wakeAge>=0&&wakeAge<300) {
      const pop=Math.sin(Math.PI*wakeAge/300);
      p.eyes.openL=mix(p.eyes.openL,1.2,pop);p.eyes.openR=mix(p.eyes.openR,1.2,pop);
      p.body.squash+=0.055*Math.sin(wakeAge/300*TAU)*amount;
      p.body.offset[1]+=0.025*pop*amount;p.body.puff+=0.05*pop*amount;
    }
    // Active listening looks at the speaker, not a wandering pointer.
    if (Array.isArray(inputs.gaze)) p.eyes.gaze=inputs.gaze.map(v=>clamp(v,-1,1)*(1-0.95*attention));
    return p;
  }
  function envelope(age,r) {
    const attack=170, release=380, releaseAt=r.durationMs-release;
    if (age<r.anticipationMs) return {anticipation:true,w:Math.sin(Math.PI*clamp(age/r.anticipationMs)),hold:0,release:1};
    const elapsed=age-r.anticipationMs, inWeight=attackCurve(elapsed/attack);
    const outWeight=1-smooth((age-releaseAt)/release);
    return {anticipation:false,w:inWeight*outWeight,hold:elapsed,release:outWeight};
  }
  function perform(p,run,age,inputs) {
    const r=run.recipe, env=envelope(age,r), b=PRIMITIVES.body[r.body], f=PRIMITIVES.face[r.face];
    const amount=inputs.reducedMotion?0.35:1, w=env.w;
    if (env.anticipation) {
      // A little counterpose, before the sound: dip before a hop; squeeze before a laugh.
      p.body.squash+=(r.loop==='jump'?.16:b.offset[1]>0?0.10:-Math.sign(b.squash||-1)*0.035)*w*amount;
      p.body.lean[0]-=b.lean[0]*0.18*w*amount;
      p.body.lean[1]-=b.lean[1]*0.18*w*amount;
      p.eyes.openL*=1-0.16*w; p.eyes.openR*=1-0.16*w;
      return p;
    }
    const sec=env.hold/1000, osc=Math.sin(sec*TAU*b.hz), motion=r.loop;
    const attackPhase=clamp(env.hold/240);
    const overshoot=Math.sin(attackPhase*Math.PI)*0.18;
    const gain=w*(1+overshoot), settle=age>r.durationMs-380?
      Math.sin((age-(r.durationMs-380))*0.035)*0.025*w:0;
    p.body.squash+=b.squash*gain*amount+settle*amount;
    p.body.lean[0]+=b.lean[0]*gain*amount; p.body.lean[1]+=b.lean[1]*gain*amount;
    p.body.offset=b.offset.map((v,i)=>p.body.offset[i]+v*w*amount);
    p.body.twist+=b.twist*gain*amount; p.body.puff+=b.puff*w*amount;
    p.body.wobble=mix(p.body.wobble,b.wobble,w)*amount;
    const loopGain=w*smooth(env.hold/220)*amount;
    if (motion==='bounce') {
      p.body.squash+=osc*0.055*loopGain;
      p.body.offset[1]=b.offset[1]*Math.abs(Math.sin(Math.PI*sec*b.hz))*w*amount;
    }
    if (motion==='shake') p.body.lean[0]+=osc*0.055*loopGain;
    if (motion==='roll') {p.body.lean[0]+=osc*0.10*loopGain;p.body.twist+=Math.cos(sec*TAU*b.hz)*0.1*loopGain;}
    if (motion==='sway') p.body.lean[0]+=osc*0.09*loopGain;
    if (motion==='breathe') p.body.squash+=osc*0.035*loopGain;
    if (motion==='nod') p.body.lean[1]+=osc*0.075*loopGain;
    if (motion==='no') p.body.twist+=osc*0.15*loopGain;
    if (motion==='stomp') {p.body.squash+=Math.max(0,osc)*0.07*loopGain;p.body.lean[0]+=osc*0.045*loopGain;}
    if (motion==='spin') p.body.twist+=osc*0.15*loopGain;
    if (motion==='float') p.body.offset[1]+=(0.5+osc*0.5)*0.05*loopGain;
    if (motion==='jump') {
      // Physics owns translation; this catalog move only supports the spring/settle silhouette.
      const launch=Math.exp(-env.hold/180), landing=Math.exp(-(((env.hold-700)/140)**2));
      p.body.squash+=(-.10*launch+.12*landing)*w*amount;
    }
    if (motion==='turn') p.body.twist=TAU*smooth(env.hold/(r.durationMs-r.anticipationMs-380));
    if (motion==='yes' || motion==='headshake') {
      const u=clamp(env.hold/(r.durationMs-r.anticipationMs-380)), wave=Math.sin(u*TAU*2.5)*Math.sin(Math.PI*u)*amount;
      if (motion==='yes') {const dip=Math.sin(u*Math.PI*3)**2*Math.sin(Math.PI*u)*amount;p.body.lean[1]+=0.35*dip;p.body.squash+=0.40*dip;}
      else p.body.twist+=0.48*wave;
    }
    for (const key of ['openL','openR','smileL','smileR','frown','pupil']) p.eyes[key]=mix(p.eyes[key],f[key],w);
    if (f.gaze.some(v=>v!==0) && (!Array.isArray(inputs.gaze) || r.face==='roll' || r.face==='peek'))
      p.eyes.gaze=lerpArray(p.eyes.gaze,f.gaze,w);
    p.eyes.icon=w>0.25?f.icon:'none';
    const m=PRIMITIVES.mouth[r.mouth];
    for (const key of ['open','smile','width']) p.mouth[key]=mix(p.mouth[key],m[key],w);
    p.mouth.shape=w>0.08?m.shape:'none'; p.cheeks.blush=f.blush*w;
    const hands=PRIMITIVES.buds[r.buds], growth=ease(env.hold/235);
    const reachGain=growth+Math.sin(Math.PI*clamp((env.hold-120)/180))*0.10;
    p.buds=hands.poses.map(template=>{
      const h={...template};
      h.reach=template.reach*reachGain*env.release;
      h.dir=[...template.dir];
      const wave=Math.sin(sec*TAU*hands.hz)*amount*smooth(env.hold/240), sign=h.side==='R'?1:-1;
      if (hands.motion==='wave') {h.dir[0]+=wave*0.35;}
      if (hands.motion==='push') {h.reach*=0.85+wave*0.15;}
      if (hands.motion==='pinch') h.dir[1]+=wave*0.25;
      if (hands.motion==='wag') h.dir[0]+=wave*0.15;
      if (hands.motion==='clap') {h.dir[0]=-sign*(0.05+0.45*(1-wave)*0.5);h.reach*=0.9+0.1*wave;}
      if (hands.motion==='raise') {h.dir[1]+=wave*0.12;h.reach*=0.93+0.07*wave;}
      if (hands.motion==='handshake') {h.dir[1]+=wave*(h.side==='R'?0.14:0.03);h.reach*=0.96+0.04*wave;}
      if (hands.motion==='flex') h.bulge*=0.9+wave*0.1;
      if (hands.motion==='hug') {h.reach*=0.95+wave*0.05;}
      if (hands.motion==='peek') h.dir[0]+=wave*0.08;
      return h;
    }).filter(h=>h.reach>0.0001);
    p.fx=PRIMITIVES.fx[r.fx].map(effect=>({kind:effect.kind,intensity:effect.intensity*w*(inputs.reducedMotion?0.4:1)}));
    const tint=PRIMITIVES.tint[r.tint]; p.tint={kind:w>0.03?tint.kind:'none',amount:tint.amount*w};
    p.accessory=w>0.12?r.accessory:'none';
    return p;
  }
  function eventTime(opts) {
    const time=opts?.nowMs ?? (now?now():lastTime);
    if (!Number.isFinite(time) || time<0) throw new RangeError('Invalid performance time');
    return Math.max(lastTime,time);
  }
  function sample(time,inputs) {
    let p=idle(time,inputs);
    if (current) {
      const age=time-current.start+(current.elapsedMs??0);
      if (current.cancelAt!==null) {
        const t=smooth((time-current.cancelAt)/350);
        if (t>=1) current=null;
        else if (current.cancelFrom) p=blend(current.cancelFrom,p,t);
      } else if (current.sustained && (time>=current.sustainEnd || !current.sustainUntil())) {
        current.cancelAt=time;current.cancelFrom=previous?copy(previous):p;
        blockedUntil=Math.max(blockedUntil,time+2350);
        return sample(time,inputs);
      } else if (age>=0) {
        const peak=current.recipe.durationMs-600;
        const sustain=current.sustainUntil && time<current.sustainEnd && current.sustainUntil();
        if (sustain && age>=peak) {
          current.sustained=true;
          // ponytail: hold the readable pose, not repeated hops/spins; a quiet loop carries the feeling.
          const w=smooth((age-peak)/380), rest=copy(p);
          p=blend(rest,perform(p,current,peak,inputs),1-.35*w);
          const amount=inputs.reducedMotion?.35:1, loop=Math.sin((age-peak)/1000*2)*w*amount;
          p.body.offset[1]*=1-w;p.body.lean[0]+=.018*loop;p.body.squash+=.008*loop;
          for (const b of p.buds) b.dir[0]+=.07*loop;
        } else if (age>=current.recipe.durationMs) current=null;
        else p=perform(p,current,age,inputs);
        const crossfade=current?.sustainUntil?Math.max(120,current.recipe.anticipationMs+120):120;
        if (current?.from && time-current.start<crossfade) p=blend(current.from,p,smooth((time-current.start)/crossfade));
        else if (current) current.from=null;
      }
    }
    return bound(p,!!inputs.reducedMotion);
  }
  function saveState() {
    return {values:[lastTime,serial,current?{...current}:null,previous,idleOrigin,nextBlink,blinkStart,doubleBlink,
      nextGaze,gazeStart,gazeFrom,gazeTo,micro,requestedMicro,blockedUntil,lastActivity,lastInputGaze,wakeStart,
      listenStart,listenPhase,listenTilt,attention,lastAmplitude,beatAt,beatAttemptAt,beatCount,suppressedBeats,
      thinkingAt,thought,thoughtSide,lookRequest,lookYaw,lookWeight,lookGaze,talkStart,talkFrom,lookInit],aw:{...aw,eye:aw.eye.map(e=>({...e})),saccade:[...aw.saccade]},random:random.state(),listen:listenRandom.state(),aware:awareRandom.state()};
  }
  function restoreState(s) {
    [lastTime,serial,current,previous,idleOrigin,nextBlink,blinkStart,doubleBlink,
      nextGaze,gazeStart,gazeFrom,gazeTo,micro,requestedMicro,blockedUntil,lastActivity,lastInputGaze,wakeStart,
      listenStart,listenPhase,listenTilt,attention,lastAmplitude,beatAt,beatAttemptAt,beatCount,suppressedBeats,
      thinkingAt,thought,thoughtSide,lookRequest,lookYaw,lookWeight,lookGaze,talkStart,talkFrom,lookInit]=s.values;
    random.restore(s.random);listenRandom.restore(s.listen);awareRandom.restore(s.aware);aw=s.aw;
  }
  const api = {
    // Synchronous dry run; restore all engine/PRNG state before returning. Never called by update().
    predictStroke(value,{nowMs=lastTime,inputs={},thresholds}={}) {
      if(!thresholds)throw new TypeError('Missing stroke thresholds');
      const saved=saveState();
      const channels=p=>[...p.body.lean,p.body.squash,p.body.twist,...p.body.offset,
        Math.max(0,...p.buds.filter(b=>b.side==='L').map(b=>b.reach)),Math.max(0,...p.buds.filter(b=>b.side==='R').map(b=>b.reach))];
      try {
        // Measure from cue onset, including the same local layers as the sampled poses.
        const origin=channels(own.update(nowMs,inputs)),run=own.play(value,{nowMs,sustainUntil:()=>true});
        const curve=[];
        for(let age=0;age<=run.durationMs;age+=10) {
          const values=channels(own.update(nowMs+age,inputs));
          curve.push(Math.max(0,...values.map((v,i)=>Math.abs(v-origin[i])/thresholds[i])));
        }
        // Stroke = first arrival at 90% of the peak: plateaus (✨ holds ~1 s) must not pick an arbitrary hold frame.
        const peak=Math.max(...curve);
        return peak>1 ? curve.findIndex(v=>v>=.9*peak)*10 : null;
      } finally {restoreState(saved);}
    },
    // Blink at a phrase boundary (speaker blinks cluster at turn/phrase units). Ignored within 1.2 s of the last blink.
    blink(nowMs=lastTime) {
      const at=nowMs-(idleOrigin??nowMs);
      if(at-blinkStart<1200)return false;
      blinkStart=cueBlink=at;doubleBlink=false;nextBlink=Math.max(nextBlink,at+2000);return true;
    },
    micro(kind) {
      const index=['look','wiggle','bud-wave','hum-sway','stretch','double-blink'].indexOf(kind);
      if(index<0) throw new RangeError('Invalid micro behavior');
      requestedMicro=index;
    },
    look(mode,{target,durationMs=2500}={}) {
      if (mode===null) { lookRequest=null;return; }
      if (!['viewer','away','down','up','touch'].includes(mode)) throw new RangeError('Invalid look mode');
      if (!Number.isFinite(durationMs)||durationMs<0||mode==='touch'&&!worldPoint(target)) throw new RangeError('Invalid look options');
      const at=eventTime();
      lookRequest={mode,target:mode==='touch'?[...target]:null,until:at+durationMs};activity(at);
    },
    play(value,opts) {
      const reflex=opts?.reflex===true;
      if (opts?.sustainUntil!==undefined && typeof opts.sustainUntil!=='function') throw new TypeError('Invalid sustainUntil');
      if (opts?.elapsedMs!==undefined && (!Number.isFinite(opts.elapsedMs)||opts.elapsedMs<0)) throw new RangeError('Invalid elapsedMs');
      let source=value;
      // The shared resolver keeps its normal 80ms floor; only reflex admission relaxes it.
      const shortReflex=reflex&&value&&typeof value==='object'&&!Array.isArray(value)&&
        Number.isFinite(value.anticipationMs)&&value.anticipationMs>=0&&value.anticipationMs<80;
      if (shortReflex) {
        if (value.durationMs!==undefined&&(!Number.isFinite(value.durationMs)||value.durationMs<value.anticipationMs+700))
          throw new RangeError('Invalid timing');
        source={...value,anticipationMs:80};
        if (value.durationMs<780) source.durationMs=780;
      }
      const resolved=resolveRecipe(source);
      const recipe=reflex?{...resolved,anticipationMs:0,
        durationMs:shortReflex&&value.durationMs!==undefined?value.durationMs:resolved.durationMs}:resolved;
      const start=eventTime(opts);
      activity(start);micro=null;blockedUntil=start+recipe.durationMs+2000;
      // Validation happens before preemption. Consecutive plays without a tick still blend.
      const from=previous?copy(previous):current?sample(start,{}):null;
      const id=++serial, handle={id,anticipationMs:recipe.anticipationMs,durationMs:recipe.durationMs};
      current={id,emoji:typeof value==='string'?value:null,recipe,start,from,cancelAt:null,
        sustainUntil:opts?.sustainUntil,sustainEnd:start+6000,elapsedMs:Math.min(opts?.elapsedMs??0,recipe.durationMs-600)};
      return handle;
    },
    cancel(id) {
      if (!current || current.id!==id || current.cancelAt!==null) return false;
      const at=eventTime(),from=previous?copy(previous):sample(at,{});
      if (!current) return false;
      current.cancelAt=at; current.cancelFrom=from;
      blockedUntil=Math.max(blockedUntil,at+2350);
      return true;
    },
    update(nowMs,inputs={}) {
      const time=Math.max(lastTime,finite(nowMs,lastTime)), dt=Math.min(250,time-lastTime); lastTime=time;
      if (!inputs || typeof inputs!=='object') inputs={};
      attention+=((inputs.listening?1:0)-attention)*(1-Math.exp(-dt/(inputs.listening?70:220)));
      if (lastActivity===null) lastActivity=time;
      let gazeActivity=false;
      if (Array.isArray(inputs.gaze)) {
        const gaze=[clamp(inputs.gaze[0],-1,1),clamp(inputs.gaze[1],-1,1)];
        gazeActivity=lastInputGaze===null||Math.hypot(gaze[0]-lastInputGaze[0],gaze[1]-lastInputGaze[1])>0.025;
        if (gazeActivity) lastInputGaze=gaze;
      } else lastInputGaze=null;
      if (gazeActivity||inputs.listening||clamp(inputs.speaking)>0.02) activity(time);
      aware(time,dt,inputs);
      const p=sample(time,inputs); previous=copy(p);
      conversation(p,time,dt,inputs);
      orient(p,time,dt,inputs);
      // Cue blinks (realizer) sit above performance faces, which otherwise blend the idle blink away while talking.
      const cueAge=time-(idleOrigin??time)-cueBlink;
      if (cueAge>=0&&cueAge<150) {const b=Math.sin(Math.PI*cueAge/150)**2;p.eyes.openL*=1-b;p.eyes.openR*=1-b;if(b>.5&&p.eyes.icon!=='tear')p.eyes.icon='none';} // icon eyes ignore the lid, so hide the icon while closed
      // Local layers stay out of preemption snapshots; audio owns the mouth last.
      const speaking=clamp(inputs.speaking), talking=speaking>0 || inputs.talking;
      // Ease an open expression mouth into the audio mouth over 60ms, not one frame.
      if (talking && talkStart===null) {talkStart=time;talkFrom=p.mouth.shape!=='none' && p.mouth.open>.08?{...p.mouth}:null;} else if (!talking) talkStart=null;
      if (talking) {
        // Audio owns the aperture, including a sustained laugh or a closed-mouth cue.
        const from=talkFrom && time-talkStart<60 ? talkFrom : null;
        p.mouth.open=speaking;p.mouth.width=0.45+speaking*0.45;
        p.mouth.shape='o';p.mouth.smile=speaking*0.25;
        if (from) {const w=smooth((time-talkStart)/60);for(const k of ['open','width','smile'])p.mouth[k]=mix(from[k],p.mouth[k],w);if(w<.5)p.mouth.shape=from.shape;}
      }
      return p;
    },
    state() { return lifeState(lastTime); },
    get suppressedBeats() { return suppressedBeats; },
    active() {
      return current?{id:current.id,emoji:current.emoji,anticipationMs:current.recipe.anticipationMs,
        durationMs:current.recipe.durationMs,startMs:current.start,cancelling:current.cancelAt!==null}:null;
    },
  };
  // Dry runs use the unwrapped methods: trace instrumentation wraps api.play and must not record simulated admissions.
  const own={play:api.play,update:api.update};
  return api;
}
