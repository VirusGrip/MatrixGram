import { useEffect } from 'react';
import { Users } from 'lucide-react';
import { api } from './api';
import { roomTitle, userTitle } from './contacts';
import { useStore } from './store';
import type { RoomSummary } from './models';

export function notifyInvitations(key: string, rooms: RoomSummary[]) {
  const storageKey = `matrixgram.invitationNotifications.${key}`;
  let previous: string[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(value)) previous = value.filter((id): id is string => typeof id === 'string');
  } catch { /* Recover from corrupt notification metadata. */ }
  const seen = new Set(previous), pending = rooms.filter(room => room.membership === 'invited');
  if (localStorage.getItem('matrixgram.notifications') !== 'off') {
    const names = useStore.getState().contactNames;
    for (const room of pending) {
      if (seen.has(room.id)) continue;
      const from = room.inviter ? userTitle(room.inviter.userId, room.inviter.name, names) : null;
      void api.notify('Приглашение в комнату', `${from ? `${from} приглашает в «` : 'Вас пригласили в «'}${roomTitle(room, names)}»`).catch(() => {});
    }
  }
  // Keep outstanding room IDs, not message text. Leaving this set allows a later
  // invitation into the same room to notify again, including after reconnect.
  try { localStorage.setItem(storageKey, JSON.stringify(pending.map(room => room.id))); } catch { /* Storage may be unavailable. */ }
}

export function Invitations({ open }: { open: () => void }) {
  const session = useStore(s => s.session), rooms = useStore(s => s.rooms), connection = useStore(s => s.connection);
  useEffect(() => {
    if (session && (rooms.length || connection === 'online')) notifyInvitations(`${session.userId}|${session.deviceId}`, rooms);
  }, [session, rooms, connection]);
  const count = rooms.filter(room => room.membership === 'invited').length;
  return count ? <button className="invitations-banner" onClick={open} aria-label={`Приглашения: ${count}`}><Users size={21}/><span>Приглашения в комнаты</span><b className="badge">{count}</b></button> : null;
}
