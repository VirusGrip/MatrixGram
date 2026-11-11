import { create } from 'zustand';
import { api } from './api';
import { mergeEvents } from './timeline';
import { contactKey, readContactNames, type ContactNames } from './contacts';
import type { MatrixEvent, RoomSummary, SessionInfo, Update, PendingMessage, EncryptionStatus, ChatFolder, SenderProfile, TimelinePage } from './models';

interface Store {
  session: SessionInfo | null; rooms: RoomSummary[]; activeRoom: string | null;
  events: Record<string, MatrixEvent[]>; cursors: Record<string, string | null>;
  profiles: Record<string, Record<string, SenderProfile>>; canSend: Record<string, boolean>;
  pending: PendingMessage[]; connection: string; error: string | null;
  encryption: EncryptionStatus; folders: ChatFolder[];
  typing: Record<string, { users: string[]; expires: number }>;
  receipts: Record<string, Record<string, string[]>>;
  contactNames: ContactNames;
  setContactName: (userId: string, name: string) => void;
  loadFeatures: () => Promise<void>;
  setSession: (session: SessionInfo | null) => void;
  setError: (error: unknown) => void;
  apply: (key: string, update: Update) => void;
  select: (id: string | null) => void;
  load: (id: string, older?: boolean) => Promise<void>;
  send: (roomId: string, body: string, replyTo?: string, txn?: string) => Promise<boolean>;
  clear: () => void;
}
const empty = { session: null, rooms: [], activeRoom: null, events: {}, cursors: {}, profiles: {}, canSend: {}, pending: [], connection: 'connecting', error: null, encryption: { enabled: false, backupReady: false }, folders: [], typing: {}, receipts: {} };
const historyRequests = new WeakMap<SessionInfo, Map<string, { promise: Promise<void>; encryption: EncryptionStatus }>>();
const loadedPages = new WeakMap<SessionInfo, Map<string, { at: number; encryption: EncryptionStatus }>>();
function pageState(state: Store, pages: TimelinePage[]) {
  const events = { ...state.events }, profiles = { ...state.profiles }, canSend = { ...state.canSend };
  for (const page of pages) {
    if (page.events.length) events[page.roomId] = mergeEvents(events[page.roomId] ?? [], page.events);
    else events[page.roomId] ??= [];
    if (page.profiles?.length) profiles[page.roomId] = { ...profiles[page.roomId], ...Object.fromEntries(page.profiles.map(profile => [profile.userId, profile])) };
    if (page.canSend !== undefined) canSend[page.roomId] = page.canSend;
  }
  return { events, profiles, canSend };
}
export const useStore = create<Store>((set, get) => ({
  ...empty, contactNames: {},
  setSession: session => set({ session, contactNames: session ? readContactNames(session) : {} }),
  setContactName: (userId, name) => {
    const session = get().session; if (!session) return;
    if (!/^@[^:]+:.+$/.test(userId)) throw new Error('Некорректный Matrix ID');
    name = name.trim(); if ([...name].length > 100) throw new Error('Подпись — до 100 символов');
    const contactNames = { ...get().contactNames }; if (name) contactNames[userId] = name; else delete contactNames[userId];
    localStorage.setItem(contactKey(session), JSON.stringify(contactNames)); set({ contactNames });
  },
  loadFeatures: async () => {
    const session = get().session;
    const [encryption, folders] = await Promise.all([api.encryptionStatus(), api.folders()]);
    if (session && get().session === session) set({ encryption, folders });
  },
  setError: error => set({ error: error == null ? null : String(error) }),
  apply: (key, update) => {
    const state = get();
    if (!state.session || `${state.session.userId}|${state.session.deviceId}` !== key) return;
    const pages = pageState(state, update.timelines);
    const receivedIds = new Set(update.timelines.flatMap(p => p.events.map(e => e.event_id)));
    const receivedTxn = new Set(update.timelines.flatMap(p => p.events.map(e => e.unsigned?.transaction_id)));
    const typing = { ...state.typing }, receipts = { ...state.receipts };
    for (const ephemeral of update.ephemeral ?? []) {
      if (ephemeral.type === 'm.typing' && Array.isArray(ephemeral.content.user_ids)) typing[ephemeral.roomId] = { users: ephemeral.content.user_ids.filter((id): id is string => typeof id === 'string' && id !== state.session!.userId), expires: Date.now() + 30_000 };
      if (ephemeral.type === 'm.receipt') {
        const current = { ...receipts[ephemeral.roomId] };
        for (const [id, value] of Object.entries(ephemeral.content)) {
          if (value && typeof value === 'object' && 'm.read' in value) {
            const users = Object.keys((value as Record<string, Record<string, unknown>>)['m.read'] ?? {});
            for (const old of Object.keys(current)) current[old] = current[old].filter(user => !users.includes(user));
            current[id] = users;
          }
        }
        receipts[ephemeral.roomId] = current;
      }
    }
    const pending = state.pending.filter(p => !receivedTxn.has(p.txn) && !(p.eventId && receivedIds.has(p.eventId)));
    set({ rooms: update.rooms, ...pages, connection: update.connection, error: update.error,
      typing, receipts,
      pending: pending.length === state.pending.length ? state.pending : pending });
  },
  select: activeRoom => set({ activeRoom }),
  load: (id, older = false) => {
    const session = get().session;
    if (!session) return Promise.resolve();
    const encryption = get().encryption;
    let loaded = loadedPages.get(session);
    if (!loaded) { loaded = new Map(); loadedPages.set(session, loaded); }
    const last = loaded.get(id);
    // Reopening an already hydrated room renders memory immediately. Sync keeps
    // it current; a later visit still refreshes the server page in the background.
    if (!older && last?.encryption === encryption && Date.now() - last.at < 60_000) return Promise.resolve();
    let requests = historyRequests.get(session);
    if (!requests) { requests = new Map(); historyRequests.set(session, requests); }
    const key = JSON.stringify([id, older, older ? get().cursors[id] ?? null : null]);
    const existing = requests.get(key); if (existing?.encryption === encryption) return existing.promise;
    const request = (async () => {
      if (!older && !get().events[id]) {
        const cached = await api.cached(id);
        if (get().session !== session || get().encryption !== encryption) return;
        set(s => pageState(s, [cached]));
      }
      const page = await api.history(id, older ? get().cursors[id] ?? null : null);
      if (get().session !== session || get().encryption !== encryption) return;
      set(s => ({ ...pageState(s, [page]), cursors: { ...s.cursors, [id]: page.next } }));
      if (!older) {
        if (page.events.some(event => event.type === 'm.room.encrypted')) loaded.delete(id);
        else loaded.set(id, { at: Date.now(), encryption });
      }
    })();
    requests.set(key, { promise: request, encryption });
    const complete = () => { if (requests.get(key)?.promise === request) requests.delete(key); };
    void request.then(complete, complete);
    return request;
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
  clear: () => set({ ...empty, events: {}, cursors: {}, pending: [], contactNames: {} }),
}));
