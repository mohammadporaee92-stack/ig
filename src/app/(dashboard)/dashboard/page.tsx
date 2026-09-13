import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { getDashboardStats, getRecentRuns } from '~/server/queries';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '~/components/ui';
import { formatNumber, percent, relativeTime } from '~/lib/utils';
import { RunStatusBadge } from '~/components/run-status';

export const dynamic = 'force-dynamic';

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className={`tabular mt-1 text-2xl font-bold ${accent ?? 'text-slate-900'}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { repos } = await getContainer();

  const [account, stats, runs] = await Promise.all([
    repos.accounts.getPrimary(user.sub),
    getDashboardStats(repos, user.sub),
    getRecentRuns(repos, user.sub, 8),
  ]);

  /* ── Onboarding: هنوز اینستاگرام متصل نیست ── */
  if (!account) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-pink-500 px-8 py-10 text-center text-white">
            <h1 className="text-2xl font-bold">خوش آمدید 👋</h1>
            <p className="mt-2 text-brand-50">برای شروع، حساب اینستاگرام Professional خود را متصل کنید</p>
          </div>
          <CardContent className="space-y-4 pt-6 text-center">
            <ul className="mx-auto max-w-md space-y-2 text-right text-sm text-slate-600">
              <li>✅ بدون نیاز به ساخت Facebook Page</li>
              <li>✅ بدون ورود به Meta Business Suite</li>
              <li>✅ بدون وارد کردن رمز اینستاگرام در نرم‌افزار</li>
              <li>✅ فقط با فرآیند رسمی Login اینستاگرام</li>
            </ul>
            <Link href="/api/instagram/connect">
              <Button size="lg" className="w-full sm:w-auto">📸 اتصال اینستاگرام</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── Onboarding: متصل شده اما هنوز اتوماسیونی ندارد ── */
  const noAutomations = stats.totalAutomations === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">داشبورد</h1>
          <p className="mt-1 text-sm text-slate-500">نمای کلی عملکرد اتوماسیون‌ها</p>
        </div>
        <Link href="/automations/new">
          <Button>+ اتوماسیون جدید</Button>
        </Link>
      </div>

      {/* حساب متصل */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-lg text-white">
              📸
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900" dir="ltr">@{account.username}</span>
                <Badge variant="success">Connected ✅</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Account Type: {account.account_type === 'BUSINESS' ? 'Professional (Business)' : account.account_type}
                {' · '}
                {formatNumber(account.followers_count)} فالوور
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {account.webhook_subscribed ? (
              <Badge variant="success">Webhook فعال</Badge>
            ) : (
              <Badge variant="warning">Webhook غیرفعال</Badge>
            )}
            <Link href="/instagram"><Button variant="outline" size="sm">مدیریت</Button></Link>
          </div>
        </CardContent>
      </Card>

      {noAutomations ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon="⚡"
              title="حساب با موفقیت متصل شد ✅"
              description="حالا اولین اتوماسیون خود را بسازید: یک کلیدواژه تعریف کنید و بگذارید سیستم بقیهٔ کار را انجام دهد."
              action={<Link href="/automations/new"><Button size="lg">ساخت اولین اتوماسیون</Button></Link>}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* آمار */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="اتوماسیون فعال" value={formatNumber(stats.activeAutomations)} hint={`از ${formatNumber(stats.totalAutomations)} اتوماسیون`} />
        <StatCard label="کامنت پردازش‌شده" value={formatNumber(stats.commentsProcessed)} />
        <StatCard label="دایرکت ارسال‌شده" value={formatNumber(stats.dmSent)} />
        <StatCard label="تحویل موفق" value={formatNumber(stats.successfulDeliveries)} accent="text-emerald-600" hint={`نرخ تبدیل ${percent(stats.successfulDeliveries, stats.commentsProcessed)}`} />
        <StatCard label="درخواست فالو" value={formatNumber(stats.followGateRequests)} accent="text-amber-600" />
        <StatCard label="در انتظار کاربر" value={formatNumber(stats.awaitingInteraction)} accent="text-sky-600" hint="منتظر تعامل در دایرکت" />
        <StatCard label="خطاها" value={formatNumber(stats.errors)} accent={stats.errors ? 'text-red-600' : 'text-slate-900'} />
        <StatCard label="نرخ تبدیل" value={percent(stats.successfulDeliveries, stats.commentsProcessed)} accent="text-brand-600" />
      </div>

      {/* اجراهای اخیر */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>اجراهای اخیر</CardTitle>
          <Link href="/automations" className="text-sm text-brand-600 hover:underline">همهٔ اتوماسیون‌ها</Link>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">هنوز اجرایی ثبت نشده است</p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-right text-xs text-slate-500">
                    <th className="px-2 py-2 font-medium">کاربر</th>
                    <th className="px-2 py-2 font-medium">کلیدواژه</th>
                    <th className="px-2 py-2 font-medium">اتوماسیون</th>
                    <th className="px-2 py-2 font-medium">وضعیت</th>
                    <th className="px-2 py-2 font-medium">زمان</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-2.5 font-medium text-slate-800" dir="ltr">@{r.username ?? '—'}</td>
                      <td className="px-2 py-2.5"><Badge variant="purple">{r.matched_keyword ?? '—'}</Badge></td>
                      <td className="max-w-[160px] truncate px-2 py-2.5 text-slate-600">{r.automation_name}</td>
                      <td className="px-2 py-2.5"><RunStatusBadge status={r.status} followStatus={r.follow_status} /></td>
                      <td className="px-2 py-2.5 text-xs text-slate-400">{relativeTime(r.started_at)}</td>
                      <td className="px-2 py-2.5 text-left">
                        <Link href={`/runs/${r.id}`} className="text-xs text-brand-600 hover:underline">لاگ</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
