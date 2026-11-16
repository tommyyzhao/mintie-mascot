import { createAtlas, ACCESSORIES } from './attach/atlas.js';
import { createFace } from './attach/face.js';
import { createEffects } from './attach/effects.js';
import { EYE_AIM } from './body.js';

/** C8. All coordinates supplied by the body are world-space, H=1. WebGL2 GLSL face;
 * standard three materials elsewhere. WebGPU is intentionally unsupported (body is WebGL2).
 * Owns its resources only; never disposes scene/renderer or advances touch dynamics. */
export function createAttachments({THREE:T,scene,renderer}){
 if(renderer?.isWebGPURenderer)throw new Error('Mintie attachments require the WebGL2 character renderer');
 const root=new T.Group();root.name='Mintie attachments';scene.add(root);
 const atlas=createAtlas(T),plane=new T.PlaneGeometry(1,1),atlasMaterial=new T.MeshBasicMaterial({map:atlas.texture,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false});
 const face=createFace(T,plane,{side:T.DoubleSide,toneMapped:false}),effects=createEffects(T,atlas);
 root.add(...face.eyes,face.mouth,effects.mesh);
 const geometries=[],blushGeometry=atlas.geometry('blush');geometries.push(blushGeometry);
 const blushMaterial=atlasMaterial.clone(),cheeks=[new T.Mesh(blushGeometry,blushMaterial),new T.Mesh(blushGeometry,blushMaterial)];root.add(...cheeks);
 const accessories=Object.fromEntries(ACCESSORIES.map(name=>{const g=atlas.geometry(name),mesh=new T.Mesh(g,atlasMaterial);geometries.push(g);mesh.visible=false;mesh.renderOrder=12;root.add(mesh);return[name,mesh];}));
 const x=new T.Vector3(),y=new T.Vector3(),z=new T.Vector3(),basis=new T.Matrix4(),offset=new T.Vector3(),temp=new T.Vector3();
 function conform(object,anchor,width,height,depth=.006,dx=0,dy=0){
  z.fromArray(anchor.normal).normalize();y.fromArray(anchor.up).normalize();x.crossVectors(y,z).normalize();y.crossVectors(z,x).normalize();basis.makeBasis(x,y,z);object.quaternion.setFromRotationMatrix(basis);
  object.position.fromArray(anchor.position).addScaledVector(z,depth*anchor.scale).addScaledVector(x,dx*anchor.scale).addScaledVector(y,dy*anchor.scale);object.scale.set(width*anchor.scale,height*anchor.scale,anchor.scale);
 }
 const faceAnchor={position:[0,0,0],normal:[0,0,1],up:[0,1,0],scale:1},crownAnchor={...faceAnchor,position:[0,0,0]};
 let disposed=false,activeAccessory='none';
 const captureVisibility=new Map(),captureNormal=new T.Vector3(),captureView=new T.Vector3();
 return {
  update(pose,dynamics,anchors,nowMs){
   if(disposed)return;
   face.update(pose,nowMs,EYE_AIM);
   conform(face.eyes[0],anchors.eyeL,.242,.354,.017);
   conform(face.eyes[1],anchors.eyeR,.242,.354,.017);
   conform(face.mouth,anchors.mouth,.260,.180,.012);
   blushMaterial.opacity=pose.cheeks.blush;
   cheeks.forEach((m,i)=>{m.visible=pose.cheeks.blush>.001;conform(m,anchors[i?'cheekR':'cheekL'],.15,.075,.008);});
   effects.update(pose.fx,anchors,nowMs);
   if(activeAccessory!==pose.accessory){if(accessories[activeAccessory])accessories[activeAccessory].visible=false;activeAccessory=pose.accessory;}
   const accessory=accessories[activeAccessory];
   if(accessory){
    accessory.visible=true;
    temp.fromArray(anchors.eyeL.position).add(offset.fromArray(anchors.eyeR.position)).multiplyScalar(.5).toArray(faceAnchor.position);
    faceAnchor.normal=anchors.mouth.normal;faceAnchor.up=anchors.mouth.up;faceAnchor.scale=(anchors.eyeL.scale+anchors.eyeR.scale)*.5;
    crownAnchor.position=anchors.crown.position;crownAnchor.normal=faceAnchor.normal;crownAnchor.up=anchors.crown.up;crownAnchor.scale=anchors.crown.scale;
    switch(activeAccessory){
     case 'sunglasses':case 'glasses':conform(accessory,faceAnchor,.737,.43,.045,0,0);break;
     case 'monocle':conform(accessory,faceAnchor,.74,.43,.045,.048,0);break;
     case 'mask':conform(accessory,anchors.mouth,.35,.22,.029,0,.005);break;
     case 'halo':conform(accessory,crownAnchor,.41,.18,.025,0,.105);break;
     case 'horns':conform(accessory,crownAnchor,.53,.29,.027,0,.018);break;
     case 'partyhat':conform(accessory,crownAnchor,.30,.36,.027,.04,.12);break;
     case 'cowboy':conform(accessory,crownAnchor,.64,.34,.038,0,.061);break;
     case 'crown':conform(accessory,crownAnchor,.36,.25,.032,.035,.075);break;
    }
   }
  },
  capture(active,camera){
   // Front decals stay crisp in the final pass; only far-side attachments belong behind the skin.
   if(active){for(const object of root.children){if(!object.visible)continue;captureNormal.set(0,0,1).applyQuaternion(object.quaternion);captureView.subVectors(camera.position,object.position);if(captureNormal.dot(captureView)>0){captureVisibility.set(object,true);object.visible=false;}}}
   else {for(const object of captureVisibility.keys())object.visible=true;captureVisibility.clear();}
  },
  dispose(){if(disposed)return;disposed=true;scene.remove(root);face.dispose();effects.dispose();plane.dispose();geometries.forEach(g=>g.dispose());blushMaterial.dispose();atlasMaterial.dispose();atlas.dispose();root.clear();},
 };
}
