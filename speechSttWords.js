/** Protobuf Duration | "1.234s" | number → 초 */
export const durationToSeconds = (duration) => {
  if (duration == null) return null;
  if (typeof duration === 'number' && Number.isFinite(duration)) return duration;
  if (typeof duration === 'object') {
    const sec = Number(duration.seconds ?? 0);
    const nano = Number(duration.nanos ?? 0);
    if (Number.isFinite(sec)) return sec + nano / 1e9;
  }
  const s = String(duration).trim();
  if (!s) return null;
  if (s.endsWith('s')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** STT JSON 응답 → 단어별 절대 초 */
export const extractWordsWithTimestamps = (response) => {
  const words = [];
  const results = Array.isArray(response?.results) ? response.results : [];

  for (const result of results) {
    const alt = result.alternatives?.[0];
    if (!alt?.words?.length) continue;

    for (const w of alt.words) {
      const token = String(w.word ?? '').trim();
      const startSec = durationToSeconds(w.startTime);
      const endSec = durationToSeconds(w.endTime);
      if (!token || startSec == null || endSec == null) continue;
      words.push({
        word: token,
        startSec,
        endSec: Math.max(startSec + 0.01, endSec)
      });
    }
  }

  return words;
};
