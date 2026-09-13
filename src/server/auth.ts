import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Repositories } from '~/infra/db/repositories';
import { env } from '~/lib/env';
import { hashPassword, verifyPassword } from '~/lib/crypto';

export const SESSION_COOKIE = 'igflow_session';

export interface SessionClaims {
  sub: string; // user id
  email: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_JWT_SECRET);
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('igflow')
    .setAudience('igflow-dashboard')
    .setExpirationTime(`${env().AUTH_SESSION_TTL_HOURS}h`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'igflow', audience: 'igflow-dashboard' });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}

/** کوکی امن: httpOnly + SameSite=Lax + Secure (در production) — نه localStorage */
export function sessionCookieOptions() {
  const e = env();
  // در حالت cross-site (داشبورد داخل iframe از دامنهٔ دیگر) مرورگر کوکیِ Lax را
  // ارسال نمی‌کند؛ تنها ترکیب پذیرفته‌شده `SameSite=None` همراه با `Secure` است.
  //
  // ⚠️ اما این هم کافی نیست: مرورگرهای امروزی کوکی «شخص‌ثالث» را در iframe
  // مسدود می‌کنند. راه‌حل استاندارد، ویژگی `Partitioned` (CHIPS) است که کوکی را
  // به کلید پارتیشن سایت میزبان گره می‌زند و آن را از مسدودسازی مستثنا می‌کند.
  const crossSite = e.AUTH_COOKIE_CROSS_SITE;
  return {
    httpOnly: true as const,
    sameSite: crossSite ? ('none' as const) : ('lax' as const),
    secure: crossSite || e.isProd,
    ...(crossSite ? { partitioned: true as const } : {}),
    path: '/',
    maxAge: e.AUTH_SESSION_TTL_HOURS * 3600,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}

/** کاربر جاری از روی کوکی — پایهٔ همهٔ بررسی‌های Tenant Isolation */
export async function getCurrentUser(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * کاربر جاری یا هدایت به صفحهٔ ورود.
 * در Server Component ها باید redirect کند، نه throw — وگرنه کاربرِ بدون سشن
 * به‌جای دیدن فرم ورود، صفحهٔ خطای ۵۰۰ می‌بیند.
 */
export async function requireUser(): Promise<SessionClaims> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('احراز هویت لازم است');
    this.name = 'UnauthorizedError';
  }
}

/* ── ثبت‌نام / ورود ── */

export async function registerUser(
  repos: Repositories,
  data: { email: string; password: string; fullName?: string },
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const existing = await repos.users.findByEmail(data.email);
  if (existing) return { ok: false, error: 'این ایمیل قبلاً ثبت شده است' };
  const user = await repos.users.create({
    email: data.email,
    passwordHash: hashPassword(data.password),
    fullName: data.fullName,
  });
  return { ok: true, userId: user.id };
}

export async function authenticate(
  repos: Repositories,
  email: string,
  password: string,
): Promise<{ ok: true; userId: string; email: string } | { ok: false; error: string }> {
  const user = await repos.users.findByEmail(email);
  // پیام یکسان برای جلوگیری از user enumeration
  const genericError = { ok: false as const, error: 'ایمیل یا رمز عبور نادرست است' };
  if (!user) {
    // مقایسهٔ ساختگی برای یکسان نگه‌داشتن زمان پاسخ
    verifyPassword(password, hashPassword('dummy-password-for-timing'));
    return genericError;
  }
  if (!verifyPassword(password, user.password_hash)) return genericError;
  return { ok: true, userId: user.id, email: user.email };
}
