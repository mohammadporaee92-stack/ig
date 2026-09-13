import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { parseSignedRequest, newId } from '~/lib/crypto';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('ig-data-deletion');

function resolveOrigin(request: Request): string {
  const h = request.headers;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : env().APP_URL;
}

/**
 * POST /api/instagram/data-deletion
 *
 * درخواست حذف داده طبق الزام Meta (و GDPR). ثبت این آدرس در App Dashboard
 * **الزامی** است و یکی از رایج‌ترین دلایل رد شدن App Review، نبود یا خراب
 * بودن همین endpoint است.
 *
 * قالب پاسخ **دقیقاً** باید این دو فیلد را داشته باشد، وگرنه Meta آن را
 * شکسته تلقی می‌کند:
 *
 * ```json
 * { "url": "https://…/data-deletion?code=…", "confirmation_code": "…" }
 * ```
 *
 * `url` باید صفحه‌ای باشد که کاربر بتواند وضعیت درخواست را ببیند.
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
    return NextResponse.json({ error: 'signed_request الزامی است' }, { status: 400 });
  }

  const payload = parseSignedRequest(signedRequest, appSecret);
  if (!payload?.user_id) {
    log.warn('امضای نامعتبر در data-deletion');
    return NextResponse.json({ error: 'امضای نامعتبر' }, { status: 403 });
  }

  const igUserId = String(payload.user_id);
  const confirmationCode = newId('del').replace(/^del_/, '');
  const { repos } = await getContainer();

  const accounts = await repos.accounts.findByIgUserId(igUserId);

  for (const account of accounts) {
    // تمام جداول وابسته با ON DELETE CASCADE به instagram_accounts وصل‌اند
    // (oauth_tokens, automations, automation_runs, run_events, message_logs,
    //  instagram_users, instagram_posts, instagram_comments).
    // پس یک DELETE روی حساب، کل زنجیره را به‌صورت اتمیک پاک می‌کند.
    // حذف دستی جدول‌به‌جدول هم زائد است و هم ریسک جا ماندن رکورد دارد.
    await repos.db.query(`DELETE FROM instagram_accounts WHERE id = $1`, [account.id]);

    await repos.audit.log({
      userId: account.user_id,
      action: 'instagram.data_deletion',
      entityType: 'instagram_account',
      entityId: account.id,
      metadata: { confirmationCode },
    });
  }

  log.info('درخواست حذف داده اجرا شد', { accounts: accounts.length, confirmationCode });

  const origin = resolveOrigin(request);
  return NextResponse.json({
    url: `${origin}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
