import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '~/lib/env';
import { verifyZernioWebhookSignature } from '~/lib/crypto';
import { createLogger } from '~/lib/logger';
import { getContainer } from '~/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const log = createLogger('zernio-webhook');

/**
 * رویداد Zernio فقط برای audit/observability ذخیره می‌شود. اجرای پاسخ با
 * Comment Automation خود Zernio است؛ فرستادن رویداد به موتور محلی پاسخ
 * تکراری ایجاد می‌کند.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = env().ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    log.error('ZERNIO_WEBHOOK_SECRET تنظیم نشده است');
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  const signatureValid = verifyZernioWebhookSignature(
    raw,
    request.headers.get('x-zernio-signature'),
    secret,
  );
  if (!signatureValid) {
    log.warn('امضای Webhook زرنيو نامعتبر است');
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  const eventType = stringValue(request.headers.get('x-zernio-event')) || stringValue(payload.event) || 'unknown';
  const providerEventId = stringValue(request.headers.get('x-zernio-event-id'))
    || stringValue(payload.id)
    || createHash('sha256').update(raw).digest('hex');
  const providerAccountId = accountIdFrom(payload);

  try {
    const { repos } = await getContainer();
    const stored = await repos.webhooks.store({
      platform: 'zernio',
      providerEventId,
      eventType,
      igUserId: providerAccountId || null,
      payload,
      signatureValid,
    });
    if (stored.duplicate) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }

    if (providerAccountId) {
      const accounts = await repos.accounts.findByProviderAccountId('zernio', providerAccountId);
      for (const account of accounts) {
        await repos.webhooks.attachTenant(stored.row.id, account.user_id);
        await repos.accounts.setWebhookState(account.id, true, ['zernio-signed-events']);
        if (eventType === 'account.disconnected') {
          await repos.accounts.setStatus(account.user_id, account.id, 'needs_reauth', 'اتصال حساب در Zernio قطع شده است');
        }
      }
    }

    await repos.webhooks.setStatus(stored.row.id, 'processed');
    return NextResponse.json({ ok: true, accepted: 1 }, { status: 200 });
  } catch (error) {
    log.error('ذخیره Webhook زرنيو ناموفق بود', { error: (error as Error).message });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function accountIdFrom(payload: Record<string, unknown>): string {
  const account = payload.account;
  if (account && typeof account === 'object') {
    const row = account as Record<string, unknown>;
    return stringValue(row.id) || stringValue(row._id) || stringValue(row.accountId);
  }
  return stringValue(payload.accountId);
}
