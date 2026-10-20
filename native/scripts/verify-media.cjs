const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, 'build/smoke/media-verifier'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    const directory = path.join(root, 'build/smoke');
    const file =
      process.argv[2] ||
      fs
        .readdirSync(directory)
        .filter((x) => /^features-.*\.mp4$/.test(x))
        .sort()
        .at(-1);
    const filename = path.isAbsolute(file) ? file : path.join(directory, file);
    const bytes = fs.readFileSync(filename);
    await window.loadURL('data:text/html,<html><title>Media verification</title></html>');
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const base64=${JSON.stringify(bytes.toString('base64'))};
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const video=document.createElement('video');video.muted=true;
      const dimensions=await new Promise((resolve,reject)=>{video.onloadeddata=()=>resolve({width:video.videoWidth,height:video.videoHeight,duration:video.duration});video.onerror=()=>reject(Error(video.error?.message));video.src=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));video.load();});
      const context=new OfflineAudioContext(2,1,48000);const audio=await context.decodeAudioData(bytes.buffer);
      const samples=audio.getChannelData(0);let peak=0,squares=0,crossings=0;
      for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));squares+=samples[i]**2;if(i&&samples[i-1]<0&&samples[i]>=0)crossings++;}
      return {video:dimensions,audio:{channels:audio.numberOfChannels,sampleRate:audio.sampleRate,duration:audio.duration,peak,rms:Math.sqrt(squares/samples.length),frequency:crossings/audio.duration}};
    })()`);
    assert.ok(result.video.width > 0 && result.video.duration > 1);
    assert.equal(result.audio.sampleRate, 48000);
    assert.equal(result.audio.channels, 2);
    assert.ok(result.audio.peak > 0.01, 'Captured audio is silent');
    assert.ok(
      result.audio.frequency > 425 && result.audio.frequency < 455,
      '440 Hz test tone was not preserved',
    );
    fs.writeFileSync(
      path.join(directory, 'media-result.json'),
      JSON.stringify({ ok: true, file: filename, ...result }, null, 2),
    );
    console.log('MEDIA_DECODE_OK', JSON.stringify(result));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
