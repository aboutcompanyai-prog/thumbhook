import { transcribeLinear16WithWordTimestamps as transcribeSdk } from './speechTranscribe.js';
import { hasSpeechApiKey, transcribeLinear16WithWordTimestampsRest } from './speechTranscribeRest.js';

export const hasServiceAccountAuth = () =>
  Boolean(String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim());

export const getSpeechAuthMode = () => {
  if (hasServiceAccountAuth()) return 'service_account';
  if (hasSpeechApiKey()) return 'api_key';
  return 'none';
};

/**
 * 서비스 계정(@google-cloud/speech) 우선, 없으면 기존 API 키 REST
 */
export async function transcribeLinear16WithWordTimestamps(pcmBuffer, sampleRateHertz = 16000, opts = {}) {
  const mode = getSpeechAuthMode();
  if (mode === 'service_account') {
    return transcribeSdk(pcmBuffer, sampleRateHertz, opts);
  }
  if (mode === 'api_key') {
    return transcribeLinear16WithWordTimestampsRest(pcmBuffer, sampleRateHertz, {
      ...opts,
      referer: opts.referer
    });
  }
  throw new Error(
    'Speech 인증이 없습니다. GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 JSON) 또는 ' +
      'VITE_GOOGLE_SPEECH_API_KEY 를 .env 에 설정하세요.'
  );
}
