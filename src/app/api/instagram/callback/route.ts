import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { verifyState } from '~/lib/crypto';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('ig-callback');

function back(path: string): Response {
  return NextResponse.redirect(new URL(path, env().APP_URL));
}

/**
 * GET /api/instagram/callback
 *
 * مراحل ۲ تا ۶ از Business Login:
 *   ۲) code → short-lived token
 *   ۳) short-lived → long-lived (۶۰ روز)
 *   ۴) ذخیرهٔ امن توکن (AES-256-GCM)
 *   ۵) دریافت اطلاعات حساب متصل (/me)
 *   ۶) subscribe کردن webhook fields برای این حساب
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorReason = url.searchParams.get('error_reason');

  // کاربر دسترسی را رد کرد
  if (errorParam) {
    log.info('کاربر مجوز را رد کرد', { errorParam, errorReason });
    return back(`/instagram?error=access_denied&reason=${encodeURIComponent(errorReason ?? errorParam)}`);
  }

  // callback نامعتبر
  if (!code || !state) {
    log.warn('callback نامعتبر — code یا state موجود نیست');
    return back('/instagram?error=invalid_callback');
  }

  const claims = verifyState<{ uid?: string; purpose?: string }>(state);
  if (!claims?.uid || claims.purpose !== 'ig_connect') {
    log.warn('state نامعتبر یا منقضی — احتمال CSRF');
    return back('/instagram?error=invalid_state');
  }
  const userId = claims.uid;

  const { igClient, repos, tokens } = await getContainer();

  try {
    // ۲) code → short-lived
    const shortLived = await igClient.exchangeCodeForToken(code);

    // ۳) short-lived → long-lived (۶۰ روز)
    let accessToken = shortLived.accessToken;
    let expiresIn = 3600;
    let tokenType: 'short_lived' | 'long_lived' = 'short_lived';
    try {
      const longLived = await igClient.exchangeForLongLivedToken(shortLived.accessToken);
      accessToken = longLived.accessToken;
      expiresIn = longLived.expiresInSeconds;
      tokenType = 'long_lived';
    } catch (e) {
      log.warn('تبدیل به توکن بلندمدت ناموفق بود — با توکن کوتاه‌مدت ادامه می‌دهیم', {
        error: (e as Error).message,
      });
    }

    // ۵) اطلاعات حساب
    const profile = await igClient.getMe(accessToken);

    const account = await repos.accounts.upsert({
      userId,
      igUserId: profile.id,
      username: profile.username,
      name: profile.name ?? null,
      accountType: profile.account_type ?? 'BUSINESS',
      profilePictureUrl: profile.profile_picture_url ?? null,
      followersCount: profile.followers_count ?? 0,
      mediaCount: profile.media_count ?? 0,
      scopes: shortLived.permissions.length ? shortLived.permissions : env().igScopes,
    });

    // ۴) ذخیرهٔ امن توکن — هرگز plaintext، هرگز در پاسخ API
    await tokens.store({
      userId,
      instagramAccountId: account.id,
      accessToken,
      scopes: shortLived.permissions.length ? shortLived.permissions : env().igScopes,
      expiresInSeconds: expiresIn,
      tokenType,
    });

    // ۶) فعال‌سازی webhook برای این حساب
    const fields = env().igWebhookFields;
    try {
      const sub = await igClient.subscribeWebhooks(accessToken, profile.id, fields);
      await repos.accounts.setWebhookState(account.id, Boolean(sub.success), fields);
    } catch (e) {
      // اشتراک webhook ممکن است تا قبل از Advanced Access شکست بخورد — اتصال را باطل نمی‌کنیم
      await repos.accounts.setWebhookState(account.id, false, fields, (e as Error).message);
      log.warn('اشتراک Webhook ناموفق بود (احتمالاً نیازمند Advanced Access)', {
        error: (e as Error).message,
      });
    }

    await repos.users.markOnboarded(userId);
    await repos.audit.log({
      userId,
      action: 'instagram.connect.success',
      entityType: 'instagram_account',
      entityId: account.id,
      metadata: { username: profile.username, accountType: profile.account_type },
    });

    log.info('حساب اینستاگرام متصل شد', { userId, username: profile.username });
    return back('/instagram?connected=1');
  } catch (e) {
    const message = (e as Error).message;
    log.error('اتصال اینستاگرام ناموفق بود', { error: message });
    await repos.audit.log({ userId, action: 'instagram.connect.failed', metadata: { error: message } });
    return back(`/instagram?error=exchange_failed&message=${encodeURIComponent(message.slice(0, 140))}`);
  }
}
