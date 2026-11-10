import { useEffect, useState } from 'react';
import { api } from './api';
import type { MatrixEvent, RoomSummary } from './models';
import { Modal, errorText } from './ui';
interface Results { room_events?: { results?: { result?: MatrixEvent }[]; next_batch?: string; count?: number } }
export function HistorySearch({ room, initial, close, locate }: { room: RoomSummary; initial: string; close: () => void; locate: (event: MatrixEvent) => void }) {
  const [query, setQuery] = useState(initial), [results, setResults] = useState<MatrixEvent[]>([]), [next, setNext] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function search(cursor?: string) {
    setBusy(true); setError('');
    try { const response = await api.op<Results>('search', { roomId: room.id, term: query, next: cursor || null }); const found = response.room_events?.results?.flatMap(item => item.result ? [item.result] : []) ?? []; setResults(current => cursor ? [...current, ...found] : found); setNext(response.room_events?.next_batch || null); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void search(); }, []);
  return <Modal title="Поиск по истории" close={close}><form onSubmit={e => { e.preventDefault(); void search(); }}><label>Текст сообщения<input autoFocus value={query} onChange={e => setQuery(e.target.value)} required minLength={2}/></label><button className="primary" disabled={busy}>Найти на сервере</button></form>{error && <p className="form-error" role="alert">{error}</p>}<div className="history-results">{results.map(result => <button key={result.event_id} onClick={async () => { setBusy(true); try { const event = await api.op<MatrixEvent>('event', { roomId: room.id, eventId: result.event_id }); locate(event); close(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }} disabled={busy}><strong>{result.sender}</strong><p>{String(result.content.body || 'Вложение')}</p><small>{new Date(result.origin_server_ts).toLocaleString('ru-RU')}</small></button>)}{!busy && !results.length && !error && <p className="muted">Ничего не найдено</p>}</div>{next && <button className="text-button" disabled={busy} onClick={() => { void search(next); }}>Показать ещё</button>}</Modal>;
}
