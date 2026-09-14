export type StartupLogLevel = 'info' | 'success' | 'error';

export interface StartupLogEntry {
  id: number;
  elapsedMs: number;
  level: StartupLogLevel;
  message: string;
}

type StartupLogListener = () => void;

const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
const listeners = new Set<StartupLogListener>();
let nextEntryId = 1;
let entries: readonly StartupLogEntry[] = [];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function logStartup(message: string, level: StartupLogLevel = 'info'): void {
  entries = [
    ...entries,
    {
      id: nextEntryId,
      elapsedMs: Math.max(0, now() - startedAt),
      level,
      message,
    },
  ];
  nextEntryId += 1;
  listeners.forEach((listener) => listener());
}

export async function trackStartupStep<T>(label: string, work: () => Promise<T>): Promise<T> {
  logStartup(`${label}: загрузка`);
  try {
    const result = await work();
    logStartup(`${label}: готово`, 'success');
    return result;
  } catch (error) {
    logStartup(`${label}: ошибка — ${errorMessage(error)}`, 'error');
    throw error;
  }
}

export function getStartupLogSnapshot(): readonly StartupLogEntry[] {
  return entries;
}

export function subscribeStartupLog(listener: StartupLogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatStartupLogEntry(entry: StartupLogEntry): string {
  return `[+${(entry.elapsedMs / 1000).toFixed(2)}s] ${entry.message}`;
}
