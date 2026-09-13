import { z } from 'zod';
import { error, json, withAuth } from '../../_lib/handler';
import { automationInputSchema, saveKeywordsAndTemplates, validateMessageSizes } from '~/server/automation-input';
import { newId } from '~/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  // /api/automations/<id>
  return parts[2] ?? '';
}

export const GET = withAuth(async ({ user, container, request }) => {
  const id = idFrom(request);
  const automation = await container.repos.automations.findById(user.sub, id);
  if (!automation) return error('اتوماسیون یافت نشد', 404);

  const [keywords, templates] = await Promise.all([
    container.repos.automations.listKeywords(id),
    container.repos.automations.listTemplates(id),
  ]);

  return json({
    automation,
    keywords: keywords.map((k) => ({ keyword: k.keyword, isNegative: k.is_negative })),
    templates: templates.map((t) => ({
      kind: t.kind,
      body: t.body,
      attachments: JSON.parse(t.attachments || '[]'),
      quickReplies: JSON.parse(t.quick_replies || '[]'),
    })),
  });
});

export const PUT = withAuth(
  async ({ user, container, request }) => {
    const id = idFrom(request);
    const existing = await container.repos.automations.findById(user.sub, id);
    if (!existing) return error('اتوماسیون یافت نشد', 404);

    const input = automationInputSchema.parse(await request.json());
    const account = await container.repos.accounts.findById(user.sub, input.instagramAccountId);
    if (!account) return error('حساب اینستاگرام یافت نشد', 404);

    const sizeError = validateMessageSizes(input);
    if (sizeError) return error(sizeError, 422);

    await container.repos.automations.update(user.sub, id, {
      name: input.name,
      status: input.status,
      match_mode: input.matchMode,
      case_sensitive: input.caseSensitive,
      once_per_user_per_post: input.oncePerUserPerPost,
      target_scope: input.targetScope,
      target_media_ids: JSON.stringify(input.targetMediaIds),
      public_reply_enabled: input.publicReplyEnabled,
      private_reply_enabled: input.privateReplyEnabled,
      follow_gate_enabled: input.followGateEnabled,
      follow_checker: input.followChecker,
      follow_unknown_policy: input.followUnknownPolicy,
      follow_recheck_limit: input.followRecheckLimit,
      bot_disclosure_enabled: input.botDisclosureEnabled,
      bot_disclosure_text: input.botDisclosureText,
      link_url: input.linkUrl,
    });
    await saveKeywordsAndTemplates(container.repos, user.sub, id, input);
    await container.repos.audit.log({ userId: user.sub, action: 'automation.update', entityType: 'automation', entityId: id });
    return json({ ok: true });
  },
  { mutation: true },
);

const patchSchema = z.object({ action: z.enum(['enable', 'disable', 'duplicate']) });

export const PATCH = withAuth(
  async ({ user, container, request }) => {
    const id = idFrom(request);
    const existing = await container.repos.automations.findById(user.sub, id);
    if (!existing) return error('اتوماسیون یافت نشد', 404);

    const { action } = patchSchema.parse(await request.json());

    if (action === 'enable' || action === 'disable') {
      await container.repos.automations.update(user.sub, id, { status: action === 'enable' ? 'active' : 'disabled' });
      await container.repos.audit.log({ userId: user.sub, action: `automation.${action}`, entityType: 'automation', entityId: id });
      return json({ ok: true, status: action === 'enable' ? 'active' : 'disabled' });
    }

    // duplicate
    const copy = await container.repos.automations.create(user.sub, {
      ...existing,
      id: newId('atm'),
      name: `${existing.name} (کپی)`,
      status: 'draft',
      instagram_account_id: existing.instagram_account_id,
    });
    const keywords = await container.repos.automations.listKeywords(id);
    await container.repos.automations.replaceKeywords(
      user.sub, copy.id,
      keywords.map((k) => ({ keyword: k.keyword, keywordNorm: k.keyword_norm, matchMode: k.match_mode, isNegative: k.is_negative })),
    );
    for (const t of await container.repos.automations.listTemplates(id)) {
      await container.repos.automations.upsertTemplate(user.sub, copy.id, t.kind, {
        body: t.body,
        attachments: JSON.parse(t.attachments || '[]'),
        quickReplies: JSON.parse(t.quick_replies || '[]'),
      });
    }
    return json({ ok: true, id: copy.id }, 201);
  },
  { mutation: true },
);

export const DELETE = withAuth(
  async ({ user, container, request }) => {
    const id = idFrom(request);
    const deleted = await container.repos.automations.delete(user.sub, id);
    if (!deleted) return error('اتوماسیون یافت نشد', 404);
    await container.repos.audit.log({ userId: user.sub, action: 'automation.delete', entityType: 'automation', entityId: id });
    return json({ ok: true });
  },
  { mutation: true },
);
