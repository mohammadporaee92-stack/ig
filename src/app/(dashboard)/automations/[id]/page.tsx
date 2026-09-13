import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { AutomationWizard } from '~/components/automation/wizard';
import { defaultDraft, emptyMessage, type AutomationDraft, type MessageDraft } from '~/components/automation/types';
import { Badge, Button } from '~/components/ui';

export const dynamic = 'force-dynamic';

const KIND_TO_KEY = {
  public_reply: 'publicReply',
  private_reply: 'privateReply',
  follow_gate: 'followGate',
  main: 'main',
} as const;

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { repos } = await getContainer();

  const automation = await repos.automations.findById(user.sub, id);
  if (!automation) notFound();

  const [accounts, keywords, templates] = await Promise.all([
    repos.accounts.listByUser(user.sub),
    repos.automations.listKeywords(id),
    repos.automations.listTemplates(id),
  ]);

  const draft: AutomationDraft = {
    ...defaultDraft(automation.instagram_account_id),
    name: automation.name,
    instagramAccountId: automation.instagram_account_id,
    status: automation.status as AutomationDraft['status'],
    keywords: keywords.filter((k) => !k.is_negative).map((k) => k.keyword),
    negativeKeywords: keywords.filter((k) => k.is_negative).map((k) => k.keyword),
    matchMode: automation.match_mode as AutomationDraft['matchMode'],
    caseSensitive: automation.case_sensitive,
    oncePerUserPerPost: automation.once_per_user_per_post,
    targetScope: automation.target_scope as AutomationDraft['targetScope'],
    targetMediaIds: safeJson<string[]>(automation.target_media_ids, []),
    publicReplyEnabled: automation.public_reply_enabled,
    privateReplyEnabled: automation.private_reply_enabled,
    followGateEnabled: automation.follow_gate_enabled,
    followChecker: automation.follow_checker as AutomationDraft['followChecker'],
    followUnknownPolicy: automation.follow_unknown_policy as AutomationDraft['followUnknownPolicy'],
    followRecheckLimit: automation.follow_recheck_limit,
    botDisclosureEnabled: automation.bot_disclosure_enabled,
    botDisclosureText: automation.bot_disclosure_text,
    linkUrl: automation.link_url ?? '',
    messages: {
      publicReply: emptyMessage(),
      privateReply: emptyMessage(),
      followGate: emptyMessage(),
      main: emptyMessage(),
    },
  };

  for (const t of templates) {
    const key = KIND_TO_KEY[t.kind as keyof typeof KIND_TO_KEY];
    if (!key) continue;
    const msg: MessageDraft = {
      body: t.body ?? '',
      attachments: safeJson(t.attachments, []),
      quickReplies: safeJson(t.quick_replies, []),
    };
    draft.messages[key] = msg;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{automation.name}</h1>
            {automation.status === 'active' ? <Badge variant="success">فعال</Badge> : null}
            {automation.status === 'draft' ? <Badge variant="muted">پیش‌نویس</Badge> : null}
            {automation.status === 'disabled' ? <Badge variant="warning">غیرفعال</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">ویرایش اتوماسیون · {automation.total_runs} اجرا</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/automations/${id}/logs`}><Button variant="outline">مشاهدهٔ لاگ‌ها</Button></Link>
          <Link href="/automations"><Button variant="ghost">بازگشت</Button></Link>
        </div>
      </div>

      <AutomationWizard
        automationId={id}
        initial={draft}
        accounts={accounts.filter((a) => a.status !== 'disconnected').map((a) => ({ id: a.id, username: a.username }))}
      />
    </div>
  );
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
