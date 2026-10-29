import { describe, expect, it } from 'vitest';
import { mergeEvents, projectTimeline } from './timeline';
import type { MatrixEvent } from './models';

const event = (id: string, type: string, content: Record<string, unknown>, sender = '@alice:host', ts = 1): MatrixEvent => ({ event_id: id, type, content, sender, origin_server_ts: ts });
const message = event('$one', 'm.room.message', { msgtype: 'm.text', body: '<script>alert(1)</script> Привет' });

describe('Matrix event projection', () => {
  it('deduplicates sync and history and sorts deterministically', () => {
    const result = mergeEvents([message], [message, event('$two', 'm.room.message', { body: 'two' }, '@alice:host', 2)]);
    expect(result.map(e => e.event_id)).toEqual(['$one', '$two']);
  });
  it('keeps HTML as plain text', () => {
    expect(projectTimeline([message])[0].body).toBe('<script>alert(1)</script> Привет');
  });
  it('ignores malformed incoming records before rendering', () => {
    const malformed = [null, { ...message, sender: null }, { ...message, origin_server_ts: NaN }, { ...message, content: null }];
    expect(mergeEvents([], [...malformed, message] as MatrixEvent[])).toEqual([message]);
  });
  it('only accepts edits from the original author', () => {
    const forged = event('$edit', 'm.room.message', { 'm.new_content': { body: 'forged' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$one' } }, '@mallory:host', 2);
    expect(projectTimeline([message, forged])[0].body).toContain('Привет');
    const valid = { ...forged, sender: message.sender };
    expect(projectTimeline([message, valid])[0].body).toBe('forged');
  });
  it('supports reactions before their target and counts users once', () => {
    const reaction = event('$r', 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$one', key: '👍' } });
    const result = projectTimeline([reaction, { ...reaction, event_id: '$r2' }, message]);
    expect(result[0].reactions).toEqual([{ key: '👍', count: 1 }]);
  });
  it('redacts messages and reaction events including room v11 content.redacts', () => {
    const reaction = event('$r', 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$one', key: '👍' } });
    const redaction = event('$delete', 'm.room.redaction', { redacts: '$r' }, '@alice:host', 3);
    expect(projectTimeline([reaction, message, redaction])[0].reactions).toEqual([]);
    const deleted = projectTimeline([message, { ...redaction, content: { redacts: '$one' } }])[0];
    expect(deleted.body).toBe('Сообщение удалено');
    expect(deleted.deleted).toBe(true);
  });
  it('does not restore redacted content from a stale page', () => {
    const redacted = { ...message, content: {}, unsigned: { redacted_because: {} } };
    expect(mergeEvents([redacted], [message])[0]).toEqual(redacted);
  });
  it('keeps an already decrypted message if a stale encrypted page arrives', () => {
    const ciphertext = { ...message, type: 'm.room.encrypted', content: { ciphertext: 'opaque' } };
    expect(mergeEvents([message], [ciphertext])[0]).toEqual(message);
  });
  it('never displays ciphertext as a normal message', () => {
    const result = projectTimeline([event('$secret', 'm.room.encrypted', { body: 'ciphertext', ciphertext: 'secret' })]);
    expect(result[0].encrypted).toBe(true);
    expect(result[0].body).not.toContain('ciphertext');
  });
  it('restores the original body if an edit is redacted', () => {
    const edit = event('$e', 'm.room.message', { 'm.new_content': { body: 'edited' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$one' } }, '@alice:host', 2);
    const redaction = event('$d', 'm.room.redaction', { redacts: '$e' }, '@alice:host', 3);
    expect(projectTimeline([message, edit, redaction])[0].body).toBe(message.content.body);
  });
});
