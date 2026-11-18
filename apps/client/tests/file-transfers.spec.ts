import {test,expect,type Page} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
const MAX=500*1024*1024;
async function enqueue(page:Page,size:number,name='large.bin'){
  await page.evaluate(async({size,name})=>{
    const {enqueueFiles}=await import('/src/Transfers.tsx' as string);
    const file=new File(['x'],name,{type:'application/octet-stream'});
    Object.defineProperty(file,'size',{value:size});
    file.slice=(start=0,end=size)=>{const count=end-start;(window as any).__sourceSlices=((window as any).__sourceSlices||0)+1;(window as any).__sourceMaxSlice=Math.max((window as any).__sourceMaxSlice||0,count);return new Blob([new Uint8Array(count)]);};
    FileReader.prototype.readAsDataURL=()=>{throw Error('Large files must not use base64')};
    enqueueFiles('!plain:test',[file]);
  },{size,name});
}
const big=`events.push({event_id:'$big',sender:'@bob:test',type:'m.room.message',origin_server_ts:Date.now(),content:{msgtype:'m.file',body:'big.bin',url:'mxc://test/big',info:{mimetype:'application/octet-stream',size:${MAX}}}});`;
const progressApi=fixtureApi.replace('export const onTransfer=async()=>()=>{};',`export const onTransfer=async callback=>{window.__fileProgress=callback;return ()=>{if(window.__fileProgress===callback)delete window.__fileProgress}};`);

test('exactly 500 MiB uses sequential 1 MiB chunks without base64',async({page})=>{
  await login(page);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await enqueue(page,MAX);
  await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();
  const result=await page.evaluate(()=>({items:Object.values((window as any).__largeUploads),max:(window as any).__sourceMaxSlice,slices:(window as any).__sourceSlices}));
  expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({size:MAX,current:MAX,maxChunk:1024*1024});expect(result.max).toBe(1024*1024);expect(result.slices).toBe(500);
});
test('one byte above 500 MiB is refused before file reads or native staging',async({page})=>{
  await login(page);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await enqueue(page,MAX+1);
  await expect(page.getByText('Размер файла должен быть от 1 байта до 500 МБ',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__sourceSlices||0)).toBe(0);expect(await page.evaluate(()=>(window as any).__largeUploads)).toBeUndefined();
});
test('server limit rejection happens before reading the file',async({page})=>{
  await login(page,fixtureApi+`api.beginFileUpload=async()=>{throw Error('Сервер разрешает файлы до 100 МБ')};`);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await enqueue(page,200*1024*1024);
  await expect(page.getByText('Сервер разрешает файлы до 100 МБ',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__sourceSlices||0)).toBe(0);
});
test('chunk failure can retry the file with the same Matrix transaction',async({page})=>{
  const adapter=fixtureApi+`window.__stageAttempts=[];const begin=api.beginFileUpload,chunk=api.fileUploadChunk;api.beginFileUpload=async(upload,...rest)=>{window.__stageAttempts.push(upload.txn);return begin(upload,...rest)};api.fileUploadChunk=async(txn,offset,bytes)=>{if(offset>0&&!window.__chunkFailed){window.__chunkFailed=true;throw Error('Тест: ошибка блока')};return chunk(txn,offset,bytes)};`;
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await enqueue(page,26*1024*1024+17);
  await expect(page.getByText('Тест: ошибка блока',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Повторить large.bin'}).click();await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();
  const attempts=await page.evaluate(()=>(window as any).__stageAttempts);expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(attempts[1]);
});
test('large received file saves natively without loading base64 into the WebView',async({page})=>{
  await login(page,fixtureApi+big+`api.media=async()=>{throw Error('must not load a large preview')};api.downloadFile=async(name,source,txn,sessionKey)=>{window.__streamSave={name,source,sessionKey};return true};`);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await page.getByRole('button',{name:'Загрузить big.bin'}).click();await expect(page.getByText('Файл сохранён',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__streamSave)).toMatchObject({name:'big.bin',source:{url:'mxc://test/big'},sessionKey:'@alice:test|TEST'});
});

test('failed native upload retries immediately without an early-cancel marker',async({page})=>{
  const adapter=fixtureApi+`const finish=api.finishFileUpload;window.__attempts=0;window.__unexpectedCancel=false;api.finishFileUpload=async txn=>{if(++window.__attempts===1)throw Error('Тест: сервер недоступен');return finish(txn)};api.cancelUpload=async()=>{window.__unexpectedCancel=true};`;
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await enqueue(page,26*1024*1024);
  await expect(page.getByText('Тест: сервер недоступен',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Повторить large.bin'}).click();
  await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__attempts)).toBe(2);expect(await page.evaluate(()=>(window as any).__unexpectedCancel)).toBe(false);
});
test('download progress survives chat navigation and cancellation does not claim a save',async({page})=>{
  const adapter=progressApi+big+`api.downloadFile=async(name,source,txn,sessionKey)=>{window.__downloadJob={txn,sessionKey};return new Promise((resolve,reject)=>{window.__abortDownload=()=>reject(Error('cancelled'))})};api.cancelUpload=async txn=>{window.__cancelledDownload=txn;window.__abortDownload()};`;
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await page.getByRole('button',{name:'Загрузить big.bin'}).click();
  await page.evaluate(()=>{const w=window as any;w.__fileProgress({...w.__downloadJob,phase:'downloading',current:250*1024*1024,total:500*1024*1024})});
  await expect(page.locator('.download-progress')).toContainText('50%');
  await page.getByRole('button',{name:'Открыть Закрытая комната'}).click();await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await expect(page.locator('.download-progress')).toContainText('50%');
  await page.evaluate(()=>{const w=window as any;w.__fileProgress({...w.__downloadJob,sessionKey:'@other:test|OTHER',phase:'downloading',current:499*1024*1024,total:500*1024*1024})});
  await expect(page.locator('.download-progress')).toContainText('50%');
  await page.getByRole('button',{name:'Отменить загрузку',exact:true}).click();await expect(page.locator('.download-progress')).toHaveCount(0);await expect(page.getByText('Файл сохранён',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__cancelledDownload)).toBeTruthy();
});
test('unknown-size media rejected for preview still offers a streamed save',async({page})=>{
  const item=`events.push({event_id:'$unknown',sender:'@bob:test',type:'m.room.message',origin_server_ts:Date.now(),content:{msgtype:'m.video',body:'unknown.mp4',url:'mxc://test/unknown',info:{mimetype:'video/mp4'}}});`;
  await login(page,fixtureApi+item+`api.media=async()=>{throw Error('Предпросмотр ограничен 25 МБ')};`);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await page.getByRole('button',{name:'Загрузить unknown.mp4'}).click();await expect(page.getByText('Предпросмотр ограничен 25 МБ',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(page.getByText('Файл сохранён',{exact:true})).toBeVisible();
});
test('Android share transfers a 500 MiB handle after choosing a recipient',async({page})=>{
  await login(page);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('matrixgram-share',{detail:{text:'',files:[{nativeHandle:'11111111-1111-4111-8111-111111111111',name:'shared.bin',mime:'application/octet-stream',size:500*1024*1024}]}})));
  await expect(page.getByRole('dialog',{name:'Поделиться в MatrixGram'})).toBeVisible();expect(await page.evaluate(()=>(window as any).__nativeSharedUpload)).toBeUndefined();
  await page.getByRole('button',{name:'Отправить в Команда Matrix',exact:true}).click();await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__nativeSharedUpload)).toMatchObject({name:'shared.bin',size:MAX});
});

