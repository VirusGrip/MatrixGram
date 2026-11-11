import { useEffect, useRef } from 'react';
import { useStore } from './store';
// Fetch available history after an explicit unlock. No read receipts or plaintext disk cache.
export function RoomPreviews() {
  const session = useStore(s => s.session), encryption = useStore(s => s.encryption), rooms = useStore(s => s.rooms);
  const signature = rooms.filter(room => room.membership === 'joined' && room.encryption === 'encrypted').map(room => room.id).sort().join('|');
  const attempted = useRef(new Set<string>());
  useEffect(() => { attempted.current = new Set(); }, [session, encryption]);
  useEffect(() => {
    if (!session || !encryption.enabled) return;
    let alive = true;
    const queue = rooms.filter(room => room.membership === 'joined' && room.encryption === 'encrypted' && room.id !== useStore.getState().activeRoom && !attempted.current.has(room.id));
    let index = 0;
    async function worker() {
      while (alive && useStore.getState().session === session && index < queue.length) {
        const room = queue[index++]; attempted.current.add(room.id);
        try { await useStore.getState().load(room.id); } catch { /* Opening the chat offers the normal error/retry path. */ }
      }
    }
    void Promise.all([worker(), worker()]);
    return () => { alive = false; };
  // Signature changes only when the relevant set of rooms changes, not on every sync.
  }, [session, encryption, signature]);
  return null;
}
