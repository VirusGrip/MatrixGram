// Matrix 1:1 VoIP signalling (v1), with actual WebRTC media. No SFU/server setup.
import type { MatrixEvent } from './models';
export interface CallState { id: string; roomId: string; direction: 'incoming' | 'outgoing'; status: string; video: boolean; local?: MediaStream; remote?: MediaStream; started?: number; error?: string }
export interface CallTransport { send: (roomId: string, type: string, content: Record<string, unknown>) => Promise<unknown>; ice: () => Promise<RTCIceServer[]>; changed: (state: CallState | null) => void; party: string; userId?: string; permissions?: (video: boolean) => Promise<boolean>; acceptInvite?: (roomId: string, sender: string) => Promise<boolean> }
export class CallEngine {
  state: CallState | null = null;
  private pc?: RTCPeerConnection;
  private offer?: RTCSessionDescriptionInit;
  private remoteParty?: string;
  private remoteSender?: string;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private seen = new Set<string>();
  private ended = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private signalReady = false;
  private screen?: MediaStreamTrack;
  private disposed = false;
  private localCandidates: RTCIceCandidateInit[] = [];
  private queue = Promise.resolve();
  constructor(private transport: CallTransport) {}
  private update(value: Partial<CallState>) { if (this.state) { this.state = { ...this.state, ...value }; this.transport.changed(this.state); } }
  private signal(type: string, extra: Record<string, unknown> = {}) { if (!this.state) return Promise.resolve(); return this.transport.send(this.state.roomId, type, { call_id: this.state.id, party_id: this.transport.party, version: '1', ...extra }); }
  private timeout(ms = 60_000) { const id=this.state?.id; clearTimeout(this.timer); this.timer = setTimeout(() => { if (this.state?.id === id) void this.hangup('invite_timeout'); }, ms); }
  private async media(video: boolean, id: string) {
    if (this.transport.permissions && !await this.transport.permissions(video)) throw new Error('Разрешение микрофона или камеры не предоставлено');
    if (this.state?.id !== id) throw new Error('Звонок завершён');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    if (this.state?.id !== id) { stream.getTracks().forEach(track => track.stop()); throw new Error('Звонок завершён'); }
    this.update({ local: stream }); return stream;
  }
  private current(pc: RTCPeerConnection) { return pc === this.pc && !this.disposed; }
  private async peer(stream: MediaStream, id: string) {
    const iceServers = await this.transport.ice();
    if (this.state?.id !== id) throw new Error('Звонок завершён');
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 0 }); this.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const remote = new MediaStream(); this.update({ remote });
    pc.ontrack = event => { if (!this.current(pc)) return; if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track); this.update({ remote }); };
    pc.onicecandidate = event => {
      if (!this.current(pc)) return;
      const value = event.candidate ? event.candidate.toJSON() : { candidate: '' };
      if (this.signalReady) void this.signal('m.call.candidates', { candidates: [value] }).catch(error => { if (this.current(pc)) this.fail(error); }); else this.localCandidates.push(value);
    };
    pc.onconnectionstatechange = () => {
      if (!this.current(pc)) return;
      if (pc.connectionState === 'connected') { clearTimeout(this.timer); this.update({ status: 'На связи', started: this.state?.started || Date.now() }); }
      if (pc.connectionState === 'failed') void this.hangup('ice_failed');
      if (pc.connectionState === 'disconnected') this.timeout(15_000);
    };
    return pc;
  }
  private async flushLocal(id: string) { if (this.state?.id !== id) return; this.signalReady = true; if (this.localCandidates.length) { const candidates = this.localCandidates.splice(0); await this.signal('m.call.candidates', { candidates }); } }
  private async flushRemote() { const pc=this.pc; if (pc?.remoteDescription) for (const candidate of this.pendingCandidates.splice(0)) { if (!this.current(pc)) return; await pc.addIceCandidate(candidate); } }
  private fail(error: unknown) { const text = error instanceof Error ? error.message : String(error); void this.hangup('user_media_failed', text); }
  async start(roomId: string, video = false) {
    if (this.disposed) throw new Error('Сессия звонка завершена');
    if (this.state) throw new Error('Сначала завершите текущий звонок');
    this.state = { id: crypto.randomUUID(), roomId, direction: 'outgoing', status: 'Доступ к микрофону…', video }; this.transport.changed(this.state);
    const id = this.state.id;
    try {
      const stream = await this.media(video, id), pc = await this.peer(stream, id);
      await pc.setLocalDescription(await pc.createOffer());
      if (!this.current(pc)) return;
      await this.signal('m.call.invite', { offer: { type: 'offer', sdp: pc.localDescription!.sdp }, lifetime: 60_000, sdp_stream_metadata: { [stream.id]: { purpose: 'm.usermedia', audio_muted: false, video_muted: !video } } });
      await this.flushLocal(id); if (!this.current(pc)) return; this.update({ status: 'Вызов…' }); this.timeout();
    } catch (error) { if (this.state?.id === id) this.fail(error); }
  }
  async answer() {
    if (!this.state || !this.offer || this.state.direction !== 'incoming' || this.pc) return;
    const id = this.state.id;
    try {
      this.update({ status: 'Соединяем…' });
      const stream = await this.media(this.state.video, id), pc = await this.peer(stream, id);
      if (!this.current(pc)) return;
      await pc.setRemoteDescription(this.offer); if (!this.current(pc)) return; await this.flushRemote();
      if (!this.current(pc)) return;
      await pc.setLocalDescription(await pc.createAnswer());
      if (!this.current(pc)) return;
      await this.signal('m.call.answer', { answer: { type: 'answer', sdp: pc.localDescription!.sdp }, sdp_stream_metadata: { [stream.id]: { purpose: 'm.usermedia', audio_muted: false, video_muted: !this.state.video } } });
      await this.flushLocal(id); if (this.current(pc)) this.timeout(30_000);
    } catch (error) { if (this.state?.id === id) this.fail(error); }
  }
  receive(roomId: string, event: MatrixEvent) {
    if (this.disposed || !event.type.startsWith('m.call.') || this.seen.has(event.event_id)) return;
    this.seen.add(event.event_id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    this.queue = this.queue.then(() => this.process(roomId, event)).catch(error => { if (!this.disposed && this.state?.id === event.content.call_id) this.fail(error); });
  }
  private async process(roomId: string, event: MatrixEvent) {
    const c = event.content, id = typeof c.call_id === 'string' ? c.call_id : '';
    if (this.disposed || !id || c.party_id === this.transport.party || this.ended.has(id)) return;
    if (event.type === 'm.call.invite') {
      const offer = c.offer as RTCSessionDescriptionInit | undefined;
      if (event.sender === this.transport.userId || c.invitee && c.invitee !== this.transport.userId || !offer?.sdp || offer.type !== 'offer' || c.version !== '1' || !c.party_id || !Number.isFinite(Number(c.lifetime)) || Number(c.lifetime) <= 0 || Date.now() - event.origin_server_ts > Math.min(Number(c.lifetime), 120_000)) return;
      if (this.transport.acceptInvite && !await this.transport.acceptInvite(roomId, event.sender)) return;
      if (this.disposed) return;
      if (this.state) {
        // Resolve simultaneous calls deterministically as specified by Matrix.
        if (this.state.direction === 'outgoing' && roomId === this.state.roomId && id < this.state.id) { await this.hangup('replaced'); if (this.disposed || this.state) return; }
        else { await this.transport.send(roomId, 'm.call.reject', { call_id: id, party_id: this.transport.party, version: '1', reason: 'user_busy' }); return; }
      }
      this.remoteParty = String(c.party_id || ''); this.remoteSender = event.sender; this.offer = offer;
      this.pendingCandidates = this.earlyCandidates.get(id) ?? []; this.earlyCandidates.delete(id);
      this.state = { id, roomId, direction: 'incoming', status: 'Входящий звонок', video: /m=video\s/.test(offer.sdp) }; this.transport.changed(this.state); this.timeout(Math.max(1000, Number(c.lifetime) - (Date.now() - event.origin_server_ts)));
      return;
    }
    if (!this.state || id !== this.state.id || roomId !== this.state.roomId) {
      if (event.type === 'm.call.hangup' || event.type === 'm.call.reject') { this.rememberEnded(id); return; }
      if (event.type === 'm.call.candidates' && Date.now() - event.origin_server_ts < 120_000 && this.earlyCandidates.size < 20) this.earlyCandidates.set(id, [...(this.earlyCandidates.get(id) ?? []), ...(Array.isArray(c.candidates) ? c.candidates.slice(0, 50) : [])].slice(-100) as RTCIceCandidateInit[]);
      return;
    }
    if (this.remoteSender && event.sender !== this.remoteSender) return;
    if (this.remoteParty && c.party_id && c.party_id !== this.remoteParty) return;
    if (event.type === 'm.call.answer' && this.state.direction === 'outgoing' && this.pc && !this.pc.remoteDescription) {
      const pc=this.pc;
      this.remoteParty = String(c.party_id || ''); this.remoteSender = event.sender;
      await pc.setRemoteDescription(c.answer as RTCSessionDescriptionInit); if (!this.current(pc)) return; await this.flushRemote(); if (!this.current(pc)) return;
      await this.signal('m.call.select_answer', { selected_party_id: this.remoteParty }); if (!this.current(pc)) return; this.update({ status: 'Соединяем…' }); this.timeout(30_000);
    } else if (event.type === 'm.call.select_answer' && this.state.direction === 'incoming' && c.selected_party_id !== this.transport.party) this.cleanup();
    else if (event.type === 'm.call.candidates' && (!this.remoteParty || c.party_id === this.remoteParty)) {
      if (Array.isArray(c.candidates)) this.pendingCandidates.push(...c.candidates.slice(0, 50) as RTCIceCandidateInit[]); await this.flushRemote();
    } else if (event.type === 'm.call.hangup' || event.type === 'm.call.reject') this.cleanup();
    else if (event.type === 'm.call.negotiate' && this.pc) {
      const pc=this.pc, description = c.description as RTCSessionDescriptionInit; await pc.setRemoteDescription(description); if (!this.current(pc)) return;
      if (description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); if (this.current(pc)) await this.signal('m.call.negotiate', { lifetime: 30_000, description: pc.localDescription?.toJSON() }); }
    }
  }
  async hangup(reason = 'user_hangup', error?: string) {
    if (!this.state) return;
    const sent = this.signal(this.state.direction === 'incoming' && !this.pc ? 'm.call.reject' : 'm.call.hangup', { reason });
    this.cleanup();
    try { await sent; } catch { /* Local tracks stop immediately even when signalling is unavailable. */ }
    if (error && !this.disposed && !this.state) this.transport.changed({ id: '', roomId: '', direction: 'outgoing', status: 'Не удалось позвонить', video: false, error });
  }
  async changeDevice(kind: 'audio' | 'video', deviceId: string) {
    if (!this.pc || !this.state?.local) return;
    const pc = this.pc, state = this.state;
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: { deviceId: { exact: deviceId } } } : { video: { deviceId: { exact: deviceId } } });
    if (!this.current(pc) || this.state?.id !== state.id) { stream.getTracks().forEach(track => track.stop()); return; }
    const track = stream.getTracks()[0], sender = pc.getSenders().find(sender => sender.track?.kind === kind);
    if (!sender) { stream.getTracks().forEach(track => track.stop()); return; }
    const old = sender.track; track.enabled = old?.enabled ?? true;
    try { await sender.replaceTrack(track); } catch (error) { track.stop(); throw error; }
    if (!this.current(pc) || this.state?.id !== state.id) { track.stop(); return; }
    if (old) { old.stop(); state.local!.removeTrack(old); } state.local!.addTrack(track); this.update({ local: state.local });
  }
  mute(kind: 'audio' | 'video', muted: boolean) { this.state?.local?.getTracks().filter(track => track.kind === kind).forEach(track => { track.enabled = !muted; }); }
  async screenshare() {
    if (!this.pc || !this.state) return;
    if (this.screen?.readyState === 'live') throw new Error('Экран уже транслируется. Остановите показ через системную панель.');
    const pc = this.pc, state = this.state;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true }); const track = stream.getVideoTracks()[0];
    if (!this.current(pc) || this.state?.id !== state.id) { stream.getTracks().forEach(track => track.stop()); return; }
    const sender = pc.getSenders().find(sender => sender.track?.kind === 'video');
    if (!sender) { track.stop(); throw new Error('Демонстрация экрана доступна в видеозвонке'); }
    const camera = sender.track;
    try { await sender.replaceTrack(track); } catch (error) { track.stop(); throw error; }
    if (!this.current(pc) || this.state?.id !== state.id) { track.stop(); return; }
    this.screen = track;
    track.onended = () => { this.screen = undefined; state.local?.removeTrack(track); if (this.current(pc)) void sender.replaceTrack(camera).catch(error => this.fail(error)); }; state.local?.addTrack(track);
  }
  private rememberEnded(id: string) { this.ended.add(id); if (this.ended.size > 500) this.ended.delete(this.ended.values().next().value!); }
  private cleanup() {
    clearTimeout(this.timer); if (this.state) this.rememberEnded(this.state.id);
    this.screen?.stop(); this.screen = undefined;
    this.state?.local?.getTracks().forEach(track => track.stop()); this.pc?.close(); this.pc = undefined;
    this.state = null; this.offer = undefined; this.remoteParty = undefined; this.remoteSender = undefined; this.pendingCandidates = []; this.localCandidates = []; this.signalReady = false; this.transport.changed(null);
  }
  dispose() { this.disposed = true; this.cleanup(); this.seen.clear(); this.earlyCandidates.clear(); }
}
