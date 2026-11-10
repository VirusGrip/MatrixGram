import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from './api';
import { useStore } from './store';
import { Avatar, errorText } from './ui';
interface Catalog { entries: { id: string; userId: string; homeserver: string }[]; active: string | null }
export function Accounts({ savedOnly = false }: { savedOnly?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>({ entries: [], active: null }), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [server, setServer] = useState('https://matrix.mad-frog.ru'), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const session = useStore(s => s.session);
  useEffect(() => { void api.accounts().then(setCatalog).catch(e => { if (!savedOnly) setError(errorText(e)); }); }, [session, savedOnly]);
  async function activate(operation: () => ReturnType<typeof api.switchAccount>) {
    setBusy(true); setError(''); let activated = false;
    try {
      const session = await operation();
      activated = true;
      useStore.getState().clear(); useStore.getState().setSession(session);
      useStore.setState({ rooms: await api.rooms() }); setAdding(false);
    } catch (e) { if (activated) useStore.getState().setError(e); else setError(errorText(e)); }
    finally { setBusy(false); setPassword(''); }
  }
  if (savedOnly && !catalog.entries.length) return null;
  return <section className={`accounts-panel ${savedOnly ? 'saved-accounts' : 'settings-section'}`}><h3>{savedOnly ? 'Сохранённые аккаунты' : 'Аккаунты'}</h3>{catalog.entries.map(account => <button className={`account-choice ${catalog.active === account.id ? 'active' : ''}`} key={account.id} disabled={busy || !!session && catalog.active === account.id} onClick={() => { void activate(() => api.switchAccount(account.id)); }}><Avatar name={account.userId} size="tiny"/><span><strong>{account.userId}</strong><small>{account.homeserver}</small></span>{catalog.active === account.id && <small>✓</small>}</button>)}{!savedOnly && <button className="text-button" onClick={() => setAdding(!adding)}><Plus size={16}/>Добавить аккаунт</button>}{adding && <form onSubmit={e => { e.preventDefault(); void activate(() => api.addAccount(server, username, password)); }}><label>Сервер аккаунта<input type="url" required value={server} onChange={e => setServer(e.target.value)}/></label><label>Логин нового аккаунта<input required value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"/></label><label>Пароль нового аккаунта<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label><button className="primary" disabled={busy}>{busy ? 'Подключение…' : 'Войти в другой аккаунт'}</button></form>}{error && <p className="form-error" role="alert">{error}</p>}</section>;
}
