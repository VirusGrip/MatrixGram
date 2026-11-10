export interface SessionInfo {
  userId: string; deviceId: string; homeserver: string; persisted: boolean;
}
export interface RoomSummary {
  id: string; name: string; topic: string | null; membership: 'joined' | 'invited';
  encryption: 'encrypted' | 'unencrypted' | 'unknown'; unread: number; members: number;
  lastBody: string | null; lastTs: number;
  avatarUrl?: string | null;
}
export interface MatrixEvent {
  event_id: string; sender: string; type: string; origin_server_ts: number;
  content: Record<string, unknown>;
  redacts?: string;
  unsigned?: { redacted_because?: unknown; transaction_id?: string };
}
export interface TimelinePage { roomId: string; events: MatrixEvent[]; next: string | null }
export interface Update { rooms: RoomSummary[]; timelines: TimelinePage[]; connection: string; error: string | null; ephemeral?: { roomId: string; type: string; content: Record<string, unknown> }[] }
export interface EncryptionStatus { enabled: boolean; backupReady: boolean }
export interface ChatFolder { id: string; name: string; roomIds: string[]; unreadOnly: boolean }
export interface DirectoryUser { userId: string; displayName: string }
export interface UserSearchResult { users: DirectoryUser[]; limited: boolean }
export interface Message {
  id: string; sender: string; ts: number; body: string; edited: boolean; deleted: boolean;
  encrypted: boolean; replyTo?: string; reactions: { key: string; count: number }[];
  formattedBody?: string;
  attachment?: Attachment;
}
export interface Attachment { kind: string; name: string; mime: string; size?: number; source: Record<string, unknown>; duration?: number; voice?: boolean }
export interface Member { userId: string; name: string; avatarUrl?: string; power: number; membership: string }
export interface RoomDetails { members: Member[]; pinned: string[]; myPower: number; canSend: boolean; name?: string; topic?: string; encrypted: boolean; notificationMode?: string }
export interface Profile { ignored?: boolean; userId: string; displayName?: string; avatarUrl?: string }
export interface Device { id: string; name?: string; lastIp?: string; lastSeen?: number; current: boolean }
export interface PendingMessage {
  txn: string; roomId: string; body: string; replyTo?: string; ts: number;
  status: 'sending' | 'failed' | 'sent'; eventId?: string;
}
