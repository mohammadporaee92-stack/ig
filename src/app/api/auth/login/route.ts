import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { authenticate, createSessionToken, registerUser, setSessionCookie, sessionCookieOptions, SESSION_COOKIE } from '~/server/auth';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('auth-login');

const schema = z.object({
  email: z.string().email('ایمیل معتبر وارد کنید'),
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
  fullName: z.string().max(120).optional(),
  mode: z.enum(['login', 'register']).default('login'),
});

/**
 * ریدایرکت با مسیر **نسبی**.
 *
 * ⚠️ عمداً از `NextResponse.redirect()` استفاده نمی‌کنیم، چون آن تابع یک URL
 * مطلق می‌خواهد و ما مجبور می‌شویم میزبان را از روی هدرها حدس بزنیم. هر حدسِ
 * اشتباه (مثلاً `0.0.0.0:3000`، یا میزبان داخلیِ پراکسی) یعنی مرورگر به آدرسی
 * فرستاده می‌شود که وجود ندارد یا از دید iframe بین‌دامنه‌ای است — و ناوبری
 * بی‌صدا رها می‌شود؛ دقیقاً همان حالتی که دکمه روی «در حال پردازش…» قفل می‌ماند.
 *
 * طبق RFC 7231 مقدار `Location` می‌تواند نسبی باشد و مرورگر آن را نسبت به
 * آدرسِ واقعیِ نوار نشانی خودش حل می‌کند. پس هیچ حدسی لازم نیست و همه‌جا
 * (localhost، پیش‌نمایش e2b، پشت هر پراکسی، داخل iframe) درست کار می‌کند.
 */
function redirectTo(path: string, cookie?: { token: string }): NextResponse {
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: path },
  });
  if (cookie) res.cookies.set(SESSION_COOKIE, cookie.token, sessionCookieOptions());
  return res;
}

/**
 * پشتیبانی از دو حالت ارسال:
 *
 *  ۱. `application/x-www-form-urlencoded` — ارسال فرم کلاسیک (بدون JS).
 *     پاسخ یک ریدایرکت است، یعنی ناوبری سطح بالا. این تنها روشی است که کوکی
 *     در آن توسط سیاست «کوکی شخص‌ثالث» مرورگر مسدود نمی‌شود.
 *
 *  ۲. `application/json` — فراخوانی از طریق fetch (برای مصرف‌کنندگان برنامه‌نویسی).
 */
export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  const isForm =
    contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');

  let raw: Record<string, unknown>;
  if (isForm) {
    const fd = await request.formData();
    raw = Object.fromEntries(fd.entries());
  } else {
    raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const fail = (message: string, status: number): Response => {
    if (isForm) {
      const qs = new URLSearchParams({ error: message });
      if (raw.mode === 'register') qs.set('mode', 'register');
      return redirectTo(`/login?${qs.toString()}`);
    }
    return NextResponse.json({ error: message }, { status });
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'ورودی نامعتبر', 422);
  }

  const { email, password, fullName, mode } = parsed.data;
  const { repos } = await getContainer();

  const succeed = async (userId: string, userEmail: string): Promise<Response> => {
    const token = await createSessionToken({ sub: userId, email: userEmail });
    if (isForm) return redirectTo('/dashboard', { token });
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, redirect: '/dashboard' });
  };

  if (mode === 'register') {
    const reg = await registerUser(repos, { email, password, fullName });
    if (!reg.ok) return fail(reg.error, 409);
    await repos.audit.log({ userId: reg.userId, action: 'auth.register', ip: request.headers.get('x-forwarded-for') });
    log.info('کاربر جدید ثبت‌نام کرد');
    return succeed(reg.userId, email);
  }

  const auth = await authenticate(repos, email, password);
  if (!auth.ok) {
    log.warn('ورود ناموفق');
    return fail(auth.error, 401);
  }
  await repos.audit.log({ userId: auth.userId, action: 'auth.login', ip: request.headers.get('x-forwarded-for') });
  return succeed(auth.userId, auth.email);
}
