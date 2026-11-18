import {useEffect} from 'react';
import {create} from 'zustand';
import {Check,FileText,RotateCcw,X} from 'lucide-react';
import {api,onTransfer} from './api';
import {useStore} from './store';
import {Avatar} from './ui';
import {fileBase64,MAX_FILE_BYTES,INLINE_FILE_BYTES,FILE_CHUNK_BYTES,nativeTransferFile,type TransferFile} from './files';
import {useDownloads,downloadProgress,clearDownloads} from './Downloads';
import {clearAttachments,useAttachments} from './Attachments';
interface Task {txn:string;batch:string;roomId:string;sessionKey:string;name:string;file?:TransferFile;caption?:string;replyTo?:string;eventId?:string;state:'queued'|'preparing'|'uploading'|'sent'|'failed'|'cancelled';current:number;total:number;error?:string}
export const useUploads=create<{tasks:Task[]}>(()=>({tasks:[]}));
export const hasActiveFileTransfers=()=>useUploads.getState().tasks.some(t=>['queued','preparing','uploading'].includes(t.state))||Object.values(useAttachments.getState().files).some(files=>files.length>0)||useDownloads.getState().tasks.some(t=>t.state==='downloading'||t.state==='saving');
let running=0;
function update(txn:string,patch:Partial<Task>){useUploads.setState(s=>({tasks:s.tasks.map(task=>task.txn===txn?{...task,...patch}:task)}));}
async function process(task:Task){
  running++;update(task.txn,{state:'preparing'});
  try{
    const file=task.file!;
    if(file.size>MAX_FILE_BYTES||(!file.size&&!nativeTransferFile(file)))throw Error('Размер файла должен быть от 1 байта до 500 МБ');
    const metadata={roomId:task.roomId,name:file.name,mime:file.type||'application/octet-stream',txn:task.txn,size:file.size,caption:task.caption,replyTo:task.replyTo};
    let eventId:string;
    if(nativeTransferFile(file))eventId=await api.uploadSharedFile(metadata,task.sessionKey,file.nativeHandle);
    else if(file.size>INLINE_FILE_BYTES){
      let staging=false;
      try{
        await api.beginFileUpload(metadata,task.sessionKey);staging=true;
        for(let offset=0;offset<file.size;offset+=FILE_CHUNK_BYTES){
          const current=useUploads.getState().tasks.find(t=>t.txn===task.txn),session=useStore.getState().session;
          if(!current||current.state==='cancelled'||`${session?.userId}|${session?.deviceId}`!==task.sessionKey)throw Error('Передача отменена');
          const bytes=await file.slice(offset,Math.min(file.size,offset+FILE_CHUNK_BYTES)).arrayBuffer();
          await api.fileUploadChunk(task.txn,offset,bytes);update(task.txn,{current:Math.min(file.size,offset+bytes.byteLength),total:file.size});
        }
        update(task.txn,{state:'uploading',current:0,total:file.size});staging=false;
        eventId=await api.finishFileUpload(task.txn);
      }catch(error){if(staging)await api.cancelUpload(task.txn).catch(()=>{});throw error;}
    }else{
      const data=await fileBase64(file),current=useUploads.getState().tasks.find(t=>t.txn===task.txn),session=useStore.getState().session;
      if(!current||current.state==='cancelled'||`${session?.userId}|${session?.deviceId}`!==task.sessionKey)return;
      update(task.txn,{state:'uploading'});eventId=await api.upload({...metadata,data,target:'message',sessionKey:task.sessionKey});
    }
    if(useUploads.getState().tasks.find(t=>t.txn===task.txn)?.state!=='cancelled')update(task.txn,{state:'sent',eventId,file:undefined});
  }catch(error){if(useUploads.getState().tasks.find(t=>t.txn===task.txn)?.state!=='cancelled')update(task.txn,{state:'failed',error:error instanceof Error?error.message:String(error)});}
  finally{running--;pump();}
}
function pump(){while(running<2){const tasks=useUploads.getState().tasks;const task=tasks.find(task=>task.state==='queued'&&!tasks.some(other=>other.batch===task.batch&&['preparing','uploading'].includes(other.state)));if(!task)break;void process(task);}}
export function enqueueFiles(roomId:string,files:TransferFile[],caption='',replyTo?:string){
  const session=useStore.getState().session;if(!session)return false;
  if(files.length>50){useStore.getState().setError('Можно добавить до 50 файлов за один раз');return false;}
  if(new TextEncoder().encode(caption).length>16000){useStore.getState().setError('Подпись должна быть не больше 16000 байт текста');return false;}
  if(useUploads.getState().tasks.filter(task=>task.file).length+files.length>100){useStore.getState().setError('В очереди уже 100 файлов. Дождитесь отправки или отмените лишние.');return false;}
  const batch=crypto.randomUUID();
  const tasks:Task[]=files.map((file,index)=>({txn:crypto.randomUUID(),batch,roomId,sessionKey:`${session.userId}|${session.deviceId}`,name:file.name,file,caption:index===files.length-1&&caption.trim()?caption:undefined,replyTo,state:'queued',current:0,total:0}));
  useUploads.setState(s=>({tasks:[...s.tasks.filter(task=>!['sent','cancelled'].includes(task.state)).slice(-100),...tasks]}));pump();return true;
}
function release(file:TransferFile|undefined){if(file&&nativeTransferFile(file))void api.releaseSharedFile(file.nativeHandle).catch(()=>{});}
function cancel(txn:string){const task=useUploads.getState().tasks.find(t=>t.txn===txn);update(txn,{state:'cancelled',file:undefined});void api.cancelUpload(txn).catch(()=>{});release(task?.file);pump();}
export function TransferService(){
  const session=useStore(s=>s.session);
  useEffect(()=>{
    const subscription=onTransfer(value=>{downloadProgress(value);const task=useUploads.getState().tasks.find(task=>task.txn===value.txn);if(task?.sessionKey===value.sessionKey&&['preparing','uploading'].includes(task.state))update(value.txn,{current:value.current,total:value.total,...(value.phase==='uploading'?{state:'uploading' as const}:{})});});
    return ()=>{for(const task of useUploads.getState().tasks){if(['queued','preparing','uploading'].includes(task.state))cancel(task.txn);else release(task.file);}useUploads.setState({tasks:[]});clearDownloads();clearAttachments();void subscription.then(unlisten=>unlisten());};
  },[session]);return null;
}
export function OutgoingFiles({roomId}:{roomId:string}){
  const tasks=useUploads(s=>s.tasks),events=useStore(s=>s.events[roomId]),profile=useStore(s=>s.ownProfile),session=useStore(s=>s.session);
  const states={queued:'В очереди',preparing:'Подготовка…',uploading:'Отправка…',failed:'Не отправлено',sent:'',cancelled:''};
  return <>{tasks.filter(t=>t.roomId===roomId&&t.state!=='cancelled'&&(t.state!=='sent'||!events?.some(event=>event.event_id===t.eventId))).map(task=><div className="message-row outgoing pending-wrap" key={task.txn}><span className="message-avatar"><Avatar name={profile?.displayName||session?.userId||''} url={profile?.avatarUrl} size="tiny"/></span><article className="bubble mine pending upload-message" aria-label={`Отправка файла ${task.name}`}><div className="file-preview"><FileText size={26}/><strong>{task.name}</strong></div>{task.caption&&<p className="attachment-caption">{task.caption}</p>}<small className="upload-status" role={task.error?'alert':undefined}>{task.error||states[task.state]}{task.state==='sent'?<Check size={14} aria-label="Файл принят сервером"/>:null}{task.total>0&&['preparing','uploading'].includes(task.state)?` ${Math.min(100,Math.round(task.current/task.total*100))}%`:''}</small>{task.total>0&&['preparing','uploading'].includes(task.state)&&<progress value={task.current} max={task.total}/>}<div className="upload-controls">{task.state==='failed'&&task.file&&<button className="text-button" aria-label={`Повторить ${task.name}`} onClick={()=>{update(task.txn,{state:'queued',error:undefined,current:0,total:0});pump();}}><RotateCcw size={15}/>Повторить</button>}{task.state!=='sent'&&<button className="text-button" aria-label={`Отменить ${task.name}`} onClick={()=>cancel(task.txn)}><X size={15}/>Отменить</button>}</div></article></div>)}</>;
}