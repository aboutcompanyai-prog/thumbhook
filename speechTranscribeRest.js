/**
 * 서비스 계정 없을 때 — 루트 .env 의 VITE_GOOGLE_SPEECH_API_KEY / GOOGLE_SPEECH_API_KEY 로 REST STT
 * (단어별 enableWordTimeOffsets, 10MB 초과 시 청크 분할)
 */
import { pcmNeedsChunkedTranscription, transcribePcmInChunks, dedupeOverlappingWords } from './speechChunkedPcm.js';
import { extractWordsWithTimestamps } from './speechSttWords.js';

const getApiKey = () =>
  String(process.env.GOOGLE_SPEECH_API_KEY || process.env.VITE_GOOGLE_SPEECH_API_KEY || '').trim();

const defaultReferer = () => {
  const fromEnv = String(process.env.SPEECH_API_REFERER || process.env.VITE_DEV_URL || '').trim();
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  return 'http://localhost:5175/';
};

/** API 키 HTTP 리퍼러 제한 — 클라이언트 origin 또는 localhost */
const buildApiKeyHeaders = (refererHint) => {
  const referer = String(refererHint || defaultReferer()).trim() || defaultReferer();
  const ref = referer.endsWith('/') ? referer : `${referer}/`;
  const origin = ref.replace(/\/$/, '');
  return {
    'Content-Type': 'application/json',
    Referer: ref,
    Origin: origin
  };
};

const recognizeSync = async (audioBase64, sampleRateHertz, refererHint) => {
  const key = getApiKey();
  if (!key) throw new Error('GOOGLE_SPEECH_API_KEY 또는 VITE_GOOGLE_SPEECH_API_KEY가 없습니다.');

  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildApiKeyHeaders(refererHint),
    body: JSON.stringify({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz,
        languageCode: 'ko-KR',
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
        useEnhanced: true,
        model: 'latest_long'
      },
      audio: { content: audioBase64 }
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && /referer|PERMISSION_DENIED/i.test(body)) {
      throw new Error(
        'Speech API 키가 "HTTP 리퍼러" 제한으로 설정되어 있어 서버에서 호출할 수 없습니다. ' +
          'Google Cloud Console → API 키 → 애플리케이션 제한사항에서 (1) 서버용 키는 "IP 주소" 또는 제한 없음, ' +
          '또는 (2) .env에 GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 JSON)를 설정하세요. ' +
          '브라우저용 localhost 리퍼러 키는 Node Speech 서버에서 쓸 수 없습니다.'
      );
    }
    throw new Error(`Speech REST 실패 (${res.status}): ${body.slice(0, 240)}`);
  }
  return res.json();
};

export const hasSpeechApiKey = () => Boolean(getApiKey());

export async function transcribeLinear16WithWordTimestampsRest(pcmBuffer, sampleRateHertz = 16000, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const refererHint = opts.referer;
  const bytes = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
  const sampleRate = Math.max(8000, Math.floor(Number(sampleRateHertz) || 16000));
  const durationSec = bytes.length / (2 * sampleRate);

  const recognizeSlice = async (slice, rate) =>
    recognizeSync(slice.toString('base64'), rate, refererHint);

  // REST 인라인 업로드는 ~10MB 한도 — longrunning 일괄 전송 사용 안 함, 항상 구간별 recognize
  const useChunks =
    pcmNeedsChunkedTranscription(bytes.length, durationSec, sampleRate) || bytes.length > 32000;

  if (useChunks) {
    onProgress?.({
      phase: 'stt',
      message: `구간별 인식(10MB 한도 회피) · 약 ${Math.ceil(durationSec)}초…`
    });
    const { words, chunkCount } = await transcribePcmInChunks(bytes, sampleRate, recognizeSlice, {
      onProgress,
      maxConcurrency: opts.maxConcurrency,
      speedMode: opts.speedMode
    });
    return {
      words,
      durationSec,
      engine: 'google-speech-rest-api-key-chunked',
      sampleRateHertz: sampleRate,
      chunkCount
    };
  }

  onProgress?.({ phase: 'stt', message: 'Speech REST (API 키) 인식 중…' });
  const response = await recognizeSync(bytes.toString('base64'), sampleRate);
  const words = dedupeOverlappingWords(extractWordsWithTimestamps(response));
  if (words.length === 0) {
    throw new Error('인식된 단어가 없습니다.');
  }

  return {
    words,
    durationSec,
    engine: 'google-speech-rest-api-key',
    sampleRateHertz: sampleRate
  };
}
