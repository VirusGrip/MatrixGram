import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, KeyRound, MessageCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from './api';
import { useStore } from './store';
import { roomTitle, userTitle } from './contacts';
import { Avatar, Modal, errorText } from './ui';
import type { ChatFolder, EncryptionStatus, UserSearchResult } from './models';

export function EncryptionDialog({ close }: { close: () => void }) {
  const status = useStore(s => s.encryption);
  const [method, setMethod] = useState<'recovery' | 'file'>('recovery');
  const [key, setKey] = useState(''), [exportText, setExport] = useState(''), [fileName, setFileName] = useState(''), [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  async function update(value: EncryptionStatus) {
    useStore.setState({ encryption: value });
    const current = useStore.getState();
    if (current.activeRoom) await current.load(current.activeRoom);
  }
  async function enable() {
    setBusy(true); setError('');
    try { await update(await api.enableEncryption()); close(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function recover(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setResult('');
    try {
      if (method === 'file') {
        const count = await api.importEncryptionKeys(exportText, passphrase);
        await update(await api.encryptionStatus());
        setResult(`Ключей импортировано: ${count}. Доступная история обновлена.`);
      } else {
        await update(await api.recoverEncryption(key));
        setResult('Ключ восстановления подключён. История открывается там, где доступны ключи сообщений.');
      }
    } catch (e) { setError(errorText(e)); }
    finally { setKey(''); setPassphrase(''); setExport(''); setFileName(''); setBusy(false); }
  }
  return <Modal title="Открыть зашифрованные комнаты" close={close}>
    <div className="feature-intro"><KeyRound size={25}/><p>Восстановление необязательно. Можно продолжить общение без ключа, а старую зашифрованную историю открыть позже.</p></div>
    <button className="primary full-width" disabled={busy} onClick={() => { void enable(); }}>{status.enabled ? 'Вернуться к переписке' : 'Открыть доступные сообщения без ключа'}</button>
    <div className="feature-divider">Подключить ключи для старой истории</div>
    <div className="segmented"><button className={method === 'recovery' ? 'active' : ''} onClick={() => setMethod('recovery')}>Ключ восстановления</button><button className={method === 'file' ? 'active' : ''} onClick={() => setMethod('file')}>Файл ключей</button></div>
    <form className="feature-form" onSubmit={recover}>
      {method === 'recovery' ? <label>Ключ или пароль хранилища Matrix<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder="Ключ восстановления из Element" disabled={busy}/></label> : <>
        <label>Зашифрованный экспорт ключей<input type="file" accept=".txt,.key,.json" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0]; setExport(''); setFileName(''); setError('');
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) { setError('Файл должен быть не больше 10 МБ'); return; }
          try { setExport(await file.text()); setFileName(file.name); } catch { setError('Не удалось прочитать файл'); }
        }}/>{fileName && <small className="muted">{fileName}</small>}</label>
        <label>Пароль файла ключей<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} disabled={busy}/></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && <p className="feature-success" role="status"><Check size={17}/>{result}</p>}
      <button className="primary" disabled={busy || (method === 'recovery' ? !key.trim() : !exportText || !passphrase)}>{busy ? 'Подключаем ключи…' : method === 'recovery' ? 'Восстановить по ключу' : 'Импортировать ключи'}</button>
    </form>
    <p className="feature-footnote">Ключи не сбрасываются. Новые комнаты по умолчанию остаются без шифрования.</p>
  </Modal>;
}

