import {describe,it,expect} from 'vitest';
import {parsePoll,pollResult} from './polls';
import {projectTimeline} from './timeline';
import type {MatrixEvent} from './models';
const start:MatrixEvent={event_id:'$poll',type:'org.matrix.msc3381.poll.start',sender:'@owner:t',origin_server_ts:1,content:{'org.matrix.msc3381.poll.start':{question:{'org.matrix.msc1767.text':'Обед?'},kind:'org.matrix.msc3381.poll.disclosed',max_selections:2,answers:[{id:'a','org.matrix.msc1767.text':'Пицца'},{id:'b','org.matrix.msc1767.text':'Суп'}]}}};
const vote=(id:string,sender:string,ts:number,answers:unknown):MatrixEvent=>({event_id:id,sender,origin_server_ts:ts,type:'org.matrix.msc3381.poll.response',content:{'m.relates_to':{rel_type:'m.reference',event_id:'$poll'},'org.matrix.msc3381.poll.response':{answers}}});
describe('poll compatibility and tally',()=>{
  it('renders Element and stable starts, edits and redactions without separate vote messages',()=>{
    const stable={...start,type:'m.poll.start',content:{'m.poll':{question:{'m.text':[{body:'Встреча?'}]},answers:[{'m.id':'yes','m.text':[{body:'Да'}]}]}}};
    expect(projectTimeline([start,vote('$v','@a:t',2,['a'])])).toHaveLength(1);
    expect(projectTimeline([stable])[0].poll?.question).toBe('Встреча?');
    const edit={...start,event_id:'$edit',origin_server_ts:3,content:{'m.relates_to':{rel_type:'m.replace',event_id:'$poll'},'m.new_content':{...start.content,'org.matrix.msc3381.poll.start':{...start.content['org.matrix.msc3381.poll.start'] as object,question:{'m.text':'Ужин?'}}}}};
    expect(projectTimeline([start,edit])[0].poll).toMatchObject({question:'Ужин?',revision:'$edit'});
    expect(projectTimeline([{...start,unsigned:{redacted_because:{}}}])[0].poll).toBeUndefined();
    expect(parsePoll({'m.poll':{question:{'m.text':'?'},answers:[{id:'x','m.text':'A'},{id:'x','m.text':'B'}]}})).toBeUndefined();
  });
  it('counts latest unique votes, spoiled answers, withdrawal, redactions and authorized closing',()=>{
    const poll=parsePoll(start.content)!;
    const events=[vote('$a','@a:t',2,['a','a']),vote('$b','@b:t',3,['b']),vote('$bad','@a:t',4,['b','unknown']),vote('$withdraw','@b:t',4,[])];
    expect(pollResult('$poll',start.sender,poll,events,'@a:t',[]).total).toBe(0);
    events.push({event_id:'$redact',type:'m.room.redaction',sender:'@owner:t',origin_server_ts:5,content:{},redacts:'$bad'});
    expect(pollResult('$poll',start.sender,poll,events,'@a:t',[]).counts.get('a')).toBe(1);
    const end:MatrixEvent={event_id:'$end',type:'org.matrix.msc3381.poll.end',sender:'@mod:t',origin_server_ts:5,content:{'m.relates_to':{rel_type:'m.reference',event_id:'$poll'},'org.matrix.msc3381.poll.end':{}}};
    events.push(end,vote('$late','@a:t',6,['b']));
    expect(pollResult('$poll',start.sender,poll,events,'@a:t',[]).closed).toBe(false);
    expect(pollResult('$poll',start.sender,poll,events,'@a:t',['$end'])).toMatchObject({closed:true,total:1,mine:['a']});
    expect(pollResult('$poll',start.sender,{...poll,disclosed:false},[], '@a:t',[]).showResults).toBe(false);
  });
});
