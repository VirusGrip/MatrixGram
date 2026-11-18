import {useEffect, useRef, useState} from 'react';
import {Info, KeyRound, MoreVertical, Search} from 'lucide-react';
import {CallMenuItems} from './Calls';
import type {RoomSummary} from './models';

export function ChatMenu({room, blocked, openEncryption, openSearch, openInfo, format}: {
  room: RoomSummary; blocked: boolean; openEncryption: () => void; openSearch: () => void; openInfo: () => void;
  format: {enabled: boolean; disabled: boolean; toggle: () => void};
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menu] button:not(:disabled)')?.focus({preventScroll:true});
    const outside = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) setOpen(false);};
    const escape = (event: KeyboardEvent) => {if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus({preventScroll:true});}};
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {window.removeEventListener('pointerdown', outside, true);window.removeEventListener('keydown', escape, true);};
  }, [open]);
  const action = (run: () => void) => {setOpen(false);run();};
  return <div className="chat-actions" ref={root}>
    <button ref={trigger} type="button" className="icon-button" aria-label="Меню чата" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><MoreVertical size={23}/></button>
    <div className="chat-actions-menu" hidden={!open} role="menu" aria-label="Действия с чатом" onKeyDown={event=>{
      if(event.key==='Tab'){setOpen(false);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('[role=menu] button:not(:disabled)')].filter(button=>button.getClientRects().length);
      const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;
      event.preventDefault();buttons[index]?.focus();
    }}>
      {!blocked && <CallMenuItems room={room} close={()=>setOpen(false)}/>}
      <button type="button" role="menuitem" aria-label="Поиск в загруженных сообщениях" onClick={()=>action(openSearch)}><Search size={20}/>Поиск</button>
      <button type="button" role="menuitem" onClick={()=>action(openInfo)}><Info size={20}/>Информация о комнате</button>
      {room.encryption==='encrypted' && <button type="button" role="menuitem" onClick={()=>action(openEncryption)}><KeyRound size={20}/>Ключи комнаты</button>}
      {!blocked && room.membership==='joined' && <button type="button" className="mobile-format-action" role="menuitemcheckbox" aria-label="Форматирование Markdown" aria-checked={format.enabled} disabled={format.disabled} onClick={()=>action(format.toggle)}><span className="format-label">Aa</span>Markdown {format.enabled?'✓':''}</button>}
    </div>
  </div>;
}
