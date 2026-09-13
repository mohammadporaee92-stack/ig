/**
 * Worker — پردازشگر پس‌زمینهٔ IGFlow.
 *   npm run worker
 *
 * چرا جدا از Next.js؟
 *  - Webhook باید در کمتر از ۵ ثانیه پاسخ ۲۰۰ بدهد، وگرنه Meta تا ~۳۶ ساعت
 *    رویداد را دوباره می‌فرستد. پس مسیر HTTP فقط ذخیره + enqueue می‌کند.
 *  - ارسال پیام، بررسی فالو و تلاش مجدد همگی I/O سنگین و زمان‌بر هستند.
 *
 * در حالت production با REDIS_URL از BullMQ استفاده می‌شود (چند worker موازی).
 * بدون REDIS_URL صف درون‌حافظه‌ای است — فقط برای توسعهٔ محلی.
 */
import { getContainer } from '~/server/container';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

const log = createLogger('worker');

interface WebhookJob { webhookEventId: string }
interface ContinueRunJob { runId: string; trigger?: string }

async function main(): Promise<void> {
  const e = env();
  const container = await getContainer();

  if (!e.REDIS_URL) {
    log.warn(
      'REDIS_URL تنظیم نشده — صف درون‌حافظه‌ای فعال است. ' +
        'در این حالت worker جدا معنا ندارد و کارها در همان فرایند Next.js اجرا می‌شوند. ' +
        'برای production حتماً REDIS_URL را تنظیم کنید.',
    );
  }

  log.info('worker در حال راه‌اندازی', {
    queue: container.queue.kind,
    concurrency: e.QUEUE_CONCURRENCY,
    driver: container.db.driver,
  });

  await container.queue.process(async (job) => {
    const started = Date.now();
    try {
      switch (job.name) {
        case 'process-webhook-event': {
          const { webhookEventId } = job.data as unknown as WebhookJob;
          await container.processor.process(webhookEventId);
          break;
        }
        case 'continue-run': {
          const { runId } = job.data as unknown as ContinueRunJob;
          await container.engine.continueRun(runId);
          break;
        }
        case 'retry-run': {
          const { runId } = job.data as unknown as ContinueRunJob;
          await container.engine.retryRun(runId);
          break;
        }
        case 'refresh-tokens': {
          const result = await container.tokens.refreshExpiring(7);
          log.info('تازه‌سازی توکن‌ها انجام شد', result as unknown as Record<string, unknown>);
          break;
        }
        default:
          log.warn('نوع job ناشناخته — نادیده گرفته شد', { name: job.name });
      }
      log.debug('job انجام شد', { name: job.name, ms: Date.now() - started });
    } catch (err) {
      // خطا را دوباره پرتاب می‌کنیم تا صف مکانیزم retry خودش را اجرا کند
      log.error('job ناموفق بود', { name: job.name, error: (err as Error).message, ms: Date.now() - started });
      throw err;
    }
  });

  // زمان‌بند سادهٔ تازه‌سازی توکن — هر ۶ ساعت
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const tokenTimer = setInterval(() => {
    void container.queue
      .enqueue('refresh-tokens', {}, { jobId: `refresh:${new Date().toISOString().slice(0, 13)}` })
      .catch((err: Error) => log.error('زمان‌بندی تازه‌سازی توکن ناموفق بود', { error: err.message }));
  }, SIX_HOURS);
  tokenTimer.unref?.();

  // تور ایمنی پایدار: اگر پروسه/Redis میان ثبت next_retry_at و اجرای job قطع شد،
  // Runهای موعدرسیده از روی دیتابیس دوباره وارد صف می‌شوند.
  const recoverDueRuns = async () => {
    const dueRuns = await container.repos.runs.listDueRetries(100);
    for (const run of dueRuns) {
      await container.queue.enqueue(
        'retry-run',
        { runId: run.id },
        { jobId: `run:${run.id}:due:${run.retry_count}` },
      );
    }
    if (dueRuns.length) log.info('Retryهای موعدرسیده بازیابی شدند', { count: dueRuns.length });
  };
  const retryTimer = setInterval(() => {
    void recoverDueRuns().catch((err: Error) =>
      log.error('بازیابی Retryهای موعدرسیده ناموفق بود', { error: err.message }),
    );
  }, 60_000);
  retryTimer.unref?.();

  // یک بار در ابتدای کار هم اجرا شود
  await container.queue.enqueue('refresh-tokens', {}, { jobId: `refresh:boot:${Date.now()}` });
  await recoverDueRuns();

  log.info('✅ worker آماده است و منتظر کار می‌ماند');

  const shutdown = async (signal: string): Promise<void> => {
    log.info('دریافت سیگنال خاموشی — در حال بستن منابع', { signal });
    clearInterval(tokenTimer);
    clearInterval(retryTimer);
    try {
      await container.queue.close?.();
      await container.db.close();
    } catch (err) {
      log.error('خطا هنگام خاموشی', { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err: Error) => {
  log.error('راه‌اندازی worker ناموفق بود', { error: err.message });
  process.exit(1);
});
