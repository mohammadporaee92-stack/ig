import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { getAnalytics, getDailySeries, getDashboardStats } from '~/server/queries';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '~/components/ui';
import { formatNumber, percent } from '~/lib/utils';

export const dynamic = 'force-dynamic';

/** نمودار میله‌ای سبک — SVG خالص، بدون وابستگی خارجی (در preview بدون شبکه هم کار می‌کند) */
function BarChart({ data }: { data: Array<{ date: string; runs: number; delivered: number }> }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-slate-400">داده‌ای برای نمایش نیست</p>;
  const max = Math.max(1, ...data.map((d) => d.runs));
  const w = 100 / data.length;

  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="نمودار اجراهای روزانه">
        {data.map((d, i) => {
          const h = (d.runs / max) * 36;
          const hd = (d.delivered / max) * 36;
          return (
            <g key={d.date}>
              <rect x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} fill="#ddd6fe" rx="0.6" />
              <rect x={i * w + w * 0.15} y={40 - hd} width={w * 0.7} height={hd} fill="#7c3aed" rx="0.6" />
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span dir="ltr">{data[0]?.date}</span>
        <span dir="ltr">{data[data.length - 1]?.date}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-brand-600" /> تحویل موفق</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-brand-200" /> کل اجراها</span>
      </div>
    </div>
  );
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="tabular text-slate-500">{formatNumber(value)} <span className="text-xs text-slate-400">({pct}%)</span></span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const user = await requireUser();
  const { repos } = await getContainer();
  const [stats, rows, series] = await Promise.all([
    getDashboardStats(repos, user.sub),
    getAnalytics(repos, user.sub),
    getDailySeries(repos, user.sub, 14),
  ]);

  const totals = rows.reduce(
    (acc, r) => ({
      matches: acc.matches + r.matches,
      dmSent: acc.dmSent + r.dmSent,
      followChecked: acc.followChecked + r.followChecked,
      following: acc.following + r.following,
      success: acc.success + r.success,
    }),
    { matches: 0, dmSent: 0, followChecked: 0, following: 0, success: 0 },
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">تحلیل‌ها</h1>
        <Card>
          <CardContent className="pt-6">
            <EmptyState icon="📈" title="هنوز داده‌ای وجود ندارد" description="پس از ساخت و فعال‌سازی اولین اتوماسیون، آمار عملکرد اینجا نمایش داده می‌شود." />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">تحلیل‌ها</h1>
        <p className="mt-1 text-sm text-slate-500">عملکرد اتوماسیون‌ها و نرخ تبدیل در هر مرحله</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>اجراهای ۱۴ روز اخیر</CardTitle></CardHeader>
          <CardContent><BarChart data={series} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>قیف تبدیل</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <FunnelBar label="کلیدواژه مطابقت یافت" value={totals.matches} total={totals.matches} color="bg-slate-400" />
            <FunnelBar label="دایرکت ارسال شد" value={totals.dmSent} total={totals.matches} color="bg-sky-500" />
            <FunnelBar label="کاربر پاسخ داد (رضایت ثبت شد)" value={totals.followChecked} total={totals.matches} color="bg-amber-500" />
            <FunnelBar label="فالو تأیید شد" value={totals.following} total={totals.matches} color="bg-violet-500" />
            <FunnelBar label="محتوای اصلی تحویل شد" value={totals.success} total={totals.matches} color="bg-emerald-500" />
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-500">
              بزرگ‌ترین افت معمولاً در مرحلهٔ «کاربر پاسخ داد» است؛ این یک محدودیت ذاتی پلتفرم است، نه نقص محصول:
              تا کاربر روی دکمه در دایرکت نزند، Meta اجازهٔ ادامهٔ گفتگو یا بررسی فالو را نمی‌دهد.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>عملکرد به تفکیک اتوماسیون</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-right text-xs text-slate-500">
                  <th className="px-2 py-2 font-medium">اتوماسیون</th>
                  <th className="px-2 py-2 font-medium">اجراها</th>
                  <th className="px-2 py-2 font-medium">دایرکت</th>
                  <th className="px-2 py-2 font-medium">فالو ✅</th>
                  <th className="px-2 py-2 font-medium">فالو ❌</th>
                  <th className="px-2 py-2 font-medium">در انتظار</th>
                  <th className="px-2 py-2 font-medium">تحویل</th>
                  <th className="px-2 py-2 font-medium">خطا</th>
                  <th className="px-2 py-2 font-medium">نرخ تبدیل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.automationId} className="border-b border-slate-50 last:border-0">
                    <td className="max-w-[200px] truncate px-2 py-3">
                      <Link href={`/automations/${r.automationId}`} className="font-medium text-slate-800 hover:text-brand-600">{r.name}</Link>
                    </td>
                    <td className="tabular px-2 py-3">{formatNumber(r.matches)}</td>
                    <td className="tabular px-2 py-3">{formatNumber(r.dmSent)}</td>
                    <td className="tabular px-2 py-3 text-emerald-600">{formatNumber(r.following)}</td>
                    <td className="tabular px-2 py-3 text-amber-600">{formatNumber(r.notFollowing)}</td>
                    <td className="tabular px-2 py-3 text-sky-600">{formatNumber(r.awaiting)}</td>
                    <td className="tabular px-2 py-3 font-semibold text-emerald-700">{formatNumber(r.success)}</td>
                    <td className={`tabular px-2 py-3 ${r.failed ? 'text-red-600' : 'text-slate-400'}`}>{formatNumber(r.failed)}</td>
                    <td className="px-2 py-3">
                      <Badge variant={r.conversionRate > 0.5 ? 'success' : r.conversionRate > 0.2 ? 'warning' : 'muted'}>
                        {percent(r.success, r.matches)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['کل کامنت‌های پردازش‌شده', formatNumber(stats.commentsProcessed)],
          ['کل دایرکت‌های ارسالی', formatNumber(stats.dmSent)],
          ['درخواست‌های فالو', formatNumber(stats.followGateRequests)],
          ['نرخ تبدیل کلی', percent(stats.successfulDeliveries, stats.commentsProcessed)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="tabular mt-1 text-2xl font-bold text-slate-900">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
