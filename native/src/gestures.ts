import type {TouchPoint} from './protocol';
type TouchCommand={type:'touch';action:number;id?:number;pointers?:TouchPoint[]};
/** Android IDs are allocated independently of browser pointer IDs. */
export class Gestures {
  private points=new Map<number,TouchPoint>();
  private browsers=new Map<number,number>();
  constructor(private send:(command:TouchCommand)=>void) { }
  get active():boolean{return this.points.size>0;}
  get anchor():TouchPoint|undefined{return this.points.get(0);}
  private emit(action:number,id:number):void {this.send({type:'touch',action,id,pointers:[...this.points.values()].map(p=>({...p}))});}
  anchorAt(x:number,y:number):void {
    if(this.points.has(0)){this.emit(1,0);this.points.delete(0);}
    else if(this.points.size<10){this.points.set(0,{id:0,x,y});this.emit(0,0);}
  }
  down(browserId:number,x:number,y:number):void {
    if(this.browsers.has(browserId)||this.points.size>=10)return;
    let id=1;while(this.points.has(id))id++;
    this.browsers.set(browserId,id);this.points.set(id,{id,x,y});this.emit(0,id);
  }
  move(browserId:number,x:number,y:number):void {
    const id=this.browsers.get(browserId);if(id===undefined)return;
    this.points.set(id,{id,x,y});this.emit(2,id);
  }
  up(browserId:number,x:number,y:number):void {
    const id=this.browsers.get(browserId);if(id===undefined)return;
    this.points.set(id,{id,x,y});this.emit(1,id);this.points.delete(id);this.browsers.delete(browserId);
  }
  cancel():void {if(this.active)this.send({type:'touch',action:3});this.points.clear();this.browsers.clear();}
}
