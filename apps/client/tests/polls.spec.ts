import {test,expect} from '@playwright/test';
import {fixtureApi,login} from './fixtures';
const adapter=fixtureApi+`
const poll={event_id:'$poll',type:'org.matrix.msc3381.poll.start',sender:'@bob:test',origin_server_ts:1000,content:{'org.matrix.msc3381.poll.start':{kind:'org.matrix.msc3381.poll.disclosed',max_selections:2,question:{'org.matrix.msc1767.text':'Что закажем?'},answers:[{id:'a','org.matrix.msc1767.text':'Пицца'},{id:'b','org.matrix.msc1767.text':'Суп'}]}}};
events=[poll];let responses=[],fail=true;
window.__closePoll=()=>{responses.push({event_id:'$end',type:'org.matrix.msc3381.poll.end',sender:'@bob:test',origin_server_ts:4000,content:{'m.relates_to':{rel_type:'m.reference',event_id:'$poll'},'org.matrix.msc3381.poll.end':{}}});events=[poll,...responses];publish('!plain:test')};
const originalOp=api.op;api.op=async(kind,args={})=>{
 if(kind==='pollPage')return {events:[poll,...responses],next:!args.from&&!window.__allVotes?'page2':null,authorizedEnds:[],missingKeys:false,canVote:true};
 if(kind==='pollVote'){
  window.__votes=[...(window.__votes||[]),args];if(fail){fail=false;throw Error('Тест: нет сети')}
  window.__allVotes=true;const id='$'+args.txn;responses=responses.filter(e=>e.event_id!==id);responses.push({event_id:id,type:'org.matrix.msc3381.poll.response',sender:session.userId,origin_server_ts:2000+responses.length,content:{'m.relates_to':{rel_type:'m.reference',event_id:'$poll'},'org.matrix.msc3381.poll.response':{answers:args.answers}}});events=[poll,...responses];publish(args.roomId);return id;
 }return originalOp(kind,args);
};
`;
test('Element poll on desktop and phone: pagination, retry, multi-choice, withdrawal and live closing',async({page})=>{
 for(const width of [1280,360]){
  await page.setViewportSize({width,height:844});await login(page,adapter);await page.getByRole('button',{name:'Открыть Команда Matrix'}).click();
  const poll=page.getByRole('region',{name:'Опрос: Что закажем?'});await expect(poll).toBeVisible();await expect(poll.getByRole('button',{name:'Голосовать',exact:true})).toBeDisabled();await poll.getByRole('button',{name:'Загрузить ещё голоса'}).click();
  await poll.getByLabel('Пицца').check();await poll.getByRole('button',{name:'Голосовать',exact:true}).click();await expect(poll.getByRole('alert')).toContainText('нет сети');
  await poll.getByRole('button',{name:'Голосовать',exact:true}).click();await expect(poll).toContainText('1 проголосовало');
  const votes=await page.evaluate(()=>(window as any).__votes);expect(votes[0].txn).toBe(votes[1].txn);
  await poll.getByLabel('Суп').check();await poll.getByRole('button',{name:'Изменить голос',exact:true}).click();await expect(poll.getByLabel('Суп')).toBeChecked();await poll.getByRole('button',{name:'Отозвать голос',exact:true}).click();await expect(poll).toContainText('0 проголосовало');
  await page.evaluate(()=>(window as any).__closePoll());await expect(poll).toContainText('Опрос завершён');await expect(poll.getByRole('button',{name:'Голосовать',exact:true})).toHaveCount(0);await expect(page.locator('.message-list .bubble')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
 }
});
