export interface SessionInfo {
  userId: string; deviceId: string; homeserver: string; persisted: boolean;
}
export interface RoomSummary {
  id: string; name: string; topic: string | null; membership: 'joined' | 'invited';
  encryption: 'encrypted' | 'unencrypted' | 'unknown'; unread: number; members: number;
  lastBody: string | null; lastTs: number;
}
export interface MatrixEvent {
  event_id: string; sender: string; type: string; origin_server_ts: number;
  content: Record<string, unknown>;
  redacts?: string;
  unsigned?: { redacted_because?: unknown; transaction_id?: string };
}
export interface TimelinePage { roomId: string; events: MatrixEvent[]; next: string | null }
export interface Update { rooms: RoomSummary[]; timelines: TimelinePage[]; connection: string; error: string | null }
export interface Message {
  id: string; sender: string; ts: number; body: string; edited: boolean; deleted: boolean;
  encrypted: boolean; replyTo?: string; reactions: { key: string; count: number }[];
}
export interface PendingMessage {
  txn: string; roomId: string; body: string; replyTo?: string; ts: number;
  status: 'sending' | 'failed' | 'sent'; eventId?: string;
}
