import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadKeys } from '../server/server.mjs';

const args=process.argv.slice(2), env=args[args.indexOf('--env-file')+1];
if(!args.includes('--env-file') || !env || !args.includes('--allow-provider')) {
  console.error('Usage: node tools/render-fillers.mjs --env-file <file> --allow-provider');process.exit(1);
}
const kinds={
  thinking:['Hmm.','Mmm?','Hm…','[happy hum] Mmm.','Hmmm.','Mm…','Hmm?','Mmm.','Hm-hm.','[sighs] Hmm.'],
  acknowledging:['Mm-hm.','Mhm!','Mmm-hm.','Mm!','Hm-hm!','M-hm.','[happy hum] Mm.','Mm-mm.','Mmm!','Hm!'],
  amused:['[giggles] Hehe.','Hehe!','[snickers] Heh.','Hee-hee.','[laughs] Haha.','Heh!','[giggles] Mm.','Hihi!','[snickers] Heh.','Hehehe.'],
  surprised:['[gasps] Ah.','Ooh!','Oh!','Ah!','[gasps] Oh.','Ooh?','Huh!','[gasps] Ah.','Oh?!','Aah!'],
  sympathetic:['Aww.','[sighs] Ahh.','Mm…','Aah…','Ohh.','Mmm.','Aww…','[sighs] Mm.','Ooh…','Ahh.'],
  excited:['Ooh!','[squeals] Eee.','Eee!','Ah!','Ooh-ooh!','[giggles] Eee.','Mmm!','[squeals] Ah.','Ooh!!','Hee!'],
  curious:['Oh?','Hmm?','Ooh?','Hm?','Mmm?','Ah?','Ohh?','Huh?','Mm-hm?','Ooh…?'],
};
const dir=fileURLToPath(new URL('../web/assets/fillers/',import.meta.url));
// Persistent reservation before every fetch: failed/interrupted generations still consume the cap.
const ledger=new URL('../tmp/filler-attempts.json',import.meta.url);
let temp;
try {
  const {ELEVENLABS_API_KEY:key}=await loadKeys(env);
  if(!key)throw Error('missing_key');
  await mkdir(dir,{recursive:true});
  await mkdir(fileURLToPath(new URL('.',ledger)),{recursive:true});
  let counts={attempts:0,characters:0};
  try {counts=JSON.parse(await readFile(ledger,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Number.isInteger(counts.attempts)||counts.attempts<0||!Number.isInteger(counts.characters)||counts.characters<0)throw Error('invalid_counter');
  temp=await mkdtemp(join(tmpdir(),'mintie-fillers-'));
  const manifest={};
  for(const [kind,texts]of Object.entries(kinds)) {
    manifest[`filler_${kind}`]=[];
    for(let i=0;i<texts.length;i++) {
      const file=`${kind}-${String(i+1).padStart(2,'0')}.mp3`, target=join(dir,file);
      try {await readFile(target);manifest[`filler_${kind}`].push(file);continue;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(counts.attempts>=120 || counts.characters+texts[i].length>8000)throw Error('budget_cap');
      counts.attempts++;counts.characters+=texts[i].length;
      await writeFile(ledger,JSON.stringify(counts)+'\n');
      const response=await fetch('https://api.elevenlabs.io/v1/text-to-speech/ocZQ262SsZb9RIxcQBOj?output_format=pcm_24000',{method:'POST',headers:{'xi-api-key':key,'content-type':'application/json'},body:JSON.stringify({text:texts[i],model_id:'eleven_v4_turbo'}),signal:AbortSignal.timeout(30000)});
      if(!response.ok){await response.body?.cancel();throw Error(`provider_http_${response.status}`);}
      const pcm=Buffer.from(await response.arrayBuffer());
      if(!pcm.length || pcm.length>24000*2*15)throw Error('invalid_audio');
      const input=join(temp,'raw.pcm'),trimmed=join(temp,'trim.wav'),out=join(temp,'clip.mp3');
      await writeFile(input,pcm);
      execFileSync('ffmpeg',['-v','error','-y','-f','s16le','-ar','24000','-ac','1','-i',input,'-af','silenceremove=start_periods=1:start_duration=0.005:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_duration=0.005:start_threshold=-40dB,areverse',trimmed]);
      const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',trimmed],{encoding:'utf8'}).trim());
      if(!Number.isFinite(duration)||duration<.04)throw Error('silent_audio');
      // ponytail: very long tags become a short excerpt; replace after human ear review, never synthesize words.
      const speed=Math.min(2,Math.max(1,duration/.62));
      execFileSync('ffmpeg',['-v','error','-y','-i',trimmed,'-af',`atempo=${speed},atrim=duration=0.65,loudnorm=I=-20:TP=-3:LRA=7,afade=t=out:st=0.60:d=0.05`,'-ar','24000','-ac','1',out]);
      const actual=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',out],{encoding:'utf8'}).trim());
      if(actual>.7001)throw Error('clip_too_long');
      await writeFile(target,await readFile(out),{flag:'wx'});
      manifest[`filler_${kind}`].push(file);
      console.log(JSON.stringify({kind,file,ms:Math.round(actual*1000),attempts:counts.attempts}));
    }
  }
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({ok:true,...counts}));
} catch(error) {console.error(['missing_key','budget_cap','invalid_counter','invalid_audio','silent_audio','clip_too_long'].includes(error.message)||/^provider_http_\d+$/.test(error.message)?error.message:'filler_generation_failed');process.exitCode=1;}
finally {if(temp)await rm(temp,{recursive:true});}
