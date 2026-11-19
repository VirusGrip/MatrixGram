import {useEffect,useMemo,useState} from 'react';
import {create} from 'zustand';
import {api} from './api';
import {useStore} from './store';
import {mergeEvents} from './timeline';
import {pollResult} from './polls';
import type {MatrixEvent,Message} from './models';
interface Page {events:MatrixEvent[];next:string|null;authorizedEnds:string[];missingKeys:boolean;canVote:boolean}
interface Status {loaded:boolean;loading:boolean;next:string|null;ends:string[];missing:boolean;canVote:boolean;error?:string}
const usePollPages=create<{pages:Record<string,Status>}>(()=>({pages:{}}));
export function PollService(){const session=useStore(s=>s.session);useEffect(()=>{usePollPages.setState({pages:{}});},[session]);return null;}
async function load(roomId:string,id:string,more=false){
  const session=useStore.getState().session;if(!session)return;
  const key=roomId+'|'+id,old=usePollPages.getState().pages[key];if(old?.loading)return;
  const update=(patch:Partial<Status>)=>{if(useStore.getState().session===session)usePollPages.setState(s=>({pages:{...s.pages,[key]:{...(s.pages[key]??{loaded:false,loading:false,next:null,ends:[],missing:false,canVote:false}),...patch}}}));};
  update({loading:true,error:undefined});
  try{
    const page=await api.op<Page>('pollPage',{roomId,eventId:id,from:more?old?.next:null});
    if(useStore.getState().session!==session)return;
    useStore.setState(s=>({events:{...s.events,[roomId]:mergeEvents(s.events[roomId]??[],page.events)}}));
    update({loaded:true,loading:false,next:page.next,ends:[...new Set([...(more?old?.ends??[]:[]),...page.authorizedEnds])],missing:page.missingKeys||(more&&!!old?.missing),canVote:page.canVote});
  }catch(e){update({loading:false,error:String(e)});}
}
export function PollView({roomId,message}:{roomId:string;message:Message}){
  const session=useStore(s=>s.session)!,events=useStore(s=>s.events[roomId])??[],connection=useStore(s=>s.connection);
  const state=usePollPages(s=>s.pages[roomId+'|'+message.id]);
  const [selection,setSelection]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [retry,setRetry]=useState<{answers:string[];txn:string}|null>(null);
  const poll=message.poll!;
  const result=useMemo(()=>pollResult(message.id,message.sender,poll,events,session.userId,state?.ends??[]),[message.id,message.sender,poll,events,session.userId,state?.ends]);
  const endSignature=events.filter(e=>e.type.endsWith('poll.end')&&(e.content['m.relates_to'] as Record<string,unknown>|undefined)?.event_id===message.id).map(e=>e.event_id).join('|');
  useEffect(()=>{if(connection==='online')void load(roomId,message.id);},[roomId,message.id,session,connection,endSignature]);
  useEffect(()=>{setSelection(result.mine);},[result.mine.join('\0'),poll.revision]);
  const disabled=busy||result.closed||!state?.loaded||state.loading||!!state.next||!state.canVote||connection!=='online';
  async function vote(answers:string[]){
    setBusy(true);setError('');const txn=retry&&JSON.stringify(retry.answers)===JSON.stringify(answers)?retry.txn:crypto.randomUUID();
    try{
      await api.op<string>('pollVote',{roomId,eventId:message.id,answers,txn,revision:poll.revision});
      if(useStore.getState().session!==session)return;
      setRetry(null);await load(roomId,message.id);
    }catch(e){if(useStore.getState().session===session){setError(String(e));setRetry({answers,txn});}}finally{setBusy(false);}
  }
  return <section className="poll-card" aria-label={`Опрос: ${poll.question}`}>
    <strong className="poll-question">{poll.question}</strong><small>{result.closed?'Опрос завершён':poll.max>1?`Выберите до ${poll.max} вариантов`:'Выберите один вариант'}</small>
    <fieldset disabled={disabled}>{poll.answers.map(answer=>{const count=result.counts.get(answer.id)??0;return <label className="poll-answer" key={answer.id}><input type={poll.max===1?'radio':'checkbox'} name={`poll-${message.id}`} checked={selection.includes(answer.id)} onChange={()=>setSelection(current=>poll.max===1?[answer.id]:current.includes(answer.id)?current.filter(id=>id!==answer.id):current.length<poll.max?[...current,answer.id]:current)}/><span>{answer.text}</span>{result.showResults&&<small>{result.total?Math.round(count/result.total*100):0}% · {count}</small>}</label>;})}</fieldset>
    {result.showResults?<small>{result.total} проголосовало{state?.next?' · загружены не все голоса':''}</small>:<small>Результаты появятся после завершения</small>}
    {state?.missing&&<small>Не все голоса расшифрованы</small>}
    {state?.next&&<button type="button" className="text-button" disabled={state.loading} onClick={()=>void load(roomId,message.id,true)}>Загрузить ещё голоса</button>}
    {!result.closed&&<div className="poll-controls"><button type="button" className="text-button" disabled={disabled||!selection.length} onClick={()=>void vote(selection)}>{busy?'Отправляем…':result.hasVoted?'Изменить голос':'Голосовать'}</button>{result.mine.length>0&&<button type="button" className="text-button" disabled={disabled} onClick={()=>void vote([])}>Отозвать голос</button>}</div>}
    {(error||state?.error)&&<div role="alert" className="form-error">{error||state?.error}<button type="button" className="text-button" onClick={()=>void load(roomId,message.id)}>Обновить опрос</button></div>}
    {state?.loading&&<small role="status">Загружаем голоса…</small>}
  </section>;
}
