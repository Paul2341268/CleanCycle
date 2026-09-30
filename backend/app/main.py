import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .weather import REGIONS, get_weather
from .air_quality import get_air_quality

app = FastAPI(title='CleanCycle Personal')


@app.get('/api/health')
def health():
    return {'status': 'ok', 'mode': 'personal'}


@app.get('/api/regions')
def regions():
    return [{'id': key, **value} for key, value in REGIONS.items()]


@app.get('/api/environment')
async def environment(region: str = 'busan'):
    if region not in REGIONS:
        raise HTTPException(422, '지원하지 않는 지역입니다.')
    weather, air = await asyncio.gather(get_weather(region), get_air_quality(region))
    return {'weather': weather, 'air_quality': air, 'region': region}


@app.middleware('http')
async def response_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    return response


DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='frontend')
