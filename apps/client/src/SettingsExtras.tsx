import { useEffect, useState } from 'react';
import { api } from './api';
import { errorText } from './ui';

export function DesktopPreferences() {
  const [desktop, setDesktop] = useState(false), [autostart, setAutostart] = useState(false), [error, setError] = useState('');
  const [notifications, setNotifications] = useState(localStorage.getItem('matrixgram.notifications') !== 'off');
  const [preview, setPreview] = useState(localStorage.getItem('matrixgram.preview') === 'on');
  const [sound, setSound] = useState(localStorage.getItem('matrixgram.sound') !== 'off');
  const [scale, setScale] = useState(Number(localStorage.getItem('matrixgram.scale')) || 100);
  const [background, setBackground] = useState(localStorage.getItem('matrixgram.background') || 'plain');
  useEffect(() => { void api.desktop().then(value => { setDesktop(value.desktop); setAutostart(value.autostart); }).catch(e => setError(errorText(e))); }, []);
  return <><div className="settings-section"><h3>Уведомления</h3><label className="checkbox"><input type="checkbox" checked={notifications} onChange={async e => { const enabled = e.target.checked; try { if (enabled && !await api.requestNotifications()) throw new Error('Разрешите уведомления в настройках системы'); setNotifications(enabled); localStorage.setItem('matrixgram.notifications', enabled ? 'on' : 'off'); } catch (e) { setError(errorText(e)); } }}/>Сообщать о новых сообщениях</label><label className="checkbox"><input type="checkbox" checked={preview} onChange={e => { setPreview(e.target.checked); localStorage.setItem('matrixgram.preview', e.target.checked ? 'on' : 'off'); }}/>Показывать текст в уведомлении</label><label className="checkbox"><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); localStorage.setItem('matrixgram.sound', e.target.checked ? 'on' : 'off'); }}/>Звуковой сигнал</label><button className="text-button" onClick={async () => { try { if (!await api.requestNotifications()) throw new Error("Разрешите уведомления в настройках системы"); setError("Уведомления разрешены"); } catch (e) { setError(errorText(e)); } }}>Разрешить системные уведомления</button>{desktop && <label className="checkbox"><input type="checkbox" checked={autostart} onChange={async e => { try { const value = await api.desktop(e.target.checked); setAutostart(value.autostart); } catch (e) { setError(errorText(e)); } }}/>Запускать MatrixGram при входе в Windows</label>}{desktop && <button className="text-button" onClick={() => { void api.minimize().catch(e => setError(errorText(e))); }}>Свернуть в трей</button>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="settings-section"><h3>Размер интерфейса</h3><label>{scale}%<input type="range" min={85} max={125} step={5} value={scale} onChange={e => { const value = Number(e.target.value); setScale(value); localStorage.setItem('matrixgram.scale', String(value)); document.documentElement.style.setProperty('--ui-scale', String(value / 100)); }}/></label><label>Фон переписки<select value={background} onChange={e => { setBackground(e.target.value); localStorage.setItem('matrixgram.background', e.target.value); document.documentElement.dataset.background = e.target.value; }}><option value="plain">Однотонный</option><option value="dots">Точки</option><option value="grid">Сетка</option></select></label></div></>;
}

export function notifyMessages(key: string, update: import('./models').Update, quiet = false) {
  // Called only after initial sync. History pages never enter this function.
  if (localStorage.getItem('matrixgram.notifications') === 'off') return;
  const seenKey = `matrixgram.notified.${key}`;
  let previous: string[] = []; try { const value: unknown = JSON.parse(sessionStorage.getItem(seenKey) || '[]'); if (Array.isArray(value)) previous = value.filter((v): v is string => typeof v === 'string'); } catch { /* Reset corrupt notification metadata. */ }
  const seen = new Set(previous);
  let played = false;
  for (const page of update.timelines) {
    const room = update.rooms.find(room => room.id === page.roomId);
    const muted = localStorage.getItem(`matrixgram.muted.${key}.${page.roomId}`) === 'yes';
    for (const event of page.events) {
      if (seen.has(event.event_id)) continue;
      seen.add(event.event_id);
      if (quiet || event.sender === key.split('|')[0] || event.type !== 'm.room.message' || event.unsigned?.redacted_because || event.content['m.relates_to'] || Date.now() - event.origin_server_ts > 120_000 || muted || document.hasFocus()) continue;
      const text = localStorage.getItem('matrixgram.preview') === 'on' ? String(event.content.body || 'Вложение') : 'Новое сообщение';
      void api.notify(room?.name || 'MatrixGram', text).catch(() => {});
      if (!played && localStorage.getItem('matrixgram.sound') !== 'off') {
        played = true;
        try { const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(); gain.gain.setValueAtTime(.06, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18); oscillator.frequency.value = 720; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .2); oscillator.onended = () => { void context.close(); }; } catch { /* User gesture may be needed to unlock audio. */ }
      }
    }
  }
  sessionStorage.setItem(seenKey, JSON.stringify([...seen].slice(-500)));
}
