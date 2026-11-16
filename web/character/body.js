import { deformation, shading, jellyUniforms } from './jelly.js';
import { FACE_YAW } from './view.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const PROFILE={width:.65,flare:.014,center:.34,height:.79,depth:.51,floor:.015};
export function bodyDistance([x,y,z]) {
  const radius=PROFILE.width-.12*y+PROFILE.flare*Math.exp(-(((y-.10)/.28)**2)),q=y-PROFILE.center;
  const k0=Math.hypot(x/radius,q/PROFILE.height,z/PROFILE.depth),k1=Math.hypot(x/(radius**2),q/(PROFILE.height**2),z/(PROFILE.depth**2));
  return -smin(-k0*(k0-1)/Math.max(k1,1e-5),y-PROFILE.floor-.105*(x/.67)**2-.04*(z/PROFILE.depth)**2,.07);
}
export function restNormal(p) {
  const e=.0002;
  const n=p.map((_,i)=>{const a=p.slice(),b=p.slice();a[i]+=e;b[i]-=e;return bodyDistance(a)-bodyDistance(b);});
  const l=Math.hypot(...n)||1;return n.map(v=>v/l);
}
export function frontPoint(x,y) {
  let lo=0,hi=.6;
  for(let i=0;i<25;i++){const z=(lo+hi)/2;if(bodyDistance([x,y,z])>0)hi=z;else lo=z;}
  return [x,y,(lo+hi)/2];
}
export const FACE_ANCHORS={eyeL:frontPoint(.105,.395),eyeR:frontPoint(.355,.405),mouth:frontPoint(.23,.285),cheekL:frontPoint(-.025,.285),cheekR:frontPoint(.46,.29),crown:frontPoint(0,1.105)};
// Pose gaze [0,0] means "face centre toward the viewer": orient() yaws the body by viewerYaw - FACE_YAW. The eyes sit on the
// curved face 8° and 32° right of that axis, so centred pupils looked ~19° right of the camera. Per-eye horizontal
// offset (engine gaze units, 1 unit ≈ .65 rad) re-aims them; vertical is left alone (rest normals already tilt up toward the camera).
export const EYE_AIM=['eyeL','eyeR'].map(k=>{const n=restNormal(FACE_ANCHORS[k]);return -(Math.atan2(n[0],n[2])-FACE_YAW)/.65;});
function geometry(THREE,width=112,height=72) {
  const positions=[],normals=[],uv=[],indices=[];
  // Star-shaped analytic surface; no marching-grid facets, no hard floor seam.
  for(let j=0;j<=height;j++)for(let i=0;i<=width;i++) {
    const t=Math.PI*j/height,a=2*Math.PI*i/width;
    const d=[Math.sin(t)*Math.cos(a),Math.cos(t),Math.sin(t)*Math.sin(a)];
    let lo=0,hi=1.2;
    for(let k=0;k<25;k++){const r=(lo+hi)/2;if(bodyDistance([d[0]*r,.32+d[1]*r,d[2]*r])>0)hi=r;else lo=r;}
    const r=(lo+hi)/2,p=[d[0]*r,.32+d[1]*r,d[2]*r];
    positions.push(...p);normals.push(...restNormal(p));uv.push(i/width,j/height);
    if(j<height&&i<width){const k=j*(width+1)+i;indices.push(k,k+1,k+width+1,k+1,k+width+2,k+width+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeBoundingSphere();return g;
}
export function createBody({THREE,scene,reducedQuality=false}) {
  const uniforms=jellyUniforms(THREE),affine=uniforms.uAffine.value,inverse=uniforms.uInverse.value;
  const material=new THREE.ShaderMaterial({uniforms,vertexShader:`
    ${deformation}
    varying vec3 vWorld,vNormal,vRest;
    void main(){vRest=position;vWorld=worldPoint(position);vNormal=abs(uTwist)>.001||uDentCount>0||uWobble>.1?worldNormal(position,normal):normalize(mat3(transpose(uInverse))*normal);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}
  `,fragmentShader:`
    ${shading}
    varying vec3 vWorld,vNormal,vRest;
    void main(){
    vec3 view=normalize(cameraPosition-vWorld),localView=mat3(uInverse)*view;
    float thickness=bodyChord(vRest,normalize(localView))/max(length(localView),.001);
    gl_FragColor=vec4(jelly(vRest,normalize(vNormal),view,thickness),1.);
    #include <colorspace_fragment>
    }
  `});
  const mesh=new THREE.Mesh(geometry(THREE,reducedQuality?56:112,reducedQuality?36:72),material);mesh.frustumCulled=false;mesh.name='jelly-body';scene.add(mesh);
  // Interior geometry exists only in the transmission pass; skin and contents share the exact warp.
  const interiorMaterial=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,vertexShader:`
    ${deformation}
    varying vec3 vNormal,vWorld;
    void main(){vec3 p=position;
      #ifdef USE_INSTANCING
      p=(instanceMatrix*vec4(p,1.)).xyz;
      #endif
      vWorld=worldPoint(p);vNormal=worldNormal(p,normal);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}
  `,fragmentShader:`
    varying vec3 vNormal,vWorld;
    void main(){vec3 n=normalize(vNormal),v=normalize(cameraPosition-vWorld);
      float rim=pow(1.-abs(dot(n,v)),3.),glint=pow(max(0.,dot(n,normalize(v+vec3(-.5,.8,.7)))),65.);
      gl_FragColor=vec4(vec3(1.4,1.45,1.2),rim*.27+glint*.9);
      #include <colorspace_fragment>
    }
  `});
  const bubbles=new THREE.Group();bubbles.name='jelly-interior';
  const air=new THREE.InstancedMesh(new THREE.SphereGeometry(1,24,16),interiorMaterial,4),bubbleMatrix=new THREE.Matrix4();
  [[-.37,.52,.02,.026],[.04,.82,-.07,.023],[.30,.68,-.06,.017],[.38,.25,.08,.023]].forEach(([x,y,z,r],i)=>{bubbleMatrix.makeScale(r,r,r).setPosition(x,y,z);air.setMatrixAt(i,bubbleMatrix);});
  air.instanceMatrix.needsUpdate=true;air.layers.set(1);air.frustumCulled=false;bubbles.add(air);
  mesh.add(bubbles);mesh.layers.set(2);
  const anchors=Object.fromEntries(['eyeL','eyeR','mouth','cheekL','cheekR','crown'].map(k=>[k,{position:[0,0,0],normal:[0,0,1],up:[0,1,0],scale:1}]));
  const source=FACE_ANCHORS;
  const V=()=>new THREE.Vector3(),m=new THREE.Matrix4(),r=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),scale=V(),offset=V(),grab=V(),tmp=V();
  let normalScale=1,touchWeight=0,yawWeight=0,lastTouchFrame=null,landingAt=-Infinity,wasAirborne=false;
  function warp(p) {
    const [x,y,z]=p;
    let xx=x,yy=y,zz=z;
    for(let i=0;i<uniforms.uDentCount.value;i++){
      const d=uniforms.uDent.value[i],n=uniforms.uDentNormal.value[i],w=d.w*Math.exp(-((x-d.x)**2+(y-d.y)**2+(z-d.z)**2)/n.w);
      xx-=n.x*w;yy-=n.y*w;zz-=n.z*w;
    }
    const a=uniforms.uTwist.value*yy,c=Math.cos(a),s=Math.sin(a),ox=xx;
    xx=c*xx+s*zz;zz=-s*ox+c*zz;
    xx+=uniforms.uWobble.value*.012*Math.sin(yy*7-uniforms.uTime.value*9)*yy;
    zz+=uniforms.uWobble.value*.008*Math.sin(yy*8+uniforms.uTime.value*7)*yy;
    return [xx,yy,zz];
  }
  function transform(p){return tmp.fromArray(warp(p)).applyMatrix4(affine).toArray();}
  function frame(p,n=restNormal(p)) {
    const nv=new THREE.Vector3().fromArray(n),t=V().crossVectors(nv,Math.abs(n[1])<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize(),b=V().crossVectors(nv,t);
    const origin=transform(p),end=v=>transform(p.map((x,i)=>x+v.getComponent(i)*.0005));
    const tangent=V().fromArray(end(t)).sub(new THREE.Vector3().fromArray(origin)),bitangent=V().fromArray(end(b)).sub(new THREE.Vector3().fromArray(origin));
    const normal=V().crossVectors(tangent,bitangent).normalize();
    const up=V().fromArray(transform([p[0],p[1]+.0005,p[2]])).sub(new THREE.Vector3().fromArray(origin));up.addScaledVector(normal,-up.dot(normal)).normalize();
    return {position:origin,normal:normal.toArray(),up:up.toArray(),scale:normalScale};
  }
  function update(pose={},dynamics={},nowMs=0) {
    const raw=pose.body??{},d=dynamics,airborne=d.state==='held'||d.state==='falling'&&!d.hopping;
    const dt=lastTouchFrame===null||nowMs<lastTouchFrame?0:Math.min(100,nowMs-lastTouchFrame);
    if(lastTouchFrame!==null&&nowMs<lastTouchFrame){touchWeight=yawWeight=0;landingAt=-Infinity;wasAirborne=false;}
    if(wasAirborne&&!airborne)landingAt=nowMs;
    touchWeight=airborne||nowMs-landingAt<400?1:Math.max(0,touchWeight-dt/180);
    // The viewer-facing yaw is the largest authored angle (~55°): hand it to physics and back over ~160/180 ms instead of in one frame.
    yawWeight=touchWeight>yawWeight?Math.min(touchWeight,yawWeight+dt/160):touchWeight;
    lastTouchFrame=nowMs;wasAirborne=airborne;
    const gain=1-touchWeight,b={...raw,squash:(raw.squash??0)*gain,lean:(raw.lean??[0,0]).map(v=>v*gain),offset:(raw.offset??[0,0,0]).map(v=>v*gain),twist:(raw.twist??0)*(1-yawWeight)};
    const tilt=d.tilt??[0,0];
    const squash=clamp(b.squash+(d.squash??0),-.65,.65),sy=1-squash*.65,puff=1+clamp(b.puff??0,-.3,.4)*.30;
    const stretch=clamp(d.stretch??0),wide=1/Math.sqrt(sy),elongation=1+stretch*.64;
    scale.set(wide*puff/Math.sqrt(elongation),sy*puff*elongation,wide*puff/Math.sqrt(elongation));
    normalScale=Math.cbrt(scale.x*scale.y*scale.z);
    affine.makeScale(scale.x,scale.y,scale.z);
    const lean=b.lean??[0,0],shear=d.shear??[0,0];m.identity();m.elements[4]=Math.tan(clamp(lean[0]+shear[0],-.8,.8));m.elements[6]=Math.tan(clamp(lean[1]+shear[1],-.8,.8));affine.premultiply(m);
    // Stretch/shear are pinned at the finger: the heavy base hangs DOWN.
    // The same affine reaches the skin, SDF buds and every surface anchor.
    if(d.grab){grab.fromArray(d.grab).applyMatrix4(affine);m.makeTranslation(d.grab[0]-grab.x,d.grab[1]-grab.y,d.grab[2]-grab.z);affine.premultiply(m);}
    // Pendulum rotation about the actual grabbed point, not the floor centre.
    grab.fromArray(d.grab??[0,.5,0]).applyMatrix4(affine);
    const twist=(Number.isFinite(b.twist)?b.twist:0)*(1-clamp(d.facing??0))+(Number.isFinite(d.twist)?d.twist:0);
    q.setFromEuler(e.set(tilt[1]??0,twist,-(tilt[0]??0),'XYZ'));r.makeRotationFromQuaternion(q);
    m.makeTranslation(-grab.x,-grab.y,-grab.z);affine.premultiply(m).premultiply(r);m.makeTranslation(grab.x,grab.y,grab.z);affine.premultiply(m);
    offset.fromArray(b.offset??[0,0,0]).add(new THREE.Vector3().fromArray(d.com??[0,0,0]));
    if(d.grab||tilt.some(v=>Math.abs(v)>0)){
      // Conservative lower half-ellipsoid support, including large swings on either axis.
      const a=affine.elements,radial=Math.hypot(a[1]*(PROFILE.width+PROFILE.flare+.01),a[9]*(PROFILE.depth+.01));
      const minY=Math.min(a[13]+a[5]*PROFILE.floor-radial,a[13]+a[5]*PROFILE.center-Math.hypot(radial,a[5]*(a[5]<0?PROFILE.height+.01:PROFILE.center)));
      offset.y=Math.max(offset.y,-minY);
    }
    m.makeTranslation(offset.x,offset.y,offset.z);affine.premultiply(m);inverse.copy(affine).invert();
    // Rigid yaw belongs in the shared affine: a full spin must not corkscrew the skin away from buds.
    uniforms.uTwist.value=0;uniforms.uWobble.value=b.wobble??0;uniforms.uTime.value=nowMs/1000;
    const dents=(d.dents??[]).slice(0,4);uniforms.uDentCount.value=dents.length;
    dents.forEach((dent,i)=>{uniforms.uDent.value[i].set(...dent.p,clamp(dent.depth,0,.10));const n=new THREE.Vector3().fromArray(dent.n).normalize();uniforms.uDentNormal.value[i].set(n.x,n.y,n.z,Math.max(.12,dent.radius??.18)**2);});
    const tint=pose.tint??{};uniforms.uTintAmount.value=tint.kind==='none'?0:clamp(tint.amount??0);
    uniforms.uTint.value.set(({red:'#f34851',blue:'#56baf2',pale:'#eaf0d9',pink:'#fa78ba',gold:'#f6d537'})[tint.kind]??'#B2DD18');
    for(const key of Object.keys(anchors))Object.assign(anchors[key],frame(source[key]));
  }
  // Coarse replica only on pointer queries; never CPU-skin the render mesh per frame.
  const proxyGeometry=geometry(THREE,40,28),rest=proxyGeometry.attributes.position.array.slice(),proxy=new THREE.Mesh(proxyGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  function pick(raycaster) {
    const p=proxyGeometry.attributes.position;
    for(let i=0;i<p.count;i++)p.setXYZ(i,...transform([rest[i*3],rest[i*3+1],rest[i*3+2]]));
    p.needsUpdate=true;proxyGeometry.computeBoundingSphere();proxy.updateMatrixWorld(true);
    const hit=raycaster.intersectObject(proxy,false)[0];if(!hit)return null;
    // Barycentric interpolation of rest positions returns stable body-local touch coordinates.
    const {a,b,c}=hit.face,A=new THREE.Vector3().fromBufferAttribute(p,a),B=new THREE.Vector3().fromBufferAttribute(p,b),C=new THREE.Vector3().fromBufferAttribute(p,c),weights=new THREE.Vector3();
    THREE.Triangle.getBarycoord(hit.point,A,B,C,weights);
    const point=[0,1,2].map(k=>rest[a*3+k]*weights.x+rest[b*3+k]*weights.y+rest[c*3+k]*weights.z);
    return {region:point[1]>.7?'head':'body',point,normal:restNormal(point),distance:hit.distance};
  }
  update();
  return {mesh,uniforms,anchors,transform,frame,pick,get minScale(){return Math.min(scale.x,scale.y,scale.z)*.78;},
    inversePoint:p=>new THREE.Vector3().fromArray(p).applyMatrix4(inverse).toArray(),
    update,dispose(){scene.remove(mesh,bubbles);bubbles.children.forEach(o=>{o.geometry.dispose();if(o.isInstancedMesh)o.dispose();});interiorMaterial.dispose();mesh.geometry.dispose();material.dispose();proxyGeometry.dispose();proxy.material.dispose();}};
}
