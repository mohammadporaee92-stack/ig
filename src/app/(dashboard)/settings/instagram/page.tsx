import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { env } from '~/lib/env';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '~/components/ui';
import { formatDateTime } from '~/lib/utils';

export const dynamic = 'force-dynamic';

export default async function InstagramSettingsPage() {
  const user = await requireUser();
  const { repos } = await getContainer();
  const accounts = await repos.accounts.listByUser(user.sub);
  const e = env();

  // ⚠️ فقط متادیتای توکن خوانده می‌شود؛ خودِ مقدار توکن هرگز به این لایه نمی‌رسد.
  const tokenMeta = await Promise.all(
    accounts.map(async (a) => ({ account: a, token: await repos.tokens.findByAccount(a.id) })),
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">تنظیمات اینستاگرام</h1>
          <p className="mt-1 text-sm text-slate-500">توکن‌ها، Webhook و مجوزها</p>
        </div>
        <Link href="/instagram"><Button variant="outline">صفحهٔ اتصال</Button></Link>
      </div>

      <Card>
        <CardHeader><CardTitle>پیکربندی ارائه‌دهنده‌ها</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <strong>Zernio API</strong>
              <Badge variant={e.zernioConfigured ? 'success' : 'warning'}>
                {e.zernioConfigured ? 'پیکربندی‌شده' : 'تنظیم نشده'}
              </Badge>
            </div>
            <Kv k="Base URL" v={e.ZERNIO_BASE_URL} />
            <Kv k="API Key" v={e.zernioConfigured ? '•••••••••••••••• (فقط روی سرور)' : '— تنظیم نشده —'} />
            <Kv k="Webhook Callback URL" v={`${e.APP_URL}/api/webhooks/zernio`} />
            <Kv k="Webhook Secret" v={e.ZERNIO_WEBHOOK_SECRET ? '•••••••••••••••• (فقط روی سرور)' : '— تنظیم نشده —'} />
            <p className="mt-3 text-xs leading-6 text-slate-500">
              اتوماسیون‌های فعال با Comment Automation زرنیو همگام می‌شوند؛ Webhook امضاشده فقط رویدادها را برای پایش ثبت می‌کند.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <strong>اتصال مستقیم Meta</strong>
              <Badge variant={e.instagramConfigured ? 'success' : 'warning'}>
                {e.instagramConfigured ? 'پیکربندی‌شده' : 'تنظیم نشده'}
              </Badge>
            </div>
            <Kv k="Graph API Version" v={e.IG_GRAPH_VERSION} />
            <Kv k="Graph Host" v={e.IG_GRAPH_HOST} />
            <Kv k="Redirect URI" v={e.IG_REDIRECT_URI} />
            <Kv k="Webhook Callback URL" v={`${e.APP_URL}/api/webhooks/instagram`} />
            <Kv k="Scopes" v={e.igScopes.join(', ')} />
            <Kv k="Webhook Fields" v={e.igWebhookFields.join(', ')} />
            <Kv k="App ID" v={e.IG_APP_ID || '— تنظیم نشده —'} />
            <Kv k="App Secret" v={e.instagramConfigured ? '•••••••••••••••• (هرگز نمایش داده نمی‌شود)' : '— تنظیم نشده —'} />
          </div>
        </CardContent>
      </Card>

      {tokenMeta.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-slate-500">
            هنوز حسابی متصل نشده است.{' '}
            <Link href="/instagram" className="text-brand-600 hover:underline">اتصال اینستاگرام</Link>
          </CardContent>
        </Card>
      ) : (
        tokenMeta.map(({ account, token }) => (
          <Card key={account.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span dir="ltr">@{account.username}</span>
                <Badge>{account.provider === 'zernio' ? 'Zernio' : 'Meta'}</Badge>
                <Badge variant={account.status === 'connected' ? 'success' : 'warning'}>{account.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {account.provider === 'zernio' ? (
                <>
                  <Kv k="Zernio Account ID" v={account.provider_account_id ?? '—'} />
                  <Kv k="Zernio Profile ID" v={account.provider_profile_id ?? '—'} />
                  <Kv k="Credential" v="🔒 API Key فقط در Secretهای سرور نگه‌داری می‌شود" />
                  <Kv k="Comment Automation" v="فعال — همگام‌شونده با Zernio" />
                  <Kv k="Webhook" v={account.webhook_subscribed ? 'فعال (رویداد امضاشده دریافت شده)' : 'هنوز رویدادی دریافت نشده'} />
                </>
              ) : (
                <>
                  <Kv k="IG User ID" v={account.ig_user_id} />
                  <Kv k="نوع توکن" v={token?.token_type ?? '—'} />
                  <Kv k="انقضای توکن" v={token?.expires_at ? formatDateTime(token.expires_at) : '—'} />
                  <Kv k="آخرین تازه‌سازی" v={token?.last_refreshed_at ? formatDateTime(token.last_refreshed_at) : 'هنوز انجام نشده'} />
                  <Kv k="مقدار توکن" v="🔒 رمزنگاری‌شده با AES-256-GCM — قابل نمایش نیست" />
                  <Kv k="Webhook" v={account.webhook_subscribed ? `فعال (${account.webhook_fields})` : 'غیرفعال'} />
                </>
              )}
              {account.last_error ? <Alert variant="warning"><span dir="ltr">{account.last_error}</span></Alert> : null}
            </CardContent>
          </Card>
        ))
      )}

      {accounts.some((account) => account.provider !== 'zernio') ? <Card>
        <CardHeader><CardTitle>چرخهٔ عمر توکن</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm leading-7 text-slate-600">
          <p>۱. کد مجوز (Authorization Code) — اعتبار ۱ ساعت، یک‌بارمصرف.</p>
          <p>۲. توکن کوتاه‌مدت — اعتبار ۱ ساعت.</p>
          <p>۳. توکن بلندمدت — اعتبار ۶۰ روز؛ سیستم به‌صورت خودکار پیش از انقضا آن را تمدید می‌کند.</p>
          <p>
            اگر تمدید ناموفق باشد، حساب به وضعیت <code dir="ltr">needs_reauth</code> می‌رود و از شما خواسته می‌شود
            دوباره «اتصال مجدد» را بزنید. هیچ اتوماسیونی در این وضعیت اجرا نمی‌شود.
          </p>
        </CardContent>
      </Card> : null}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 pb-2 last:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="break-all font-mono text-xs text-slate-800" dir="ltr">{v}</span>
    </div>
  );
}
