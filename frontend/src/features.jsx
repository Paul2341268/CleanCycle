import React from 'react';
import {Undo2, Clock3} from 'lucide-react';

const stamp = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '';
export function UndoButton({log,busy,onUndo}) {
  return <button className="icon-button" disabled={busy||!log.can_undo} onClick={()=>onUndo(log)} aria-label={log.title+' 완료 취소'} title={log.can_undo?'완료 취소':log.undo_unavailable_reason||'취소할 수 없는 기록'}><Undo2 size={17}/></button>;
}
export function RecommendationDetails({task,weather,air}) {
  return <div className="recommendation-detail"><p className="detail-task">{task.title}</p><div className="detail-total"><span>추천 우선순위 점수</span><strong>{task.score}</strong></div>
    <ol className="evidence-list">{(task.evidence||[]).map((item,i)=><li key={i}><div><strong>{item.label}</strong><b className={item.points<0?'coral':'green'}>{item.points>0?'+':''}{item.points}점</b></div><p>{String(item.value??'미측정').replaceAll('None','미측정')}</p><small>{item.source}{item.time?' · '+stamp(item.time):''}</small></li>)}</ol>
    <div className="detail-inputs"><h3>조회된 환경 정보</h3>{weather?.status==='ok'&&<p>기상청 · 습도 {weather.humidity}% · 강수확률 {weather.rain_probability}%<br/><small>{stamp(weather.forecast_at)} 예보</small></p>}{['ok','stale'].includes(air?.status)&&<p>에어코리아 · {air.station} 측정소<br/>PM10 {air.pm10??'미측정'} / PM2.5 {air.pm25??'미측정'} µg/m³<br/><small>{stamp(air.measured_at)} 측정{air.status==='stale'?' · 갱신 지연':''}</small></p>}</div>
    <p className="detail-note">점수와 작업 추천은 CleanCycle의 자체 규칙입니다. 공공기관이 집안일을 추천한 것은 아닙니다. 해당 작업 유형에 적용되는 조건만 점수에 반영합니다.</p>
    <p className="detail-note">{weather?.status==='ok'?'실외 예보는 실내 상태와 다를 수 있습니다.':'날씨 자료가 없어 날씨 조건은 반영하지 않았습니다.'} {air?.status!=='ok'?'대기질은 미연결·오류·갱신 지연으로 반영하지 않았습니다.':'대기질은 표시된 측정소 기준입니다.'}</p>
    <div className="detail-sources"><a href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">기상청 데이터 출처</a><a href="https://www.data.go.kr/data/15073861/openapi.do" target="_blank" rel="noreferrer">에어코리아 데이터 출처</a></div>
  </div>;
}
export function PostponementReport({items=[]}) {
  const groups=new Map();
  for(const item of items){const group=groups.get(item.task_id)||{title:item.display_title,count:0};group.count++;groups.set(item.task_id,group);}
  const ranking=[...groups.entries()].sort((a,b)=>b[1].count-a[1].count||a[0]-b[0]);
  return <section className="postponement-report"><div className="section-heading"><h2><Clock3 size={18}/>최근 7일 미루기</h2><span>{items.length}회 · {groups.size}개 작업</span></div>
    {items.length?<><div className="postpone-ranking">{ranking.slice(0,5).map(([id,item])=><div key={id}><span>{item.title}</span><b>{item.count}회</b></div>)}</div><details><summary>미룬 이력 {items.length}건</summary><div className="postpone-history">{items.map(item=><article key={item.id}><strong>{item.display_title}</strong><span>{item.previous_date} → {item.next_date}</span><small>{stamp(item.postponed_at)}</small></article>)}</div></details></>:<p className="empty">최근 7일간 미룬 기록이 없어요.</p>}
  </section>;
}
