import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
test('pinned banner cycles, loads an older pinned message and follows state-only removal',async({page})=>{
  await login(page,fixtureApi+`
    pinned=['$hello','$old'];const originalOp=api.op;api.op=async(kind,args)=>kind==='pinned'?[...pinned]:kind==='event'?{event_id:'$old',type:'m.room.message',sender:'@bob:test',origin_server_ts:500,content:{msgtype:'m.text',body:'Старый закреп вне страницы'}}:originalOp(kind,args);
    window.__pins=ids=>{pinned=ids;updates.forEach(update=>update(session.userId+'|'+session.deviceId,{rooms,timelines:[{roomId:'!plain:test',events:[{event_id:'$pin-'+Date.now(),type:'m.room.pinned_events',sender:session.userId,origin_server_ts:Date.now(),content:{pinned:ids}}]}],connection:'online'}));};
  `);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  const bar=page.getByLabel('Закреплённые сообщения',{exact:true});await expect(bar).toContainText('1/2');await bar.locator('.pinned-link').click();await expect(page.locator('.bubble.highlight')).toContainText('Привет, команда!');
  await bar.getByRole('button',{name:'Следующий закреп'}).click();await expect(bar).toContainText('Старый закреп вне страницы');await bar.locator('.pinned-link').click();await expect(page.locator('.bubble.highlight')).toContainText('Старый закреп вне страницы');
  await page.evaluate(()=>(window as any).__pins([]));await expect(bar).toHaveCount(0);
});
test('full local emoji picker searches Russian and stays open until outside or trigger click',async({page})=>{
  const external:string[]=[];page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:1420'))external.push(request.url());});
  await login(page);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('До После');await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(3,3));
  const trigger=page.getByRole('button',{name:'Эмодзи',exact:true}),panel=page.getByRole('dialog',{name:'Выбор эмодзи',exact:true});await trigger.click();await panel.getByRole('textbox',{name:'Поиск эмодзи',exact:true}).fill('арбуз');
  await expect(panel.locator('[data-epr-part="emoji"]').first()).toHaveAccessibleName(/арбуз/i);await panel.locator('[data-epr-part="emoji"]').first().click();await expect(input).toHaveValue('До 🍉После');await expect(panel).toBeVisible();
  await panel.getByRole('textbox',{name:'Поиск эмодзи',exact:true}).click();await expect(panel).toBeVisible();await trigger.click();await expect(panel).toHaveCount(0);
  await trigger.click();await expect(panel).toBeVisible();await input.click();await expect(panel).toHaveCount(0);expect(external).toEqual([]);
});
test.describe('image gestures',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('viewer supports buttons, wheel, drag, reset and a two-finger pinch',async({page})=>{
    await login(page,fixtureApi+`events=[{event_id:'$image',sender:'@bob:test',type:'m.room.message',origin_server_ts:1000,content:{msgtype:'m.image',body:'photo.png',url:'mxc://test/photo',info:{mimetype:'image/png',size:50}}}];`);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();await page.getByRole('button',{name:'Открыть изображение photo.png'}).click();
    const dialog=page.getByRole('dialog',{name:'photo.png',exact:true}),zoom=dialog.getByLabel('Масштаб изображения');await expect(zoom).toHaveText('100%');await dialog.getByRole('button',{name:'Увеличить изображение',exact:true}).click();await expect(zoom).toHaveText('150%');
    const viewport=dialog.locator('.image-viewport'),box=(await viewport.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);await expect(zoom).not.toHaveText('150%');
    await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+15);await page.mouse.up();await expect(viewport.locator('img')).not.toHaveCSS('transform',/matrix\([^,]+, 0, 0, [^,]+, 0, 0\)/);
    await dialog.getByRole('button',{name:'Сбросить масштаб'}).click();await expect(zoom).toHaveText('100%');
    const cdp=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-55,y,id:1},{x:x+55,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(zoom).not.toHaveText('100%');await cdp.detach();
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(dialog).toHaveCount(0);
  });
});
