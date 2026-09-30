import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app import main,weather,air_quality
from test_app import client

HEADERS={'X-CleanCycle-Request':'1'}
PASSWORD='test-password-123'


def new_user(name,home=None):
    value=TestClient(main.app,headers=HEADERS)
    assert value.post('/api/auth/register',json={'username':name,'name':name,'password':PASSWORD}).status_code==201
    if home:
        assert value.post('/api/homes',json={'name':home}).status_code==201
    return value


def join(owner,member):
    code=owner.post('/api/home/invite').json()['code']
    assert member.post('/api/homes/preview',json={'code':code}).json()['name']=='테스트 집'
    assert member.post('/api/homes/join',json={'code':code}).status_code==200
    return code


def create_task(owner,assigned=None):
    task={'title':'공동 청소','room':'거실','interval_days':7,'due_date':main.today().isoformat(),'assigned_to':assigned}
    response=owner.post('/api/tasks',json=task)
    assert response.status_code==201
    return response.json()['id']


def test_auth_session_logout_origin_and_password(client):
    anonymous=TestClient(main.app)
    assert anonymous.get('/api/dashboard').status_code==401
    assert anonymous.post('/api/auth/login',json={'username':'owner','password':PASSWORD}).status_code==403
    assert client.post('/api/auth/logout',headers={'Origin':'https://attacker.invalid'}).status_code==403
    cookie=client.cookies.get('cleancycle_session')
    assert cookie
    with main.database() as conn:
        password=conn.execute('SELECT password_hash FROM users').fetchone()[0]
        token=conn.execute('SELECT token_hash FROM sessions').fetchone()[0]
        assert PASSWORD not in password and cookie!=token
    assert client.post('/api/auth/logout').status_code==200
    assert client.get('/api/auth/me').status_code==401
    assert client.post('/api/auth/login',json={'username':'owner','password':'wrong-password'}).status_code==401
    login=client.post('/api/auth/login',json={'username':'owner','password':PASSWORD})
    assert login.status_code==200 and 'HttpOnly' in login.headers['set-cookie'] and 'SameSite=strict' in login.headers['set-cookie']
    with main.database() as conn:
        conn.execute('UPDATE sessions SET expires_at=?',(time.time()-1,))
    assert client.get('/api/auth/me').status_code==401


def test_home_isolation_all_write_paths_and_assignee(client):
    other=new_user('stranger','다른 집')
    other_id=other.get('/api/auth/me').json()['user']['id']
    task_id=create_task(client)
    assert other.get('/api/dashboard').json()['tasks']==[]
    payload={'title':'침입','room':'거실','interval_days':7,'due_date':main.today().isoformat(),'revision':0}
    assert other.put(f'/api/tasks/{task_id}',json=payload).status_code==404
    assert other.delete(f'/api/tasks/{task_id}?revision=0').status_code==404
    assert other.post(f'/api/tasks/{task_id}/complete',json={'due_date':payload['due_date'],'revision':0}).status_code==404
    assert client.put(f'/api/tasks/{task_id}',json={**payload,'assigned_to':other_id}).status_code==422
    client.post(f'/api/tasks/{task_id}/complete',json={'due_date':payload['due_date'],'revision':0})
    log=client.get('/api/dashboard').json()['logs'][0]
    assert other.post(f'/api/logs/{log["id"]}/undo').status_code==404


def test_invite_rotation_expiry_revoke_and_single_home(client):
    member=new_user('member')
    first=client.post('/api/home/invite').json()['code']
    second=client.post('/api/home/invite').json()['code']
    assert member.post('/api/homes/join',json={'code':first}).status_code==404
    assert member.post('/api/homes/join',json={'code':second}).status_code==200
    assert member.post('/api/home/invite').status_code==403
    assert member.post('/api/homes',json={'name':'중복'}).status_code==409
    assert member.post('/api/homes/join',json={'code':second}).status_code==409
    outsider=new_user('outsider')
    third=client.post('/api/home/invite').json()['code']
    with main.database() as conn:
        conn.execute('UPDATE invites SET expires_at=?',(time.time()-1,))
    assert outsider.post('/api/homes/preview',json={'code':third}).status_code==404
    fourth=client.post('/api/home/invite').json()['code']
    client.delete('/api/home/invite')
    assert outsider.post('/api/homes/join',json={'code':fourth}).status_code==404


