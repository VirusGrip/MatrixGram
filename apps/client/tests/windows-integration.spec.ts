import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
const available={supported:true,active:false,setupAvailable:true,configured:false};
const adapter=fixtureApi+`api.windowsIntegration=async()=>(${JSON.stringify(available)});`;

test('Windows setup remains opt-in and reports restart after registration',async({page})=>{
  await login(page,adapter+`window.__setupCalls=0;api.configureWindowsIntegration=async()=>{window.__setupCalls++;return {...await api.windowsIntegration(),configured:true}};`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Группировка процессов Windows'});
  await expect(panel.getByRole('button',{name:'Настроить группировку',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__setupCalls)).toBe(0);
  await panel.getByRole('button',{name:'Настроить группировку',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Полностью выйдите из MatrixGram');
  await expect(panel).not.toContainText('Включена для этого запуска');
  expect(await page.evaluate(()=>(window as any).__setupCalls)).toBe(1);
});

test('cancelled Windows setup keeps the option available without claiming success',async({page})=>{
  await login(page,adapter+`api.configureWindowsIntegration=async()=>await api.windowsIntegration();`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Группировка процессов Windows'});
  await panel.getByRole('button',{name:'Настроить группировку',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('Настройка отменена.');
  await expect(panel).not.toContainText('Настройка сохранена');
});

test('failed Windows setup reports the error and permits retry',async({page})=>{
  await login(page,adapter+`api.configureWindowsIntegration=async()=>{throw Error('Пользователь отменил UAC')};`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Группировка процессов Windows'});
  await panel.getByRole('button',{name:'Настроить группировку',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('Пользователь отменил UAC');
  await expect(panel.getByRole('button',{name:'Настроить группировку',exact:true})).toBeEnabled();
  await expect(panel).not.toContainText('Настройка сохранена');
});

test('packaged Windows process shows native activation without another setup',async({page})=>{
  await login(page,adapter+`api.windowsIntegration=async()=>({...${JSON.stringify(available)},active:true,configured:true});`);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const panel=page.getByRole('region',{name:'Группировка процессов Windows'});
  await expect(panel).toContainText('Включена для этого запуска MatrixGram.');
  await expect(panel.getByRole('button')).toHaveCount(0);
});

test('unsupported platforms have no Windows grouping controls',async({page})=>{
  await login(page,fixtureApi);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.getByRole('region',{name:'Группировка процессов Windows'})).toHaveCount(0);
});
