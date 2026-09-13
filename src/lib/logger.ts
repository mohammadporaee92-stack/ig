import { env } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** کلیدهایی که هرگز نباید در لاگ ظاهر شوند */
const SENSITIVE_KEYS = [
  'access_token',
  'accesstoken',
  'accessToken',
  'access_token_enc',
  'password',
  'password_hash',
  'client_secret',
  'app_secret',
  'authorization',
  'cookie',
  'token',
  'code',
  'secret',
  'signature',
];

const TOKEN_PATTERNS: RegExp[] = [
  /\b(IG|EAA)[A-Za-z0-9_\-]{20,}\b/g, // توکن‌های متا
  /\bv1\.[A-Za-z0-9+/=]{10,}\.[A-Za-z0-9+/=]{10,}\.[A-Za-z0-9+/=]{10,}/g, // توکن رمزشدهٔ ما
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const re of TOKEN_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase() === s.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level: Level, scope: string, msg: string, data?: unknown): void {
  let min = ORDER.info;
  try {
    min = ORDER[env().LOG_LEVEL];
  } catch {
    /* env هنوز بارگذاری نشده */
  }
  if (ORDER[level] < min) return;
  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
  };
  if (data !== undefined) line.data = redact(data);
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => emit('debug', scope, m, d),
    info: (m, d) => emit('info', scope, m, d),
    warn: (m, d) => emit('warn', scope, m, d),
    error: (m, d) => emit('error', scope, m, d),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}

export const logger = createLogger('igflow');
