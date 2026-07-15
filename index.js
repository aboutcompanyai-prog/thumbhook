/**
 * Speech-to-Text API 서버 (@google-cloud/speech)
 * Vite dev: /api/speech → http://localhost:8787 (vite.config.js proxy)
 */
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getSpeechAuthMode,
  transcribeLinear16WithWordTimestamps
} from './speechTranscribeRouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

/** Cloud Run sets PORT; local/dev can use SPEECH_SERVER_PORT (default 8787). */
const PORT =
  Number(process.env.PORT) ||
  Number(process.env.SPEECH_SERVER_PORT) ||
  8787;
/** health 로 새 코드 적용 여부 확인 */
const SPEECH_SERVER_BUILD = 'chunked-stt-v2';
const app = express();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: '120mb' }));

app.get('/api/speech/health', (_req, res) => {
  const authMode = getSpeechAuthMode();
  res.json({
    ok: authMode !== 'none',
    authMode,
    build: SPEECH_SERVER_BUILD,
    chunked: true,
    engine: authMode === 'service_account' ? '@google-cloud/speech' : 'google-speech-rest-api-key-chunked'
  });
});

/**
 * POST /api/speech/transcribe
 * Body: { audioBase64: string, sampleRateHertz?: number }
 *   - audioBase64: LINEAR16 mono PCM (16-bit LE), not WAV
 * Response: { words: [{ word, startSec, endSec }], durationSec, engine }
 */
app.post('/api/speech/transcribe', async (req, res) => {
  try {
    const { audioBase64, sampleRateHertz = 16000, referer, maxConcurrency, speedMode } = req.body ?? {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: 'audioBase64 (LINEAR16 PCM)가 필요합니다.' });
      return;
    }

    const pcm = Buffer.from(audioBase64, 'base64');
    const result = await transcribeLinear16WithWordTimestamps(pcm, sampleRateHertz, {
      referer: typeof referer === 'string' ? referer : undefined,
      maxConcurrency: Number.isFinite(Number(maxConcurrency)) ? Number(maxConcurrency) : undefined,
      speedMode: speedMode !== false,
      onProgress: (info) => {
        if (info?.phase) console.log('[speech-server]', info.phase, info.message || '');
      }
    });
    res.json(result);
  } catch (err) {
    console.error('[speech-server]', err);
    const msg = err?.message || String(err);
    const status = /credentials|Could not load the default credentials/i.test(msg) ? 503 : 500;
    res.status(status).json({
      error: msg,
      hint:
        status === 503
          ? 'GOOGLE_APPLICATION_CREDENTIALS에 서비스 계정 JSON 경로를 설정하고 Speech-to-Text API를 사용 설정하세요.'
          : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`[speech-server] http://localhost:${PORT}`);
  console.log(`[speech-server] POST /api/speech/transcribe  (LINEAR16 + word timestamps)`);
  console.log(`[speech-server] GET  /api/speech/health`);
  const mode = getSpeechAuthMode();
  if (mode === 'none') {
    console.warn(
      '[speech-server] 인증 없음 — .env 에 GOOGLE_APPLICATION_CREDENTIALS 또는 VITE_GOOGLE_SPEECH_API_KEY 설정'
    );
  } else if (mode === 'api_key') {
    console.log('[speech-server] 인증: VITE_GOOGLE_SPEECH_API_KEY (REST, 단어 타임스탬프)');
  } else {
    console.log('[speech-server] 인증: GOOGLE_APPLICATION_CREDENTIALS (@google-cloud/speech)');
  }
});
