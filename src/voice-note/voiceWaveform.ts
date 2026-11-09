/**
 * Convert observed audio amplitude into a compact waveform for an in-bubble
 * voice note. Values are real samples, not randomly generated decoration.
 */
export function voiceWaveformFromPeaks(samples: readonly number[], bars = 42): number[] {
  if (samples.length === 0 || bars < 1) return [];
  const count = Math.max(1, Math.floor(bars));
  const sanitized = samples.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
  const max = Math.max(...sanitized, 0.01);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.min(sanitized.length - 1, Math.floor(i * sanitized.length / count));
    const end = Math.max(start + 1, Math.ceil((i + 1) * sanitized.length / count));
    const peak = Math.max(...sanitized.slice(start, end));
    return Math.max(0.08, Math.min(1, peak / max));
  });
}

/** Read amplitude from a decoded recording if the live audio analyser is unavailable. */
export function voiceWaveformFromAudioBuffer(buffer: AudioBuffer, bars = 42): number[] {
  if (!buffer.length || !buffer.numberOfChannels) return [];
  const peaks: number[] = [];
  const count = Math.max(1, Math.floor(bars));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  for (let i = 0; i < count; i += 1) {
    const begin = Math.floor(i * buffer.length / count);
    const end = Math.max(begin + 1, Math.floor((i + 1) * buffer.length / count));
    const stride = Math.max(1, Math.floor((end - begin) / 120));
    let maximum = 0;
    for (let frame = begin; frame < end; frame += stride) {
      for (const channel of channels) maximum = Math.max(maximum, Math.abs(channel[frame] ?? 0));
    }
    peaks.push(maximum);
  }
  return voiceWaveformFromPeaks(peaks, count);
}
