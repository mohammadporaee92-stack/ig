import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { env } from './env';

/* ─────────────────── شناسه‌ها ─────────────────── */

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/* ─────────── رمزنگاری توکن‌ها (AES-256-GCM at rest) ─────────── */

const ENC_VERSION = 'v1';

function key(): Buffer {
  const raw = env().TOKEN_ENCRYPTION_KEY;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    buf = Buffer.from(raw, 'utf8');
  }
  if (buf.length !== 32) {
    // کلید غیراستاندارد → با scrypt به ۳۲ بایت می‌رسانیم (هرگز throw نکن تا اپ down نشود،
    // ولی در production باید کلید صحیح ۳۲ بایتی base64 داده شود).
    buf = scryptSync(raw, 'igflow-token-key', 32);
  }
  return buf;
}

/** خروجی: v1.<iv_b64>.<tag_b64>.<ciphertext_b64> — هرگز plaintext ذخیره نمی‌شود */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) {
    throw new Error('فرمت مقدار رمزنگاری‌شده نامعتبر است');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/* ─────────── رمز عبور کاربران SaaS (scrypt) ─────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] as string, 'hex');
  const expected = Buffer.from(parts[2] as string, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* ─────────── امضای Webhook متا (X-Hub-Signature-256) ─────────── */

/**
 * اعتبارسنجی امضای رویداد وب‌هوک.
 * ⚠️ حتماً باید روی RAW BODY انجام شود، نه JSON.parse شده.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), 'hex');
  const expected = createHmac('sha256', appSecret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/* ─────────── state امضاشده برای OAuth (ضد CSRF) ─────────── */

export function signState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: randomBytes(8).toString('hex') };
  const b64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = createHmac('sha256', env().AUTH_JWT_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string): T | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts as [string, string];
  const expected = createHmac('sha256', env().AUTH_JWT_SECRET).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { exp?: number };
    if (typeof body.exp === 'number' && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body as T;
  } catch {
    return null;
  }
}

/* ─────────── signed_request متا (Deauthorize / Data Deletion) ─────────── */

export interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

/**
 * اعتبارسنجی و رمزگشایی `signed_request` که Meta به callbackهای
 * Deauthorize و Data Deletion ارسال می‌کند.
 *
 * قالب: `<base64url(signature)>.<base64url(json payload)>`
 * امضا = HMAC-SHA256 روی بخش payload با App Secret.
 *
 * ⚠️ بدون این بررسی، هر کسی می‌تواند درخواست حذف دادهٔ جعلی بفرستد.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): SignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null;

  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, encodedPayload] = parts as [string, string];

  let provided: Buffer;
  try {
    provided = Buffer.from(encodedSig, 'base64url');
  } catch {
    return null;
  }

  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as SignedRequestPayload;
    // Meta فقط HMAC-SHA256 استفاده می‌کند؛ هر چیز دیگری مشکوک است
    if (payload.algorithm && payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    return payload;
  } catch {
    return null;
  }
}
