"""Curated municipal guidance, not a live waste collection API."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


CHECKED = '2026-10-01'
REGIONS = {
    'seoul-gangnam': {
        'name': '서울 강남구', 'scope': '공공 수거 대상 단독주택',
        'source': 'https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109',
        'rules': [
            {'kind': 'recycling', 'days': [3], 'label': '비닐 · 투명페트병', 'time': '20:00 ~ 다음 날 05:00'},
            {'kind': 'recycling', 'days': [0, 1, 2, 4, 6], 'label': '기타 재활용품 (비닐 · 투명페트병 제외)', 'time': '20:00 ~ 다음 날 05:00'},
        ],
    },
    'busan-sasang': {
        'name': '부산 사상구', 'scope': '단독주택 지역',
        'source': 'https://www.sasang.go.kr/dong/index.sasang?menuCd=DOM_000001315002000000',
        'rules': [
            {'kind': 'trash', 'days': [6, 1, 3], 'label': '일반쓰레기', 'time': '20:00 ~ 23:00'},
            {'kind': 'food_waste', 'days': [6, 1, 3], 'label': '음식물쓰레기', 'time': '20:00 ~ 23:00'},
            {'kind': 'recycling', 'days': [0], 'label': '병 · 비닐 · 종이 · 스티로폼 등 (공식 품목 확인)', 'time': '20:00 ~ 23:00'},
            {'kind': 'recycling', 'days': [2], 'label': '플라스틱 · 캔 · 고철 · 투명페트병 등', 'time': '20:00 ~ 23:00'},
        ],
    },
    'incheon-yeonsu': {
        'name': '인천 연수구 연수동', 'scope': '연수1·2·3동 단독주택',
        'source': 'https://www.yeonsu.go.kr/discharge/kor/sub/week.asp',
        'rules': [
            {'kind': 'trash', 'days': [0, 1, 2, 3, 4, 6], 'label': '일반쓰레기', 'time': '시간은 공식 품목별 안내 확인'},
            {'kind': 'food_waste', 'days': [1, 3, 6], 'label': '음식물쓰레기', 'time': '시간은 공식 품목별 안내 확인'},
            {'kind': 'recycling', 'days': [1, 3, 6], 'label': '재활용품', 'time': '일몰 후 18:00 ~ 다음 날 04:00'},
        ],
        'time_source': 'https://www.yeonsu.go.kr/discharge/kor/sub/method_recycle.asp',
    },
}


class Setting(BaseModel):
    region: Literal['seoul-gangnam', 'busan-sasang', 'incheon-yeonsu'] | None = None
    housing: Literal['detached', 'apartment'] = 'detached'


def initialize(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS waste_settings(home_id INTEGER PRIMARY KEY, region TEXT, housing TEXT NOT NULL)')


def schedule(conn, home_id, day):
    row = conn.execute('SELECT region,housing FROM waste_settings WHERE home_id=?', (home_id,)).fetchone()
    setting = dict(row) if row else {'region': None, 'housing': 'detached'}
    region = REGIONS.get(setting['region'])
    supported = bool(region and setting['housing'] == 'detached')
    days = []
    if supported:
        for offset in range(7):
            date = day + timedelta(days=offset)
            items = [rule for rule in region['rules'] if date.weekday() in rule['days']]
            days.append({'date': date.isoformat(), 'items': items})
    return {'setting': setting, 'region': region, 'supported': supported, 'days': days,
            'checked_at': CHECKED, 'data_type': 'official_guidance_snapshot',
            'notice': '공식 공개안내를 정리한 자료이며 실시간 수거 정보가 아닙니다. 명절·임시 변경은 지자체 공지가 우선합니다. 표시되지 않은 품목은 배출 불가가 아니라 미지원입니다.'}


def add_evidence(task, waste):
    if not waste['supported'] or not waste['days']:
        return task
    items = [item for item in waste['days'][0]['items'] if item['kind'] == task['kind']]
    if not items:
        return task
    # This raises preparation priority without claiming every recyclable is eligible.
    label = '오늘 배출 품목 확인 · ' + ', '.join(item['label'] for item in items)
    return {**task, 'score': task['score'] + 3, 'reasons': [*task['reasons'], label],
            'evidence': [*task['evidence'], {'label': label, 'points': 3,
                'source': waste['region']['name'] + ' 공식 배출안내',
                'value': ' / '.join(item['time'] for item in items),
                'time': waste['checked_at'], 'url': waste['region']['source']}]}


def router(database, accounts, today):
    r = APIRouter(prefix='/api/waste')

    @r.get('')
    def read(ctx=Depends(accounts.context)):
        with database() as conn:
            accounts.check_membership(conn, ctx)
            return {**schedule(conn, ctx['home_id'], today()),
                    'regions': [{'id': key, 'name': value['name']} for key, value in REGIONS.items()]}

    @r.put('')
    def save(data: Setting, ctx=Depends(accounts.context)):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if accounts.check_membership(conn, ctx) != 'admin':
                raise HTTPException(403, '관리자만 배출 지역을 변경할 수 있습니다.')
            conn.execute('INSERT INTO waste_settings(home_id,region,housing) VALUES (?,?,?) ON CONFLICT(home_id) DO UPDATE SET region=excluded.region,housing=excluded.housing',
                         (ctx['home_id'], data.region, data.housing))
        return {'ok': True}

    return r
