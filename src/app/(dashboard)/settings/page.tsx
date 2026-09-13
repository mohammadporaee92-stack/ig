import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { env } from '~/lib/env';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '~/components/ui';
import { formatDateTime } from '~/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const { repos } = await getContainer();
  const [profile, audit] = await Promise.all([
    repos.users.findById(user.sub),
    repos.audit.listByUser(user.sub, 15),
  ]);
  const e = env();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">تنظیمات</h1>
        <p className="mt-1 text-sm text-slate-500">حساب کاربری، اتصال‌ها و وضعیت سیستم</p>
      </div>

      <Card>
        <CardHeader><CardTitle>حساب کاربری</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Row label="نام" value={profile?.full_name || '—'} />
          <Row label="ایمیل" value={profile?.email ?? user.email} ltr />
          <Row label="تاریخ عضویت" value={profile?.created_at ? formatDateTime(profile.created_at) : '—'} />
          <Row label="شناسهٔ مستأجر (Tenant ID)" value={user.sub} ltr mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>اتصال اینستاگرام</CardTitle>
            <Link href="/settings/instagram"><Button variant="outline" size="sm">تنظیمات پیشرفته</Button></Link>
          </div>
        </CardHeader>
        <CardContent>
          <Link href="/instagram" className="text-sm text-brand-600 hover:underline">مدیریت حساب‌های متصل ←</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>وضعیت سیستم</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <StatusRow ok={e.instagramConfigured} label="پیکربندی اپ Meta" detail={e.instagramConfigured ? 'IG_APP_ID و IG_APP_SECRET تنظیم شده‌اند' : 'مقادیر IG_APP_ID / IG_APP_SECRET تنظیم نشده‌اند'} />
          <StatusRow ok={e.WEBHOOK_SIGNATURE_REQUIRED} label="بررسی امضای Webhook" detail={e.WEBHOOK_SIGNATURE_REQUIRED ? 'X-Hub-Signature-256 الزامی است' : '⚠️ غیرفعال — فقط برای توسعهٔ محلی مناسب است'} />
          <StatusRow ok={Boolean(e.REDIS_URL)} label="صف Redis / BullMQ" detail={e.REDIS_URL ? 'صف پایدار فعال است' : 'صف درون‌حافظه‌ای (فقط توسعه) — برای production مقدار REDIS_URL را تنظیم کنید'} />
          <StatusRow ok={Boolean(e.DATABASE_URL)} label="پایگاه داده" detail={e.DATABASE_URL ? 'PostgreSQL' : 'PGlite محلی (فقط توسعه)'} />
          <StatusRow ok label="رمزنگاری توکن" detail="AES-256-GCM — توکن‌ها در حالت سکون رمزنگاری می‌شوند و هرگز در API یا لاگ نمایش داده نمی‌شوند" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>فعالیت‌های اخیر (Audit Log)</CardTitle></CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">فعالیتی ثبت نشده است</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.map((a, i) => {
                const row = a as Record<string, unknown>;
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-700" dir="ltr">{String(row.action)}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(row.created_at as Date)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, ltr, mono }: { label: string; value: string; ltr?: boolean; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-medium text-slate-800 ${mono ? 'break-all font-mono text-xs' : ''}`} dir={ltr ? 'ltr' : undefined}>{value}</p>
    </div>
  );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="mt-0.5 text-xs leading-6 text-slate-500">{detail}</p>
      </div>
      <Badge variant={ok ? 'success' : 'warning'}>{ok ? 'سالم' : 'توجه'}</Badge>
    </div>
  );
}
