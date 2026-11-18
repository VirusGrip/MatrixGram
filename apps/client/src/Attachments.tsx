import {create} from 'zustand';
import {FileText, X} from 'lucide-react';
import {api} from './api';
import {useStore} from './store';
import {MAX_FILE_BYTES, nativeTransferFile, type TransferFile} from './files';

export const useAttachments=create<{files:Record<string,TransferFile[]>;text:Record<string,string>}>(()=>({files:{},text:{}}));
export function attachFiles(roomId:string,files:TransferFile[],text='') {
  const current=useAttachments.getState();
  const merged=[...(current.files[roomId]??[]),...files];
  if(!useStore.getState().session)return false;
  if(merged.length>50){useStore.getState().setError('Можно прикрепить до 50 файлов');return false;}
  if(files.some(file=>file.size>MAX_FILE_BYTES||(!file.size&&!nativeTransferFile(file)))){useStore.getState().setError('Размер файла должен быть от 1 байта до 500 МБ');return false;}
  useAttachments.setState({files:{...current.files,[roomId]:merged},text:text?{...current.text,[roomId]:[current.text[roomId],text].filter(Boolean).join('\n')}:current.text});
  return true;
}
function release(file:TransferFile){if(nativeTransferFile(file))void api.releaseSharedFile(file.nativeHandle).catch(()=>{});}
export function takeAttachments(roomId:string){const current=useAttachments.getState(),files=current.files[roomId]??[];useAttachments.setState({files:{...current.files,[roomId]:[]}});return files;}
export function takeSharedText(roomId:string){const current=useAttachments.getState(),text=current.text[roomId]??'';if(text)useAttachments.setState({text:{...current.text,[roomId]:''}});return text;}
export function clearAttachments(){for(const files of Object.values(useAttachments.getState().files))files.forEach(release);useAttachments.setState({files:{},text:{}});}
export function AttachedFiles({roomId}:{roomId:string}){
  const files=useAttachments(state=>state.files[roomId]);
  if(!files?.length)return null;
  return <div className="attachment-drafts" aria-label="Прикреплённые файлы">{files.map((file,index)=><div className="attachment-chip" key={index}><FileText size={22}/><span title={file.name}>{file.name}</span><button type="button" className="icon-button" aria-label={`Убрать ${file.name}`} onClick={()=>{release(file);useAttachments.setState(state=>({files:{...state.files,[roomId]:state.files[roomId].filter((_,at)=>at!==index)}}));}}><X size={16}/></button></div>)}</div>;
}
