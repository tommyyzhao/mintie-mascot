// Shared by raster skin and bounded SDF buds. Palette is linear-light, output sRGB.
export const deformation = `
uniform mat4 uAffine, uInverse;
uniform float uTwist, uWobble, uTime;
uniform vec4 uDent[4], uDentNormal[4];
uniform int uDentCount;
vec3 warp(vec3 p) {
  vec3 q=p;
  for(int i=0;i<4;i++) { if(i>=uDentCount) break;
    vec3 d=p-uDent[i].xyz;
    q-=uDentNormal[i].xyz*uDent[i].w*exp(-dot(d,d)/uDentNormal[i].w);
  }
  float a=uTwist*q.y, c=cos(a), s=sin(a);
  q.xz=mat2(c,-s,s,c)*q.xz;
  q.x+=uWobble*.012*sin(q.y*7.-uTime*9.)*q.y;
  q.z+=uWobble*.008*sin(q.y*8.+uTime*7.)*q.y;
  return q;
}
vec3 unwarp(vec3 q) {
  q.x-=uWobble*.012*sin(q.y*7.-uTime*9.)*q.y;
  q.z-=uWobble*.008*sin(q.y*8.+uTime*7.)*q.y;
  float a=-uTwist*q.y, c=cos(a), s=sin(a);
  q.xz=mat2(c,-s,s,c)*q.xz;
  if(uDentCount==0)return q;
  vec3 p=q;
  // Fixed-point inverse; dents are bounded to 0.1 H / radius >= .12 H.
  for(int j=0;j<3;j++) { vec3 shift=vec3(0.);
    for(int i=0;i<4;i++) { if(i>=uDentCount) break;
      vec3 d=p-uDent[i].xyz;
      shift+=uDentNormal[i].xyz*uDent[i].w*exp(-dot(d,d)/uDentNormal[i].w);
    } p=q+shift;
  }
  return p;
}
vec3 worldPoint(vec3 p) { return (uAffine*vec4(warp(p),1.)).xyz; }
vec3 worldNormal(vec3 p,vec3 n) {
  vec3 t=normalize(cross(n,abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.)));
  vec3 b=cross(n,t), q=worldPoint(p);
  return normalize(cross(worldPoint(p+t*.0005)-q,worldPoint(p+b*.0005)-q));
}
float smin(float a,float b,float k) { float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25; }
// Ellipsoid, softly intersected with the floor. Exactly the raster rest surface.
float bodyDistance(vec3 p) {
  float radius=.65-.12*p.y+.014*exp(-pow((p.y-.10)/.28,2.));
  vec3 q=p-vec3(0.,.34,0.), r=vec3(radius,.79,.51);
  float k0=length(q/r),k1=length(q/(r*r));
  float e=k0*(k0-1.)/max(k1,.00001);
  return -smin(-e,p.y-.015-.105*pow(p.x/.67,2.)-.04*pow(p.z/.51,2.),.07);
}
vec3 bodyNormal(vec3 p) {
  // Analytic derivative: two lengths instead of six SDF evaluations per bud fragment.
  float flare=.014*exp(-pow((p.y-.10)/.28,2.)),radius=.65-.12*p.y+flare;
  float slope=-.12-flare*2.*(p.y-.10)/(.28*.28);
  vec3 q=p-vec3(0.,.34,0.),r=vec3(radius,.79,.51),r2=r*r;
  float k0=max(length(q/r),.00001),k1=max(length(q/r2),.00001);
  vec3 a=q/r2,b=q/(r2*r2);a.y-=q.x*q.x*slope/(radius*radius*radius);b.y-=2.*q.x*q.x*slope/(radius*r2.x*r2.x);
  vec3 gradient=(a/k0*(2.*k0-1.)*k1-k0*(k0-1.)*b/k1)/(k1*k1);
  float ellipsoid=k0*(k0-1.)/k1,floor=-p.y+.015+.105*pow(p.x/.67,2.)+.04*pow(p.z/.51,2.);
  vec3 floorNormal=vec3(.21*p.x/(.67*.67),-1.,.08*p.z/(.51*.51));
  return normalize(mix(floorNormal,gradient,clamp(.5+.5*(ellipsoid-floor)/.07,0.,1.)));
}
`;

// Analytic studio environment: reflected world directions, shared by skin and glass eyes.
// Reflections stay analytic; transmission samples the separately rendered world.
export const studio = `
float softbox(vec3 r,vec3 light,vec2 size) {
  vec3 up=vec3(0.,1.,0.),x=normalize(cross(up,light)),y=cross(light,x);
  float z=dot(r,light);vec2 p=vec2(dot(r,x),dot(r,y))/max(.01,z);
  vec2 q=p/size;float rounded=dot(q,q);
  return exp(-rounded*2.)*step(0.,z);
}
vec3 studioLight(vec3 r) {
  vec3 key=normalize(vec3(1.35,1.8,1.6)),fill=normalize(vec3(-1.7,.8,1.));
  return mix(vec3(.12,.105,.085),vec3(.30,.32,.33),smoothstep(-.35,.8,r.y))
    +vec3(18.,17.4,16.2)*softbox(r,key,vec2(.39,.32))
    +vec3(5.5,6.2,7.)*softbox(r,fill,vec2(.08,.36))
    +vec3(1.3,1.35,1.2)*pow(max(0.,dot(r,normalize(vec3(-.2,.9,-1.)))),28.);
}
`;

