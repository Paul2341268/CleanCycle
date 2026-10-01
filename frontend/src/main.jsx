import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {House,LayoutDashboard,CalendarDays,ChartNoAxesColumnIncreasing,Settings,Plus,Check,X,Pencil,Trash2,Clock3,RefreshCw,MapPin,Droplets,CloudSun,ArrowUpRight,Sparkles,Bath,CookingPot,BedDouble,Sofa,Circle,Leaf,Download,Upload,BookOpen} from 'lucide-react';
import './style.css';
import {api} from './api';
import {UndoButton,RecommendationDetails,PostponementReport} from './features';
import {ServiceGuide} from './guide';
import {STORAGE_KEY,ROOMS,KINDS,todayKST,shiftDay,emptyState,readState,commit,importState,validateState,metrics,recommend} from './personal';

const roomIcons={'욕실':Bath,'주방':CookingPot,'침실':BedDouble,'거실':Sofa,'기타':House};
const presets=[{title:'욕실 물기 닦기',room:'욕실',interval_days:3,kind:'bathroom'},{title:'침구 세탁',room:'침실',interval_days:14,kind:'laundry'},{title:'냉장고 정리',room:'주방',interval_days:7,kind:'general'},{title:'거실 바닥 청소',room:'거실',interval_days:3,kind:'general'}];
function IconButton({label,children,...props}) {return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;}
const timeLabel=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'});

