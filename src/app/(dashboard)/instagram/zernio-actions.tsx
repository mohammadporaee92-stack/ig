'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '~/lib/api-client';
import { Alert, Badge, Button } from '~/components/ui';

export interface ZernioAccountOption {
  id: string;
  username: string;
  displayName?: string;
  profilePictureUrl?: string;
  isActive: boolean;
}

export function ZernioImportAction({
  enabled,
  accounts,
  importedProviderAccountIds,
}: {
  enabled: boolean;
  accounts: ZernioAccountOption[];
  importedProviderAccountIds: string[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const imported = new Set(importedProviderAccountIds);

  async function importAccount(account: ZernioAccountOption) {
    setBusyId(account.id);
    setMessage(null);
    try {
      const response = await apiPost<{ account?: { username?: string } }>('/api/zernio/accounts', {
        accountId: account.id,
      });
      if (!response.ok) throw new Error(response.error);
      setMessage({
        kind: 'success',
        text: `حساب @${response.data.account?.username ?? account.username} با موفقیت به IGFlow اضافه شد.`,
      });
      router.refresh();
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {accounts.length === 0 ? (
        <p className="text-sm text-slate-500">هیچ حساب Instagram در Zernio پیدا نشد.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const isImported = imported.has(account.id);
            return (
              <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">📸</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="font-medium text-slate-800">@{account.username}</span>
                      {isImported ? <Badge variant="success">Connected ✅</Badge> : null}
                      {!account.isActive ? <Badge variant="warning">غیرفعال در Zernio</Badge> : null}
                    </div>
                    {account.displayName ? <p className="truncate text-xs text-slate-500">{account.displayName}</p> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant={isImported ? 'outline' : 'secondary'}
                  disabled={!enabled || !account.isActive || isImported || busyId !== null}
                  onClick={() => void importAccount(account)}
                >
                  {isImported ? 'متصل شده' : busyId === account.id ? 'در حال اتصال…' : 'اتصال به IGFlow'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
    </div>
  );
}
