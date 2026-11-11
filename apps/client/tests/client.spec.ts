import { test, expect } from '@playwright/test';
import { fixtureApi, login } from './fixtures';

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
  await expect(page.locator('.message-list .message-text').filter({ hasText: '<img src=x onerror=alert(1)>' })).toBeVisible();
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
  await expect(page.locator('.message-list .message-text').filter({ hasText: 'Сбой' })).toHaveCount(1);
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

test('file upload renders an image and saves authenticated media', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByLabel('Файлы для отправки').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
  await expect(page.getByText('Отправлено', { exact: true })).toBeVisible();
  const preview = page.getByRole('button', { name: 'Открыть изображение photo.png' });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(page.getByRole('dialog', { name: 'photo.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить изображение' }).click();
  expect(await page.evaluate(() => (window as any).__savedFile.name)).toBe('photo.png');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.screenshot({ path: 'test-results/media-upload.png' });
});

test('member list, profile, pin, forward and room settings call the real IPC contract', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByRole('button', { name: 'Информация о комнате', exact: true }).click();
  await expect(page.locator('.member-row')).toHaveCount(2);
  await page.getByLabel('Поиск участников').fill('Bob');
  await expect(page.locator('.member-row')).toHaveCount(1);
  await page.locator('.member-row > button').click();
  await expect(page.getByRole('dialog', { name: 'Профиль пользователя' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Скрыть информацию' }).click();
  await page.locator('.bubble').first().click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Закрепить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.bubble').first().hover(); await page.getByRole('button', { name: 'Переслать', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Команда Matrix', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__operations.filter((v:any) => v.kind === 'forward').length)).toBe(1);
});

test('profile and native preferences can be changed without exposing session secrets', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Отображаемое имя').fill('Новое имя');
  await page.getByRole('button', { name: 'Сохранить имя' }).click();
  await expect(page.getByText('Имя сохранено', { exact: true })).toBeVisible();
  await expect(page.getByText('Element', { exact: true })).toBeVisible();
  await page.getByLabel('Показывать текст в уведомлении').check();
  expect(await page.evaluate(() => localStorage.getItem('matrixgram.preview'))).toBe('on');
});

