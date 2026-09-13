'use client';

import { useEffect, useState } from 'react';

/**
 * هشدار «داخل قاب» — فقط وقتی نمایش داده می‌شود که صفحه در iframe باز شده باشد.
 *
 * چرا لازم است؟ اندازه‌گیری با ردیاب سمت سرور نشان داد مرورگر (Firefox) در قابِ
 * بین‌دامنه‌ای هیچ کوکی‌ای را ذخیره نمی‌کند — نه `SameSite=None`، نه `Partitioned`.
 * ورود موفق است و ریدایرکت هم دنبال می‌شود، ولی چون کوکی ذخیره نمی‌شود کاربر
 * دوباره به /login برمی‌گردد. این محدودیتِ حریم‌خصوصیِ مرورگر است، نه باگ برنامه.
 *
 * راه‌حل قطعی: باز کردن برنامه در تب مستقل، جایی که دامنه «شخص‌اول» است.
 */
export function IframeNotice() {
  const [framed, setFramed] = useState(false);
  const [href, setHref] = useState('');

  useEffect(() => {
    try {
      if (window.self !== window.top) {
        setFramed(true);
        setHref(window.location.origin + '/login');
      }
    } catch {
      // دسترسی به window.top مسدود شد ⇒ قطعاً داخل قاب بین‌دامنه‌ای هستیم
      setFramed(true);
      setHref(window.location.origin + '/login');
    }
  }, []);

  if (!framed) return null;

  return (
    <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
      <p className="font-bold">⚠️ برای ورود، این صفحه را در تب جداگانه باز کنید</p>
      <p className="mt-1 text-xs leading-6">
        این پیش‌نمایش داخل یک قاب (iframe) از دامنهٔ دیگری نمایش داده می‌شود و مرورگر شما به‌دلیل سیاست حریم خصوصی،
        ذخیرهٔ کوکی ورود را در این حالت مسدود می‌کند. در تب مستقل این محدودیت وجود ندارد.
      </p>
      <a
        href={href || '/login'}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block rounded-lg bg-amber-600 px-4 py-2.5 text-center font-bold text-white transition-colors hover:bg-amber-700"
      >
        باز کردن در تب جدید ↗
      </a>
      <p className="mt-2 text-center text-[11px] text-amber-700">
        پس از باز شدن، همان‌جا «ورود به داشبورد» را بزنید.
      </p>
    </div>
  );
}
