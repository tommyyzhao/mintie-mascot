const TAU=Math.PI*2;
// Curved, veined petals and a shallow Fibonacci seed head. No stem.
function petalGeometry(T){
 const positions=[],uv=[],indices=[],rows=18,cols=12;
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
  const t=j/rows,s=i/cols*2-1,w=.070*Math.pow(Math.sin(Math.PI*t),.82)+.001;
  positions.push(s*w,.094+t*.205,.025*Math.sin(Math.PI*t)*(1-s*s)+.003*Math.sin(s*15.+t*5.)*Math.sin(Math.PI*t)-.012*t*t);
  uv.push(i/cols,t);
  if(i<cols&&j<rows){const k=j*(cols+1)+i;indices.push(k,k+1,k+cols+1,k+1,k+cols+2,k+cols+1);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
export function createFlower(T){
 const root=new T.Group(),hinge=new T.Group(),head=new T.Group();root.add(hinge);hinge.add(head);head.position.set(0,0,.27);
 const resources=[],petal=petalGeometry(T),material=new T.MeshStandardMaterial({color:0xffffff,roughness:.59,side:T.DoubleSide});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec2 petalUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\npetalUv=uv;');
  shader.fragmentShader='varying vec2 petalUv;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float s=petalUv.x*2.-1.,t=petalUv.y;
   float veins=pow(.5+.5*cos(s*43.+sin(t*12.)*.6),12.);
   float center=exp(-s*s*170.);
   float grain=sin(s*319.+t*407.)*sin(s*223.-t*197.);
   vec3 gold=mix(vec3(.46,.16,.002),vec3(.88,.42,.009),smoothstep(.03,.72,t));
   gold*=1.-veins*.11-center*.14+grain*.025;
   // ponytail: analytic disc occlusion / petal wrap replaces a second shadow-map pass.
   gold*=.57+.43*smoothstep(.07,.43,t);
   diffuseColor.rgb*=gold;
  `).replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
   reflectedLight.indirectDiffuse+=diffuseColor.rgb*.17;
  `);
 };resources.push(petal,material);
 const rings=[new T.InstancedMesh(petal,material,13)];rings.forEach(x=>head.add(x));
 const diskGeometry=new T.SphereGeometry(.165,48,20),diskMaterial=new T.MeshStandardMaterial({color:'#38240d',roughness:.84});
 const disk=new T.Mesh(diskGeometry,diskMaterial);disk.scale.z=.23;disk.position.z=.022;head.add(disk);resources.push(diskGeometry,diskMaterial);
 const seedGeometry=new T.SphereGeometry(1,6,4),seedMaterial=new T.MeshStandardMaterial({color:0xffffff,roughness:.73});
 const seeds=new T.InstancedMesh(seedGeometry,seedMaterial,610),seedHelper=new T.Object3D(),seedColor=new T.Color();head.add(seeds);
 for(let i=0;i<610;i++){
  const r=.159*Math.sqrt((i+.5)/610),a=i*2.3999632297,z=Math.sqrt(Math.max(0.,1.-(r/.165)**2));
  seedHelper.position.set(Math.cos(a)*r,Math.sin(a)*r,.023+.038*z);
  seedHelper.rotation.set(0,0,a+.35);seedHelper.scale.set(.0033,.0048,.0027);seedHelper.updateMatrix();seeds.setMatrixAt(i,seedHelper.matrix);
  seedColor.setHSL(.095+.018*Math.sin(i*31.),.53,.025+.13*(r/.159)+.025*Math.sin(i*17.));seeds.setColorAt(i,seedColor);
 }
 resources.push(seedGeometry,seedMaterial);seeds.instanceMatrix.needsUpdate=true;
 const helper=new T.Object3D();let last=null,spin=0,lagX=0,lagZ=0,velocityX=0,velocityZ=0;
 return {root,head,update(p,d,now){
  const dt=last===null||now<last?0:Math.min(.05,(now-last)/1000);if(last===null||now<last){lagX=lagZ=velocityX=velocityZ=spin=0;}last=now;
  const sx=d?.flower?.swing?.[0]||0,sz=d?.flower?.swing?.[1]||0;
  // External dynamics owns the hinge. The heavy disk counter-rotates behind a pet;
  // critically damped lag keeps the petal follow-through from turning into jitter.
  const tx=sx*.20-p.perk*.045,tz=-sz*.32;
  const decay=Math.exp(-19*dt),dx=lagX-tx,dz=lagZ-tz;
  const vx=velocityX+19*dx,vz=velocityZ+19*dz;
  lagX=tx+(dx+vx*dt)*decay;velocityX=(velocityX-19*vx*dt)*decay;
  lagZ=tz+(dz+vz*dt)*decay;velocityZ=(velocityZ-19*vz*dt)*decay;
  spin=(spin+p.spin*TAU*dt)%TAU;
  hinge.rotation.set(sx-.25*p.perk,0,sz);
  head.rotation.set(lagX,0,spin+lagZ);
  const bloom=p.bloom;
  rings.forEach((ring,r)=>{
   for(let i=0;i<13;i++){
    const angle=i*TAU/13;
    helper.position.set(0,0,r?-.012:-.025);helper.rotation.set(0,0,angle);
    helper.rotateX((1-bloom)*1.15+(r?lagX:-lagX)*Math.cos(angle));
    helper.scale.set(r?.89:1,r?.91:1,1);helper.updateMatrix();ring.setMatrixAt(i,helper.matrix);
   }
   ring.instanceMatrix.needsUpdate=true;
  });
 },pick(raycaster){root.updateWorldMatrix(true,true);return raycaster.intersectObject(root,true).length?'flower':null;},dispose(){resources.forEach(r=>r.dispose());rings.forEach(r=>r.dispose());seeds.dispose();}};
}
