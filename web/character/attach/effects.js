import { FX } from './atlas.js';
const TAU=Math.PI*2,fract=x=>x-Math.floor(x),seed=i=>fract(Math.sin(i*127.1+311.7)*43758.5453123);
const COUNTS={hearts:9,sparkles:12,tears:16,sweat:1,anger:1,zzz:3,question:1,exclaim:1,notes:7,confetti:30,fire:13,steam:7,dizzy:6,lightbulb:1,sweatdrops:7,blushlines:2};
const COLORS=['#e994a6','#e4b04b','#9bb8a4','#af98c6','#e7c978'];
export function createEffects(T,atlas){
 // Three maximum effects × 30, bounded independently of elapsed time; no particle allocation.
 const capacity=90,pos=new Float32Array(capacity*12),uv=new Float32Array(capacity*8),colors=new Float32Array(capacity*16),indices=[];
 for(let i=0;i<capacity;i++){const k=i*4;indices.push(k,k+1,k+2,k,k+2,k+3);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(pos,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('uv',new T.BufferAttribute(uv,2).setUsage(T.DynamicDrawUsage));geometry.setAttribute('color',new T.BufferAttribute(colors,4).setUsage(T.DynamicDrawUsage));geometry.setIndex(indices);
 const material=new T.MeshBasicMaterial({map:atlas.texture,transparent:true,vertexColors:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}),mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=20;
 const up=new T.Vector3(),normal=new T.Vector3(),right=new T.Vector3(),point=new T.Vector3(),basis=new T.Vector3(),color=new T.Color(),white=new T.Color(1,1,1),palette=COLORS.map(x=>new T.Color(x)),crown={};
 function quad(anchor,x,y,z,size,aspect,angle,opacity,tile,tint){
  up.fromArray(anchor.up).normalize();normal.fromArray(anchor.normal).normalize();right.crossVectors(up,normal).normalize();up.crossVectors(normal,right).normalize();point.fromArray(anchor.position).addScaledVector(right,x*anchor.scale).addScaledVector(up,y*anchor.scale).addScaledVector(normal,z*anchor.scale);
  const c=Math.cos(angle),s=Math.sin(angle),n=mesh.userData.count++,ix=atlas.names.indexOf(tile),tx=ix%8/8,ty=1-(Math.floor(ix/8)+1)/8;
  for(let v=0;v<4;v++){
   const a=[-.5,.5,.5,-.5][v]*size*aspect*anchor.scale,b=[-.5,-.5,.5,.5][v]*size*anchor.scale;
   basis.copy(point).addScaledVector(right,a*c-b*s).addScaledVector(up,a*s+b*c);basis.toArray(pos,n*12+v*3);
   uv[n*8+v*2]=tx+[0,1,1,0][v]/8;uv[n*8+v*2+1]=ty+[0,0,1,1][v]/8;
   color.copy(tint||white);const j=n*16+v*4;colors[j]=color.r;colors[j+1]=color.g;colors[j+2]=color.b;colors[j+3]=opacity;
  }
 }
 return {mesh,update(effects,anchors,now){
  mesh.userData.count=0;const sec=now/1000;
  crown.position=anchors.crown.position;crown.scale=anchors.crown.scale;
  // Symbols float in the face frame, never inherit the dome's near-horizontal crown tangent.
  crown.up=anchors.mouth.up;crown.normal=anchors.mouth.normal;
  for(const {kind,intensity} of effects.slice(0,3)){
   if(!FX.includes(kind)||intensity<=.001)continue;
   const count=COUNTS[kind];
   for(let j=0;j<count;j++){
    const r=seed(j+FX.indexOf(kind)*41),r2=seed(j+111),age=fract(sec*(.43+r*.27)+r2),fade=Math.sin(age*Math.PI)*intensity;
    let a=crown,x=(r-.5)*.95,y=.1+age*.42,z=.60,size=.064+r2*.03,aspect=1,angle=(r-.5)*.6,alpha=fade,tile=kind,tint=null;
    switch(kind){
     case 'hearts': x=(r-.5)*.98+Math.sin(sec*1.7+j)*.035;y=-.1+age*.61;size=.065+r*.043;break;
     case 'sparkles': x=(r-.5)*1.15;y=-.55+r2*.95;size=.035+.06*Math.sin(age*Math.PI);angle=sec*.3;break;
     case 'tears': a=j%2?anchors.eyeL:anchors.eyeR;x=(j%2?-.025:.025)+Math.sin(age*8+j)*.006;y=-.045-age*.34;z=.034;size=.043;aspect=.62;alpha=intensity*Math.min(1,age*8)*(1-age*.4);break;
     case 'sweat': a=anchors.eyeR;x=.11;y=.11+Math.sin(sec*2)*.008;size=.085;angle=-.24;alpha=intensity;break;
     case 'anger':a=anchors.eyeR;x=.04;y=.25;size=.125+.008*Math.sin(sec*9);alpha=intensity;break;
     case 'zzz':x=.26+j*.085;y=.02+j*.085+Math.sin(sec*1.4+j)*.018;size=.15+j*.025;alpha=intensity;break;
     case 'question':x=.36;y=.10+Math.sin(sec*1.8)*.015;size=.27;alpha=intensity;angle=-.13;break;
     case 'exclaim':x=.29;y=.15;size=.21;alpha=intensity;angle=.1;break;
     case 'notes':x=(j%2?1:-1)*(.24+age*.17);y=-.32+age*.64;size=.105;angle=Math.sin(sec+j)*.2;break;
     case 'confetti':x=(r-.5)*1.45;y=.37-age*1.06;size=.034+r*.032;aspect=.6;angle=sec*(r>.5?1:-1)*2+j;tint=palette[j%palette.length];break;
     case 'fire':x=(j%2?1:-1)*(.70+.035*Math.sin(j*2));y=-.76+Math.floor(j/2)*.14;size=.20+.04*Math.sin(sec*5+j);alpha=intensity*.9;break;
     case 'steam':x=(r-.5)*.68+Math.sin(sec+j)*.04;y=age*.48;size=.12+age*.11;alpha=fade*.9;break;
     case 'dizzy':{const t=sec*2+j*TAU/count;x=Math.cos(t)*.36;y=.11+Math.sin(t)*.07;z=.16+Math.sin(t)*.10;size=.065;tile='dizzy';alpha=intensity;angle=-t;break;}
     case 'lightbulb':x=.29;y=.15+Math.sin(sec*2)*.01;size=.19;alpha=intensity;break;
     case 'sweatdrops':x=(r-.5)*1.05;y=-.10-age*.42;size=.075;angle=(r-.5)*1.4;break;
     case 'blushlines':a=j?anchors.cheekR:anchors.cheekL;x=0;y=0;z=.019;size=.073;aspect=1.5;alpha=intensity*.66;break;
    }
    // Crown-frame face band, including the rotated sprite's full extent. Contact tears/blush stay local.
    const radius=size*Math.hypot(aspect,1)*.5;
    if(a===crown&&y-radius<-.30&&y+radius>-.95&&Math.abs(x)<.52+radius)x=(x<0?-1:x>0?1:j%2?1:-1)*(.52+radius);
    quad(a,x,y,z,size,aspect,angle,alpha,tile,tint);
   }
  }
  geometry.setDrawRange(0,mesh.userData.count*6);mesh.visible=mesh.userData.count>0;for(const a of Object.values(geometry.attributes))a.needsUpdate=true;
 },dispose(){geometry.dispose();material.dispose();}};
}
