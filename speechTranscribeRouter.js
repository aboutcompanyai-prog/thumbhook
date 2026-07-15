import { transcribeLinear16WithWordTimestamps as transcribeSdk } from './speechTranscribe.js';
import { hasSpeechApiKey, transcribeLinear16WithWordTimestampsRest } from './speechTranscribeRest.js';

/** Local JSON path, or Cloud Run / GCE metadata (Application Default Credentials). */
export const hasServiceAccountAuth = () =>
  Boolean(String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) ||
  Boolean(String(process.env.K_SERVICE || process.env.GCE_METADATA_HOST || '').trim());

export const getSpeechAuthMode = () => {
  // Prefer API key when explicitly set (Cloud Run env), else ADC / service account JSON.
  if (hasSpeechApiKey()) return 'api_key';
  if (hasServiceAccountAuth()) return 'service_account';
  return 'none';
};

/**
 * API 키(env)가 있으면 REST, 없으면 서비스 계정 / Cloud Run ADC
 */
export async function transcribeLinear16WithWordTimestamps(pcmBuffer, sampleRateHertz = 16000, opts = {}) {
  const mode = getSpeechAuthMode();
  if (mode === 'api_key') {
    return transcribeLinear16WithWordTimestampsRest(pcmBuffer, sampleRateHertz, {
      ...opts,
      referer: opts.referer
    });
  }
  if (mode === 'service_account') {
    return transcribeSdk(pcmBuffer, sampleRateHertz, opts);
  }
  throw new Error(
    'Speech 인증이 없습니다. GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 JSON) 또는 ' +
      'VITE_GOOGLE_SPEECH_API_KEY 를 .env 에 설정하세요.'
  );
}
