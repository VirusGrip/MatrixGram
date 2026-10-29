import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Check, CheckCheck, CircleAlert, Folder, Hash, Info, KeyRound, LockKeyhole, LogOut, MessageCircle, Moon, Pencil, Pin, Plus, Reply, Search, Send, Settings, ShieldOff, Sun, Trash2, Users, Wifi, WifiOff, X } from 'lucide-react';
import { api, nativeAvailable, onConnection, onUpdate } from './api';
import { useStore } from './store';
import { projectTimeline } from './timeline';
import type { Message, RoomSummary } from './models';
import { Avatar, Modal } from './ui';
import { EncryptionDialog, FolderManager, PeopleSearch } from './SidebarFeatures';
const time = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const date = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

function Login({ loading }: { loading: boolean }) {
  const [server, setServer] = useState('https://matrix.mad-frog.ru');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const error = useStore(s => s.error);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); useStore.getState().setError(null);
    try {
      const session = await api.login(server, username, password);
      setPassword(''); useStore.getState().setSession(session);
      const rooms = await api.rooms();
      useStore.setState({ rooms });
    } catch (error) { useStore.getState().setError(error); }
    finally { setBusy(false); }
  }
  return <main className="login-screen">
    <div className="login-orbit orbit-one"/><div className="login-orbit orbit-two"/>
    <section className="login-card">
      <div className="brand-logo"><Send size={36} strokeWidth={1.6}/></div>
      <span className="eyebrow">ВАШИ ЛЮДИ. ВАШ СЕРВЕР.</span>
      <h1>MatrixGram<span>.</span></h1>
      <p className="login-intro">Привычное общение.<br/>Открытая сеть Matrix.</p>
      {!nativeAvailable() && <div className="notice"><Info size={18}/>Открыта веб-оболочка. Для подключения к Matrix запустите приложение Windows или Android.</div>}
      {loading ? <p role="status" className="loading-text">Восстанавливаем сессию…</p> : <form onSubmit={submit}>
        <label>Сервер<input type="url" value={server} onChange={e => setServer(e.target.value)} required autoComplete="url" spellCheck={false}/></label>
        <label>Логин или Matrix ID<input value={username} onChange={e => setUsername(e.target.value)} placeholder="@вы:matrix.mad-frog.ru" required autoComplete="username" autoCapitalize="none" spellCheck={false}/></label>
        <label>Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"/></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary login-submit" type="submit" disabled={busy || !nativeAvailable()}>{busy ? 'Подключаемся…' : 'Войти в MatrixGram'}<Send size={18}/></button>
      </form>}
      {error && !loading && <button className="text-button" onClick={() => { void api.forget().then(() => useStore.getState().setError(null)).catch(e => useStore.getState().setError(e)); }}>Сбросить сохранённую сессию на этом устройстве</button>}
      <p className="login-note"><KeyRound size={17}/>Зашифрованные комнаты можно открыть после входа.<br/>Восстановление ключей необязательно.</p>
    </section>
    <footer>MatrixGram · 0.2.0 · ранняя версия</footer>
  </main>;
}

