import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({api:{cached:vi.fn(),history:vi.fn()}}));
import { api } from './api';
import { useStore } from './store';
import type { MatrixEvent, SessionInfo } from './models';
const session:SessionInfo={userId:'@alice:test',deviceId:'TEST',homeserver:'https://matrix.test',persisted:false};
const event:MatrixEvent={event_id:'$a',sender:'@alice:test',type:'m.room.message',origin_server_ts:1,content:{body:'message'}};
beforeEach(()=>{useStore.getState().clear();vi.resetAllMocks();useStore.setState({session:{...session}});vi.mocked(api.cached).mockResolvedValue({roomId:'!r:test',events:[],next:null});});
afterEach(()=>vi.restoreAllMocks());
it('coalesces foreground and background loads of the same history page',async()=>{
  let finish!:(value: {roomId:string;events:MatrixEvent[];next:null})=>void;
  vi.mocked(api.history).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const tasks=Array.from({length:30},()=>useStore.getState().load('!r:test'));
  await vi.waitFor(()=>expect(api.history).toHaveBeenCalledTimes(1));
  finish({roomId:'!r:test',events:[event],next:null});await Promise.all(tasks);
  expect(api.cached).toHaveBeenCalledTimes(1);expect(useStore.getState().events['!r:test']).toEqual([event]);
});
it('publishes cached messages and known sender names atomically, before a slow network request',async()=>{
  const profile={userId:session.userId,name:'Алиса'};
  vi.mocked(api.cached).mockResolvedValue({roomId:'!r:test',events:[event],next:null,profiles:[profile],canSend:false});
  let finish!:(value:{roomId:string;events:MatrixEvent[];next:null})=>void;
  vi.mocked(api.history).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const snapshots:boolean[]=[];
  const unsubscribe=useStore.subscribe(state=>{if(state.events['!r:test']?.length)snapshots.push(state.profiles['!r:test']?.[session.userId]?.name==='Алиса')});
  const request=useStore.getState().load('!r:test');
  await vi.waitFor(()=>expect(api.history).toHaveBeenCalledTimes(1));
  expect(snapshots).toEqual([true]);expect(useStore.getState().canSend['!r:test']).toBe(false);
  finish({roomId:'!r:test',events:[],next:null});await request;unsubscribe();
});
it('reuses a fresh page across room switches and refreshes after the time limit without rereading disk',async()=>{
  let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
  vi.mocked(api.history).mockResolvedValue({roomId:'!r:test',events:[event],next:'older'});
  await useStore.getState().load('!r:test');
  for(let i=0;i<30;i++)await useStore.getState().load('!r:test');
  expect(api.history).toHaveBeenCalledTimes(1);expect(api.cached).toHaveBeenCalledTimes(1);
  now+=60_001;await useStore.getState().load('!r:test');
  expect(api.history).toHaveBeenCalledTimes(2);expect(api.cached).toHaveBeenCalledTimes(1);
  await useStore.getState().load('!r:test',true);
  expect(api.history).toHaveBeenLastCalledWith('!r:test','older');
});
it('refreshes after key recovery and rejects a late response from the previous crypto state',async()=>{
  let finish!:(value:{roomId:string;events:MatrixEvent[];next:null})=>void;
  vi.mocked(api.history).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({roomId:'!r:test',events:[event],next:null});
  const old=useStore.getState().load('!r:test');await vi.waitFor(()=>expect(api.history).toHaveBeenCalledTimes(1));
  useStore.setState({encryption:{enabled:true,backupReady:true}});
  await useStore.getState().load('!r:test');
  finish({roomId:'!r:test',events:[{...event,event_id:'$locked',type:'m.room.encrypted'}],next:null});await old;
  expect(useStore.getState().events['!r:test']).toEqual([event]);expect(api.history).toHaveBeenCalledTimes(2);
});
it('can retry a page with missing E2EE keys without waiting for the freshness limit',async()=>{
  vi.mocked(api.history).mockResolvedValueOnce({roomId:'!r:test',events:[{...event,type:'m.room.encrypted'}],next:null}).mockResolvedValueOnce({roomId:'!r:test',events:[event],next:null});
  await useStore.getState().load('!r:test');await useStore.getState().load('!r:test');
  expect(api.history).toHaveBeenCalledTimes(2);expect(useStore.getState().events['!r:test']).toEqual([event]);
});
it('applies name and permissions changes from a state-only sync without losing history',()=>{
  const key=session.userId+'|'+session.deviceId;
  useStore.getState().apply(key,{rooms:[],timelines:[{roomId:'!r:test',events:[event],next:null,profiles:[{userId:session.userId,name:'Алиса'}],canSend:true}],connection:'online',error:null});
  const history=useStore.getState().events['!r:test'];
  useStore.getState().apply(key,{rooms:[],timelines:[{roomId:'!r:test',events:[],next:null,profiles:[{userId:session.userId,name:'Алиса Новая'}],canSend:false}],connection:'online',error:null});
  expect(useStore.getState().events['!r:test']).toBe(history);expect(useStore.getState().profiles['!r:test'][session.userId].name).toBe('Алиса Новая');expect(useStore.getState().canSend['!r:test']).toBe(false);
  useStore.getState().clear();expect(useStore.getState().profiles).toEqual({});expect(useStore.getState().canSend).toEqual({});
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
