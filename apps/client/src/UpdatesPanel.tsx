import { useEffect } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api, nativeAvailable, onAppUpdateProgress } from './api';
import { errorText } from './ui';
import { hasActiveFileTransfers } from './Transfers';
import { activeCall } from './Calls';
import { prepareForUpdate } from './UpdatePreparation';
import { useUpdates, initializeUpdates, checkUpdates } from './UpdateService';
import { Modal } from './ui';
export type { UpdateStatus } from './UpdateService';
export function UpdateNotice() {
  const {status,open} = useUpdates();
  useEffect(()=>{
    if (!nativeAvailable()) return;
    const check = () => { void initializeUpdates().then(()=>checkUpdates(true)).catch(()=>{}); };
    check(); window.addEventListener('focus',check);
    const timer = window.setInterval(check,15*60*1000);
    const listener = onAppUpdateProgress(value=>{if(value.phase==='downloading')useUpdates.setState({progress:value.total?`${Math.min(100,Math.floor(value.downloaded/value.total*100))}%`:`${Math.floor(value.downloaded/1024/1024)} МБ`})});
    return()=>{window.removeEventListener('focus',check);window.clearInterval(timer);void listener.then(off=>off()).catch(()=>{})};
  },[]);
  return <>{status?.available && !open && <button className="update-notice" onClick={()=>useUpdates.setState({open:true})} aria-live="polite"><Download size={18}/>Доступна MatrixGram {status.available.version} · Обновить</button>}{open&&<Modal title="Обновление MatrixGram" close={()=>useUpdates.setState({open:false})}><UpdatesPanel/></Modal>}</>;
}
export function UpdatesPanel() {
  const {status,busy,error,message,ready,progress}=useUpdates();
  const setBusy=(busy:boolean)=>useUpdates.setState({busy}),setError=(error:string)=>useUpdates.setState({error}),setMessage=(message:string)=>useUpdates.setState({message}),setReady=(ready:boolean)=>useUpdates.setState({ready}),setProgress=(progress:string)=>useUpdates.setState({progress});
  useEffect(()=>{void initializeUpdates().catch(e=>setError(errorText(e)))},[]);
  async function check() {await checkUpdates()}
  async function download() {setBusy(true);setError('');setProgress('0%');try{await api.downloadUpdate();setReady(true);setMessage('Обновление скачано и проверено')}catch(e){setError(errorText(e));setReady(false)}finally{setBusy(false);setProgress('')}}
  async function install() {
    if(activeCall()){setError('Завершите звонок перед установкой обновления');return}
    if(hasActiveFileTransfers()){setError('Дождитесь передачи файлов или отмените её перед обновлением');return}
    setBusy(true);setError('');
    try{await prepareForUpdate();const result=await api.installUpdate();setMessage(result==='permission'?'Разрешите установку обновлений для MatrixGram в настройках Android, вернитесь и нажмите «Установить» ещё раз.':'Открыт системный установщик. Подтвердите обновление.')}catch(e){setError(errorText(e));setReady(false)}finally{setBusy(false)}
  }
  return <section className="settings-section app-updates"><h3>Обновления MatrixGram</h3>{status&&<p className="muted">Текущая версия: {status.currentVersion}</p>}{status&&!status.configured?<p className="muted">Канал обновлений ещё не подключён.</p>:<button className="text-button" disabled={!status||busy} onClick={()=>{void check()}}><RefreshCw size={16}/>{busy&&!status?.available?'Проверяем…':'Проверить обновления'}</button>}{status?.available&&<div><p>Доступна версия <strong>{status.available.version}</strong></p>{status.available.notes&&<p className="update-notes">{status.available.notes}</p>}{ready?<><p className="muted">{status.platform==='android'?'Android запросит подтверждение установки.':'Приложение закроется для установки и перезапустится. Черновик будет сохранён.'}</p><button className="primary" disabled={busy} onClick={()=>{void install()}}>{status.platform==='android'?'Установить':'Установить и перезапустить'}</button></>:<button className="primary" disabled={busy} onClick={()=>{void download()}}><Download size={16}/>{busy?`Скачиваем… ${progress}`:'Скачать обновление'}</button>}</div>}{message&&<p className="muted" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
