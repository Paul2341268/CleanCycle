import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {House, LayoutDashboard, CalendarDays, ChartNoAxesColumnIncreasing, Plus, Check, X, Pencil, Trash2, Clock3, RefreshCw, MapPin, Droplets, CloudSun, ArrowUpRight, Sparkles, Bath, CookingPot, BedDouble, Sofa, Circle, Leaf} from 'lucide-react';
import './style.css';
import {UndoButton, RecommendationDetails, PostponementReport} from './features';
import {api} from './api';
import {AccountGate,HouseholdSettings,Logout,SharingReport} from './accounts';
import {WasteSettings} from './waste';

const roomIcons = {'욕실': Bath, '주방': CookingPot, '침실': BedDouble, '거실': Sofa, '기타': House};
const rooms = Object.keys(roomIcons);
const presets = [
  {title:'욕실 물기 닦기',room:'욕실',interval_days:3,kind:'bathroom'},
  {title:'침구 세탁',room:'침실',interval_days:14,kind:'laundry'},
  {title:'냉장고 정리',room:'주방',interval_days:7,kind:'general'},
  {title:'거실 바닥 청소',room:'거실',interval_days:3,kind:'general'},
];
const kstDate = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
function IconButton({label, children, ...props}) {return <button className="icon-button" title={label} aria-label={label} {...props}>{children}</button>}

