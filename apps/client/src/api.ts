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
  op: <T = unknown>(kind: string, args: Record<string, unknown> = {}) => invoke<T>('client_operation', { operation: { kind, ...args } }),
  media: (source: Record<string, unknown>) => invoke<{ data: string }>('fetch_media', { source }),
  upload: (upload: Record<string, unknown>) => { const { sessionKey, ...payload } = upload; return invoke<string>('upload_file', { upload: payload, sessionKey: sessionKey ?? null }); },
  cancelUpload: (txn: string) => invoke<void>('cancel_upload', { txn }),
  saveFile: (name: string, data: string) => invoke<boolean>('save_download', { name, data }),
  desktop: (autostart?: boolean) => invoke<{ desktop: boolean; autostart: boolean }>('desktop_settings', { autostart: autostart ?? null }),
  minimize: () => invoke<void>('minimize_to_tray'),
  notify: (title: string, body: string) => invoke<void>('native_notify', { title, body }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  accounts: () => invoke<{ entries: { id: string; userId: string; homeserver: string }[]; active: string | null }>('list_accounts'),
  addAccount: (homeserver: string, username: string, password: string) => invoke<SessionInfo>('add_account', { homeserver, username, password }),
  switchAccount: (id: string) => invoke<SessionInfo>('switch_account', { id }),
  mediaPermissions: (video: boolean) => invoke<boolean>('media_permissions', { video }),
  requestNotifications: () => invoke<boolean>('request_notifications'),
};
export const onTransfer = (callback: (transfer: { txn: string; current: number; total: number; sessionKey: string }) => void) => listen('matrix-transfer', event => callback(event.payload as Parameters<typeof callback>[0]));

export function onUpdate(callback: (sessionKey: string, update: Update) => void) {
  return listen<{ sessionKey: string; update: Update }>('matrix-update', ({ payload }) => callback(payload.sessionKey, payload.update));
}
export function onConnection(callback: (sessionKey: string, error: string) => void) {
  return listen<{ sessionKey: string; error: string }>('matrix-connection', ({ payload }) => callback(payload.sessionKey, payload.error));
}
