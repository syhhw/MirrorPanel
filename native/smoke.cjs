const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=__dirname;
app.setPath('userData',path.join(root,'build','smoke','electron-profile'));
process.env.MIRRORPANEL_SMOKE_SERIAL=process.argv[2]||'emulator-5554';
process.env.MIRRORPANEL_TEST_MEDIA_ROOT=path.join(root,'build','smoke','media');
const errors=[];
app.on('browser-window-created',(_event,window)=>{
  window.webContents.on('console-message',(_event,level,message)=>{if(level>=2)errors.push(message);});
  window.webContents.on('render-process-gone',(_event,details)=>errors.push(JSON.stringify(details)));
});
require('./build/desktop/main.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
setTimeout(async()=>{
  try{
    let mirror,frames=0;
    for(let i=0;i<120;i++){
      mirror=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=mirror'));
      if(mirror)frames=await mirror.webContents.executeJavaScript('Number(document.querySelector("canvas")?.dataset.frames||0)');
      if(frames>=10)break;
      await delay(500);
    }
    if(!mirror||frames<10)throw Error('WebCodecs did not decode: '+JSON.stringify(errors));
    const panel=BrowserWindow.getAllWindows().find(w=>w!==mirror);
    const snapshot=await panel.webContents.executeJavaScript('window.mirrorpanel.snapshot()');
    assert.equal(snapshot.devices[0].session,'mirroring');
    const recording=await mirror.webContents.executeJavaScript('window.mirrorpanel.record()');
    await mirror.webContents.executeJavaScript('window.mirrorpanel.control({type:"key",code:3})');
    await delay(2500);
    await mirror.webContents.executeJavaScript('window.mirrorpanel.record()');
    assert.ok(fs.statSync(recording).size>1000,'MP4 file is empty');
    const png=await mirror.capturePage();fs.writeFileSync(path.join(root,'build/smoke/mirror.png'),png.toPNG());
    const panelImage=await panel.capturePage();fs.writeFileSync(path.join(root,'build/smoke/panel.png'),panelImage.toPNG());
    const videoBytes=fs.readFileSync(recording).toString('base64');
    const playback=await mirror.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const v=document.createElement('video');v.muted=true;v.onloadeddata=()=>resolve({width:v.videoWidth,height:v.videoHeight,duration:v.duration});v.onerror=()=>reject(Error('MP4 playback failed '+v.error?.message));v.src='data:video/mp4;base64,${videoBytes}';v.load();})`);
    assert.ok(playback.width>0,'MP4 not decodable');
    await mirror.webContents.executeJavaScript('window.mirrorpanel.screenshot()');await delay(500);
    const diagnostics=await mirror.webContents.executeJavaScript('({frames:Number(document.querySelector("canvas").dataset.frames),dropped:Number(document.querySelector("canvas").dataset.dropped),width:document.querySelector("canvas").width,height:document.querySelector("canvas").height})');
    mirror.close();await delay(2500);
    const after=await panel.webContents.executeJavaScript('window.mirrorpanel.snapshot()');
    assert.equal(after.devices[0].session,null,'Closing mirror restarted it');
    fs.writeFileSync(path.join(root,'build/smoke/electron-result.json'),JSON.stringify({ok:true,diagnostics,playback,recording,errors,closedWithoutRestart:true},null,2));
    console.log('ELECTRON_SMOKE_OK',JSON.stringify({diagnostics,playback,errors}));
    app.quit();
  }catch(error){console.error(error);fs.writeFileSync(path.join(root,'build/smoke/electron-result.json'),JSON.stringify({ok:false,error:String(error),errors},null,2));app.quit();process.exitCode=1;}
},1000);
