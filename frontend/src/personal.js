export const STORAGE_KEY = 'cleancycle-personal-v1';
export const ROOMS = ['집 전체·여러 공간','방·생활 공간','주방','욕실','베란다·다용도실','침실','거실','기타'];
export const KINDS = {general:'일반 청소·생활 관리',bathroom:'욕실 물기 관리',laundry_indoor:'세탁 · 실내 건조·건조기',laundry:'세탁 · 야외 자연건조',waste:'쓰레기 배출',outdoor:'야외 청소',filter:'필터 점검',ventilation:'환기'};
export const WEEKDAYS = ['일','월','화','수','목','금','토'];
export const isWeekly = task => task.repeat_mode==='weekly';
export const scheduleLabel = task => isWeekly(task)?'매주 '+[...task.weekdays].sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>WEEKDAYS[d]).join('·')+'요일':task.interval_days+'일마다';
export function nextWeekday(day, weekdays, inclusive=false) {
  for(let offset=inclusive?0:1;offset<=7;offset++) {
    const date=shiftDay(day,offset);
    if(weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())) return date;
  }
  throw new Error('반복할 요일을 하나 이상 선택해 주세요.');
}
export const nextTaskDate = (task,day,postpone=false) => isWeekly(task)?nextWeekday(postpone&&task.due_date>day?task.due_date:day,task.weekdays):shiftDay(postpone&&task.due_date>day?task.due_date:day,postpone?1:task.interval_days);
export const REGION_IDS = ['busan','seoul','incheon','daejeon','daegu','gwangju','jeju'];
export const todayKST = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
export const shiftDay = (day,n) => {const d=new Date(day+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);};
export const emptyState = () => ({version:1,nextId:1,region:'busan',tasks:[],logs:[],postponements:[],daily:[]});
const validDay = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const id = n => Number.isSafeInteger(n) && n>0;
const text = s => typeof s==='string' && s.trim().length>0 && s.length<=80;
const stamp = s => typeof s==='string' && Number.isFinite(Date.parse(s)) && validDay(s.slice(0,10));
const uniqueIds = rows => new Set(rows.map(r=>r.id)).size===rows.length;
const kstStamp = (day, now) => day+'T'+new Date(Date.parse(now)+9*3600000).toISOString().slice(11,-1)+'+09:00';

export function validateState(value) {
  const invalid = () => {throw new Error('개인 기록 파일의 형식이 올바르지 않습니다. 기존 기록은 유지됩니다.');};
  if (!value || value.version!==1 || !id(value.nextId) || !REGION_IDS.includes(value.region)) invalid();
  for (const field of ['tasks','logs','postponements','daily']) {
    if (!Array.isArray(value[field]) || value[field].length>20000 || value[field].some(r=>!r || typeof r!=='object')) invalid();
  }
  if (!uniqueIds(value.tasks) || !uniqueIds(value.logs) || !uniqueIds(value.postponements)) invalid();
  for (const t of value.tasks) if (!id(t.id)||!text(t.title)||!ROOMS.includes(t.room)||!Object.hasOwn(KINDS,t.kind)||!Number.isInteger(t.interval_days)||t.interval_days<1||t.interval_days>365||!validDay(t.due_date)||!Number.isSafeInteger(t.revision)||t.revision<0) invalid();
  for (const t of value.tasks) {
    if(t.repeat_mode!==undefined&&!['interval','weekly'].includes(t.repeat_mode)) invalid();
    if(isWeekly(t)&&(!Array.isArray(t.weekdays)||!t.weekdays.length||t.weekdays.length>7||new Set(t.weekdays).size!==t.weekdays.length||t.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||!t.weekdays.includes(new Date(t.due_date+'T00:00:00Z').getUTCDay()))) invalid();
    if(t.notes!==undefined&&(typeof t.notes!=='string'||t.notes.length>300)) invalid();
    if(t.time!==undefined&&(typeof t.time!=='string'||(t.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)))) invalid();
  }
  for (const l of value.logs) if (!id(l.id)||!id(l.task_id)||!text(l.title)||!ROOMS.includes(l.room)||!stamp(l.completed_at)||!validDay(l.previous_date)||!id(l.completion_revision)||(l.undone_at!=null&&!stamp(l.undone_at))) invalid();
  for (const p of value.postponements) if (!id(p.id)||!id(p.task_id)||!text(p.display_title)||!ROOMS.includes(p.display_room)||!validDay(p.previous_date)||!validDay(p.next_date)||!stamp(p.postponed_at)) invalid();
  for (const d of value.daily) if (!validDay(d.day)||!id(d.task_id)||!ROOMS.includes(d.room)) invalid();
  let maximum=0;
  for(const rows of [value.tasks,value.logs,value.postponements,value.daily]) for(const row of rows) maximum=Math.max(maximum,row.id||0,row.task_id||0);
  if (value.nextId<=maximum || new Set(value.daily.map(d=>d.day+':'+d.task_id)).size!==value.daily.length) invalid();
  return value;
}

export function readState(storage) {
  let raw;
  try {raw=storage.getItem(STORAGE_KEY);} catch {throw new Error('브라우저 저장소에 접근하지 못했습니다. 일반 브라우저 창에서 다시 열어 주세요.');}
  if (raw===null) return emptyState();
  try {return validateState(JSON.parse(raw));} catch {throw new Error('저장된 기록을 읽지 못했습니다. 기록을 자동으로 덮어쓰지 않았습니다. 백업 파일을 가져오거나 원본 기록을 내보내 주세요.');}
}

function capture(state, day) {
  const planned = new Set(state.daily.filter(d=>d.day===day).map(d=>d.task_id));
  for (const t of state.tasks) if (t.due_date<=day && !planned.has(t.id)) {state.daily.push({day,task_id:t.id,room:t.room}); planned.add(t.id);}
}

