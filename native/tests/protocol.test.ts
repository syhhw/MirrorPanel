import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PacketReader,controlPacket,validateControl,avcConfiguration,lengthPrefixed,parseInfo,MAX_PACKET} from '../src/protocol';
import {parseDevices,shellQuote} from '../src/adb';
import {quality} from '../src/session';
function packet(payload:Buffer,flags=1):Buffer {const h=Buffer.alloc(20);h.writeUInt32BE(0x4d505631);h[4]=2;h[5]=flags;h.writeUInt32BE(payload.length,8);h.writeBigUInt64BE(1234567n,12);return Buffer.concat([h,payload]);}
test('TCP fragmented at every byte retains exact frame and timestamp',()=>{
  const reader=new PacketReader(),data=packet(Buffer.from([0,0,0,1,101,33]));
  const frames=Array.from(data).flatMap(byte=>reader.feed(Buffer.from([byte])));
  assert.equal(frames.length,1);assert.equal(frames[0].pts,1234567);assert.deepEqual(frames[0].data,data.subarray(20));reader.end();
});
test('TCP coalesces multiple frames without losing the next partial header',()=>{
  const data=packet(Buffer.from([4,5])),reader=new PacketReader();
  assert.equal(reader.feed(Buffer.concat([data,data,data.subarray(0,7)])).length,2);
  assert.equal(reader.feed(data.subarray(7)).length,1);reader.end();
});
test('malformed framing and allocation bombs are rejected',()=>{
  for(const mutate of [(b:Buffer)=>b.writeUInt32BE(0,0),(b:Buffer)=>b.writeUInt32BE(MAX_PACKET+1,8),(b:Buffer)=>b[4]=255,(b:Buffer)=>b[6]=1]){
    const data=packet(Buffer.alloc(0));mutate(data);assert.throws(()=>new PacketReader().feed(data));
  }
  const reader=new PacketReader();reader.feed(packet(Buffer.from([1])).subarray(0,20));assert.throws(()=>reader.end(),/truncado/);
});
test('control validates coordinates, commands, numbers and bounded text',()=>{
  for(const invalid of [null,{type:'shell',command:'rm'},{type:'touch',action:2,x:NaN,y:0},{type:'touch',action:9,x:0,y:0},{type:'touch',action:1,x:2,y:0},{type:'text',text:'x'.repeat(65537)},{type:'key',code:-1}])assert.throws(()=>validateControl(invalid));
  const b=controlPacket({type:'touch',action:0,x:.5,y:.25});assert.equal(b.readUInt32BE(),b.length-4);assert.equal(JSON.parse(b.subarray(4).toString()).x,.5);
});
test('Annex-B config derives exact codec and avcC, frames become MP4 length-prefixed',()=>{
  const data=Buffer.from([0,0,0,1,0x67,0x42,0,0x1f,0x55,0,0,1,0x68,0xaa]);
  const config=avcConfiguration(data);assert.equal(config.codec,'avc1.42001f');assert.equal(config.description[0],1);
  assert.deepEqual(Buffer.from(lengthPrefixed(Buffer.from([0,0,1,0x65,42]))),Buffer.from([0,0,0,2,0x65,42]));
  assert.throws(()=>avcConfiguration(Buffer.from([0,0,1,0x65,42])));
});
test('metadata and quality reject invalid dimensions and options',()=>{
  assert.throws(()=>parseInfo(Buffer.from('{"codec":"h264","width":-1}')));
  assert.throws(()=>quality({maxSize:1920,fps:1000,bitrate:8000000}));
  assert.equal(quality({maxSize:1920,fps:60,bitrate:8000000}).fps,60);
});
test('ADB preserves unauthorized devices and shell escapes quotes and substitutions',()=>{
  const devices=parseDevices('List of devices attached\r\nabc device product:a model:Pixel_6 device:a\r\nx unauthorized\r\n');
  assert.equal(devices[0].model,'Pixel 6');assert.equal(devices[1].state,'unauthorized');
  assert.equal(shellQuote("a'b$()`"),"'a'\\''b$()`'");
});
