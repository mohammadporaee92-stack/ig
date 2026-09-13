import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { parseSignedRequest } from '~/lib/crypto';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('ig-deauthorize');

/**
 * POST /api/instagram/deauthorize
 *
 * وقتی کاربر دسترسی اپ را از داخل خود اینستاگرام لغو می‌کند، Meta این
 * callback را صدا می‌زند. ثبت این آدرس در App Dashboard **الزامی** است
 * (بدون آن App Review رد می‌شود).
 *
 * بدنه: `signed_request` به‌صورت form-urlencoded.
 * محتوا: `{ user_id: "<IGSID مالک حساب>", issued_at, algorithm }`
 *
 * ⚠️ نکتهٔ مهم: توکن در این لحظه از سمت Meta باطل شده است. پس تلاش برای
 *    فراخوانی API (مثلاً unsubscribe وبهوک) بی‌فایده است و فقط خطا می‌دهد.
 *    صرفاً وضعیت محلی را پاک‌سازی می‌کنیم.
 */
export async function POST(request: Request): Promise<Response> {
  const appSecret = env().IG_APP_SECRET;

  let signedRequest: string | null = null;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { signed_request?: string };
      signedRequest = body.signed_request ?? null;
    } else {
      const fd = await request.formData();
      const v = fd.get('signed_request');
      signedRequest = typeof v === 'string' ? v : null;
    }
  } catch {
    signedRequest = null;
  }

  if (!signedRequest) {
    log.warn('درخواست بدون signed_request');
    return NextResponse.json({ error: 'signed_request الزامی است' }, { status: 400 });
  }

  const payload = parseSignedRequest(signedRequest, appSecret);
  if (!payload?.user_id) {
    log.warn('امضای نامعتبر در deauthorize — نادیده گرفته شد');
    return NextResponse.json({ error: 'امضای نامعتبر' }, { status: 403 });
  }

  const igUserId = String(payload.user_id);
  const { repos } = await getContainer();

  // یک IGSID ممکن است نظرياً به چند مستأجر وصل باشد؛ همه را پاک‌سازی می‌کنیم.
  const accounts = await repos.accounts.findByIgUserId(igUserId);

  for (const account of accounts) {
    await repos.tokens.deleteByAccount(account.id);
    await repos.accounts.setStatus(account.user_id, account.id, 'disconnected', 'کاربر دسترسی را از اینستاگرام لغو کرد');
    await repos.accounts.setWebhookState(account.id, false, []);

    // اتوماسیون‌های وابسته دیگر نباید اجرا شوند
    await repos.db.query(
      `UPDATE automations SET status='disabled', updated_at=now()
       WHERE user_id=$1 AND instagram_account_id=$2 AND status='active'`,
      [account.user_id, account.id],
    );

    await repos.audit.log({
      userId: account.user_id,
      action: 'instagram.deauthorize',
      entityType: 'instagram_account',
      entityId: account.id,
    });
  }

  log.info('لغو دسترسی پردازش شد', { accounts: accounts.length });

  // Meta فقط انتظار پاسخ ۲۰۰ دارد
  return NextResponse.json({ ok: true });
}
