import { useEffect, useState } from 'react';
import { useStore } from './store';
import { enqueueFiles } from './Transfers';
import { Avatar, Modal } from './ui';
import { roomTitle } from './contacts';
declare global { interface Window { matrixgramShareReady?: boolean; matrixgramBack?: () => boolean } }
export function useIncomingShare() {
  const names = useStore(s => s.contactNames);
  const session = useStore(s => s.session), rooms = useStore(s => s.rooms);
  const [incoming, setIncoming] = useState<{ text: string; files: File[] } | null>(null);
  useEffect(() => {
    window.matrixgramShareReady = true;
    const handler = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail;
        if (!detail || !Array.isArray(detail.files) || detail.files.length > 10) return;
        const files: File[] = []; let total = 0;
        for (const item of detail.files) {
          if (typeof item.data !== 'string' || item.data.length > 35_000_000 || typeof item.name !== 'string') return;
          const bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0)); total += bytes.length;
          if (total > 25 * 1024 * 1024) return;
          files.push(new File([bytes], item.name.slice(0, 255), { type: typeof item.mime === 'string' ? item.mime : 'application/octet-stream' }));
        }
        const text = typeof detail.text === 'string' ? detail.text.slice(0, 16000) : '';
        if (text || files.length) setIncoming({ text, files });
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
    return () => { window.removeEventListener('matrixgram-share', handler); delete window.matrixgramShareReady; delete window.matrixgramBack; };
  }, []);
  if (!session || !incoming) return null;
  return <Modal title="Поделиться в MatrixGram" close={() => setIncoming(null)}><p className="share-preview">{incoming.text || incoming.files.map(file => file.name).join(', ')}</p><p className="muted">Выберите получателя. Будет отправлено файлов: {incoming.files.length}.</p><div className="forward-rooms">{rooms.filter(room => room.membership === 'joined').map(room => <button key={room.id} aria-label={`Отправить в ${roomTitle(room,names)}`} onClick={() => { const payload = incoming; setIncoming(null); useStore.getState().select(room.id); if (payload.files.length) enqueueFiles(room.id, payload.files); if (payload.text) void useStore.getState().send(room.id, payload.text); }}><Avatar name={roomTitle(room,names)} url={room.avatarUrl} size="small"/>{roomTitle(room,names)}</button>)}</div></Modal>;
}
