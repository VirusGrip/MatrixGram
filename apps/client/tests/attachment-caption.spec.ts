import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';

test('file waits with its caption, survives chat navigation, retries together and renders file above text without a status panel',async({page})=>{
  const adapter=fixtureApi+`events=Array.from({length:80},(_,i)=>({event_id:"$history"+i,sender:"@bob:test",type:"m.room.message",origin_server_ts:1000+i,content:{msgtype:"m.text",body:"Предыдущее сообщение "+i}}));const originalUpload=api.upload;window.__attachmentAttempts=[];api.upload=async payload=>{window.__attachmentAttempts.push({...payload,data:undefined});if(window.__attachmentAttempts.length===1)throw Error('Тест: ошибка отправки');return originalUpload(payload)};`;
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByLabel('Файлы для отправки').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('file contents')});
  await expect(page.getByLabel('Прикреплённые файлы')).toContainText('notes.txt');
  const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Текст под файлом');
  expect(await page.evaluate(()=>(window as any).__attachmentAttempts.length)).toBe(0);
  await page.getByRole('button',{name:'Открыть Закрытая комната'}).click();await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(input).toHaveValue('Текст под файлом');await expect(page.getByLabel('Прикреплённые файлы')).toContainText('notes.txt');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByText('Тест: ошибка отправки',{exact:true})).toBeVisible();await expect(page.getByLabel('Отправка файла notes.txt',{exact:true})).toBeInViewport();
  await expect(page.getByLabel('Прикреплённые файлы')).toHaveCount(0);await expect(input).toHaveValue('');
  await page.getByRole('button',{name:'Повторить notes.txt',exact:true}).click();
  const bubble=page.locator('.message-list .bubble.mine').filter({hasText:'Текст под файлом'});await expect(bubble).toBeVisible();
  const file=await bubble.locator('.file-preview').boundingBox(),caption=await bubble.locator('.message-text').boundingBox();expect(caption!.y).toBeGreaterThanOrEqual(file!.y+file!.height);
  const attempts=await page.evaluate(()=>(window as any).__attachmentAttempts);expect(attempts).toHaveLength(2);expect(attempts[0].txn).toBe(attempts[1].txn);expect(attempts[1].caption).toBe('Текст под файлом');
  expect(await page.evaluate(()=>(window as any).__sendCount||0)).toBe(0);await expect(page.locator('.upload-list')).toHaveCount(0);await expect(page.locator('.composer').getByText('Отправлено',{exact:true})).toHaveCount(0);
});

test('Android share stages a handle and caption, and removing it sends nothing and releases the handle',async({page})=>{
  await login(page,fixtureApi+`window.__released=[];api.releaseSharedFile=async handle=>window.__released.push(handle);`);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('matrixgram-share',{detail:{text:'Подпись из другого приложения',files:[{nativeHandle:'11111111-1111-4111-8111-111111111111',name:'shared.bin',mime:'application/octet-stream',size:100}]}})));
  await page.getByRole('button',{name:'Прикрепить в Команда Matrix',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toHaveValue('Подпись из другого приложения');await expect(page.getByLabel('Прикреплённые файлы')).toContainText('shared.bin');
  expect(await page.evaluate(()=>(window as any).__nativeSharedUpload)).toBeUndefined();
  await page.getByRole('button',{name:'Убрать shared.bin',exact:true}).click();await expect(page.getByLabel('Прикреплённые файлы')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__released)).toEqual(['11111111-1111-4111-8111-111111111111']);expect(await page.evaluate(()=>(window as any).__nativeSharedUpload)).toBeUndefined();
});