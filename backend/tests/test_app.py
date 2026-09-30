from datetime import datetime, timedelta

import httpx
import pytest
import re
from fastapi.testclient import TestClient

from app import main, weather, air_quality


class ChoreClient(TestClient):
    def request(self, method, url, **kwargs):
        # Existing single-user cases now exercise the authenticated API contract.
        match = re.fullmatch(r'/api/tasks/(\d+)(?:/(complete|postpone))?',str(url))
        if match and method.upper() in ('PUT','POST','DELETE'):
            with main.database() as conn:
                row=conn.execute('SELECT revision FROM tasks WHERE id=?',(int(match[1]),)).fetchone()
            revision=row['revision'] if row else 0
            if method.upper()=='DELETE':
                kwargs['params']=kwargs.get('params') or {}
                kwargs['params'].setdefault('revision',revision)
            elif 'json' in kwargs:
                kwargs['json'].setdefault('revision',revision)
        return super().request(method,url,**kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB", tmp_path / "test.sqlite3")
    monkeypatch.setattr(weather, "ENV", tmp_path / "missing.env")
    monkeypatch.setattr(air_quality, "ENV", tmp_path / "missing.env")
    monkeypatch.delenv("KMA_SERVICE_KEY", raising=False)
    monkeypatch.delenv("AIRKOREA_SERVICE_KEY", raising=False)
    with ChoreClient(main.app, headers={'X-CleanCycle-Request':'1'}) as value:
        assert value.post('/api/auth/register',json={'username':'owner','name':'본인','password':'test-password-123'}).status_code==201
        assert value.post('/api/homes',json={'name':'테스트 집'}).status_code==201
        yield value


def test_complete_persists_and_rejects_duplicate(client):
    day = main.today()
    task = {"title": "침구 세탁", "room": "침실", "interval_days": 14,
            "due_date": (day - timedelta(days=3)).isoformat(), "kind": "laundry"}
    response = client.post("/api/tasks", json=task)
    assert response.status_code == 201
    path = f'/api/tasks/{response.json()["id"]}/complete'
    assert client.post(path, json={"due_date": task["due_date"]}).json()["due_date"] == (day + timedelta(days=14)).isoformat()
    assert client.post(path, json={"due_date": task["due_date"]}).status_code == 409
    result = client.get("/api/dashboard").json()
    assert len(result["logs"]) == 1
    assert result["weather"]["status"] == "unconfigured"
    assert client.post(path, json={"due_date": result["tasks"][0]["due_date"]}).status_code == 409


def test_postpone_edit_delete_and_validation(client):
    task = {"title": "청소", "room": "거실", "interval_days": 7, "due_date": main.today().isoformat()}
    assert client.post('/api/tasks', json={**task,"title":"   "}).status_code == 422
    assert client.post('/api/tasks', json={**task,"interval_days":0}).status_code == 422
    task_id = client.post('/api/tasks', json=task).json()['id']
    path = f'/api/tasks/{task_id}'
    assert client.post(path+'/postpone',json={"due_date":task['due_date']}).json()['due_date'] == (main.today()+timedelta(days=1)).isoformat()
    assert client.put(path,json={**task,'title':'바닥 청소'}).status_code == 200
    assert client.get('/api/dashboard').json()['tasks'][0]['title'] == '바닥 청소'
    assert client.delete(path).status_code == 200
    assert client.get('/api/dashboard').json()['tasks'] == []
    assert client.delete(path).status_code == 404
    assert client.get('/api/dashboard?region=invalid').status_code == 422


def test_forecast_midnight_and_publication_delay():
    assert weather.base_time(datetime(2026,9,21,0,5,tzinfo=weather.KST)).strftime('%Y%m%d%H%M') == '202609202300'
    assert weather.base_time(datetime(2026,9,21,11,10,tzinfo=weather.KST)).hour == 8
    assert weather.base_time(datetime(2026,9,21,11,15,tzinfo=weather.KST)).hour == 11


def test_parse_same_future_slot():
    now=datetime(2026,9,21,10,30,tzinfo=weather.KST)
    items=[{'fcstDate':'20260921','fcstTime':hour,'category':c,'fcstValue':v}
           for hour in ['1000','1100'] for c,v in {'TMP':'25','REH':'80','POP':'70','PTY':'1'}.items()]
    result=weather.parse_forecast(items,now)
    assert result['forecast_at'].startswith('2026-09-21T11:00')
    assert result['humidity']==80
    with pytest.raises(ValueError):
        weather.parse_forecast([],now)


def test_api_errors_never_expose_key(client, monkeypatch):
    monkeypatch.setenv('KMA_SERVICE_KEY','private-test-key')
    async def failure(*args,**kwargs):
        raise httpx.ConnectError('private-test-key')
    monkeypatch.setattr(httpx.AsyncClient,'get',failure)
    response=client.get('/api/dashboard')
    assert response.json()['weather']['status']=='error'
    assert 'private-test-key' not in response.text


def test_weather_recommendation_does_not_move_due_date():
    task={'due_date':main.today().isoformat(),'kind':'laundry'}
    result=main.recommendation(task,{'status':'ok','rain_probability':80,'precipitation':1,'humidity':80})
    assert result['score']==-3
    assert result['due_date']==task['due_date']
    assert len(result['reasons'])==2


def test_deleted_completed_task_identity_is_not_reused(client):
    task={'title':'청소','room':'거실','interval_days':7,'due_date':main.today().isoformat()}
    first=client.post('/api/tasks',json=task).json()['id']
    assert client.post(f'/api/tasks/{first}/complete',json={'due_date':task['due_date']}).status_code==200
    client.delete(f'/api/tasks/{first}')
    second=client.post('/api/tasks',json=task).json()['id']
    assert second != first
    assert client.post(f'/api/tasks/{second}/complete',json={'due_date':task['due_date']}).status_code==200


def test_weather_success_and_cache(client, monkeypatch):
    monkeypatch.setenv('KMA_SERVICE_KEY','fake-success-key')
    weather.cache.clear()
    stamp=datetime.now(weather.KST)+timedelta(hours=2)
    items=[{'fcstDate':stamp.strftime('%Y%m%d'),'fcstTime':stamp.strftime('%H00'),
            'category':c,'fcstValue':v} for c,v in {'TMP':'25','REH':'80','POP':'70','PTY':'1'}.items()]
    calls=[]
    async def success(*args,**kwargs):
        calls.append(kwargs['params'])
        return httpx.Response(200,request=httpx.Request('GET','https://example.test'),
          json={'response':{'header':{'resultCode':'00'},'body':{'items':{'item':items}}}})
    monkeypatch.setattr(httpx.AsyncClient,'get',success)
    first=client.get('/api/dashboard').json()['weather']
    second=client.get('/api/dashboard').json()['weather']
    assert first['status']=='ok' and first['temperature']==25
    assert first==second and len(calls)==1
    assert calls[0]['nx']==98


def test_postpone_preserves_daily_total_and_history(client):
    task={'title':'청소','room':'거실','interval_days':7,'due_date':main.today().isoformat()}
    a=client.post('/api/tasks',json=task).json()['id']
    b=client.post('/api/tasks',json=task).json()['id']
    client.post(f'/api/tasks/{a}/complete',json={'due_date':task['due_date']})
    assert client.get('/api/dashboard').json()['daily_summary']['percent']==50
    result=client.post(f'/api/tasks/{b}/postpone',json={'due_date':task['due_date']})
    next_date=result.json()['due_date']
    client.post(f'/api/tasks/{b}/postpone',json={'due_date':next_date})
    summary=client.get('/api/dashboard').json()['daily_summary']
    assert summary=={'completed':1,'total':2,'percent':50}
    with main.database() as conn:
        assert conn.execute('SELECT COUNT(*) FROM postponements WHERE task_id=?',(b,)).fetchone()[0]==2
    # Completing a postponed task counts once, even after multiple postponements.
    task_b=next(t for t in client.get('/api/dashboard').json()['tasks'] if t['id']==b)
    client.post(f'/api/tasks/{b}/complete',json={'due_date':task_b['due_date']})
    assert client.get('/api/dashboard').json()['daily_summary']=={'completed':2,'total':2,'percent':100}


def test_edit_delete_and_restart_keep_daily_baseline(client):
    task={'title':'청소','room':'거실','interval_days':7,'due_date':main.today().isoformat()}
    task_id=client.post('/api/tasks',json=task).json()['id']
    client.put(f'/api/tasks/{task_id}',json={**task,'due_date':(main.today()+timedelta(days=5)).isoformat()})
    client.delete(f'/api/tasks/{task_id}')
    with TestClient(main.app,headers={'X-CleanCycle-Request':'1'}) as restarted:
        restarted.cookies.update(client.cookies)
        assert restarted.get('/api/dashboard').json()['daily_summary']=={'completed':0,'total':1,'percent':0}
    new_id=client.post('/api/tasks',json=task).json()['id']
    assert new_id!=task_id
