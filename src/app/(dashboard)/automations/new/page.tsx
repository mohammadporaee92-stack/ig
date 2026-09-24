import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { AutomationWizard } from '~/components/automation/wizard';
import { Alert } from '~/components/ui';

export const dynamic = 'force-dynamic';

export default async function NewAutomationPage() {
  const user = await requireUser();
  const { repos } = await getContainer();
  const accounts = await repos.accounts.listByUser(user.sub);
  const readyAccounts = accounts.filter((a) => a.status === 'connected' && a.provider !== 'zernio');
  const waitingForZernio = readyAccounts.length === 0 && accounts.some((a) => a.status === 'connected' && a.provider === 'zernio');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">اتوماسیون جدید</h1>
        <p className="mt-1 text-sm text-slate-500">در ۷ گام ساده اتوماسیون خود را بسازید</p>
      </div>
      {waitingForZernio ? (
        <Alert variant="warning">
          حساب Zernio شما متصل است، اما ساخت اتوماسیون تا نصب آداپتور Webhook و ارسال Zernio در مرحلهٔ بعد غیرفعال می‌ماند.
        </Alert>
      ) : null}
      <AutomationWizard
        accounts={readyAccounts
          .map((a) => ({ id: a.id, username: a.username }))}
      />
    </div>
  );
}
