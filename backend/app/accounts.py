import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from .weather import REGIONS


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ':' + value


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r'^[A-Za-z0-9_.@-]+$')
    password: str = Field(min_length=10, max_length=128)

    @field_validator('username')
    @classmethod
    def normalize(cls, value):
        return value.lower()


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=30)

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Name must not be blank')
        return value.strip()


class HomeInput(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    region: str = 'busan'
    legacy_code: str | None = None

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Home name must not be blank')
        return value.strip()

    @field_validator('region')
    @classmethod
    def known_region(cls, value):
        if value not in REGIONS:
            raise ValueError('Unsupported region')
        return value


class JoinInput(BaseModel):
    code: str = Field(min_length=6, max_length=64)


class TargetMember(BaseModel):
    user_id: int


class Accounts:
    def __init__(self, database):
        self.database = database
        self.router = APIRouter(prefix='/api')
        r = self.router
        r.add_api_route('/auth/register', self.register, methods=['POST'], status_code=201)
        r.add_api_route('/auth/login', self.login, methods=['POST'])
        r.add_api_route('/auth/logout', self.logout, methods=['POST'])
        r.add_api_route('/auth/me', self.me, methods=['GET'])
        r.add_api_route('/homes', self.create_home, methods=['POST'], status_code=201)
        r.add_api_route('/home', self.home, methods=['GET'])
        r.add_api_route('/home', self.update_home, methods=['PUT'])
        r.add_api_route('/home/invite', self.invite, methods=['POST'])
        r.add_api_route('/home/invite', self.revoke_invite, methods=['DELETE'])
        r.add_api_route('/homes/preview', self.preview, methods=['POST'])
        r.add_api_route('/homes/join', self.join, methods=['POST'])
        r.add_api_route('/home/transfer', self.transfer, methods=['POST'])
        r.add_api_route('/home/members/{user_id}', self.remove_member, methods=['DELETE'])
        r.add_api_route('/home/leave', self.leave, methods=['POST'])

    def initialize(self, conn, db_path):
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS homes(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          region TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS members(user_id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','member')));
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS invites(code_hash TEXT PRIMARY KEY, home_id INTEGER NOT NULL UNIQUE, expires_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_attempts(bucket TEXT NOT NULL, happened_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS auth_attempts_lookup ON auth_attempts(bucket,happened_at);
        CREATE TABLE IF NOT EXISTS legacy_claim(id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, claimed INTEGER DEFAULT 0);
        ''')
        for table in ('tasks', 'logs', 'daily_tasks', 'postponements'):
            columns = {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
            if 'home_id' not in columns:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN home_id INTEGER')
            conn.execute(f'CREATE INDEX IF NOT EXISTS {table}_home ON {table}(home_id)')
        additions = {'tasks': {'assigned_to': 'INTEGER'}, 'logs': {'completed_by': 'INTEGER', 'assignee_at_completion': 'INTEGER'},
                     'postponements': {'postponed_by': 'INTEGER'}}
        for table, fields in additions.items():
            columns = {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
            for name, kind in fields.items():
                if name not in columns:
                    conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
        legacy = any(conn.execute(f'SELECT 1 FROM {t} WHERE home_id IS NULL LIMIT 1').fetchone()
                     for t in ('tasks', 'logs', 'daily_tasks', 'postponements'))
        if legacy and not conn.execute('SELECT 1 FROM legacy_claim').fetchone():
            code = secrets.token_urlsafe(24)
            conn.execute('INSERT INTO legacy_claim(id,code_hash) VALUES (1,?)', (digest(code),))
            code_file = Path(db_path).resolve().parent / 'legacy-claim-code.txt'
            with code_file.open('x', encoding='utf-8') as handle:
                handle.write(code)

    def throttle(self, request, action, limit=10, seconds=600):
        bucket = action + ':' + (request.client.host if request.client else 'unknown')
        now = time.time()
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute('DELETE FROM auth_attempts WHERE happened_at<?', (now-3600,))
            count = conn.execute('SELECT COUNT(*) FROM auth_attempts WHERE bucket=? AND happened_at>?', (bucket,now-seconds)).fetchone()[0]
            if count >= limit:
                raise HTTPException(429,'시도가 많습니다. 잠시 후 다시 시도해 주세요.')
            conn.execute('INSERT INTO auth_attempts VALUES (?,?)',(bucket,now))

    def user(self, request: Request):
        token = request.cookies.get('cleancycle_session', '')
        with self.database() as conn:
            row = conn.execute('''SELECT u.id,u.username,u.name FROM users u JOIN sessions s ON s.user_id=u.id
                                  WHERE s.token_hash=? AND s.expires_at>?''',(digest(token),time.time())).fetchone()
        if not row:
            raise HTTPException(401,'로그인이 필요합니다.')
        return dict(row)

    def context(self, request: Request):
        user = self.user(request)
        with self.database() as conn:
            row = conn.execute('''SELECT m.home_id,m.role,h.name AS home_name,h.region FROM members m
                                 JOIN homes h ON h.id=m.home_id WHERE m.user_id=? AND h.archived=0''',(user['id'],)).fetchone()
        if not row:
            raise HTTPException(403,'우리 집을 만들거나 초대 코드로 참여해 주세요.')
        return {**user, **dict(row)}

    def admin(self, request):
        ctx = self.context(request)
        if ctx['role'] != 'admin':
            raise HTTPException(403,'관리자만 사용할 수 있습니다.')
        return ctx

    def check_membership(self, conn, ctx):
        row = conn.execute('SELECT role FROM members WHERE user_id=? AND home_id=?',(ctx['id'],ctx['home_id'])).fetchone()
        if not row:
            raise HTTPException(403,'이 집에 대한 권한이 없습니다.')
        return row['role']

    def set_session(self, conn, response, user_id):
        token = secrets.token_urlsafe(32)
        conn.execute('DELETE FROM sessions WHERE expires_at<?',(time.time(),))
        conn.execute('INSERT INTO sessions VALUES (?,?,?)',(digest(token),user_id,time.time()+604800))
        response.set_cookie('cleancycle_session',token,max_age=604800,httponly=True,
                            secure=os.environ.get('COOKIE_SECURE')=='1',samesite='strict',path='/')

    def register(self, data: Registration, request: Request, response: Response):
        self.throttle(request,'register',20,3600)
        hashed = password_hash(data.password)
        try:
            with self.database() as conn:
                cursor = conn.execute('INSERT INTO users(username,name,password_hash) VALUES (?,?,?)',
                                     (data.username,data.name,hashed))
                self.set_session(conn,response,cursor.lastrowid)
        except sqlite3.IntegrityError:
            raise HTTPException(409,'이미 사용 중인 아이디입니다.')
        return {'ok':True}

    def login(self, data: Credentials, request: Request, response: Response):
        self.throttle(request,'login')
        with self.database() as conn:
            user = conn.execute('SELECT * FROM users WHERE username=?',(data.username,)).fetchone()
            stored = user['password_hash'] if user else password_hash('dummy-password')
            salt = stored.split(':')[0]
            valid = hmac.compare_digest(password_hash(data.password,salt),stored)
            if not user or not valid:
                raise HTTPException(401,'아이디 또는 비밀번호를 확인해 주세요.')
            self.set_session(conn,response,user['id'])
        return {'ok':True}

    def logout(self, request: Request, response: Response):
        with self.database() as conn:
            conn.execute('DELETE FROM sessions WHERE token_hash=?',(digest(request.cookies.get('cleancycle_session','')),))
        response.delete_cookie('cleancycle_session',path='/')
        return {'ok':True}

    def me(self, request: Request):
        user = self.user(request)
        with self.database() as conn:
            home = conn.execute('''SELECT h.id,h.name,h.region,m.role FROM members m JOIN homes h ON h.id=m.home_id
                                   WHERE m.user_id=? AND h.archived=0''',(user['id'],)).fetchone()
        return {'user':user,'home':dict(home) if home else None}

    def create_home(self, data: HomeInput, request: Request):
        user = self.user(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM members WHERE user_id=?',(user['id'],)).fetchone():
                raise HTTPException(409,'이미 참여 중인 집이 있습니다.')
            claim = None
            if data.legacy_code:
                claim = conn.execute('SELECT * FROM legacy_claim WHERE id=1').fetchone()
                if not claim or claim['claimed'] or not hmac.compare_digest(claim['code_hash'],digest(data.legacy_code.strip())):
                    raise HTTPException(403,'기존 데이터 이전 코드를 확인해 주세요.')
            home_id = conn.execute('INSERT INTO homes(name,region) VALUES (?,?)',(data.name,data.region)).lastrowid
            conn.execute('INSERT INTO members VALUES (?,?,?)',(user['id'],home_id,'admin'))
            if claim:
                for table in ('tasks','logs','daily_tasks','postponements'):
                    conn.execute(f'UPDATE {table} SET home_id=? WHERE home_id IS NULL',(home_id,))
                conn.execute('UPDATE legacy_claim SET claimed=1 WHERE id=1')
        return {'id':home_id}

    def home(self, request: Request):
        ctx = self.context(request)
        with self.database() as conn:
            self.check_membership(conn,ctx)
            members = [dict(r) for r in conn.execute('''SELECT u.id,u.name,m.role FROM members m
                         JOIN users u ON u.id=m.user_id WHERE home_id=? ORDER BY m.role,u.id''',(ctx['home_id'],))]
        return {'id':ctx['home_id'],'name':ctx['home_name'],'region':ctx['region'],'role':ctx['role'],'members':members}

    def update_home(self, data: HomeInput, request: Request):
        ctx = self.admin(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if self.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 변경할 수 있습니다.')
            conn.execute('UPDATE homes SET name=?,region=? WHERE id=?',(data.name,data.region,ctx['home_id']))
        return {'ok':True}

    def invite(self, request: Request):
        ctx = self.admin(request)
        code = secrets.token_urlsafe(12)
        expires = time.time()+86400
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if self.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 초대할 수 있습니다.')
            conn.execute('DELETE FROM invites WHERE home_id=?',(ctx['home_id'],))
            conn.execute('INSERT INTO invites VALUES (?,?,?)',(digest(code),ctx['home_id'],expires))
        return {'code':code,'expires_at':expires}

    def revoke_invite(self, request: Request):
        ctx = self.admin(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if self.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 변경할 수 있습니다.')
            conn.execute('DELETE FROM invites WHERE home_id=?',(ctx['home_id'],))
        return {'ok':True}

    def invite_home(self, conn, code):
        row = conn.execute('''SELECT h.* FROM invites i JOIN homes h ON h.id=i.home_id
                              WHERE i.code_hash=? AND i.expires_at>? AND h.archived=0''',(digest(code.strip()),time.time())).fetchone()
        if not row:
            raise HTTPException(404,'초대 코드가 유효하지 않거나 만료되었습니다.')
        return row

    def preview(self, data: JoinInput, request: Request):
        self.user(request)
        self.throttle(request,'invite',30)
        with self.database() as conn:
            home = self.invite_home(conn,data.code)
        return {'name':home['name']}

    def join(self, data: JoinInput, request: Request):
        user = self.user(request)
        self.throttle(request,'join',30)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM members WHERE user_id=?',(user['id'],)).fetchone():
                raise HTTPException(409,'이미 참여 중인 집이 있습니다.')
            home = self.invite_home(conn,data.code)
            conn.execute('INSERT INTO members VALUES (?,?,?)',(user['id'],home['id'],'member'))
        return {'ok':True}

    def transfer(self, data: TargetMember, request: Request):
        ctx = self.admin(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if self.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 변경할 수 있습니다.')
            if data.user_id==ctx['id'] or not conn.execute('SELECT 1 FROM members WHERE user_id=? AND home_id=?',(data.user_id,ctx['home_id'])).fetchone():
                raise HTTPException(422,'다른 구성원을 선택해 주세요.')
            conn.execute("UPDATE members SET role='member' WHERE user_id=?",(ctx['id'],))
            conn.execute("UPDATE members SET role='admin' WHERE user_id=?",(data.user_id,))
            conn.execute('DELETE FROM invites WHERE home_id=?',(ctx['home_id'],))
        return {'ok':True}

    def detach(self, conn, ctx, user_id):
        conn.execute('UPDATE tasks SET assigned_to=NULL,revision=revision+1 WHERE home_id=? AND assigned_to=?',(ctx['home_id'],user_id))
        conn.execute('DELETE FROM members WHERE user_id=? AND home_id=?',(user_id,ctx['home_id']))

    def remove_member(self, user_id: int, request: Request):
        ctx = self.admin(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if self.check_membership(conn,ctx)!='admin':
                raise HTTPException(403,'관리자만 내보낼 수 있습니다.')
            if user_id==ctx['id']:
                raise HTTPException(422,'본인은 집 나가기를 사용해 주세요.')
            if not conn.execute('SELECT 1 FROM members WHERE user_id=? AND home_id=?',(user_id,ctx['home_id'])).fetchone():
                raise HTTPException(404,'구성원을 찾지 못했습니다.')
            self.detach(conn,ctx,user_id)
            conn.execute('DELETE FROM invites WHERE home_id=?',(ctx['home_id'],))
        return {'ok':True}

    def leave(self, request: Request):
        ctx = self.context(request)
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            role = self.check_membership(conn,ctx)
            count = conn.execute('SELECT COUNT(*) FROM members WHERE home_id=?',(ctx['home_id'],)).fetchone()[0]
            if role=='admin' and count>1:
                raise HTTPException(409,'관리자 권한을 다른 구성원에게 이전한 뒤 나갈 수 있습니다.')
            self.detach(conn,ctx,ctx['id'])
            conn.execute('DELETE FROM invites WHERE home_id=?',(ctx['home_id'],))
            if count==1:
                conn.execute('UPDATE homes SET archived=1 WHERE id=?',(ctx['home_id'],))
        return {'ok':True}
