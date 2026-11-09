// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { voiceWaveformFromAudioBuffer, voiceWaveformFromPeaks } from './voiceWaveform';

describe('voice waveform from observed audio', () => {
  it('represents actual amplitude changes rather than decorative random bars', () => {
    const peaks = voiceWaveformFromPeaks([0.01, 0.6, 1, 0.1], 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[2]).toBe(1);
    expect(peaks[0]).toBeLessThan(peaks[1]);
    expect(peaks[3]).toBeLessThan(peaks[2]);
    expect(voiceWaveformFromPeaks([], 42)).toEqual([]);
  });

  it('handles silence and invalid levels without NaN', () => {
    const peaks = voiceWaveformFromPeaks([0, Number.NaN, Number.POSITIVE_INFINITY], 7);
    expect(peaks).toHaveLength(7);
    expect(peaks.every((value) => Number.isFinite(value) && value >= 0.08 && value <= 1)).toBe(true);
  });

  it('extracts maxima from decoded PCM per waveform bucket', () => {
    const pcm = new Float32Array([0, 0.05, 0.1, 0, 0, 0.4, 0.8, 0.2]);
    const buffer = { length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm } as unknown as AudioBuffer;
    const peaks = voiceWaveformFromAudioBuffer(buffer, 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[1]).toBe(1);
    expect(peaks[0]).toBeLessThan(peaks[1]);
  });
});
