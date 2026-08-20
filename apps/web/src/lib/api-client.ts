'use client';

import { apiErrorSchema, type ApiError } from '@everlast/contracts';
import { createClient } from './supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Thrown for every non-2xx API response. `code` is the stable identifier the
 * UI translates; `message` is only a fallback for codes we have no copy for.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  static async fromResponse(response: Response): Promise<ApiRequestError> {
    let body: ApiError | null = null;
    try {
      body = apiErrorSchema.parse(await response.json());
    } catch {
      body = null;
    }

    return new ApiRequestError(
      response.status,
      body?.code ?? `http.${response.status}`,
      body?.message ?? response.statusText,
      body?.requestId,
      body?.details,
    );
  }
}

/**
 * The access token is read fresh for every call rather than captured once.
 * Supabase rotates it roughly hourly, and a long-lived tab that cached the
 * first token would start 401-ing after an hour.
 */
const authHeader = async (): Promise<Record<string, string>> => {
  const {
    data: { session },
  } = await createClient().auth.getSession();

  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  locale?: string;
}

export const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = 'GET', body, signal, locale } = options;

  const response = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      ...(await authHeader()),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(locale ? { 'Accept-Language': locale } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
    // Bearer auth, never cookies — see the CORS note in the API bootstrap.
    credentials: 'omit',
    cache: 'no-store',
  });

  if (!response.ok) throw await ApiRequestError.fromResponse(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
};

/** Multipart upload; the browser sets its own boundary so we must not. */
export const apiUpload = async <T>(path: string, file: File): Promise<T> => {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
    credentials: 'omit',
  });

  if (!response.ok) throw await ApiRequestError.fromResponse(response);
  return (await response.json()) as T;
};

/**
 * Opens the SSE answer stream. `fetch` is used rather than `EventSource`
 * because the question goes in a POST body and needs an Authorization header,
 * neither of which `EventSource` supports.
 */
export const apiStream = async (
  path: string,
  body: unknown,
  options: { signal: AbortSignal; locale: string },
): Promise<Response> => {
  const response = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: {
      ...(await authHeader()),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Language': options.locale,
    },
    body: JSON.stringify(body),
    signal: options.signal,
    credentials: 'omit',
  });

  if (!response.ok) throw await ApiRequestError.fromResponse(response);
  return response;
};
