import type {MatrixEvent} from './models';
export const pollStart=(type:string)=>['org.matrix.msc3381.poll.start','m.poll.start'].includes(type);
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function pollText(value:unknown):string {
  const c=record(value),text=c['org.matrix.msc1767.text']??c['m.text']??c.body;
  if(typeof text==='string')return text;
  return Array.isArray(text)?String(record(text.find(v=>!record(v).mimetype||record(v).mimetype==='text/plain')).body??''):'';
}
export interface Poll {question:string;answers:{id:string;text:string}[];max:number;disclosed:boolean;revision?:string}
export function parsePoll(content:unknown):Poll|undefined {
  const c=record(content),p=record(c['m.poll']??c['org.matrix.msc3381.poll.start']??c['m.poll.start']);
  const question=pollText(p.question).slice(0,16000),ids=new Set<string>();
  if(!question||!Array.isArray(p.answers))return;
  const answers=p.answers.slice(0,20).map(value=>{const a=record(value);return {id:a['m.id']??a.id,text:pollText(a).slice(0,16000)};});
  if(!answers.length||answers.some(a=>typeof a.id!=='string'||!a.id||a.id.length>512||!a.text||ids.has(a.id)||!ids.add(a.id)))return;
  return {question,answers:answers as Poll['answers'],max:typeof p.max_selections==='number'&&Number.isSafeInteger(p.max_selections)&&p.max_selections>0?Math.min(p.max_selections,answers.length):1,disclosed:['m.disclosed','m.poll.disclosed','org.matrix.msc3381.poll.disclosed'].includes(String(p.kind))};
}
export function pollResult(id:string,author:string,poll:Poll,events:MatrixEvent[],user:string,authorizedEnds:string[]){
  const removed=new Set(events.filter(e=>e.unsigned?.redacted_because).map(e=>e.event_id));
  for(const e of events)if(e.type==='m.room.redaction')removed.add(e.redacts??String(e.content.redacts??''));
  const related=events.filter(e=>!removed.has(e.event_id)&&record(e.content['m.relates_to']).event_id===id&&record(e.content['m.relates_to']).rel_type==='m.reference').sort((a,b)=>a.origin_server_ts-b.origin_server_ts||a.event_id.localeCompare(b.event_id));
  const end=related.find(e=>['m.poll.end','org.matrix.msc3381.poll.end'].includes(e.type)&&(e.sender===author||authorizedEnds.includes(e.event_id)));
  const votes=new Map<string,string[]>(),options=new Set(poll.answers.map(a=>a.id));
  for(const event of related){
    if(!['m.poll.response','org.matrix.msc3381.poll.response'].includes(event.type)||(end&&event.origin_server_ts>end.origin_server_ts))continue;
    const answers=event.content['m.selections']??record(event.content['org.matrix.msc3381.poll.response']??event.content['m.poll.response']).answers;
    const valid=Array.isArray(answers)&&answers.every(a=>typeof a==='string'&&options.has(a));
    votes.set(event.sender,valid?[...new Set(answers.slice(0,poll.max) as string[])]:[]);
  }
  const counts=new Map(poll.answers.map(a=>[a.id,0]));let total=0;
  for(const selection of votes.values()){if(selection.length)total++;for(const answer of selection)counts.set(answer,counts.get(answer)!+1);}
  return {closed:!!end,counts,total,mine:votes.get(user)??[],hasVoted:votes.has(user),showResults:poll.disclosed||!!end};
}
