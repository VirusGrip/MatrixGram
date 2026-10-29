import { test, expect, type Page } from '@playwright/test';

// Replaces the IPC adapter ONLY in this test server. Production has no demo data.
const fixtureApi = `
export const nativeAvailable = () => true;
const session = { userId:'@alice:test', deviceId:'TEST', homeserver:'https://matrix.test', persisted:true };
const rooms = [
 {id:'!plain:test',name:'Команда Matrix',topic:'Тестовая комната',membership:'joined',encryption:'unencrypted',unread:2,members:3,lastBody:'Привет, команда!',lastTs:1000},
 {id:'!secret:test',name:'Закрытая комната',topic:null,membership:'joined',encryption:'encrypted',unread:0,members:2,lastBody:null,lastTs:0}
];
const updates = new Set();
let events = [{event_id:'$hello',sender:'@bob:test',type:'m.room.message',origin_server_ts:1000,content:{msgtype:'m.text',body:'Привет, команда!'}}];
let drafts = {};
export const api = {
 bootstrap:async()=>null, login:async()=>session, rooms:async()=>rooms, logout:async()=>{}, forget:async()=>{},
 cached:async id=>id==='!plain:test'?events:[], history:async id=>{if(id==='!secret:test')window.__secretHistoryCount=(window.__secretHistoryCount||0)+1;return {roomId:id,events:id==='!plain:test'?events:[],next:null}},
 draft:async id=>drafts[id]||'',saveDraft:async(id,body)=>{drafts[id]=body},typing:async()=>{},read:async()=>{},
 send:async(roomId,body,txn,replyTo)=>{
   window.__sendCount=(window.__sendCount||0)+1;
   if(body==='Сбой' && window.__sendCount===1) throw new Error('Тест: сеть недоступна');
   const id='$'+txn;
   events=[...events,{event_id:id,sender:session.userId,type:'m.room.message',origin_server_ts:2000,content:{msgtype:'m.text',body},unsigned:{transaction_id:txn}}];
   setTimeout(()=>updates.forEach(update=>update('auth', {rooms,timelines:[{roomId,events,next:null}],connection:'online',error:null})),5);
   setTimeout(()=>updates.forEach(update=>update(session.userId+'|'+session.deviceId, {rooms,timelines:[{roomId,events,next:null}],connection:'online',error:null})),20);
   return id;
 },
 edit:async()=>{},react:async()=>{},redact:async()=>{},create:async()=>{throw new Error('Тест: нет прав')},join:async()=>{}
};
export const onUpdate=async callback=>{updates.add(callback);return ()=>updates.delete(callback)};
export const onConnection=async()=>()=>{};
`;

async function login(page: Page) {
  await page.route('**/src/api.ts', route => route.fulfill({ contentType: 'text/javascript', body: fixtureApi }));
  await page.goto('/');
  await page.getByLabel('Логин или Matrix ID').fill('alice');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Войти в MatrixGram' }).click();
  await expect(page.getByRole('heading', { name: 'Сообщения.' })).toBeVisible();
}

test('web-only shell clearly explains why login is unavailable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Открыта веб-оболочка.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти в MatrixGram' })).toBeDisabled();
});

test('login, room selection, sending, and safe text rendering', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.getByText('Привет, команда!', { exact: true }).last()).toBeVisible();
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.message-list .bubble p').filter({ hasText: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.locator('.timeline img')).toHaveCount(0);
  await expect(page.locator('.pending')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop-chat.png' });
});

test('encrypted rooms have an explanation and no composer', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть Закрытая комната' }).click();
  await expect(page.getByRole('heading', { name: 'Зашифрованная комната' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __secretHistoryCount?: number }).__secretHistoryCount ?? 0)).toBe(0);
});

test('failed sends can be retried without creating a second pending message', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Сбой');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Не отправлено', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.message-list .bubble p').filter({ hasText: 'Сбой' })).toHaveCount(1);
  await expect(page.locator('.pending')).toHaveCount(0);
});

test('mobile navigation and theme work without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/mobile-chat.png' });
  await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByRole('button', { name: 'Информация о комнате', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'О комнате' })).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть информацию', exact: true }).click();
  await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).last().click();
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('switching rooms immediately preserves the current draft', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Мой черновик');
  await page.getByRole('button', { name: 'Открыть Закрытая комната' }).click();
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Мой черновик');
});
