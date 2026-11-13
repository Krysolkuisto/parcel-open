import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '../domain.js';

export type FetchLike = typeof fetch;

export interface HttpResult {
  status: number;
  body: unknown;
}

/** JSON request with a timeout. Network failures and 429/5xx become retryable ProviderErrors. */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown },
  timeoutMs = 15_000,
): Promise<HttpResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(`Network error: ${(err as Error).message}`, true);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderError(`Provider unavailable (HTTP ${res.status})`, true, res.status);
  }
  return { status: res.status, body };
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacSha256Base64(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64');
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Narrow helpers for reading loosely typed provider JSON. */
export type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Json => (isObj(v) ? v : {});

export function joinParts(...parts: unknown[]): string | null {
  const out = parts.map(str).filter((p): p is string => p !== null);
  return out.length ? out.join(', ') : null;
}

export function toIso(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