export const shading = `
${studio}
uniform vec3 uTint;
uniform float uTintAmount;
uniform sampler2D uTransmission;
uniform vec2 uResolution;
uniform float uRefraction,uCapture;
#ifndef JELLY_BUD
uniform mat4 uInverse;
#endif
// Positive exit of the analytic ellipsoid along the inward view ray, clipped by the floor.
// ponytail: one local radius approximates the flared base; exact SDF exit marching costs too much.
float bodyChord(vec3 p,vec3 v) {
  vec3 r=vec3(.65-.12*p.y+.014*exp(-pow((p.y-.10)/.28,2.)),.79,.51);
  vec3 q=(p-vec3(0.,.34,0.))/r,d=v/r;
  float a=dot(d,d),b=dot(q,d),c=dot(q,q)-1.;
  float disc=b*b-a*c;
  float chord=disc>=0.?max(0.,(b+sqrt(disc))/a):0.;
  if(v.y>.001)chord=min(chord,max(0.,(p.y-.015)/v.y));
  return chord;
}
vec3 jelly(vec3 p,vec3 n,vec3 view,float thickness) {
  if(uCapture>.5)return vec3(.42,.65,.055)*(.65+.35*max(0.,n.y));
  vec3 key=normalize(vec3(1.35,1.8,1.6)),fill=normalize(vec3(-1.7,.8,1.));
  float facing=clamp(dot(n,view),0.,1.),wrap=clamp((dot(n,key)+.65)/1.65,0.,1.);
  float tint=smoothstep(0.,.65,uTintAmount);
  // Beer–Lambert through the view chord: thin gummy transmits warm studio light.
  vec3 pigment=mix(vec3(.57,.78,.045),max(uTint,vec3(.008)),tint);
  vec3 absorption=mix(vec3(.85,.19,2.2),-log(max(pigment,vec3(.015)))*1.45,tint);
  // ponytail: art-directed optical depth clears the skirt/edges; full curved-ray exit needs another depth pass.
  float depth=max(.003,thickness)*mix(.48,1.,smoothstep(.06,.36,p.y))*mix(.42,1.,smoothstep(.12,.65,facing));
  vec3 transmission=exp(-absorption*depth);
  // One half-resolution world pass, linear-light; no recursive transmission or blur pyramid.
  vec2 screenNormal=(viewMatrix*vec4(n,0.)).xy;
  vec2 uv=gl_FragCoord.xy/uResolution-screenNormal*depth*uRefraction*vec2(uResolution.y/uResolution.x,1.);
  vec3 behind=texture2D(uTransmission,clamp(uv,vec2(.001),vec2(.999))).rgb;
  float contact=1.-.06*exp(-max(p.y,0.)*16.);
  vec3 color=behind*transmission*contact;
  // Light entering the upper mass diffuses inside, not a painted belly patch.
  float entered=.18+.82*pow(max(0.,dot(n,key)),2.);
  color+=pigment*(vec3(1.)-transmission)*(.07+.16*entered+.025*wrap);
  float thin=exp(-depth*3.0),rim=pow(1.-facing,2.5);
  color+=mix(vec3(.28,.46,.035),pigment*.35,tint)*thin*(.06+.14*rim);
  // Warm floor bounce rises through the shallow lower volume and thin hand lobes.
  float bounce=exp(-max(p.y,0.)*9.)*(.25+.75*exp(-depth*1.4));
  color+=mix(vec3(.17,.23,.035),pigment*.22,tint)*bounce*.35;
  float micro=sin(dot(p,vec3(219.,173.,237.)));
  vec3 wetNormal=normalize(n+vec3(micro,-micro,micro*.5)*.0018);
  float fresnel=.031+.38*pow(1.-facing,5.);
  color=mix(color,studioLight(reflect(-view,wetNormal)),fresnel);
  // A small rough lobe keeps highlights readable when the reflected box is off-axis.
  color+=vec3(.20,.19,.16)*pow(max(0.,dot(wetNormal,normalize(key+view))),110.);
  return max(color,vec3(0.));
}
`;

export function jellyUniforms(THREE) {
  return {uAffine:{value:new THREE.Matrix4()},uInverse:{value:new THREE.Matrix4()},
    uTwist:{value:0},uWobble:{value:0},uTime:{value:0},uDentCount:{value:0},
    uDent:{value:Array.from({length:4},()=>new THREE.Vector4())},
    uDentNormal:{value:Array.from({length:4},()=>new THREE.Vector4(0,0,1,.0324))},
    uTint:{value:new THREE.Color()},uTintAmount:{value:0},
    uTransmission:{value:null},uResolution:{value:new THREE.Vector2(1,1)},uRefraction:{value:.065},uCapture:{value:0}};
}
