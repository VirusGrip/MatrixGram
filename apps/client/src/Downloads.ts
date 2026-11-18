import {create} from 'zustand';
import {api} from './api';
import {useStore} from './store';
import type {Attachment} from './models';

export interface DownloadTask {key:string;txn:string;sessionKey:string;name:string;current:number;total:number;state:'downloading'|'saving'|'saved'|'failed'|'cancelled';error?:string}
export const useDownloads=create<{tasks:DownloadTask[]}>(()=>({tasks:[]}));
const pending=new Map<string,Promise<boolean>>();
export const downloadKey=(source:Record<string,unknown>,sessionKey:string)=>sessionKey+'|'+JSON.stringify(source);
function update(txn:string,patch:Partial<DownloadTask>){useDownloads.setState(s=>({tasks:s.tasks.map(t=>t.txn===txn?{...t,...patch}:t)}))}
export function downloadProgress(value:{txn:string;sessionKey:string;phase?:string;current:number;total:number}){
  const task=useDownloads.getState().tasks.find(t=>t.txn===value.txn);
  if(task?.sessionKey===value.sessionKey&&(task.state==='downloading'||task.state==='saving'))update(task.txn,{state:value.phase==='saving'?'saving':'downloading',current:value.current,total:value.total});
}
export function cancelDownload(txn:string){update(txn,{state:'cancelled'});void api.cancelUpload(txn).catch(()=>{});}
export function clearDownloads(){for(const task of useDownloads.getState().tasks)if(task.state==='downloading'||task.state==='saving')cancelDownload(task.txn);useDownloads.setState({tasks:[]});pending.clear();}
export function downloadAttachment(attachment:Attachment):Promise<boolean>{
  const session=useStore.getState().session;if(!session)return Promise.reject(new Error('Выполните вход'));
  const sessionKey=`${session.userId}|${session.deviceId}`,key=downloadKey(attachment.source,sessionKey);
  const existing=pending.get(key);if(existing)return existing;
  const txn=crypto.randomUUID();
  useDownloads.setState(s=>({tasks:[...s.tasks.filter(t=>t.key!==key),{key,txn,sessionKey,name:attachment.name,current:0,total:attachment.size||0,state:'downloading'}]}));
  const operation:Promise<boolean>=(async()=>{
    try{const saved=await api.downloadFile(attachment.name,attachment.source,txn,sessionKey);update(txn,{state:saved?'saved':'cancelled'});return saved;}
    catch(error){if(useDownloads.getState().tasks.find(t=>t.txn===txn)?.state==='cancelled')return false;update(txn,{state:'failed',error:String(error)});throw error;}
  })();
  pending.set(key,operation);
  const release=()=>{if(pending.get(key)===operation)pending.delete(key)};
  void operation.then(release,release);return operation;
}
