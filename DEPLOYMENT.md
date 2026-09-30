# 학교 발표용 무료 배포

개인용 CleanCycle은 React 화면과 FastAPI 공공 API 조회 서버를 하나의 웹서비스로 배포합니다. DB, 로그인 서버, 영구 디스크 설정은 필요하지 않습니다.

## 고정 주소: Render Free

1. Render에 로그인하고 New → Web Service를 선택합니다.
2. Public Git Repository에 `https://github.com/Paul2341268/CleanCycle`을 연결합니다.
3. Language는 Docker, Branch는 main, Compute는 **Free ($0/month)**로 선택합니다. Root Directory는 비워 둡니다.
4. Environment Variables에 `KMA_SERVICE_KEY`, `AIRKOREA_SERVICE_KEY`를 입력합니다. `Add from .env → Choose a file`에서 로컬 `backend/.env`를 선택해도 됩니다. 실제 키를 저장소에 올리지 않습니다.
5. Deploy web service를 실행하고 완료된 `https://서비스이름.onrender.com` 주소를 발표에 사용합니다.

Render 무료 서비스는 15분 동안 요청이 없으면 잠들고 다음 접속 시 약 1분의 시작 시간이 걸릴 수 있습니다. 발표 전에 사이트를 열어 둡니다. 기록은 브라우저에 저장되므로 서버 휴면·재시작과 관계없이 동일 브라우저/주소에서 유지됩니다. 기존 PC의 기록은 JSON 백업으로 가져옵니다.

공식 안내: [Render 무료 서비스](https://render.com/docs/free).

## 보조 방법: 현재 PC의 임시 시연 링크

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Presentation.ps1
```

Cloudflare가 임시 HTTPS 주소를 발급합니다. 이 PC와 서버가 켜져 있고 인터넷에 연결되어 있을 때 다른 컴퓨터에서 접속할 수 있습니다. 종료는 `Stop-Presentation.ps1`입니다. 다시 시작하면 주소가 바뀌므로 이전 주소의 개인 기록은 백업 파일로 옮깁니다. API 키를 브라우저에 노출하지 않습니다.

공식 안내: [Cloudflare 임시 터널](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## 배포 후 확인

- 공개 주소에서 로그인 없이 첫 화면이 열리는지 확인합니다.
- 날씨·대기질의 출처와 시각을 확인하고 추천 근거를 엽니다.
- 집안일 추가 → 완료 → 새로고침 → 리포트 → 완료 취소를 확인합니다.
- 백업을 내보내고 별도 브라우저에서 가져옵니다.
- 모바일에서도 작업 버튼과 입력창이 잘리는지 확인합니다.

무료 공개 서버는 아직 실제 서비스 생성과 배포 완료를 확인한 뒤에만 제공된 주소를 사용합니다. 저장소 업로드만으로 공개 사이트가 만들어지지는 않습니다.
