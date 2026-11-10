import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useMedia } from './Media';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function Avatar({ name, size = '', url }: { name: string; size?: string; url?: string | null }) {
  const media = useMedia(url ? { url } : undefined, 'image/png');
  const colors = ['#568cc9', '#b17ac6', '#5ba9a0', '#d29668', '#7484cc'];
  const hash = [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
  return <span className={`avatar ${size}`} style={{ background: colors[hash % colors.length] }} aria-hidden="true">{media.url ? <img src={media.url} alt=""/> : name.replace(/^[@!#]/, '').slice(0, 2).toUpperCase()}</span>;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return createPortal(<dialog ref={ref} className="modal" onCancel={close} aria-label={title}>
    <header><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Закрыть"><X size={21}/></button></header>
    {children}
  </dialog>, document.body);
}
