import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { env } from '~/lib/env';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '~/components/ui';
import { formatDateTime, formatNumber } from '~/lib/utils';
import { AccountActions } from './account-actions';
import { ZernioImportAction } from './zernio-actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  access_denied: 'شما دسترسی را رد کردید. برای استفاده از اتوماسیون، مجوزهای درخواستی لازم است.',
  invalid_callback: 'بازگشت از اینستاگرام ناقص بود (code یا state موجود نبود). دوباره تلاش کنید.',
  invalid_state: 'اعتبار درخواست تأیید نشد (state نامعتبر یا منقضی). لطفاً دوباره از ابتدا شروع کنید.',
  exchange_failed: 'تبادل کد با اینستاگرام ناموفق بود.',
  not_configured: 'اپلیکیشن Meta هنوز پیکربندی نشده است. مقادیر IG_APP_ID و IG_APP_SECRET را در فایل .env تنظیم کنید.',
};

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { repos } = await getContainer();
  const accounts = await repos.accounts.listByUser(user.sub);
  const connected = accounts.filter((a) => a.status !== 'disconnected');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">اتصال اینستاگرام</h1>
        <p className="mt-1 text-sm text-slate-500">
          حساب Professional خود را مستقیم از Meta یا از طریق Zernio متصل کنید
        </p>
      </div>

      {params.error ? (
        <Alert variant="danger">
          <strong>اتصال ناموفق بود.</strong>
          <p className="mt-1">{ERRORS[params.error] ?? params.error}</p>
          {params.message ? <p className="mt-1 font-mono text-xs opacity-70" dir="ltr">{params.message}</p> : null}
        </Alert>
      ) : null}

      {params.connected ? (
        <Alert variant="success">
          <strong>Instagram connected successfully ✅</strong>
          <p className="mt-1">
            حالا می‌توانید اولین اتوماسیون خود را بسازید.{' '}
            <Link href="/automations/new" className="font-medium underline">ساخت اتوماسیون</Link>
          </p>
        </Alert>
      ) : null}

      {!env().instagramConfigured && !env().zernioConfigured ? (
        <Alert variant="warning">
          <strong>پیکربندی ناقص است.</strong>
          <p className="mt-1 leading-6">
            برای اتصال مستقیم باید Meta App را تنظیم کنید؛ یا کلید اختصاصی Zernio را با نام{' '}
            <code className="rounded bg-amber-100 px-1">ZERNIO_API_KEY</code> در Environment Variables قرار دهید.
            برای اتصال مستقیم Meta، مقادیر{' '}
            <code className="rounded bg-amber-100 px-1">IG_APP_ID</code> و{' '}
            <code className="rounded bg-amber-100 px-1">IG_APP_SECRET</code> را در فایل{' '}
            <code className="rounded bg-amber-100 px-1">.env.local</code> قرار دهید.
            راهنمای کامل در <code className="rounded bg-amber-100 px-1">README.md</code> بخش «Instagram OAuth Setup».
          </p>
        </Alert>
      ) : null}

      {connected.length === 0 ? (
        <Card>
          <CardContent className="space-y-5 pt-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-2xl">
              📸
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">هنوز حسابی متصل نیست</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-slate-500">
                اگر حساب را قبلاً در Zernio متصل کرده‌اید، IGFlow آن را با API Key شناسایی می‌کند.
                کلید فقط روی سرور استفاده می‌شود و هرگز به مرورگر فرستاده نمی‌شود.
              </p>
            </div>
            {env().zernioConfigured ? <ZernioImportAction enabled /> : null}
            {env().instagramConfigured ? (
              <div className="border-t border-slate-100 pt-4">
                <Link href="/api/instagram/connect">
                  <Button variant="outline">اتصال مستقیم از Meta</Button>
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        connected.map((account) => (
          <Card key={account.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <span dir="ltr">@{account.username}</span>
                  <Badge>{account.provider === 'zernio' ? 'Zernio' : 'Meta'}</Badge>
                  {account.status === 'connected' ? (
                    <Badge variant="success">Connected ✅</Badge>
                  ) : account.status === 'needs_reauth' ? (
                    <Badge variant="warning">نیاز به اتصال مجدد</Badge>
                  ) : (
                    <Badge variant="danger">{account.status}</Badge>
                  )}
                </CardTitle>
                <AccountActions
                  accountId={account.id}
                  webhookSubscribed={account.webhook_subscribed}
                  provider={account.provider}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Account Type</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {account.account_type === 'BUSINESS' ? 'Professional (Business)' : account.account_type}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">فالوور</dt>
                  <dd className="tabular mt-0.5 font-medium text-slate-800">{formatNumber(account.followers_count)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">پست</dt>
                  <dd className="tabular mt-0.5 font-medium text-slate-800">{formatNumber(account.media_count)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">زمان اتصال</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">{formatDateTime(account.connected_at)}</dd>
                </div>
              </dl>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">وضعیت Webhook</h3>
                  {account.provider === 'zernio' ? (
                    <Badge variant="warning">مرحله بعد</Badge>
                  ) : account.webhook_subscribed ? (
                    <Badge variant="success">فعال</Badge>
                  ) : (
                    <Badge variant="warning">غیرفعال</Badge>
                  )}
                </div>
                {account.provider === 'zernio' ? (
                  <p className="mt-2 text-xs leading-6 text-amber-700">
                    حساب و سلامت اتصال تأیید شده است. دریافت رویداد و ارسال خودکار بعد از نصب آداپتور Zernio فعال می‌شود.
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-6 text-slate-500">
                    فیلدهای مشترک‌شده:{' '}
                    <code dir="ltr" className="rounded bg-slate-100 px-1">
                      {account.webhook_fields || env().igWebhookFields.join(',')}
                    </code>
                  </p>
                )}
                {account.provider !== 'zernio' && !account.webhook_subscribed ? (
                  <p className="mt-2 text-xs leading-6 text-amber-700">
                    ⚠️ دریافت رویداد کامنت نیازمند <strong>Advanced Access</strong> و تأیید App Review است.
                    {account.last_error ? <> پیام خطا: <span dir="ltr">{account.last_error}</span></> : null}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                <strong className="text-slate-800">ارائه‌دهنده:</strong>{' '}
                <span dir="ltr">{account.provider === 'zernio' ? 'Zernio API' : 'Meta API'}</span>
                <br />
                <strong className="text-slate-800">مجوزهای اعطاشده:</strong>{' '}
                <span dir="ltr">{account.scopes || '—'}</span>
                <br />
                <strong className="text-slate-800">امنیت:</strong>{' '}
                {account.provider === 'zernio'
                  ? 'API Key فقط در Secretهای سرور نگه‌داری می‌شود و در دیتابیس حساب ذخیره نمی‌شود.'
                  : 'Access Token با AES-256-GCM رمزنگاری شده و هرگز نمایش داده نمی‌شود.'}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle>محدودیت‌های رسمی که باید بدانید</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-7 text-slate-600">
          <p>• حساب باید <strong>Professional</strong> (Business یا Creator) و <strong>عمومی</strong> باشد.</p>
          <p>• پاسخ خصوصی به هر کامنت فقط <strong>یک بار</strong> و تا <strong>۷ روز</strong> بعد از کامنت ممکن است.</p>
          <p>• پیام دوم (محتوای اصلی) فقط داخل <strong>پنجرهٔ ۲۴ ساعته</strong> پس از پاسخ کاربر ارسال می‌شود.</p>
          <p>
            • <strong>بررسی فالو</strong> رسمی است اما نیازمند رضایت کاربر؛ یعنی کاربر باید ابتدا در دایرکت
            پاسخ دهد یا دکمه بزند. جزئیات در <code className="rounded bg-slate-100 px-1">docs/01-capability-audit.md</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
