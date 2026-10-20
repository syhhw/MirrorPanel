export interface Bounds {x:number;y:number;width:number;height:number}
export const MIRROR_BARS=86;
export const MIRROR_MIN_WIDTH=240;
export const RESIZE_SETTLE_MS=500;

/** Native drag is free. After settling, fit to its longest side and preserve its top-left. */
export function accommodatedBounds(bounds:Bounds,ratio:number,area:Bounds,extra={width:0,height:MIRROR_BARS}):Bounds {
  if(!Number.isFinite(ratio)||ratio<=0)throw Error('Invalid display ratio');
  const square=Math.max(bounds.width-extra.width,bounds.height-extra.height);
  const wanted=ratio>=1?square:square*ratio;
  const maximum=Math.max(1,Math.min(area.width-extra.width,(area.height-extra.height)*ratio));
  const minimum=Math.min(maximum,Math.max(1,MIRROR_MIN_WIDTH-extra.width));
  const videoWidth=Math.min(maximum,Math.max(minimum,wanted));
  const width=Math.round(videoWidth)+extra.width,height=Math.round(videoWidth/ratio)+extra.height;
  return {x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))),width,height};
}
