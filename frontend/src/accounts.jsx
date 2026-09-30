import React,{useEffect,useState} from 'react';
import {House,LogOut,RefreshCw,UserRoundX,ShieldCheck,Copy,Users} from 'lucide-react';
import {api} from './api';

export function AccountGate({children}) {
  const [account,setAccount]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  async function refresh(){
    try{const result=await api('/auth/me');if(result.home)result.home=await api('/home');setAccount(result);setError('');}
    catch(e){if(e.status===401){setAccount(null);setError('');}else setError(e.message);}
    finally{setLoading(false);}
  }
  useEffect(()=>{refresh();window.addEventListener('cleancycle-session-check',refresh);return()=>window.removeEventListener('cleancycle-session-check',refresh);},[]);
  if(loading)return <div className="account-page"><House size={30}/><p>CleanCycle을 불러오는 중입니다.</p></div>;
  if(!account)return <AuthForm onSuccess={refresh} initialError={error}/>;
  if(!account.home)return <HomeSetup user={account.user} onSuccess={refresh}/>;
  return children(account,refresh);
}

function Brand(){return <div className="brand account-brand"><span className="brand-icon"><House size={23}/></span>CleanCycle<span className="brand-dot">.</span></div>;}
function ErrorMessage({error}){return error?<div className="alert" role="alert">{error}</div>:null;}
export function Logout({onSuccess}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <div><button className="icon-button" aria-label="로그아웃" title="로그아웃" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/logout',{method:'POST'});await onSuccess();}catch(e){setError(e.message);}finally{setBusy(false);}}}><LogOut size={18}/></button><ErrorMessage error={error}/></div>;
}
function AuthForm({onSuccess,initialError}){
  const [mode,setMode]=useState('login');const [form,setForm]=useState({username:'',password:'',name:''});
  const [error,setError]=useState(initialError);const [busy,setBusy]=useState(false);
  const change=(key,value)=>setForm(f=>({...f,[key]:value}));
  return <div className="account-page"><div className="account-panel"><Brand/><div className="account-tabs">{[['login','로그인'],['register','회원가입']].map(([id,label])=><button key={id} aria-pressed={mode===id} className={mode===id?'selected':''} onClick={()=>{setMode(id);setError('');}}>{label}</button>)}</div><h1>{mode==='login'?'로그인':'회원가입'}</h1><ErrorMessage error={error}/><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/auth/'+mode,{method:'POST',body:JSON.stringify(form)});await onSuccess();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    {mode==='register'&&<label>이름<input required maxLength={30} autoComplete="nickname" value={form.name} onChange={e=>change('name',e.target.value)}/></label>}
    <label>아이디<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.@\-]+" autoComplete="username" value={form.username} onChange={e=>change('username',e.target.value)}/></label>
    <label>비밀번호<input type="password" required minLength={10} maxLength={128} autoComplete={mode==='register'?'new-password':'current-password'} placeholder="10자 이상" value={form.password} onChange={e=>change('password',e.target.value)}/></label>
    <button className="primary wide" disabled={busy}>{busy?'확인 중…':mode==='login'?'로그인':'회원가입'}</button></form></div></div>;
}

