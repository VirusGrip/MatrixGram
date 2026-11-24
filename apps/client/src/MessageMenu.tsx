import {useLayoutEffect, useEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';
import {EmojiChoices} from './EmojiPanel';
export interface MessageMenuTarget {x: number; y: number; anchor: HTMLElement}

export function MessageMenu({target, close, react, children}: {target: MessageMenuTarget; close: () => void; react: (emoji: string) => void; children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{left:number; top:number} | null>(null);
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef(close); closeRef.current = close;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const scale = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const width = window.innerWidth / scale, height = window.innerHeight / scale;
    const x = target.x / scale, y = target.y / scale;
    setPosition({left:Math.max(8,Math.min(x,width-element.offsetWidth-8)),top:Math.max(8,Math.min(y,height-element.offsetHeight-8))});
  }, [target, expanded]);
  useEffect(() => {
    const previous = target.anchor;
    ref.current?.querySelector<HTMLButtonElement>('.context-actions button')?.focus({preventScroll:true});
    const outside = (event: Event) => {if (!ref.current?.contains(event.target as Node)) closeRef.current();};
    const escape = (event: KeyboardEvent) => {if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current();}};
    const resize = () => closeRef.current();
    window.addEventListener('pointerdown',outside,true);
    window.addEventListener('scroll',outside,true);
    window.addEventListener('keydown',escape,true);
    window.addEventListener('resize',resize);
    return () => {
      window.removeEventListener('pointerdown',outside,true);
      window.removeEventListener('scroll',outside,true);
      window.removeEventListener('keydown',escape,true);
      window.removeEventListener('resize',resize);
      if(document.activeElement===document.body && previous.isConnected) previous.focus({preventScroll:true});
    };
  }, [target]);
  return createPortal(<div ref={ref} className="message-menu message-context-menu" role="menu" aria-label="Действия с сообщением" style={{left:position?.left??0,top:position?.top??0,visibility:position?'visible':'hidden'}} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
    if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
    event.preventDefault();buttons[index]?.focus();
  }}>
    <div className={`context-reactions ${expanded?'expanded':''}`} aria-label="Быстрые реакции">
      {(expanded?['❤️','😂','😁','👍','🔥','🎉','😢','👀','🙏']:['❤️','😂','😁','👍','🔥']).map(emoji=><button key={emoji} role="menuitem" aria-label={`Реакция ${emoji}`} onClick={()=>react(emoji)}>{emoji}</button>)}
      <button role="menuitem" aria-label={expanded?'Скрыть реакции':'Ещё реакции'} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><ChevronDown size={18}/></button>
    </div>
    {expanded&&<div className="context-catalogue"><EmojiChoices select={react}/></div>}
    <div className="context-actions">{children}</div>
  </div>, document.body);
}
