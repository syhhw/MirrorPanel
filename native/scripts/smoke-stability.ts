import {join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Adb} from '../src/adb';
import {MirrorSession,DEFAULT_QUALITY} from '../src/session';
const root=process.cwd(),serial=process.argv[2]??'ZF523DZS5J';
const seconds=Number(process.argv[3]??90),label=process.argv[4]??'current';
const adb=new Adb(join(root,'resources/adb/adb.exe'));
const session=new MirrorSession(serial,DEFAULT_QUALITY,adb,join(root,'resources'));
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const started=Date.now(),events:unknown[]=[],samples:unknown[]=[];
let frames=0,heartbeats=0,lastVideo=Date.now(),maxVideoGap=0,ended='';
session.on('heartbeat',()=>heartbeats++);
session.on('video',()=>{const now=Date.now();maxVideoGap=Math.max(maxVideoGap,now-lastVideo);lastVideo=now;frames++;});
session.on('ended',reason=>{ended=reason;events.push({at:Date.now()-started,ended:reason});});
session.on('log',message=>{events.push({at:Date.now()-started,message});console.log('ENGINE',message);});
let awake='',ime='',forwards='',ok=false,error='';
async function run(){
  mkdirSync('build/smoke',{recursive:true});
  awake=await adb.shell(serial,['settings','get','global','stay_on_while_plugged_in']);
  ime=await adb.shell(serial,['settings','get','secure','default_input_method']);
  forwards=await adb.run(['forward','--list']);
  await adb.shell(serial,['settings','put','global','stay_on_while_plugged_in','7']);
  await session.start();
  await adb.shell(serial,['am','force-stop','com.mirrorpanel.fixture']);
  await adb.shell(serial,['am','start','-W','-n','com.mirrorpanel.fixture/.MainActivity','--ez','readonly','true']);
  const idle=Date.now();
  while(Date.now()-idle<seconds*1000){
    await delay(1000);
    if(ended)throw Error('Unexpected session end on idle screen: '+ended);
    if(Math.floor((Date.now()-idle)/1000)%10===0){
      const sample={elapsed:Date.now()-idle,frames,videoSilenceMs:Date.now()-lastVideo,state:session.state};
      samples.push(sample);console.log('IDLE_SAMPLE',JSON.stringify(sample));
    }
  }
  assert.equal(session.state,'mirroring');
  const before=frames;session.control({type:'sync'});
  // Requesting an IDR affects the next encoder input; it need not generate a
  // frame for an unchanged surface. A touch changes the synthetic fixture.
  session.control({type:'touch',action:0,x:.5,y:.7});
  session.control({type:'touch',action:1,x:.5,y:.7});
  for(let i=0;i<50&&frames===before;i++)await delay(100);
  assert.ok(frames>before,'Stream did not resume on sync after idle');
  ok=true;
}
void run().catch(e=>{error=String(e);console.error(e);process.exitCode=1;}).finally(async()=>{
  await session.stop();
  if(awake)await adb.shell(serial,['settings','put','global','stay_on_while_plugged_in',awake]);
  await adb.shell(serial,['am','force-stop','com.mirrorpanel.fixture']);
  const cleanup={imeRestored:(await adb.shell(serial,['settings','get','secure','default_input_method']))===ime,
    forwardsRestored:(await adb.run(['forward','--list']))===forwards,
    awakeRestored:(await adb.shell(serial,['settings','get','global','stay_on_while_plugged_in']))===awake};
  if(!Object.values(cleanup).every(Boolean)){ok=false;process.exitCode=1;}
  const result={ok,serial,seconds,quality:DEFAULT_QUALITY,frames,heartbeats,maxVideoGap,events,samples,error,cleanup};
  writeFileSync('build/smoke/stability-'+label+'.json',JSON.stringify(result,null,2));
  console.log('STABILITY_RESULT',JSON.stringify(result));
});
