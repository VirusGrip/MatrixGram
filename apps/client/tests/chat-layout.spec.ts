import {test,expect,type Page} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
const adapter=fixtureApi+`
profiles[0].avatarUrl='mxc://test/me';profiles[1].avatarUrl='mxc://test/bob';
const originalOp=api.op;api.op=async(kind,args={})=>kind==='profile'&&!args.userId?{userId:session.userId,displayName:'Alice',avatarUrl:'mxc://test/me'}:originalOp(kind,args);
events=[
 {event_id:'$other',sender:'@bob:test',type:'m.room.message',origin_server_ts:1000,content:{msgtype:'m.text',body:'Ответ собеседника'}},
 {event_id:'$mine',sender:session.userId,type:'m.room.message',origin_server_ts:2000,content:{msgtype:'m.text',body:'Моё сообщение'}},
 {event_id:'$image',sender:session.userId,type:'m.room.message',origin_server_ts:3000,content:{msgtype:'m.image',body:'picture.svg',url:'mxc://test/picture',info:{mimetype:'image/svg+xml',size:200}}}
];
api.media=async source=>({data:source.url==='mxc://test/picture'?btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#5288b5"/></svg>'):pixel});
api.react=async(room,id,emoji)=>{window.__reaction={room,id,emoji}};
`;
async function open(page:Page){await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await expect(page.locator('.image-preview img')).toBeVisible();}
async function boxes(page:Page){return page.locator('.message-row .bubble').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,right:b.right}}));}

test('own messages and avatars stay right, peers left; selecting text and photos does not move them on desktop or phone',async({page})=>{
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);await open(page);
    await expect.poll(()=>page.locator('.outgoing .message-avatar img').evaluateAll(images=>images.some(image=>(image as HTMLImageElement).naturalWidth>0))).toBe(true);
    const before=await boxes(page),timeline=await page.locator('.timeline').boundingBox();
    expect(before[0].right).toBeLessThan(before[1].right);expect(before[1].right).toBeGreaterThan(timeline!.x+timeline!.width*.65);
    const avatar=await page.locator('.outgoing .message-avatar').last().boundingBox();expect(avatar!.x).toBeGreaterThan(before[2].right);
    const headerHeight=(await page.locator('.chat-header').boundingBox())!.height;
    await page.locator('.bubble').nth(2).click({button:'right'});await page.getByRole('menuitem',{name:'Выделить сообщение',exact:true}).click();
    await page.getByLabel('Выбрать: Моё сообщение',{exact:true}).check();
    await expect(page.getByRole('toolbar',{name:'Выбранные сообщения'})).toContainText('Выбрано: 2');
    expect((await page.locator('.selection-toolbar').boundingBox())!.height).toBeCloseTo(headerHeight,0);
    const after=await boxes(page);for(let i=0;i<before.length;i++){expect(after[i].x).toBeCloseTo(before[i].x,0);expect(after[i].width).toBeCloseTo(before[i].width,0);expect(after[i].y).toBeCloseTo(before[i].y,0);}
    await page.getByRole('button',{name:'Отменить выделение',exact:true}).click();
    expect((await boxes(page))[2].x).toBeCloseTo(before[2].x,0);
  }
});

test('composer grows for newlines, wrapping, edits and restored drafts, then shrinks after sending',async({page})=>{
  await page.setViewportSize({width:900,height:700});await login(page,adapter+`const originalSend=api.send;api.send=(...args)=>new Promise(resolve=>{window.__finishSend=()=>resolve(originalSend(...args))});`);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Строка');const small=(await input.boundingBox())!.height;
  await input.press('End');await input.press('Shift+Enter');await input.press('Shift+Enter');await input.pressSequentially('Ещё строка');expect((await input.boundingBox())!.height).toBeGreaterThan(small);
  await input.fill('Длинный текст '.repeat(300));const tall=(await input.boundingBox())!.height;expect(tall).toBeGreaterThan(small);expect(tall).toBeLessThanOrEqual(176);expect(await input.evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
  await input.fill('');expect((await input.boundingBox())!.height).toBeCloseTo(small,0);
  await page.locator('.bubble.mine').first().click({button:'right'});await page.getByRole('menuitem',{name:'Редактировать',exact:true}).click();await expect(input).toHaveValue('Моё сообщение');await page.getByRole('button',{name:'Отменить ответ или редактирование'}).click();
  await input.fill('Отправить');await input.press('Enter');await expect(page.locator('.pending')).toBeVisible();const waiting=await page.locator('.pending').boundingBox(),area=await page.locator('.timeline').boundingBox();expect(waiting!.x+waiting!.width).toBeGreaterThan(area!.x+area!.width*.65);await page.evaluate(()=>(window as any).__finishSend());await expect(input).toHaveValue('');expect((await input.boundingBox())!.height).toBeCloseTo(small,0);
  await login(page,adapter+`api.draft=async()=>Array(5).fill('Сохранённый черновик').join(String.fromCharCode(10));`);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await expect(input).toHaveValue(/Сохранённый черновик/);expect((await input.boundingBox())!.height).toBeGreaterThan(small);
});

test('anchored message menu stays inside a zoomed viewport and handles reactions, actions and Escape',async({page})=>{
  await page.setViewportSize({width:1000,height:720});await open(page);await page.evaluate(()=>document.documentElement.style.setProperty('--ui-scale','1.25'));
  const own=page.locator('.bubble.mine').first();
  await own.dispatchEvent('contextmenu',{clientX:998,clientY:718});const menu=page.getByRole('menu',{name:'Действия с сообщением',exact:true});await expect(menu).toBeVisible();
  const rect=await menu.boundingBox();expect(rect!.x+rect!.width).toBeLessThanOrEqual(1000);expect(rect!.y+rect!.height).toBeLessThanOrEqual(720);expect(rect!.x).toBeGreaterThanOrEqual(0);
  await expect(menu.getByRole('menuitem',{name:'Ответить',exact:true})).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Удалить',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
  await own.click({button:'right'});await menu.getByRole('menuitem',{name:'Ещё реакции',exact:true}).click();await menu.getByRole('menuitem',{name:'Реакция 🙏',exact:true}).click();await expect(menu).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__reaction)).toMatchObject({id:'$mine',emoji:'🙏'});
  await own.click({button:'right'});await menu.getByRole('menuitem',{name:'Удалить',exact:true}).click();await expect(page.getByRole('dialog',{name:'Удалить сообщение?'})).toBeVisible();await page.getByRole('button',{name:'Отмена',exact:true}).click();
});