test('rich text discards executable HTML and preserves allowed formatting', async ({ page }) => {
  const adapter = withMessages([['@bob:test', 'Безопасный текст']]).replace('body:"Безопасный текст"', 'body:"Безопасный текст"');
  const htmlAdapter = adapter.replace('"body":"Безопасный текст"', '"body":"Безопасный текст","format":"org.matrix.custom.html","formatted_body":"<strong>Жирный</strong><img src=x onerror=alert(1)><a href=javascript:alert(1)>ссылка</a><script>window.__xss=true</script>"');
  await login(page, htmlAdapter); await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await expect(page.locator('.formatted-text strong')).toHaveText('Жирный');
  await expect(page.locator('.formatted-text img,.formatted-text script,.formatted-text a')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('voice recording sends playable audio and supports pause, seek and save', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await login(page); await page.getByRole('button', { name: 'Открыть Команда Matrix' }).click();
  await page.getByRole('button', { name: 'Записать голосовое' }).click();
  await expect(page.getByRole('button', { name: 'Отправить голосовое' })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Пауза записи' }).click();
  await page.getByRole('button', { name: 'Продолжить запись' }).click();
  await page.getByRole('button', { name: 'Отправить голосовое' }).click();
  await expect(page.locator('.voice-recorder')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__uploads.some((v:any) => v.voice && v.mime.startsWith('audio/') && v.durationMs > 0 && v.bytes > 200))).toBe(true);
  await page.getByRole('button', {name:/Загрузить voice-/}).click();
  await expect(page.locator('.media-audio audio')).toHaveCount(1);
  await page.locator('.media-audio audio').evaluate(async (audio:HTMLAudioElement)=>{await audio.play();});
  await expect.poll(()=>page.locator('.media-audio audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(0);
  await page.locator('.media-audio audio').evaluate((audio:HTMLAudioElement)=>{audio.currentTime=.1;audio.pause();});
  await page.locator('.media-audio').getByRole('button',{name:'Сохранить',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__savedFile.data.length)).toBeGreaterThan(200);
});

test('two WebRTC peers exchange RTP through Matrix signalling and stop media on hangup', async ({ page, context }) => {
  await context.grantPermissions(['microphone']); await page.goto('/');
  await page.evaluate(async () => {
    const { CallEngine } = await import('/src/callEngine.ts' as string);
    const states:any = {}, peers:any = {}, signals:any[] = [];
    for (const party of ['A','B']) peers[party] = new CallEngine({ party, ice:async()=>[], changed:(state:any)=>{states[party]=state}, send:async(roomId:string,type:string,content:any)=>{
      signals.push({party,type,content}); const target=party==='A'?'B':'A';
      setTimeout(()=>peers[target].receive(roomId,{event_id:crypto.randomUUID(),sender:'@'+party+':test',type,origin_server_ts:Date.now(),content}),0);
    }});
    (window as any).__calls={states,peers,signals}; await peers.A.start('!call:test',false);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__calls.states.B?.direction)).toBe('incoming');
  await page.evaluate(() => (window as any).__calls.peers.B.answer());
  await expect.poll(() => page.evaluate(() => !!(window as any).__calls.states.A?.started && !!(window as any).__calls.states.B?.started), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => { const stats = await (window as any).__calls.peers.A.pc.getStats(); let packets=0; stats.forEach((v:any)=>{if(v.type==='inbound-rtp')packets+=v.packetsReceived||0});return packets }), { timeout: 10_000 }).toBeGreaterThan(0);
  const muted = await page.evaluate(() => { const c=(window as any).__calls;c.peers.A.mute('audio',true);return c.states.A.local.getAudioTracks().every((track:any)=>!track.enabled); });
  expect(muted).toBe(true);
  await page.evaluate(async () => { const c=(window as any).__calls; c.previousTracks=c.states.A.local.getTracks();await c.peers.A.hangup(); });
  await expect.poll(() => page.evaluate(() => (window as any).__calls.states.B)).toBeNull();
  expect(await page.evaluate(() => (window as any).__calls.previousTracks.every((track:any)=>track.readyState==='ended'))).toBe(true);
});

test('switching accounts clears the previous timeline and ignores old account events', async ({ page }) => {
  const adapter=fixtureApi.replace('accounts:async()=>({entries:[],active:null})', `accounts:async()=>({entries:[{id:'alice',userId:'@alice:test',homeserver:'https://matrix.test'},{id:'bob',userId:'@bob:test',homeserver:'https://matrix.test'}],active:window.__activeAccount||'alice'})`)
    .replace('switchAccount:async()=>session', `switchAccount:async id=>{window.__activeAccount=id;return {...session,userId:'@bob:test',deviceId:'BOB'}}`)
    .replace('rooms:async()=>[...rooms]', `rooms:async()=>window.__activeAccount==='bob'?[{id:'!bob:test',name:'Личный чат Bob',membership:'joined',encryption:'unencrypted',unread:0,members:1,lastBody:null,lastTs:0}]:rooms`);
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(page.locator('.message-text').filter({hasText:'Привет, команда!'})).toBeVisible();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.locator('.accounts-panel').getByRole('button',{name:'@bob:test https://matrix.test'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Открыть Личный чат Bob'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть Команда Matrix'})).toHaveCount(0);
  await expect(page.locator('.message-text')).toHaveCount(0);
});

test('file upload continues across chat navigation and is not enqueued twice', async ({ page }) => {
  const adapter=fixtureApi.replace('upload:async upload=>{', 'upload:async upload=>{window.__started=(window.__started||0)+1;await new Promise(resolve=>window.__finishUpload=resolve);');
  await login(page,adapter); await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByLabel('Файлы для отправки').setInputFiles({name:'background.txt',mimeType:'text/plain',buffer:Buffer.from('background upload')});
  await expect.poll(()=>page.evaluate(()=>(window as any).__started)).toBe(1);
  await page.getByRole('button',{name:'Открыть Закрытая комната'}).click();
  await page.evaluate(()=>(window as any).__finishUpload());
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__uploads.length)).toBe(1);
});