function RoomList({ rooms, selected, pins, select, togglePin }: { rooms: RoomSummary[]; selected: string | null; pins: string[]; select: (id: string) => void; togglePin: (id: string) => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({ count: rooms.length, getScrollElement: () => parent.current, estimateSize: () => 82, overscan: 6 });
  return <div className="room-list" ref={parent} aria-label="Список чатов">
    {!rooms.length && <div className="list-empty"><MessageCircle size={30}/><p>Здесь появятся ваши чаты</p><small>Дождитесь синхронизации или создайте комнату</small></div>}
    <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
      {rows.getVirtualItems().map(row => {
        const room = rooms[row.index];
        return <div className={`room-row ${selected === room.id ? 'selected' : ''}`} key={room.id} style={{ transform: `translateY(${row.start}px)` }}>
          <button className="room-select" onClick={() => select(room.id)} aria-label={`Открыть ${room.name}`}>
            <Avatar name={room.name}/><span className="room-copy"><span className="room-top"><strong>{room.encryption === 'encrypted' && <LockKeyhole size={12}/>} {room.name}</strong><time>{room.lastTs ? time(room.lastTs) : ''}</time></span>
              <span className="room-bottom"><span>{room.membership === 'invited' ? 'Приглашение в комнату' : room.encryption === 'encrypted' ? 'Зашифрованная переписка' : room.lastBody || 'Пока нет сообщений'}</span>{room.unread > 0 && <b className="badge">{room.unread}</b>}</span>
            </span>
          </button>
          <button className={`pin-button ${pins.includes(room.id) ? 'pinned' : ''}`} aria-label={`${pins.includes(room.id) ? 'Открепить' : 'Закрепить'} ${room.name}`} onClick={() => togglePin(room.id)}><Pin size={12}/></button>
        </div>;
      })}
    </div>
  </div>;
}

function CreateRoom({ close }: { close: () => void }) {
  const [name, setName] = useState(''), [invite, setInvite] = useState(''), [isPublic, setPublic] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const id = await api.create(name, invite.split(/[\s,]+/).filter(Boolean), isPublic);
      const rooms = await api.rooms(); useStore.setState({ rooms, activeRoom: id }); close();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <Modal title="Новая комната" close={close}><form onSubmit={submit} className="modal-form">
    <label>Название<input autoFocus value={name} onChange={e => setName(e.target.value)} required maxLength={255} placeholder="Например, наша команда"/></label>
    <label>Участники< textarea value={invite} onChange={e => setInvite(e.target.value)} placeholder="@имя:matrix.mad-frog.ru — через пробел" rows={3}/></label>
    <label className="checkbox"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)}/>Публичная комната в каталоге сервера</label>
    <div className="notice"><ShieldOff size={20}/>Комната создаётся без сквозного шифрования. Сервер может читать сообщения.</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать комнату'}</button>
  </form></Modal>;
}

