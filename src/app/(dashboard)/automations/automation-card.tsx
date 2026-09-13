'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardContent, Switch } from '~/components/ui';
import { formatNumber, relativeTime } from '~/lib/utils';
import { apiDelete, apiPatch } from '~/lib/api-client';

export interface AutomationCardData {
  id: string;
  name: string;
  status: string;
  keywords: string[];
  followGate: boolean;
  publicReply: boolean;
  privateReply: boolean;
  totalRuns: number;
  delivered: number;
  failed: number;
  lastRunAt: string | null;
}

export function AutomationCard({ automation: a }: { automation: AutomationCardData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(a.status);

  async function patch(action: 'enable' | 'disable' | 'duplicate') {
    setBusy(true);
    try {
      const res = await apiPatch<{ status?: string; id?: string }>(`/api/automations/${a.id}`, { action });
      if (!res.ok) { alert(res.error); return; }
      if (res.data.status) setStatus(res.data.status);
      if (action === 'duplicate' && res.data.id) { router.push(`/automations/${res.data.id}`); return; }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`اتوماسیون «${a.name}» حذف شود؟ این عمل بازگشت‌پذیر نیست.`)) return;
    setBusy(true);
    try {
      const res = await apiDelete(`/api/automations/${a.id}`);
      if (!res.ok) alert(res.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/automations/${a.id}`} className="block truncate text-base font-semibold text-slate-900 hover:text-brand-600">
              {a.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {status === 'active' ? <Badge variant="success">فعال</Badge> : null}
              {status === 'draft' ? <Badge variant="muted">پیش‌نویس</Badge> : null}
              {status === 'disabled' ? <Badge variant="warning">غیرفعال</Badge> : null}
              {a.followGate ? <Badge variant="purple">Follow Gate</Badge> : null}
              {a.publicReply ? <Badge variant="info">پاسخ عمومی</Badge> : null}
            </div>
          </div>
          <Switch
            checked={status === 'active'}
            disabled={busy}
            onCheckedChange={(v) => void patch(v ? 'enable' : 'disable')}
            aria-label="فعال/غیرفعال"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {a.keywords.slice(0, 6).map((k) => (
            <span key={k} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{k}</span>
          ))}
          {a.keywords.length > 6 ? (
            <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-400">+{a.keywords.length - 6}</span>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
          <div>
            <p className="tabular text-lg font-bold text-slate-900">{formatNumber(a.totalRuns)}</p>
            <p className="text-xs text-slate-500">اجرا</p>
          </div>
          <div>
            <p className="tabular text-lg font-bold text-emerald-600">{formatNumber(a.delivered)}</p>
            <p className="text-xs text-slate-500">تحویل موفق</p>
          </div>
          <div>
            <p className={`tabular text-lg font-bold ${a.failed ? 'text-red-600' : 'text-slate-400'}`}>{formatNumber(a.failed)}</p>
            <p className="text-xs text-slate-500">خطا</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {a.lastRunAt ? `آخرین اجرا: ${relativeTime(a.lastRunAt)}` : 'هنوز اجرا نشده'}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/automations/${a.id}`}><Button variant="outline" size="sm">ویرایش</Button></Link>
            <Link href={`/automations/${a.id}/logs`}><Button variant="ghost" size="sm">لاگ‌ها</Button></Link>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void patch('duplicate')}>کپی</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()} className="text-red-600 hover:bg-red-50">حذف</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