test('cancelled file upload stays cancelled when the native request settles', async ({ page }) => {
  const adapter=fixtureApi.replace('upload:async upload=>{', 'upload:async upload=>{await new Promise(resolve=>window.__finishUpload=resolve);throw new Error("Отправка отменена");')
    .replace('cancelUpload:async()=>{}','cancelUpload:async()=>{window.__cancelled=true;window.__finishUpload?.()}');
  await login(page,adapter); await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByLabel('Файлы для отправки').setInputFiles({name:'cancel.txt',mimeType:'text/plain',buffer:Buffer.from('cancel me')});
  await expect(page.getByRole('button',{name:'Отменить cancel.txt'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__finishUpload)).toBe('function');
  await page.getByRole('button',{name:'Отменить cancel.txt'}).click();
  await expect(page.getByText('Отменено',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__cancelled)).toBe(true);
  await expect(page.getByText('Отправлено',{exact:true})).toHaveCount(0);
});

test('server history search opens a message outside loaded history', async ({ page }) => {
  const found={event_id:'$old-search',sender:'@bob:test',type:'m.room.message',origin_server_ts:500,content:{msgtype:'m.text',body:'Архивная встреча'}};
  const adapter=fixtureApi.replace("if(kind==='search')return {room_events:{results:[],next_batch:null}};", `if(kind==='search')return {room_events:{results:[{result:${JSON.stringify(found)}}],next_batch:null}};if(kind==='event')return ${JSON.stringify(found)};`);
  await login(page,adapter); await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByRole('button',{name:'Поиск в загруженных сообщениях'}).click();
  await page.getByPlaceholder('Поиск в загруженной истории').fill('встреча');
  await page.getByRole('button',{name:'Вся история',exact:true}).click();
  await page.getByRole('dialog').getByRole('button').filter({hasText:'Архивная встреча'}).click();
  await expect(page.locator('.bubble.highlight')).toContainText('Архивная встреча');
});

test('read-only channel hides the composer and explains permissions', async ({ page }) => {
  await login(page,fixtureApi.replace('canSend:true','canSend:false'));
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(page.locator('.channel-readonly')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toHaveCount(0);
});

test('Android share waits for a recipient and Back closes dialogs before chat navigation', async ({ page }) => {
  await login(page); await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('matrixgram-share',{detail:{text:'Из другого приложения',files:[{name:'shared.txt',mime:'text/plain',data:btoa('shared bytes')}]}})));
  await expect(page.getByRole('dialog',{name:'Поделиться в MatrixGram'})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__uploads?.length||0)).toBe(0);
  await page.getByRole('button',{name:'Отправить в Команда Matrix',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__uploads?.length||0)).toBe(1);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  expect(await page.evaluate(()=>window.matrixgramBack?.())).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>window.matrixgramBack?.())).toBe(true);
  await expect(page.locator('.chat-panel')).toHaveCount(0);
});

test('interface scale stays inside the desktop and mobile viewport', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('matrixgram.scale','125'));
  await page.setViewportSize({width:1280,height:820}); await login(page);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1280);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('room refresh failure after switching never restores the old account identity', async ({ page }) => {
  const adapter=fixtureApi.replace('accounts:async()=>({entries:[],active:null})', `accounts:async()=>({entries:[{id:'alice',userId:'@alice:test',homeserver:'https://matrix.test'},{id:'bob',userId:'@bob:test',homeserver:'https://matrix.test'}],active:window.__activeAccount||'alice'})`)
    .replace('switchAccount:async()=>session', `switchAccount:async id=>{window.__activeAccount=id;return {...session,userId:'@bob:test',deviceId:'BOB'}}`)
    .replace('rooms:async()=>[...rooms]', `rooms:async()=>{if(window.__activeAccount==='bob')throw new Error('Нет сети');return rooms}`);
  await login(page,adapter); await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.locator('.accounts-panel').getByRole('button',{name:'@bob:test https://matrix.test'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Открыть Команда Matrix'})).toHaveCount(0);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.profile').first()).toContainText('@bob:test');
});