export function PeopleSearch({ close }: { close: () => void }) {
  const names = useStore(s => s.contactNames);
  const [term, setTerm] = useState(''), [result, setResult] = useState<UserSearchResult>({ users: [], limited: false });
  const [loading, setLoading] = useState(false), [opening, setOpening] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setResult({ users: [], limited: false }); setError('');
    if (term.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void api.searchUsers(term.trim()).then(value => { if (!cancelled) setResult(value); })
        .catch(e => { if (!cancelled) setError(errorText(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term]);
  async function open(userId: string) {
    setOpening(userId); setError('');
    try {
      const id = await api.openDirect(userId);
      useStore.setState({ rooms: await api.rooms(), activeRoom: id }); close();
    } catch (e) { setError(errorText(e)); } finally { setOpening(''); }
  }
  return <Modal title="Поиск пользователей" close={close}>
    <label>Имя, фамилия или Matrix ID<input autoFocus autoComplete="off" value={term} onChange={e => setTerm(e.target.value)} maxLength={128} placeholder="Например, Иванов"/></label>
    <div className="people-results" aria-live="polite">
      {loading ? <p className="feature-empty">Ищем пользователей…</p> : result.users.length ? result.users.map(user => <button className="person-result" key={user.userId} disabled={!!opening} onClick={() => { void open(user.userId); }} aria-label={`Написать ${userTitle(user.userId, user.displayName, names)}`}>
        <Avatar name={userTitle(user.userId, user.displayName, names)}/><span><strong>{userTitle(user.userId, user.displayName, names)}</strong><small>{user.userId}</small></span><MessageCircle size={19}/>
      </button>) : <div className="feature-empty"><Search size={25}/><p>{term.trim().length < 2 ? 'Введите хотя бы 2 символа' : 'Пользователи не найдены'}</p></div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result.limited && <p className="muted">Есть другие результаты. Уточните имя или фамилию.</p>}
    <p className="feature-footnote">Поиск по имени из профиля в каталоге Matrix. Видимость людей зависит от настроек сервера.</p>
  </Modal>;
}

export function FolderManager({ close }: { close: () => void }) {
  const names = useStore(s => s.contactNames);
  const rooms = useStore(s => s.rooms).map(room => ({...room,name:roomTitle(room,names)})), folders = useStore(s => s.folders);
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(''), [chosen, setChosen] = useState<string[]>([]), [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(value: ChatFolder[]) {
    setBusy(true); setError('');
    try { useStore.setState({ folders: await api.saveFolders(value) }); return true; }
    catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  }
  function reset() { setEditing(null); setName(''); setChosen([]); setUnread(false); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const folder = { id: editing ?? crypto.randomUUID(), name: name.trim(), roomIds: chosen, unreadOnly: unread };
    if (folders.some(f => f.id !== editing && f.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase())) { setError('Папка с таким названием уже есть'); return; }
    if (await save(editing ? folders.map(f => f.id === editing ? folder : f) : [...folders, folder])) reset();
  }
  function move(index: number, delta: number) {
    const value = [...folders], other = index + delta;
    if (other < 0 || other >= value.length) return;
    [value[index], value[other]] = [value[other], value[index]]; void save(value);
  }
  return <Modal title="ПАПКИ" close={close}>
    <p className="muted">Соберите рабочие, личные и другие чаты в свои папки.</p>
    <div className="folder-manager-list">{folders.map((folder, index) => <div className="folder-manager-row" key={folder.id}>
      <span><strong>{folder.name}</strong><small>{folder.roomIds.length} чатов{folder.unreadOnly ? ' · только непрочитанные' : ''}</small></span>
      <button className="icon-button" aria-label={`Выше ${folder.name}`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15}/></button>
      <button className="icon-button" aria-label={`Ниже ${folder.name}`} disabled={busy || index === folders.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15}/></button>
      <button className="icon-button" aria-label={`Изменить папку ${folder.name}`} disabled={busy} onClick={() => { setEditing(folder.id); setName(folder.name); setChosen(folder.roomIds); setUnread(folder.unreadOnly); }}><Pencil size={15}/></button>
      <button className="icon-button" aria-label={`Удалить папку ${folder.name}`} disabled={busy} onClick={() => { void save(folders.filter(f => f.id !== folder.id)); if (editing === folder.id) reset(); }}><Trash2 size={15}/></button>
    </div>)}</div>
    <form className="feature-form" onSubmit={submit}>
      <label>{editing ? 'Название папки' : 'Новая папка'}<input maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="Например, Работа" required disabled={busy}/></label>
      <div className="folder-room-choices" aria-label="Чаты в папке">{rooms.map(room => <label className="checkbox" key={room.id}><input type="checkbox" checked={chosen.includes(room.id)} onChange={e => setChosen(value => e.target.checked ? [...value, room.id] : value.filter(id => id !== room.id))}/><span>{room.name}</span></label>)}</div>
      <label className="checkbox"><input type="checkbox" checked={unread} onChange={e => setUnread(e.target.checked)}/>Показывать только непрочитанные чаты</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">{editing && <button type="button" className="text-button" onClick={reset}>Отмена изменения</button>}<button className="primary" disabled={busy || !name.trim()}><Plus size={17}/>{editing ? 'Сохранить папку' : 'Создать папку'}</button></div>
    </form>
    <p className="feature-footnote">Папки сохраняются на этом устройстве. Удаление папки не удаляет чаты.</p>
  </Modal>;
}
