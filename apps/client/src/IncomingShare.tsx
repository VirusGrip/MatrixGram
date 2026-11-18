import { useEffect, useRef, useState } from 'react';
import {api} from './api';
import {MAX_FILE_BYTES,nativeTransferFile,type TransferFile} from './files';
import { useStore } from './store';
import {attachFiles} from './Attachments';
import { Avatar, Modal } from './ui';
import { roomTitle } from './contacts';
declare global { interface Window { matrixgramShareReady?: boolean; matrixgramBack?: () => boolean } }
export function useIncomingShare() {
  const names = useStore(s => s.contactNames);
  const session = useStore(s => s.session), rooms = useStore(s => s.rooms);
  const [incoming, setIncoming] = useState<{ text: string; files: TransferFile[] } | null>(null);
  const pending=useRef<TransferFile[]>([]);
  const release=(files:TransferFile[])=>{for(const file of files)if(nativeTransferFile(file))void api.releaseSharedFile(file.nativeHandle).catch(()=>{})};
  useEffect(() => {
    window.matrixgramShareReady = true;
    const handler = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail;
        if (!detail || !Array.isArray(detail.files) || detail.files.length > 10) return;
        const files: TransferFile[] = []; let total = 0;
        for (const item of detail.files) {
          if(typeof item.nativeHandle==='string'&&item.nativeHandle.length<=64&&typeof item.name==='string'){
            const size=Number.isSafeInteger(item.size)&&item.size>=0?item.size:0;
            if(size>MAX_FILE_BYTES)throw new Error('Размер файла должен быть не больше 500 МБ');
            files.push({name:item.name.slice(0,255),type:typeof item.mime==='string'?item.mime:'application/octet-stream',size,nativeHandle:item.nativeHandle});continue;
          }
          if (typeof item.data !== 'string' || item.data.length > 35_000_000 || typeof item.name !== 'string') return;
          const bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0)); total += bytes.length;
          if (total > 25 * 1024 * 1024) return;
          files.push(new File([bytes], item.name.slice(0, 255), { type: typeof item.mime === 'string' ? item.mime : 'application/octet-stream' }));
        }
        const text = typeof detail.text === 'string' ? detail.text.slice(0, 16000) : '';
        if (text || files.length) {release(pending.current);pending.current=files;setIncoming({ text, files });}
      } catch (e) { useStore.getState().setError(e); }
    };
    window.addEventListener('matrixgram-share', handler);
    window.matrixgramBack = () => {
      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true; }
      if (document.querySelector('.call-overlay')) return true;
      if (useStore.getState().activeRoom) { useStore.getState().select(null); return true; }
      return false;
    };
    return () => { window.removeEventListener('matrixgram-share', handler);release(pending.current);pending.current=[]; delete window.matrixgramShareReady; delete window.matrixgramBack; };
  }, []);
  if (!session || !incoming) return null;
  return <Modal title="Поделиться в MatrixGram" close={() => {release(pending.current);pending.current=[];setIncoming(null)}}><p className="share-preview">{incoming.text || incoming.files.map(file => file.name).join(', ')}</p><p className="muted">Выберите чат, затем добавьте текст и нажмите «Отправить». Файлов: {incoming.files.length}.</p><div className="forward-rooms">{rooms.filter(room => room.membership === 'joined').map(room => <button key={room.id} aria-label={`Прикрепить в ${roomTitle(room,names)}`} onClick={() => { const payload=incoming;if(!attachFiles(room.id,payload.files,payload.text))return;pending.current=[];setIncoming(null);useStore.getState().select(room.id); }}><Avatar name={roomTitle(room,names)} url={room.avatarUrl} size="small"/>{roomTitle(room,names)}</button>)}</div></Modal>;
}
