import React, {useEffect, useState} from 'react';
import {ExternalLink, Save, Recycle} from 'lucide-react';
import {api} from './api';

export function WasteSettings({home, onChanged}) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const load = async () => {
    const result = await api('/waste');
    setData(result);
    setForm(result.setting);
  };
  useEffect(() => {load().catch(e => setError(e.message));}, [home.id]);
  const save = async e => {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      await api('/waste', {method:'PUT', body:JSON.stringify(form)});
      await load();
      await onChanged();
      setSaved(true);
    } catch(e) {setError(e.message);}
    finally {setBusy(false);}
  };
  return <section className="waste-settings" aria-label="쓰레기 배출 일정">
    <div className="section-heading"><h2><Recycle size={20}/> 쓰레기 배출 일정</h2></div>
    {error && <p className="alert" role="alert">{error}</p>}
    {!data ? <p>배출 정보를 불러오는 중입니다.</p> : <>
      <form onSubmit={save}>
        <div className="form-row">
          <label>배출 지역<select disabled={busy || home.role!=='admin'} value={form.region || ''} onChange={e => {setSaved(false); setForm({...form, region:e.target.value || null});}}>
            <option value="">미설정 · 지원 지역 외</option>
            {data.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
          <label>주택 유형<select disabled={busy || home.role!=='admin'} value={form.housing} onChange={e => {setSaved(false); setForm({...form, housing:e.target.value});}}>
            <option value="detached">단독주택</option><option value="apartment">아파트 · 공동주택</option>
          </select></label>
        </div>
        {home.role==='admin' && <button className="primary" disabled={busy} type="submit"><Save size={16}/>{busy?'저장 중':'배출 설정 저장'}</button>}
        {saved && <span className="waste-saved" role="status">저장했습니다.</span>}
      </form>
      <div className="waste-schedule" aria-label="저장된 배출 일정">
        <h3>{data.region?.name || '배출 지역 미설정'}</h3>
        {!data.supported ? <p>{data.setting.housing==='apartment'?'공동주택은 단지별 배출일이 달라 관리사무소 공지를 확인해 주세요. 지역 기본 일정을 추천에 반영하지 않습니다.':'지원하는 지역을 선택하면 배출 일정을 확인할 수 있습니다.'}</p> : <>
          <p>{data.region.scope} 기준 · 배출을 시작하는 날짜</p>
          <ul>{data.days.map(day => <li key={day.date}><time dateTime={day.date}>{new Date(day.date+'T12:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short'})}</time>
            <div>{day.items.length ? day.items.map((item,i) => <p key={i}><strong>{item.label}</strong><small>{item.time}</small></p>) : <p>등록된 배출 일정 없음</p>}</div>
          </li>)}</ul>
        </>}
        <p className="waste-disclaimer">{data.notice}</p>
        {data.region && <p className="waste-sources"><a href={data.region.source} target="_blank" rel="noreferrer">공식 배출 안내 <ExternalLink size={14}/></a>{data.region.time_source && <a href={data.region.time_source} target="_blank" rel="noreferrer">재활용 배출시간 <ExternalLink size={14}/></a>}<span>확인일 {data.checked_at}</span></p>}
      </div>
    </>}
  </section>;
}
