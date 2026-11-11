import { expect, it } from 'vitest';
import { filterRooms } from './roomFilter';
import type { RoomSummary } from './models';
const rooms:RoomSummary[]=Array.from({length:5000},(_,i)=>({id:'!'+i+':test',name:'Имя '+i,topic:null,membership:'joined',encryption:'unencrypted',unread:i%2,members:2,lastTs:i,lastBody:null}));
const originals=new Map(rooms.map(room=>[room.id,room]));
it('combines a large folder, unread filter and pin ordering without changing source rooms',()=>{
  const result=filterRooms(rooms,originals,'','all',['!1:test'],{id:'f',name:'F',roomIds:rooms.map(room=>room.id),unreadOnly:true});
  expect(result).toHaveLength(2500); expect(result[0].id).toBe('!1:test');expect(result[1].id).toBe('!4999:test');expect(rooms[0].id).toBe('!0:test');
});
it('finds private names, original server names and Matrix IDs',()=>{
  const dm={...rooms[4000],name:'Бухгалтер',directUserId:'@bob:test'};
  for(const query of ['бухгалтер','Имя 4000','@bob:test'])expect(filterRooms([dm],originals,query,'all',[])).toEqual([dm]);
});
it('keeps zero-unread invitations at the top and includes them in New and Invitations',()=>{
  const invite:RoomSummary={...rooms[0],id:'!invite:test',membership:'invited',unread:0,lastTs:0};
  const all=[rooms[4999],invite];
  expect(filterRooms(all,originals,'','all',['!4999:test'])[0]).toBe(invite);
  expect(filterRooms(all,originals,'','unread',[])).toContain(invite);
  expect(filterRooms(all,originals,'','invites',[])).toEqual([invite]);
});
