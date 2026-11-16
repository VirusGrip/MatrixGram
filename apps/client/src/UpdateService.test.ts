import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({api:{updateStatus:vi.fn(),checkUpdate:vi.fn(),notify:vi.fn()}}));
import { api } from './api';
const status={currentVersion:'0.5.3',configured:true,platform:'windows',repository:'VirusGrip/MatrixGram',available:{version:'0.5.4',notes:'Fixes'}};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.spyOn(Date,'now').mockReturnValue(1000);const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.mocked(api.checkUpdate).mockResolvedValue(status);vi.mocked(api.notify).mockResolvedValue(undefined)});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
it('checks automatically once per interval and announces a version only once',async()=>{
  const {checkUpdates,useUpdates}=await import('./UpdateService');
  await checkUpdates(true);await checkUpdates(true);
  expect(api.checkUpdate).toHaveBeenCalledTimes(1);expect(useUpdates.getState().status?.available?.version).toBe('0.5.4');
  expect(api.notify).toHaveBeenCalledWith('Обновление MatrixGram',expect.stringContaining('0.5.4'),{kind:'updates'});
  vi.spyOn(Date,'now').mockReturnValue(5*60*60*1000);await checkUpdates(true);
  expect(api.checkUpdate).toHaveBeenCalledTimes(2);expect(api.notify).toHaveBeenCalledTimes(1);
});
it('does not replace the verified download or race an active operation',async()=>{
  const {checkUpdates,useUpdates}=await import('./UpdateService');
  useUpdates.setState({ready:true,status});await checkUpdates();expect(api.checkUpdate).not.toHaveBeenCalled();
  useUpdates.setState({ready:false,busy:true});await checkUpdates(true);expect(api.checkUpdate).not.toHaveBeenCalled();
});
it('a network error permits a manual retry without a false version notification',async()=>{
  const {checkUpdates,useUpdates}=await import('./UpdateService');
  vi.mocked(api.checkUpdate).mockRejectedValueOnce(new Error('offline'));await checkUpdates(true);
  expect(useUpdates.getState().error).toContain('offline');expect(api.notify).not.toHaveBeenCalled();
  await checkUpdates();expect(useUpdates.getState().status?.available?.version).toBe('0.5.4');
});
