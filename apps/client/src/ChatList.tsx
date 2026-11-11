import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LockKeyhole, MessageCircle, Pin, Pencil } from 'lucide-react';
import type { RoomSummary } from './models';
import { Avatar, Modal } from './ui';
import { PersonProfile } from './RoomFeatures';
import { useStore } from './store';
const time = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export function RoomList({ rooms, selected, pins, select, togglePin }: { rooms: RoomSummary[]; selected: string | null; pins: string[]; select: (id: string) => void; togglePin: (id: string) => void }) {
  const parent = useRef<HTMLDivElement>(null), [context, setContext] = useState<RoomSummary | null>(null), [person, setPerson] = useState('');
  const enabled = useStore(s => s.encryption.enabled);
  const rows = useVirtualizer({ count: rooms.length, getScrollElement: () => parent.current, estimateSize: () => 68, overscan: 6, getItemKey: i => rooms[i].id });
  return <><div className="room-list" ref={parent} aria-label="Список чатов">
    {!rooms.length && <div className="list-empty"><MessageCircle size={30}/><p>Здесь появятся ваши чаты</p><small>Дождитесь синхронизации или создайте комнату</small></div>}
    <div style={{ height: rows.getTotalSize(), position: 'relative' }}>{rows.getVirtualItems().map(row => {
      const room = rooms[row.index], locked = room.encryption === 'encrypted' && !enabled;
      return <div className={`room-row ${selected === room.id ? 'selected' : ''}`} key={room.id} style={{ transform: `translateY(${row.start}px)` }} onContextMenu={event => { event.preventDefault(); setContext(room); }}>
        <button className="room-select" onClick={() => select(room.id)} aria-label={`Открыть ${room.name}`}>
          <Avatar name={room.name} url={room.avatarUrl}/><span className="room-copy"><span className="room-top"><strong>{room.encryption === 'encrypted' && <LockKeyhole size={12}/>} {room.name}</strong><time>{room.lastTs ? time(room.lastTs) : ''}</time></span>
            <span className="room-bottom"><span>{room.membership === 'invited' ? 'Приглашение в комнату' : locked ? 'Зашифрованная переписка' : room.lastBody || (room.encryption === 'encrypted' ? 'Загружаем последнее сообщение…' : 'Пока нет сообщений')}</span>{room.unread > 0 && <b className="badge">{room.unread}</b>}</span>
          </span>
        </button>
        <button className={`pin-button ${pins.includes(room.id) ? 'pinned' : ''}`} title={pins.includes(room.id) ? 'Открепить чат' : 'Закрепить чат'} aria-label={`${pins.includes(room.id) ? 'Открепить' : 'Закрепить'} ${room.name}`} onClick={() => togglePin(room.id)}><Pin size={14}/></button>
      </div>;
    })}</div>
  </div>{context && <Modal title="Действия с чатом" close={() => setContext(null)}><div className="message-menu"><button onClick={() => { togglePin(context.id); setContext(null); }}><Pin size={18}/>{pins.includes(context.id) ? 'Открепить чат' : 'Закрепить чат'}</button>{context.directUserId && <button onClick={() => { setPerson(context.directUserId!); setContext(null); }}><Pencil size={18}/>Подписать контакт</button>}</div></Modal>}{person && <PersonProfile userId={person} close={() => setPerson('')}/>}</>;
}
