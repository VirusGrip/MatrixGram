import { describe, expect, it } from 'vitest';
import type { Message } from './models';
import { memberLabel, sameMessageGroup } from './presentation';

const message = (sender: string, ts: number, extra: Partial<Message> = {}): Message => ({
  id: String(ts), sender, ts, body: 'Текст', edited: false, deleted: false, encrypted: false, reactions: [], ...extra,
});
describe('conversation presentation', () => {
  it('groups only consecutive messages from the same sender within five minutes', () => {
    const first = message('@alice:test', new Date(2026, 9, 30, 12).getTime());
    expect(sameMessageGroup(first, message(first.sender, first.ts + 60_000))).toBe(true);
    expect(sameMessageGroup(first, message('@bob:test', first.ts + 60_000))).toBe(false);
    expect(sameMessageGroup(first, message(first.sender, first.ts + 300_000))).toBe(false);
    expect(sameMessageGroup(first, message(first.sender, first.ts - 1))).toBe(false);
  });
  it('separates days and unavailable or deleted messages', () => {
    const midnight = new Date(2026, 9, 31).getTime();
    expect(sameMessageGroup(message('a', midnight - 1), message('a', midnight))).toBe(false);
    expect(sameMessageGroup(message('a', midnight), message('a', midnight + 1, { deleted: true }))).toBe(false);
    expect(sameMessageGroup(message('a', midnight, { encrypted: true }), message('a', midnight + 1))).toBe(false);
    expect(sameMessageGroup(undefined, message('a', midnight))).toBe(false);
  });
  it('does not display a zero when the server has not supplied the member count', () => {
    expect(memberLabel(0)).toBe('');
  });
  it('inflects known member counts', () => {
    expect([1, 2, 5, 11, 21, 24, 112].map(memberLabel)).toEqual([
      '1 участник', '2 участника', '5 участников', '11 участников', '21 участник', '24 участника', '112 участников',
    ]);
  });
});
