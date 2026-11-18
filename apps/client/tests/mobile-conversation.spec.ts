import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';

const adapter=fixtureApi+`
rooms[0].name='Козлов Олег';rooms[0].members=2;rooms[0].directUserId='@bob:test';rooms[0].encryption='encrypted';rooms[0].avatarUrl='mxc://test/bob';
encryption={enabled:true,backupReady:true};
const originalOp=api.op;api.op=async(kind,args={})=>kind==='profile'&&!args.userId?{userId:session.userId,displayName:'Alice',avatarUrl:'mxc://test/me'}:originalOp(kind,args);
events=[
 {event_id:'$peer',sender:'@bob:test',type:'m.room.message',origin_server_ts:1000,content:{msgtype:'m.text',body:'Текст собеседника занимает почти всю ширину экрана и остаётся слева.'}},
 {event_id:'$mine',sender:session.userId,type:'m.room.message',origin_server_ts:2000,content:{msgtype:'m.text',body:'Мой длинный ответ занимает почти всю ширину экрана и остаётся справа.'}}
];
`;

test('desktop and phone headers omit encryption text and keep calls, keys, search and info inside the top-right menu',async({page})=>{
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:844});await login(page,adapter);await page.getByRole('button',{name:'Открыть Козлов Олег',exact:true}).click();
    const header=page.locator('.chat-header');await expect(header.locator('h2')).toHaveText('Козлов Олег');await expect(header).not.toContainText('Зашифрованная переписка');
    await expect(page.getByRole('menuitem',{name:'Позвонить',exact:true})).toBeHidden();await expect(header.getByRole('button')).toHaveCount(width>720?3:4);
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();
    const menu=page.getByRole('menu',{name:'Действия с чатом',exact:true});await expect(menu.getByRole('menuitem',{name:'Позвонить',exact:true})).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Видеозвонок',exact:true})).toBeVisible();
    await menu.getByRole('menuitem',{name:'Поиск в загруженных сообщениях'}).click();await expect(menu).toBeHidden();await expect(page.getByPlaceholder('Поиск в загруженной истории')).toBeVisible();await page.getByRole('button',{name:'Закрыть поиск',exact:true}).click();
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();await menu.getByRole('menuitem',{name:'Ключи комнаты',exact:true}).click();await expect(page.getByRole('dialog',{name:'Открыть зашифрованные комнаты',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.getByRole('button',{name:'Меню чата',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();await menu.getByRole('menuitem',{name:'Информация о комнате',exact:true}).click();await expect(page.getByRole('heading',{name:'О комнате',exact:true})).toBeVisible();
  }
});

test.describe('phone conversation',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('wide DM bubbles, compact composer, long-press actions and stable selection at narrow widths',async({page})=>{
    await login(page,adapter);await page.getByRole('button',{name:'Открыть Козлов Олег',exact:true}).click();
    await expect(page.locator('.bubble')).toHaveCount(2);await expect(page.locator('.message-avatar').first()).toBeHidden();await expect(page.locator('.sender')).toBeHidden();await expect(page.locator('.touch-message-menu')).toHaveCount(0);
    const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await expect(page.getByRole('button',{name:'Записать голосовое',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Отправить',exact:true})).toBeHidden();
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      const bubbles=await page.locator('.bubble').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,right:b.right,width:b.width};}));
      expect(bubbles[0].x).toBeLessThan(bubbles[1].x);expect(bubbles[0].width).toBeGreaterThan(width*.8);expect(bubbles[1].right).toBeGreaterThan(width-20);
      expect((await input.boundingBox())!.width).toBeGreaterThan(width*.45);
    }
    await input.fill('Отправить');await expect(page.getByRole('button',{name:'Записать голосовое',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Отправить',exact:true})).toBeVisible();
    const bubble=page.locator('.bubble').first(),menu=page.getByRole('menu',{name:'Действия с сообщением',exact:true});
    await bubble.tap();await expect(menu).toHaveCount(0);
    const down={pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:70,clientY:240};
    await bubble.dispatchEvent('pointerdown',down);await bubble.dispatchEvent('pointermove',{...down,clientY:270});await bubble.dispatchEvent('pointerup',down);await page.waitForTimeout(500);await expect(menu).toHaveCount(0);
    const before=await bubble.boundingBox(),headerHeight=(await page.locator('.chat-header').boundingBox())!.height;
    await bubble.dispatchEvent('pointerdown',down);await expect(menu).toBeVisible();await bubble.dispatchEvent('pointerup',down);
    await menu.getByRole('menuitem',{name:'Выделить сообщение',exact:true}).click();await expect(page.getByRole('toolbar',{name:'Выбранные сообщения'})).toContainText('Выбрано: 1');
    const after=await bubble.boundingBox();expect(after!.x).toBeCloseTo(before!.x,0);expect(after!.width).toBeCloseTo(before!.width,0);expect(after!.y).toBeCloseTo(before!.y,0);expect((await page.locator('.selection-toolbar').boundingBox())!.height).toBeCloseTo(headerHeight,0);
    await page.getByRole('button',{name:'Отменить выделение',exact:true}).click();
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Форматирование Markdown',exact:true}).click();
    await page.getByRole('button',{name:'Меню чата',exact:true}).click();await expect(page.getByRole('menuitemcheckbox',{name:'Форматирование Markdown',exact:true})).toBeChecked();
  });
});
