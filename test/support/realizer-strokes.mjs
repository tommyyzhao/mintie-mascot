import { createPerformer } from '../../web/perform/engine.js';

// Body/nub excursion thresholds (subset of the old alive-analyze table).
const THRESHOLDS = { leanX: .06, leanZ: .06, squash: .065, twist: .08, offsetX: .025, offsetY: .025, offsetZ: .025, nubL: .12, nubR: .12 };
const channels = p => ({ leanX:p.body.lean[0], leanZ:p.body.lean[1], squash:p.body.squash, twist:p.body.twist,
  offsetX:p.body.offset[0], offsetY:p.body.offset[1], offsetZ:p.body.offset[2],
  nubL:Math.max(0,...p.buds.filter(b=>b.side==='L').map(b=>b.reach)), nubR:Math.max(0,...p.buds.filter(b=>b.side==='R').map(b=>b.reach)) });
// seed 1, 10ms resolution, sustained conversation move.
export function sampleStroke(emoji) {
  const performer=createPerformer({seed:1}), base=channels(performer.update(0));
  const run=performer.play(emoji,{sustainUntil:()=>true});
  let peak=-Infinity, strokeMs=0;
  for(let at=0;at<=run.durationMs;at+=10) {
    const frame=channels(performer.update(at));
    const excursion=Math.max(0,...Object.keys(frame).map(k=>Math.abs(frame[k]-base[k])/THRESHOLDS[k]));
    if(excursion>peak) {peak=excursion;strokeMs=at;}
  }
  return strokeMs;
}
