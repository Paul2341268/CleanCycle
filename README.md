# CleanCycle Personal

기상청 단기예보와 에어코리아 대기질 데이터를 활용해 개인의 집안일 우선순위를 추천하는 수업 발표용 웹앱입니다.

**발표용 사이트: [CleanCycle 실행](https://cleancycle-presentation.onrender.com/)**
별도 설치 없이 다른 컴퓨터에서도 접속할 수 있습니다. 무료 서버가 휴면 상태이면 첫 접속에 약 1분이 걸릴 수 있으므로 발표 전에 열어 둡니다.

**로그인과 DB 없이 사용합니다.** 집안일과 완료 이력은 방문자의 브라우저 `localStorage`에 저장합니다. 서버는 공공 API 키를 보관하고 날씨·대기질만 조회합니다. 집안일 기록을 서버에 전송하지 않습니다.

## 발표 흐름

1. 사이트를 열어 지역의 날씨와 대기질을 확인합니다.
2. 욕실 청소, 빨래 등 반복 집안일을 추가합니다.
3. 작업의 추천 근거를 눌러 공공 데이터가 우선순위에 반영된 이유를 확인합니다.
4. 완료 또는 하루 미루기를 실행하고 생활 리포트를 확인합니다.

가족·룸메이트 공유, 계정, 초대, 담당자, 사진 인증, 생성형 AI, 쓰레기 배출 지역 기능은 개인용 범위에서 제외했습니다. 기본 주기는 조정 가능한 앱 초기값이며 공식 권장 주기가 아닙니다.

## 기록 저장과 다른 컴퓨터

같은 사이트 주소의 같은 브라우저에서는 새로고침 후에도 기록이 유지됩니다. 다른 컴퓨터, 브라우저, 사이트 주소에서는 별도 기록을 사용합니다. `설정 → 백업 내보내기`로 JSON 파일을 내려받고 다른 컴퓨터의 `설정 → 백업 가져오기`에서 옮길 수 있습니다. 가져오기는 확인 후 현재 기록을 교체합니다. 잘못된 파일이나 저장 실패 시 기존 기록을 유지합니다. 브라우저 사이트 데이터 삭제와 시크릿 창 종료 시 기록이 사라질 수 있습니다.

공개 URL은 실제 서버 배포가 필요합니다. GitHub는 소스 저장소이며 `127.0.0.1`은 실행한 PC 전용 주소입니다. [배포 방법](DEPLOYMENT.md)을 참고합니다.

## Windows에서 개발 실행

Python 3.11 이상, Node.js 22 이상(npm 포함)을 설치하고 이 저장소를 내려받은 후 프로젝트 폴더에서 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

`http://127.0.0.1:8765/`를 엽니다. API 키는 `backend/.env`의 `KMA_SERVICE_KEY`, `AIRKOREA_SERVICE_KEY`에 입력합니다. 실제 키를 GitHub에 올리지 않습니다. 키가 없어도 개인 집안일 관리와 리포트는 사용할 수 있습니다.

macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend
npm ci
npm run build
cd ../backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

## 공공 데이터와 추천 규칙

- [기상청 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do): TMP, REH, POP, PTY. 현재 관측값이 아닌 미래 예보이며 7개 도시 대표 격자를 사용합니다. 10분 캐시를 적용합니다.
- [에어코리아 대기오염정보](https://www.data.go.kr/data/15073861/openapi.do): PM10, PM2.5, 1시간 등급, 측정소와 측정 시각. 30분 캐시를 적용합니다. 결측은 정보 없음으로 표시하고 3시간 넘게 지난 자료는 추천에서 제외합니다.

예정일 지연 하루당 +2점, 실외 습도 75% 이상 시 욕실 물기 점검 +3점, 비 예보 시 자연건조·야외 청소 -3점, 미세먼지 나쁨 이상 시 야외 청소·환기 -3점과 필터 점검 +3점을 적용합니다. 자체 데모 규칙이며 날짜를 자동 변경하지 않습니다. 실외 습도를 실내 습도로 간주하지 않습니다. API 오류 시 가짜 날씨를 표시하지 않고 예정일만으로 관리합니다.

오늘의 완료율은 오늘 기록된 예정 작업과 완료 작업 합집합 대비 완료 비율입니다. 미루거나 삭제한 작업도 당일 분모에 남습니다. 완료 취소는 이후 작업 변경이 없는 기록만 가능합니다.

## 테스트

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
node --test unit/personal.test.js
npx playwright test
```

브라우저 테스트는 별도 브라우저 기록과 빈 테스트 API 설정을 사용합니다. 테스트에는 Chrome이 필요합니다.

이전 공동관리 버전의 SQLite 파일은 자동으로 삭제하거나 공개하지 않습니다. 개인용 앱에서는 사용하지 않습니다. 이전 버전은 Git 이력에 보관되어 있습니다.
