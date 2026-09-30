from datetime import datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main, weather, air_quality


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(weather, 'ENV', tmp_path/'missing.env')
    monkeypatch.setattr(air_quality, 'ENV', tmp_path/'missing.env')
    monkeypatch.delenv('KMA_SERVICE_KEY', raising=False)
    monkeypatch.delenv('AIRKOREA_SERVICE_KEY', raising=False)
    weather.cache.clear()
    air_quality.cache.clear()
    with TestClient(main.app) as value:
        yield value


def test_personal_app_needs_no_account_or_database(client):
    assert client.get('/api/health').json()['mode']=='personal'
    assert len(client.get('/api/regions').json())==7
    result=client.get('/api/environment?region=seoul')
    assert result.status_code==200
    assert result.json()['weather']['status']=='unconfigured'
    assert result.json()['air_quality']['status']=='unconfigured'
    assert result.headers['cache-control']=='no-store'
    assert client.get('/api/environment?region=invalid').status_code==422
    paths={route.path for route in main.app.routes}
    assert not any(path.startswith(('/api/auth','/api/tasks','/api/homes','/api/planner')) for path in paths)


def test_api_errors_never_expose_keys(client, monkeypatch):
    monkeypatch.setenv('KMA_SERVICE_KEY','private-test-key')
    async def failure(*args,**kwargs):
        raise httpx.ConnectError('private-test-key')
    monkeypatch.setattr(httpx.AsyncClient,'get',failure)
    response=client.get('/api/environment')
    assert response.json()['weather']['status']=='error'
    assert 'private-test-key' not in response.text


def test_forecast_publication_delay_and_midnight():
    assert weather.base_time(datetime(2026,9,21,0,5,tzinfo=weather.KST)).strftime('%Y%m%d%H%M')=='202609202300'
    assert weather.base_time(datetime(2026,9,21,11,10,tzinfo=weather.KST)).hour==8
    assert weather.base_time(datetime(2026,9,21,11,15,tzinfo=weather.KST)).hour==11


def test_parse_same_future_forecast_slot():
    now=datetime(2026,9,21,10,30,tzinfo=weather.KST)
    items=[{'fcstDate':'20260921','fcstTime':hour,'category':c,'fcstValue':v}
           for hour in ['1000','1100'] for c,v in {'TMP':'25','REH':'80','POP':'70','PTY':'1'}.items()]
    result=weather.parse_forecast(items,now)
    assert result['forecast_at'].startswith('2026-09-21T11:00')
    assert result['humidity']==80
    with pytest.raises(ValueError):
        weather.parse_forecast([],now)
