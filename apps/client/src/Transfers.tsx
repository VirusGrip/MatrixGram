import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { RotateCcw, X } from 'lucide-react';
import { api, onTransfer } from './api';
import { useStore } from './store';
import { fileBase64,MAX_FILE_BYTES,INLINE_FILE_BYTES,FILE_CHUNK_BYTES,nativeTransferFile,type TransferFile } from './files';
import {useDownloads,downloadProgress,clearDownloads} from './Downloads';
interface Task { txn: string; roomId: string; sessionKey: string; name: string; file?: TransferFile; state: 'queued' | 'preparing' | 'uploading' | 'sent' | 'failed' | 'cancelled'; current: number; total: number; error?: string }
export const useUploads = create<{ tasks: Task[] }>(() => ({ tasks: [] }));
export const hasActiveFileTransfers=()=>useUploads.getState().tasks.some(t=>['queued','preparing','uploading'].includes(t.state))||useDownloads.getState().tasks.some(t=>t.state==='downloading'||t.state==='saving');
let running = 0;
function update(txn: string, patch: Partial<Task>) { useUploads.setState(s => ({ tasks: s.tasks.map(task => task.txn === txn ? { ...task, ...patch } : task) })); }
async function process(task: Task) {
  running++; update(task.txn, { state: 'preparing' });
  try {
    const file = task.file!;
    if(nativeTransferFile(file)){
      if(file.size>MAX_FILE_BYTES)throw new Error('Размер файла должен быть не больше 500 МБ');
      await api.uploadSharedFile({roomId:task.roomId,name:file.name,mime:file.type,txn:task.txn,size:file.size},task.sessionKey,file.nativeHandle);
      if(useUploads.getState().tasks.find(item=>item.txn===task.txn)?.state!=='cancelled')update(task.txn,{state:'sent',file:undefined});
      return;
    }
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Размер файла должен быть от 1 байта до 500 МБ');
    const metadata={roomId:task.roomId,name:file.name,mime:file.type||'application/octet-stream',txn:task.txn,size:file.size};
    if(file.size>INLINE_FILE_BYTES){
      let staging=false;
      try{
        await api.beginFileUpload(metadata,task.sessionKey);staging=true;
        for(let offset=0;offset<file.size;offset+=FILE_CHUNK_BYTES){
          const current=useUploads.getState().tasks.find(item=>item.txn===task.txn),session=useStore.getState().session;
          if(!current||current.state==='cancelled'||`${session?.userId}|${session?.deviceId}`!==task.sessionKey)throw new Error('Передача отменена');
          const bytes=await file.slice(offset,Math.min(file.size,offset+FILE_CHUNK_BYTES)).arrayBuffer();
          await api.fileUploadChunk(task.txn,offset,bytes);
          update(task.txn,{current:Math.min(file.size,offset+bytes.byteLength),total:file.size});
        }
        update(task.txn,{state:'uploading',current:0,total:file.size});
        // finish owns cleanup after it receives the stage. Cancelling again on
        // a send failure would leave an early-cancel marker for the retry.
        staging=false;
        await api.finishFileUpload(task.txn);
      }catch(error){if(staging)await api.cancelUpload(task.txn).catch(()=>{});throw error;}
      if(useUploads.getState().tasks.find(item=>item.txn===task.txn)?.state!=='cancelled')update(task.txn,{state:'sent',file:undefined});
      return;
    }
    const data = await fileBase64(file), current = useUploads.getState().tasks.find(item => item.txn === task.txn), session = useStore.getState().session;
    if (!current || current.state === 'cancelled' || `${session?.userId}|${session?.deviceId}` !== task.sessionKey) return;
    update(task.txn, { state: 'uploading' });
    await api.upload({ roomId: task.roomId, name: file.name, mime: file.type || 'application/octet-stream', data, txn: task.txn, target: 'message', sessionKey: task.sessionKey });
    if (useUploads.getState().tasks.find(item => item.txn === task.txn)?.state !== 'cancelled') update(task.txn, { state: 'sent', file: undefined });
  } catch (error) { if (useUploads.getState().tasks.find(item => item.txn === task.txn)?.state !== 'cancelled') update(task.txn, { state: 'failed', error: error instanceof Error ? error.message : String(error) }); }
  finally { running--; pump(); }
}
function pump() { while (running < 2) { const task = useUploads.getState().tasks.find(task => task.state === 'queued'); if (!task) break; void process(task); } }
export function enqueueFiles(roomId: string, files: TransferFile[]) {
  const session = useStore.getState().session; if (!session) return;
  if (files.length > 50) { useStore.getState().setError('Можно добавить до 50 файлов за один раз'); return; }
  if (useUploads.getState().tasks.filter(task => task.file).length + files.length > 100) { useStore.getState().setError('В очереди уже 100 файлов. Дождитесь отправки или отмените лишние.'); return; }
  const tasks: Task[] = files.map(file => ({ txn: crypto.randomUUID(), roomId, sessionKey: `${session.userId}|${session.deviceId}`, name: file.name, file, state: 'queued', current: 0, total: 0 }));
  useUploads.setState(s => ({ tasks: [...s.tasks, ...tasks] })); pump();
}
function release(file:TransferFile|undefined){if(file&&nativeTransferFile(file))void api.releaseSharedFile(file.nativeHandle).catch(()=>{});}
function cancel(txn: string) {const task=useUploads.getState().tasks.find(t=>t.txn===txn); update(txn, { state: 'cancelled', file: undefined }); void api.cancelUpload(txn).catch(() => {});release(task?.file); }
export function TransferService() {
  const session = useStore(s => s.session);
  useEffect(() => {
    const subscription = onTransfer(value => { downloadProgress(value);const task = useUploads.getState().tasks.find(task => task.txn === value.txn); if (task?.sessionKey === value.sessionKey && ['preparing','uploading'].includes(task.state)) update(value.txn, { current: value.current, total: value.total, ...(value.phase==='uploading'?{state:'uploading' as const}:{}) }); });
    return () => { for (const task of useUploads.getState().tasks) {if (['queued','preparing','uploading'].includes(task.state)) cancel(task.txn);else release(task.file);} useUploads.setState({ tasks: [] });clearDownloads(); void subscription.then(unlisten => unlisten()); };
  }, [session]);
  return null;
}
export function Uploads({ roomId, files, done }: { roomId: string; files: File[]; done: () => void }) {
  const tasks = useUploads(s => s.tasks), last = useRef<File[] | null>(null);
  useEffect(() => { if (last.current !== files) { last.current = files; enqueueFiles(roomId, files); } }, [files, roomId]);
  const states = { queued: 'В очереди', preparing: 'Подготовка…', uploading: 'Отправка…', sent: 'Отправлено', failed: 'Не отправлено', cancelled: 'Отменено' };
  return <div className="upload-list" aria-label="Загрузка файлов">{tasks.filter(task => task.roomId === roomId).map(task => <div key={task.txn}><span><strong>{task.name}</strong><small>{task.error || states[task.state]} {task.total > 0 && ['preparing','uploading'].includes(task.state) && `${Math.min(100, Math.round(task.current / task.total * 100))}%`}</small>{task.total > 0 && ['preparing','uploading'].includes(task.state) && <progress value={task.current} max={task.total}/>}</span>{task.state === 'failed' && task.file ? <button className="icon-button" aria-label={`Повторить ${task.name}`} onClick={() => { update(task.txn, { state: 'queued', error: undefined, current: 0, total: 0 }); pump(); }}><RotateCcw size={16}/></button> : ['queued','preparing','uploading'].includes(task.state) ? <button className="icon-button" aria-label={`Отменить ${task.name}`} onClick={() => cancel(task.txn)}><X size={16}/></button> : null}</div>)}<button className="text-button" onClick={() => { for(const task of tasks)if(task.roomId===roomId&&!['queued','preparing','uploading'].includes(task.state))release(task.file);useUploads.setState(s => ({ tasks: s.tasks.filter(task => task.roomId !== roomId || ['queued','preparing','uploading'].includes(task.state)) })); done(); }}>Закрыть</button></div>;
}
