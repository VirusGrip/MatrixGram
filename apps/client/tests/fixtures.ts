import { expect, type Page } from '@playwright/test';

// Replaces the IPC adapter ONLY in this test server. Production has no demo data.
export const fixtureApi = `
export const nativeAvailable = () => true;
const session = { userId:'@alice:test', deviceId:'TEST', homeserver:'https://matrix.test', persisted:true };
const rooms = [
 {id:'!plain:test',name:'Команда Matrix',topic:'Тестовая комната',membership:'joined',encryption:'unencrypted',unread:2,members:3,lastBody:'Привет, команда!',lastTs:1000},
 {id:'!secret:test',name:'Закрытая комната',topic:null,membership:'joined',encryption:'encrypted',unread:0,members:2,lastBody:null,lastTs:0}
];
const updates = new Set();
let events = [{event_id:'$hello',sender:'@bob:test',type:'m.room.message',origin_server_ts:1000,content:{msgtype:'m.text',body:'Привет, команда!'}}];
let drafts = {};
let encryption = {enabled:false,backupReady:false};
let folders = JSON.parse(localStorage.getItem('test-folders') || '[]');
let pinned=[];let profileName='Alice';let notificationMode='Some(AllMessages)';
const mediaStore={};
const profiles=[{userId:'@alice:test',name:'Alice'},{userId:'@bob:test',name:'Bob'}];
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const publish=roomId=>updates.forEach(update=>update(session.userId+'|'+session.deviceId,{rooms,timelines:[{roomId,events,next:null}],connection:'online',error:null}));
export const api = {
 updateStatus:async()=>({currentVersion:'0.5.2',configured:false,platform:'windows',repository:'VirusGrip/MatrixGram',available:null}),
 checkUpdate:async()=>({currentVersion:'0.5.2',configured:true,platform:'windows',repository:'VirusGrip/MatrixGram',available:null}),downloadUpdate:async()=>{},installUpdate:async()=>{window.__updateInstalled=true;return 'started'},
 bootstrap:async()=>null, login:async()=>{setTimeout(()=>updates.forEach(update=>update(session.userId+'|'+session.deviceId,{rooms,timelines:[],connection:'online',error:null})),30);return session}, rooms:async()=>[...rooms], logout:async()=>{}, forget:async()=>{},
 cached:async id=>({roomId:id,events:id==='!plain:test'?events:[],next:null,profiles,canSend:true}), history:async id=>{if(id==='!secret:test')window.__secretHistoryCount=(window.__secretHistoryCount||0)+1;return {roomId:id,events:id==='!plain:test'?events:id==='!secret:test'&&encryption.enabled?[{event_id:'$secret',sender:'@bob:test',type:'m.room.message',origin_server_ts:2000,content:{body:'Открытое сообщение E2EE'}}]:[],next:null,profiles,canSend:true}},
 draft:async id=>drafts[id]||'',saveDraft:async(id,body)=>{drafts[id]=body},typing:async()=>{},read:async()=>{},
 send:async(roomId,body,txn,replyTo)=>{
   window.__sendCount=(window.__sendCount||0)+1;
   if(body==='Сбой' && window.__sendCount===1) throw new Error('Тест: сеть недоступна');
   const id='$'+txn;
   events=[...events,{event_id:id,sender:session.userId,type:'m.room.message',origin_server_ts:2000,content:{msgtype:'m.text',body},unsigned:{transaction_id:txn}}];
   setTimeout(()=>updates.forEach(update=>update('auth', {rooms,timelines:[{roomId,events,next:null}],connection:'online',error:null})),5);
   setTimeout(()=>updates.forEach(update=>update(session.userId+'|'+session.deviceId, {rooms,timelines:[{roomId,events,next:null}],connection:'online',error:null})),20);
   return id;
 },
 edit:async()=>{},react:async()=>{},redact:async()=>{},create:async()=>{throw new Error('Тест: нет прав')},join:async id=>{const room=rooms.find(room=>room.id===id);if(room)room.membership='joined'},
 encryptionStatus:async()=>encryption,enableEncryption:async()=>encryption={enabled:true,backupReady:false},
 recoverEncryption:async key=>{window.__recoveryCount=(window.__recoveryCount||0)+1;if(key==='bad')throw new Error('Ключ не подходит');return encryption={enabled:true,backupReady:true}},
 importEncryptionKeys:async()=>{encryption={enabled:true,backupReady:false};return 1},
 folders:async()=>folders,saveFolders:async value=>{folders=value;localStorage.setItem('test-folders',JSON.stringify(value));return value},
 searchUsers:async term=>({users:'Иван Иванов'.toLowerCase().includes(term.toLowerCase())?[{userId:'@ivan:test',displayName:'Иван Иванов'}]:[],limited:false}),
 openDirect:async userId=>{if(!rooms.some(r=>r.id==='!dm:test'))rooms.push({id:'!dm:test',name:'Иван Иванов',membership:'joined',encryption:'unencrypted',unread:0,members:2,lastBody:null,lastTs:0});return '!dm:test'},
 op:async(kind,args={})=>{
   window.__operations=[...(window.__operations||[]),{kind,...args}];
   if(kind==='roomDetails')return {members:[{userId:'@alice:test',name:'Alice',power:100,membership:'join'},{userId:'@bob:test',name:'Bob',power:0,membership:'join'}],pinned,myPower:100,canSend:true,name:'Команда Matrix',encrypted:false,notificationMode};
   if(kind==='profile')return {userId:args.userId||session.userId,displayName:args.userId?'Bob':profileName};
   if(kind==='setProfile'){profileName=args.name;return null;}
   if(kind==='devices')return [{id:'TEST',name:'MatrixGram',current:true,lastSeen:1000},{id:'OTHER',name:'Element',current:false}];
   if(kind==='pin'){pinned=args.pinned?[args.eventId]:[];return null;}
   if(kind==='readBy')return ['@bob:test'];
   if(kind==='notifications'){notificationMode=args.mode==='mute'?'Some(Mute)':'Some(AllMessages)';return null;}
   if(kind==='publicRooms')return {rooms:[{room_id:'!public:test',name:'Открытая группа',topic:'Для всех',num_joined_members:8}],next:null};
   if(kind==='join'){rooms.push({id:'!public:test',name:'Открытая группа',membership:'joined',encryption:'unencrypted',unread:0,members:8,lastBody:null,lastTs:0});return '!public:test';}
   if(kind==='leave'){const index=rooms.findIndex(r=>r.id===args.roomId);rooms.splice(index,1);return null;}
   if(kind==='search')return {room_events:{results:[],next_batch:null}};
   if(kind==='turn')return {urls:[],username:'',credential:''};
   if(kind==='exportKeys')return '-----BEGIN MEGOLM SESSION DATA-----test-encrypted';
   if(kind==='formatted'){const id='$formatted';events.push({event_id:id,sender:session.userId,type:'m.room.message',origin_server_ts:3000,content:{msgtype:'m.text',body:args.body,format:'org.matrix.custom.html',formatted_body:'<strong>Важное</strong>'}});setTimeout(()=>publish(args.roomId),5);return id;}
   return null;
 },
 media:async source=>({data:mediaStore[source.url]||pixel}),
 upload:async upload=>{window.__uploads=[...(window.__uploads||[]),{...upload,data:undefined,bytes:atob(upload.data).length}];if(upload.target==='profile')return 'mxc://test/avatar';const id='$upload'+Date.now(),url='mxc://test/'+upload.txn;mediaStore[url]=upload.data;events.push({event_id:id,sender:session.userId,type:'m.room.message',origin_server_ts:Date.now(),content:{msgtype:upload.voice?'m.audio':upload.mime.startsWith('image/')?'m.image':'m.file',body:upload.name,url,info:{mimetype:upload.mime,size:20,duration:upload.durationMs},...(upload.voice?{'org.matrix.msc3245.voice':{}}:{})}});setTimeout(()=>publish(upload.roomId),5);return id;},
 cancelUpload:async()=>{},saveFile:async(name,data)=>{window.__savedFile={name,data};return true},
 desktop:async autostart=>({desktop:true,autostart:!!autostart}),minimize:async()=>{},notify:async(title,body)=>{window.__notifications=[...(window.__notifications||[]),{title,body}]},openUrl:async url=>{window.__openedUrl=url},
 accounts:async()=>({entries:[],active:null}),addAccount:async()=>session,switchAccount:async()=>session,mediaPermissions:async()=>true,requestNotifications:async()=>true
};
export const onAppUpdateProgress=async()=>()=>{};
export const onTransfer=async()=>()=>{};
export const onUpdate=async callback=>{updates.add(callback);return ()=>updates.delete(callback)};
export const onConnection=async()=>()=>{};
`;

export async function login(page: Page, adapter = fixtureApi) {
  await page.route('**/src/api.ts', route => route.fulfill({ contentType: 'text/javascript', body: adapter }));
  await page.goto('/');
  await page.getByLabel('Логин или Matrix ID').fill('alice');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Войти в MatrixGram' }).click();
  await expect(page.getByRole('complementary', { name: 'Чаты', exact: true })).toBeVisible();
}