test('active file downloads block app update installation',async({page})=>{
  const updates=`const updateStatus={currentVersion:'0.5.7',configured:true,platform:'windows',repository:'VirusGrip/MatrixGram',available:{version:'0.5.8',notes:'test'}};api.updateStatus=async()=>updateStatus;api.checkUpdate=async()=>updateStatus;api.installUpdate=async()=>{window.__updateInstalled=true;return 'started'};`;
  await login(page,fixtureApi+big+updates+`api.downloadFile=async()=>new Promise(()=>{});`);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await page.getByRole('button',{name:'Загрузить big.bin'}).click();await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Скачать обновление',exact:true}).click();await page.getByRole('button',{name:'Установить и перезапустить',exact:true}).click();await expect(page.getByText('Дождитесь передачи файлов или отмените её перед обновлением',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__updateInstalled)).toBeUndefined();
});
test('closing Android share without a recipient releases its native handle',async({page})=>{
  await login(page,fixtureApi+`window.__releasedHandles=[];api.releaseSharedFile=async handle=>window.__releasedHandles.push(handle);`);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('matrixgram-share',{detail:{text:'',files:[{nativeHandle:'11111111-1111-4111-8111-111111111111',name:'shared.bin',mime:'application/octet-stream',size:500*1024*1024}]}})));
  const modal=page.getByRole('dialog',{name:'Поделиться в MatrixGram'});await modal.getByRole('button',{name:'Закрыть',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__releasedHandles)).toEqual(['11111111-1111-4111-8111-111111111111']);expect(await page.evaluate(()=>(window as any).__nativeSharedUpload)).toBeUndefined();
});
