import { redirect } from 'next/navigation';
import { getCurrentUser } from '~/server/auth';
import { LoginForm } from './login-form';
import { IframeNotice } from './iframe-notice';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const params = await searchParams;
  const mode = params.mode === 'register' ? ('register' as const) : ('login' as const);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-xl font-bold text-white shadow-lg">
            IG
          </div>
          <h1 className="text-2xl font-bold text-slate-900">IGFlow</h1>
          <p className="mt-2 text-sm text-slate-500">
            کامنت → کلیدواژه → دایرکت → بررسی فالو → ارسال محتوا
          </p>
        </div>
        <IframeNotice />
        <LoginForm initialError={params.error} initialMode={mode} />
        <p className="mt-6 text-center text-xs leading-6 text-slate-400">
          این سرویس فقط از APIهای رسمی Instagram استفاده می‌کند.
          <br />
          هرگز رمز عبور اینستاگرام شما را نمی‌خواهد.
        </p>
      </div>
    </div>
  );
}
