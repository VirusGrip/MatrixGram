import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from './models';
import { api } from './api';
import { useStore } from './store';
import { Avatar, Modal, errorText } from './ui';
import { roomTitle } from './contacts';
export function ForwardDialog({ messages, sourceRoom, close, completed }: { messages: Message[]; sourceRoom: string; close: () => void; completed?: () => void }) {
  const rooms = useStore(s => s.rooms), names = useStore(s => s.contactNames);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [target, setTarget] = useState(''), [sent, setSent] = useState(0);
  const stopped = useRef(false), transactions = useRef(new Map<string, string>()), delivered = useRef(new Set<string>());
  const ordered = useMemo(() => [...messages].sort((a,b) => a.ts-b.ts || a.id.localeCompare(b.id)), [messages]);
  useEffect(() => { stopped.current = false; return () => { stopped.current = true; }; }, []);
  async function send(roomId: string) {
    const room = rooms.find(room => room.id === roomId); if (!room || busy) return;
    if (!target && rooms.find(source => source.id === sourceRoom)?.encryption === 'encrypted' && room.encryption !== 'encrypted' && !window.confirm('Переслать сообщения в комнату без сквозного шифрования?')) return;
    setTarget(roomId); setBusy(true); setError('');
    try {
      for (const message of ordered) {
        if (stopped.current) return;
        if (delivered.current.has(message.id)) continue;
        let txn = transactions.current.get(message.id); if (!txn) { txn = crypto.randomUUID(); transactions.current.set(message.id, txn); }
        await api.op('forward', { roomId, sourceRoom, eventId: message.id, txn });
        delivered.current.add(message.id); if (!stopped.current) setSent(delivered.current.size);
      }
      if (!stopped.current) { completed?.(); close(); }
    } catch (e) { if (!stopped.current) setError(`${errorText(e)}. Повтор продолжит с неотправленных сообщений.`); }
    finally { if (!stopped.current) setBusy(false); }
  }
  return <Modal title={messages.length === 1 ? 'Переслать сообщение' : 'Переслать сообщения'} close={() => { stopped.current = true; close(); }}>
    <p className="muted">Выбрано: {messages.length}{(busy || sent > 0) && ` · Переслано: ${sent} из ${messages.length}`}</p>
    <label>Найти чат<input autoFocus value={query} onChange={e => setQuery(e.target.value)} disabled={busy || !!target}/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="forward-rooms">{rooms.filter(room => room.membership === 'joined' && (target ? room.id === target : roomTitle(room,names).toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(room => <button disabled={busy} key={room.id} onClick={() => { void send(room.id); }}><Avatar name={roomTitle(room,names)} url={room.avatarUrl} size="small"/>{target ? 'Продолжить пересылку в ' : ''}{roomTitle(room,names)}</button>)}</div>
  </Modal>;
}
