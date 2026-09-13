'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Input, Label } from '~/components/ui';

/**
 * فرم ورود — عمداً یک فرم **کلاسیک HTML** است، نه fetch.
 *
 * دلیل: وقتی داشبورد داخل iframe از دامنهٔ دیگری سرو می‌شود، مرورگر کوکیِ
 * پاسخِ fetch را به‌عنوان «کوکی شخص‌ثالث» مسدود می‌کند و کاربر بی‌صدا به همین
 * صفحه برمی‌گردد. ارسال فرم کلاسیک یک **ناوبری سطح بالا** است و کوکیِ آن
 * مسدود نمی‌شود. ضمناً بدون JavaScript هم کار می‌کند.
 */
export function LoginForm({
  initialError,
  initialMode,
}: {
  initialError?: string;
  initialMode?: 'login' | 'register';
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode ?? 'login');
  const [loading, setLoading] = useState(false);
  const [stuck, setStuck] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // اگر ناوبری اتفاق نیفتاد، دکمه نباید برای همیشه روی «در حال پردازش…» قفل بماند.
  // این حالت یعنی مرورگر ریدایرکت را دنبال نکرده — پس راه جایگزین را نشان می‌دهیم.
  useEffect(() => {
    const restore = () => {
      setLoading(false);
      if (timer.current) clearTimeout(timer.current);
    };
    // بازگشت از bfcache (کاربر back زده)
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pageshow', restore);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleSubmit = () => {
    setLoading(true);
    timer.current = setTimeout(() => {
      setLoading(false);
      setStuck(true);
    }, 6000);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m === 'login' ? 'ورود' : 'ثبت‌نام'}
            </button>
          ))}
        </div>

        <form method="POST" action="/api/auth/login" onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="mode" value={mode} />

          {mode === 'register' && (
            <div>
              <Label htmlFor="fullName">نام و نام خانوادگی</Label>
              <Input id="fullName" name="fullName" placeholder="محمد پور" autoComplete="name" />
            </div>
          )}

          <div>
            <Label htmlFor="email">ایمیل</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              defaultValue="demo@igflow.app"
              placeholder="you@example.com"
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div>
            <Label htmlFor="password">رمز عبور</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              defaultValue="demo12345"
              placeholder="حداقل ۸ کاراکتر"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              dir="ltr"
            />
          </div>

          {initialError ? <Alert variant="danger">{initialError}</Alert> : null}

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? 'در حال پردازش…' : mode === 'login' ? 'ورود به داشبورد' : 'ساخت حساب'}
          </Button>
        </form>

        {stuck ? (
          <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
            <p className="font-medium">ناوبری توسط مرورگر انجام نشد.</p>
            <p>
              این معمولاً یعنی صفحه داخل قاب (iframe) پیش‌نمایش باز شده و مرورگر اجازهٔ جابه‌جایی نداده است. یکی از
              این دو راه را امتحان کنید:
            </p>
            <a
              href="/api/auth/magic"
              target="_top"
              className="block rounded-md bg-amber-600 px-3 py-2 text-center font-medium text-white hover:bg-amber-700"
            >
              ورود مستقیم (باز کردن در پنجرهٔ اصلی)
            </a>
            <p>یا پیش‌نمایش را در یک تب جداگانه باز کنید و دوباره وارد شوید.</p>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-center text-xs leading-6 text-slate-500">
            حساب نمونه از پیش پر شده است — کافیست «ورود به داشبورد» را بزنید.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
