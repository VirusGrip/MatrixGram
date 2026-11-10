import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, FileText, Mic, Pause, Play, Send, Square, Trash2 } from 'lucide-react';
import { api } from './api';
import { fileBase64 } from './files';
export { fileBase64 } from './files';
export { Uploads } from './Transfers';
import { useStore } from './store';
import type { Attachment } from './models';
import { Modal, errorText } from './ui';

const cache = new Map<string, { promise: Promise<string>; size: number }>();
let cacheBytes = 0;
function evict(key: string) { cacheBytes -= cache.get(key)?.size || 0; cache.delete(key); }
export function clearMediaCache() { cache.clear(); cacheBytes = 0; }
export async function mediaBytes(source: Record<string, unknown>) {
  const key = JSON.stringify(source);
  if (!cache.has(key)) {
    if (cache.size >= 20) evict(cache.keys().next().value!);
    const entry = { promise: Promise.resolve(''), size: 0 };
    entry.promise = api.media(source).then(result => {
      if (cache.get(key) === entry) { entry.size = result.data.length; cacheBytes += entry.size; while (cacheBytes > 32 * 1024 * 1024 && cache.size) evict(cache.keys().next().value!); }
      return result.data;
    }).catch(error => { if (cache.get(key) === entry) evict(key); throw error; });
    cache.set(key, entry);
  }
  return cache.get(key)!.promise;
}
function blob(data: string, mime: string) {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}
export function useMedia(source: Record<string, unknown> | undefined, mime: string, enabled = true) {
  const key = JSON.stringify(source), session = useStore(s => s.session);
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, objectUrl = ''; setUrl(''); setError('');
    if (source && enabled) void mediaBytes(source).then(data => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob(data, mime)); setUrl(objectUrl);
    }).catch(e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  // The serialized source provides stable identity for objects assembled during rendering.
  }, [key, mime, enabled, session]);
  return { url, error };
}
export const fileSize = (size?: number) => size == null ? '' : size < 1024 ? `${size} Б` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`;
export async function saveAttachment(attachment: Attachment) {
  const data = await mediaBytes(attachment.source);
  await api.saveFile(attachment.name, data);
}

export function MediaView({ attachment }: { attachment: Attachment }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' }); if (host.current) observer.observe(host.current); return () => observer.disconnect(); }, []);
  const [opened, setOpened] = useState(false), [load, setLoad] = useState(attachment.kind === 'm.image' && (attachment.size ?? 0) <= 5 * 1024 * 1024), [saving, setSaving] = useState(false);
  const { url, error } = useMedia(attachment.source, attachment.mime, visible && load || opened);
  const save = async () => { setSaving(true); try { await saveAttachment(attachment); } catch (e) { useStore.getState().setError(e); } finally { setSaving(false); } };
  return <div ref={host} className={`media-content media-${attachment.kind.slice(2)}`}>
    {attachment.kind === 'm.image' && url ? <button className="image-preview" aria-label={`Открыть изображение ${attachment.name}`} onClick={() => setOpened(true)}><img src={url} alt={attachment.name} loading="lazy"/></button>
      : (attachment.kind === 'm.video' || attachment.kind === 'm.audio') && url ? attachment.kind === 'm.video' ? <video src={url} controls preload="metadata"/> : <audio src={url} controls preload="metadata"/>
      : <button className="file-preview" onClick={() => { if (attachment.kind === 'm.file') void save(); else setLoad(true); }} disabled={saving} aria-label={`Загрузить ${attachment.name}`}><FileText size={28}/><span><strong>{attachment.voice ? 'Голосовое сообщение' : attachment.name}</strong><small>{fileSize(attachment.size)} {attachment.duration ? `· ${Math.round(attachment.duration / 1000)} сек.` : ''}{load && !error ? ' · Загрузка…' : ''}</small></span><Download size={18}/></button>}
    {error && <div className="media-error">{error}<button className="text-button" onClick={() => { evict(JSON.stringify(attachment.source)); setLoad(false); requestAnimationFrame(() => setLoad(true)); }}>Повторить</button></div>}
    {url && <button className="text-button media-save" disabled={saving} onClick={() => { void save(); }}><Download size={13}/>Сохранить</button>}
    {opened && <Modal title={attachment.name} close={() => setOpened(false)}><div className="media-viewer">{url && <img src={url} alt={attachment.name}/>}<button className="primary" onClick={() => { void save(); }}>Сохранить изображение</button></div></Modal>}
  </div>;
}

const allowed = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 'blockquote', 'p', 'br', 'ul', 'ol', 'li', 'span', 'a', 'h1', 'h2', 'h3', 'hr']);
export function FormattedText({ html, fallback, onMention }: { html?: string; fallback: string; onMention?: (id: string) => void }) {
  const content = useMemo(() => {
    if (!html) return fallback.split(/(https?:\/\/[^\s<>]+|@[a-zA-Z0-9._=\/-]+:[a-zA-Z0-9.:-]+)/g).map((part,index) => /^https?:\/\//i.test(part) ? <a key={index} href={part} onClick={e => { e.preventDefault(); void api.openUrl(part).catch(error => useStore.getState().setError(error)); }}>{part}</a> : part.startsWith('@') && part.includes(':') && onMention ? <button key={index} className="inline-mention" onClick={() => onMention(part)}>{part}</button> : part);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const render = (node: Node, key: number): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof Element) || ['script', 'style', 'iframe', 'object', 'img'].includes(node.tagName.toLowerCase())) return null;
      const tag = node.tagName.toLowerCase(), children = [...node.childNodes].map(render);
      if (!allowed.has(tag)) return children;
      if (tag === 'a') {
        const href = node.getAttribute('href') ?? '';
        return /^https?:\/\//i.test(href) ? <a key={key} href={href} onClick={e => { e.preventDefault(); void api.openUrl(href).catch(error => useStore.getState().setError(error)); }}>{children}</a> : children;
      }
      return createElement(tag, { key }, tag === 'br' || tag === 'hr' ? undefined : children);
    };
    return [...doc.body.childNodes].map(render);
  }, [html, fallback, onMention]);
  return <div className="formatted-text">{content}</div>;
}

export function VoiceRecorder({ roomId, close }: { roomId: string; close: () => void }) {
  const [seconds, setSeconds] = useState(0), [paused, setPaused] = useState(false), [level, setLevel] = useState(0), [error, setError] = useState(''), [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null), parts = useRef<Blob[]>([]), sendOnStop = useRef(false), txn = useRef(crypto.randomUUID()), recorded = useRef<Blob | null>(null), duration = useRef(0);
  const alive = useRef(true), uploading = useRef(false);
  const recordingSession = useRef(useStore.getState().session);
  duration.current = seconds * 1000;
  async function sendAudio(audio: Blob) {
    setSending(true); setError('');
    try {
      if (!audio.size || audio.size > 25 * 1024 * 1024) throw new Error('Запись должна быть не больше 25 МБ');
      const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm', data = await fileBase64(audio), session = recordingSession.current;
      if (!alive.current || !session || useStore.getState().session !== session) return;
      uploading.current = true;
      await api.upload({ roomId, name: `voice-${Date.now()}.${extension}`, mime: audio.type, data, txn: txn.current, target: 'message', voice: true, durationMs: duration.current, sessionKey: `${session.userId}|${session.deviceId}` });
      uploading.current = false; if (alive.current) close();
    } catch (e) { uploading.current = false; if (alive.current) { setError(errorText(e)); setSending(false); } }
  }
  useEffect(() => {
    let stopped = false, stream: MediaStream | undefined, context: AudioContext | undefined; alive.current = true;
    const timer = window.setInterval(() => { if (recorder.current?.state === 'recording') setSeconds(value => value + 1); }, 1000);
    void api.mediaPermissions(false).then(granted => { if (stopped) throw new Error('Запись отменена'); if (!granted) throw new Error('Разрешение микрофона не предоставлено'); return navigator.mediaDevices.getUserMedia({ audio: true }); }).then(value => {
      stream = value; if (stopped) { value.getTracks().forEach(track => track.stop()); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(value, mime ? { mimeType: mime } : undefined); recorder.current = instance;
      context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 256; context.createMediaStreamSource(value).connect(analyser);
      const amplitude = new Uint8Array(analyser.frequencyBinCount);
      const measure = () => { if (stopped) return; analyser.getByteTimeDomainData(amplitude); setLevel(Math.max(...amplitude.map(v => Math.abs(v - 128))) / 128); requestAnimationFrame(measure); }; measure();
      instance.ondataavailable = event => { if (event.data.size) parts.current.push(event.data); };
      instance.onstop = () => {
        value.getTracks().forEach(track => track.stop());
        recorded.current = new Blob(parts.current, { type: instance.mimeType });
        if (sendOnStop.current) void sendAudio(recorded.current);
      };
      parts.current = []; instance.start(500);
    }).catch(e => { if (!stopped) setError(`Микрофон недоступен: ${errorText(e)}`); });
    return () => { stopped = true; alive.current = false; sendOnStop.current = false; clearInterval(timer); if (recorder.current?.state !== 'inactive') recorder.current?.stop(); stream?.getTracks().forEach(track => track.stop()); void context?.close().catch(() => {}); if (uploading.current) void api.cancelUpload(txn.current).catch(() => {}); };
  }, [roomId]);
  return <div className="voice-recorder"><Mic size={20}/><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span><div className="voice-meter"><span style={{ width: `${Math.max(3, level * 100)}%` }}/></div>{error && <span role="alert">{error}</span>}<button className="icon-button" aria-label={paused ? 'Продолжить запись' : 'Пауза записи'} disabled={sending || !!recorded.current} onClick={() => { const instance = recorder.current; if (instance?.state === 'recording') { instance.pause(); setPaused(true); } else if (instance?.state === 'paused') { instance.resume(); setPaused(false); } }}>{paused ? <Play size={18}/> : <Pause size={18}/>}</button><button className="icon-button" aria-label="Отменить запись" onClick={close}><Trash2 size={18}/></button><button className="icon-button accent" aria-label="Отправить голосовое" disabled={sending || seconds < 1} onClick={() => { if (recorded.current) { void sendAudio(recorded.current); return; } setSending(true); sendOnStop.current = true; recorder.current?.stop(); }}><Send size={20}/></button><Square className="sr-only"/></div>;
}
