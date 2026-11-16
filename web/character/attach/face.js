import { studio } from '../jelly.js';
// Analytic glass relief keeps continuous lids/gaze without extra eye geometry.
const vertex = `varying vec2 vUv;varying vec3 vWorld,vRight,vUp,vFaceNormal;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xyz;vRight=normalize(modelMatrix[0].xyz);vUp=normalize(modelMatrix[1].xyz);vFaceNormal=normalize(modelMatrix[2].xyz);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const common = `
varying vec2 vUv;varying vec3 vWorld,vRight,vUp,vFaceNormal;
float coverage(float d){return 1.-smoothstep(-fwidth(d),fwidth(d),d);}
float ellipse(vec2 p,vec2 r){return (length(p/r)-1.)*min(r.x,r.y);}
float segment(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));}
float lineCurve(vec2 p,float bend,float wave){float y=bend*(p.x*p.x-.48)+wave*sin(p.x*8.);return max(abs(p.y-y)-.042,abs(p.x)-.87);}
float heart(vec2 p){p=vec2(abs(p.x)*.72,(p.y+.85)*.68);if(p.x+p.y>1.)return length(p-vec2(.25,.75))-.35355339;return sqrt(min(dot(p-vec2(0.,1.),p-vec2(0.,1.)),dot(p-.5*max(p.x+p.y,0.),p-.5*max(p.x+p.y,0.))))*sign(p.x-p.y);}
float star(vec2 p){float a=atan(p.y,p.x)-1.5707963;float r=.48+.20*cos(5.*a);return length(p)-r;}
`;
const eyeFragment = common + studio + `
uniform float openness,joy,frown,pupil,side,icon,brow,time,sparkle;
uniform vec2 gaze;
void main(){
 vec2 socket=(vUv-.5)*2.6;
 vec2 p=socket;p.x-=gaze.x*.22;p.y-=gaze.y*.46;
 float wide=clamp(openness,0.,1.4), shut=1.-smoothstep(.08,.45,wide);
 vec2 r=vec2(.59*(.82+.18*pupil),max(.025,.86*min(wide,1.32)*(.73+.27*pupil)));
 float oval=ellipse(p,r);
 // A lower lid lifts into a smiling crescent; upper lid slopes inward for anger.
 float lidBlend=smoothstep(.0,.25,abs(frown));
 float lower=-1.6+joy*(1.20+.28*(1.-p.x*p.x));
 float lid=p.y-(mix(1.6,.72*wide,lidBlend)+frown*side*p.x*.55-abs(frown)*.12);
 float d=max(oval,max(lower-p.y,lid));
 float arcY=joy*(.20-.66*p.x*p.x)+(1.-joy)*(-.075+.025*p.x*p.x);
 float closed=max(abs(p.y-arcY)-.043,abs(p.x)-.58);
 d=mix(d,closed,shut);
 vec2 bead=p/vec2(r.x,max(.23,r.y));
 float z=sqrt(max(.015,1.-dot(bead,bead)));
 vec3 n=normalize(vRight*bead.x+vUp*bead.y+vFaceNormal*z),view=normalize(cameraPosition-vWorld);
 float facing=max(0.,dot(n,view)),fresnel=.052+.948*pow(1.-facing,5.);
 vec2 iris=bead+vec2(dot(view,vRight),dot(view,vUp))*.18*z;
 float rim=exp(-pow((length(iris)-.70)*8.,2.));
 vec3 color=vec3(.002,.003,.002)+vec3(.007,.012,.005)*rim;
 color+=min(studioLight(reflect(-view,n))*fresnel,vec3(.065))*(1.-shut)*smoothstep(.70,1.,length(bead));
 color*=1.-.65*smoothstep(.83,1.03,length(bead));
 color=mix(color,vec3(.012,.019,.009),shut);
 // Reference catchlights in eye-local space: tall upper-left oval, round lower-right dot.
 // Decal width/height=.242/.354; compensate the dot so it stays round on screen.
 float twinkle=sin(time*1.35+side*1.7),size=1.+.025*twinkle;
 float openGlass=(1.-shut)*(1.-smoothstep(.72,.98,joy));
 float big=coverage(ellipse(bead-vec2(-.30,.36),vec2(.40,.45)*size));
 float dotLight=coverage(ellipse(p-r*vec2(.38,-.53),vec2(.13,.089)*size));
 float catchlight=max(big,dotLight*(1.-smoothstep(.25,.65,joy)))*openGlass;
 color=mix(color,vec3(.94+.04*twinkle),catchlight);
 // A short four-point star, never a lens streak; also flashes on recipe heart/star eyes.
 vec2 flare=(p-r*vec2(.48,.48))*vec2(1.,1.463);
 float flareSize=.25*sparkle;
 float flareD=length(flare)+2.8*sqrt(abs(flare.x*flare.y))-flareSize;
 float flareA=coverage(flareD)*sparkle*smoothstep(.25,.45,wide);
 if(icon>.5){
  vec2 q=p/vec2(.68,.8);float di=1.;vec3 ink=vec3(.98,.25,.40);
  if(icon<1.5){di=heart(q);}
  else if(icon<2.5){di=star(q);ink=vec3(1.,.72,.06);}
  else if(icon<3.5){float a=atan(q.y,q.x),r2=length(q);float phase=fract((r2*11.-a)/6.2831853);float band=min(phase,1.-phase)*6.2831853;di=max((band-.23)*.09,r2-.87);di=min(di,r2-.075);ink=vec3(.12,.16,.12);}
  else if(icon<4.5){di=min(segment(q,vec2(-.53,-.60),vec2(.53,.60)),segment(q,vec2(-.53,.60),vec2(.53,-.60)))-.11;ink=vec3(.10,.15,.10);}
  else if(icon<5.5){ // Tears leave the expressive lid visible.
   vec2 t=p-vec2(.28,-.48);float drop=ellipse(t,vec2(.17,.36));
   float a=coverage(drop);color=mix(color,vec3(.32,.78,.95),a*.95);
   gl_FragColor=vec4(color,max(coverage(d),a));
   #include <colorspace_fragment>
   return;
  }else{float s=segment(q,vec2(-.32,.40),vec2(.3,.40));s=min(s,segment(q,vec2(-.32,.40),vec2(-.32,.03)));s=min(s,segment(q,vec2(-.32,.03),vec2(.32,.03)));s=min(s,segment(q,vec2(.32,.03),vec2(.32,-.40)));s=min(s,segment(q,vec2(.32,-.40),vec2(-.32,-.40)));s=min(s,segment(q,vec2(0.,-.69),vec2(0.,.69)));di=s-.075;ink=vec3(.16,.34,.15);}
  float a=coverage(di);
  color=ink*(.62+.28*z)+studioLight(reflect(-view,n))*.052;
  if(icon<2.5){color=mix(color,vec3(1.),flareA);a=max(a,flareA);}
  gl_FragColor=vec4(color,a);
   #include <colorspace_fragment>
   return;
 }
 float browD=max(abs(socket.y-(.98+brow*.14+.14*side*socket.x))-.033,abs(socket.x)-.46);
 float browA=coverage(browD)*brow;
 color=mix(color,vec3(.12,.19,.09),browA);
 color=mix(color,vec3(1.),flareA);
 gl_FragColor=vec4(color,max(max(coverage(d),browA),flareA));
 #include <colorspace_fragment>
}`;
const mouthFragment = common + `
uniform float opening,smile,width,visible;
uniform float roundness,wave,cat,kiss,teeth,tongue,zip;
void main(){
 vec2 p=(vUv-.5)*2.;p.x/=mix(.78,1.,width);p.y+=.10;
 float bend=smile*.67;
 float curve=bend*(p.x*p.x-.48)+wave*.105*sin(p.x*9.);
 float halfH=.036+opening*.69;
 float upper=curve+halfH*(1.-.22*abs(smile));
 float lower=curve-halfH*sqrt(max(0.,1.-pow(p.x/.9,2.)));
 float outline=max(max(p.y-upper,lower-p.y),abs(p.x)-.87);
 float oval=ellipse(p,vec2(mix(.72,.90,width),.035+sqrt(opening)*.92));
 float d=mix(outline,oval,roundness);
 float catY=-.10+.22*pow(abs(p.x)*2.-.8,2.);
 float catD=max(abs(p.y-catY)-.043,abs(p.x)-.84);
 d=mix(d,catD,cat);
 float kissD=min(segment(p,vec2(-.30,.25),vec2(.18,0.)),segment(p,vec2(.18,0.),vec2(-.30,-.25)))-.047;
 d=mix(d,kissD,kiss);
 float flatLine=lineCurve(p,0.,0.);
 d=mix(d,flatLine,zip);
 // ponytail: SDF candy relief on the existing decal, not a cavity mesh; lip catches the studio light.
 float lip=exp(-pow((d+.012)/.065,2.));
 vec3 col=mix(vec3(.009,.022,.004),vec3(.045,.075,.010),smoothstep(-.35,.35,p.y));
 col=mix(col,vec3(.42,.55,.10),lip*.85);
 col+=vec3(.30,.36,.12)*lip*(1.-smoothstep(-.20,.12,p.y));
 float inside=coverage(d-.018);
 float tongueMask=coverage(ellipse(p-vec2(.12,-.40-opening*.08),vec2(.38,.22+opening*.12)))*tongue;
 col=mix(col,vec3(1.,.43,.51),tongueMask);
 float tongueGroove=coverage(segment(p,vec2(.12,-.48),vec2(.12,-.25))-.012)*tongue;
 col=mix(col,vec3(.80,.20,.28),tongueGroove*.7);
 float toothBand=coverage(abs(p.y-(upper-.13))-.12)*teeth;
 col=mix(col,vec3(1.,.98,.85),toothBand);
 float seams=coverage(abs(sin((p.x+.1)*12.))-.075)*toothBand;
 col=mix(col,vec3(.40,.33,.23),seams*.5);
 float zipTooth=coverage(max(max(abs(fract((p.x+.9)*6.)-.5)-.14,abs(p.y)-.13),abs(p.x)-.87))*zip;
 col=mix(col,vec3(.93,.86,.64),zipTooth);inside=max(inside,zipTooth);
 // Tongue-out extends below the mouth rather than getting clipped by its contour.
 float outTongue=coverage(ellipse(p-vec2(.18,-.35),vec2(.27,.35)))*max(0.,tongue-.5)*2.;
 if(outTongue>0.){col=mix(col,vec3(1.,.43,.51),outTongue);inside=max(inside,outTongue);}
 gl_FragColor=vec4(col,inside*visible);
 #include <colorspace_fragment>
}`;
const ICONS=['none','heart','star','spiral','cross','tear','money'];
const SHAPES={none:[0,0,0,0,0,0,0,0],smile:[0,0,0,0,0,.38,0,1],o:[1,0,0,0,0,0,0,1],laugh:[0,0,0,0,0,.47,0,1],frown:[0,0,0,0,0,0,0,1],wobble:[0,1,0,0,0,0,0,1],flat:[0,0,0,0,0,0,0,1],tongue:[0,0,0,0,0,1,0,1],kiss:[0,0,0,1,0,0,0,1],teeth:[0,0,0,0,1,0,0,1],cat:[0,0,1,0,0,0,0,1],zip:[0,0,0,0,0,0,1,1]};
const keys=['roundness','wave','cat','kiss','teeth','tongue','zip','visible'];
export function createFace(THREE, plane, materialOptions) {
 const make=(fragment,values)=>new THREE.Mesh(plane,new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}])),transparent:true,depthWrite:false,depthTest:true,...materialOptions}));
 const eyes=[-1,1].map(side=>make(eyeFragment,{openness:1,joy:0,frown:0,pupil:1,side,icon:0,brow:0,time:0,sparkle:0,gaze:new THREE.Vector2()}));
 const mouth=make(mouthFragment,{opening:0,smile:0,width:.5,visible:0,roundness:0,wave:0,cat:0,kiss:0,teeth:0,tongue:0,zip:0});
 const state=SHAPES.none.slice();let last=null,emotion=0,sparkAt=-Infinity;
 return {eyes,mouth,update(pose,now,aim){
  // Discrete recipe names become continuous contour weights. Reset only on a rewound clock.
  const reset=last===null||now<last;
  const dt=reset?0:Math.min(64,now-last);const a=reset?1:1-Math.exp(-dt/48);last=now;
  if(reset){emotion=0;sparkAt=-Infinity;}
  // Hysteresis prevents sustained smiles/awe or tiny pose oscillations from firing repeatedly.
  const e=pose.eyes;
  const next=(Math.min(e.smileL,e.smileR)>((emotion&1) ? .35 : .55)?1:0)
   |(Math.min(e.openL,e.openR)>((emotion&2) ? 1.08 : 1.17)&&e.frown>=-.1?2:0)
   |(e.icon==='heart'?4:e.icon==='star'?8:0);
  if(next&~emotion)sparkAt=now;
  emotion=next;
  eyes.forEach((eye,i)=>{const u=eye.material.uniforms;u.openness.value=e[i?'openR':'openL'];u.joy.value=e[i?'smileR':'smileL'];u.frown.value=e.frown;u.pupil.value=e.pupil;u.gaze.value.set(e.gaze[0]+(aim?.[i]??0),e.gaze[1]);u.icon.value=Math.max(0,ICONS.indexOf(e.icon));u.brow.value=(i?1:0)*Math.max(0,e.frown)*Math.min(1,Math.abs(e.openL-e.openR)*3);
   u.time.value=now/1000;const age=(now-sparkAt-i*65)/640;
   u.sparkle.value=age>0&&age<1?Math.sin(Math.PI*age)**2:0;
  });
  const m=pose.mouth,u=mouth.material.uniforms,target=SHAPES[m.shape]||SHAPES.none;
  for(let i=0;i<state.length;i++){state[i]+=(target[i]-state[i])*a;u[keys[i]].value=state[i];}
  u.opening.value=m.open;u.smile.value=m.smile;u.width.value=m.width;
  mouth.visible=state[7]>.001;
 },dispose(){for(const m of [...eyes,mouth])m.material.dispose();}};
}
