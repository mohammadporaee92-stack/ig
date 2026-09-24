'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '~/lib/api-client';
import { Alert, Button } from '~/components/ui';

export function ZernioImportAction({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  async function importAccount() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiPost<{ account?: { username?: string } }>('/api/zernio/accounts', {});
      if (!response.ok) throw new Error(response.error);
      setMessage({
        kind: 'success',
        text: `حساب @${response.data.account?.username ?? 'Instagram'} از Zernio با موفقیت شناسایی شد.`,
      });
      router.refresh();
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button size="lg" disabled={!enabled || busy} onClick={importAccount}>
        {busy ? 'در حال بررسی…' : 'اتصال حساب موجود در Zernio'}
      </Button>
      {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
    </div>
  );
}
