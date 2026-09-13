import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '~/components/ui';
import { formatDateTime } from '~/lib/utils';
import { RunStatusBadge } from '~/components/run-status';

export const dynamic = 'force-dynamic';

const LEVEL_STYLE: Record<string, string> = {
  info: 'bg-sky-100 text-sky-700',
  success: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { repos } = await getContainer();

  const run = await repos.runs.findByIdScoped(user.sub, id);
  if (!run) notFound();

  const [events, automation] = await Promise.all([
    repos.runEvents.listByRun(user.sub, id),
    repos.automations.findById(user.sub, run.automation_id),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">جزئیات اجرا</h1>
          <p className="mt-1 text-sm text-slate-500">{automation?.name ?? '—'}</p>
        </div>
        <Link href={`/automations/${run.automation_id}/logs`}><Button variant="ghost">بازگشت به لاگ‌ها</Button></Link>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="کاربر" value={`@${run.username ?? '—'}`} ltr />
          <Field label="وضعیت" node={<RunStatusBadge status={run.status} followStatus={run.follow_status} />} />
          <Field label="کلیدواژه" node={run.matched_keyword ? <Badge variant="purple">{run.matched_keyword}</Badge> : <span>—</span>} />
          <Field label="تحویل نهایی" node={run.delivered ? <Badge variant="success">موفق ✅</Badge> : <Badge variant="muted">هنوز نه</Badge>} />
          <Field label="شروع" value={formatDateTime(run.started_at)} />
          <Field label="پایان" value={run.finished_at ? formatDateTime(run.finished_at) : '—'} />
          <Field label="Comment ID" value={run.comment_id ?? '—'} ltr mono />
          <Field label="IGSID" value={run.igsid ?? '—'} ltr mono />
        </CardContent>
      </Card>

      {run.comment_text ? (
        <Card>
          <CardHeader><CardTitle>متن کامنت</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line rounded-lg bg-slate-50 p-4 text-sm leading-7 text-slate-700">{run.comment_text}</p></CardContent>
        </Card>
      ) : null}

      {run.error ? (
        <Card>
          <CardHeader><CardTitle className="text-red-700">خطا</CardTitle></CardHeader>
          <CardContent>
            <p dir="ltr" className="rounded-lg bg-red-50 p-4 font-mono text-xs leading-6 text-red-700">
              {run.error_code ? `[${run.error_code}] ` : ''}{run.error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>خط زمانی رویدادها</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">رویدادی ثبت نشده است</p>
          ) : (
            <ol className="relative space-y-4 border-r border-slate-200 pr-5">
              {events.map((e) => {
                const ev = e as Record<string, unknown>;
                const level = String(ev.level ?? 'info');
                return (
                  <li key={String(ev.id)} className="relative">
                    <span className="absolute -right-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${LEVEL_STYLE[level] ?? LEVEL_STYLE.info}`} dir="ltr">
                        {String(ev.code)}
                      </span>
                      <span className="text-xs text-slate-400">{formatDateTime(ev.created_at as Date)}</span>
                    </div>
                    {ev.message ? <p className="mt-1 text-sm text-slate-700">{String(ev.message)}</p> : null}
                    {ev.metadata && String(ev.metadata) !== '{}' ? (
                      <pre dir="ltr" className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-500">
                        {String(ev.metadata)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, node, ltr, mono }: { label: string; value?: string; node?: React.ReactNode; ltr?: boolean; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <div className={`mt-1 text-sm font-medium text-slate-800 ${mono ? 'break-all font-mono text-xs' : ''}`} dir={ltr ? 'ltr' : undefined}>
        {node ?? value}
      </div>
    </div>
  );
}
