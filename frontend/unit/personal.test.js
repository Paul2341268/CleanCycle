import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commit,readState,importState,metrics,recommend,STORAGE_KEY} from '../src/personal.js';

const day='2026-10-01';
const clock='2026-09-30T19:30:00Z';
const task={title:'욕실 청소',room:'욕실',interval_days:3,due_date:day,kind:'bathroom'};
function storage() {const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}

test('postpone retains daily denominator, completion and undo restore dates',()=>{
  const s=storage();let state=commit(s,{type:'save',task},day,clock);
  const original=state.tasks[0];state=commit(s,{type:'postpone',task:original},day,clock);
  assert.equal(metrics(state,day).total,1);
  assert.equal(state.tasks[0].due_date,'2026-10-02');
  state=commit(s,{type:'complete',task:state.tasks[0]},day,clock);
  assert.equal(metrics(state,day).percent,100);
  assert.equal(state.tasks[0].due_date,'2026-10-04');
  assert.equal(state.logs[0].completed_at,'2026-10-01T04:30:00.000+09:00');
  state=commit(s,{type:'undo',log:state.logs[0]},day,clock);
  assert.equal(state.tasks[0].due_date,'2026-10-02');
  assert.equal(metrics(state,day).percent,0);
});

test('stale edits and undo after changing a task are rejected',()=>{
  const s=storage();let state=commit(s,{type:'save',task},day,clock);
  const stale=state.tasks[0];state=commit(s,{type:'complete',task:stale},day,clock);
  assert.throws(()=>commit(s,{type:'delete',task:stale},day,clock));
  const log=state.logs[0];state=commit(s,{type:'save',task:{...state.tasks[0],title:'변경'}},day,clock);
  assert.throws(()=>commit(s,{type:'undo',log},day,clock));
  assert.equal(readState(s).tasks[0].title,'변경');
});

test('storage failures and invalid backups leave previous records intact',()=>{
  const s=storage();const state=commit(s,{type:'save',task},day,clock);
  const raw=s.getItem(STORAGE_KEY);
  assert.throws(()=>importState(s,{...state,tasks:[{...state.tasks[0],due_date:'2026-02-30'}]}));
  assert.throws(()=>importState(s,{...state,tasks:[{...state.tasks[0],kind:'__proto__'}]}));
  assert.equal(s.getItem(STORAGE_KEY),raw);
  s.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>commit(s,{type:'delete',task:state.tasks[0]},day,clock),/저장/);
  assert.equal(s.getItem(STORAGE_KEY),raw);
});

test('backup roundtrip and deleted tasks retain completion history',()=>{
  const a=storage();let state=commit(a,{type:'save',task},day,clock);
  state=commit(a,{type:'complete',task:state.tasks[0]},day,clock);
  state=commit(a,{type:'delete',task:state.tasks[0]},day,clock);
  const b=storage();importState(b,JSON.parse(a.getItem(STORAGE_KEY)));
  assert.equal(metrics(readState(b),day).completed,1);
  assert.equal(readState(b).tasks.length,0);
});

test('unavailable and stale data do not affect scores; fresh data explains scores',()=>{
  const weather={status:'ok',humidity:80,rain_probability:80,precipitation:1};
  const air={status:'ok',station:'연산동',pm10_grade:3,pm25_grade:1};
  assert.equal(recommend(task,weather,air,day).score,3);
  assert.equal(recommend({...task,kind:'laundry'},weather,air,day).score,-3);
  assert.equal(recommend({...task,kind:'outdoor'},weather,air,day).score,-6);
  assert.equal(recommend({...task,kind:'filter'},null,air,day).score,3);
  assert.equal(recommend({...task,kind:'outdoor'},{status:'error'},{...air,status:'stale'},day).score,0);
  assert.equal(task.due_date,day);
});

test('corrupt stored data is never reset or overwritten by capture',()=>{
  const s=storage();s.setItem(STORAGE_KEY,'broken-json');
  assert.throws(()=>commit(s,{type:'capture'},day,clock));
  assert.equal(s.getItem(STORAGE_KEY),'broken-json');
});
