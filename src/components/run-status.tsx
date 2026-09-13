import { Badge } from './ui';

const LABELS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'purple' }> = {
  received: { label: 'دریافت شد', variant: 'muted' },
  keyword_matched: { label: 'کلیدواژه یافت شد', variant: 'info' },
  public_reply_sent: { label: 'پاسخ عمومی', variant: 'info' },
  private_reply_sent: { label: 'دایرکت ارسال شد', variant: 'info' },
  awaiting_user_interaction: { label: 'در انتظار کاربر ⏳', variant: 'warning' },
  follow_checked: { label: 'فالو بررسی شد', variant: 'info' },
  follow_gate_sent: { label: 'درخواست فالو', variant: 'warning' },
  main_message_sent: { label: 'پیام اصلی ارسال شد', variant: 'success' },
  completed: { label: 'تکمیل شد ✅', variant: 'success' },
  failed: { label: 'ناموفق ❌', variant: 'danger' },
  skipped: { label: 'رد شد', variant: 'muted' },
};

export function RunStatusBadge({ status, followStatus }: { status: string; followStatus?: string | null }) {
  const info = LABELS[status] ?? { label: status, variant: 'default' as const };
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={info.variant}>{info.label}</Badge>
      {followStatus === 'following' ? <Badge variant="success">فالو ✅</Badge> : null}
      {followStatus === 'not_following' ? <Badge variant="warning">فالو ندارد</Badge> : null}
      {followStatus === 'unknown' ? <Badge variant="muted">فالو نامشخص</Badge> : null}
    </span>
  );
}
