import type { MatrixEvent, Message } from './models';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
const text = (v: unknown) => typeof v === 'string' ? v : '';

export function mergeEvents(existing: MatrixEvent[], incoming: MatrixEvent[]): MatrixEvent[] {
  const map = new Map<string, MatrixEvent>();
  for (const event of [...existing, ...incoming]) {
    if (!event || typeof event.event_id !== 'string' || !event.event_id || typeof event.type !== 'string'
      || typeof event.sender !== 'string' || !event.sender || typeof event.origin_server_ts !== 'number'
      || !Number.isFinite(event.origin_server_ts) || event.origin_server_ts < 0
      || !event.content || typeof event.content !== 'object' || Array.isArray(event.content)) continue;
    const previous = map.get(event.event_id);
    // A later history page must never restore already redacted content.
    if (previous?.unsigned?.redacted_because && !event.unsigned?.redacted_because) continue;
    if (event.type === 'm.room.encrypted' && previous?.type === 'm.room.message') continue;
    map.set(event.event_id, event);
  }
  return [...map.values()].sort((a, b) => a.origin_server_ts - b.origin_server_ts || a.event_id.localeCompare(b.event_id));
}

export function projectTimeline(events: MatrixEvent[]): Message[] {
  const sorted = mergeEvents([], events);
  const redacted = new Set(sorted.filter(e => e.unsigned?.redacted_because).map(e => e.event_id));
  for (const e of sorted) {
    if (e.type === 'm.room.redaction') {
      const target = e.redacts ?? text(object(e.content).redacts);
      if (target) redacted.add(target);
    }
  }
  const messages = new Map<string, Message>();
  for (const event of sorted) {
    const c = object(event.content);
    const rel = object(c['m.relates_to']);
    if (event.type !== 'm.room.message' && event.type !== 'm.room.encrypted') continue;
    if (rel.rel_type === 'm.replace') continue;
    const encrypted = event.type === 'm.room.encrypted';
    messages.set(event.event_id, {
      id: event.event_id, sender: event.sender, ts: event.origin_server_ts,
      body: encrypted ? 'Ключ для этого сообщения пока не найден. Подключите ключи сбоку и обновите историю.' : text(c.body) || 'Неподдерживаемое сообщение',
      encrypted, deleted: redacted.has(event.event_id), edited: false,
      replyTo: text(object(rel['m.in_reply_to']).event_id) || undefined,
      reactions: [],
    });
  }
  const reactionUsers = new Map<string, Set<string>>();
  for (const event of sorted) {
    if (redacted.has(event.event_id)) continue;
    const c = object(event.content), rel = object(c['m.relates_to']);
    const target = messages.get(text(rel.event_id));
    if (!target || target.deleted || target.encrypted) continue;
    if (event.type === 'm.room.message' && rel.rel_type === 'm.replace' && event.sender === target.sender) {
      const body = object(c['m.new_content']).body;
      if (typeof body === 'string') { target.body = body; target.edited = true; }
    }
    if (event.type === 'm.reaction' && rel.rel_type === 'm.annotation' && typeof rel.key === 'string') {
      const key = `${target.id}\0${rel.key}`;
      const users = reactionUsers.get(key) ?? new Set();
      users.add(event.sender); reactionUsers.set(key, users);
      const existing = target.reactions.find(r => r.key === rel.key);
      if (existing) existing.count = users.size;
      else target.reactions.push({ key: rel.key, count: users.size });
    }
  }
  return [...messages.values()].map(message => message.deleted ? { ...message, body: 'Сообщение удалено', reactions: [], replyTo: undefined } : message);
}