function Preferences({ close, theme, setTheme }: { close: () => void; theme: string; setTheme: (value: string) => void }) {
  const session = useStore(s => s.session)!;
  const encryptedEnabled = useStore(s => s.encryption.enabled);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="Настройки" close={close}>
    <div className="profile"><Avatar name={session.userId} size="large"/><strong>{session.userId}</strong><span>{session.homeserver}</span></div>
    <div className="settings-section"><h3>Оформление</h3><div className="segmented"><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Sun size={17}/>Светлая</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Moon size={17}/>Тёмная</button></div></div>
    <div className="settings-section"><h3>Сессия</h3><p className="muted">Устройство: {session.deviceId}</p><p className="muted">{session.persisted ? 'Сессия и ключ хранилища защищены Windows DPAPI.' : 'Сессия хранится только до закрытия приложения. Постоянное хранение Android ещё не реализовано.'}</p><p className="muted">Ключи E2EE можно подключить кнопкой сбоку.</p></div>
    <div className="settings-section"><h3>Ранняя версия</h3><p className="muted">Звонки, вложения, уведомления, голосовые сообщения, несколько аккаунтов и управление устройствами ещё в разработке.</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {confirm ? <div className="confirm-row"><span>Завершить эту сессию на сервере?{encryptedEnabled && ' Ключи, которых нет в резервной копии или экспорте, могут стать недоступны после выхода.'}</span><button className="danger" disabled={busy} onClick={async () => { setBusy(true); try { await api.logout(); useStore.getState().clear(); close(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>Выйти</button><button className="text-button" onClick={() => setConfirm(false)}>Отмена</button></div> : <button className="logout-button" onClick={() => setConfirm(true)}><LogOut size={18}/>Выйти из аккаунта</button>}
  </Modal>;
}

function Chat({ room, showInfo, toggleInfo, openEncryption }: { room: RoomSummary; showInfo: boolean; toggleInfo: () => void; openEncryption: () => void }) {
  const session = useStore(s => s.session)!;
  const raw = useStore(s => s.events[room.id]);
  const messages = useMemo(() => projectTimeline(raw ?? []), [raw]);
  const allPending = useStore(s => s.pending);
  const pending = allPending.filter(p => p.roomId === room.id);
  const cursor = useStore(s => s.cursors[room.id]);
  const [body, setBody] = useState(''), [loading, setLoading] = useState(false), [sending, setSending] = useState(false);
  const [reply, setReply] = useState<Message | null>(null), [edit, setEdit] = useState<Message | null>(null), [deleting, setDeleting] = useState<Message | null>(null);
  const [find, setFind] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const draftReady = useRef(false), draftBody = useRef(''), editing = useRef(false), scroll = useRef<HTMLDivElement>(null), stick = useRef(true), initialScroll = useRef(true), typingAt = useRef(0);
  draftBody.current = body; editing.current = edit !== null;
  const filtered = useMemo(() => messages.filter(m => !find || m.body.toLocaleLowerCase().includes(find.toLocaleLowerCase())), [messages, find]);
  const rows = useVirtualizer({ count: filtered.length, getScrollElement: () => scroll.current, estimateSize: () => 102, overscan: 10, getItemKey: i => filtered[i].id });
  const e2eeEnabled = useStore(s => s.encryption.enabled);
  const blocked = room.encryption === 'encrypted' && !e2eeEnabled;

  useEffect(() => {
    if (room.membership !== 'joined' || blocked) { setLoading(false); return; }
    let cancelled = false; setLoading(true);
    void useStore.getState().load(room.id).catch(e => { if (!cancelled) useStore.getState().setError(e); }).finally(() => { if (!cancelled) setLoading(false); });
    void api.draft(room.id).then(value => { if (!cancelled) { setBody(value); draftReady.current = true; } }).catch(e => useStore.getState().setError(e));
    return () => {
      cancelled = true;
      if (draftReady.current && !editing.current) void api.saveDraft(room.id, draftBody.current).catch(() => {});
    };
  }, [room.id, room.membership, blocked]);
  useEffect(() => {
    if (!draftReady.current || edit) return;
    const timer = window.setTimeout(() => { void api.saveDraft(room.id, body).catch(e => useStore.getState().setError(e)); }, 400);
    return () => window.clearTimeout(timer);
  }, [room.id, body, edit]);
  useLayoutEffect(() => {
    if (!filtered.length || (!stick.current && !initialScroll.current)) return;
    requestAnimationFrame(() => rows.scrollToIndex(filtered.length - 1, { align: 'end' }));
    initialScroll.current = false;
  }, [filtered.length, rows]);
  useEffect(() => {
    const last = messages.at(-1);
    if (!blocked && last && stick.current && document.visibilityState === 'visible') void api.read(room.id, last.id).catch(() => {});
  }, [room.id, messages, blocked]);
  async function older() {
    if (loading) return;
    setLoading(true); stick.current = false;
    const first = rows.getVirtualItems()[0];
    const anchor = first ? filtered[first.index]?.id : undefined;
    try {
      await useStore.getState().load(room.id, true);
      if (anchor) requestAnimationFrame(() => {
        const updated = projectTimeline(useStore.getState().events[room.id] ?? []);
        const index = updated.findIndex(m => m.id === anchor); if (index >= 0) rows.scrollToIndex(index, { align: 'start' });
      });
    } catch (e) { useStore.getState().setError(e); } finally { setLoading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || sending || blocked) return;
    setSending(true); const value = body;
    try {
      let success = true;
      if (edit) { await api.edit(room.id, edit.id, value); setEdit(null); }
      else success = await useStore.getState().send(room.id, value, reply?.id);
      if (success) { setBody(current => current === value ? '' : current); setReply(null); await api.saveDraft(room.id, ''); stick.current = true; }
    } catch (e) { useStore.getState().setError(e); } finally { setSending(false); }
  }
  return <section className="chat-panel">
    <header className="chat-header">
      <button className="icon-button back-button" aria-label="Назад к чатам" onClick={() => useStore.getState().select(null)}><ArrowLeft/></button>
      <Avatar name={room.name} size="small"/><div className="chat-heading"><h2>{room.name}</h2><span>{room.membership === 'invited' ? 'Вас пригласили' : `${room.members} участников`} · {room.encryption === 'encrypted' ? 'Сквозное шифрование' : 'Matrix'}</span></div>
      {room.encryption === 'encrypted' && <button className="icon-button" aria-label="Ключи комнаты" onClick={openEncryption}><KeyRound size={20}/></button>}
      <button className="icon-button" aria-label="Поиск в загруженных сообщениях" onClick={() => setSearchOpen(!searchOpen)}><Search size={21}/></button>
      <button className={`icon-button ${showInfo ? 'accent' : ''}`} aria-label="Информация о комнате" onClick={toggleInfo}><Info size={21}/></button>
    </header>
    {searchOpen && <div className="chat-search"><Search size={17}/><input autoFocus placeholder="Поиск в загруженной истории" value={find} onChange={e => setFind(e.target.value)}/><button className="icon-button" aria-label="Закрыть поиск" onClick={() => { setSearchOpen(false); setFind(''); }}><X size={18}/></button></div>}
    {room.membership === 'invited' ? <div className="chat-state"><Users size={42}/><h2>Приглашение в комнату</h2><p>{room.name}</p><button className="primary" onClick={() => { void api.join(room.id).then(async () => useStore.setState({ rooms: await api.rooms() })).catch(e => useStore.getState().setError(e)); }}>Вступить</button></div> : blocked ? <div className="chat-state"><LockKeyhole size={44}/><h2>Зашифрованная комната</h2><p>Откройте доступные сообщения сейчас.<br/>Ключи для старой истории можно подключить позже.</p><button className="primary" onClick={openEncryption}>Открыть зашифрованные комнаты</button></div> : <>
      <div className="timeline" ref={scroll} onScroll={() => { const el = scroll.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} aria-label="Сообщения">
        <div className="history-control"><button className="text-button" disabled={loading || cursor === null} onClick={() => { void older(); }}>{loading ? 'Загружаем историю…' : cursor === null ? 'Начало доступной истории' : 'Загрузить более ранние'}</button></div>
        {!messages.length && !loading && <div className="chat-state small-state"><MessageCircle size={38}/><p>Начните разговор</p></div>}
        <div className="message-list" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map(row => {
            const message = filtered[row.index], previous = filtered[row.index - 1];
            const mine = message.sender === session.userId;
            return <div ref={rows.measureElement} data-index={row.index} key={message.id} className="message-slot" style={{ transform: `translateY(${row.start}px)` }}>
              {(!previous || date(previous.ts) !== date(message.ts)) && <div className="date-divider"><span>{date(message.ts)}</span></div>}
              <article className={`bubble ${mine ? 'mine' : ''} ${message.deleted ? 'deleted' : ''}`} aria-label={`Сообщение от ${message.sender}`}>
                {!mine && <strong className="sender">{message.sender.split(':')[0].replace('@', '')}</strong>}
                {message.replyTo && <blockquote>{messages.find(m => m.id === message.replyTo)?.body ?? 'Ответ на более раннее сообщение'}</blockquote>}
                <p>{message.body}</p>
                <span className="message-meta">{message.edited && 'изменено · '}{time(message.ts)}{mine && <Check size={13}/>}</span>
                {message.reactions.length > 0 && <div className="reactions">{message.reactions.map(r => <span key={r.key}>{r.key} {r.count}</span>)}</div>}
                {!message.deleted && !message.encrypted && <div className="message-actions">
                  <button title="Ответить" aria-label="Ответить" onClick={() => { setReply(message); setEdit(null); }}><Reply size={15}/></button>
                  <button title="Реакция 👍" aria-label="Реакция 👍" onClick={() => { void api.react(room.id, message.id, '👍').catch(e => useStore.getState().setError(e)); }}>👍</button>
                  {mine && <><button title="Редактировать" aria-label="Редактировать" onClick={() => { setEdit(message); setReply(null); setBody(message.body); }}><Pencil size={14}/></button><button title="Удалить" aria-label="Удалить" onClick={() => setDeleting(message)}><Trash2 size={14}/></button></>}
                </div>}
              </article>
            </div>;
          })}
        </div>
        {pending.map(p => <div className="pending-wrap" key={p.txn}><div className="bubble mine pending"><p>{p.body}</p><span className="message-meta">{p.status === 'failed' ? 'Не отправлено' : p.status === 'sent' ? <><CheckCheck size={13}/>На сервере, ждём синхронизации</> : 'Отправляем…'}</span>{p.status === 'failed' && <button className="text-button" onClick={() => { void useStore.getState().send(p.roomId, p.body, p.replyTo, p.txn).then(success => { if (success) { setBody(current => current === p.body ? '' : current); stick.current = true; } }); }}>Повторить</button>}</div></div>)}
      </div>
      {(reply || edit) && <div className="composer-context"><Reply size={20}/><span><strong>{edit ? 'Редактирование' : 'Ответ'}</strong><small>{(edit ?? reply)?.body}</small></span><button className="icon-button" aria-label="Отменить ответ или редактирование" onClick={() => { if (edit) setBody(''); setEdit(null); setReply(null); }}><X size={17}/></button></div>}
      <form className="composer" onSubmit={submit}>
        <textarea aria-label="Сообщение" placeholder="Написать сообщение…" value={body} rows={1} maxLength={16000} onChange={e => {
          setBody(e.target.value);
          if (Date.now() - typingAt.current > 5000) { typingAt.current = Date.now(); void api.typing(room.id, true).catch(() => {}); }
        }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(e); } }}/>
        <button type="submit" className="send-button" aria-label={edit ? 'Сохранить изменение' : 'Отправить'} disabled={!body.trim() || sending}>{edit ? <Check size={21}/> : <Send size={21}/>}</button>
      </form>
      <div className="composer-hint">Enter — отправить · Shift + Enter — новая строка</div>
    </>}
    {deleting && <Modal title="Удалить сообщение?" close={() => setDeleting(null)}><p>Сообщение будет удалено для участников комнаты через Matrix.</p><div className="modal-actions"><button className="text-button" onClick={() => setDeleting(null)}>Отмена</button><button className="danger" onClick={() => { void api.redact(room.id, deleting.id).then(() => setDeleting(null)).catch(e => useStore.getState().setError(e)); }}>Удалить</button></div></Modal>}
  </section>;
}

export default function App() {
  const session = useStore(s => s.session), rooms = useStore(s => s.rooms), activeRoom = useStore(s => s.activeRoom), error = useStore(s => s.error), connection = useStore(s => s.connection);
  const [booting, setBooting] = useState(nativeAvailable()), [search, setSearch] = useState(''), [tab, setTab] = useState('all');
  const [creating, setCreating] = useState(false), [settings, setSettings] = useState(false), [info, setInfo] = useState(window.innerWidth >= 1200);
  const [theme, setThemeValue] = useState(localStorage.getItem('matrixgram.theme') ?? 'light');
  const [pins, setPins] = useState<string[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false), [foldersOpen, setFoldersOpen] = useState(false), [encryptionOpen, setEncryptionOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const folders = useStore(s => s.folders), encryption = useStore(s => s.encryption);
  const pinKey = `matrixgram.pins.${session?.homeserver}.${session?.userId}`;
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('matrixgram.theme', theme); }, [theme]);
  useEffect(() => { try { const value: unknown = JSON.parse(localStorage.getItem(pinKey) ?? '[]'); setPins(Array.isArray(value) ? value.filter(v => typeof v === 'string') : []); } catch { setPins([]); } }, [pinKey]);
  useEffect(() => { if (session) void useStore.getState().loadFeatures().catch(e => useStore.getState().setError(e)); }, [session]);
  useEffect(() => { if (activeFolder && !folders.some(f => f.id === activeFolder)) setActiveFolder(null); }, [folders, activeFolder]);
  useEffect(() => {
    if (!nativeAvailable()) return;
    let disposed = false; const cleanup: (() => void)[] = [];
    void (async () => {
      const unlisten = await onUpdate((key, update) => useStore.getState().apply(key, update)); cleanup.push(unlisten);
      const unconnect = await onConnection((key, message) => { const s = useStore.getState().session; if (s && `${s.userId}|${s.deviceId}` === key) useStore.setState({ connection: 'reconnecting', error: message }); }); cleanup.push(unconnect);
      if (disposed) { cleanup.forEach(fn => fn()); return; }
      const saved = await api.bootstrap();
      if (disposed) return;
      useStore.getState().setSession(saved);
      if (saved) useStore.setState({ rooms: await api.rooms() });
    })().catch(e => { if (!disposed) useStore.getState().setError(e); }).finally(() => { if (!disposed) setBooting(false); });
    return () => { disposed = true; cleanup.forEach(fn => fn()); };
  }, []);
  const room = rooms.find(r => r.id === activeRoom);
  const shown = useMemo(() => {
    const folder = folders.find(f => f.id === activeFolder);
    return rooms.filter(r => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (tab !== 'unread' || r.unread > 0) && (tab !== 'pinned' || pins.includes(r.id)) && (!folder || folder.roomIds.includes(r.id) && (!folder.unreadOnly || r.unread > 0)))
      .sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  }, [rooms, search, tab, pins, folders, activeFolder]);
  if (!session) return <Login loading={booting}/>;
  function togglePin(id: string) { const value = pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id]; setPins(value); localStorage.setItem(pinKey, JSON.stringify(value)); }
  return <main className={`app-shell ${activeRoom ? 'has-active' : ''} ${info && room ? 'with-info' : ''}`}>
    <nav className="rail" aria-label="Главное меню"><div className="rail-brand"><Send size={25}/></div><button className="rail-button active" aria-label="Все чаты" onClick={() => { setTab('all'); setActiveFolder(null); }}><MessageCircle size={23}/><span>Чаты</span></button><button className="rail-button" onClick={() => setFoldersOpen(true)} aria-label="Управление папками"><Folder size={23}/><span>ПАПКИ</span></button><div className="rail-spacer"/><button className="rail-button" aria-label="Сменить тему" onClick={() => setThemeValue(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={21}/> : <Sun size={21}/>}</button><button className="rail-button" aria-label="Настройки" onClick={() => setSettings(true)}><Settings size={22}/></button><Avatar name={session.userId} size="tiny"/></nav>
    <aside className="sidebar"><header className="sidebar-heading"><div><span className="eyebrow">MATRIXGRAM</span><h1>Сообщения<span>.</span></h1></div><button className="icon-button new-room" aria-label="Новая комната" onClick={() => setCreating(true)}><Plus size={23}/></button><button className="icon-button mobile-settings" aria-label="Настройки" onClick={() => setSettings(true)}><Settings size={20}/></button></header>
      <div className="search-with-people"><label className="search-field"><Search size={18}/><input placeholder="Найти чат" value={search} onChange={e => setSearch(e.target.value)} aria-label="Найти чат"/></label><button className="icon-button" aria-label="Поиск пользователей" title="Поиск людей по имени" onClick={() => setPeopleOpen(true)}><Users size={21}/></button></div>
      <section className="folders-section" aria-label="ПАПКИ"><header><strong>ПАПКИ</strong><button className="icon-button" aria-label="Настроить ПАПКИ" onClick={() => setFoldersOpen(true)}><Plus size={16}/></button></header><div className="folder-tabs"><button className={activeFolder === null ? 'active' : ''} onClick={() => setActiveFolder(null)}>Все</button>{folders.map(folder => <button key={folder.id} className={activeFolder === folder.id ? 'active' : ''} onClick={() => { setActiveFolder(folder.id); setTab('all'); }}>{folder.name}</button>)}</div></section>
      <div className="chat-tabs"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Все чаты <span>{rooms.length}</span></button><button className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>Новые</button><button className={tab === 'pinned' ? 'active' : ''} onClick={() => setTab('pinned')} aria-label="Закреплённые чаты"><Pin size={15}/></button></div>
      <RoomList rooms={shown} selected={activeRoom} pins={pins} select={id => useStore.getState().select(id)} togglePin={togglePin}/>
      <button className={`encryption-side-button ${encryption.enabled ? 'enabled' : ''}`} aria-label="Открыть зашифрованные комнаты" onClick={() => setEncryptionOpen(true)}><KeyRound size={19}/><span><strong>Открыть зашифрованные комнаты</strong><small>{encryption.enabled ? 'Ключи и восстановление' : 'Необязательно'}</small></span></button>
      <div className={`connection ${connection === 'online' ? 'online' : ''}`}>{connection === 'online' ? <Wifi size={14}/> : <WifiOff size={14}/>}<span>{connection === 'online' ? 'Подключено к Matrix' : connection === 'reconnecting' ? 'Переподключение…' : 'Синхронизация…'}</span><small>0.2.0</small></div>
    </aside>
    {room ? <Chat key={room.id} room={room} showInfo={info} toggleInfo={() => setInfo(!info)} openEncryption={() => setEncryptionOpen(true)}/> : <section className="welcome"><div className="welcome-icon"><MessageCircle size={50} strokeWidth={1.4}/></div><span className="eyebrow">ОБЩЕНИЕ БЕЗ ЛИШНЕГО</span><h2>На связи.<br/>В своей сети.</h2><p>Выберите чат слева<br/>или начните новый разговор.</p><button className="primary" onClick={() => setCreating(true)}><Plus size={18}/>Новая комната</button><span className="welcome-server"><span/>{session.homeserver.replace('https://', '').replace(/\/$/, '')}</span></section>}
    {room && info && <aside className="details"><header><h3>О комнате</h3><button className="icon-button" aria-label="Скрыть информацию" onClick={() => setInfo(false)}><X size={19}/></button></header><div className="room-profile"><Avatar name={room.name} size="large"/><h2>{room.name}</h2><span>{room.members} участников</span></div><div className="detail-item"><Hash size={20}/><div><small>Matrix ID комнаты</small><p>{room.id}</p></div></div>{room.topic && <div className="detail-item"><Info size={20}/><div><small>Описание</small><p>{room.topic}</p></div></div>}<div className="detail-item"><ShieldOff size={20}/><div><small>Шифрование</small><p>{room.encryption === 'encrypted' ? 'E2EE · ключи подключаются сбоку' : room.encryption === 'unknown' ? 'Проверяется перед отправкой' : 'Без сквозного шифрования'}</p></div></div><div className="details-note"><Info size={17}/><p>MatrixGram 0.2.0<br/>Вложения и звонки ещё в разработке.</p></div></aside>}
    {error && <div className="toast" role="alert"><CircleAlert size={20}/><span>{error}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => useStore.getState().setError(null)}><X size={18}/></button></div>}
    {creating && <CreateRoom close={() => setCreating(false)}/>}
    {settings && <Preferences close={() => setSettings(false)} theme={theme} setTheme={setThemeValue}/>}
    {peopleOpen && <PeopleSearch close={() => setPeopleOpen(false)}/>}
    {foldersOpen && <FolderManager close={() => setFoldersOpen(false)}/>}
    {encryptionOpen && <EncryptionDialog close={() => setEncryptionOpen(false)}/>}
  </main>;
}
