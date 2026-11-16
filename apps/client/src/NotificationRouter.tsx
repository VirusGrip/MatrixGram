import { useEffect, useState } from 'react';
import { api, nativeAvailable, onNotification, type NotificationActivation } from './api';
import { useStore } from './store';
import { useUpdates } from './UpdateService';
export function NotificationRouter() {
  const [pending,setPending] = useState<NotificationActivation|null>(null);
  const session = useStore(s=>s.session), rooms = useStore(s=>s.rooms);
  useEffect(()=>{
    if (!nativeAvailable()) return;
    let alive = true;
    const listener = onNotification(value=>{if(alive)setPending(value)});
    void listener.then(()=>api.pendingNotification()).then(value=>{if(alive&&value)setPending(current=>current??value)}).catch(()=>{});
    return()=>{alive=false;void listener.then(off=>off()).catch(()=>{})};
  },[]);
  useEffect(()=>{
    if (!pending) return;
    if (pending.target.kind === 'updates') useUpdates.setState({open:true});
    else {
      const target = pending.target;
      if (!session || target.sessionKey !== `${session.userId}|${session.deviceId}` || !rooms.some(room=>room.id===target.roomId)) return;
      useStore.getState().select(target.roomId);
    }
    void api.acknowledgeNotification(pending.id).catch(()=>{});
    setPending(current=>current?.id===pending.id?null:current);
  },[pending,session,rooms]);
  if (!pending || pending.target.kind !== 'room' || session && pending.target.sessionKey === `${session.userId}|${session.deviceId}`) return null;
  return <div className="notification-account" role="status">Уведомление для {pending.target.sessionKey.split('|')[0]}. Войдите в этот аккаунт, чтобы открыть чат.<button className="text-button" onClick={()=>{void api.acknowledgeNotification(pending.id).catch(()=>{});setPending(null)}}>Скрыть</button></div>;
}
