import type { MatrixEvent, RoomSummary } from './models';
import { cachedTimeline } from './timelineCache';
import { roomTitle, type ContactNames } from './contacts';
export function presentRoom(room: RoomSummary, events: MatrixEvent[], enabled: boolean, names: ContactNames): RoomSummary {
  const result = { ...room, name: roomTitle(room, names) };
  if (room.encryption === 'encrypted' && !enabled) return { ...result, lastBody: null };
  const latest = events.length ? cachedTimeline(events).at(-1) : undefined;
  if (!latest || latest.ts < room.lastTs && room.encryption !== 'encrypted') return result;
  let body = latest.body;
  if (latest.encrypted) body = 'Нет ключа для последнего сообщения';
  else if (latest.attachment) body = latest.attachment.voice ? 'Голосовое сообщение' : latest.attachment.kind === 'm.image' ? 'Фото' : latest.attachment.kind === 'm.video' ? 'Видео' : latest.attachment.name;
  return { ...result, lastBody: body.replace(/\s+/g, ' ').slice(0, 160), lastTs: latest.ts };
}
