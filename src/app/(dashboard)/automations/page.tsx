import Link from 'next/link';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { listAutomationSummaries } from '~/server/queries';
import { Alert, Button, Card, CardContent, EmptyState } from '~/components/ui';
import { AutomationCard } from './automation-card';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const user = await requireUser();
  const { repos } = await getContainer();
  const [items, accounts] = await Promise.all([
    listAutomationSummaries(repos, user.sub),
    repos.accounts.listByUser(user.sub),
  ]);
  const account = accounts.find((item) => item.status === 'connected');
  const automationReady = accounts.some((item) => item.status === 'connected' && item.provider !== 'zernio');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">اتوماسیون‌ها</h1>
          <p className="mt-1 text-sm text-slate-500">{items.length} اتوماسیون ساخته‌اید</p>
        </div>
        {automationReady ? (
          <Link href="/automations/new"><Button>+ اتوماسیون جدید</Button></Link>
        ) : (
          <Link href="/instagram"><Button variant="outline">ابتدا اینستاگرام را متصل کنید</Button></Link>
        )}
      </div>

      {account?.provider === 'zernio' && !automationReady ? (
        <Alert variant="warning">
          حساب Zernio متصل است. ایجاد اتوماسیون پس از تکمیل آداپتور Webhook و ارسال Zernio در مرحلهٔ بعد فعال می‌شود.
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon="⚡"
              title="هنوز اتوماسیونی نساخته‌اید"
              description="یک اتوماسیون بسازید تا وقتی کسی زیر پست شما کلیدواژهٔ موردنظرتان را کامنت کرد، به‌صورت خودکار برایش دایرکت ارسال شود."
              action={
                automationReady ? (
                  <Link href="/automations/new"><Button size="lg">ساخت اولین اتوماسیون</Button></Link>
                ) : (
                  <Link href="/instagram"><Button size="lg">اتصال اینستاگرام</Button></Link>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((a) => (
            <AutomationCard key={a.id} automation={{ ...a, lastRunAt: a.lastRunAt ? String(a.lastRunAt) : null }} />
          ))}
        </div>
      )}
    </div>
  );
}
