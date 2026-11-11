import type { MatrixEvent, Message } from './models';
import { projectTimeline } from './timeline';

// Store replaces event arrays on changes. Weak keys release old projections after GC.
const projections = new WeakMap<MatrixEvent[], Message[]>();
export function cachedTimeline(events: MatrixEvent[]): Message[] {
  let messages = projections.get(events);
  if (!messages) { messages = projectTimeline(events); projections.set(events, messages); }
  return messages;
}
export const emptyEvents: MatrixEvent[] = [];
