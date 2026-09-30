import base64
import binascii
import io
import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from .weather import KST


TEMPLATES = [
    ('욕실 물기 닦기', '욕실', 3, 'bathroom'),
    ('침구 세탁', '침실', 14, 'laundry'),
    ('냉장고 정리', '주방', 7, 'general'),
    ('거실 바닥 청소', '거실', 3, 'general'),
    ('공기청정기 필터 점검', '거실', 30, 'filter'),
    ('분리수거 준비', '기타', 7, 'recycling'),
]


class Profile(BaseModel):
    household_type: Literal['solo', 'family', 'roommates'] = 'solo'


class Note(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class AssignmentRequest(BaseModel):
    task_id: int
    revision: int
    target_id: int


class Photo(BaseModel):
    image: str = Field(min_length=1, max_length=400000)


def initialize(conn):
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS home_profiles(home_id INTEGER PRIMARY KEY, household_type TEXT NOT NULL, seeded INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT, home_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assignment_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, home_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL, revision INTEGER NOT NULL, requester_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS proofs(log_id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, image BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS notes_home ON notes(home_id);
    CREATE INDEX IF NOT EXISTS requests_home ON assignment_requests(home_id);
    ''')
    columns = {row[1] for row in conn.execute('PRAGMA table_info(daily_tasks)')}
    if 'room' not in columns:
        conn.execute('ALTER TABLE daily_tasks ADD COLUMN room TEXT')
    conn.execute('UPDATE daily_tasks SET room=(SELECT room FROM tasks WHERE tasks.id=daily_tasks.task_id) WHERE room IS NULL')


def build_report(conn, home_id, day):
    start = (day-timedelta(days=6)).isoformat()
    end = day.isoformat()
    planned = [dict(r) for r in conn.execute('SELECT day,task_id,room FROM daily_tasks WHERE home_id=? AND day BETWEEN ? AND ?', (home_id,start,end))]
    completed = [dict(r) for r in conn.execute('SELECT task_id,room,completed_at,completed_by FROM logs WHERE home_id=? AND undone_at IS NULL AND substr(completed_at,1,10) BETWEEN ? AND ?', (home_id,start,end))]
    due_pairs = {(r['day'],r['task_id']) for r in planned}
    done_pairs = {(r['completed_at'][:10],r['task_id']) for r in completed}
    def metric(p, c):
        total=len(p|c)
        return {'completed':len(c),'total':total,'percent':round(len(c)/total*100) if total else 0}
    rooms=[]
    for room in ['욕실','주방','침실','거실','기타']:
        p={(r['day'],r['task_id']) for r in planned if r['room']==room}
        c={(r['completed_at'][:10],r['task_id']) for r in completed if r['room']==room}
        rooms.append({'room':room,**metric(p,c)})
    tasks=[dict(r) for r in conn.execute('SELECT * FROM tasks WHERE home_id=?', (home_id,))]
    # The score describes recorded overdue tasks, not the physical cleanliness of a room.
    for item in rooms:
        current=[t for t in tasks if t['room']==item['room']]
        overdue=sum(t['due_date']<end for t in current)
        item['management_score']=round((len(current)-overdue)/len(current)*100) if current else None
    future=(day+timedelta(days=7)).isoformat()
    upcoming=sorted([t for t in tasks if end<t['due_date']<=future],key=lambda t:(t['due_date'],t['id']))[:20]
    return {'from':start,'to':end,'weekly':metric(due_pairs,done_pairs),'rooms':rooms,'upcoming':upcoming,
            'definition':'최근 7일의 기록된 일별 예정 작업과 완료 작업 합집합 대비 완료 비율입니다. 미룬 작업은 그날의 예정 기록에 남습니다.'}


def router(database, accounts, today):
    r=APIRouter(prefix='/api')
    context=Depends(accounts.context)

    @r.get('/planner')
    def read(ctx=context):
        with database() as conn:
            accounts.check_membership(conn,ctx)
            profile=conn.execute('SELECT * FROM home_profiles WHERE home_id=?',(ctx['home_id'],)).fetchone()
            notes=[dict(row) for row in conn.execute('SELECT n.*,u.name FROM notes n JOIN users u ON u.id=n.user_id WHERE n.home_id=? ORDER BY n.id DESC LIMIT 50',(ctx['home_id'],))]
            requests=[dict(row) for row in conn.execute("SELECT a.*,t.title,u.name AS requester_name,v.name AS target_name FROM assignment_requests a JOIN tasks t ON t.id=a.task_id JOIN users u ON u.id=a.requester_id JOIN users v ON v.id=a.target_id WHERE a.home_id=? AND a.status='pending' ORDER BY a.id DESC",(ctx['home_id'],))]
            proofs=[row[0] for row in conn.execute('SELECT p.log_id FROM proofs p JOIN logs l ON l.id=p.log_id WHERE p.home_id=? AND l.undone_at IS NULL',(ctx['home_id'],))]
            return {'profile':dict(profile) if profile else {'household_type':'solo','seeded':0},'notes':notes,'requests':requests,'proofs':proofs,'report':build_report(conn,ctx['home_id'],today())}

    @r.put('/planner/profile')
    def profile(data: Profile, ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if accounts.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 주거 형태를 변경할 수 있습니다.')
            conn.execute('INSERT INTO home_profiles(home_id,household_type) VALUES (?,?) ON CONFLICT(home_id) DO UPDATE SET household_type=excluded.household_type',(ctx['home_id'],data.household_type))
        return {'ok':True}

    @r.post('/planner/templates')
    def seed(data: Profile,ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if accounts.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 기본 루틴을 생성할 수 있습니다.')
            row=conn.execute('SELECT seeded FROM home_profiles WHERE home_id=?',(ctx['home_id'],)).fetchone()
            if row and row[0]:
                raise HTTPException(409,'기본 루틴은 이미 생성했습니다.')
            conn.execute('INSERT INTO home_profiles(home_id,household_type,seeded) VALUES (?,?,1) ON CONFLICT(home_id) DO UPDATE SET household_type=excluded.household_type,seeded=1',(ctx['home_id'],data.household_type))
            next_id=conn.execute('SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM tasks UNION ALL SELECT task_id AS id FROM logs UNION ALL SELECT task_id AS id FROM daily_tasks UNION ALL SELECT task_id AS id FROM postponements)').fetchone()[0]
            created=0
            for title,room,period,kind in TEMPLATES:
                if conn.execute('SELECT 1 FROM tasks WHERE home_id=? AND title=?',(ctx['home_id'],title)).fetchone():
                    continue
                interval=2 if data.household_type!='solo' and kind=='bathroom' else period
                conn.execute('INSERT INTO tasks(id,title,room,interval_days,due_date,kind,home_id,assigned_to) VALUES (?,?,?,?,?,?,?,?)',(next_id,title,room,interval,today().isoformat(),kind,ctx['home_id'],ctx['id'] if data.household_type=='solo' else None))
                next_id+=1
                created+=1
        return {'created':created}

    @r.post('/notes',status_code=201)
    def add_note(data: Note,ctx=context):
        text=data.text.strip()
        if not text:
            raise HTTPException(422,'메모 내용을 입력해 주세요.')
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            accounts.check_membership(conn,ctx)
            conn.execute('INSERT INTO notes(home_id,user_id,text,created_at) VALUES (?,?,?,?)',(ctx['home_id'],ctx['id'],text,datetime.now(KST).isoformat()))
        return {'ok':True}

    @r.delete('/notes/{note_id}')
    def remove_note(note_id:int,ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            role=accounts.check_membership(conn,ctx)
            row=conn.execute('SELECT * FROM notes WHERE id=? AND home_id=?',(note_id,ctx['home_id'])).fetchone()
            if not row: raise HTTPException(404,'메모가 없습니다.')
            if role!='admin' and row['user_id']!=ctx['id']: raise HTTPException(403,'작성자 또는 관리자만 삭제할 수 있습니다.')
            conn.execute('DELETE FROM notes WHERE id=?',(note_id,))
        return {'ok':True}

    @r.post('/assignment-requests',status_code=201)
    def request_assignment(data:AssignmentRequest,ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            accounts.check_membership(conn,ctx)
            task=conn.execute('SELECT * FROM tasks WHERE id=? AND home_id=?',(data.task_id,ctx['home_id'])).fetchone()
            if not task: raise HTTPException(404,'작업이 없습니다.')
            if task['revision']!=data.revision: raise HTTPException(409,'변경된 작업입니다. 다시 확인해 주세요.')
            if task['assigned_to']==data.target_id: raise HTTPException(422,'이미 담당 중인 구성원입니다.')
            if not conn.execute('SELECT 1 FROM members WHERE user_id=? AND home_id=?',(data.target_id,ctx['home_id'])).fetchone(): raise HTTPException(422,'우리 집 구성원을 선택해 주세요.')
            conn.execute("UPDATE assignment_requests SET status='superseded' WHERE task_id=? AND status='pending'",(data.task_id,))
            conn.execute('INSERT INTO assignment_requests(home_id,task_id,revision,requester_id,target_id,created_at) VALUES (?,?,?,?,?,?)',(ctx['home_id'],data.task_id,data.revision,ctx['id'],data.target_id,datetime.now(KST).isoformat()))
        return {'ok':True}

    @r.post('/assignment-requests/{request_id}/{action}')
    def respond(request_id:int,action:Literal['accept','decline'],ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            accounts.check_membership(conn,ctx)
            row=conn.execute('SELECT * FROM assignment_requests WHERE id=? AND home_id=?',(request_id,ctx['home_id'])).fetchone()
            if not row: raise HTTPException(404,'요청이 없습니다.')
            if row['target_id']!=ctx['id']: raise HTTPException(403,'요청을 받은 구성원만 응답할 수 있습니다.')
            if row['status']!='pending': raise HTTPException(409,'이미 처리된 요청입니다.')
            if action=='accept':
                task=conn.execute('SELECT revision FROM tasks WHERE id=? AND home_id=?',(row['task_id'],ctx['home_id'])).fetchone()
                if not task or task['revision']!=row['revision']: raise HTTPException(409,'요청 이후 작업이 변경되었습니다. 거절 후 새로 요청해 주세요.')
                conn.execute('UPDATE tasks SET assigned_to=?,revision=revision+1 WHERE id=?',(ctx['id'],row['task_id']))
            conn.execute('UPDATE assignment_requests SET status=? WHERE id=?',(action,request_id))
        return {'ok':True}

    @r.put('/logs/{log_id}/photo')
    def photo(log_id:int,data:Photo,ctx=context):
        try:
            raw=base64.b64decode(data.image,validate=True)
            if len(raw)>300000: raise ValueError()
            with Image.open(io.BytesIO(raw)) as picture:
                if picture.width*picture.height>12000000: raise ValueError()
                picture.load()
                picture=picture.convert('RGB')
                picture.thumbnail((1024,1024))
                output=io.BytesIO()
                picture.save(output,format='WEBP',quality=75)
                image=output.getvalue()
                if len(image)>200000: raise ValueError()
        except (ValueError,binascii.Error,UnidentifiedImageError,OSError,Image.DecompressionBombError):
            raise HTTPException(422,'사진 크기나 형식을 확인해 주세요.')
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            accounts.check_membership(conn,ctx)
            log=conn.execute('SELECT * FROM logs WHERE id=? AND home_id=? AND undone_at IS NULL',(log_id,ctx['home_id'])).fetchone()
            if not log: raise HTTPException(404,'완료 기록이 없습니다.')
            if log['completed_by']!=ctx['id']: raise HTTPException(403,'완료한 사람만 사진을 등록할 수 있습니다.')
            total=conn.execute('SELECT COUNT(*) FROM proofs WHERE home_id=?',(ctx['home_id'],)).fetchone()[0]
            if total>=100 and not conn.execute('SELECT 1 FROM proofs WHERE log_id=?',(log_id,)).fetchone(): raise HTTPException(409,'집별 사진 100장 한도입니다. 이전 사진을 삭제해 주세요.')
            conn.execute('INSERT INTO proofs(log_id,home_id,user_id,image,created_at) VALUES (?,?,?,?,?) ON CONFLICT(log_id) DO UPDATE SET image=excluded.image,created_at=excluded.created_at',(log_id,ctx['home_id'],ctx['id'],image,datetime.now(KST).isoformat()))
        return {'ok':True}

    @r.get('/logs/{log_id}/photo')
    def show_photo(log_id:int,ctx=context):
        with database() as conn:
            accounts.check_membership(conn,ctx)
            row=conn.execute('SELECT p.image FROM proofs p JOIN logs l ON l.id=p.log_id WHERE p.log_id=? AND p.home_id=? AND l.undone_at IS NULL',(log_id,ctx['home_id'])).fetchone()
            if not row: raise HTTPException(404,'사진이 없습니다.')
            return Response(bytes(row[0]),media_type='image/webp')

    @r.delete('/logs/{log_id}/photo')
    def delete_photo(log_id:int,ctx=context):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            role=accounts.check_membership(conn,ctx)
            row=conn.execute('SELECT user_id FROM proofs WHERE log_id=? AND home_id=?',(log_id,ctx['home_id'])).fetchone()
            if not row: raise HTTPException(404,'사진이 없습니다.')
            if role!='admin' and row[0]!=ctx['id']: raise HTTPException(403,'작성자 또는 관리자만 삭제할 수 있습니다.')
            conn.execute('DELETE FROM proofs WHERE log_id=?',(log_id,))
        return {'ok':True}
    return r
