import { create } from 'zustand';
import { api } from './api';
export interface UpdateStatus { currentVersion:string; configured:boolean; platform:string; repository:string; available:{version:string;notes:string}|null }
interface Updates { status: UpdateStatus|null; busy:boolean; error:string; message:string; ready:boolean; progress:string; open:boolean }
export const useUpdates = create<Updates>(()=>({status:null,busy:false,error:'',message:'',ready:false,progress:'',open:false}));
let lastAttempt = -Infinity;
export async function initializeUpdates() {
  if (useUpdates.getState().status) return;
  const status = await api.updateStatus();
  if (!useUpdates.getState().status) useUpdates.setState({status});
}
export async function checkUpdates(automatic = false) {
  const state = useUpdates.getState();
  if (state.busy || state.ready || automatic && Date.now() - lastAttempt < 4*60*60*1000) return;
  lastAttempt = Date.now(); useUpdates.setState({busy:true,error:'',message:''});
  try {
    const status = await api.checkUpdate();
    useUpdates.setState({status,message:!automatic && status.configured && !status.available?'Установлена актуальная версия':''});
    if (automatic && status.available) {
      const key = `matrixgram.updateNotice.${status.currentVersion}`;
      let seen = ''; try { seen = localStorage.getItem(key) || ''; } catch { /* In-app notice remains available. */ }
      if (seen !== status.available.version && localStorage.getItem('matrixgram.notifications') !== 'off') {
        await api.notify('Обновление MatrixGram',`Доступна версия ${status.available.version}. Нажмите, чтобы обновить.`,{kind:'updates'}).catch(()=>{});
        try { localStorage.setItem(key,status.available.version); } catch { /* No storage in private mode. */ }
      }
    }
  } catch (error) { useUpdates.setState({error:String(error)}); }
  finally { useUpdates.setState({busy:false}); }
}
