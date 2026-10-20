import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {MirrorSession} from '../src/session';
import {Adb} from '../src/adb';
import type {Packet,TouchPoint} from '../src/protocol';
const root=process.cwd(),serial=process.argv[2]??'ZF523DZS5J';
const adb=new Adb(join(root,'resources/adb/adb.exe'));
const session=new MirrorSession(serial,{maxSize:1280,fps:30,bitrate:4000000},adb,join(root,'resources'));
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const audio:Packet[]=[],states:unknown[]=[];let video=0;
session.on('log',v=>console.log('ENGINE',v));session.on('video',()=>video++);
session.on('audio',(p:Packet)=>audio.push(p));session.on('audio-state',s=>{states.push(s);console.log('AUDIO',s);});
const fixture=(name:string)=>adb.device(serial,['exec-out','run-as','com.mirrorpanel.fixture','base64','files/'+name]).then(s=>Buffer.from(s.replace(/\s/g,''),'base64').toString('utf8'));
async function consent():Promise<void> {
  const remote='/data/local/tmp/mirrorpanel-test-consent.xml';
  try {
    for(let attempt=0;attempt<12;attempt++) {
      if(session.audioConfig)return;
      await adb.shell(serial,['uiautomator','dump',remote],15000);
      const xml=await adb.shell(serial,['cat',remote]);
      const node=xml.match(/<node\b[^>]*content-desc="MirrorPanel Test"[^>]*clickable="true"[^>]*>/)?.[0]
        ??xml.match(/<node\b[^>]*resource-id="(?:android:id\/button1|com.android.permissioncontroller:id\/permission_allow_foreground_only_button)"[^>]*>/)?.[0];
      const bounds=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if(bounds)await adb.shell(serial,['input','tap',String((+bounds[1]+ +bounds[3])/2),String((+bounds[2]+ +bounds[4])/2)]);
      await delay(400);
    }
    throw Error('Consent dialog positive button not found; no permission bypass attempted');
  } finally {await adb.shell(serial,['rm','-f',remote]).catch(()=>{});}
}
const forwards=async()=>(await adb.run(['forward','--list'])).split(/\r?\n/).filter(line=>line.startsWith(serial+' ')).join('\n');
async function main():Promise<void> {
  mkdirSync('build/smoke',{recursive:true});
  const previous=(await adb.shell(serial,['settings','get','secure','default_input_method'])).trim();
  const before=await forwards();
  await session.start();
  await adb.shell(serial,['am','force-stop','com.mirrorpanel.fixture']);
  await adb.shell(serial,['am','start','-W','-n','com.mirrorpanel.fixture/.MainActivity','--ez','tone','true']);await delay(600);
  const text='ação 日本語 中文 한국어 العربية עברית e\u0301 👩🏽‍💻 👨‍👩‍👧‍👦 𐐷\nFim';
  await session.text(text);await delay(300);assert.equal(await fixture('text.txt'),text,'Unicode changed on the real device');
  console.log('UNICODE_EXACT_OK');
  const a={id:3,x:.25,y:.7},b={id:9,x:.5,y:.75},c={id:17,x:.75,y:.8};
  const touch=async(action:number,id:number,pointers:TouchPoint[])=>{session.control({type:'touch',action,id,pointers});await delay(80);};
  await touch(0,3,[a]);await touch(0,9,[a,b]);await touch(0,17,[a,b,c]);await touch(1,9,[a,b,c]);await touch(2,17,[a,{...c,x:.8}]);
  session.control({type:'touch',action:3});await delay(200);
  let events: {action:number;index:number;pointers:{id:number}[]}[]=[];
  for(let i=0;i<30;i++){events=JSON.parse(await fixture('touch.json'));if(events.some(e=>e.action===3))break;await delay(100);}
  console.log('TOUCH_OBSERVED',JSON.stringify(events));
  assert.deepEqual(events.filter(e=>e.action!==2).map(e=>e.action),[0,5,5,6,3]);
  const lifted=events.find(e=>e.action===6)!;assert.equal(lifted.index,1);assert.deepEqual(lifted.pointers.map(p=>p.id),[0,1,2]);
  assert.ok(events.some(e=>e.action===2&&e.pointers.map(p=>p.id).join(',')==='0,2'));
  console.log('MULTITOUCH_DEVICE_OK',events.length);
  await session.setAudio(true);await consent();
  for(let i=0;i<100&&!session.audioConfig;i++)await delay(100);
  assert.ok(session.audioConfig,'AAC configuration missing');
  const recording=join(root,'build/smoke/features-'+Date.now()+'.mp4');session.startRecording(recording);
  await delay(3500);session.stopRecording();
  assert.ok(audio.filter(p=>!(p.flags&2)).length>60,'Too few audio packets');
  await session.setAudio(false);await delay(300);
  const afterStop=audio.length;await delay(400);assert.equal(audio.length,afterStop,'Audio continued after Stop');
  // Leaving an editor must reject text, not queue it for the next app.
  await adb.shell(serial,['am','force-stop','com.mirrorpanel.fixture']);
  await adb.shell(serial,['am','start','-W','-n','com.mirrorpanel.fixture/.MainActivity','--ez','readonly','true']);
  await delay(600);await assert.rejects(session.text('MUST_NOT_APPEAR'),/campo de texto/);
  await session.stop();
  const current=(await adb.shell(serial,['settings','get','secure','default_input_method'])).trim();assert.equal(current,previous,'IME was not restored');
  assert.equal(await forwards(),before,'Session leaked ADB forwards');
  const result={ok:true,serial,android:await adb.shell(serial,['getprop','ro.build.version.release']),videoPackets:video,unicodeExact:true,touchEvents:events,audioPackets:audio.length,audioStopped:true,imeRestored:true,recording,states};
  writeFileSync('build/smoke/feature-result.json',JSON.stringify(result,null,2));
  writeFileSync('build/smoke/audio-packets.json',JSON.stringify(audio.map(p=>({...p,data:p.data.toString('base64')}))));
  console.log('FEATURE_DEVICE_OK',JSON.stringify(result));
}
void main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await session.stop();await adb.shell(serial,['am','force-stop','com.mirrorpanel.fixture']).catch(()=>{});});
