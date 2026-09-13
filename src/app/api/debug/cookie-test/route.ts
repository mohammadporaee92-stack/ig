import { NextResponse } from 'next/server';
import { env } from '~/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ابزار تشخیص کوکی — فقط در محیط توسعه/پیش‌نمایش.
 *
 * چهار کوکی با ترکیب‌های متفاوت ست می‌کند و سپس به صفحهٔ /cookie-test می‌رود.
 * آن صفحه نشان می‌دهد کدام‌یک واقعاً توسط مرورگر ذخیره و بازپس‌فرستاده شده‌اند.
 * این دقیقاً مشخص می‌کند کدام تنظیم کوکی در مرورگر کاربر (داخل iframe) کار می‌کند.
 */
export async function GET(): Promise<Response> {
  if (env().isProd) {
    return NextResponse.json({ error: 'غیرفعال در production' }, { status: 404 });
  }

  const res = new NextResponse(null, { status: 303, headers: { location: '/cookie-test' } });

  const variants = [
    'ct_a=1; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=None; Partitioned',
    'ct_b=1; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=None',
    'ct_c=1; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax',
    'ct_d=1; Path=/; Max-Age=600; Secure; SameSite=None; Partitioned',
  ];
  for (const v of variants) res.headers.append('set-cookie', v);

  return res;
}
