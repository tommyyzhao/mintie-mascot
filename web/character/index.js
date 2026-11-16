import * as THREE from '/vendor/three/three.module.js';
import { createBody } from './body.js';
import { createBuds } from './buds.js';

// WebGL2 deliberately: bounded GLSL SDF + real fragment depth + MSAA + elapsed queries,
// one portable path, no full-screen raymarch / duplicate WebGPU material implementation.
export async function createCharacter({canvas,reducedQuality=false}={}) {
  if(!canvas?.getContext)throw new TypeError('createCharacter requires a canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.info.autoReset=false;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(25,1,.01,80);scene.background=new THREE.Color('#e2dfda');
  const cameraTarget=new THREE.Vector3(0,.53,0);let azimuth=0,elevation=.10,distance=7,baseDistance=7,zoom=1;
  // ponytail: orbit/dolly only; the server exposes three/build, not examples or bare-specifier controls.
  function frameCamera(){camera.position.set(cameraTarget.x+distance*Math.cos(elevation)*Math.sin(azimuth),cameraTarget.y+distance*Math.sin(elevation),cameraTarget.z+distance*Math.cos(elevation)*Math.cos(azimuth));camera.lookAt(cameraTarget);camera.updateMatrixWorld();camera.updateProjectionMatrix();}
  frameCamera();camera.layers.enable(2);
  const body=createBody({THREE,scene,reducedQuality}),buds=createBuds({THREE,scene,body,camera,reducedQuality});
  // ponytail: half-resolution, single-layer transmission; no recursive refraction or off-screen objects.
  const transmission=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
  transmission.texture.colorSpace=THREE.LinearSRGBColorSpace;body.uniforms.uTransmission.value=transmission.texture;
  // Attachments use standard materials as well as decals.
  scene.add(new THREE.HemisphereLight(0xfff9ed,0x9a9b8c,1.3));
  const key=new THREE.DirectionalLight(0xfff3db,3.1);key.position.set(-3,5,5);scene.add(key);
  const fill=new THREE.DirectionalLight(0xdceaff,.8);fill.position.set(4,2,2);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.7);rim.position.set(-1,3,-3);scene.add(rim);
  // Analytic projected penumbra + contact AO, captured behind the transmissive skin.
  // Floor and backdrop share exactly the same linear radiance: no horizon seam at any orbit.
  const shadowUniforms={uLift:{value:0}};
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.3,2.5),new THREE.ShaderMaterial({uniforms:shadowUniforms,transparent:true,depthWrite:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
    varying vec2 vUv;uniform float uLift;
    void main(){
      vec2 p=(vUv-.5)*vec2(3.3,2.5),q=p-vec2(.14,-.10)*(1.+uLift);
      float broad=exp(-dot(q/vec2(.77,.53),q/vec2(.77,.53))*2.4)*exp(-uLift*.85);
      float contact=exp(-dot(p/vec2(.64,.44),p/vec2(.64,.44))*2.8)*exp(-uLift*6.);
      float transmitted=exp(-dot((p-vec2(-.10,.06))/vec2(.48,.30),(p-vec2(-.10,.06))/vec2(.48,.30))*4.)*exp(-uLift*2.);
      vec3 ink=mix(vec3(.13,.115,.09),vec3(.33,.43,.055),transmitted*.65);
      float caustic=exp(-pow((length((p-vec2(-.05,.08))/vec2(.63,.43))-.95)*5.,2.))*exp(-uLift*3.);
      gl_FragColor=vec4(ink,min(.50,broad*.26+contact*.42)*(1.-caustic*.35));
      #include <colorspace_fragment>
    }
  `}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.001;scene.add(shadow);
  let attachments=null;
  try {
    const module=await import('./attachments.js');
    attachments=module.createAttachments({THREE,scene,renderer});
  } catch(error) {
    // ponytail: body lab can run before lane F exists; actual module bugs are not hidden.
    if(!(error instanceof TypeError)||!/(fetch|module|import)/i.test(error.message)){buds.dispose();body.dispose();shadow.geometry.dispose();shadow.material.dispose();transmission.dispose();renderer.dispose();throw error;}
  }
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');let timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),contextLost=false;
  const adapter={renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),vendor:gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR),timerQuery:!!timer,version:gl.getParameter(gl.VERSION)};
  const pending=[],measurements=[];let gpuMs=null,drawMs=0,frame=0,disposed=false,lastNow=null;
  const lost=()=>{contextLost=true;pending.length=0;gpuMs=null;},restored=()=>{timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');contextLost=false;};
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
  function setRay(x,y){const r=canvas.getBoundingClientRect();ndc.set((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2);raycaster.setFromCamera(ndc,camera);return raycaster;}
  function collect(){if(!timer||contextLost)return;const disjoint=gl.getParameter(timer.GPU_DISJOINT_EXT);for(let i=0;i<pending.length;){const p=pending[i];if(!gl.getQueryParameter(p.query,gl.QUERY_RESULT_AVAILABLE)){i++;continue;}p.sample.gpuMs=disjoint?null:gl.getQueryParameter(p.query,gl.QUERY_RESULT)/1e6;if(!disjoint)gpuMs=p.sample.gpuMs;gl.deleteQuery(p.query);pending.splice(i,1);}}
  const pixelRatio=()=>Math.min(2,Math.max(.5,Number(canvas.dataset.dpr)||globalThis.devicePixelRatio||1));
  function resize(){
    if(disposed)return;const r=canvas.getBoundingClientRect(),width=Math.max(1,r.width),height=Math.max(1,r.height);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width,height,false);camera.aspect=width/height;
    transmission.setSize(Math.max(1,Math.round(width*(reducedQuality?.5:1))),Math.max(1,Math.round(height*(reducedQuality?.5:1))));
    body.uniforms.uResolution.value.set(width*renderer.getPixelRatio(),height*renderer.getPixelRatio());
    // Centre the character above the bottom dock, including phone safe-area breathing room.
    baseDistance=Math.max(7.,(width<600?4.35:4.95)/camera.aspect);distance=baseDistance/zoom;
    camera.setViewOffset(width,height,0,height*(width<600?.09:.045),width,height);frameCamera();
  }
  function update(pose,dynamics={},nowMs=0){
    if(disposed||contextLost)return;const start=performance.now();if(renderer.getPixelRatio()!==pixelRatio())resize();collect();
    const dt=lastNow===null?0:Math.max(0,Math.min(100,nowMs-lastNow));lastNow=nowMs;
    body.update(pose,dynamics,nowMs);
    // Never move the drag plane's camera while held. Follow the landing, not the authored idle bob.
    if(dynamics.state!=='held'&&dynamics.state!=='poke'&&dynamics.state!=='pat'&&dynamics.state!=='pet'){
      // ponytail: follow 30% of the jump height, 240ms floor chase; preserve a readable arc without camera bob.
      const com=dynamics.com??[0,0,0],follow=new THREE.Vector3(com[0],.53+com[1]*(dynamics.hopping?.3:1),com[2]);
      cameraTarget.lerp(follow,1-Math.exp(-dt/(dynamics.hopping?240:350)));frameCamera();
    }
    buds.update(pose);
    attachments?.update(pose,dynamics,body.anchors,nowMs);
    const footprint=body.transform([0,.015,0]),lift=Math.max(0,footprint[1]-.015),spread=1+lift*.55,a=body.uniforms.uAffine.value.elements;
    shadowUniforms.uLift.value=lift;
    shadow.scale.set(spread*Math.hypot(a[0],a[1],a[2]),spread*Math.hypot(a[8],a[9],a[10]),1);
    shadow.position.x=footprint[0];shadow.position.z=footprint[2];
    renderer.info.reset();let query=null;if(timer&&pending.length<24){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query);}
    camera.layers.disable(2);camera.layers.enable(1);body.uniforms.uCapture.value=1;
    // Never read the attachment currently being written, even on the capture shader's early-return path.
    body.uniforms.uTransmission.value=null;attachments?.capture(true,camera);buds.capture(true);
    renderer.setRenderTarget(transmission);renderer.render(scene,camera);
    renderer.setRenderTarget(null);camera.layers.enable(2);camera.layers.disable(1);body.uniforms.uCapture.value=0;
    body.uniforms.uTransmission.value=transmission.texture;attachments?.capture(false,camera);buds.capture(false);
    renderer.render(scene,camera);if(query)gl.endQuery(timer.TIME_ELAPSED_EXT);
    drawMs=performance.now()-start;
    const sample={frame:frame++,nowMs,dpr:renderer.getPixelRatio(),buds:buds.active,gpuMs:null,drawMs,triangles:renderer.info.render.triangles};
    if(query)pending.push({query,sample});measurements.push(sample);if(measurements.length>12000)measurements.splice(0,3000);
  }
  function pick(x,y){setRay(x,y);const flower=attachments?.pick(raycaster);if(flower==='flower'){const a=body.anchors.flower;return {region:'flower',point:body.inversePoint(a.position),worldPoint:[...a.position],normal:[0,0,1],anchors:body.anchors};}const hit=body.pick(raycaster);if(!hit)return null;const {distance,...result}=hit;return {...result,worldPoint:body.transform(hit.point),anchors:body.anchors};}
  // World ray plus the optical axis: drag depth is frozen at the live world hit on pointerdown.
  function ray(x,y){setRay(x,y);return {origin:raycaster.ray.origin.toArray(),dir:raycaster.ray.direction.toArray(),normal:camera.getWorldDirection(new THREE.Vector3()).toArray()};}
  function headScreen(){const r=canvas.getBoundingClientRect(),world=new THREE.Vector3().fromArray(body.anchors.eyeL.position).add(new THREE.Vector3().fromArray(body.anchors.eyeR.position)).multiplyScalar(.5),p=world.clone().project(camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,radius:r.height*.27*4.6/camera.position.distanceTo(world)};}
  function dispose(){if(disposed)return;disposed=true;globalThis.removeEventListener?.('resize',resize);canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);for(const p of pending)gl.deleteQuery(p.query);pending.length=0;attachments?.dispose();buds.dispose();body.dispose();scene.remove(shadow);shadow.geometry.dispose();shadow.material.dispose();transmission.dispose();renderer.dispose();}
  globalThis.addEventListener?.('resize',resize);resize();
  return {update,pick,ray,headScreen,resize,stats(){collect();return {gpuMs,drawMs,triangles:renderer.info.render.triangles};},dispose,
    adapter,measurements,orbit(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return;azimuth-=dx*.008;elevation=Math.max(.015,Math.min(Math.PI/2-.015,elevation+dy*.008));frameCamera();},
    dolly(factor){if(Number.isFinite(factor)&&factor>0){distance=Math.max(1.25,Math.min(24,distance*factor));zoom=baseDistance/distance;frameCamera();}},
    setZoom(value){distance=Math.max(1.25,Math.min(24,baseDistance/(Number(value)||1)));zoom=baseDistance/distance;frameCamera();},
    get view(){return {azimuth,elevation,distance,target:cameraTarget.toArray(),position:camera.position.toArray()};},get attachmentsReady(){return !!attachments;}};
}
