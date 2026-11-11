import type { SessionInfo, RoomSummary } from './models';
export type ContactNames = Record<string, string>;
export function contactKey(session: SessionInfo) {
  return `matrixgram.contactNames.${encodeURIComponent(`${new URL(session.homeserver).origin}|${session.userId}`)}`;
}
export function readContactNames(session: SessionInfo): ContactNames {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(contactKey(session)) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, name]) => /^@[^:]+:.+$/.test(id) && typeof name === 'string' && name.trim().length > 0 && [...name].length <= 100));
  } catch { return {}; }
}
export const userTitle = (id: string, fallback: string, names: ContactNames) => names[id] || fallback;
export const roomTitle = (room: RoomSummary, names: ContactNames) => room.directUserId ? userTitle(room.directUserId, room.name, names) : room.name;
