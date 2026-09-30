import asyncio
import os
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .weather import KST, REGIONS, get_weather
from .air_quality import get_air_quality
from .accounts import Accounts
from . import planner, waste

DB = Path(os.environ.get("CLEANCYCLE_DB", Path(__file__).resolve().parents[1] / "cleancycle.sqlite3"))


def today():
    return datetime.now(KST).date()


@contextmanager
def database():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app):
    with database() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY, title TEXT NOT NULL, room TEXT NOT NULL,
          interval_days INTEGER NOT NULL, due_date TEXT NOT NULL, kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY, task_id INTEGER, title TEXT, room TEXT, completed_at TEXT);
        CREATE TABLE IF NOT EXISTS daily_tasks (
          day TEXT NOT NULL, task_id INTEGER NOT NULL, PRIMARY KEY(day, task_id));
        CREATE TABLE IF NOT EXISTS postponements (
          id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, previous_date TEXT NOT NULL,
          next_date TEXT NOT NULL, postponed_at TEXT NOT NULL);
        """)
        for table, columns in {
            "tasks": {"revision": "INTEGER NOT NULL DEFAULT 0"},
            "logs": {"previous_date": "TEXT", "completion_revision": "INTEGER", "undone_at": "TEXT"},
            "postponements": {"title": "TEXT", "room": "TEXT"},
        }.items():
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns.items():
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        accounts.initialize(conn, DB)
        planner.initialize(conn)
        waste.initialize(conn)
    yield


app = FastAPI(title="CleanCycle", lifespan=lifespan)
accounts = Accounts(database)
app.include_router(accounts.router)
app.include_router(planner.router(database, accounts, today))
app.include_router(waste.router(database, accounts, today))


@app.middleware('http')
async def request_security(request: Request, call_next):
    if request.url.path.startswith('/api/') and request.method not in ('GET','HEAD','OPTIONS'):
        origin = request.headers.get('origin')
        expected = (os.environ.get('PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL') or str(request.base_url)).rstrip('/')
        allowed = {expected}
        if os.environ.get('COOKIE_SECURE')!='1':
            allowed.update({'http://127.0.0.1:5173','http://localhost:5173'})
        if request.headers.get('x-cleancycle-request')!='1' or (origin and origin not in allowed):
            return JSONResponse(status_code=403,content={'detail':'요청 출처를 확인할 수 없습니다.'})
        try:
            limit=410000 if request.url.path.endswith('/photo') else 16384
            if int(request.headers.get('content-length','0'))>limit:
                return JSONResponse(status_code=413,content={'detail':'요청이 너무 큽니다.'})
        except ValueError:
            return JSONResponse(status_code=400,content={'detail':'요청 형식이 잘못되었습니다.'})
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Referrer-Policy']='same-origin'
    return response


@app.get('/api/health')
def health():
    return {'status':'ok'}


def capture_due(conn, home_id):
    conn.execute("INSERT OR IGNORE INTO daily_tasks(day,task_id,home_id,room) SELECT ?,id,home_id,room FROM tasks WHERE home_id=? AND due_date<=?",
                 (today().isoformat(), home_id, today().isoformat()))


def daily_summary(conn, home_id):
    day = today().isoformat()
    planned = {r[0] for r in conn.execute("SELECT task_id FROM daily_tasks WHERE home_id=? AND day=?", (home_id,day))}
    completed = {r[0] for r in conn.execute("SELECT task_id FROM logs WHERE home_id=? AND undone_at IS NULL AND substr(completed_at,1,10)=?", (home_id,day))}
    total = len(planned | completed)
    return {"completed": len(completed), "total": total,
            "percent": round(len(completed) / total * 100) if total else 0}


class TaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    room: Literal["욕실", "주방", "침실", "거실", "기타"]
    interval_days: int = Field(ge=1, le=365)
    due_date: date
    kind: Literal["general", "bathroom", "laundry", "outdoor", "filter", "ventilation", "recycling", "food_waste", "trash"] = "general"
    assigned_to: int | None = None
    revision: int | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Title must not be blank")
        return value


def owned_task(conn, ctx, task_id):
    row=conn.execute('SELECT * FROM tasks WHERE id=? AND home_id=?',(task_id,ctx['home_id'])).fetchone()
    if not row:
        raise HTTPException(404,'집안일을 찾지 못했습니다.')
    return row


def validate_assignee(conn, ctx, user_id):
    if user_id is not None and not conn.execute('SELECT 1 FROM members WHERE user_id=? AND home_id=?',(user_id,ctx['home_id'])).fetchone():
        raise HTTPException(422,'우리 집의 구성원만 담당자로 지정할 수 있습니다.')


def recommendation(task, weather, air=None):
    delay = (today() - date.fromisoformat(task["due_date"])).days
    score = max(-30, delay * 2)
    reasons = [f"{delay}일 지연" if delay > 0 else "오늘 예정" if delay == 0 else f"{abs(delay)}일 후 예정"]
    evidence = [{"label": reasons[0], "points": score, "source": "등록된 예정일", "value": task['due_date']}]
    if weather.get("status") == "ok":
        if task["kind"] == "bathroom" and weather["humidity"] >= 75:
            score += 3
            reasons.append("실외 습도가 높아 욕실 물기 점검 추천")
            evidence.append({"label": reasons[-1], "points": 3, "source": "기상청 단기예보",
                             "value": f"실외 습도 {weather['humidity']}%", "time": weather.get('forecast_at')})
        if task["kind"] in ("laundry", "outdoor") and (weather["rain_probability"] >= 60 or weather["precipitation"] > 0):
            score -= 3
            reasons.append("비 예보 · 야외 작업이나 자연건조 일정 확인")
            evidence.append({"label": reasons[-1], "points": -3, "source": "기상청 단기예보",
                             "value": f"강수확률 {weather['rain_probability']}% · 강수형태 코드 {weather['precipitation']}",
                             "time": weather.get('forecast_at')})
    if air and air.get("status") == "ok" and task["kind"] == "outdoor":
        if any((air.get(field + "_grade") or 0) >= 3 for field in ("pm10", "pm25")):
            score -= 3
            reasons.append("측정소 미세먼지 나쁨 이상 · 야외 청소 일정 확인")
            evidence.append({"label": reasons[-1], "points": -3, "source": "한국환경공단 에어코리아",
                             "value": f"{air.get('station', '지역')} 측정소 · PM10 {air.get('pm10')} / PM2.5 {air.get('pm25')} µg/m³",
                             "time": air.get('measured_at')})
    if air and air.get('status')=='ok' and any((air.get(f+'_grade') or 0)>=3 for f in ('pm10','pm25')):
        if task['kind'] in ('filter','ventilation'):
            points=3 if task['kind']=='filter' else -3
            reason='미세먼지 나쁨 이상 · 필터 상태 확인' if points>0 else '미세먼지 나쁨 이상 · 환기 시점 확인'
            score+=points
            reasons.append(reason)
            evidence.append({'label':reason,'points':points,'source':'한국환경공단 에어코리아','value':air.get('station'),'time':air.get('measured_at')})
    return {**task, "score": score, "reasons": reasons, "evidence": evidence, "overdue_days": max(0, delay)}


@app.get("/api/regions")
def regions():
    return [{"id": key, **value} for key, value in REGIONS.items()]


@app.get("/api/dashboard")
async def dashboard(region: str | None = None, ctx=Depends(accounts.context)):
    region = region or ctx['region']
    if region not in REGIONS:
        raise HTTPException(422, "지원하지 않는 지역입니다.")
    weather, air = await asyncio.gather(get_weather(region), get_air_quality(region))
    with database() as conn:
        accounts.check_membership(conn,ctx)
        capture_due(conn,ctx['home_id'])
        summary = daily_summary(conn,ctx['home_id'])
        waste_data = waste.schedule(conn, ctx['home_id'], today())
        tasks = [waste.add_evidence(recommendation(dict(row), weather, air), waste_data) for row in conn.execute("SELECT * FROM tasks WHERE home_id=?",(ctx['home_id'],))]
        logs = [dict(row) for row in conn.execute("""SELECT l.*,u.name AS completed_by_name,a.name AS assignee_name FROM logs l
                 LEFT JOIN users u ON u.id=l.completed_by LEFT JOIN users a ON a.id=l.assignee_at_completion
                 WHERE l.home_id=? AND l.undone_at IS NULL ORDER BY l.completed_at DESC,l.id DESC LIMIT 500""",(ctx['home_id'],))]
        task_map = {t['id']: t for t in tasks}
        for log in logs:
            task = task_map.get(log['task_id'])
            permitted = ctx['role']=='admin' or ctx['id']==log['completed_by']
            log['can_undo'] = bool(permitted and task and log['previous_date'] and task['revision'] == log['completion_revision'])
            log['undo_unavailable_reason'] = ("완료한 사람 또는 관리자만 취소할 수 있습니다." if not permitted else "작업이 삭제되었습니다." if not task else
                "이전 예정일이 없는 과거 기록입니다." if not log['previous_date'] else "완료 후 작업이 변경되었습니다.") if not log['can_undo'] else None
        week_start = (today() - timedelta(days=6)).isoformat()
        postponed = [dict(row) for row in conn.execute("""SELECT p.*,COALESCE(p.title,t.title,'삭제된 집안일') AS display_title,
            COALESCE(p.room,t.room,'기타') AS display_room FROM postponements p LEFT JOIN tasks t ON t.id=p.task_id
            WHERE p.home_id=? AND substr(p.postponed_at,1,10) BETWEEN ? AND ? ORDER BY p.postponed_at DESC,p.id DESC""", (ctx['home_id'],week_start,today().isoformat()))]
    return {"tasks": sorted(tasks, key=lambda t: (-t["score"], t["id"])), "logs": logs,
            "weather": weather, "air_quality": air, "today": today().isoformat(), "daily_summary": summary,
            "postponements": postponed, "waste": waste_data}


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskInput, ctx=Depends(accounts.context)):
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        accounts.check_membership(conn,ctx)
        validate_assignee(conn,ctx,task.assigned_to)
        cursor = conn.execute("""INSERT INTO tasks (id,title,room,interval_days,due_date,kind,home_id,assigned_to)
                              SELECT COALESCE(MAX(existing_id),0)+1,?,?,?,?,?,?,? FROM
                              (SELECT id AS existing_id FROM tasks UNION ALL SELECT task_id AS existing_id FROM logs
                               UNION ALL SELECT task_id AS existing_id FROM daily_tasks
                               UNION ALL SELECT task_id AS existing_id FROM postponements)""",
                              (task.title, task.room, task.interval_days, task.due_date.isoformat(), task.kind,ctx['home_id'],task.assigned_to))
        capture_due(conn,ctx['home_id'])
        return {"id": cursor.lastrowid}


@app.put("/api/tasks/{task_id}")
def edit_task(task_id: int, task: TaskInput, ctx=Depends(accounts.context)):
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        accounts.check_membership(conn,ctx)
        existing = owned_task(conn,ctx,task_id)
        if task.revision is None or task.revision!=existing['revision']:
            raise HTTPException(409,'다른 구성원이 작업을 변경했습니다. 새로고침해 주세요.')
        validate_assignee(conn,ctx,task.assigned_to)
        capture_due(conn,ctx['home_id'])
        cursor = conn.execute("UPDATE tasks SET title=?,room=?,interval_days=?,due_date=?,kind=?,assigned_to=?,revision=revision+1 WHERE id=?",
                              (task.title, task.room, task.interval_days, task.due_date.isoformat(), task.kind, task.assigned_to,task_id))
        if not cursor.rowcount:
            raise HTTPException(404, "집안일을 찾지 못했습니다.")
        capture_due(conn,ctx['home_id'])
    return {"ok": True}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, revision: int, ctx=Depends(accounts.context)):
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        accounts.check_membership(conn,ctx)
        task=owned_task(conn,ctx,task_id)
        if revision!=task['revision']:
            raise HTTPException(409,'다른 구성원이 작업을 변경했습니다. 새로고침해 주세요.')
        capture_due(conn,ctx['home_id'])
        if not conn.execute("DELETE FROM tasks WHERE id=?", (task_id,)).rowcount:
            raise HTTPException(404, "집안일을 찾지 못했습니다.")
    return {"ok": True}


class ExpectedDate(BaseModel):
    due_date: date
    revision: int | None = None


@app.post("/api/tasks/{task_id}/{action}")
def act(task_id: int, action: Literal["complete", "postpone"], expected: ExpectedDate, ctx=Depends(accounts.context)):
    with database() as conn:
        conn.execute("BEGIN IMMEDIATE")
        accounts.check_membership(conn,ctx)
        task = owned_task(conn,ctx,task_id)
        if task["due_date"] != expected.due_date.isoformat() or expected.revision is None or expected.revision!=task['revision']:
            raise HTTPException(409, "이미 변경된 작업입니다. 새로고침해 주세요.")
        capture_due(conn,ctx['home_id'])
        if action == "complete":
            if conn.execute("SELECT 1 FROM logs WHERE undone_at IS NULL AND task_id=? AND substr(completed_at,1,10)=?",
                            (task_id, today().isoformat())).fetchone():
                raise HTTPException(409, "오늘 이미 완료한 작업입니다.")
            due = today() + timedelta(days=task["interval_days"])
            conn.execute("INSERT INTO logs(task_id,title,room,completed_at,previous_date,completion_revision,home_id,completed_by,assignee_at_completion) VALUES (?,?,?,?,?,?,?,?,?)",
                         (task_id, task["title"], task["room"], datetime.now(KST).isoformat(),task['due_date'],task['revision']+1,ctx['home_id'],ctx['id'],task['assigned_to']))
        else:
            due = max(today(), date.fromisoformat(task["due_date"])) + timedelta(days=1)
            conn.execute("INSERT INTO postponements(task_id,previous_date,next_date,postponed_at,title,room,home_id,postponed_by) VALUES (?,?,?,?,?,?,?,?)",
                         (task_id, task["due_date"], due.isoformat(), datetime.now(KST).isoformat(),task['title'],task['room'],ctx['home_id'],ctx['id']))
        conn.execute("UPDATE tasks SET due_date=?,revision=revision+1 WHERE id=?", (due.isoformat(), task_id))
    return {"due_date": due.isoformat()}


@app.post('/api/logs/{log_id}/undo')
def undo_complete(log_id: int, ctx=Depends(accounts.context)):
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        role=accounts.check_membership(conn,ctx)
        log = conn.execute('SELECT * FROM logs WHERE id=? AND home_id=?',(log_id,ctx['home_id'])).fetchone()
        if not log:
            raise HTTPException(404,'완료 기록을 찾지 못했습니다.')
        if log['undone_at']:
            raise HTTPException(409,'이미 취소된 기록입니다.')
        if role!='admin' and log['completed_by']!=ctx['id']:
            raise HTTPException(403,'완료한 사람 또는 관리자만 취소할 수 있습니다.')
        task = conn.execute('SELECT * FROM tasks WHERE id=?',(log['task_id'],)).fetchone()
        if not task or not log['previous_date'] or task['revision'] != log['completion_revision']:
            raise HTTPException(409,'완료 후 작업이 변경되었거나 이전 일정이 없어 취소할 수 없습니다.')
        conn.execute('UPDATE logs SET undone_at=? WHERE id=?',(datetime.now(KST).isoformat(),log_id))
        conn.execute('UPDATE tasks SET due_date=?,revision=revision+1 WHERE id=?',(log['previous_date'],log['task_id']))
        capture_due(conn,ctx['home_id'])
    return {'due_date':log['previous_date']}


DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
