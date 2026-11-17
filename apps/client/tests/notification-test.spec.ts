import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';

test('desktop notification test requests permission and uses a local activation target',async({page})=>{
  await login(page,fixtureApi+`window.__testNotifications=[];api.requestNotifications=async()=>true;api.notify=async(title,body,target)=>window.__testNotifications.push({title,body,target});`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Тестовое уведомление',exact:true}).click();
  await expect(page.getByText('Тестовое уведомление передано системе.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__testNotifications)).toEqual([{title:'MatrixGram',body:'Тест системных уведомлений MatrixGram.',target:{kind:'updates'}}]);
});

test('denied notification permission is reported without claiming delivery',async({page})=>{
  await login(page,fixtureApi+`window.__testNotifications=0;api.requestNotifications=async()=>false;api.notify=async()=>{window.__testNotifications++};`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Тестовое уведомление',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Разрешите уведомления в настройках системы'})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__testNotifications)).toBe(0);
  await expect(page.getByText('Тестовое уведомление передано системе.',{exact:true})).toHaveCount(0);
});
