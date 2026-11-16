import { deformation, shading } from './jelly.js';
import { frontPoint, FACE_ANCHORS } from './body.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x??0));
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const norm=a=>mul(a,1/(Math.hypot(...a)||1));
// One rounded, unbranched nub; all anatomy shares the body's deformation.
export function buildBud(b) {
  const side=b.side==='L'?-1:1,segments=[],contact=b.contact!=='none';
  const g=clamp((b.reach??0)/(contact?.65:1));
  if(g<=.0001)return {segments};
  const height=clamp(b.height,.16,.85),root=frontPoint(side*(.515-.19*Math.max(0,height-.42)),height);
  root[2]*=.25;
  const direction=norm(b.dir??[side,.5,.1]),eye=FACE_ANCHORS[side<0?'eyeL':'eyeR'];
  const mouth=FACE_ANCHORS.mouth,cheek=FACE_ANCHORS[side<0?'cheekL':'cheekR'];
  const targets={mouth:add(mouth,[0,.015,.12]),chin:add(mouth,[0,-.10,.10]),
    brow:add(eye,[0,.20,.16]),eye:add(eye,[0,0,.13]),
    cheek:add(cheek,[side*.055,.04,.12]),ear:[side*.57,.53,.34],
    chest:[side*(.20+direction[0]*side*.55),height,.70],
    other:direction[0]*side<-.7?[-side*.27,.58,side<0?.76:.88]:add(root,mul(direction,.56))};
  const tip=targets[b.contact]??add(root,mul(direction,.56));
  const control=contact?[side*.67,height+.12+(b.contact==='chest'?Math.max(0,direction[1])*.25:0),.62]:add(mix(root,tip,.5),[0,-.055,0]);
  const grow=p=>mix(add(root,[-side*.085*(1-g),0,0]),p,g),scale=Math.sqrt(g);
  let previous=add(root,[-side*.065,0,0]);
  const radii=[.12,.105+clamp(b.bulge)*.045,.105,.11];
  // Three smoothly joined capsule spans describe a curve, never a palm or digits.
  for(let i=1;i<=3;i++){
    const t=i/3,p=mix(mix(root,control,t),mix(control,tip,t),t);
    segments.push({a:grow(previous),b:grow(p),ra:radii[i-1]*scale,rb:radii[i]*scale,k:.085*scale});previous=p;
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const s of segments)for(let i=0;i<3;i++){min[i]=Math.min(min[i],s.a[i]-s.ra-s.k*.25,s.b[i]-s.rb-s.k*.25);max[i]=Math.max(max[i],s.a[i]+s.ra+s.k*.25,s.b[i]+s.rb+s.k*.25);}
  return {segments,min:min.map(x=>x-.025),max:max.map(x=>x+.025)};
}
const mapGLSL=`
uniform vec4 uSegments[6];
uniform float uBlend[3];
uniform vec3 uMin,uMax;
float capsule(vec3 p,int i) {
  vec4 a=uSegments[i*2],b=uSegments[i*2+1];vec3 ba=b.xyz-a.xyz,pa=p-a.xyz;
  float h=clamp(dot(pa,ba)/max(dot(ba,ba),.00000001),0.,1.);
  return length(pa-ba*h)-mix(a.w,b.w,h);
}
float mapBud(vec3 p) {
  float d=bodyDistance(p);
  for(int i=0;i<3;i++)d=smin(d,capsule(p,i),uBlend[i]);
  return d;
}
vec4 blendGradient(vec4 a,vec4 b,float k) {
  float h=clamp(.5+.5*(b.w-a.w)/k,0.,1.);
  return vec4(mix(b.xyz,a.xyz,h),mix(b.w,a.w,h)-k*h*(1.-h));
}
vec3 gradient(vec3 p,vec3 view,out float thickness) {
  vec4 d=vec4(bodyNormal(p),bodyDistance(p));
  thickness=0.; // The root's analytic body chord is blended once at the shading call.
  for(int i=0;i<3;i++) {
    vec4 a=uSegments[i*2],b=uSegments[i*2+1];vec3 ba=b.xyz-a.xyz,pa=p-a.xyz;
    float den=max(dot(ba,ba),.00000001),raw=dot(pa,ba)/den,h=clamp(raw,0.,1.);
    vec3 v=pa-ba*h;float len=max(length(v),.000001);vec3 grad=v/len;
    if(raw>0.&&raw<1.)grad-=ba*(b.w-a.w)/den;
    float radius=mix(a.w,b.w,h),distance=len-radius;
    float weight=clamp(.5+.5*(d.w-distance)/uBlend[i],0.,1.);
    // Capsule chord, blended with the body's chord at the seamless union.
    float chord=2.*radius*clamp(abs(dot(grad,view)),.035,1.);
    thickness=mix(thickness,chord,weight);
    d=blendGradient(d,vec4(grad,distance),uBlend[i]);
  }
  return normalize(d.xyz);
}
`;
export function createBuds({THREE,scene,body,camera,reducedQuality=false}) {
  const objects=[];
  for(let hand=0;hand<2;hand++) {
    const uniforms={...body.uniforms,uSegments:{value:Array.from({length:6},()=>new THREE.Vector4())},uBlend:{value:new Float32Array(3)},uMin:{value:new THREE.Vector3()},uMax:{value:new THREE.Vector3()},uRayOrigin:{value:new THREE.Vector3()},uRayDirection:{value:new THREE.Vector3()},uPerspective:{value:camera.isPerspectiveCamera?1:0}};
    const material=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,alphaToCoverage:true,vertexShader:`
      varying vec3 vProxy;
      void main(){vProxy=position;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}
    `,fragmentShader:`
      ${deformation}
      #define JELLY_BUD
      ${shading}
      ${mapGLSL}
      varying vec3 vProxy;
      uniform vec3 uRayOrigin,uRayDirection;
      uniform float uPerspective;
      uniform mat4 projectionMatrix;
      void main(){
        vec3 worldDir=uPerspective>.5?normalize(vProxy-cameraPosition):uRayDirection;
        vec3 worldOrigin=uPerspective>.5?cameraPosition:vProxy-worldDir*3.;
        vec3 ro=(uInverse*vec4(worldOrigin,1.)).xyz;
        vec3 rd=normalize((uInverse*vec4(worldDir,0.)).xyz);
        vec3 inv=1./(rd+vec3(.0000001));
        vec3 a=(uMin-ro)*inv,b=(uMax-ro)*inv;
        float near=max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z));
        float far=min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
        if(near>far)discard;
        float t=max(near,0.),d=1.;vec3 p=vec3(0.);bool hit=false;
        // Body already occupies the box entry: its true front surface is outside this proxy.
        // Never render the box clipping plane as jelly (especially contact nubs).
        if(mapBud(unwarp(ro+rd*t))<-.001)discard;
        for(int i=0;i<${reducedQuality?22:28};i++){
          p=unwarp(ro+rd*t);d=mapBud(p);
          if(d<.001){hit=true;break;}
          t+=max(d,.00035);if(t>far)break;
        }
        if(!hit)discard;
        // Outside the true union influence the raster body owns colour and depth.
        // Otherwise proxy-box boundaries expose tiny normal/depth differences.
        if(bodyDistance(p)-mapBud(p)<.0000001)discard;
        // One Newton correction avoids a depth bias seam against the raster body.
        vec3 materialView=normalize(mat3(uInverse)*normalize(cameraPosition-worldPoint(p)));
        float thickness;vec3 localN=gradient(p,materialView,thickness);float along=dot(localN,rd);
        if(abs(along)>.12){t+=d/(-along);p=unwarp(ro+rd*t);}
        float influence=smoothstep(.0002,.045,bodyDistance(p));
        vec3 normalLocal=normalize(mix(bodyNormal(p),localN,influence));
        vec3 world=worldPoint(p),n=normalize(mat3(transpose(uInverse))*normalLocal);
        if(abs(uTwist)>.001||uDentCount>0||uWobble>.1)n=worldNormal(p,normalLocal);
        vec4 clip=projectionMatrix*viewMatrix*vec4(world,1.);
        gl_FragDepth=clip.z/clip.w*.5+.5;
        vec3 view=normalize(cameraPosition-world);
        vec3 localView=mat3(uInverse)*view;
        float bodyThickness=bodyChord(p,normalize(localView));
        float materialBlend=smoothstep(0.,.20,bodyDistance(p));
        thickness=mix(bodyThickness,thickness,materialBlend)/max(length(localView),.001);
        vec3 color=jelly(p,n,view,thickness);
        // Coverage only at the external silhouette. Union seams must remain opaque:
        // alpha-to-coverage there reveals uncovered background samples behind the body.
        float edgeCoverage=1.; // ponytail: hit-tested SDF silhouette uses MSAA; grazing alpha made thin nubs ghostly.
        gl_FragColor=vec4(color,edgeCoverage);
        #include <colorspace_fragment>
      }
    `});
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(12),3));geo.setIndex([0,1,2,0,2,3]);
    const mesh=new THREE.Mesh(geo,material);mesh.frustumCulled=false;mesh.visible=false;mesh.name=`jelly-bud-${hand}`;scene.add(mesh);objects.push({mesh,uniforms});
  }
  const right=new THREE.Vector3(),up=new THREE.Vector3(),center=new THREE.Vector3(),point=new THREE.Vector3(),forward=new THREE.Vector3();
  function update(pose) {
    camera.updateMatrixWorld();right.setFromMatrixColumn(camera.matrixWorld,0);up.setFromMatrixColumn(camera.matrixWorld,1);camera.getWorldDirection(forward);
    for(let hand=0;hand<2;hand++) {
      const o=objects[hand],b=pose.buds?.[hand],data=b?buildBud(b):null;o.mesh.visible=!!data?.segments.length;
      if(!o.mesh.visible)continue;
      const u=o.uniforms;data.segments.forEach((s,i)=>{u.uSegments.value[i*2].set(...s.a,s.ra);u.uSegments.value[i*2+1].set(...s.b,s.rb);u.uBlend.value[i]=Math.max(.0001,s.k);});
      // Twist/dents can move the rest bounds; pad before affine/world projection.
      const padding=.018+Math.abs(body.uniforms.uTwist.value)*.22;
      const min=data.min.map(x=>x-padding),max=data.max.map(x=>x+padding);u.uMin.value.fromArray(min);u.uMax.value.fromArray(max);u.uRayDirection.value.copy(forward);
      let left=Infinity,bottom=Infinity,rightEdge=-Infinity,top=-Infinity,depth=0;
      for(let k=0;k<8;k++) {
        point.fromArray(body.transform([k&1?max[0]:min[0],k&2?max[1]:min[1],k&4?max[2]:min[2]]));
        const x=point.dot(right),y=point.dot(up);left=Math.min(left,x);rightEdge=Math.max(rightEdge,x);bottom=Math.min(bottom,y);top=Math.max(top,y);depth+=point.dot(forward)/8;
      }
      center.copy(forward).multiplyScalar(depth);
      const p=o.mesh.geometry.attributes.position,coords=[[left,bottom],[rightEdge,bottom],[rightEdge,top],[left,top]];
      coords.forEach(([x,y],i)=>{point.copy(center).addScaledVector(right,x).addScaledVector(up,y);p.setXYZ(i,point.x,point.y,point.z);});p.needsUpdate=true;
    }
  }
  const captureView=new THREE.Vector3(),captureTip=new THREE.Vector3();
  function capture(active){
    if(active){captureView.copy(camera.position).applyMatrix4(body.uniforms.uInverse.value);captureView.y-=.34;for(const o of objects){o.wasVisible=o.mesh.visible;if(!o.wasVisible)continue;const p=o.uniforms.uSegments.value[5];captureTip.set(p.x,p.y-.34,p.z);if(captureView.dot(captureTip)>=0)o.mesh.visible=false;}}
    else for(const o of objects)o.mesh.visible=o.wasVisible;
  }
  return {update,capture,dispose(){for(const o of objects){scene.remove(o.mesh);o.mesh.geometry.dispose();o.mesh.material.dispose();}},get active(){return objects.filter(o=>o.mesh.visible).length;}};
}
