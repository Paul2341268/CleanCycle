# CleanCycle 배포 준비

현재는 배포 준비 상태이며 공개 서버는 생성하지 않았습니다. 계정, 서비스 선택 및 유료 요금 동의 후 배포할 수 있습니다.

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

Render 영구 디스크는 유료입니다. `render.yaml`은 starter + 1GB disk 예시이며 비용 확인과 사용자 동의 후에만 적용합니다. 디스크를 사용하면 단일 인스턴스이며 배포 중 짧은 중단이 있을 수 있습니다.

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
