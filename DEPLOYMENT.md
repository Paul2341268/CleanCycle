# CleanCycle 배포 준비

학교 발표용 무료 배포를 기준으로 합니다. `127.0.0.1`은 실행 중인 PC 전용 주소이고 GitHub는 소스 저장소입니다. 다른 컴퓨터에서는 Render 배포 후 발급되는 HTTPS 주소로 접속합니다.

## 학교 발표용 무료 Render

1. Render에 GitHub 계정으로 로그인하고 New → Web Service를 선택합니다.
2. Public Git Repository에 `https://github.com/Paul2341268/CleanCycle`을 연결합니다.
3. Docker, main 브랜치, Free 인스턴스를 선택합니다. Root Directory는 비워 둡니다.
4. `COOKIE_SECURE=1`을 설정합니다. 기상청·에어코리아 키는 서버 환경변수 또는 `/etc/secrets/.env` 비밀 파일에 입력합니다. 비밀 파일 사용 시 `CLEANCYCLE_ENV_FILE=/etc/secrets/.env`를 설정합니다.
5. Deploy Web Service 후 `https://서비스이름.onrender.com` 주소를 사용합니다. 앱은 Render가 제공하는 `RENDER_EXTERNAL_URL`을 로그인 요청 출처로 자동 인식합니다.

무료 서비스는 15분 동안 요청이 없으면 잠들고 다시 접속할 때 약 1분 기다릴 수 있습니다. **발표 전에 접속해 로그인과 시연 데이터를 준비합니다. SQLite 기록은 서버 재시작·휴면·재배포 시 초기화됩니다.** 발표 중 같은 실행 세션에서는 구성원이 공유할 수 있습니다. 기존 PC의 계정·데이터는 자동 이전하지 않습니다. 수업 시연에는 무료 설정으로 시작하고 데이터 영구 보관이 필요할 때만 별도 저장소를 검토합니다.

## 현재 PC를 이용한 임시 시연 링크

Windows에서 `Start-Presentation.ps1`을 실행하면 무료 Cloudflare 임시 HTTPS 링크를 발급합니다. 기존 앱 데이터와 API 설정을 사용합니다. 링크를 사용하는 동안 이 PC가 켜져 있고 인터넷에 연결되어 있어야 합니다. `Stop-Presentation.ps1`로 종료하며 다시 시작하면 주소가 바뀝니다. 이는 고정 서버 배포를 대신하지 않는 보조 시연 방법입니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Presentation.ps1
```

공식 안내: [Render 무료 서비스](https://render.com/docs/free), [Cloudflare 임시 터널](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## 구성과 제약

- React 정적 파일과 FastAPI를 한 서버에서 제공합니다. 프론트엔드 별도 배포나 CORS 설정이 필요하지 않습니다.
- SQLite를 유지하므로 서버 1개, Uvicorn worker 1개, 영구 볼륨이 필요합니다. 파일이 휘발되는 무료 환경에 DB를 두면 재배포 시 데이터가 사라집니다.
- 공개 주소는 HTTPS여야 합니다. `COOKIE_SECURE=1`, `PUBLIC_ORIGIN`은 실제 HTTPS 주소와 정확히 같게 지정합니다. 마지막 `/`는 넣지 않습니다.
- API 키는 서버 환경변수로만 설정합니다. `.env.production`과 DB, 이전 코드를 저장소에 올리지 않습니다.
- 비밀번호 재설정, 이메일 인증, 푸시 알림은 구현하지 않았습니다. 우선 수업용 소규모 사용자로 운영합니다.
- Docker 실행 환경은 이 PC에 없어 이미지 빌드는 아직 검증하지 못했습니다. 배포 전에 아래 이미지 빌드와 인수 테스트가 필요합니다.

## Docker 사용 시

`cleancycle` 폴더에서 실행합니다. `.env.production.example`을 바탕으로 실제 설정을 `.env.production`에 입력합니다.

```powershell
docker build -t cleancycle .
docker volume create cleancycle-data
docker run -d --name cleancycle --restart unless-stopped -p 8765:8765 --env-file .env.production -v cleancycle-data:/var/data cleancycle
```

호스팅 서비스에서 HTTPS 프록시를 연결합니다. 로컬 Docker 테스트만 할 때는 `COOKIE_SECURE=0`, `PUBLIC_ORIGIN=http://127.0.0.1:8765`를 별도의 테스트 설정에 지정합니다. 공개 서버에는 이 값을 사용하지 않습니다.

