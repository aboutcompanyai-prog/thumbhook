/**
 * Google Cloud Speech-to-Text (@google-cloud/speech)
 * — 단어별 시작·종료 시간(enableWordTimeOffsets)
 * — 인라인 10MB 한도: 긴 파일은 청크 recognize
 */
import speech from '@google-cloud/speech';
import { pcmNeedsChunkedTranscription, transcribePcmInChunks, dedupeOverlappingWords } from './speechChunkedPcm.js';

const speechClient = new speech.SpeechClient();

import { extractWordsWithTimestamps } from './speechSttWords.js';

export { durationToSeconds, extractWordsWithTimestamps } from './speechSttWords.js';

const sttConfig = (sampleRate) => ({
  encoding: 'LINEAR16',
  sampleRateHertz: sampleRate,
  languageCode: 'ko-KR',
  enableWordTimeOffsets: true,
  enableAutomaticPunctuation: true,
  profanityFilter: false,
  useEnhanced: true,
  model: 'latest_long'
});

/**
 * LINEAR16 모노 PCM → 단어별 타임스탬프
 */
export async function transcribeLinear16WithWordTimestamps(pcmBuffer, sampleRateHertz = 16000, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const bytes = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
  if (bytes.length < 2) {
    throw new Error('오디오 데이터가 비어 있습니다.');
  }

  const sampleRate = Math.max(8000, Math.floor(Number(sampleRateHertz) || 16000));
  const durationSec = bytes.length / (2 * sampleRate);
  const config = sttConfig(sampleRate);

  const recognizeSlice = async (slice, rate) => {
    const [result] = await speechClient.recognize({
      config: sttConfig(rate),
      audio: { content: slice.toString('base64') }
    });
    return result;
  };

  if (pcmNeedsChunkedTranscription(bytes.length, durationSec, sampleRate)) {
    onProgress?.({
      phase: 'stt',
      message: `긴 오디오 — 구간별 인식(@google-cloud/speech, 10MB 한도 회피)…`
    });
    const { words, chunkCount } = await transcribePcmInChunks(bytes, sampleRate, recognizeSlice, {
      onProgress,
      maxConcurrency: opts.maxConcurrency,
      speedMode: opts.speedMode
    });
    return {
      words,
      durationSec,
      engine: '@google-cloud/speech-chunked',
      sampleRateHertz: sampleRate,
      chunkCount
    };
  }

  onProgress?.({ phase: 'stt', message: '음성 인식 중… (recognize)' });
  const [result] = await speechClient.recognize({
    config,
    audio: { content: bytes.toString('base64') }
  });

  const words = dedupeOverlappingWords(extractWordsWithTimestamps(result));
  if (words.length === 0) {
    throw new Error('인식된 단어가 없습니다. 오디오·마이크·언어 설정을 확인해 주세요.');
  }

  onProgress?.({
    phase: 'stt-done',
    message: `단어 ${words.length}개 · 타임스탬프 추출 완료`,
    wordCount: words.length
  });

  return {
    words,
    durationSec,
    engine: '@google-cloud/speech',
    sampleRateHertz: sampleRate
  };
}
