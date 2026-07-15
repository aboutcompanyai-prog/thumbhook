# Speech-to-Text 서버 (`@google-cloud/speech`)

브라우저 REST API 키 대신 **Google 공식 Node 클라이언트**로 받아쓰기합니다.  
`enableWordTimeOffsets: true`로 **단어마다 `startSec` / `endSec`** 를 반환합니다.

## 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 **Speech-to-Text API** 사용 설정

### 권장: 서비스 계정 (Node 서버용)

프로젝트 루트 `.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=./secrets/your-service-account.json
SPEECH_SERVER_PORT=8787
```

### API 키만 쓸 때 (403 referer 오류 주의)

`VITE_GOOGLE_SPEECH_API_KEY`가 **웹사이트(HTTP 리퍼러)** 제한이면 브라우저에서만 동작하고, **Speech 서버(Node)에서는 403** 이 납니다.

해결:

- Console → **API 및 서비스** → **사용자 인증 정보** → 키 편집
- 서버 전용 키를 새로 만들고 **애플리케이션 제한**: `IP 주소`(배포 서버 IP) 또는 개발 중에는 `없음`
- 또는 기존 키의 리퍼러 제한을 제거하고 서버·클라이언트용 키를 분리

```env
GOOGLE_SPEECH_API_KEY=서버용_키
SPEECH_SERVER_PORT=8787
```

## 실행

```bash
cd server && npm install
cd .. && npm install
npm run dev:all
```

- Vite: `http://localhost:5175`
- Speech API: `http://localhost:8787` (Vite가 `/api/speech` 로 프록시)

## API

### `GET /api/speech/health`

### `POST /api/speech/transcribe`

```json
{
  "audioBase64": "<LINEAR16 mono PCM base64>",
  "sampleRateHertz": 16000
}
```

응답 예:

```json
{
  "words": [
    { "word": "안녕하세요", "startSec": 0.5, "endSec": 1.2 },
    { "word": "여러분", "startSec": 1.25, "endSec": 1.8 }
  ],
  "durationSec": 120.5,
  "engine": "@google-cloud/speech"
}
```

핵심 구현: `server/speechTranscribe.js` → `transcribeLinear16WithWordTimestamps`