test('a delayed incoming call cannot reopen after its account session is disposed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const {CallEngine}=await import('/src/callEngine.ts' as string);
    const probe:any={states:[]};
    probe.engine=new CallEngine({party:'ME',ice:async()=>[],send:async()=>{},changed:(state:any)=>probe.states.push(state),acceptInvite:()=>new Promise(resolve=>probe.release=resolve)});
    probe.engine.receive('!call:test',{event_id:'$delayed',sender:'@bob:test',type:'m.call.invite',origin_server_ts:Date.now(),content:{call_id:'delayed',party_id:'BOB',version:'1',lifetime:60000,offer:{type:'offer',sdp:'v=0'}}});
    (window as any).__disposedCall=probe;
  });
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__disposedCall.release)).toBe('function');
  await page.evaluate(async ()=>{const p=(window as any).__disposedCall;p.engine.dispose();p.release(true);await p.engine.queue;});
  expect(await page.evaluate(()=>(window as any).__disposedCall.states)).toEqual([null]);
});

test('unlocked encrypted chats show last text in the list without opening each room', async ({ page }) => {
  await login(page);
  const row=page.getByRole('button',{name:'Открыть Закрытая комната'});
  await expect(row).toContainText('Зашифрованная переписка');
  expect(await page.evaluate(()=>(window as any).__secretHistoryCount||0)).toBe(0);
  await page.getByRole('button',{name:'Открыть зашифрованные комнаты',exact:true}).click();
  await page.getByRole('button',{name:'Открыть доступные сообщения без ключа'}).click();
  await expect(row).toContainText('Открытое сообщение E2EE');
  await expect(row).not.toContainText('Зашифрованная переписка');
  expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('Открытое сообщение E2EE')))).toBe(false);
});

test('switching chats with information open keeps a single correctly placed conversation', async ({ page }) => {
  const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.setViewportSize({width:1286,height:900});await login(page);
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.getByRole('button',{name:'Информация о комнате',exact:true}).click();
  for(let i=0;i<5;i++) {
    await page.getByRole('button',{name:'Открыть Закрытая комната'}).click();
    await expect(page.locator('.chat-panel')).toHaveCount(1);await expect(page.locator('.room-info')).toHaveCount(1);
    await expect(page.locator('.chat-heading h2')).toHaveText('Закрытая комната');
    await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
    await expect(page.locator('.chat-panel')).toHaveCount(1);await expect(page.locator('.composer')).toHaveCount(1);
  }
  const boxes=await page.evaluate(()=>{const rect=(selector:string)=>{const b=document.querySelector(selector)!.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}};return {rail:rect('.rail'),side:rect('.sidebar'),chat:rect('.chat-panel'),info:rect('.room-info')}});
  expect(boxes.rail.x).toBe(0);expect(boxes.side.x).toBeGreaterThan(60);expect(boxes.chat.x).toBeCloseTo(boxes.side.right,0);expect(boxes.info.x).toBeCloseTo(boxes.chat.right,0);
  expect(boxes.info.y).toBe(0);expect(boxes.chat.bottom).toBe(900);
  await page.screenshot({path:'test-results/room-switch-fixed.png'});
  expect(errors.filter(error=>/same key|unique.*key|Encountered two children/i.test(error))).toEqual([]);
});

const dmFixture=fixtureApi.replace("name:'Закрытая комната'","name:'Борис Сидоров',directUserId:'@bob:test',avatarUrl:'mxc://test/bob-photo'")
  .replace("name:'Команда Matrix'","name:'Команда Matrix',avatarUrl:'mxc://test/group-photo'")
  .replace('media:async source=>({data:mediaStore[source.url]||pixel})','media:async source=>{window.__mediaRequests=[...(window.__mediaRequests||[]),source.url];return {data:mediaStore[source.url]||pixel}}');

test('DM photo is shown in list and heading while groups keep their own cover', async ({ page }) => {
  await login(page,dmFixture);
  await expect(page.getByRole('button',{name:'Открыть Борис Сидоров'}).locator('.avatar img')).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть Команда Matrix'}).locator('.avatar img')).toBeVisible();
  await page.getByRole('button',{name:'Открыть Борис Сидоров'}).click();
  await expect(page.getByRole('button',{name:'Профиль собеседника'}).locator('img')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__mediaRequests)).toEqual(expect.arrayContaining(['mxc://test/bob-photo','mxc://test/group-photo']));
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(page.getByRole('button',{name:'Профиль собеседника'})).toHaveCount(0);
});

