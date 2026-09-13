import { NextResponse } from 'next/server';
import { getContainer } from '~/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * بررسی سلامت برای load balancer، Docker healthcheck و مانیتورینگ.
 *
 * ⚠️ عمداً هیچ اطلاعات حساسی برنمی‌گرداند — نه نسخه، نه رشتهٔ اتصال،
 * نه جزئیات خطا. فقط وضعیت.
 */
export async function GET(): Promise<Response> {
  const checks: Record<string, 'ok' | 'fail'> = {};

  try {
    const { db } = await getContainer();
    await db.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'fail';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
