// Pre-sampled stroke timings (seed 1, 10 ms; see test/support/realizer-strokes.mjs); no sampling in the render loop.
// ponytail: seed 1, 10ms, neutral onset + sustained move; live crossfades/pose baselines can shift the peak.
export const STROKE_MS = Object.freeze({"😅":340,"😂":1210,"🙂":1500,"😉":340,"😘":340,"😋":390,"😜":830,"🤑":340,"🤗":400,"🤫":390,"🤔":390,"🫡":390,"😐":1500,"🤨":340,"😏":340,"🙄":350,"😌":350,"😴":1180,"😷":900,"🤢":390,"🤧":390,"🥵":350,"🥶":900,"😵‍💫":370,"😎":390,"😟":940,"😮":340,"😳":340,"🥺":340,"😭":1310,"😱":460,"😞":350,"😫":340,"😠":340,"🙈":390,"🙉":390,"❤️":390,"💔":340,"👋":390,"🤏":390,"✌️":390,"🤞":390,"🤙":390,"👉":390,"👍":390,"👎":390,"👏":930,"🤝":380,"🙏":390,"💪":390,"🙅":390,"🤷":400,"🤦":390,"🧏":390,"✨":540,"🎉":460,"🔥":340,"👀":340,"💡":390,"💃":380,"🙂‍↕️":750,"🙂‍↔️":750,"🦘":840,"🤸":1100});
export const STROKE_THRESHOLDS = [.06,.06,.065,.08,.025,.025,.025,.12,.12];
// Seconds on the audio clock. Prefer the affiliate window; callers preserve late choices.
export function cuePlan({wordAt,wordEnd=Infinity,now,strokeMs}) {
  if(!Number.isFinite(wordAt)||!Number.isFinite(now)||!Number.isFinite(strokeMs)||strokeMs<0)return null;
  const start=Math.max(wordAt-strokeMs/1000,now);
  const strokeAt=start+strokeMs/1000;
  // T3 window: late strokes read worse than early ones (Leonard & Cummins 2011), so −150…+100 ms.
  return strokeAt<=wordEnd && strokeAt-wordAt>=-.150 && strokeAt-wordAt<=.100 ? {start,strokeAt} : null;
}
export const nodAllowed = ({speechAt,at,detectedAt,lastNodAt=-Infinity}) =>
  Number.isFinite(speechAt)&&Number.isFinite(at)&&Number.isFinite(detectedAt)&&
  at-Math.max(speechAt,lastNodAt)>=700 && detectedAt-lastNodAt>=1200;
export const beatsSuppressed = (now,strokeAt) => Number.isFinite(strokeAt)&&Math.abs(now-strokeAt)<=350;
