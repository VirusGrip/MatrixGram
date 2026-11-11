import { expect, it } from 'vitest';
import { cachedTimeline } from './timelineCache';
import { mergeEvents } from './timeline';
import type { MatrixEvent } from './models';

const event: MatrixEvent = {event_id:'$a',sender:'@alice:test',type:'m.room.message',origin_server_ts:1,content:{body:'Original'}};
it('reuses unchanged history without re-projecting it',()=>{
  const events=[event];
  expect(cachedTimeline(events)).toBe(cachedTimeline(events));
});
it('a new history snapshot invalidates projection and preserves deletion over stale data',()=>{
  const events=[event], previous=cachedTimeline(events);
  const next=mergeEvents(events,[{...event,content:{},unsigned:{redacted_because:{}}}]);
  expect(cachedTimeline(next)[0].body).toBe('Сообщение удалено');
  expect(cachedTimeline(mergeEvents(next,[event]))[0].deleted).toBe(true);
  expect(previous[0].body).toBe('Original');
});
