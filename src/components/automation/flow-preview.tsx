'use client';

import type { AutomationDraft } from './types';

function Node({
  icon,
  title,
  detail,
  tone = 'slate',
}: {
  icon: string;
  title: string;
  detail?: string;
  tone?: 'slate' | 'brand' | 'amber' | 'emerald' | 'sky';
}) {
  const tones: Record<string, string> = {
    slate: 'border-slate-200 bg-white',
    brand: 'border-brand-200 bg-brand-50',
    amber: 'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    sky: 'border-sky-200 bg-sky-50',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        <span className="text-sm font-semibold text-slate-800">{title}</span>
      </div>
      {detail ? <p className="mt-1 whitespace-pre-line text-xs leading-6 text-slate-600">{detail}</p> : null}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pr-4">
      <span className="text-slate-300">↓</span>
      {label ? <span className="text-xs text-slate-400">{label}</span> : null}
    </div>
  );
}

/** پیش‌نمایش بصری جریان — دقیقاً همان مسیری که موتور اجرا می‌کند */
export function FlowPreview({ draft }: { draft: AutomationDraft }) {
  const kw = draft.keywords.length ? draft.keywords.join('، ') : '—';

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">پیش‌نمایش جریان</h3>
      <div className="space-y-0">
        <Node icon="💬" title="کاربر زیر پست کامنت می‌گذارد" detail="Webhook: comments" />
        <Arrow />
        <Node
          icon="🔍"
          title="تشخیص کلیدواژه"
          detail={`کلیدواژه‌ها: ${kw}\nحالت: ${draft.matchMode === 'exact' ? 'تطابق دقیق' : 'شامل بودن'} · ${draft.caseSensitive ? 'حساس به حروف' : 'غیرحساس به حروف'}`}
          tone="brand"
        />
        {draft.publicReplyEnabled ? (
          <>
            <Arrow />
            <Node icon="📢" title="پاسخ عمومی زیر کامنت" detail={draft.messages.publicReply.body || '—'} tone="sky" />
          </>
        ) : null}
        {draft.privateReplyEnabled ? (
          <>
            <Arrow />
            <Node
              icon="📩"
              title="Private Reply (دایرکت خصوصی)"
              detail={`${draft.messages.privateReply.body || '—'}\n\nدکمه‌ها: ${
                draft.messages.privateReply.quickReplies.map((q) => q.title).filter(Boolean).join(' · ') || '—'
              }`}
              tone="brand"
            />
            <Arrow label="۱ بار برای هر کامنت · تا ۷ روز" />
            <Node
              icon="⏳"
              title="انتظار برای لمس دکمه توسط کاربر"
              detail="طبق قانون رسمی Meta تا کاربر پاسخ ندهد، «رضایت» ثبت نمی‌شود و پیام بعدی/بررسی فالو ممکن نیست."
              tone="amber"
            />
          </>
        ) : null}
        {draft.followGateEnabled ? (
          <>
            <Arrow label="پنجرهٔ ۲۴ ساعته باز شد" />
            <Node
              icon="🔒"
              title="بررسی فالو (is_user_follow_business)"
              detail={`اگر نامشخص بود: ${
                { deliver: 'محتوا ارسال شود', gate: 'درخواست فالو نمایش داده شود', fail: 'اجرا ناموفق شود' }[
                  draft.followUnknownPolicy
                ]
              }`}
              tone="amber"
            />
            <Arrow label="فالو نکرده" />
            <Node
              icon="🙏"
              title="پیام درخواست فالو + دکمهٔ «بررسی مجدد»"
              detail={`${draft.messages.followGate.body || '—'}\nحداکثر ${draft.followRecheckLimit} بار تکرار`}
              tone="amber"
            />
            <Arrow label="فالو کرده ✅" />
          </>
        ) : (
          <Arrow />
        )}
        <Node icon="🎁" title="ارسال محتوای اصلی" detail={draft.messages.main.body || '—'} tone="emerald" />
        <Arrow />
        <Node icon="✅" title="اجرا تکمیل شد" detail="delivered = true" tone="emerald" />
      </div>
    </div>
  );
}
