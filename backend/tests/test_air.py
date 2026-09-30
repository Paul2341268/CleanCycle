from datetime import datetime, timedelta

import httpx
import pytest

from app import air_quality as air
from app.main import recommendation, today
from test_app import client


def reading(now, **extra):
    return {'stationName':'연산동','dataTime':now.strftime('%Y-%m-%d %H:%M'),
            'pm10Value':'25','pm25Value':'12','pm10Grade1h':'1','pm25Grade1h':'1',**extra}


def test_missing_values_and_stale_measurements():
    now=datetime.now(air.KST)
    result=air.parse_air([reading(now,pm10Value='-',pm25Flag='점검중')],'연산동',now)
    assert result['pm10'] is None and result['pm25'] is None
    assert result['pm10_grade'] is None and result['pm25_grade'] is None
    assert air.parse_air([reading(now-timedelta(hours=4))],'연산동',now)['status']=='stale'
    with pytest.raises(ValueError):
        air.parse_air([],'연산동',now)


def test_air_success_cache_and_recommendation(client,monkeypatch):
    monkeypatch.setenv('AIRKOREA_SERVICE_KEY','fake-air-key')
    air.cache.clear()
    calls=[]
    async def success(*args,**kwargs):
        calls.append(kwargs['params'])
        return httpx.Response(200,request=httpx.Request('GET','https://example.test'),json={
            'response':{'header':{'resultCode':'00'},'body':{'items':[reading(datetime.now(air.KST),pm25Value='55',pm25Grade1h='3')]}}})
    monkeypatch.setattr(httpx.AsyncClient,'get',success)
    result=client.get('/api/dashboard').json()['air_quality']
    assert result['status']=='ok' and result['pm25']==55
    assert client.get('/api/dashboard').json()['air_quality']==result
    assert len(calls)==1 and calls[0]['sidoName']=='부산'
    task={'due_date':today().isoformat(),'kind':'outdoor'}
    assert recommendation(task,{},result)['score']==-3
    assert recommendation(task,{},{**result,'status':'stale'})['score']==0


def test_air_error_does_not_leak_key(client,monkeypatch):
    monkeypatch.setenv('AIRKOREA_SERVICE_KEY','secret-error-key')
    async def failure(*args,**kwargs):
        raise httpx.ConnectError('secret-error-key')
    monkeypatch.setattr(httpx.AsyncClient,'get',failure)
    result=client.get('/api/dashboard')
    assert result.json()['air_quality']['status']=='error'
    assert 'secret-error-key' not in result.text
