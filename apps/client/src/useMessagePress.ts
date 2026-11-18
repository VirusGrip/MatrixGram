import {useEffect, useRef, type MouseEvent, type PointerEvent} from 'react';
import type {MessageMenuTarget} from './MessageMenu';

// One pending gesture for the virtualized timeline; scrolling or a second finger cancels it.
export function useMessagePress() {
  const pending=useRef<{timer:number;x:number;y:number;pointer:number}|null>(null);
  const suppress=useRef<{anchor:HTMLElement;until:number}|null>(null);
  const cancel=()=>{if(pending.current)window.clearTimeout(pending.current.timer);pending.current=null;};
  useEffect(()=>{
    const additionalPointer=(event:globalThis.PointerEvent)=>{if(!event.isPrimary)cancel();};
    window.addEventListener('scroll',cancel,true);window.addEventListener('blur',cancel);
    window.addEventListener('pointerdown',additionalPointer,true);
    return ()=>{cancel();window.removeEventListener('scroll',cancel,true);window.removeEventListener('blur',cancel);window.removeEventListener('pointerdown',additionalPointer,true);};
  },[]);
  return {
    begin(event:PointerEvent<HTMLElement>,activate:(target:MessageMenuTarget)=>void){
      cancel();suppress.current=null;
      if(event.pointerType!=='touch'||!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest('button,a,input,audio,video'))return;
      const anchor=event.currentTarget,x=event.clientX,y=event.clientY;
      pending.current={x,y,pointer:event.pointerId,timer:window.setTimeout(()=>{
        pending.current=null;
        if(!anchor.isConnected)return;
        suppress.current={anchor,until:Date.now()+1000};activate({anchor,x,y});
      },450)};
    },
    move(event:PointerEvent<HTMLElement>){const start=pending.current;if(start&&(start.pointer!==event.pointerId||Math.hypot(event.clientX-start.x,event.clientY-start.y)>10))cancel();},
    cancel,
    click(event:MouseEvent<HTMLElement>){if(suppress.current?.anchor===event.currentTarget&&Date.now()<suppress.current.until){event.preventDefault();event.stopPropagation();suppress.current=null;}},
  };
}
