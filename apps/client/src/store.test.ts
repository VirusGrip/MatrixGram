import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({api:{cached:vi.fn(),history:vi.fn()}}));
import { api } from './api';
import { useStore } from './store';
import type { MatrixEvent, SessionInfo } from './models';
const session:SessionInfo={userId:'@alice:test',deviceId:'TEST',homeserver:'https://matrix.test',persisted:false};
const event:MatrixEvent={event_id:'$a',sender:'@alice:test',type:'m.room.message',origin_server_ts:1,content:{body:'message'}};
beforeEach(()=>{useStore.getState().clear();vi.resetAllMocks();useStore.setState({session:{...session}});vi.mocked(api.cached).mockResolvedValue([]);});
it('coalesces foreground and background loads of the same history page',async()=>{
  let finish!:(value: {roomId:string;events:MatrixEvent[];next:null})=>void;
  vi.mocked(api.history).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const tasks=Array.from({length:30},()=>useStore.getState().load('!r:test'));
  await vi.waitFor(()=>expect(api.history).toHaveBeenCalledTimes(1));
  finish({roomId:'!r:test',events:[event],next:null});await Promise.all(tasks);
  expect(api.cached).toHaveBeenCalledTimes(1);expect(useStore.getState().events['!r:test']).toEqual([event]);
});
it('releases a failed request so retry can fetch the page',async()=>{
  vi.mocked(api.history).mockRejectedValueOnce(new Error('network')).mockResolvedValue({roomId:'!r:test',events:[event],next:null});
  await expect(useStore.getState().load('!r:test')).rejects.toThrow('network');
  await useStore.getState().load('!r:test');expect(api.history).toHaveBeenCalledTimes(2);
});
it('does not share requests or late results between sessions',async()=>{
  let finish!:(value:{roomId:string;events:MatrixEvent[];next:null})=>void;
  vi.mocked(api.history).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({roomId:'!r:test',events:[],next:null});
  const old=useStore.getState().load('!r:test');await vi.waitFor(()=>expect(api.history).toHaveBeenCalledTimes(1));
  useStore.getState().clear();useStore.setState({session:{...session,deviceId:'OTHER'}});
  await useStore.getState().load('!r:test');finish({roomId:'!r:test',events:[event],next:null});await old;
  expect(api.history).toHaveBeenCalledTimes(2);expect(useStore.getState().events['!r:test']).toEqual([]);
});
