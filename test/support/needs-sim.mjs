import {createNeeds} from '../../web/needs.js';
const names=['still','look','social','micro','hop','drowsy'];
// Same seeded 10-minute fixture; split the conversation into user/Mintie speech.
const scriptedState=t=>({userSpeech:t>=180000&&t<190000,mintieSpeech:t>=190000&&t<200000});
export function simulate({seed=42,stateAt=scriptedState}={}) {
  const n=createNeeds({seed}),minutes=Array.from({length:10},()=>Object.fromEntries(names.map(k=>[k,0]))),curves=[];
  let lastAction=0,longestStillness=0,eligibleGap=0,longestEligibleStillness=0;
  for(let t=0;t<600000;t+=1000){
    if([90000,92000,94000].includes(t))n.event('poke',t);
    if(t===180000)n.event('userSpeech',t);if(t===190000)n.event('mintieSpeech',t);if(t===270000)n.event('throw',t);
    const state=stateAt(t),suppressed=state.userSpeech||state.mintieSpeech||state.held;
    let choice;
    choice=n.update(t,state);if(choice?.kind==='hop')n.hopped(t);
    const visible=choice&&choice.kind!=='still'&&choice.kind!=='drowsy';
    if(choice)minutes[Math.floor(t/60000)][choice.kind]++;
    if(visible){longestStillness=Math.max(longestStillness,t-lastAction);lastAction=t;}
    // Contiguous eligible intervals, including their start/tail; suppression breaks a gap.
    const eligible=!suppressed&&!state.drowsy&&!n.drowsy();
    if(!eligible)eligibleGap=0;
    else {if(visible)eligibleGap=0;eligibleGap+=1000;longestEligibleStillness=Math.max(longestEligibleStillness,eligibleGap);}
    if(t%60000===0)curves.push(n.mood());
  }
  longestStillness=Math.max(longestStillness,600000-lastAction);
  return {minutes,longestStillness,longestEligibleStillness,curves};
}
