export type LocalTime = string;

export interface LocalTimeParts {
  hour: number;
  minute: number;
}

const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseLocalTime(value: LocalTime): LocalTimeParts | null {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

export function formatLocalTime(hour: number, minute: number): LocalTime {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
