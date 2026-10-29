import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SessionInfo, RoomSummary, MatrixEvent, TimelinePage, Update, EncryptionStatus, ChatFolder, UserSearchResult } from './models';

export const nativeAvailable = () => isTauri();
export const api = {
  bootstrap: () => invoke<SessionInfo | null>('bootstrap'),
  login: (homeserver: string, username: string, password: string) => invoke<SessionInfo>('login', { homeserver, username, password }),
  logout: () => invoke<void>('logout'),
  forget: () => invoke<void>('forget_session'),
  rooms: () => invoke<RoomSummary[]>('rooms'),
  cached: (roomId: string) => invoke<MatrixEvent[]>('cached_timeline', { roomId }),
  history: (roomId: string, from: string | null) => invoke<TimelinePage>('history', { roomId, from }),
  send: (roomId: string, body: string, txn: string, replyTo?: string) => invoke<string>('send_text', { roomId, body, txn, replyTo: replyTo ?? null }),
  edit: (roomId: string, eventId: string, body: string) => invoke<void>('edit_message', { roomId, eventId, body }),
  react: (roomId: string, eventId: string, key: string) => invoke<void>('react', { roomId, eventId, key }),
  redact: (roomId: string, eventId: string) => invoke<void>('redact', { roomId, eventId }),
  create: (name: string, invite: string[], isPublic: boolean) => invoke<string>('create_room', { name, invite, public: isPublic }),
  join: (roomId: string) => invoke<void>('join_room', { roomId }),
  read: (roomId: string, eventId: string) => invoke<void>('mark_read', { roomId, eventId }),
  draft: (roomId: string) => invoke<string>('draft', { roomId }),
  saveDraft: (roomId: string, body: string) => invoke<void>('save_draft', { roomId, body }),
  typing: (roomId: string, active: boolean) => invoke<void>('typing', { roomId, active }),
  encryptionStatus: () => invoke<EncryptionStatus>('encryption_status'),
  enableEncryption: () => invoke<EncryptionStatus>('enable_encryption'),
  recoverEncryption: (key: string) => invoke<EncryptionStatus>('recover_encryption', { key }),
  importEncryptionKeys: (exportText: string, passphrase: string) => invoke<number>('import_encryption_keys', { export: exportText, passphrase }),
  folders: () => invoke<ChatFolder[]>('get_folders'),
  saveFolders: (folders: ChatFolder[]) => invoke<ChatFolder[]>('save_folders', { folders }),
  searchUsers: (term: string) => invoke<UserSearchResult>('search_users', { term }),
  openDirect: (userId: string) => invoke<string>('open_direct', { userId }),
};

export function onUpdate(callback: (sessionKey: string, update: Update) => void) {
  return listen<{ sessionKey: string; update: Update }>('matrix-update', ({ payload }) => callback(payload.sessionKey, payload.update));
}
export function onConnection(callback: (sessionKey: string, error: string) => void) {
  return listen<{ sessionKey: string; error: string }>('matrix-connection', ({ payload }) => callback(payload.sessionKey, payload.error));
}