function App() {
  const [initial]=useState(()=>{try{return {value:readState(localStorage),error:''};}catch(e){return {value:emptyState(),error:e.message};}});
  const [state,setState]=useState(initial.value);
  const [storageError,setStorageError]=useState(initial.error);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [today,setToday]=useState(todayKST());
  const [view,setView]=useState('오늘의 집안일');
  const [filter,setFilter]=useState('전체');
  const [modal,setModal]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [detail,setDetail]=useState(null);
  const [regions,setRegions]=useState([]);
  const [environment,setEnvironment]=useState(null);
  const [loading,setLoading]=useState(true);
  const [networkError,setNetworkError]=useState('');
  const requestId=useRef(0);
  const fileInput=useRef(null);
  const region=state.region;
  const load=async()=>{
    const id=++requestId.current;
    setLoading(true);setNetworkError('');
    try {const result=await api('/environment?region='+region); if(id===requestId.current)setEnvironment(result);}
    catch(e){if(id===requestId.current){setNetworkError(e.message);setEnvironment(null);}}
    finally{if(id===requestId.current)setLoading(false);}
  };
  useEffect(()=>{api('/regions').then(setRegions).catch(()=>{});},[]);
  useEffect(()=>{setEnvironment(null);load();return()=>{requestId.current++;};},[region]);
  useEffect(()=>{
    const refresh=()=>{try {setState(commit(localStorage,{type:'capture'}));setStorageError('');setToday(todayKST());}catch(e){setStorageError(e.message);}};
    refresh();
    const onStorage=e=>{if(e.key===STORAGE_KEY||e.key===null){try{setState(readState(localStorage));setStorageError('');}catch(error){setStorageError(error.message);}}};
    const timer=setInterval(()=>{if(todayKST()!==today)refresh();},30000);
    window.addEventListener('storage',onStorage);window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('storage',onStorage);window.removeEventListener('focus',refresh);};
  },[today]);
  useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);}},[notice]);
  const mutate=(action,message)=>{
    setError('');
    try {setState(commit(localStorage,action,today));setStorageError('');setModal(null);setConfirm(null);setNotice(message);}
    catch(e){setError(e.message);try{setState(readState(localStorage));}catch{setStorageError(e.message);}}
  };
  const backup=()=>{
    try {
      const raw=localStorage.getItem(STORAGE_KEY)||JSON.stringify(state);
      const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='CleanCycle-'+today+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError('백업을 내보내지 못했습니다. '+e.message);}
  };
  const chooseBackup=async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setError('');
    try {if(file.size>5*1024*1024)throw new Error('백업 파일은 5MB 이하여야 합니다.'); const value=validateState(JSON.parse(await file.text()));setConfirm({type:'import',value});}
    catch(e){setError('백업을 읽지 못했습니다. '+e.message);}
  };
  const applyBackup=()=>{try{setState(importState(localStorage,confirm.value));setStorageError('');setConfirm(null);setNotice('개인 기록을 가져왔습니다.');}catch(e){setError(e.message);}};
  const summary=metrics(state,today);
  const logs=summary.logs;
  const weather=environment?.region===region?environment.weather:null;
  const air=environment?.region===region?environment.air_quality:null;
  const tasks=state.tasks.map(t=>recommend(t,weather,air,today)).sort((a,b)=>b.score-a.score||a.id-b.id);
  const due=tasks.filter(t=>t.due_date<=today);
  const done=logs.filter(l=>l.completed_at.slice(0,10)===today);
  const selected=tasks.filter(t=>(filter==='전체'||t.room===filter)&&(view!=='오늘의 집안일'||t.due_date<=today));
  const openNew=(preset={})=>{setError('');setModal({title:'',room:'욕실',interval_days:7,due_date:today,kind:'general',...preset});};
  const navigate=name=>{setView(name);setFilter('전체');setError('');};
  return <div className="app">
    <aside className="sidebar">
      <a href="#" className="brand" onClick={e=>{e.preventDefault();navigate('오늘의 집안일');}}><span className="brand-icon"><House size={23}/></span>CleanCycle<span className="brand-dot">.</span></a>
      <div className="home-label"><span className="home-avatar"><Leaf size={18}/></span><div><strong>나의 생활 공간</strong><small>나만의 집안일 루틴</small></div><span className="personal">개인용</span></div>
      <p className="nav-label">WORKSPACE</p>
      <nav>{[['오늘의 집안일',LayoutDashboard],['모든 집안일',CalendarDays],['생활 리포트',ChartNoAxesColumnIncreasing],['설정',Settings],['사용 안내',BookOpen]].map(([name,Icon])=><button key={name} aria-label={name} className={view===name?'active':''} onClick={()=>navigate(name)}><Icon size={19}/>{name}{name==='오늘의 집안일'&&<span className="nav-count">{due.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="avatar">나</span><div><strong>개인 기록</strong><small>이 브라우저에 저장</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span>나의 생활 공간 <span className="slash">/</span> {view}</span><div className="location"><MapPin size={16}/><select aria-label="날씨 지역" disabled={!!storageError} value={region} onChange={e=>mutate({type:'region',region:e.target.value},'지역을 변경했습니다.')}>{regions.length?regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>):<option value={region}>{region==='busan'?'부산 · 시청 기준':region}</option>}</select></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">{new Date(today+'T12:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'})}</p><h1>{view==='오늘의 집안일'?'오늘도, 기분 좋은 우리 집':view==='사용 안내'?'서비스 소개와 사용 방법':view}</h1><p className="subtitle">{view==='설정'?'개인 기록과 지역 설정':view==='사용 안내'?'처음 만나는 CleanCycle, 하나씩 시작해 보세요.':'날씨와 대기질을 살펴, 오늘의 루틴을 준비해요.'}</p></div><button className="primary" disabled={!!storageError} onClick={()=>openNew()}><Plus size={18}/>집안일 추가</button></div>
        {storageError&&<div className="alert" role="alert">{storageError}<button onClick={()=>navigate('설정')}>백업 관리</button></div>}
        {error&&!modal&&!confirm&&<div className="alert" role="alert">{error}<IconButton label="오류 닫기" onClick={()=>setError('')}><X size={16}/></IconButton></div>}
        {view==='오늘의 집안일'&&!state.tasks.length&&<div className="guide-entry"><p>처음이신가요? CleanCycle이 어떤 서비스인지, 어떻게 시작하면 되는지 알아보세요.</p><button className="text-button" onClick={()=>navigate('사용 안내')}><BookOpen size={17}/>서비스 소개·사용 방법</button></div>}
        {view==='사용 안내'?<ServiceGuide disabled={!!storageError} onStart={()=>{navigate('오늘의 집안일');openNew();}}/>:view==='설정'?<section className="personal-settings"><h2>개인 기록 백업</h2><p>기록은 현재 브라우저에 저장됩니다. 다른 컴퓨터로 옮길 때는 백업 파일을 가져오세요. 브라우저의 사이트 데이터를 삭제하면 기록도 삭제됩니다.</p><div className="backup-actions"><button onClick={backup}><Download size={18}/>백업 내보내기</button><button onClick={()=>fileInput.current.click()}><Upload size={18}/>백업 가져오기</button></div><input ref={fileInput} type="file" accept="application/json,.json" aria-label="백업 파일" onChange={chooseBackup} hidden/><h2>현재 기록</h2><p>집안일 {state.tasks.length}개 · 완료 이력 {logs.length}개</p><h2>공공 데이터 출처</h2><p><a href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">기상청 단기예보</a> · <a href="https://www.data.go.kr/data/15073861/openapi.do" target="_blank" rel="noreferrer">에어코리아 대기오염정보</a></p></section>:<>
          <section className="metrics" aria-label="오늘의 현황"><div><span>오늘 남은 집안일</span><strong>{due.length}<small>개</small></strong><span className="metric-note">하나씩 가볍게 시작해요</span></div><div><span>오늘 완료</span><strong className="green">{done.length}<small>개</small></strong><span className="metric-note">오늘의 작은 실천</span></div><div><span>기한 지난 집안일</span><strong className="coral">{tasks.filter(t=>t.due_date<today).length}<small>개</small></strong><span className="metric-note">여유가 생기면 먼저 챙겨요</span></div><div><span>오늘의 달성률</span><strong>{summary.percent}<small>%</small></strong><div className="progress"><i style={{width:summary.percent+'%'}}/></div></div></section>
          {view==='생활 리포트'?<Report logs={logs} today={today} postponements={state.postponements.filter(p=>p.postponed_at.slice(0,10)>=shiftDay(today,-6))} onUndo={log=>{setError('');setConfirm({type:'undo',log});}}/>:<div className="content-grid"><section className="task-section">
            <div className="section-heading"><h2>{view==='오늘의 집안일'?'오늘의 루틴':'공간별 루틴'} <span>{selected.length}</span></h2><span className="sort-label">우선순위 순</span></div>
            <div className="filters" aria-label="공간 필터">{['전체',...ROOMS].map(room=><button key={room} aria-pressed={filter===room} className={filter===room?'selected':''} onClick={()=>setFilter(room)}>{room}</button>)}</div>
            {selected.length?<div className="task-list">{selected.map(task=>{const Icon=roomIcons[task.room];return <article className="task" key={task.id}><IconButton label={task.title+' 완료'} disabled={!!storageError} onClick={()=>mutate({type:'complete',task},'완료했어요. 다음 일정도 준비했습니다.')}><Circle className="check-circle" size={25}/></IconButton><div className={'room-icon room-'+ROOMS.indexOf(task.room)}><Icon size={21}/></div><div className="task-info"><h3>{task.title}</h3><p>{task.room}<span>·</span>{task.interval_days}일마다<span>·</span>{task.due_date.slice(5).replace('-','/')}</p><button className="reason reason-button" aria-label={task.title+' 추천 근거'} onClick={()=>setDetail(task)}>{task.reasons.join(' · ')}<ArrowUpRight size={12}/></button></div>{task.overdue_days>0&&<span className="tag overdue">{task.overdue_days}일 지연</span>}<div className="task-actions"><IconButton label={task.title+' 하루 미루기'} disabled={!!storageError} onClick={()=>mutate({type:'postpone',task},'다음 날로 일정을 옮겼습니다.')}><Clock3 size={17}/></IconButton><IconButton label={task.title+' 수정'} disabled={!!storageError} onClick={()=>{setError('');setModal(task);}}><Pencil size={16}/></IconButton><IconButton label={task.title+' 삭제'} disabled={!!storageError} onClick={()=>{setError('');setConfirm({type:'delete',task});}}><Trash2 size={16}/></IconButton></div></article>;})}</div>:<div className="empty"><span className="empty-icon"><Check size={28}/></span><h3>{tasks.length?'이 공간에 예정된 일이 없어요':'첫 번째 루틴을 만들어 보세요'}</h3><button className="text-button" disabled={!!storageError} onClick={()=>tasks.length?navigate('모든 집안일'):openNew()}>{tasks.length?'모든 집안일 보기':'집안일 추가'}<ArrowUpRight size={16}/></button></div>}
            <div className="section-heading preset-heading"><h2>자주 하는 집안일</h2><span className="sort-label">내 생활에 맞춰 조정하세요</span></div><div className="presets">{presets.map(p=>{const Icon=roomIcons[p.room];return <button key={p.title} disabled={!!storageError} onClick={()=>openNew(p)}><Icon size={22}/><div><strong>{p.title}</strong><small>{p.interval_days}일마다</small></div><Plus size={17}/></button>;})}</div>
            {done.length>0&&<div className="completed"><h2>오늘 해냈어요 <span>{done.length}</span></h2>{done.map(log=><p key={log.id}><Check size={17}/>{log.title}<span>{log.room}</span><UndoButton log={log} busy={!!storageError} onUndo={log=>{setError('');setConfirm({type:'undo',log});}}/></p>)}</div>}
          </section><aside className="right-column">
            {networkError&&<div className="alert" role="alert">{networkError}</div>}
            <Environment weather={weather} air={air} loading={loading} onRefresh={load}/>
            <section className="insight"><span className="insight-label"><Sparkles size={16}/>오늘의 한마디</span><h2>{weather?.status==='ok'&&weather.rain_probability>=60?'비 소식이 있는 날이에요':'작은 루틴이 만드는 변화'}</h2><p>{weather?.status==='ok'&&weather.rain_probability>=60?'자연건조가 필요한 빨래는 예보를 살펴 일정을 정해 보세요.':'오늘 할 수 있는 집안일 하나부터 시작해 보세요.'}</p><div className="plant-art" aria-hidden="true"><Leaf size={80} strokeWidth={1}/><House size={62} strokeWidth={1}/></div></section>
          </aside></div>}
        </>}
        <footer>CleanCycle <span>나만의 생활 루틴</span><span>개인용</span></footer>
      </main>
    </div>
    {modal&&<TaskDialog task={modal} error={error} onClose={()=>setModal(null)} onSave={task=>mutate({type:'save',task},'집안일을 저장했습니다.')}/>}
    {detail&&<Dialog title="추천 근거" onClose={()=>setDetail(null)}><RecommendationDetails task={detail} weather={weather} air={air}/></Dialog>}
    {confirm&&<Dialog title={confirm.type==='import'?'백업 가져오기':confirm.type==='undo'?'완료 취소':'집안일 삭제'} error={error} onClose={()=>setConfirm(null)}><p>{confirm.type==='import'?`백업의 집안일 ${confirm.value.tasks.length}개로 현재 브라우저 기록을 바꿀까요? 현재 기록이 필요하면 먼저 백업하세요.`:confirm.type==='undo'?`‘${confirm.log.title}’의 완료를 취소하고 이전 예정일로 복구할까요?`:`‘${confirm.task.title}’의 반복 일정을 삭제할까요? 완료 이력은 유지됩니다.`}</p><div className="dialog-actions"><button onClick={()=>setConfirm(null)}>취소</button><button className={confirm.type==='delete'?'danger':'primary'} onClick={()=>confirm.type==='import'?applyBackup():mutate(confirm,confirm.type==='undo'?'완료를 취소했습니다.':'집안일을 삭제했습니다.')}>{confirm.type==='import'?'가져오기':confirm.type==='undo'?'완료 취소':'삭제'}</button></div></Dialog>}
    {notice&&<div className="toast" role="status"><Check size={18}/>{notice}</div>}
  </div>;
}

function Environment({weather,air,loading,onRefresh}) {
  const weatherReady=weather?.status==='ok';
  const airReady=['ok','stale'].includes(air?.status);
  const grades={1:'좋음',2:'보통',3:'나쁨',4:'매우 나쁨'};
  return <>
    <section className="weather"><div className="section-heading"><h2><CloudSun size={19}/>우리 동네 날씨</h2><IconButton label="날씨 새로고침" disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading?'spin':''}/></IconButton></div>{weatherReady?<><div className="temperature">{weather.temperature}<span>°C</span><CloudSun size={46}/></div><div className="weather-details"><span><Droplets size={16}/>습도 <b>{weather.humidity}%</b></span><span>강수확률 <b>{weather.rain_probability}%</b></span></div><p className="weather-stamp">{timeLabel(weather.forecast_at)} 예보</p></>:<div className="weather-pending"><CloudSun size={44}/><strong>{loading?'날씨 확인 중':weather?.message||'날씨를 불러오지 못했습니다.'}</strong><span>날씨가 없을 때도 예정일 기준으로 집안일을 관리할 수 있어요.</span></div>}<a className="source" href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">출처 · 기상청 단기예보<ArrowUpRight size={13}/></a></section>
    <section className="air-quality" aria-label="대기질 정보"><div className="section-heading"><h2><Leaf size={18}/>우리 동네 대기질</h2></div>{airReady?<><div className="air-readings">{[['pm10','미세먼지'],['pm25','초미세먼지']].map(([field,label])=><div key={field}><span>{label}</span><strong>{air[field]??'—'}<small>µg/m³</small></strong><span className={'air-grade grade-'+(air[field+'_grade']||0)}>{grades[air[field+'_grade']]||'측정 정보 없음'}</span></div>)}</div><p className="weather-stamp">{air.station} 측정소 · {timeLabel(air.measured_at)}</p><p className="air-note">{air.status==='stale'?'갱신 지연 자료는 추천에 반영하지 않습니다.':'측정소 기준이며 집 주변과 다를 수 있어요.'}</p></>:<p className="air-note">{loading?'대기질 확인 중':air?.message||'대기질을 불러오지 못했습니다.'}</p>}<a className="source" href="https://www.data.go.kr/data/15073861/openapi.do" target="_blank" rel="noreferrer">출처 · 한국환경공단 에어코리아<ArrowUpRight size={13}/></a></section>
  </>;
}

function Report({logs,today,postponements,onUndo}) {
  const days=Array.from({length:7},(_,i)=>shiftDay(today,i-6));
  const counts=days.map(day=>logs.filter(l=>l.completed_at.slice(0,10)===day).length);
  const max=Math.max(1,...counts);
  return <section className="report"><div className="section-heading"><h2>최근 7일의 완료 기록</h2><span>{days[0]} ~ {today}</span></div><div className="bar-chart" aria-label="최근 7일 완료 건수">{days.map((day,i)=><div className="bar-column" key={day}><strong>{counts[i]}</strong><div className="bar-track"><i style={{height:counts[i]/max*100+'%'}}/></div><span>{day.slice(5).replace('-','/')}</span></div>)}</div><div className="room-summary">{ROOMS.map(room=><div key={room}><span>{room}</span><strong>{logs.filter(l=>l.room===room&&l.completed_at.slice(0,10)>=days[0]).length}<small>회</small></strong></div>)}</div><h2>완료 이력</h2>{logs.length?<div className="history">{logs.slice(0,50).map(l=><div key={l.id}><Check size={18}/><strong>{l.title}</strong><span>{l.room}</span><time>{timeLabel(l.completed_at)}</time><UndoButton log={l} onUndo={onUndo}/></div>)}</div>:<p className="empty">아직 완료한 집안일이 없어요.</p>}<PostponementReport items={postponements}/></section>;
}
function Dialog({title,onClose,children,error}) {
  const ref=useRef();useEffect(()=>{ref.current.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="dialog-heading"><h2>{title}</h2><IconButton label="닫기" onClick={onClose}><X size={20}/></IconButton></div>{error&&<div className="alert" role="alert">{error}</div>}{children}</dialog>;
}
function TaskDialog({task,error,onClose,onSave}) {
  const [form,setForm]=useState(task);const change=(field,value)=>setForm(f=>({...f,[field]:value}));
  return <Dialog title={task.id?'집안일 수정':'새로운 집안일'} error={error} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSave(form);}}><label>집안일 이름<input autoFocus required maxLength={80} value={form.title} onChange={e=>change('title',e.target.value)}/></label><div className="form-row"><label>공간<select value={form.room} onChange={e=>change('room',e.target.value)}>{ROOMS.map(r=><option key={r}>{r}</option>)}</select></label><label>반복 주기 (일)<input type="number" required min="1" max="365" value={form.interval_days} onChange={e=>change('interval_days',e.target.value)}/></label></div><label>다음 예정일<input type="date" required value={form.due_date} onChange={e=>change('due_date',e.target.value)}/></label><label>작업 유형<select value={form.kind} onChange={e=>change('kind',e.target.value)}>{Object.entries(KINDS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div className="dialog-actions"><button type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={!form.title.trim()}>저장</button></div></form></Dialog>;
}

createRoot(document.getElementById('root')).render(<App/>);
