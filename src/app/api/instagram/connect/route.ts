import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { getCurrentUser } from '~/server/auth';
import { signState } from '~/lib/crypto';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('ig-connect');

/**
 * GET /api/instagram/connect
 *
 * مرحله ۱ از «Business Login for Instagram».
 * کاربر را مستقیم به صفحهٔ رسمی احراز هویت اینستاگرام می‌فرستد.
 *
 * کاربر نیازی ندارد:
 *   ❌ Facebook Page بسازد
 *   ❌ وارد Meta Business Suite شود
 *   ❌ رمز اینستاگرام را در نرم‌افزار ما وارد کند
 *   ❌ Access Token را دستی کپی کند
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', env().APP_URL));
  }

  if (!env().instagramConfigured) {
    return NextResponse.redirect(
      new URL('/instagram?error=not_configured', env().APP_URL),
    );
  }

  const { igClient, repos } = await getContainer();

  // state امضاشده = محافظت CSRF مطابق توصیهٔ رسمی
  const state = signState({ uid: user.sub, purpose: 'ig_connect' });
  const authorizeUrl = igClient.buildAuthorizeUrl(state, {
    forceReauth: new URL(request.url).searchParams.get('force') === '1',
    enableFbLogin: false,
  });

  await repos.audit.log({
    userId: user.sub,
    action: 'instagram.connect.start',
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  });

  log.info('شروع فرآیند اتصال اینستاگرام', { userId: user.sub });
  return NextResponse.redirect(authorizeUrl);
}
