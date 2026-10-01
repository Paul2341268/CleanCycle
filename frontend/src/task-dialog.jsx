import React,{useState} from 'react';
import {Check,Plus,Pencil} from 'lucide-react';
import {ROOMS,KINDS,WEEKDAYS,nextWeekday,scheduleLabel,isWeekly} from './personal';
import {PRESETS} from './catalog';

export function TaskDialog({task,tasks,error,onClose,onSave,Dialog}) {
  const [form,setForm]=useState({...task,repeat_mode:task.repeat_mode||'interval',weekdays:task.weekdays||[],time:task.time||'',notes:task.notes||''});
  const [mode,setMode]=useState(task.id||task.title?'direct':'catalog');
  const [choosing,setChoosing]=useState(!task.title);
  const [duplicateOK,setDuplicateOK]=useState(false);
  const [formError,setFormError]=useState('');
  const change=(field,value)=>{setDuplicateOK(false);setFormError('');setForm(f=>({...f,[field]:value}));};
  const selectPreset=p=>{setForm({...form,...p,time:'',notes:'',weekdays:p.weekdays||[],repeat_mode:p.repeat_mode||'interval'});setChoosing(false);setDuplicateOK(false);setFormError('');};
  const duplicate=tasks.some(t=>t.id!==form.id&&t.title.trim()===form.title.trim()&&t.room===form.room);
  const toggleDay=day=>{
    const weekdays=form.weekdays.includes(day)?form.weekdays.filter(d=>d!==day):[...form.weekdays,day];
    setForm({...form,weekdays,due_date:weekdays.length?nextWeekday(form.due_date,weekdays,true):form.due_date});
    setDuplicateOK(false);setFormError('');
  };
  return <Dialog title={task.id?'집안일 수정':'새로운 집안일'} error={error||formError} onClose={onClose}>
    {!task.id&&<div className="entry-tabs" role="tablist" aria-label="등록 방식">{[['catalog','목록에서 선택',Plus],['direct','직접 추가',Pencil]].map(([value,label,Icon])=><button key={value} type="button" role="tab" aria-selected={mode===value} onClick={()=>{setMode(value);if(value==='catalog')setChoosing(true);}}><Icon size={16}/>{label}</button>)}</div>}
    {mode==='catalog'&&choosing&&<div className="catalog">{['청소','세탁','쓰레기','기타 관리'].map(group=><fieldset key={group}><legend>{group}</legend><div>{PRESETS.filter(p=>p.group===group).map(p=><button type="button" key={p.title} aria-pressed={form.title===p.title} onClick={()=>selectPreset(p)}>{form.title===p.title?<Check size={15}/>:<Plus size={15}/>} {p.title}</button>)}</div></fieldset>)}</div>}
    {mode==='catalog'&&!choosing&&<button type="button" className="text-button" onClick={()=>setChoosing(true)}><Pencil size={15}/>다른 집안일 선택</button>}
    <form onSubmit={e=>{e.preventDefault();if(isWeekly(form)&&(!form.weekdays.length||!form.weekdays.includes(new Date(form.due_date+'T00:00:00Z').getUTCDay()))){setFormError('반복 요일을 선택하고, 첫 예정일을 해당 요일로 지정해 주세요.');return;}onSave(form);}}>
      <label>집안일 이름<input autoFocus={mode==='direct'} required maxLength={80} value={form.title} onChange={e=>change('title',e.target.value)}/></label>
      <div className="form-row"><label>관리 공간<select value={form.room} onChange={e=>change('room',e.target.value)}>{ROOMS.map(r=><option key={r}>{r}</option>)}</select></label><label>집안일 종류<select value={form.kind} onChange={e=>change('kind',e.target.value)}>{Object.entries(KINDS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      <fieldset className="repeat-options"><legend>반복 방식</legend>{[['interval','며칠마다'],['weekly','매주 정해진 요일']].map(([value,label])=><label key={value}><input type="radio" name="repeat-mode" value={value} checked={form.repeat_mode===value} onChange={()=>change('repeat_mode',value)}/>{label}</label>)}</fieldset>
      {isWeekly(form)?<fieldset className="weekday-options"><legend>반복 요일</legend><div>{[1,2,3,4,5,6,0].map(day=><label key={day}><input type="checkbox" checked={form.weekdays.includes(day)} onChange={()=>toggleDay(day)}/>{WEEKDAYS[day]}</label>)}</div></fieldset>:<label>반복 주기 (일)<input type="number" required min="1" max="365" value={form.interval_days} onChange={e=>change('interval_days',e.target.value)}/></label>}
      <label>{task.id?'다음 예정일':'처음 할 날짜'}<input type="date" required value={form.due_date} onChange={e=>change('due_date',e.target.value)}/></label>
      {form.kind==='waste'&&<label>배출 시간 (선택)<input type="time" value={form.time} onChange={e=>change('time',e.target.value)}/></label>}
      <label>메모 (선택)<textarea maxLength={300} rows={2} placeholder={form.kind==='waste'?'배출 장소, 건물 배출 기준 등':'제품 설명서, 준비물 등'} value={form.notes} onChange={e=>change('notes',e.target.value)}/></label>
      {form.title.trim()&&<output className="task-preview"><strong>{form.title} · {form.room}</strong><span>{isWeekly(form)&&!form.weekdays.length?'배출·반복 요일 선택 필요':scheduleLabel(form)}{form.time?' · '+form.time:''} · {form.due_date}</span><span>{isWeekly(form)?'완료해도 지정 요일 유지':'완료한 날부터 '+form.interval_days+'일 뒤'}</span></output>}
      {duplicate&&<label className="duplicate-check"><input type="checkbox" checked={duplicateOK} onChange={e=>setDuplicateOK(e.target.checked)}/>같은 이름·공간의 집안일이 있습니다. 별도로 등록합니다.</label>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={!form.title.trim()||(duplicate&&!duplicateOK)||(isWeekly(form)&&!form.weekdays.length)}>저장</button></div>
    </form>
  </Dialog>;
}
