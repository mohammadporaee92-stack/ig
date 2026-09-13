import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('cron-maintenance');

/**
 * ════════════════════════════════════════════════════════════════
 *  GET /api/cron/maintenance — نگهداری روزانه
 * ════════════════════════════════════════════════════════════════
 * در استقرار سرورلس (Vercel) هیچ پروسهٔ دائمی‌ای وجود ندارد، پس کارهایی که
 * worker به‌صورت زمان‌بندی‌شده انجام می‌داد باید از بیرون فراخوانی شوند:
 *
 *   ۱) تازه‌سازی توکن‌های نزدیک به انقضا — توکن بلندمدت اینستاگرام ۶۰ روز
 *      اعتبار دارد و اگر تمدید نشود، اتصال کاربر **بی‌صدا** قطع می‌شود.
 *
 *   ۲) پردازش رویدادهایی که در صف مانده‌اند — تور ایمنی برای حالتی که
 *      پردازش درون‌خطی (`after()`) به هر دلیلی ناتمام مانده باشد.
 *
 * امنیت: Vercel هدر `Authorization: Bearer $CRON_SECRET` را خودکار ارسال
 * می‌کند. اگر `CRON_SECRET` تعریف شده باشد، درخواست بدون آن رد می‌شود تا
 * کسی نتواند این مسیر را از بیرون صدا بزند.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      log.warn('درخواست cron بدون مجوز رد شد');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const { tokens, repos, processor } = await getContainer();
  const summary: Record<string, unknown> = {};

  // ۱) تازه‌سازی توکن‌ها
  try {
    summary.tokens = await tokens.refreshExpiring(7);
  } catch (e) {
    log.error('تازه‌سازی توکن ناموفق بود', { error: (e as Error).message });
    summary.tokensError = (e as Error).message;
  }

  // ۲) رویدادهای جامانده
  try {
    const stuck = await repos.webhooks.listStuck(25);
    let processed = 0;
    for (const row of stuck) {
      try {
        await processor.process(row.id);
        processed++;
      } catch (e) {
        log.error('پردازش رویداد جامانده ناموفق بود', {
          webhookEventId: row.id,
          error: (e as Error).message,
        });
      }
    }
    summary.stuckFound = stuck.length;
    summary.stuckProcessed = processed;
  } catch (e) {
    log.error('بازیابی رویدادهای جامانده ناموفق بود', { error: (e as Error).message });
    summary.stuckError = (e as Error).message;
  }

  log.info('نگهداری روزانه انجام شد', summary);
  return NextResponse.json({ ok: true, ...summary });
}
