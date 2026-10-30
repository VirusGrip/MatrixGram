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
let encryption = {enabled:false,backupReady:false};
let folders = JSON.parse(localStorage.getItem('test-folders') || '[]');
export const api = {
 bootstrap:async()=>null, login:async()=>{setTimeout(()=>updates.forEach(update=>update(session.userId+'|'+session.deviceId,{rooms,timelines:[],connection:'online',error:null})),30);return session}, rooms:async()=>rooms, logout:async()=>{}, forget:async()=>{},
 cached:async id=>id==='!plain:test'?events:[], history:async id=>{if(id==='!secret:test')window.__secretHistoryCount=(window.__secretHistoryCount||0)+1;return {roomId:id,events:id==='!plain:test'?events:id==='!secret:test'&&encryption.enabled?[{event_id:'$secret',sender:'@bob:test',type:'m.room.message',origin_server_ts:2000,content:{body:'Открытое сообщение E2EE'}}]:[],next:null}},
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
 edit:async()=>{},react:async()=>{},redact:async()=>{},create:async()=>{throw new Error('Тест: нет прав')},join:async()=>{},
 encryptionStatus:async()=>encryption,enableEncryption:async()=>encryption={enabled:true,backupReady:false},
 recoverEncryption:async key=>{window.__recoveryCount=(window.__recoveryCount||0)+1;if(key==='bad')throw new Error('Ключ не подходит');return encryption={enabled:true,backupReady:true}},
 importEncryptionKeys:async()=>{encryption={enabled:true,backupReady:false};return 1},
 folders:async()=>folders,saveFolders:async value=>{folders=value;localStorage.setItem('test-folders',JSON.stringify(value));return value},
 searchUsers:async term=>({users:'Иван Иванов'.toLowerCase().includes(term.toLowerCase())?[{userId:'@ivan:test',displayName:'Иван Иванов'}]:[],limited:false}),
 openDirect:async userId=>{if(!rooms.some(r=>r.id==='!dm:test'))rooms.push({id:'!dm:test',name:'Иван Иванов',membership:'joined',encryption:'unencrypted',unread:0,members:2,lastBody:null,lastTs:0});return '!dm:test'}
};
export const onUpdate=async callback=>{updates.add(callback);return ()=>updates.delete(callback)};
export const onConnection=async()=>()=>{};
`;

async function login(page: Page, adapter = fixtureApi) {
  await page.route('**/src/api.ts', route => route.fulfill({ contentType: 'text/javascript', body: adapter }));
  await page.goto('/');
  await page.getByLabel('Логин или Matrix ID').fill('alice');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Войти в MatrixGram' }).click();
  await expect(page.getByRole('complementary', { name: 'Чаты', exact: true })).toBeVisible();
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

test('E2EE is optional and can be opened without a recovery prompt at login', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть Закрытая комната' }).click();
  await page.getByRole('button', { name: 'Открыть зашифрованные комнаты', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Открыть зашифрованные комнаты' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть доступные сообщения без ключа' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.message-list').getByText('Открытое сообщение E2EE')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
});

test('a wrong recovery key shows a useful error and does not unlock rooms', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть зашифрованные комнаты', exact: true }).first().click();
  await page.getByLabel('Ключ или пароль хранилища Matrix').fill('bad');
  await page.getByRole('button', { name: 'Восстановить по ключу' }).click();
  await expect(page.getByRole('alert')).toHaveText('Ключ не подходит');
  await expect(page.getByLabel('Ключ или пароль хранилища Matrix')).toHaveValue('');
});

test('people can be found by display surname and opened as a direct chat', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Поиск пользователей', exact: true }).click();
  await page.getByLabel('Имя, фамилия или Matrix ID').fill('Иванов');
  await expect(page.getByText('@ivan:test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Написать Иван Иванов' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.chat-heading h2')).toHaveText('Иван Иванов');
});

test('named folders filter chats and remain after reloading', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Настроить ПАПКИ' }).click();
  await page.getByLabel('Новая папка', { exact: true }).fill('Работа');
  await page.getByRole('checkbox', { name: 'Команда Matrix', exact: true }).check();
  await page.getByRole('button', { name: 'Создать папку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Изменить папку Работа' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Работа', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть Команда Matrix' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть Закрытая комната' })).toHaveCount(0);
  await login(page);
  await expect(page.getByRole('button', { name: 'Работа', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/folders-and-keys.png' });
});

const conversation = [
  ['@bob:test', 'Привет! Как продвигается новый интерфейс?'],
  ['@bob:test', 'Посмотрел свежую сборку. Стало заметно удобнее.'],
  ['@alice:test', 'Привет! Уже собираю версию для Windows.'],
  ['@alice:test', 'Папки теперь слева, а поиск всегда под рукой.'],
  ['@carol:test', 'Отлично. Вечером проверю на ноутбуке.'],
  ['@bob:test', 'И короткая переписка больше не висит вверху 🙂'],
  ['@bob:test', 'Спасибо!'],
];
function withMessages(items: string[][]) {
  const events = items.map(([sender, body], index) => ({ event_id: `$visual${index}`, sender, type: 'm.room.message', origin_server_ts: new Date(2026, 9, 30, 12, 0).getTime() + index * 30_000, content: { msgtype: 'm.text', body } }));
  const extraRooms = ['Дизайн', 'Семья', 'Общий чат', 'Планы на выходные', 'Разработка', 'Музыка', 'Заметки', 'Книжный клуб'].map((name, index) => ({ id: `!visual${index}:test`, name, topic: null, membership: 'joined', encryption: 'unencrypted', unread: index === 2 ? 4 : 0, members: 3, lastBody: ['До встречи вечером!', 'Спасибо, всё получилось', 'Посмотрю чуть позже'][index % 3], lastTs: new Date(2026, 9, 30, 11, 40 - index * 3).getTime() }));
  return fixtureApi.replace(/let events = .*?;/, `let events = ${JSON.stringify(events)};`).replace('const updates = new Set();', `rooms.push(...${JSON.stringify(extraRooms)}); const updates = new Set();`);
}

test('compact conversation groups senders, sits at the bottom, and opens details on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('matrixgram.theme', 'dark');
    localStorage.setItem('test-folders', JSON.stringify([{ id: 'work', name: 'Работа', roomIds: ['!plain:test'], unreadOnly: false }, { id: 'personal', name: 'Личное', roomIds: ['!secret:test'], unreadOnly: false }]));
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await login(page, withMessages(conversation));
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.locator('.message-list .bubble')).toHaveCount(7);
  await expect(page.locator('.message-list .sender')).toHaveCount(3);
  await expect(page.locator('.message-avatar .avatar')).toHaveCount(3);
  await expect(page.locator('.details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Работа', exact: true })).toBeVisible();
  const last = page.locator('.message-slot').last();
  await expect.poll(async () => {
    const bubble = await last.boundingBox(), composer = await page.locator('.composer').boundingBox();
    return composer!.y - bubble!.y - bubble!.height;
  }).toBeLessThan(20);
  const first = await page.locator('.message-slot').nth(0).boundingBox(), second = await page.locator('.message-slot').nth(1).boundingBox();
  expect(second!.y - first!.y - first!.height).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/telegram-desktop.png' });
  await page.getByRole('button', { name: 'О чате Команда Matrix', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'О комнате', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть информацию' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/telegram-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole('button', { name: 'Сменить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'test-results/telegram-light.png' });
  expect(errors).toEqual([]);
});

test('chat column can be resized with pointer and keyboard and keeps its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const separator = page.getByRole('separator', { name: 'Ширина списка чатов' });
  const box = await separator.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, 300);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 80, 300); await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '460');
  await separator.focus(); await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '480');
  await login(page);
  await expect(separator).toHaveAttribute('aria-valuenow', '480');
});

test('long history remains virtualized and can scroll from newest to oldest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const items = Array.from({ length: 180 }, (_, index) => ['@bob:test', `Сообщение ${index + 1}: ${'Проверяем перенос текста. '.repeat(index % 4 + 1)}`]);
  await login(page, withMessages(items));
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.locator('.message-text').filter({ hasText: 'Сообщение 180:' })).toBeVisible();
  expect(await page.locator('.message-list .bubble').count()).toBeLessThan(70);
  await page.locator('.timeline').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.message-text').filter({ hasText: 'Сообщение 1:' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});
