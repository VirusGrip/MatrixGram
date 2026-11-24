import {useEffect,useState} from 'react';
import {Pin,ChevronDown} from 'lucide-react';
import {api} from './api';
import {useStore} from './store';
import {cachedTimeline} from './timelineCache';
import {projectTimeline} from './timeline';
import type {MatrixEvent} from './models';
export function PinnedBar({roomId,locate}:{roomId:string;locate:(id:string,event?:MatrixEvent)=>void}){
  const session=useStore(s=>s.session),events=useStore(s=>s.events[roomId]),connection=useStore(s=>s.connection);
  const [ids,setIds]=useState<string[]>([]),[index,setIndex]=useState(0),[preview,setPreview]=useState<MatrixEvent>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const state=events?.filter(e=>e.type==='m.room.pinned_events').at(-1);
  const signature=state?JSON.stringify([state.event_id,state.content.pinned]):'';
  useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail===roomId)setRevision(r=>r+1);};window.addEventListener('matrixgram-pins',changed);return()=>window.removeEventListener('matrixgram-pins',changed);},[roomId]);
  useEffect(()=>{let alive=true;if(state&&Array.isArray(state.content.pinned))setIds(state.content.pinned.filter((id):id is string=>typeof id==='string').slice(0,100));if(connection==='online')void api.op<string[]>('pinned',{roomId}).then(value=>{if(alive&&useStore.getState().session===session&&Array.isArray(value)){setIds(value.slice(0,100));setError('');}}).catch(()=>{});return()=>{alive=false;};},[roomId,session,connection,signature,revision]);
  const id=ids[index%Math.max(1,ids.length)],known=events?cachedTimeline(events).find(m=>m.id===id):undefined;
  useEffect(()=>{setPreview(undefined);setError('');let alive=true;if(id&&!known)void api.op<MatrixEvent>('event',{roomId,eventId:id}).then(event=>{if(alive&&useStore.getState().session===session)setPreview(event);}).catch(()=>{if(alive)setError('Сообщение недоступно');});return()=>{alive=false;};},[roomId,id,!!known,session]);
  if(!id)return null;
  const message=known??(preview?projectTimeline([preview])[0]:undefined);
  return <div className="pinned-bar" aria-label="Закреплённые сообщения"><button className="pinned-link" onClick={()=>locate(id,preview)}><Pin size={21}/><span><strong>Закреплённое сообщение{ids.length>1?` · ${index%ids.length+1}/${ids.length}`:''}</strong><small>{message?.body??(error||'Загружаем сообщение…')}</small></span></button>{ids.length>1&&<button className="icon-button" aria-label="Следующий закреп" onClick={()=>setIndex(i=>i+1)}><ChevronDown size={20}/></button>}</div>;
}
