import {useEffect,useState} from 'react';
import {api} from './api';
import {errorText} from './ui';

export interface IntegrationStatus {supported:boolean;active:boolean;setupAvailable:boolean;configured:boolean}

export function WindowsIntegrationPanel() {
  const [status,setStatus]=useState<IntegrationStatus|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let disposed=false;void api.windowsIntegration().then(value=>{if(!disposed)setStatus(value)}).catch(e=>{if(!disposed)setError(errorText(e))});return()=>{disposed=true}},[]);
  if(status&&!status.supported)return null;
  if(!status&&!error)return null;
  return <section className="settings-section" aria-label="Группировка процессов Windows">
    <h3>Группировка процессов Windows</h3>
    {status?.active?<p>Включена для этого запуска MatrixGram.</p>:<>
      <p className="muted">Объединяет MatrixGram и WebView2 в одну группу диспетчера задач с общей памятью.</p>
      {status?.configured&&<p role="status">Настройка сохранена. Полностью выйдите из MatrixGram через меню «Выход» и запустите его снова для проверки.</p>}
      {status?.setupAvailable?<><p className="muted">Первая настройка требует подтверждения администратора. Временное доверие сертификату удаляется после настройки.</p>
        <button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');setNotice('');try{const value=await api.configureWindowsIntegration();setStatus(value);if(!value.configured&&!value.active)setNotice('Настройка отменена.')}catch(e){setError(errorText(e))}finally{setBusy(false)}}}>{busy?'Ожидаем настройку Windows…':'Настроить группировку'}</button>
      </>:status&&<p className="muted">Настройка доступна в установленной версии MatrixGram для Windows.</p>}
    </>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}
