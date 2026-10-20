import {openSync,closeSync,writeSync,unlinkSync} from 'node:fs';
import {Muxer,StreamTarget} from 'mp4-muxer';
import {avcConfiguration,lengthPrefixed,VideoInfo,Packet} from './protocol';

/** Remux original H.264 to fragmented MP4. No re-encoding or FFmpeg. */
export class Recording {
  private fd:number;
  private muxer:Muxer<StreamTarget>;
  private started=false;
  private firstPts=0;
  private closed=false;
  private config:ReturnType<typeof avcConfiguration>;
  constructor(readonly path:string,info:VideoInfo,config:Buffer,private fps:number,private audioConfig?:Buffer) {
    this.config=avcConfiguration(config);
    this.fd=openSync(path,'wx');
    this.muxer=new Muxer({target:new StreamTarget({onData:(data,position)=>{
      let written=0;
      while(written<data.length) written+=writeSync(this.fd,data,written,data.length-written,position+written);
    },chunked:true,chunkSize:1024*1024}),video:{codec:'avc',width:info.width,height:info.height},
    audio:audioConfig?{codec:'aac',sampleRate:48000,numberOfChannels:2}:undefined,
    fastStart:'fragmented',firstTimestampBehavior:'cross-track-offset'});
  }
  addAudio(packet:Packet):void {
    if(this.closed||!this.audioConfig||!this.started||packet.flags&2||packet.pts<this.firstPts)return;
    this.muxer.addAudioChunkRaw(packet.data,'key',packet.pts-this.firstPts,Math.round(1024*1000000/48000),
      {decoderConfig:{codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,description:new Uint8Array(this.audioConfig)}});
  }
  add(packet:Packet):void {
    if(this.closed || packet.flags&2) return;
    const key=Boolean(packet.flags&1);
    if(!this.started) {
      if(!key) return;
      this.firstPts=packet.pts;this.started=true;
    }
    this.muxer.addVideoChunkRaw(lengthPrefixed(packet.data),key?'key':'delta',packet.pts-this.firstPts,Math.round(1000000/this.fps),
      {decoderConfig:{codec:this.config.codec,description:this.config.description as Uint8Array<ArrayBuffer>,codedWidth:undefined,codedHeight:undefined}});
  }
  finish():void {
    if(this.closed) return;
    this.closed=true;
    try {if(this.started)this.muxer.finalize();}
    finally {closeSync(this.fd);if(!this.started)unlinkSync(this.path);}
  }
}
