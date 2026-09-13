/**
 * کلاینت مشترک برای فراخوانی API از سمت مرورگر.
 *
 * چرا لازم است؟ دو نکته که فراموش‌کردنشان باعث باگ‌های سخت‌یاب می‌شود:
 *
 *  ۱. `credentials: 'include'` — اگر داشبورد داخل iframe از دامنهٔ دیگری سرو شود
 *     (محیط پیش‌نمایش)، مرورگر بدون این گزینه کوکیِ پاسخ را **ذخیره نمی‌کند** و
 *     کوکی موجود را هم **ارسال نمی‌کند**. نتیجه: ورود «موفق» می‌شود ولی کاربر
 *     همچنان بیرون می‌ماند.
 *
 *  ۲. هدر `x-requested-with: igflow` — لایهٔ API آن را برای همهٔ mutationها
 *     الزامی کرده است (محافظت CSRF). بدون آن پاسخ ۴۰۳ است.
 *
 * به‌جای تکرار این دو در هر کامپوننت، همه از این‌جا رد می‌شوند.
 */

export interface ApiError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(path, {
      ...init,
      // حیاتی برای کارکرد سشن در حالت cross-origin/iframe
      credentials: 'include',
      headers: {
        'x-requested-with': 'igflow',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : {};

    if (!res.ok) {
      const err = data as ApiError;
      return {
        ok: false,
        status: res.status,
        error: err.error ?? err.issues?.[0]?.message ?? 'خطایی رخ داد',
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: 'ارتباط با سرور برقرار نشد' };
  }
}

export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const apiPut = <T = unknown>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const apiPatch = <T = unknown>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const apiDelete = <T = unknown>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
