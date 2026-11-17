import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface MemoryReport {
  supported:boolean; sampledAtMs:number; totalPrivateBytes:number|null; unavailable:number;
  processes:{pid:number;name:string;isMain:boolean;privateBytes:number|null}[];
}
const amount = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
export const memoryMiB = (bytes:number) => amount.format(bytes/1024/1024);

export function MemoryPanel() {
  const [report,setReport]=useState<MemoryReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{
    let disposed=false,inFlight=false,supported=true,timer:number|undefined;
    async function sample() {
      if(disposed||inFlight||document.hidden||!supported)return;
      window.clearTimeout(timer);inFlight=true;setBusy(true);
      try {
        const value=await api.memoryUsage();
        if(disposed)return;
        supported=value.supported;setReport(value);setError('');
      } catch(e) {
        if(!disposed){setReport(null);setError(String(e));}
      } finally {
        inFlight=false;
        if(!disposed){setBusy(false);if(supported&&!document.hidden)timer=window.setTimeout(()=>{void sample()},5000);}
      }
    }
    const visible=()=>{window.clearTimeout(timer);if(!document.hidden)void sample()};
    refresh.current=()=>{void sample()};void sample();
    document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;window.clearTimeout(timer);document.removeEventListener('visibilitychange',visible);refresh.current=()=>{}};
  },[]);
  if(report&&!report.supported)return null;
  return <section className="settings-section memory-panel" aria-label="Память приложения">
    <h3>Память приложения</h3>
    {report&&<><p className="memory-total"><strong>{report.totalPrivateBytes===null?'—':memoryMiB(report.totalPrivateBytes)}</strong><span>МиБ ОЗУ{report.unavailable>0?' · измерено частично':''}</span></p>
      <p className="muted">MatrixGram и его вспомогательные процессы: {report.processes.length}.</p>
      {report.unavailable>0&&<p className="memory-warning">Для {report.unavailable} процессов Windows не вернула данные. Их память в сумму не включена.</p>}
      <details><summary>По процессам</summary><div className="memory-table-wrap"><table><thead><tr><th>Процесс</th><th>PID</th><th>ОЗУ, МиБ</th></tr></thead><tbody>{report.processes.map(process=><tr key={process.pid}><td>{process.isMain?'MatrixGram':process.name}</td><td>{process.pid}</td><td>{process.privateBytes===null?'Недоступно':memoryMiB(process.privateBytes)}</td></tr>)}</tbody></table></div></details>
      <p className="muted memory-time">Замер: {new Date(report.sampledAtMs).toLocaleTimeString('ru-RU')}. Обновляется раз в 5 секунд, пока открыт этот раздел.</p>
      <p className="muted">Показана частная оперативная память всех процессов, включая WebView2. Общая видеопамять сюда не входит.</p>
    </>}
    {!report&&!error&&<p className="muted">Измеряем память…</p>}
    {error&&<p className="form-error" role="alert">Не удалось измерить память: {error}</p>}
    <button className="text-button" disabled={busy} onClick={()=>refresh.current()}>{busy?'Измеряем…':'Обновить замер'}</button>
  </section>;
}