Linux 호스트 디렉터리를 직접 마운트한다면 UID 10001 사용자가 쓸 수 있는 권한을 부여해야 합니다. 일반 Docker named volume은 이미지의 `/var/data` 소유권을 사용합니다.

## Render 선택 시

공식 안내: [영구 디스크](https://render.com/docs/disks), [Docker 배포](https://render.com/docs/docker), [Blueprint 형식](https://render.com/docs/blueprint-spec).

`render.yaml`은 Free 발표용 예시입니다. 아래 영구 디스크 구성은 장기 데이터 보관을 위한 선택 사항이며 기본 무료 배포에는 적용하지 않습니다. Render 영구 디스크는 유료입니다.

1. 계정과 비공개 Git 저장소를 준비합니다. 저장소 루트가 `cleancycle`이 되도록 프로젝트를 올리고 API 키·DB를 제외합니다.
2. Docker Web Service를 만들거나 루트의 `render.yaml`을 Blueprint로 적용합니다. 상위 저장소 구조를 유지하면 Root Directory를 `cleancycle`로 지정하고 경로 설정도 맞춥니다.
3. 영구 디스크를 `/var/data`에 마운트하고 `CLEANCYCLE_DB=/var/data/cleancycle.sqlite3`로 지정합니다.
4. `KMA_SERVICE_KEY`, `AIRKOREA_SERVICE_KEY`, `COOKIE_SECURE=1`, `PUBLIC_ORIGIN=https://실제서비스주소`를 환경변수로 설정합니다. 주소 확정 후 갱신합니다.
5. Health Check 경로를 `/api/health`로 지정하고 아래 항목을 검증합니다.

## 배포 후 인수 테스트

- `/api/health`가 200, 비로그인 `/api/dashboard`가 401인지 확인합니다.
- 두 기기에서 서로 다른 계정을 만들고 관리자 집 생성 → 초대 발급 → 구성원 참여를 확인합니다.
- 담당자 지정 → 다른 계정 완료 → 첫 기기 화면 갱신과 리포트 기록을 확인합니다. 화면이 활성 상태일 때 15초마다, 다시 포커스했을 때 갱신됩니다.
- 다른 집의 작업이 보이지 않는지, 관리자만 초대·내보내기를 할 수 있는지 확인합니다.
- 브라우저 개발자 도구에서 세션 쿠키의 HttpOnly·Secure·SameSite 설정을 확인합니다.
- 공공 API 응답 시각과 측정소를 확인합니다. 키 미설정·통신 실패 시 가짜 수치가 표시되면 안 됩니다.
- 서버 재시작과 재배포 후 계정·집안일·완료 이력이 유지되는지 확인합니다.

## 백업과 기존 데이터

SQLite는 WAL을 사용합니다. 실행 중 `cleancycle.sqlite3`만 복사하지 않습니다. SQLite backup API를 사용하거나 서버를 정상 종료한 뒤 DB를 백업합니다. 백업에는 계정 정보가 포함되므로 비공개로 보관합니다. 정기 백업 및 실제 복원 테스트가 필요합니다.

로컬 데이터를 옮길 때는 서버를 종료하고 백업한 DB를 영구 볼륨에 복원합니다. 로그인 도입 전 기록이 있다면 DB 옆 `legacy-claim-code.txt`도 비공개로 보관하고, 집 생성 화면의 '기존 개인 데이터 이전'에 입력합니다. 이전 코드는 1회만 사용할 수 있습니다. 빈 DB에는 파일이 생성되지 않습니다. 만료 세션을 포함한 DB 전체를 옮기는 경우 서비스 주소 변경 후 로그인 상태를 다시 확인합니다.
