import { NextResponse, after } from 'next/server';
import { getContainer } from '~/server/container';
import { env } from '~/lib/env';
import { verifyWebhookSignature } from '~/lib/crypto';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// پردازش درون‌خطی (حالت سرورلس) بعد از ارسال پاسخ ادامه دارد و به تماس شبکه‌ای
// با Instagram API نیاز دارد. پیش‌فرض ۱۰ ثانیهٔ Vercel برای آن کم است.
export const maxDuration = 60;

const log = createLogger('webhook-route');

/**
 * ════════════════════════════════════════════════════════════
 *  GET /api/webhooks/instagram — Verification Request
 * ════════════════════════════════════════════════════════════
 * متا هنگام پیکربندی Webhook یک GET با hub.mode/hub.verify_token/hub.challenge می‌فرستد.
 * باید hub.challenge را عیناً برگردانیم (اگر توکن درست بود).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === env().IG_WEBHOOK_VERIFY_TOKEN && challenge) {
    log.info('تأیید Webhook موفق بود');
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }

  log.warn('تأیید Webhook ناموفق', { mode, hasToken: Boolean(token) });
  return new Response('Forbidden', { status: 403 });
}

/**
 * ════════════════════════════════════════════════════════════
 *  POST /api/webhooks/instagram — Event Notification
 * ════════════════════════════════════════════════════════════
 * ⚠️ قانون رسمی: باید در کمتر از ۵ ثانیه پاسخ ۲۰۰ بدهیم.
 * بنابراین اینجا فقط: verify signature → store → enqueue.
 * هیچ تماس با Instagram API و هیچ اجرای Automation در این مسیر نیست.
 */
export async function POST(request: Request): Promise<Response> {
  // RAW BODY — امضا باید روی بایت‌های خام محاسبه شود، نه JSON دوباره سریالایز شده
  const raw = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');

  const signatureValid = verifyWebhookSignature(raw, signatureHeader, env().IG_APP_SECRET);

  if (env().WEBHOOK_SIGNATURE_REQUIRED && !signatureValid) {
    log.warn('امضای Webhook نامعتبر — درخواست رد شد');
    return new Response('Invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    log.warn('بدنهٔ Webhook JSON معتبر نیست');
    // ۲۰۰ برمی‌گردانیم تا متا بی‌جهت ۳۶ ساعت retry نکند
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  try {
    const { processor } = await getContainer();
    const result = await processor.ingest(body as never, signatureValid);
    log.info('رویدادهای Webhook دریافت شد', {
      accepted: result.accepted,
      duplicates: result.duplicates,
    });

    // ── حالت سرورلس (Vercel) ───────────────────────────────────────
    // روی Vercel هیچ پروسهٔ دائمی‌ای وجود ندارد که Worker را اجرا کند، پس
    // صف هرگز تخلیه نمی‌شود و رویدادها بی‌صدا در دیتابیس می‌مانند.
    //
    // `after()` کار را *بعد از* بسته‌شدن پاسخ اجرا می‌کند؛ یعنی متا همچنان
    // ۲۰۰ خود را در کمتر از ۵ ثانیه می‌گیرد و مهلت رسمی نقض نمی‌شود.
    //
    // اگر Worker جداگانه دارید، `INLINE_WEBHOOK_PROCESSING=false` بگذارید تا
    // رویداد دوبار پردازش نشود (هرچند idempotency خودش جلوی ارسال تکراری را
    // می‌گیرد).
    if (env().serverless && result.eventIds.length > 0) {
      after(async () => {
        for (const id of result.eventIds) {
          try {
            await processor.process(id);
          } catch (e) {
            log.error('پردازش درون‌خطی رویداد ناموفق بود', {
              webhookEventId: id,
              error: (e as Error).message,
            });
          }
        }
      });
    }

    return NextResponse.json({ ok: true, accepted: result.accepted, duplicates: result.duplicates }, { status: 200 });
  } catch (e) {
    log.error('خطا در دریافت Webhook', { error: (e as Error).message });
    // فقط بعد از ذخیرهٔ پایدار می‌توانیم ۲۰۰ بدهیم. در خطای DB/صف، پاسخ 503
    // باعث می‌شود Meta رویداد را دوباره بفرستد؛ idempotency تکرار را بی‌خطر می‌کند.
    // پاسخ ۲۰۰ در این نقطه مساوی از دست رفتن غیرقابل‌بازیابی رویداد است.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