function App({account,onAccountChange}) {
  const [home,setHome]=useState(account.home);
  const [assignmentFilter,setAssignmentFilter]=useState('전체');
  const [view,setView] = useState('오늘의 집안일');
  const [region,setRegion] = useState(account.home.region);
  const [regions,setRegions] = useState([]);
  const [data,setData] = useState(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [filter,setFilter] = useState('전체');
  const [modal,setModal] = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const [undoTarget,setUndoTarget] = useState(null);
  const [detailTask,setDetailTask] = useState(null);
  const requestId = useRef(0);
  const regionRef = useRef(region);
  regionRef.current = region;
  const mutationPending = useRef(false);
  const load = async (quiet=false) => {
    quiet=quiet===true;
    const id = ++requestId.current;
    const requestedRegion = regionRef.current;
    if(!quiet)setLoading(true);
    try {
      const [result,group] = await Promise.all([api('/dashboard?region=' + requestedRegion),api('/home')]);
      if (id === requestId.current && requestedRegion === regionRef.current) {setData(result);setHome(group);if(!quiet)setError('');}
    } catch(e) {if (id === requestId.current && requestedRegion === regionRef.current) setError(e.message);}
    finally {if (!quiet && id === requestId.current && requestedRegion === regionRef.current) setLoading(false);}
  };
  useEffect(() => {api('/regions').then(setRegions).catch(e=>setError(e.message));}, []);
  useEffect(()=>{setHome(account.home);setRegion(account.home.region);},[account.home]);
  useEffect(() => {localStorage.setItem('cleancycle-region',region); setDetailTask(null); load();},[region]);
  useEffect(() => {setError('');},[modal,deleteTarget,undoTarget]);
  useEffect(() => {if (notice) {const timer=setTimeout(()=>setNotice(''),4000);return ()=>clearTimeout(timer);}},[notice]);
  useEffect(()=>{const refresh=()=>{if(!document.hidden&&!loading&&!mutationPending.current&&!modal&&!deleteTarget&&!undoTarget&&!detailTask)load(true);};const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[loading,modal,deleteTarget,undoTarget,detailTask]);
  const mutate = async (path, method, body, message) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setError('');
    setBusy(true);
    try {
      await api(path, {method, ...(body ? {body:JSON.stringify(body)} : {})});
      setModal(null);setDeleteTarget(null);setUndoTarget(null);setNotice(message);await load();
    } catch(e) {setError(e.message);if(e.status===409)await load(true);} finally {setBusy(false);mutationPending.current = false;}
  };
  const today = data?.today || kstDate();
  const tasks = data?.tasks || [];
  const logs = data?.logs || [];
  const weather = data?.weather;
  const weatherReady = !loading && weather?.status === 'ok' && weather.region === region;
  const due = tasks.filter(t=>t.due_date<=today);
  const done = logs.filter(l=>l.completed_at.slice(0,10)===today);
  const overdue = tasks.filter(t=>t.due_date<today);
  const selected = tasks.filter(t=>(filter==='전체'||t.room===filter) && (view!=='오늘의 집안일'||t.due_date<=today) && (assignmentFilter==='전체'||(assignmentFilter==='내 담당'?t.assigned_to===account.user.id:t.assigned_to==null)));
  const openNew = (preset={})=>{if (!mutationPending.current) setModal({title:'',room:'욕실',interval_days:7,due_date:today,kind:'general',...preset});};
  const percent = data?.daily_summary?.percent ?? 0;
  return <div className="app">
    <aside className="sidebar">
      <a href="#" className="brand" onClick={e=>{e.preventDefault();setView('오늘의 집안일')}}><span className="brand-icon"><House size={23}/></span>CleanCycle<span className="brand-dot">.</span></a>
      <div className="home-label"><span className="home-avatar"><Leaf size={18}/></span><div><strong>{home.name}</strong><small>{home.members.length}명의 생활 공간</small></div><span className="personal">{home.role==='admin'?'관리자':'구성원'}</span></div>
      <p className="nav-label">WORKSPACE</p>
      <div className="account-logout"><Logout onSuccess={onAccountChange}/></div>
      <nav>{[['오늘의 집안일',LayoutDashboard],['모든 집안일',CalendarDays],['생활 리포트',ChartNoAxesColumnIncreasing],['우리 집 설정',House]].map(([name,Icon])=><button key={name} className={view===name?'active':''} onClick={()=>{setView(name);setFilter('전체')}}><Icon size={19}/>{name}{name==='오늘의 집안일'&&<span className="nav-count">{due.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="avatar">나</span><div><strong>{account.user.name}</strong><small>{home.name}</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span>{home.name} <span className="slash">/</span> {view}</span><div className="location"><MapPin size={16}/><select aria-label="날씨 지역" value={region} onChange={e=>setRegion(e.target.value)}>{regions.length?regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>):<option value={region}>지역 불러오는 중</option>}</select></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">{new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Seoul'}).format(new Date())}</p><h1>{view==='오늘의 집안일'?'오늘도, 기분 좋은 우리 집':view}</h1><p className="subtitle">{view==='오늘의 집안일'?'작은 실천으로 쌓아가는 깔끔한 일상.':view==='모든 집안일'?'우리 집을 돌보는 반복 일정':'꾸준히 돌본 만큼, 달라지는 일상.'}</p></div><button className="primary" onClick={()=>openNew()}><Plus size={18}/>집안일 추가</button></div>
        {error&&!modal&&!deleteTarget&&!undoTarget&&<div className="alert" role="alert">{error}<IconButton label="오류 닫기" onClick={()=>setError('')}><X size={16}/></IconButton></div>}
        <section className="metrics" aria-label="오늘의 현황"><div><span>오늘 남은 집안일</span><strong>{due.length}<small>개</small></strong><span className="metric-note">하나씩 가볍게 시작해요</span></div><div><span>오늘 완료</span><strong className="green">{done.length}<small>개</small></strong><span className="metric-note">{done.length?'오늘도 한 걸음 더!':'첫 번째 완료를 기다려요'}</span></div><div><span>미뤄진 집안일</span><strong className="coral">{overdue.length}<small>개</small></strong><span className="metric-note">{overdue.length?'여유가 생기면 먼저 챙겨요':'미뤄진 일이 없어요'}</span></div><div><span>오늘의 달성률</span><strong>{percent}<small>%</small></strong><div className="progress"><i style={{width:percent+'%'}}/></div></div></section>
        {view!=='생활 리포트'&&view!=='우리 집 설정'&&<div className="assignment-filters" aria-label="담당 필터">{['전체','내 담당','미지정'].map(value=><button key={value} aria-pressed={assignmentFilter===value} className={assignmentFilter===value?'selected':''} onClick={()=>setAssignmentFilter(value)}>{value}</button>)}</div>}
        {view==='우리 집 설정'?<HouseholdSettings home={home} user={account.user} onChanged={onAccountChange}/>:view==='생활 리포트'?<Report logs={logs} today={today} postponements={data?.postponements||[]} onUndo={setUndoTarget} busy={busy} members={home.members}/>:<div className="content-grid"><section className="task-section"><div className="section-heading"><h2>{view==='오늘의 집안일'?'오늘의 루틴':'공간별 루틴'} <span>{selected.length}</span></h2><span className="sort-label">우선순위 순</span></div><div className="filters" aria-label="공간 필터">{['전체',...rooms].map(room=><button key={room} aria-pressed={filter===room} className={filter===room?'selected':''} onClick={()=>setFilter(room)}>{room}</button>)}</div>
          {loading&&!data?<div className="empty">집안일을 불러오는 중입니다.</div>:selected.length?<div className="task-list">{selected.map(task=>{const Icon=roomIcons[task.room];return <article className="task" key={task.id}><IconButton label={task.title+' 완료'} disabled={busy} onClick={()=>mutate('/tasks/'+task.id+'/complete','POST',{due_date:task.due_date,revision:task.revision},'완료했어요. 다음 일정도 준비했습니다.')}><Circle className="check-circle" size={25}/></IconButton><div className={'room-icon room-'+rooms.indexOf(task.room)}><Icon size={21}/></div><div className="task-info"><h3>{task.title}</h3><p>{task.room}<span>·</span>{home.members.find(m=>m.id===task.assigned_to)?.name||'미지정'}<span>·</span>{task.interval_days}일마다<span>·</span>{task.due_date.slice(5).replace('-','/')}</p><button className="reason reason-button" aria-label={task.title+' 추천 근거'} onClick={()=>setDetailTask(task)}>{task.reasons.join(' · ')} <ArrowUpRight size={12}/></button></div>{task.overdue_days>0&&<span className="tag overdue">{task.overdue_days}일 지연</span>}<div className="task-actions">{task.assigned_to==null&&<IconButton label={task.title+' 내가 맡기'} disabled={busy} onClick={()=>mutate('/tasks/'+task.id,'PUT',{...task,assigned_to:account.user.id},'내 담당으로 지정했습니다.')}><Check size={17}/></IconButton>}<IconButton label={task.title+' 하루 미루기'} disabled={busy} onClick={()=>mutate('/tasks/'+task.id+'/postpone','POST',{due_date:task.due_date,revision:task.revision},'다음 날로 일정을 옮겼습니다.')}><Clock3 size={17}/></IconButton><IconButton label={task.title+' 수정'} disabled={busy} onClick={()=>setModal(task)}><Pencil size={16}/></IconButton><IconButton label={task.title+' 삭제'} disabled={busy} onClick={()=>setDeleteTarget(task)}><Trash2 size={16}/></IconButton></div></article>})}</div>:<div className="empty"><span className="empty-icon"><Check size={28}/></span><h3>{tasks.length?'오늘은 한결 가벼운 하루':'첫 번째 루틴을 만들어 보세요'}</h3><p>{tasks.length?'이 공간에 예정된 집안일이 없어요.':'우리 집에 필요한 집안일을 골라 시작해요.'}</p><button className="text-button" onClick={()=>tasks.length?setView('모든 집안일'):openNew()}>{tasks.length?'모든 집안일 보기':'집안일 추가'}<ArrowUpRight size={16}/></button></div>}
          <div className="section-heading preset-heading"><h2>자주 하는 집안일</h2><span className="sort-label">주기는 자유롭게 조정하세요</span></div><div className="presets">{presets.map(p=>{const Icon=roomIcons[p.room];return <button key={p.title} onClick={()=>openNew(p)}><Icon size={22}/><div><strong>{p.title}</strong><small>{p.interval_days}일마다</small></div><Plus size={17}/></button>})}</div>
          {done.length>0&&<div className="completed"><h2>오늘 해냈어요 <span>{done.length}</span></h2>{done.map(log=><p key={log.id}><Check size={17}/>{log.title}<span>{log.completed_by_name||'이전 기록'} · {log.room}</span><UndoButton log={log} busy={busy} onUndo={setUndoTarget}/></p>)}</div>}
        </section><aside className="right-column"><section className="weather"><div className="section-heading"><h2><CloudSun size={19}/>우리 동네 날씨</h2><IconButton label="날씨 새로고침" disabled={loading} onClick={load}><RefreshCw size={16} className={loading?'spin':''}/></IconButton></div>{weatherReady?<><div className="temperature">{weather.temperature}<span>°C</span><CloudSun size={46}/></div><div className="weather-details"><span><Droplets size={16}/>습도 <b>{weather.humidity}%</b></span><span>강수확률 <b>{weather.rain_probability}%</b></span></div><p className="weather-stamp">{new Date(weather.forecast_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric'})} 예보</p></>:<div className="weather-pending"><CloudSun size={44}/><strong>{loading?'날씨 확인 중':weather?.message||'날씨 연결 대기 중'}</strong><span>{weather?.status==='error'?'집안일은 예정일을 기준으로 정렬됩니다.':'날씨가 연결되면 예보를 함께 보여드려요.'}</span></div>}<a className="source" href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">출처 · 기상청 단기예보<ArrowUpRight size={13}/></a></section>
        <AirQuality air={data?.air_quality} region={region} loading={loading} onRefresh={load}/>
        <section className="insight"><span className="insight-label"><Sparkles size={16}/>오늘의 한마디</span><h2>{weatherReady&&weather.rain_probability>=60?'비 소식이 있는 날이에요':weatherReady&&weather.humidity>=75?'물기까지 가볍게 정리해요':'작은 루틴이 만드는 변화'}</h2><p>{weatherReady&&weather.rain_probability>=60?'야외 작업이나 자연건조가 필요한 빨래는 예보를 살펴 일정을 정해 보세요.':weatherReady&&weather.humidity>=75?'실외 습도가 높은 예보예요. 욕실의 남은 물기를 확인해 보세요. 실내 상태는 다를 수 있어요.':'오늘 할 수 있는 일 하나면 충분해요. 완료한 집안일은 다음 주기에 맞춰 다시 찾아옵니다.'}</p><div className="plant-art" aria-hidden="true"><Leaf size={80} strokeWidth={1}/><House size={62} strokeWidth={1}/></div></section>
        <section className="week-preview"><h2>이번 주의 기록</h2><strong>{logs.filter(l=>l.completed_at.slice(0,10)>=daysBefore(today,6)).length}<span>개의 집안일 완료</span></strong><button className="text-button" onClick={()=>setView('생활 리포트')}>생활 리포트<ArrowUpRight size={16}/></button></section></aside></div>}
        {view==='우리 집 설정'&&<WasteSettings home={home} onChanged={()=>load(true)}/>}
        <footer>CleanCycle <span>우리 집의 좋은 루틴</span><span>함께 만드는 생활 루틴</span></footer>
      </main>
    </div>
    {detailTask&&<Dialog title="추천 근거" onClose={()=>setDetailTask(null)}><RecommendationDetails task={detailTask} weather={weather} air={data?.air_quality}/></Dialog>}
    {undoTarget&&<Dialog title="완료 취소" error={error} onClose={()=>setUndoTarget(null)}><p>‘{undoTarget.title}’의 완료를 취소하고 예정일을 {undoTarget.previous_date}로 복구할까요?</p><div className="dialog-actions"><button onClick={()=>setUndoTarget(null)}>닫기</button><button className="primary" disabled={busy} onClick={()=>mutate('/logs/'+undoTarget.id+'/undo','POST',null,'완료를 취소하고 이전 예정일을 복구했습니다.')}>완료 취소</button></div></Dialog>}
    {notice&&<div className="toast" role="status"><Check size={18}/>{notice}</div>}
    {modal&&<TaskDialog members={home.members} task={modal} busy={busy} error={error} onClose={()=>setModal(null)} onSave={task=>mutate('/tasks'+(modal.id?'/'+modal.id:''),modal.id?'PUT':'POST',task,'집안일을 저장했습니다.')}/>}
    {deleteTarget&&<Dialog error={error} title="집안일 삭제" onClose={()=>setDeleteTarget(null)}><p>‘{deleteTarget.title}’의 반복 일정을 삭제할까요? 완료 기록은 유지됩니다.</p><div className="dialog-actions"><button onClick={()=>setDeleteTarget(null)}>취소</button><button className="danger" disabled={busy} onClick={()=>mutate('/tasks/'+deleteTarget.id+'?revision='+deleteTarget.revision,'DELETE',null,'집안일을 삭제했습니다.')}>삭제</button></div></Dialog>}
  </div>;
}

function AirQuality({air,region,loading,onRefresh}) {
  const ready=!loading && air?.region===region && ['ok','stale'].includes(air.status);
  const labels={1:'좋음',2:'보통',3:'나쁨',4:'매우 나쁨'};
  const poor=ready && air.status==='ok' && [air.pm10_grade,air.pm25_grade].some(g=>g>=3);
  return <section className="air-quality" aria-label="대기질 정보"><div className="section-heading"><h2><Leaf size={18}/>우리 동네 대기질</h2><IconButton label="대기질 새로고침" disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading?'spin':''}/></IconButton></div>
    {ready?<><div className="air-readings">{[['pm10','미세먼지'],['pm25','초미세먼지']].map(([field,label])=><div key={field}><span>{label}</span><strong>{air[field]??'—'}<small>µg/m³</small></strong><span className={'air-grade grade-'+(air[field+'_grade']||0)}>{labels[air[field+'_grade']]||'측정 정보 없음'}</span></div>)}</div><p className="weather-stamp">{air.station} 측정소 · {new Date(air.measured_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric'})}</p><p className="air-note">{air.status==='stale'?'갱신이 지연된 자료로 추천에 반영하지 않습니다.':poor?'미세먼지 나쁨 이상입니다. 야외 청소 일정을 확인해 보세요.':'지역 내 측정소 기준으로, 집 주변과 다를 수 있어요.'}</p></>:<p className="air-note">{loading?'대기질 확인 중':air?.message||'대기질 연결 대기 중'}</p>}
    <a className="source" href="https://www.data.go.kr/data/15073861/openapi.do" target="_blank" rel="noreferrer">출처 · 한국환경공단 에어코리아<ArrowUpRight size={13}/></a></section>;
}
function daysBefore(day,count) {const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()-count);return value.toISOString().slice(0,10);}
function Report({logs,today,postponements,onUndo,busy,members}) {
  const days = Array.from({length:7},(_,i)=>daysBefore(today,6-i));
  const counts=days.map(day=>logs.filter(l=>l.completed_at.slice(0,10)===day).length);
  const recent=logs.filter(l=>l.completed_at.slice(0,10)>=days[0]);
  const max=Math.max(1,...counts);
  return <section className="report"><div className="section-heading"><h2>최근 7일의 완료 기록</h2><span>{days[0]} ~ {today}</span></div><div className="bar-chart" aria-label="최근 7일 완료 건수">{days.map((day,i)=><div className="bar-column" key={day}><strong>{counts[i]}</strong><div className="bar-track"><i style={{height:(counts[i]/max*100)+'%'}}/></div><span>{day.slice(5).replace('-','/')}</span></div>)}</div><div className="room-summary">{rooms.map(room=><div key={room}><span>{room}</span><strong>{recent.filter(l=>l.room===room).length}<small>회</small></strong></div>)}</div><h2>완료 이력</h2>{logs.length?<div className="history">{logs.slice(0,30).map(l=><div key={l.id}><Check size={18}/><strong>{l.title}</strong><span>{l.completed_by_name||'이전 기록'} · {l.room}{l.assignee_name?' / 담당: '+l.assignee_name:''}</span><time>{new Date(l.completed_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time><UndoButton log={l} busy={busy} onUndo={onUndo}/></div>)}</div>:<p className="empty">아직 완료한 집안일이 없어요.</p>}<SharingReport logs={logs} today={today} members={members}/><PostponementReport items={postponements}/></section>;
}
function Dialog({title,onClose,children,error}) {
  const ref=useRef();
  useEffect(()=>{ref.current.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose()}}><div className="dialog-heading"><h2>{title}</h2><IconButton label="닫기" onClick={onClose}><X size={20}/></IconButton></div>{error&&<div className="alert" role="alert">{error}</div>}{children}</dialog>;
}
function TaskDialog({task,busy,onClose,onSave,error,members}) {
  const [form,setForm]=useState(task);
  const change=(field,value)=>setForm(f=>({...f,[field]:value}));
  const kinds = {general:'일반 집안일',bathroom:'욕실 물기 관리',laundry:'빨래 · 자연건조',outdoor:'야외 청소',filter:'필터 점검',ventilation:'환기',recycling:'재활용품 배출 준비',food_waste:'음식물쓰레기 배출 준비',trash:'일반쓰레기 배출 준비'};
  return <Dialog error={error} title={task.id?'집안일 수정':'새로운 집안일'} onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();if(form.title.trim())onSave({...form,interval_days:Number(form.interval_days)})}}>
      <label>집안일 이름<input autoFocus required maxLength={80} value={form.title} placeholder="예: 욕실 물기 닦기" onChange={e=>change('title',e.target.value)}/></label>
      <div className="form-row"><label>공간<select value={form.room} onChange={e=>change('room',e.target.value)}>{rooms.map(r=><option key={r}>{r}</option>)}</select></label><label>반복 주기 (일)<input type="number" required min="1" max="365" value={form.interval_days} onChange={e=>change('interval_days',e.target.value)}/></label></div>
      <label>다음 예정일<input type="date" required value={form.due_date} onChange={e=>change('due_date',e.target.value)}/></label>
      <label>담당자<select value={form.assigned_to??''} onChange={e=>change('assigned_to',e.target.value?Number(e.target.value):null)}><option value="">미지정</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>작업 유형<select value={form.kind} onChange={e=>change('kind',e.target.value)}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <div className="dialog-actions"><button type="button" onClick={onClose}>취소</button><button className="primary" disabled={busy||!form.title.trim()} type="submit">{busy?'저장 중…':'저장'}</button></div>
    </form>
  </Dialog>;
}
createRoot(document.getElementById('root')).render(<AccountGate>{(account,refresh)=><App key={account.user.id+':'+account.home.id} account={account} onAccountChange={refresh}/>}</AccountGate>);
