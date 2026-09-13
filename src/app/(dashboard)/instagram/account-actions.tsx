'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '~/components/ui';
import { apiPost } from '~/lib/api-client';

export function AccountActions({ accountId, webhookSubscribed }: { accountId: string; webhookSubscribed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(path: string, label: string) {
    setBusy(label);
    try {
      const res = await apiPost(path, { accountId });
      if (!res.ok) alert(res.error);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!webhookSubscribed ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => call('/api/instagram/resubscribe', 'sub')}
        >
          {busy === 'sub' ? '…' : 'فعال‌سازی Webhook'}
        </Button>
      ) : null}
      <a href="/api/instagram/connect?force=1">
        <Button variant="outline" size="sm">اتصال مجدد</Button>
      </a>
      <Button
        variant="destructive"
        size="sm"
        disabled={busy !== null}
        onClick={() => {
          if (confirm('اتصال این حساب قطع شود؟ اتوماسیون‌های مرتبط غیرفعال می‌شوند.')) {
            void call('/api/instagram/disconnect', 'disc');
          }
        }}
      >
        {busy === 'disc' ? '…' : 'قطع اتصال'}
      </Button>
    </div>
  );
}
