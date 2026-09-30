import base64
import io
from datetime import date

from PIL import Image

from app import main, waste
from test_app import client  # Reuse the isolated, authenticated household fixture.


def test_waste_region_scope_and_persistence(client):
    assert not client.get('/api/waste').json()['supported']
    assert client.put('/api/waste', json={'region':'invalid'}).status_code == 422
    assert client.put('/api/waste', json={'region':'incheon-yeonsu'}).status_code == 200
    with main.database() as conn:
        result = waste.schedule(conn, 1, date(2026, 10, 1))
    assert result['supported']
    assert {i['kind'] for i in result['days'][0]['items']} == {'trash','food_waste','recycling'}
    # Friday: food and recycling are not collected under the Yeonsu-dong schedule.
    assert [i['kind'] for i in result['days'][1]['items']] == ['trash']
    assert client.get('/api/waste').json()['setting']['region'] == 'incheon-yeonsu'
    client.put('/api/waste', json={'region':'incheon-yeonsu','housing':'apartment'})
    result = client.get('/api/waste').json()
    assert not result['supported'] and result['days'] == []


def test_waste_points_are_limited_to_supported_kind(client):
    client.put('/api/waste', json={'region':'seoul-gangnam'})
    with main.database() as conn:
        schedule = waste.schedule(conn, 1, date(2026, 10, 1))
    task = {'kind':'recycling','score':0,'reasons':[],'evidence':[],'due_date':'2026-10-01'}
    result = waste.add_evidence(task, schedule)
    assert result['score'] == 3
    assert '투명페트병' in result['reasons'][0]
    assert result['due_date'] == task['due_date']
    assert waste.add_evidence({**task,'kind':'laundry'}, schedule)['score'] == 0
    assert task['evidence'] == []


def test_templates_are_idempotent_and_notes_are_scoped(client):
    result = client.post('/api/planner/templates', json={'household_type':'solo'})
    assert result.status_code == 200 and result.json()['created'] == 6
    assert client.post('/api/planner/templates', json={'household_type':'solo'}).status_code == 409
    assert client.post('/api/notes', json={'text':'   '}).status_code == 422
    assert client.post('/api/notes', json={'text':'오늘은 욕실 먼저'}).status_code == 201
    note = client.get('/api/planner').json()['notes'][0]
    assert note['text'] == '오늘은 욕실 먼저'
    assert client.delete('/api/notes/'+str(note['id'])).status_code == 200


def test_photo_roundtrip_and_report(client):
    task = {'title':'청소','room':'거실','interval_days':7,'due_date':main.today().isoformat()}
    task_id = client.post('/api/tasks', json=task).json()['id']
    assert client.post(f'/api/tasks/{task_id}/complete', json={'due_date':task['due_date']}).status_code == 200
    log_id = client.get('/api/dashboard').json()['logs'][0]['id']
    url = f'/api/logs/{log_id}/photo'
    assert client.put(url, json={'image':'invalid'}).status_code == 422
    output = io.BytesIO()
    Image.new('RGB', (16,16), 'white').save(output, format='PNG')
    assert client.put(url, json={'image':base64.b64encode(output.getvalue()).decode()}).status_code == 200
    photo = client.get(url)
    assert photo.status_code == 200 and photo.headers['content-type'] == 'image/webp'
    assert photo.headers['cache-control'] == 'no-store'
    report = client.get('/api/planner').json()
    assert report['proofs'] == [log_id]
    assert report['report']['weekly'] == {'completed':1,'total':1,'percent':100}
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404
