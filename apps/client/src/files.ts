export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const INLINE_FILE_BYTES = 25 * 1024 * 1024;
export const FILE_CHUNK_BYTES = 1024 * 1024;
export interface NativeTransferFile {name:string;type:string;size:number;nativeHandle:string}
export type TransferFile=File|NativeTransferFile;
export const nativeTransferFile=(file:TransferFile):file is NativeTransferFile=>'nativeHandle' in file;
export function fileBase64(file: Blob) {
  if(file.size>INLINE_FILE_BYTES)return Promise.reject(new Error('Для этого действия выберите файл до 25 МБ'));
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Не удалось прочитать файл')); reader.readAsDataURL(file); });
}
