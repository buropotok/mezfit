import { sendVideoRecordingDiagnostic } from '../api';
import { getTelegramWebApp } from '../telegram';
import {
  VIDEO_RECORDING_MIME_TYPES, type VideoRecordingDiagnostic,
  type VideoRecordingErrorCode, type VideoRecordingProfile,
} from '../../shared/video-recording-diagnostic';

type TechnicalNavigator = Navigator & {
  deviceMemory?: number;
  connection?: { type?: string; effectiveType?: string; downlink?: number; rtt?: number };
  userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> };
};

const lastReported = new Map<string, number>();
const MIN_REPEAT_MS = 5 * 60_000;

function mimeSupport(): VideoRecordingDiagnostic['mimeSupport'] {
  const result: VideoRecordingDiagnostic['mimeSupport'] = {};
  for (const type of VIDEO_RECORDING_MIME_TYPES) {
    try {
      result[type] = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
        ? (MediaRecorder.isTypeSupported(type) ? 'yes' : 'no') : 'unavailable';
    } catch {
      result[type] = 'unavailable';
    }
  }
  return result;
}

/** Collect only browser/recording capabilities, never app identity, paths, chat data or media bytes. */
export function collectVideoRecordingDiagnostic(
  errorCode: VideoRecordingErrorCode,
  profile: VideoRecordingProfile,
  extra: VideoRecordingDiagnostic['device'] = {},
): VideoRecordingDiagnostic {
  const device = navigator as TechnicalNavigator;
  const telegram = getTelegramWebApp();
  const connection = device.connection;
  const constraints = device.mediaDevices?.getSupportedConstraints?.();
  const data: VideoRecordingDiagnostic['device'] = {
    userAgent: device.userAgent,
    platform: device.platform,
    telegramPlatform: telegram?.platform ?? 'unknown',
    telegramVersion: telegram?.version ?? 'unknown',
    androidWebView: /\\bwv\\b/i.test(device.userAgent) ? 'yes' : 'not identified in UA',
    browserBrands: device.userAgentData?.brands?.map(item => item.brand + ' ' + item.version).join(', '),
    language: device.language,
    screen: `${screen.width}x${screen.height}, available ${screen.availWidth}x${screen.availHeight}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: String(window.devicePixelRatio),
    colorDepth: String(screen.colorDepth),
    touchPoints: String(device.maxTouchPoints),
    deviceMemory: device.deviceMemory === undefined ? undefined : String(device.deviceMemory),
    cpuThreads: device.hardwareConcurrency === undefined ? undefined : String(device.hardwareConcurrency),
    networkType: connection?.effectiveType ?? connection?.type,
    networkRtt: connection?.rtt === undefined ? undefined : String(connection.rtt),
    networkDownlink: connection?.downlink === undefined ? undefined : String(connection.downlink),
    secureContext: String(window.isSecureContext),
    mediaRecorder: String(typeof MediaRecorder !== 'undefined'),
    isTypeSupported: String(typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'),
    getUserMedia: String(typeof device.mediaDevices?.getUserMedia === 'function'),
    mediaDevices: String(Boolean(device.mediaDevices)),
    videoEncoder: String(typeof VideoEncoder !== 'undefined'),
    mediaCapabilities: String(Boolean(device.mediaCapabilities)),
    supportedConstraints: constraints ? Object.entries(constraints).filter(([, value]) => value).map(([key]) => key).join(', ') : undefined,
    ...extra,
  };
  return { errorCode, profile, mimeSupport: mimeSupport(), device: data };
}

/** Diagnostic delivery never blocks camera UI, and repeats are throttled per WebView session. */
export function reportVideoRecordingFailure(
  errorCode: VideoRecordingErrorCode,
  profile: VideoRecordingProfile,
  extra: VideoRecordingDiagnostic['device'] = {},
): void {
  try {
    const initData = getTelegramWebApp()?.initData;
    if (!initData) return;
    const key = profile + ':' + errorCode;
    const now = Date.now();
    if (now - (lastReported.get(key) ?? 0) < MIN_REPEAT_MS) return;
    lastReported.set(key, now);
    const report = collectVideoRecordingDiagnostic(errorCode, profile, extra);
    void sendVideoRecordingDiagnostic(initData, report).catch(() => {
      // Telemetry is best-effort; recording and UI errors must remain independent.
    });
  } catch {
    // Browser capabilities can throw in restricted WebViews; do not affect recording.
  }
}
