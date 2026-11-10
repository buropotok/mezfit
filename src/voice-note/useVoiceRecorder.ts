import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireSessionMicrophone } from './sessionMicrophone';
import { voiceWaveformFromAudioBuffer, voiceWaveformFromPeaks } from './voiceWaveform';

export interface VoiceRecording {
  /** Raw recording for message attachment/storage integration. */
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[];
}

export type VoiceRecorderStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';

const AUDIO_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function audioRecorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  const mimeType = AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)) {
    return 'Нет доступа к микрофону. Разрешите запись звука в Telegram.';
  }
  return 'Не удалось записать голосовое сообщение. Проверьте микрофон и разрешения Telegram.';
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function audioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return (typeof AudioContext !== 'undefined' ? AudioContext : undefined)
    ?? (window as WebkitWindow).webkitAudioContext;
}

/**
 * Standalone mic session and recording API:
 * start() -> stop() yields a Blob + real waveform; cancel()/release() discard.
 * The chat opts into a shared WebView permission session.
 * It never uploads media or starts capture at import/mount time.
 */
export function useVoiceRecorder({ session = false, onSample }: {
  session?: boolean; onSample?: (level: number) => void;
} = {}) {
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const [error, setError] = useState('');
  const statusRef = useRef<VoiceRecorderStatus>('idle');
  const mountedRef = useRef(false);
  const epochRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const resolveStopRef = useRef<((clip: VoiceRecording | null) => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const samplerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const updateStatus = useCallback((next: VoiceRecorderStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const stopSampling = useCallback(() => {
    if (samplerRef.current !== null) window.clearInterval(samplerRef.current);
    samplerRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) void context.close().catch(() => undefined);
  }, []);

  const sampleAudio = useCallback((stream: MediaStream) => {
    stopSampling();
    samplesRef.current = [];
    const AudioContextType = audioContextConstructor();
    if (!AudioContextType) return;
    try {
      const context = new AudioContextType();
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const values = new Uint8Array(analyser.fftSize);
      void context.resume().catch(() => undefined);
      samplerRef.current = window.setInterval(() => {
        if (context.state !== 'running') return;
        analyser.getByteTimeDomainData(values);
        let energy = 0;
        for (const sample of values) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const level = Math.sqrt(energy / values.length);
        samplesRef.current.push(level);
        onSampleRef.current?.(level);
      }, 85);
    } catch {
      stopSampling(); // decodeAudioData is attempted after recording as fallback.
    }
  }, [stopSampling]);

  const cancel = useCallback(() => {
    epochRef.current += 1;
    stopSampling();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* WebView already stopped the recording. */ }
      }
    }
    chunksRef.current = [];
    samplesRef.current = [];
    resolveStopRef.current?.(null);
    resolveStopRef.current = null;
    updateStatus('idle');
  }, [stopSampling, updateStatus]);

  const release = useCallback(() => {
    cancel();
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, [cancel]);

  const decodeFallback = useCallback(async (blob: Blob): Promise<number[]> => {
    const AudioContextType = audioContextConstructor();
    if (!AudioContextType) return [];
    let context: AudioContext | null = null;
    try {
      context = new AudioContextType();
      const bytes = await blob.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes);
      return voiceWaveformFromAudioBuffer(buffer);
    } catch {
      // Some Telegram WebViews record a codec they cannot decode via Web Audio.
      return [];
    } finally {
      if (context) void context.close().catch(() => undefined);
    }
  }, []);

  const start = useCallback(async (permissionOnly = false): Promise<boolean> => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'error') return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Telegram WebView не поддерживает запись звука.');
      updateStatus('error');
      return false;
    }
    const epoch = ++epochRef.current;
    setError('');
    updateStatus('requesting');

    let stream = streamRef.current;
    const tracks = stream?.getAudioTracks() ?? [];
    if (!stream || tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      try {
        const constraints = {
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        };
        stream = session ? await acquireSessionMicrophone(constraints)
          : await navigator.mediaDevices.getUserMedia(constraints);
      } catch (cause) {
        if (mountedRef.current && epoch === epochRef.current) {
          setError(microphoneError(cause));
          updateStatus('error');
        }
        return false;
      }
      if (!mountedRef.current || epoch !== epochRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
    }

    if (!mountedRef.current || epoch !== epochRef.current) return false;
    if (permissionOnly) { release(); return false; }
    const recordingStream = stream;
    try {
      const options = audioRecorderOptions();
      const recorder = options ? new MediaRecorder(recordingStream, options) : new MediaRecorder(recordingStream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event: BlobEvent) => {
        if (recorderRef.current === recorder && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (recorderRef.current !== recorder) return;
        release();
        setError('Ошибка записи звука. Попробуйте ещё раз.');
        updateStatus('error');
      };
      recorder.onstop = () => {
        if (recorderRef.current !== recorder || epoch !== epochRef.current) return;
        recorderRef.current = null;
        stopSampling();
        if (session) {
          recordingStream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        const mimeType = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        const durationMs = Math.max(0, Date.now() - startedAtRef.current);
        const observedSamples = samplesRef.current;
        samplesRef.current = [];
        void (async () => {
          const waveform = observedSamples.length >= 3
            ? voiceWaveformFromPeaks(observedSamples)
            : await decodeFallback(blob);
          if (!mountedRef.current || epoch !== epochRef.current) return;
          if (blob.size === 0) {
            setError('Запись не содержит звука. Попробуйте ещё раз.');
            updateStatus('error');
            resolveStopRef.current?.(null);
          } else {
            updateStatus('idle');
            resolveStopRef.current?.({ blob, mimeType, durationMs, waveform });
          }
          resolveStopRef.current = null;
        })();
      };
      recorder.start(1000);
      sampleAudio(recordingStream);
      updateStatus('recording');
      return true;
    } catch {
      recorderRef.current = null;
      if (session) release();
      else stopSampling();
      setError('Не удалось запустить запись на этом устройстве.');
      updateStatus('error');
      return false;
    }
  }, [decodeFallback, release, sampleAudio, session, stopSampling, updateStatus]);

  const stop = useCallback((): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (statusRef.current !== 'recording' || !recorder || recorder.state !== 'recording') {
      return Promise.resolve(null);
    }
    updateStatus('processing');
    return new Promise((resolve) => {
      resolveStopRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        resolveStopRef.current = null;
        resolve(null);
        release();
        setError('Не удалось завершить запись. Попробуйте ещё раз.');
        updateStatus('error');
      }
    });
  }, [release, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    window.addEventListener('pagehide', release);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [release]);

  return { start, stop, cancel, release, status, error };
}
