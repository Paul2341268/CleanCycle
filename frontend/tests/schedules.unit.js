import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,commit,validateState,recommend,nextWeekday,STORAGE_KEY} from '../src/personal.js';

function storage(state=emptyState()) {
  let raw=JSON.stringify(state);
  return {getItem:key=>key===STORAGE_KEY?raw:null,setItem:(key,value)=>{raw=value;}};
}
const weekly={title:'재활용 배출',room:'집 전체·여러 공간',kind:'waste',interval_days:7,repeat_mode:'weekly',weekdays:[1,4],due_date:'2026-10-01',notes:'건물 앞',time:'20:00'};
test('weekly completion, overdue completion, postponement and undo preserve weekdays',()=>{
  for(const day of ['2026-10-01','2026-10-02']) {
    const db=storage();let state=commit(db,{type:'save',task:weekly},'2026-10-01');
    state=commit(db,{type:'complete',task:state.tasks[0]},day);
    assert.equal(state.tasks[0].due_date,'2026-10-05');
    state=commit(db,{type:'undo',log:state.logs[0]},day);
    assert.equal(state.tasks[0].due_date,'2026-10-01');
    state=commit(db,{type:'postpone',task:state.tasks[0]},day);
    assert.equal(state.tasks[0].due_date,'2026-10-05');
    assert.equal(state.postponements[0].previous_date,'2026-10-01');
    assert.equal(state.logs.filter(l=>!l.undone_at).length,0);
  }
  assert.equal(nextWeekday('2026-12-31',[1]),'2027-01-04');
  assert.equal(nextWeekday('2026-10-05',[1]),'2026-10-12');
});
test('old version 1 tasks and histories remain readable and retain interval behavior',()=>{
  const db=storage();const {repeat_mode,weekdays,time,notes,...old}=weekly;
  old.room='침실';old.kind='laundry';let state=commit(db,{type:'save',task:old},'2026-10-01');
  delete state.tasks[0].repeat_mode;delete state.tasks[0].weekdays;delete state.tasks[0].time;delete state.tasks[0].notes;
  validateState(state);const legacy=storage(state);
  state=commit(legacy,{type:'complete',task:state.tasks[0]},'2026-10-02');
  assert.equal(state.tasks[0].due_date,'2026-10-09');validateState(JSON.parse(JSON.stringify(state)));
});
test('malformed weekly backups are rejected',()=>{
  const db=storage();const state=commit(db,{type:'save',task:weekly},'2026-10-01');
  for(const weekdays of [[],[1,1],[7],['4']]) {
    const bad=structuredClone(state);bad.tasks[0].weekdays=weekdays;assert.throws(()=>validateState(bad));
  }
  const bad=structuredClone(state);bad.tasks[0].due_date='2026-10-02';assert.throws(()=>validateState(bad));
});
test('only outdoor drying gets rain penalty, not indoor laundry or waste',()=>{
  const weather={status:'ok',rain_probability:90,precipitation:1};
  for(const kind of ['general','laundry_indoor','waste']) assert.equal(recommend({...weekly,kind},weather,null,'2026-10-01').score,0);
  assert.equal(recommend({...weekly,kind:'laundry'},weather,null,'2026-10-01').score,-3);
});
