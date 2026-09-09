export type Role = 'coach' | 'client';

export interface AppUser {
  id: number;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isPremium: boolean;
}

export interface MeResponse {
  user: AppUser;
  roles: Role[];
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function apiRequest<T>(initData: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('x-telegram-init-data', initData);
  if (init?.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json<ApiErrorPayload>().catch(() => ({}));
    throw new ApiError(
      response.status,
      payload.error?.message ?? `Request failed with status ${response.status}`,
      payload.error?.code,
    );
  }
  return response.json<T>();
}

export function getMe(initData: string): Promise<MeResponse> {
  return apiRequest(initData, '/api/me');
}

export function addRole(initData: string, role: Role): Promise<MeResponse> {
  return apiRequest(initData, '/api/me/roles', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}
