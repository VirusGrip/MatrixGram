import {useEffect,useRef,useState} from 'react';
import {Minus,Plus,RotateCcw,Download} from 'lucide-react';
import {Modal} from './ui';
export function ImageViewer({url,name,close,save}:{url:string;name:string;close:()=>void;save:()=>void}){
  const [zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0});
  const host=useRef<HTMLDivElement>(null),pointers=useRef(new Map<number,{x:number;y:number}>()),gesture=useRef<{distance:number;zoom:number}|null>(null);
  const adjust=(value:number)=>{const next=Math.max(1,Math.min(8,value));setZoom(next);if(next===1)setOffset({x:0,y:0});};
  useEffect(()=>{const el=host.current!;const wheel=(event:WheelEvent)=>{event.preventDefault();adjust(zoom*(event.deltaY<0?1.2:1/1.2));};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[zoom]);
  const release=(id:number)=>{pointers.current.delete(id);gesture.current=null;};
  return <Modal title={name} close={close}><div className="image-viewer"><div className="image-controls"><button className="icon-button" aria-label="Уменьшить изображение" disabled={zoom<=1} onClick={()=>adjust(zoom/1.5)}><Minus/></button><output aria-label="Масштаб изображения">{Math.round(zoom*100)}%</output><button className="icon-button" aria-label="Увеличить изображение" disabled={zoom>=8} onClick={()=>adjust(zoom*1.5)}><Plus/></button><button className="icon-button" aria-label="Сбросить масштаб" onClick={()=>{adjust(1);setOffset({x:0,y:0});}}><RotateCcw/></button></div>
    <div className="image-viewport" ref={host} onDoubleClick={()=>{adjust(zoom===1?2:1);}} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];gesture.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};}}} onPointerMove={event=>{const old=pointers.current.get(event.pointerId);if(!old)return;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.current.size===2&&gesture.current){const [a,b]=[...pointers.current.values()];adjust(gesture.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,gesture.current.distance));}else if(zoom>1)setOffset(current=>({x:current.x+event.clientX-old.x,y:current.y+event.clientY-old.y}));}} onPointerUp={event=>release(event.pointerId)} onPointerCancel={event=>release(event.pointerId)} onLostPointerCapture={event=>release(event.pointerId)}>
      <img src={url} alt={name} draggable={false} style={{transform:`translate(${zoom===1?0:offset.x}px,${zoom===1?0:offset.y}px) scale(${zoom})`}}/>
    </div><button className="text-button" onClick={save}><Download size={16}/>Сохранить изображение</button></div></Modal>;
}
