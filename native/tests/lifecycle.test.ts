import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Adb} from '../src/adb';
import {MirrorSession,DEFAULT_QUALITY} from '../src/session';

test('Stop during a delayed ADB push cleans the late remote allocation and never launches',async()=>{
  let finishPush:(v:string)=>void=()=>{};
  let pushed:()=>void=()=>{};
  const startedPush=new Promise<void>(resolve=>pushed=resolve);
  const commands:string[]=[];
  class FakeAdb extends Adb {
    override async shell(_serial:string,words:string[]):Promise<string>{commands.push(words.join(' '));return words[0]==='getprop'?'37':'';}
    override async device(_serial:string,args:string[]):Promise<string>{
      commands.push(args[0]);
      if(args[0]==='push'){pushed();return new Promise(resolve=>finishPush=resolve);}
      throw Error('Should not install after cancellation');
    }
  }
  const session=new MirrorSession('fake',DEFAULT_QUALITY,new FakeAdb('unused'),'unused');
  const result=session.start().catch(e=>String(e));
  await startedPush;await session.stop();finishPush('pushed');await result;
  assert.equal(session.state,'stopped');assert.equal(commands.filter(c=>c.startsWith('rm -f')).length,2);
  assert.ok(!commands.includes('install'));
});
test('unsupported Android fails explicitly and cleanup emits one terminal event',async()=>{
  class FakeAdb extends Adb {override async shell(_s:string,args:string[]):Promise<string>{return args[0]==='getprop'?'28':'';}}
  const session=new MirrorSession('fake',DEFAULT_QUALITY,new FakeAdb('unused'),'unused');
  let ended=0;session.on('ended',()=>ended++);
  await assert.rejects(session.start(),/Android 10/);await session.stop();await session.stop();assert.equal(ended,1);
});
