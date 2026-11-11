import { describe, it, expect } from 'vitest';
import { presentRoom } from './roomPresentation';
import type { MatrixEvent, RoomSummary } from './models';
const room: RoomSummary = {id:'!dm:host',name:'Имя Matrix',topic:null,membership:'joined',encryption:'encrypted',unread:0,members:2,lastBody:null,lastTs:0,directUserId:'@bob:host'};
const message: MatrixEvent = {event_id:'$last',sender:'@bob:host',type:'m.room.message',origin_server_ts:10,content:{msgtype:'m.text',body:'Последнее сообщение'}};
describe('room list presentation', () => {
  it('shows available encrypted text only after explicit unlock', () => {
    expect(presentRoom(room,[message],false,{}).lastBody).toBeNull();
    expect(presentRoom(room,[message],true,{}).lastBody).toBe('Последнее сообщение');
    expect(room.lastBody).toBeNull();
  });
  it('uses edits and redactions and does not substitute an older message for missing keys', () => {
    const edit: MatrixEvent={...message,event_id:'$edit',origin_server_ts:11,content:{'m.relates_to':{rel_type:'m.replace',event_id:'$last'},'m.new_content':{body:'Изменённое сообщение'}}};
    expect(presentRoom(room,[message,edit],true,{}).lastBody).toBe('Изменённое сообщение');
    const redacted={...message,unsigned:{redacted_because:{}},content:{}};
    expect(presentRoom(room,[redacted],true,{}).lastBody).toBe('Сообщение удалено');
    const locked={...message,event_id:'$new',origin_server_ts:12,type:'m.room.encrypted',content:{ciphertext:'private'}};
    expect(presentRoom(room,[message,locked],true,{}).lastBody).toBe('Нет ключа для последнего сообщения');
  });
  it('applies personal names to explicit DMs and leaves two-person groups named as rooms', () => {
    const names={'@bob:host':'Мой бухгалтер'};
    expect(presentRoom(room,[],true,names).name).toBe('Мой бухгалтер');
    expect(presentRoom({...room,directUserId:null},[],true,names).name).toBe('Имя Matrix');
  });
});
