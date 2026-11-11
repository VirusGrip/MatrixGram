import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api, onAppUpdateProgress } from './api';
import { errorText } from './ui';
import { useUploads } from './Transfers';
import { activeCall } from './Calls';
import { prepareForUpdate } from './UpdatePreparation';
export interface UpdateStatus {currentVersion:string;configured:boolean;platform:string;repository:string;available:{version:string;notes:string}|null}
export function UpdatesPanel() {
  const [status,setStatus]=useState<UpdateStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[progress,setProgress]=useState('');
  useEffect(()=>{let mounted=true;void api.updateStatus().then(value=>{if(mounted)setStatus(value)}).catch(e=>{if(mounted)setError(errorText(e))});const listener=onAppUpdateProgress(value=>{if(!mounted)return;if(value.phase==='downloading')setProgress(value.total?`${Math.min(100,Math.floor(value.downloaded/value.total*100))}%`:`${Math.floor(value.downloaded/1024/1024)} МБ`)});return()=>{mounted=false;void listener.then(off=>off()).catch(()=>{})}},[]);
  async function check() {setBusy(true);setError('');setMessage('');setReady(false);try{const value=await api.checkUpdate();setStatus(value);if(value.configured&&!value.available)setMessage('Установлена актуальная версия')}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  async function download() {setBusy(true);setError('');setProgress('0%');try{await api.downloadUpdate();setReady(true);setMessage('Обновление скачано и проверено')}catch(e){setError(errorText(e));setReady(false)}finally{setBusy(false);setProgress('')}}
  async function install() {
    if(activeCall()){setError('Завершите звонок перед установкой обновления');return}
    if(useUploads.getState().tasks.some(task=>task.state==='queued'||task.state==='uploading')){setError('Дождитесь отправки файлов или отмените их перед обновлением');return}
    setBusy(true);setError('');
    try{await prepareForUpdate();const result=await api.installUpdate();setMessage(result==='permission'?'Разрешите установку обновлений для MatrixGram в настройках Android, вернитесь и нажмите «Установить» ещё раз.':'Открыт системный установщик. Подтвердите обновление.')}catch(e){setError(errorText(e));setReady(false)}finally{setBusy(false)}
  }
  return <section className="settings-section app-updates"><h3>Обновления MatrixGram</h3>{status&&<p className="muted">Текущая версия: {status.currentVersion}</p>}{status&&!status.configured?<p className="muted">Канал обновлений ещё не подключён.</p>:<button className="text-button" disabled={!status||busy} onClick={()=>{void check()}}><RefreshCw size={16}/>{busy&&!status?.available?'Проверяем…':'Проверить обновления'}</button>}{status?.available&&<div><p>Доступна версия <strong>{status.available.version}</strong></p>{status.available.notes&&<p className="update-notes">{status.available.notes}</p>}{ready?<><p className="muted">{status.platform==='android'?'Android запросит подтверждение установки.':'Приложение закроется для установки и перезапустится. Черновик будет сохранён.'}</p><button className="primary" disabled={busy} onClick={()=>{void install()}}>{status.platform==='android'?'Установить':'Установить и перезапустить'}</button></>:<button className="primary" disabled={busy} onClick={()=>{void download()}}><Download size={16}/>{busy?`Скачиваем… ${progress}`:'Скачать обновление'}</button>}</div>}{message&&<p className="muted" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