def test_shared_completion_undo_permissions_and_concurrent_update(client):
    member=new_user('roommate');join(client,member)
    third=new_user('family');join(client,third)
    member_id=member.get('/api/auth/me').json()['user']['id']
    owner_id=client.get('/api/auth/me').json()['user']['id']
    task_id=create_task(client,owner_id)
    payload={'due_date':main.today().isoformat(),'revision':0}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(v.post,f'/api/tasks/{task_id}/complete',json=payload) for v in (client,member)]
        statuses=[f.result().status_code for f in futures]
    assert sorted(statuses)==[200,409]
    shared=member.get('/api/dashboard').json()
    assert len(shared['logs'])==1
    log=shared['logs'][0]
    assert log['completed_by'] in (owner_id,member_id) and log['assignee_at_completion']==owner_id
    assert third.post(f'/api/logs/{log["id"]}/undo').status_code==403
    assert client.post(f'/api/logs/{log["id"]}/undo').status_code==200
    assert member.get('/api/dashboard').json()['logs']==[]
    current=member.get('/api/dashboard').json()['tasks'][0]
    assert member.put(f'/api/tasks/{task_id}',json={**current,'assigned_to':member_id}).status_code==200
    assert client.put(f'/api/tasks/{task_id}',json=current).status_code==409


def test_leave_transfer_removal_and_history(client):
    member=new_user('roommate');join(client,member)
    member_id=member.get('/api/auth/me').json()['user']['id']
    owner_id=client.get('/api/auth/me').json()['user']['id']
    task_id=create_task(client,member_id)
    member.post(f'/api/tasks/{task_id}/complete',json={'due_date':main.today().isoformat(),'revision':0})
    assert client.post('/api/home/leave').status_code==409
    assert client.post('/api/home/transfer',json={'user_id':member_id}).status_code==200
    assert client.post('/api/home/invite').status_code==403
    assert member.delete(f'/api/home/members/{owner_id}').status_code==200
    assert client.get('/api/dashboard').status_code==403
    assert member.post('/api/home/leave').status_code==200
    assert member.get('/api/auth/me').json()['home'] is None
    with main.database() as conn:
        assert conn.execute('SELECT assigned_to FROM tasks WHERE id=?',(task_id,)).fetchone()[0] is None
        assert conn.execute('SELECT COUNT(*) FROM logs').fetchone()[0]==1
        assert conn.execute('SELECT archived FROM homes').fetchone()[0]==1


def test_legacy_data_requires_local_claim_code(tmp_path,monkeypatch):
    db=tmp_path/'legacy.sqlite3';monkeypatch.setattr(main,'DB',db)
    monkeypatch.setattr(weather,'ENV',tmp_path/'none');monkeypatch.setattr(air_quality,'ENV',tmp_path/'none')
    monkeypatch.delenv('KMA_SERVICE_KEY',raising=False);monkeypatch.delenv('AIRKOREA_SERVICE_KEY',raising=False)
    conn=sqlite3.connect(db)
    conn.execute('CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT,room TEXT,interval_days INTEGER,due_date TEXT,kind TEXT)')
    conn.execute('INSERT INTO tasks VALUES (1,?,?,?,?,?)',('기존 청소','거실',7,main.today().isoformat(),'general'));conn.commit();conn.close()
    with TestClient(main.app,headers=HEADERS) as owner:
        owner.post('/api/auth/register',json={'username':'legacyowner','name':'소유자','password':PASSWORD})
        wrong=owner.post('/api/homes',json={'name':'복원','legacy_code':'wrong-code'})
        assert wrong.status_code==403
        code=(tmp_path/'legacy-claim-code.txt').read_text()
        assert owner.post('/api/homes',json={'name':'복원','legacy_code':code}).status_code==201
        assert owner.get('/api/dashboard').json()['tasks'][0]['title']=='기존 청소'
        outsider=new_user('unrelated','새집')
        assert outsider.get('/api/dashboard').json()['tasks']==[]
