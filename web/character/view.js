// Fixed-angle camera + viewer-gaze math. Pure (no THREE) so node tests cover it.
export const AZIMUTH=-35*Math.PI/180,ELEVATION=20*Math.PI/180; // 3/4 left, 20° above
// The face (eye midpoint) sits ~20° right of the body's forward axis, so facing the viewer means yawing the body by viewerYaw - FACE_YAW.
// Pure constant so the engine needn't import the body; test/character.test.mjs pins it to the measured eye normals.
export const FACE_YAW=20*Math.PI/180;
export const ZOOM_MIN=.6,ZOOM_MAX=1.6,GAZE_SPREAD=2.4;
export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(v)?v:0));
export const cameraPosition=(target,distance,azimuth=AZIMUTH,elevation=ELEVATION)=>[target[0]+distance*Math.cos(elevation)*Math.sin(azimuth),target[1]+distance*Math.sin(elevation),target[2]+distance*Math.cos(elevation)*Math.cos(azimuth)];
// Where Mintie looks: the camera itself (a virtual viewer standing in the world), nudged by the pointer in the camera's right/up plane.
// (0,0) = straight at the camera; amplitude is world units, so zooming in widens the angle and zooming out narrows it.
export const gazeTarget=(position,right,up,nx=0,ny=0,spread=GAZE_SPREAD)=>position.map((p,i)=>p+(right[i]*clamp(nx,-1,1)+up[i]*clamp(ny,-1,1))*spread);
// Critically damped spring (Unity SmoothDamp form): no overshoot, continuous velocity, frame-rate independent.
export function damp(s,target,smoothTime,dt){
  if(!(dt>0))return s.x;const w=2/Math.max(1e-4,smoothTime),x=w*dt,e=1/(1+x+.48*x*x+.235*x*x*x),change=s.x-target,temp=(s.v+w*change)*dt;
  s.v=(s.v-w*temp)*e;s.x=target+(change+temp)*e;return s.x;
}
