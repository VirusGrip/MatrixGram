import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({api:{notify:vi.fn().mockResolvedValue(undefined)}}));
vi.mock('./store',()=>({useStore:{getState:()=>({contactNames:{'@bob:test':'Мой контакт'}})}}));
import { api } from './api';
import { notifyInvitations } from './Invitations';
import type { RoomSummary } from './models';
const room:RoomSummary={id:'!invite:test',name:'Рабочая группа',membership:'invited',encryption:'unencrypted',unread:0,members:2,topic:null,lastBody:null,lastTs:0,inviter:{userId:'@bob:test',name:'Борис'}};
const storage=new Map<string,string>();
beforeEach(()=>{storage.clear();vi.clearAllMocks();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});});
it('notifies an invitation without timeline messages, once across repeated syncs and reconnect',()=>{
  for(let i=0;i<20;i++)notifyInvitations('@alice:test|ONE',[room]);
  expect(api.notify).toHaveBeenCalledTimes(1);
  expect(api.notify).toHaveBeenCalledWith('Приглашение в комнату','Мой контакт приглашает в «Рабочая группа»');
});
it('notifies a later re-invitation and isolates account metadata',()=>{
  notifyInvitations('alice|ONE',[room]);notifyInvitations('alice|ONE',[]);notifyInvitations('alice|ONE',[room]);notifyInvitations('carol|TWO',[room]);
  expect(api.notify).toHaveBeenCalledTimes(3);
});
it('respects disabled notifications while retaining the in-app invitation',()=>{
  storage.set('matrixgram.notifications','off');notifyInvitations('alice|ONE',[room]);
  expect(api.notify).not.toHaveBeenCalled();expect(room.membership).toBe('invited');
});
it('recovers from corrupt notification metadata and does not expose message bodies',()=>{
  storage.set('matrixgram.invitationNotifications.alice|ONE','invalid');notifyInvitations('alice|ONE',[room]);
  expect(api.notify).toHaveBeenCalledTimes(1);expect(storage.get('matrixgram.invitationNotifications.alice|ONE')).toBe('["!invite:test"]');
});