function HomeSetup({user,onSuccess}){
  const [mode,setMode]=useState('create');const [name,setName]=useState('우리 집');const [region,setRegion]=useState('busan');const [regions,setRegions]=useState([]);
  const [code,setCode]=useState('');const [legacy,setLegacy]=useState('');const [preview,setPreview]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{api('/regions').then(setRegions).catch(e=>setError(e.message));},[]);
  async function submit(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
    if(mode==='create'){await api('/homes',{method:'POST',body:JSON.stringify({name,region,legacy_code:legacy||null})});await onSuccess();}
    else if(!preview){setPreview(await api('/homes/preview',{method:'POST',body:JSON.stringify({code})}));}
    else{await api('/homes/join',{method:'POST',body:JSON.stringify({code})});await onSuccess();}
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="account-page"><div className="account-panel"><Brand/><div className="setup-user"><span>{user.name}님</span><Logout onSuccess={onSuccess}/></div><h1>함께 관리할 우리 집</h1><div className="account-tabs">{[['create','집 만들기'],['join','초대로 참여']].map(([id,label])=><button key={id} aria-pressed={mode===id} className={mode===id?'selected':''} onClick={()=>{setMode(id);setError('');setPreview(null);}}>{label}</button>)}</div><ErrorMessage error={error}/><form onSubmit={submit}>{mode==='create'?<>
    <label>집 이름<input required maxLength={50} value={name} onChange={e=>setName(e.target.value)}/></label><label>집의 지역<select value={region} onChange={e=>setRegion(e.target.value)}>{regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <details className="legacy-input"><summary>기존 개인 데이터 이전</summary><label>이전 코드<input type="password" value={legacy} onChange={e=>setLegacy(e.target.value)} autoComplete="off"/></label></details>
    </>:<><label>초대 코드<input required minLength={6} maxLength={64} value={code} onChange={e=>{setCode(e.target.value);setPreview(null);}} autoComplete="off"/></label>{preview&&<p className="join-preview">‘{preview.name}’에 참여하시겠어요?</p>}</>}
    <button className="primary wide" disabled={busy}>{busy?'확인 중…':mode==='create'?'우리 집 만들기':preview?'이 집에 참여':'초대 확인'}</button></form></div></div>;
}

export function HouseholdSettings({home,user,onChanged}){
  const [name,setName]=useState(home.name);const [region,setRegion]=useState(home.region);const [regions,setRegions]=useState([]);
  const [invitation,setInvitation]=useState(null);const [pending,setPending]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const admin=home.role==='admin';
  useEffect(()=>{setName(home.name);setRegion(home.region);setInvitation(null);},[home.id,home.role]);
  useEffect(()=>{api('/regions').then(setRegions).catch(e=>setError(e.message));},[]);
  async function run(path,method,body,success){if(busy)return;setBusy(true);setError('');try{const result=await api(path,{method,...(body?{body:JSON.stringify(body)}:{})});if(path==='/home/invite'&&method==='POST')setInvitation(result);else setInvitation(null);setPending(null);setNotice(success);await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="household-settings"><ErrorMessage error={error}/>{notice&&<p className="settings-notice" role="status">{notice}</p>}<h2>우리 집 정보</h2><form className="home-form" onSubmit={e=>{e.preventDefault();run('/home','PUT',{name,region},'집 정보를 저장했습니다.');}}><label>집 이름<input required maxLength={50} value={name} disabled={!admin||busy} onChange={e=>setName(e.target.value)}/></label><label>집의 지역<select value={region} disabled={!admin||busy} onChange={e=>setRegion(e.target.value)}>{regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{admin&&<button className="primary" disabled={busy}>저장</button>}</form>
    <div className="settings-section"><div className="section-heading"><h2><Users size={18}/>구성원 {home.members.length}명</h2></div>{home.members.map(m=><div className="member-row" key={m.id}><div><strong>{m.name}{m.id===user.id?' (나)':''}</strong><small>{m.role==='admin'?'관리자':'구성원'}</small></div>{admin&&m.id!==user.id&&<div className="member-actions"><button className="icon-button" disabled={busy} aria-label={m.name+' 관리자 이전'} title="관리자 이전" onClick={()=>setPending({message:`${m.name}님에게 관리자 권한을 이전할까요?`,path:'/home/transfer',method:'POST',body:{user_id:m.id}})}><ShieldCheck size={19}/></button><button className="icon-button" disabled={busy} aria-label={m.name+' 내보내기'} title="내보내기" onClick={()=>setPending({message:`${m.name}님을 내보낼까요? 담당 작업은 미지정으로 바뀝니다.`,path:'/home/members/'+m.id,method:'DELETE'})}><UserRoundX size={19}/></button></div>}</div>)}</div>
    {admin&&<div className="settings-section"><h2>구성원 초대</h2><div className="invite-actions"><button disabled={busy} onClick={()=>run('/home/invite','POST',null,'새 초대 코드를 발급했습니다. 기존 코드는 사용할 수 없습니다.')}><RefreshCw size={16}/>초대 코드 발급</button><button disabled={busy} onClick={()=>setPending({message:'현재 초대 코드를 폐기할까요?',path:'/home/invite',method:'DELETE'})}>초대 중지</button></div>{invitation&&<div className="invitation"><code>{invitation.code}</code><button className="icon-button" title="초대 코드 복사" aria-label="초대 코드 복사" onClick={async()=>{try{await navigator.clipboard.writeText(invitation.code);setNotice('코드를 복사했습니다.');}catch{setError('코드를 직접 선택해 복사해 주세요.');}}}><Copy size={17}/></button><small>{new Date(invitation.expires_at*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}까지 유효</small></div>}</div>}
    <div className="settings-section"><button className="danger" disabled={busy} onClick={()=>setPending({message:home.members.length===1?'집을 나가면 이 집은 보관 상태가 됩니다. 나갈까요?':'이 집에서 나갈까요? 담당 작업은 미지정으로 바뀝니다.',path:'/home/leave',method:'POST'})}><LogOut size={16}/>집 나가기</button></div>
    {pending&&<div className="inline-confirm" role="alertdialog" aria-label="구성원 변경 확인"><p>{pending.message}</p><div><button onClick={()=>setPending(null)} disabled={busy}>취소</button><button className="primary" disabled={busy} onClick={()=>run(pending.path,pending.method,pending.body,'변경했습니다.')}>확인</button></div></div>}
  </section>;
}

export function SharingReport({logs,today,members}){
  const from=new Date(today+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-6);
  const since=from.toISOString().slice(0,10);const recent=logs.filter(l=>l.completed_at.slice(0,10)>=since);
  const people=new Map(members.map(m=>[m.id,{name:m.name,count:0}]));
  for(const log of recent){const id=log.completed_by??'unknown';const person=people.get(id)||{name:log.completed_by_name||'이전 기록 · 사용자 미상',count:0};person.count++;people.set(id,person);}
  return <section className="sharing-report"><h2>최근 7일 구성원별 완료</h2><div>{[...people.entries()].map(([id,p])=><div className="sharing-row" key={id}><strong>{p.name}</strong><span>{p.count}회</span><small>{recent.length?Math.round(p.count/recent.length*100):0}%</small></div>)}</div></section>;
}