export function commit(storage, action, day=todayKST(), now=new Date().toISOString()) {
  const state=structuredClone(readState(storage));
  const before=JSON.stringify(state);
  capture(state,day);
  if (action.type==='save') {
    const t=action.task;
    const cleaned={title:t.title.trim(),room:t.room,kind:t.kind,interval_days:Number(t.interval_days),due_date:t.due_date,repeat_mode:t.repeat_mode||'interval',weekdays:t.repeat_mode==='weekly'?[...t.weekdays]:[],notes:t.notes||'',time:t.time||''};
    if (t.id) {
      const existing=state.tasks.find(r=>r.id===t.id);
      if (!existing || existing.revision!==t.revision) throw new Error('다른 탭에서 변경된 작업입니다. 최신 기록을 확인해 주세요.');
      Object.assign(existing,cleaned,{revision:existing.revision+1});
    } else state.tasks.push({...cleaned,id:state.nextId++,revision:0});
  } else if (['complete','postpone','delete'].includes(action.type)) {
    const task=state.tasks.find(t=>t.id===action.task.id);
    if (!task || task.revision!==action.task.revision) throw new Error('이미 변경된 작업입니다. 최신 기록을 확인해 주세요.');
    if (action.type==='delete') state.tasks=state.tasks.filter(t=>t.id!==task.id);
    else if (action.type==='complete') {
      if (state.logs.some(l=>l.task_id===task.id && !l.undone_at && l.completed_at.slice(0,10)===day)) throw new Error('오늘 이미 완료한 작업입니다.');
      state.logs.push({id:state.nextId++,task_id:task.id,title:task.title,room:task.room,completed_at:kstStamp(day,now),previous_date:task.due_date,completion_revision:task.revision+1,undone_at:null});
      task.due_date=nextTaskDate(task,day); task.revision++;
    } else {
      const next=nextTaskDate(task,day,true);
      state.postponements.push({id:state.nextId++,task_id:task.id,display_title:task.title,display_room:task.room,previous_date:task.due_date,next_date:next,postponed_at:kstStamp(day,now)});
      task.due_date=next; task.revision++;
    }
  } else if (action.type==='undo') {
    const log=state.logs.find(l=>l.id===action.log.id);
    const task=state.tasks.find(t=>t.id===log?.task_id);
    if (!log || log.undone_at || !task || task.revision!==log.completion_revision) throw new Error('완료 후 작업이 변경되어 취소할 수 없습니다.');
    log.undone_at=kstStamp(day,now); task.due_date=log.previous_date; task.revision++;
  } else if (action.type==='region') state.region=action.region;
  else if (action.type!=='capture') throw new Error('알 수 없는 작업입니다.');
  capture(state,day);
  validateState(state);
  const serialized=JSON.stringify(state);
  try {if(action.type!=='capture'||serialized!==before)storage.setItem(STORAGE_KEY,serialized);} catch {throw new Error('기록을 저장하지 못했습니다. 브라우저 저장 공간을 확인하고 백업해 주세요.');}
  return state;
}

export function importState(storage, value) {
  const state=validateState(value);
  try {storage.setItem(STORAGE_KEY,JSON.stringify(state));} catch {throw new Error('백업을 저장하지 못했습니다. 기존 기록은 유지됩니다.');}
  return state;
}

export function metrics(state, day) {
  const logs=state.logs.filter(l=>!l.undone_at);
  const planned=new Set(state.daily.filter(d=>d.day===day).map(d=>d.task_id));
  for (const t of state.tasks) if(t.due_date<=day) planned.add(t.id);
  const done=new Set(logs.filter(l=>l.completed_at.slice(0,10)===day).map(l=>l.task_id));
  const total=new Set([...planned,...done]).size;
  return {logs:logs.map(l=>({...l,can_undo:state.tasks.some(t=>t.id===l.task_id && t.revision===l.completion_revision)})).sort((a,b)=>b.id-a.id),completed:done.size,total,percent:total?Math.round(done.size/total*100):0};
}

export function recommend(task, weather, air, day=todayKST()) {
  const delay=Math.round((Date.parse(day)-Date.parse(task.due_date))/86400000);
  let score=Math.max(-30,delay*2);
  const reasons=[delay>0?`${delay}일 지연`:delay===0?'오늘 예정':`${-delay}일 후 예정`];
  const evidence=[{label:reasons[0],points:score,source:'등록된 예정일',value:task.due_date}];
  const add=(points,label,source,value,time)=>{score+=points; reasons.push(label); evidence.push({points,label,source,value,time});};
  if (weather?.status==='ok') {
    if(task.kind==='bathroom' && weather.humidity>=75) add(3,'실외 습도 높음 · 욕실 물기 점검','기상청 단기예보',`실외 습도 ${weather.humidity}%`,weather.forecast_at);
    if(['laundry','outdoor'].includes(task.kind) && (weather.rain_probability>=60 || weather.precipitation>0)) add(-3,'비 예보 · 야외 작업이나 자연건조 일정 확인','기상청 단기예보',`강수확률 ${weather.rain_probability}%`,weather.forecast_at);
  }
  if(air?.status==='ok' && [air.pm10_grade,air.pm25_grade].some(g=>g>=3)) {
    if(['outdoor','ventilation'].includes(task.kind)) add(-3,'미세먼지 나쁨 이상 · 작업 시점 확인','한국환경공단 에어코리아',`${air.station} 측정소`,air.measured_at);
    if(task.kind==='filter') add(3,'미세먼지 나쁨 이상 · 필터 상태 확인','한국환경공단 에어코리아',`${air.station} 측정소`,air.measured_at);
  }
  return {...task,score,reasons,evidence,overdue_days:Math.max(0,delay)};
}
