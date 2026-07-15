/**
 * Google STT 인라인 업로드 한도(요청 본문 ~10MB) 대응 — PCM을 구간별 recognize
 */
import { extractWordsWithTimestamps } from './speechSttWords.js';

/**
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(Number(concurrency) || 1), list.length));
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = next++;
        if (i >= list.length) break;
        results[i] = await fn(list[i], i);
      }
    })
  );
  return results;
}

/** 인라인 audio.content 최대 ~10MB — base64·JSON 여유 두고 raw PCM 상한 */
export const MAX_INLINE_PCM_BYTES = 6 * 1024 * 1024;
/** sync recognize 권장 길이(초) 이내로 청크 */
export const CHUNK_SECONDS = 48;
export const CHUNK_OVERLAP_SECONDS = 2.8;

export const pcmNeedsChunkedTranscription = (pcmByteLength, durationSec, sampleRate) => {
  if (pcmByteLength > MAX_INLINE_PCM_BYTES) return true;
  if (Number.isFinite(durationSec) && durationSec > CHUNK_SECONDS + 2) return true;
  const maxSyncBytes = CHUNK_SECONDS * sampleRate * 2;
  return pcmByteLength > maxSyncBytes;
};

/**
 * @param {Buffer} pcmBuffer
 * @param {number} sampleRateHertz
 */
export function* iteratePcmChunks(pcmBuffer, sampleRateHertz) {
  const sampleRate = Math.max(8000, Math.floor(sampleRateHertz) || 16000);
  const bytesPerSec = sampleRate * 2;
  const chunkBytes = Math.min(
    Math.floor(CHUNK_SECONDS * bytesPerSec),
    MAX_INLINE_PCM_BYTES
  );
  const overlapBytes = Math.floor(CHUNK_OVERLAP_SECONDS * bytesPerSec);
  const stepBytes = Math.max(bytesPerSec, chunkBytes - overlapBytes);

  for (let byteOffset = 0; byteOffset < pcmBuffer.length; byteOffset += stepBytes) {
    const end = Math.min(pcmBuffer.length, byteOffset + chunkBytes);
    const slice = pcmBuffer.subarray(byteOffset, end);
    if (slice.length < bytesPerSec * 0.25) break;
    yield {
      slice,
      offsetSec: byteOffset / bytesPerSec,
      index: Math.floor(byteOffset / stepBytes)
    };
    if (end >= pcmBuffer.length) break;
  }
}

const normalizeLoose = (s) => String(s ?? '').replace(/\s+/g, '').trim();

/** 겹침 구간에서 동일 단어·근접 시각 중복 제거 */
export const dedupeOverlappingWords = (words) => {
  const sorted = [...words].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const out = [];
  for (const w of sorted) {
    const prev = out[out.length - 1];
    const sameTok = prev && normalizeLoose(prev.word) === normalizeLoose(w.word);
    const sameStart = prev && Math.abs(prev.startSec - w.startSec) < 0.35;
    const consecutiveDup = sameTok && prev && w.startSec <= prev.endSec + 0.28;
    if (prev && sameTok && (sameStart || consecutiveDup)) {
      prev.endSec = Math.max(prev.endSec, w.endSec);
      continue;
    }
    out.push({ ...w });
  }
  return out;
};

/**
 * @param {Buffer} pcmBuffer
 * @param {number} sampleRateHertz
 * @param {(slice: Buffer, sampleRate: number) => Promise<object>} recognizeSlice STT JSON 응답
 * @param {{ onProgress?: (info: object) => void }} [opts]
 */
export async function transcribePcmInChunks(pcmBuffer, sampleRateHertz, recognizeSlice, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const bytes = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
  const sampleRate = Math.max(8000, Math.floor(Number(sampleRateHertz) || 16000));
  const durationSec = bytes.length / (2 * sampleRate);

  const speedMode = opts.speedMode !== false;
  const maxConcurrency = Math.max(
    1,
    Math.min(8, Math.floor(Number(opts.maxConcurrency) || (speedMode ? 6 : 3)))
  );

  const chunks = [...iteratePcmChunks(bytes, sampleRate)];
  const total = chunks.length;
  let done = 0;

  const partResults = await mapWithConcurrency(chunks, maxConcurrency, async ({ slice, offsetSec }, i) => {
    const response = await recognizeSlice(slice, sampleRate);
    const local = extractWordsWithTimestamps(response);
    const words = local.map((w) => ({
      word: w.word,
      startSec: w.startSec + offsetSec,
      endSec: w.endSec + offsetSec
    }));
    done += 1;
    onProgress?.({
      phase: 'stt',
      message: `음성 인식 ${done}/${total}구간`,
      current: done,
      total,
      percent: total ? Math.round((done / total) * 100) : null,
      chunkIndex: i
    });
    return words;
  });

  const merged = partResults.flat();

  const words = dedupeOverlappingWords(merged);
  if (words.length === 0) {
    throw new Error('인식된 단어가 없습니다.');
  }

  onProgress?.({
    phase: 'stt-done',
    message: `단어 ${words.length}개 · ${total}구간 병합 완료`,
    wordCount: words.length
  });

  return { words, durationSec, chunkCount: total };
}
