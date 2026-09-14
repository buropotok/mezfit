export interface BootDiagnosticDetails {
  timeoutMs?: number;
  httpStatus?: number;
  reason?: string;
  errorName?: string;
}

export interface BootDiagnosticPayload {
  sessionId: string;
  stage: string;
  lastStage: string;
  elapsedMs: number;
  path: string;
  userAgent: string;
  online: boolean | null;
  telegram: {
    available: boolean;
    version: string | null;
    platform: string | null;
  };
  details?: BootDiagnosticDetails;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function isStage(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function parseDetails(value: unknown): BootDiagnosticDetails | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const allowed = new Set(['timeoutMs', 'httpStatus', 'reason', 'errorName']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;

  const details: BootDiagnosticDetails = {};
  if (value.timeoutMs !== undefined) {
    if (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 0 || Number(value.timeoutMs) > 120000) return null;
    details.timeoutMs = Number(value.timeoutMs);
  }
  if (value.httpStatus !== undefined) {
    if (!Number.isInteger(value.httpStatus) || Number(value.httpStatus) < 100 || Number(value.httpStatus) > 599) return null;
    details.httpStatus = Number(value.httpStatus);
  }
  if (value.reason !== undefined) {
    const reason = boundedString(value.reason, 64);
    if (reason === null) return null;
    details.reason = reason;
  }
  if (value.errorName !== undefined) {
    const errorName = boundedString(value.errorName, 64);
    if (errorName === null) return null;
    details.errorName = errorName;
  }
  return details;
}

export function parseBootDiagnosticPayload(value: unknown): BootDiagnosticPayload | null {
  if (!isRecord(value)) return null;
  const sessionId = boundedString(value.sessionId, 64);
  const path = boundedString(value.path, 120);
  const userAgent = boundedString(value.userAgent, 400);
  if (!sessionId || !/^[a-z0-9-]{8,64}$/i.test(sessionId)) return null;
  if (!isStage(value.stage) || !isStage(value.lastStage)) return null;
  if (!Number.isInteger(value.elapsedMs) || Number(value.elapsedMs) < 0 || Number(value.elapsedMs) > 600000) return null;
  if (path === null || !path.startsWith('/')) return null;
  if (userAgent === null) return null;
  if (value.online !== null && typeof value.online !== 'boolean') return null;
  if (!isRecord(value.telegram) || typeof value.telegram.available !== 'boolean') return null;

  const version = value.telegram.version === null ? null : boundedString(value.telegram.version, 32);
  const platform = value.telegram.platform === null ? null : boundedString(value.telegram.platform, 32);
  if (version === null && value.telegram.version !== null) return null;
  if (platform === null && value.telegram.platform !== null) return null;

  const details = parseDetails(value.details);
  if (details === null) return null;

  return {
    sessionId,
    stage: value.stage,
    lastStage: value.lastStage,
    elapsedMs: Number(value.elapsedMs),
    path,
    userAgent,
    online: value.online,
    telegram: {
      available: value.telegram.available,
      version,
      platform,
    },
    ...(details ? { details } : {}),
  };
}
