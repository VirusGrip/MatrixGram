import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
const report={supported:true,sampledAtMs:Date.now(),totalPrivateBytes:200*1024*1024,unavailable:0,processes:[
  {pid:11,name:'matrixgram.exe',isMain:true,privateBytes:30*1024*1024},
  {pid:22,name:'msedgewebview2.exe',isMain:false,privateBytes:120*1024*1024},
  {pid:33,name:'msedgewebview2.exe',isMain:false,privateBytes:50*1024*1024}
]};
const adapter=fixtureApi+`api.memoryUsage=async()=>{window.__memoryCalls=(window.__memoryCalls||0)+1;return ${JSON.stringify(report)}};`;
test('memory panel includes WebView2 in the total and displays every process',async({page})=>{
  await login(page,adapter);await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Память приложения'});
  await expect(panel.locator('.memory-total strong')).toHaveText('200');
  await expect(panel).toContainText('процессы: 3');
  await panel.getByText('По процессам',{exact:true}).click();
  await expect(panel.locator('tbody tr')).toHaveCount(3);
  await expect(panel.locator('tbody')).toContainText('120');
});
test('polling stops when settings close and manual refresh does not leave background timers',async({page})=>{
  await login(page,adapter);await page.clock.install();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Память приложения'});
  await expect(panel.locator('.memory-total strong')).toHaveText('200');
  const initial=await page.evaluate(()=>(window as any).__memoryCalls);
  await page.clock.runFor(5100);
  await expect.poll(()=>page.evaluate(()=>(window as any).__memoryCalls)).toBe(initial+1);
  await panel.getByRole('button',{name:'Обновить замер',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__memoryCalls)).toBe(initial+2);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.clock.runFor(15000);
  expect(await page.evaluate(()=>(window as any).__memoryCalls)).toBe(initial+2);
});
test('inaccessible processes are visibly excluded rather than reported as zero',async({page})=>{
  const partial={...report,totalPrivateBytes:80*1024*1024,unavailable:1,processes:report.processes.map(p=>p.pid===22?{...p,privateBytes:null}:p)};
  await login(page,fixtureApi+`api.memoryUsage=async()=>(${JSON.stringify(partial)});`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Память приложения'});
  await expect(panel).toContainText('измерено частично');await expect(panel).toContainText('Для 1 процессов Windows не вернула данные');
  await panel.getByText('По процессам',{exact:true}).click();await expect(panel.locator('tbody')).toContainText('Недоступно');
});
test('a native measurement error does not leave an old total on screen',async({page})=>{
  await login(page,adapter+`const memory=api.memoryUsage;api.memoryUsage=()=>window.__denyMemory?Promise.reject(Error('Счётчик недоступен')):memory();`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Память приложения'});
  await expect(panel.locator('.memory-total strong')).toHaveText('200');
  await page.evaluate(()=>{(window as any).__denyMemory=true});
  await panel.getByRole('button',{name:'Обновить замер',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('Счётчик недоступен');await expect(panel.locator('.memory-total')).toHaveCount(0);
});
test('hidden windows pause memory sampling and becoming visible resumes it',async({page})=>{
  await login(page,adapter);await page.clock.install();
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>!!(window as any).__memoryHidden}));
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.locator('.memory-total strong')).toHaveText('200');
  const initial=await page.evaluate(()=>(window as any).__memoryCalls);
  await page.evaluate(()=>{(window as any).__memoryHidden=true;document.dispatchEvent(new Event('visibilitychange'))});
  await page.clock.runFor(15000);expect(await page.evaluate(()=>(window as any).__memoryCalls)).toBe(initial);
  await page.evaluate(()=>{(window as any).__memoryHidden=false;document.dispatchEvent(new Event('visibilitychange'))});
  await expect.poll(()=>page.evaluate(()=>(window as any).__memoryCalls)).toBe(initial+1);
});
