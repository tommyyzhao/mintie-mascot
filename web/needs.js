const clamp = x => Math.max(0, Math.min(1, x));
// ponytail: illustrative drive rates, not inferred human attention; calibrate with longitudinal observation.
export function createNeeds({seed=1,initial}={}) {
  let random=Number(seed)>>>0 || 1, last=0, next=8000, lastActivity=0, waryUntil=0, hops=[];
  let mood={social:.25,curiosity:.45,energy:.9,play:.1,...initial};
  const rand=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
  function event(kind, at=last) {
    if(kind==='userSpeech'||kind==='mintieSpeech') {lastActivity=at;mood.social=clamp(mood.social-.18);mood.energy=clamp(mood.energy-.04);}
    if(['poke','pat'].includes(kind)) {lastActivity=at;mood.play=clamp(mood.play+.22);mood.curiosity=clamp(mood.curiosity+.08);mood.energy=clamp(mood.energy-.02);}
    if(['pet','pet_flower'].includes(kind)) {lastActivity=at;mood.social=clamp(mood.social-.15);mood.play=clamp(mood.play-.05);mood.energy=clamp(mood.energy-.01);}
    if(['lift','hold','shake'].includes(kind)) {lastActivity=at;mood.energy=clamp(mood.energy-.04);}
    if(['throw','drop'].includes(kind)) {lastActivity=at;waryUntil=at+15000;mood.play=0;mood.energy=clamp(mood.energy-.12);}
    if(kind==='land') {lastActivity=at;mood.energy=clamp(mood.energy-.03);}
  }
  function update(at,{userSpeech=false,mintieSpeech=false,held=false,scripted=false,busy=false}={}) {
    const dt=Math.max(0,at-last)/1000;last=at;
    if(userSpeech||mintieSpeech||held)lastActivity=at;
    // ponytail: rest restores energy slowly; speech and handling consume it, not a physiology model.
    mood.social=clamp(mood.social+dt*(userSpeech||mintieSpeech?-.003:.001));
    mood.curiosity=clamp(mood.curiosity+dt*.0007);
    mood.energy=clamp(mood.energy+dt*(held||userSpeech||mintieSpeech?-.002:.00025));
    mood.play=clamp(mood.play-dt*.002);
    hops=hops.filter(x=>at-x<60000);
    if(at<next || busy || held || userSpeech || mintieSpeech) return null;
    // Awake holds: 8–22s between choices, leaving headroom under the 25s idle ceiling.
    next=at+12000+8000*(1-mood.energy)-4000*Math.max(mood.curiosity,mood.play)+rand()*2000;
    const quiet=at-lastActivity;
    if(at<waryUntil)return {kind:'look',mode:'away'};
    if(mood.energy<.25 && quiet>=40000)return {kind:'drowsy'};
    if(mood.play>.45) {mood.play=clamp(mood.play-.18);return {kind:'micro',micro:'wiggle'};}
    if(mood.social>.55 && quiet>30000) {mood.social=clamp(mood.social-.2);return {kind:'social'};}
    if(mood.curiosity>.65 && !scripted && hops.length<2 && rand()<.2) {mood.curiosity=clamp(mood.curiosity-.14);return {kind:'hop'};}
    const weights=[1+3*mood.curiosity,1+4*mood.play,1+3*mood.curiosity,1+3*mood.social,1+3*(1-mood.energy),1+3*(1-mood.energy)];
    let pick=rand()*weights.reduce((a,b)=>a+b,0),index=0;
    while(index<weights.length-1 && (pick-=weights[index])>=0)index++;
    return {kind:'micro',micro:['look','wiggle','sunflower','hum-sway','stretch','double-blink'][index]};
  }
  return {event,update,mood:()=>Object.fromEntries(Object.entries(mood).map(([k,v])=>[k,Math.round(v*100)/100])),
    drowsy:()=>mood.energy<.25&&last-lastActivity>=40000,
    hopped(at=last){hops.push(at);}};
}
