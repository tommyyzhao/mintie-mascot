// Infinite-feeling soft grid in the backdrop's warm gray (shared linear radiance, so no horizon seam). Lines come from a
// mipmapped, anisotropic tile: the sampler antialiases and thins them with distance, so the shader is one fetch plus a fade.
// A radius-10.5 disc is enough: the lines are gone by radius 10 and beyond that the floor IS the backdrop. World-anchored, so hops slide over it.
const TILE=256,CELLS=4; // one tile = 4x4 cells of 0.5 world units
function gridTexture(THREE){
  const data=new Uint8Array(TILE*TILE*4),cell=TILE/CELLS;
  for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){
    // Distance (px) to the nearest cell line; the tile edge doubles as the stronger 2-unit line.
    const dx=Math.min(x%cell,cell-x%cell),dy=Math.min(y%cell,cell-y%cell),major=Math.min(x,TILE-x,y,TILE-y);
    const minor=Math.max(0,1-Math.min(dx,dy)/1.5)*.55,edge=Math.max(0,1-major/2)*.95,v=Math.max(minor,edge);
    data.set([255,255,255,Math.round(v*255)],(y*TILE+x)*4);
  }
  const t=new THREE.DataTexture(data,TILE,TILE,THREE.RGBAFormat);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=2;t.needsUpdate=true;return t;
}
export function createFloor(THREE,scene,background){
  const map=gridTexture(THREE),uniforms={uBase:{value:background.clone()},uCenter:{value:new THREE.Vector2()},uMap:{value:map}};
  const material=new THREE.ShaderMaterial({uniforms,depthWrite:false,vertexShader:'varying vec2 vXZ;void main(){vec4 w=modelMatrix*vec4(position,1.);vXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}',fragmentShader:`
    varying vec2 vXZ;uniform vec3 uBase;uniform vec2 uCenter;uniform sampler2D uMap;
    void main(){
      float fade=1.-smoothstep(2.4,10.,length(vXZ-uCenter));
      // Slightly darker, warmer than the base: reads as a texture, never as a pattern.
      gl_FragColor=vec4(mix(uBase,uBase*vec3(.80,.77,.72),texture2D(uMap,vXZ*.5).a*fade*.34),1.);
      #include <colorspace_fragment>
    }
  `});
  const mesh=new THREE.Mesh(new THREE.CircleGeometry(10.5,48),material);mesh.rotation.x=-Math.PI/2;mesh.renderOrder=-10;mesh.frustumCulled=false;mesh.name='floor-grid';scene.add(mesh);
  // The transmission capture only needs the backdrop colour, which the clear colour already is: skip a full-screen pass.
  return {mesh,uniforms,capture(on){mesh.visible=!on;},update(target){uniforms.uCenter.value.set(target.x,target.z);mesh.position.set(target.x,0,target.z);},dispose(){scene.remove(mesh);mesh.geometry.dispose();map.dispose();material.dispose();}};
}
