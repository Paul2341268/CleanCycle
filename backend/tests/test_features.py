from datetime import timedelta

from app import main
from test_app import client


def create(client):
    task={'title':'욕실 청소','room':'욕실','kind':'bathroom','interval_days':7,
          'due_date':(main.today()-timedelta(days=2)).isoformat()}
    task_id=client.post('/api/tasks',json=task).json()['id']
    return task_id,task


def test_undo_restores_date_stats_and_allows_recompletion(client):
    task_id,task=create(client)
    client.post(f'/api/tasks/{task_id}/complete',json={'due_date':task['due_date']})
    dashboard=client.get('/api/dashboard').json()
    log=dashboard['logs'][0]
    assert log['can_undo'] and dashboard['daily_summary']['percent']==100
    assert client.post(f'/api/logs/{log["id"]}/undo').json()['due_date']==task['due_date']
    result=client.get('/api/dashboard').json()
    assert result['logs']==[] and result['daily_summary']['percent']==0
    assert result['tasks'][0]['due_date']==task['due_date']
    assert client.post(f'/api/logs/{log["id"]}/undo').status_code==409
    assert client.post(f'/api/tasks/{task_id}/complete',json={'due_date':task['due_date']}).status_code==200


def test_undo_does_not_overwrite_later_edits(client):
    task_id,task=create(client)
    client.post(f'/api/tasks/{task_id}/complete',json={'due_date':task['due_date']})
    log=client.get('/api/dashboard').json()['logs'][0]
    client.put(f'/api/tasks/{task_id}',json={**task,'title':'수정한 작업'})
    assert not client.get('/api/dashboard').json()['logs'][0]['can_undo']
    assert client.post(f'/api/logs/{log["id"]}/undo').status_code==409
    assert client.get('/api/dashboard').json()['tasks'][0]['title']=='수정한 작업'


def test_old_logs_not_reconstructed_and_deleted_task_not_restored(client):
    task_id,task=create(client)
    with main.database() as conn:
        home_id=conn.execute('SELECT home_id FROM tasks WHERE id=?',(task_id,)).fetchone()[0]
        cursor=conn.execute('INSERT INTO logs(task_id,title,room,completed_at,home_id) VALUES (?,?,?,?,?)',
                           (task_id,task['title'],task['room'],main.today().isoformat()+'T10:00:00+09:00',home_id))
        log_id=cursor.lastrowid
    assert not client.get('/api/dashboard').json()['logs'][0]['can_undo']
    assert client.post(f'/api/logs/{log_id}/undo').status_code==409
    client.delete(f'/api/tasks/{task_id}')
    assert client.post(f'/api/logs/{log_id}/undo').status_code==409


def test_postponement_snapshot_survives_delete_and_week_filter(client):
    task_id,task=create(client)
    client.post(f'/api/tasks/{task_id}/postpone',json={'due_date':task['due_date']})
    client.delete(f'/api/tasks/{task_id}')
    items=client.get('/api/dashboard').json()['postponements']
    assert len(items)==1 and items[0]['display_title']==task['title']
    with main.database() as conn:
        conn.execute('UPDATE postponements SET postponed_at=?',((main.today()-timedelta(days=7)).isoformat(),))
    assert client.get('/api/dashboard').json()['postponements']==[]


def test_evidence_matches_score_and_excludes_unavailable_sources():
    task={'due_date':(main.today()-timedelta(days=2)).isoformat(),'kind':'outdoor'}
    weather={'status':'ok','rain_probability':70,'precipitation':1}
    air={'status':'ok','pm10_grade':3,'pm25_grade':1,'station':'검증','pm10':90,'pm25':10}
    result=main.recommendation(task,weather,air)
    assert sum(e['points'] for e in result['evidence'])==result['score']==-2
    assert len(result['evidence'])==3
    assert len(main.recommendation(task,{'status':'error'},{'status':'stale'})['evidence'])==1
