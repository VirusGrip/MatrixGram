import { create } from 'zustand';
import { api } from './api';
import { mergeEvents } from './timeline';
import type { MatrixEvent, RoomSummary, SessionInfo, Update, PendingMessage, EncryptionStatus, ChatFolder } from './models';

interface Store {
  session: SessionInfo | null; rooms: RoomSummary[]; activeRoom: string | null;
  events: Record<string, MatrixEvent[]>; cursors: Record<string, string | null>;
  pending: PendingMessage[]; connection: string; error: string | null;
  encryption: EncryptionStatus; folders: ChatFolder[];
  loadFeatures: () => Promise<void>;
  setSession: (session: SessionInfo | null) => void;
  setError: (error: unknown) => void;
  apply: (key: string, update: Update) => void;
  select: (id: string | null) => void;
  load: (id: string, older?: boolean) => Promise<void>;
  send: (roomId: string, body: string, replyTo?: string, txn?: string) => Promise<boolean>;
  clear: () => void;
}
const empty = { session: null, rooms: [], activeRoom: null, events: {}, cursors: {}, pending: [], connection: 'connecting', error: null, encryption: { enabled: false, backupReady: false }, folders: [] };
export const useStore = create<Store>((set, get) => ({
  ...empty,
  setSession: session => set({ session }),
  loadFeatures: async () => {
    const session = get().session;
    const [encryption, folders] = await Promise.all([api.encryptionStatus(), api.folders()]);
    if (session && get().session === session) set({ encryption, folders });
  },
  setError: error => set({ error: error == null ? null : String(error) }),
  apply: (key, update) => {
    const state = get();
    if (!state.session || `${state.session.userId}|${state.session.deviceId}` !== key) return;
    const events = { ...state.events };
    for (const page of update.timelines) events[page.roomId] = mergeEvents(events[page.roomId] ?? [], page.events);
    const receivedIds = new Set(update.timelines.flatMap(p => p.events.map(e => e.event_id)));
    const receivedTxn = new Set(update.timelines.flatMap(p => p.events.map(e => e.unsigned?.transaction_id)));
    set({ rooms: update.rooms, events, connection: update.connection, error: update.error,
      pending: state.pending.filter(p => !receivedTxn.has(p.txn) && !(p.eventId && receivedIds.has(p.eventId))) });
  },
  select: activeRoom => set({ activeRoom }),
  load: async (id, older = false) => {
    const session = get().session;
    if (!session) return;
    if (!older) {
      const cached = await api.cached(id);
      if (get().session !== session) return;
      set(s => ({ events: { ...s.events, [id]: mergeEvents(s.events[id] ?? [], cached) } }));
    }
    const page = await api.history(id, older ? get().cursors[id] ?? null : null);
    if (get().session !== session) return;
    set(s => ({ events: { ...s.events, [id]: mergeEvents(s.events[id] ?? [], page.events) }, cursors: { ...s.cursors, [id]: page.next } }));
  },
  send: async (roomId, body, replyTo, existingTxn) => {
    const session = get().session;
    const txn = existingTxn ?? crypto.randomUUID();
    const pending: PendingMessage = { txn, roomId, body, replyTo, ts: Date.now(), status: 'sending' };
    set(s => ({ pending: [...s.pending.filter(p => p.txn !== txn), pending] }));
    try {
      const eventId = await api.send(roomId, body, txn, replyTo);
      if (get().session !== session) return false;
      set(s => ({ pending: s.pending.flatMap(p => p.txn !== txn ? [p] :
        (s.events[roomId] ?? []).some(e => e.event_id === eventId) ? [] : [{ ...p, eventId, status: 'sent' as const }]) }));
      return true;
    } catch (error) {
      if (get().session !== session) return false;
      set(s => ({ error: String(error), pending: s.pending.map(p => p.txn === txn ? { ...p, status: 'failed' } : p) }));
      return false;
    }
  },
  clear: () => set({ ...empty, events: {}, cursors: {}, pending: [] }),
}));
