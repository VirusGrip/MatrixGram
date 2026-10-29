import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function Avatar({ name, size = '' }: { name: string; size?: string }) {
  const colors = ['#568cc9', '#b17ac6', '#5ba9a0', '#d29668', '#7484cc'];
  const hash = [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
  return <span className={`avatar ${size}`} style={{ background: colors[hash % colors.length] }} aria-hidden="true">{name.replace(/^[@!#]/, '').slice(0, 2).toUpperCase()}</span>;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={close} aria-label={title}>
    <header><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Закрыть"><X size={21}/></button></header>
    {children}
  </dialog>;
}
