/** Original implementation of the observed press/expand/fade interaction. */
export function bindRipple(button:HTMLButtonElement):void {
  let release:(()=>void)|undefined;
  const begin=(x:number,y:number)=>{
    release?.();
    const size=Math.hypot(button.clientWidth,button.clientHeight);
    const ripple=document.createElement('span');ripple.className='nav-ripple';
    ripple.style.width=ripple.style.height=size+'px';
    ripple.style.left=(button.clientWidth-size)/2+'px';ripple.style.top=(button.clientHeight-size)/2+'px';
    ripple.style.setProperty('--ripple-x',(x-button.clientWidth/2)+'px');
    ripple.style.setProperty('--ripple-y',(y-button.clientHeight/2)+'px');
    button.append(ripple);const started=performance.now();let ended=false;
    release=()=>{if(ended)return;ended=true;setTimeout(()=>{ripple.classList.add('nav-ripple-out');setTimeout(()=>ripple.remove(),300);},Math.max(0,250-(performance.now()-started)));};
  };
  button.addEventListener('pointerdown',event=>{if(event.button!==0)return;const rect=button.getBoundingClientRect();begin(event.clientX-rect.left,event.clientY-rect.top);});
  for(const event of ['pointerup','pointercancel','pointerleave','blur'])button.addEventListener(event,()=>release?.());
  button.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat)begin(button.clientWidth/2,button.clientHeight/2);});
  button.addEventListener('keyup',()=>release?.());
}
