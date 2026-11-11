import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Mic, MicOff, Phone, PhoneOff, MonitorUp, Video, VideoOff, X } from 'lucide-react';
import { api } from './api';
import { CallEngine, type CallState } from './callEngine';
import { useStore } from './store';
import { roomTitle } from './contacts';
import { errorText } from './ui';
import type { RoomDetails, RoomSummary } from './models';

const useCalls = create<{ state: CallState | null; engine: CallEngine | null }>(() => ({ state: null, engine: null }));
function StreamVideo({ stream, muted = false }: { stream?: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream || null; void ref.current.play().catch(() => {}); } }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted}/>;
}
export function CallService() {
  const names = useStore(s => s.contactNames);
  const session = useStore(s => s.session), events = useStore(s => s.events), rooms = useStore(s => s.rooms);
  const call = useCalls(s => s.state), engine = useCalls(s => s.engine);
  const [muted, setMuted] = useState(false), [cameraOff, setCameraOff] = useState(false), [now, setNow] = useState(Date.now()), [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!session) return;
    const instance = new CallEngine({ party: session.deviceId, userId: session.userId, acceptInvite: async (roomId, sender) => { const details = await api.op<RoomDetails>('roomDetails', { roomId }); const joined = details.members.filter(member => member.membership === 'join'); return joined.length === 2 && joined.some(member => member.userId === sender); }, permissions: video => api.mediaPermissions(video), send: (roomId, eventType, content) => api.op('call', { roomId, eventType, content }), ice: async () => { const turn = await api.op<{ urls: string[]; username: string; credential: string }>('turn'); return [{ urls: turn.urls, username: turn.username, credential: turn.credential }]; }, changed: state => { useCalls.setState({ state }); if (state?.direction === 'incoming' && state.status === 'Входящий звонок' && !document.hasFocus()) void api.notify('Входящий звонок', 'Откройте MatrixGram, чтобы ответить').catch(() => {}); } });
    useCalls.setState({ engine: instance });
    return () => { instance.dispose(); useCalls.setState({ engine: null, state: null }); };
  }, [session]);
  useEffect(() => { if (engine) for (const [id, timeline] of Object.entries(events)) { const room = rooms.find(room => room.id === id); if (room?.membership === 'joined' && room.members <= 2) for (const event of timeline) engine.receive(id, event); } }, [events, rooms, engine]);
  useEffect(() => { setMuted(false); setCameraOff(false); }, [call?.id]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (call?.local) void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {}); }, [call?.local]);
  useEffect(() => { if (remoteAudio.current) { remoteAudio.current.srcObject = call?.remote || null; void remoteAudio.current.play().catch(() => {}); } }, [call?.remote]);
  if (!call) return null;
  const room = rooms.find(room => room.id === call.roomId);
  const elapsed = call.started ? Math.max(0, Math.floor((now - call.started) / 1000)) : 0;
  return <section className="call-overlay" role="dialog" aria-label="Звонок"><header><span>{room ? roomTitle(room, names) : 'MatrixGram'}</span>{call.error && <button className="icon-button" aria-label="Закрыть звонок" onClick={() => useCalls.setState({ state: null })}><X size={20}/></button>}</header><h2>{call.status}</h2>{call.started && <p>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>}{call.error && <p role="alert">{call.error}</p>}
    {call.video && <div className="call-videos"><StreamVideo stream={call.remote} muted/><div className="local-video"><StreamVideo stream={call.local} muted/></div></div>}
    <audio ref={remoteAudio} autoPlay/>
    <div className="call-controls">{call.direction === 'incoming' && !call.local && <button className="answer-call" aria-label="Ответить на звонок" onClick={() => { void engine?.answer(); }}><Phone size={23}/></button>}{call.local && <><button aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={() => { engine?.mute('audio', !muted); setMuted(!muted); }}>{muted ? <MicOff/> : <Mic/>}</button>{call.video && <><button aria-label={cameraOff ? 'Включить камеру' : 'Выключить камеру'} onClick={() => { engine?.mute('video', !cameraOff); setCameraOff(!cameraOff); }}>{cameraOff ? <VideoOff/> : <Video/>}</button>{typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <button aria-label="Показать экран" onClick={() => { void engine?.screenshare().catch(e => useStore.getState().setError(e)); }}><MonitorUp/></button>}</>}</>}{!call.error && <button className="end-call" aria-label="Завершить звонок" onClick={() => { void engine?.hangup(); }}><PhoneOff size={24}/></button>}</div>
    {call.local && <div className="call-devices"><label>Микрофон<select onChange={async e => { try { await engine?.changeDevice('audio', e.target.value); } catch (e) { useStore.getState().setError(e); } }}>{devices.filter(device => device.kind === 'audioinput').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Микрофон'}</option>)}</select></label>{call.video && <label>Камера<select onChange={async e => { try { await engine?.changeDevice('video', e.target.value); } catch (e) { useStore.getState().setError(e); } }}>{devices.filter(device => device.kind === 'videoinput').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Камера'}</option>)}</select></label>}{'setSinkId' in HTMLMediaElement.prototype && <label>Динамики<select onChange={async e => { try { const audio = remoteAudio.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }; if (!audio?.setSinkId) throw new Error('Выбор динамика недоступен в этом WebView'); await audio.setSinkId(e.target.value); } catch (e) { useStore.getState().setError(e); } }}>{devices.filter(device => device.kind === 'audiooutput').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Динамики'}</option>)}</select></label>}</div>}
  </section>;
}

export function CallButtons({ room }: { room: RoomSummary }) {
  const [allowed, setAllowed] = useState(false), engine = useCalls(s => s.engine);
  useEffect(() => { let stale = false; setAllowed(false); if (room.members <= 2 && room.membership === 'joined') void api.op<RoomDetails>('roomDetails', { roomId: room.id }).then(details => { if (!stale) setAllowed(details.members.filter(member => member.membership === 'join').length === 2); }).catch(() => {}); return () => { stale = true; }; }, [room.id, room.members, room.membership]);
  if (!allowed || !engine) return null;
  const start = (video: boolean) => { void engine.start(room.id, video).catch(e => useStore.getState().setError(errorText(e))); };
  return <><button className="icon-button" aria-label="Позвонить" onClick={() => start(false)}><Phone size={20}/></button><button className="icon-button" aria-label="Видеозвонок" onClick={() => start(true)}><Video size={21}/></button></>;
}
