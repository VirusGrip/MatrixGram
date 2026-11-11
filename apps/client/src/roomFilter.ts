import type { ChatFolder, RoomSummary } from './models';
export function filterRooms(rooms: RoomSummary[], originals: Map<string, RoomSummary>, query: string, tab: string, pins: string[], folder?: ChatFolder) {
  const term = query.toLocaleLowerCase(), pinned = new Set(pins), included = folder ? new Set(folder.roomIds) : undefined;
  return rooms.filter(room => (!term || [room.name, room.directUserId || '', originals.get(room.id)?.name || ''].some(name => name.toLocaleLowerCase().includes(term)))
    && (tab !== 'unread' || room.unread > 0 || room.membership === 'invited') && (tab !== 'pinned' || pinned.has(room.id))
    && (tab !== 'invites' || room.membership === 'invited')
    && (!included || included.has(room.id) && (!folder?.unreadOnly || room.unread > 0)))
    .sort((a,b) => Number(b.membership === 'invited') - Number(a.membership === 'invited') || Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || b.lastTs-a.lastTs || a.name.localeCompare(b.name));
}
