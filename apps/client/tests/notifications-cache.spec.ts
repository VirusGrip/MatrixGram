import { test,expect } from '@playwright/test';
import { fixtureApi,login } from './fixtures';

test('notification click opens its chat and a cold activation waits for login',async({page})=>{
  const adapter=fixtureApi+`window.__pendingNotification={id:'cold',target:{kind:'room',roomId:'!secret:test',sessionKey:session.userId+'|'+session.deviceId}};`;
  await login(page,adapter);
  await expect(page.locator('.chat-heading h2')).toHaveText('Закрытая комната');
  await expect.poll(()=>page.evaluate(()=>(window as any).__notificationAcknowledged)).toBe('cold');
  await page.evaluate(()=>(window as any).__notificationOpen({id:'warm',target:{kind:'room',roomId:'!plain:test',sessionKey:'@alice:test|TEST'}}));
  await expect(page.locator('.chat-heading h2')).toHaveText('Команда Matrix');
  await expect.poll(()=>page.evaluate(()=>(window as any).__notificationAcknowledged)).toBe('warm');
});
test('notification for another account never opens the current account chat',async({page})=>{
  await login(page);
  await page.evaluate(()=>(window as any).__notificationOpen({id:'other',target:{kind:'room',roomId:'!plain:test',sessionKey:'@other:test|DEVICE'}}));
  await expect(page.locator('.notification-account')).toContainText('@other:test');
  await expect(page.locator('.chat-panel')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__notificationAcknowledged)).toBeUndefined();
});
test('update is announced at startup and opens the shared download panel',async({page})=>{
  const adapter=fixtureApi+`api.checkUpdate=async()=>({currentVersion:'0.5.3',configured:true,platform:'windows',repository:'VirusGrip/MatrixGram',available:{version:'0.5.4',notes:'Обновлён кеш'}});`;
  await login(page,adapter);
  await expect(page.locator('.update-notice')).toContainText('0.5.4');
  await expect.poll(()=>page.evaluate(()=>(window as any).__notifications?.filter((n:any)=>n.title==='Обновление MatrixGram').length)).toBe(1);
  await page.locator('.update-notice').click();
  await expect(page.getByRole('dialog',{name:'Обновление MatrixGram'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Скачать обновление',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect(await page.evaluate(()=>(window as any).__notifications.filter((n:any)=>n.title==='Обновление MatrixGram').length)).toBe(1);
});
test('offline startup displays cached messages and profiles without waiting for history',async({page})=>{
  const adapter=fixtureApi.replaceAll("connection:'online'","connection:'reconnecting'")+`api.history=async()=>{window.__unexpectedHistory=true;throw Error('offline')};`;
  await login(page,adapter);
  await page.getByRole('button',{name:'Открыть Команда Matrix',exact:true}).click();
  await expect(page.locator('.message-text')).toContainText('Привет, команда!');
  await expect(page.locator('.sender')).toHaveText('Bob');
  expect(await page.evaluate(()=>(window as any).__unexpectedHistory)).toBeUndefined();
});
test.describe('touch message actions',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:412,height:915}});
  test('thumb action is hidden and reactions are available through the message menu',async({page})=>{
    await login(page);await page.getByRole('button',{name:'Открыть Команда Matrix',exact:true}).click();
    await expect(page.getByRole('button',{name:'Реакция 👍',exact:true})).toBeHidden();
    const bubble=page.locator('.bubble').first();
    await bubble.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:80,clientY:200});
    await expect(page.getByRole('menuitem',{name:'Выделить сообщение',exact:true})).toBeVisible();
    await bubble.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true});
    await expect(page.locator('.message-menu')).toBeVisible();
  });
});
