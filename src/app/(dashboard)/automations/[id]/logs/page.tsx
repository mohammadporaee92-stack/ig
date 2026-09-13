import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '~/components/ui';
import { formatDateTime, relativeTime } from '~/lib/utils';
import { RunStatusBadge } from '~/components/run-status';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function AutomationLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const user = await requireUser();
  const { repos } = await getContainer();

  const automation = await repos.automations.findById(user.sub, id);
  if (!automation) notFound();

  const runs = await repos.runs.listByUser(user.sub, {
    automationId: id,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">لاگ اجراها</h1>
          <p className="mt-1 text-sm text-slate-500">{automation.name}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/automations/${id}`}><Button variant="outline">ویرایش اتوماسیون</Button></Link>
          <Link href="/automations"><Button variant="ghost">بازگشت</Button></Link>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>تریگرهای ثبت‌شده</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState
              icon="🗒️"
              title="هنوز لاگی ثبت نشده"
              description="به‌محض اینکه کاربری کلیدواژهٔ تعریف‌شده را کامنت کند، جزئیات کامل اجرا اینجا نمایش داده می‌شود."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-right text-xs text-slate-500">
                    <th className="px-2 py-2 font-medium">زمان</th>
                    <th className="px-2 py-2 font-medium">کاربر</th>
                    <th className="px-2 py-2 font-medium">کامنت</th>
                    <th className="px-2 py-2 font-medium">کلیدواژه</th>
                    <th className="px-2 py-2 font-medium">وضعیت</th>
                    <th className="px-2 py-2 font-medium">تحویل</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 align-top last:border-0">
                      <td className="whitespace-nowrap px-2 py-3 text-xs text-slate-500" title={formatDateTime(r.started_at)}>
                        {relativeTime(r.started_at)}
                      </td>
                      <td className="px-2 py-3 font-medium text-slate-800" dir="ltr">@{r.username ?? '—'}</td>
                      <td className="max-w-[240px] px-2 py-3 text-slate-600">
                        <span className="line-clamp-2">{r.comment_text ?? '—'}</span>
                      </td>
                      <td className="px-2 py-3">{r.matched_keyword ? <Badge variant="purple">{r.matched_keyword}</Badge> : '—'}</td>
                      <td className="px-2 py-3"><RunStatusBadge status={r.status} followStatus={r.follow_status} /></td>
                      <td className="px-2 py-3">
                        {r.delivered ? <Badge variant="success">✅</Badge> : r.error ? <Badge variant="danger" title={r.error}>خطا</Badge> : <Badge variant="muted">—</Badge>}
                      </td>
                      <td className="px-2 py-3 text-left">
                        <Link href={`/runs/${r.id}`} className="whitespace-nowrap text-xs text-brand-600 hover:underline">جزئیات</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(runs.length === PAGE_SIZE || page > 1) ? (
            <div className="mt-4 flex items-center justify-between">
              <Link href={`/automations/${id}/logs?page=${page - 1}`} aria-disabled={page === 1}>
                <Button variant="outline" size="sm" disabled={page === 1}>→ قبلی</Button>
              </Link>
              <span className="text-xs text-slate-400">صفحهٔ {page}</span>
              <Link href={`/automations/${id}/logs?page=${page + 1}`}>
                <Button variant="outline" size="sm" disabled={runs.length < PAGE_SIZE}>بعدی ←</Button>
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
