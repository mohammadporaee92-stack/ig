import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { authenticate, createSessionToken, sessionCookieOptions, SESSION_COOKIE } from '~/server/auth';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('auth-magic');

/** ریدایرکت با مسیر نسبی — بدون هیچ حدسی دربارهٔ میزبان. */
function redirectTo(path: string, cookie?: { token: string }): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { location: path } });
  if (cookie) res.cookies.set(SESSION_COOKIE, cookie.token, sessionCookieOptions());
  return res;
}

/**
 * GET /api/auth/magic?email=…&password=…&next=/dashboard
 *
 * ورود از طریق **ناوبری سطح بالا** به‌جای fetch.
 *
 * چرا لازم است؟ وقتی داشبورد داخل iframe از دامنهٔ دیگری نمایش داده می‌شود،
 * مرورگر کوکیِ پاسخِ `fetch` را به‌عنوان «کوکی شخص‌ثالث» مسدود می‌کند.
 * اما کوکی‌ای که در یک **ناوبری کامل صفحه** ست شود همان محدودیت را ندارد.
 *
 * ⚠️ فقط برای محیط توسعه/پیش‌نمایش؛ در production غیرفعال است، چون اعتبارنامه
 *    در query string قرار می‌گیرد (در تاریخچه و لاگ ظاهر می‌شود).
 */
export async function GET(request: Request): Promise<Response> {
  if (env().isProd) {
    return NextResponse.json({ error: 'این مسیر در production غیرفعال است' }, { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email') ?? 'demo@igflow.app';
  const password = url.searchParams.get('password') ?? 'demo12345';
  const next = url.searchParams.get('next') ?? '/dashboard';

  // جلوگیری از open redirect
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  const { repos } = await getContainer();
  const auth = await authenticate(repos, email, password);

  if (!auth.ok) {
    log.warn('ورود magic ناموفق');
    return redirectTo('/login?error=' + encodeURIComponent('ایمیل یا رمز عبور نادرست است'));
  }

  const token = await createSessionToken({ sub: auth.userId, email: auth.email });
  await repos.audit.log({ userId: auth.userId, action: 'auth.login.magic' });
  log.info('ورود magic موفق');
  return redirectTo(target, { token });
}
