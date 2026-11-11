import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureApi, login } from './fixtures';

const roomCount = 5000, historySize = 20000;
const burstCount = Math.floor(Math.max(1, Math.min(1000, Number(process.env.MATRIXGRAM_LOAD_BURSTS) || 40)));
const adapter = fixtureApi.replace(/const rooms = \[[\s\S]*?\n\];/, `const rooms = Array.from({length:${roomCount}},(_,i)=>({id:'!load'+i+':test',name:'Нагрузка '+String(i).padStart(5,'0'),topic:null,membership:'joined',encryption:'unencrypted',unread:0,members:2000,lastBody:'Последнее сообщение',lastTs:1000}));`)+`
const makeEvent=(i,room='0')=>({event_id:'$load'+room+'-'+i,sender:'@user'+(i%2000)+':test',type:'m.room.message',origin_server_ts:10000+i,content:{msgtype:'m.text',body:'Сообщение '+i,...(i>0&&i%10===0?{'m.relates_to':{'m.in_reply_to':{event_id:'$load'+room+'-'+(i-1)}}}:{})}});
const history=Array.from({length:${historySize}},(_,i)=>makeEvent(i));
Object.assign(api,{cached:async()=>[], history:async id=>({roomId:id,events:history,next:null}),op:async(kind)=>kind==='roomDetails'?{members:Array.from({length:2000},(_,i)=>({userId:'@user'+i+':test',name:'Участник '+i,power:0,membership:'join'})),pinned:[],canSend:true,myPower:0}:kind==='turn'?{urls:[]}:null});
window.__seedLoad=()=>updates.forEach(callback=>callback(session.userId+'|'+session.deviceId,{rooms:rooms.map(r=>({...r})),timelines:Array.from({length:200},(_,r)=>({roomId:'!load'+(r+1)+':test',events:Array.from({length:200},(_,i)=>makeEvent(i,String(r+1))),next:null})),ephemeral:[{roomId:'!load0:test',type:'m.receipt',content:Object.fromEntries(history.slice(-1000).map(e=>[e.event_id,{'m.read':{'@reader:test':{}}}]))}],connection:'online',error:null}));
window.__publishLoad=i=>updates.forEach(callback=>callback(session.userId+'|'+session.deviceId,{rooms:rooms.map(r=>({...r})),timelines:[{roomId:'!load'+(1+i%200)+':test',events:Array.from({length:25},(_,n)=>makeEvent(200+i*25+n,String(1+i%200))),next:null}],connection:'online',error:null}));
`;

test('5000 rooms, 60000 events, sync bursts, search and navigation remain usable', async ({page,context},testInfo)=>{
  test.setTimeout(Math.max(120_000, burstCount * 3000));
  const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(()=>{
    (window as any).__loadStarted=performance.now();
    (window as any).__longTasks=[];
    new PerformanceObserver(list=>{for(const entry of list.getEntries())(window as any).__longTasks.push(entry.duration)}).observe({entryTypes:['longtask']});
  });
  await login(page,adapter);
  await page.getByRole('button',{name:'Открыть Нагрузка 00000',exact:true}).click();
  await expect(page.locator('.timeline').getByText('Сообщение 19999',{exact:true})).toBeVisible();
  const startupMs=await page.evaluate(()=>performance.now()-(window as any).__loadStarted);
  await page.evaluate(()=>new Promise<void>(resolve=>{(window as any).__seedLoad();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))}));
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore=await cdp.send('Runtime.getHeapUsage');
  const syncMs=await page.evaluate(async count=>{
    const samples:number[]=[];
    for(let i=0;i<count;i++) {const start=performance.now();(window as any).__publishLoad(i);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));samples.push(performance.now()-start)}
    return samples;
  },burstCount);
  const searchStart=await page.evaluate(()=>performance.now());
  await page.getByLabel('Найти чат',{exact:true}).fill('Нагрузка 04999');
  await expect(page.getByRole('button',{name:'Открыть Нагрузка 04999',exact:true})).toBeVisible();
  const searchMs=await page.evaluate(start=>performance.now()-start,searchStart);
  await page.getByRole('button',{name:'Открыть Нагрузка 04999',exact:true}).click();
  await expect(page.locator('.timeline').getByText('Сообщение 19999',{exact:true})).toBeVisible();
  await page.getByLabel('Найти чат',{exact:true}).fill('');
  expect(await page.locator('.room-row').count()).toBeLessThan(45);
  expect(await page.locator('.message-slot').count()).toBeLessThan(100);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter=await cdp.send('Runtime.getHeapUsage');
  const longTasks=await page.evaluate(()=>(window as any).__longTasks as number[]);
  const sorted=[...syncMs].sort((a,b)=>a-b);
  const report={rooms:roomCount,seedEvents:60000,burstCount,cpuThrottle:4,startupMs,searchMs,syncMedianMs:sorted[Math.floor(sorted.length/2)],syncP95Ms:sorted[Math.floor(sorted.length*.95)],syncMaxMs:sorted.at(-1),heapBeforeBytes:heapBefore.usedSize,heapAfterBytes:heapAfter.usedSize,longTaskCount:longTasks.length,longTaskMaxMs:Math.max(0,...longTasks),browser:testInfo.project.use.browserName||'chromium',fixture:'local IPC; Vite development build; not Synapse or native WebView2'};
  mkdirSync('performance-results',{recursive:true});
  const label=(process.env.MATRIXGRAM_PERF_LABEL||'current').replace(/[^a-z0-9-]/gi,'');
  writeFileSync('performance-results/browser-'+label+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  expect(errors).toEqual([]);
  expect(report.syncP95Ms).toBeLessThan(5000);
  expect(searchMs).toBeLessThan(5000);
  expect(heapAfter.usedSize-heapBefore.usedSize).toBeLessThan(80*1024*1024);
});

test('200 encrypted room previews load with bounded concurrency and no read receipts', async ({page})=>{
  const encrypted=fixtureApi.replace(/const rooms = \[[\s\S]*?\n\];/, `const rooms=Array.from({length:200},(_,i)=>({id:'!encrypted'+i+':test',name:'Закрытый '+i,topic:null,membership:'joined',encryption:'encrypted',unread:0,members:2,lastBody:null,lastTs:i}));`)+`
  window.__loadActive=0;window.__loadMax=0;window.__loadDone=0;window.__loadReads=0;
  Object.assign(api,{cached:async()=>[],history:async id=>{window.__loadActive++;window.__loadMax=Math.max(window.__loadMax,window.__loadActive);await new Promise(resolve=>setTimeout(resolve,5));window.__loadActive--;window.__loadDone++;return {roomId:id,events:Array.from({length:50},(_,i)=>({event_id:'$'+id+i,sender:'@bob:test',type:'m.room.message',origin_server_ts:i,content:{body:'Закрытое сообщение '+i}})),next:null}},read:async()=>{window.__loadReads++}});
  `;
  await login(page,encrypted);
  await page.getByRole('button',{name:'Открыть зашифрованные комнаты',exact:true}).click();
  await page.getByRole('button',{name:'Открыть доступные сообщения без ключа'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__loadDone),{timeout:20000}).toBe(200);
  expect(await page.evaluate(()=>(window as any).__loadMax)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>(window as any).__loadReads)).toBe(0);
  await expect(page.getByRole('button',{name:'Открыть Закрытый 0',exact:true})).toContainText('Закрытое сообщение 49');
  expect(await page.locator('.room-row').count()).toBeLessThan(45);
});