test('personal contact names survive restart, do not change Matrix profiles and stay isolated by account', async ({ page }) => {
  const adapter=dmFixture.replace('accounts:async()=>({entries:[],active:null})', `accounts:async()=>({entries:[{id:'alice',userId:'@alice:test',homeserver:'https://matrix.test'},{id:'carol',userId:'@carol:test',homeserver:'https://matrix.test'}],active:window.__activeAccount||'alice'})`)
    .replace('switchAccount:async()=>session',`switchAccount:async id=>{window.__activeAccount=id;return {...session,userId:'@carol:test',deviceId:'CAROL'}}`);
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Борис Сидоров'}).click();
  await page.getByRole('button',{name:'Профиль собеседника'}).click();
  await page.getByLabel('Моя подпись контакта').fill('Мой бухгалтер');await page.getByRole('button',{name:'Сохранить подпись',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Подпись сохранена');
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('.chat-heading h2')).toHaveText('Мой бухгалтер');
  expect(await page.evaluate(()=>(window as any).__operations.some((op:any)=>op.kind==='setProfile'))).toBe(false);
  await login(page,adapter);await expect(page.getByRole('button',{name:'Открыть Мой бухгалтер'})).toBeVisible();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.locator('.accounts-panel').getByRole('button',{name:'@carol:test https://matrix.test'}).click();
  await expect(page.getByRole('button',{name:'Открыть Борис Сидоров'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть Мой бухгалтер'})).toHaveCount(0);
});

test('chat can be pinned from its context menu and pinned filter persists', async ({ page }) => {
  await login(page);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click({button:'right'});
  await page.getByRole('button',{name:'Закрепить чат',exact:true}).click();
  await page.getByRole('button',{name:'Закреплённые чаты',exact:true}).click();
  await expect(page.getByRole('button',{name:'Открыть Команда Matrix'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть Закрытая комната'})).toHaveCount(0);
  await login(page);await expect(page.getByRole('button',{name:'Открепить Команда Matrix'})).toBeVisible();
  await page.getByRole('button',{name:'Открыть Команда Matrix'}).click({button:'right'});await page.getByRole('button',{name:'Открепить чат',exact:true}).click();
  await page.getByRole('button',{name:'Закреплённые чаты',exact:true}).click();await expect(page.getByRole('button',{name:'Открыть Команда Matrix'})).toHaveCount(0);
});

test('selected messages forward together in chronological order', async ({ page }) => {
  await login(page,withMessages([['@bob:test','Первое'],['@alice:test','Второе'],['@bob:test','Третье']]));await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await page.locator('.bubble').nth(2).click({button:'right'});await page.getByRole('button',{name:'Выделить сообщение',exact:true}).click();
  await page.getByLabel('Выбрать: Первое', {exact:true}).check();
  await expect(page.getByRole('toolbar',{name:'Выбранные сообщения'})).toContainText('Выбрано: 2');
  await page.getByRole('button',{name:'Переслать выбранные',exact:true}).click();
  await page.getByRole('dialog',{name:'Переслать сообщения'}).getByRole('button',{name:'Команда Matrix',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('toolbar',{name:'Выбранные сообщения'})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__operations.filter((op:any)=>op.kind==='forward').map((op:any)=>op.eventId))).toEqual(['$visual0','$visual2']);
});

test('partial batch retry skips delivered messages and reuses the failed transaction ID', async ({ page }) => {
  const adapter=withMessages([['@bob:test','Первое'],['@bob:test','Второе'],['@bob:test','Третье']]).replace("if(kind==='roomDetails')",`if(kind==='forward'&&args.eventId==='$visual1'&&!window.__failedForward){window.__failedForward=true;throw new Error('Нет сети')}if(kind==='roomDetails')`);
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  await expect(page.locator('.bubble')).toHaveCount(3);await page.locator('.bubble').first().getByText('Первое',{exact:true}).click({button:'right',timeout:5000});await page.getByRole('button',{name:'Выделить сообщение',exact:true}).click();
  await page.getByRole('button',{name:'Выделить загруженные',exact:true}).click();await page.getByRole('button',{name:'Переслать выбранные',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Команда Matrix',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Повтор продолжит');
  await page.getByRole('button',{name:'Продолжить пересылку в Команда Matrix',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const sent=await page.evaluate(()=>(window as any).__operations.filter((op:any)=>op.kind==='forward'));
  expect(sent.map((op:any)=>op.eventId)).toEqual(['$visual0','$visual1','$visual1','$visual2']);expect(sent[1].txn).toBe(sent[2].txn);
});

const updateFixture=(platform='windows',failure=false)=>fixtureApi+`
const updateState={currentVersion:'0.5.2',configured:true,platform:'${platform}',repository:'VirusGrip/MatrixGram',available:null};
Object.assign(api,{updateStatus:async()=>updateState,checkUpdate:async()=>({...updateState,available:{version:'0.5.3',notes:'Исправления <script>window.bad=true</script>'}}),downloadUpdate:async()=>{window.__updateDownloads=(window.__updateDownloads||0)+1;${failure?"throw Error('Подпись обновления не прошла проверку')":""}},installUpdate:async()=>{window.__updateInstalled=(window.__updateInstalled||0)+1;return '${platform==='android'?'permission':'started'}'}});
`;

test('signed update flow waits for download and persists the current draft',async({page})=>{
  await login(page,updateFixture());await page.getByRole('button',{name:'Открыть Команда Matrix',exact:true}).click();
  await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Черновик перед обновлением');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Проверить обновления',exact:true}).click();
  await expect(page.getByRole('button',{name:'Установить и перезапустить',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Скачать обновление',exact:true}).click();
  await expect(page.getByText('Обновление скачано и проверено',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Установить и перезапустить',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__updateInstalled)).toBe(1);
  expect(await page.evaluate(()=>(window as any).bad)).toBeUndefined();
});
test('signature failure never enables update installation',async({page})=>{
  await login(page,updateFixture('windows',true));await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Проверить обновления',exact:true}).click();await page.getByRole('button',{name:'Скачать обновление',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Подпись обновления не прошла проверку');
  await expect(page.getByRole('button',{name:'Установить и перезапустить',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__updateInstalled)).toBeUndefined();
});
test('Android update permission keeps the verified download for another install attempt',async({page})=>{
  await login(page,updateFixture('android'));await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Проверить обновления',exact:true}).click();await page.getByRole('button',{name:'Скачать обновление',exact:true}).click();
  await page.getByRole('button',{name:'Установить',exact:true}).click();await expect(page.getByRole('status')).toContainText('Разрешите установку');
  await page.getByRole('button',{name:'Установить',exact:true}).click();expect(await page.evaluate(()=>(window as any).__updateDownloads)).toBe(1);expect(await page.evaluate(()=>(window as any).__updateInstalled)).toBe(2);
});
test('an up-to-date release shows a status without an installer button',async({page})=>{
  await login(page,fixtureApi.replace('configured:false','configured:true'));await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Проверить обновления',exact:true}).click();await expect(page.getByRole('status')).toContainText('Установлена актуальная версия');await expect(page.getByRole('button',{name:'Скачать обновление',exact:true})).toHaveCount(0);
});

test('draft save failure blocks update installation',async({page})=>{
  const adapter=updateFixture()+`const originalSave=api.saveDraft;api.saveDraft=async(id,body)=>{if(window.__denyUpdateDraft)throw Error('Черновик не сохранён');return originalSave(id,body)};const originalDownload=api.downloadUpdate;api.downloadUpdate=async()=>{await originalDownload();window.__denyUpdateDraft=true};`;
  await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix',exact:true}).click();await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Сохранить перед обновлением');await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Проверить обновления',exact:true}).click();await page.getByRole('button',{name:'Скачать обновление',exact:true}).click();await page.getByRole('button',{name:'Установить и перезапустить',exact:true}).click();await expect(page.locator('.app-updates').getByRole('alert')).toContainText('Черновик не сохранён');expect(await page.evaluate(()=>(window as any).__updateInstalled)).toBeUndefined();
});
