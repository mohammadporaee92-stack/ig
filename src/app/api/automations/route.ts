import { json, error, readJson, withAuth } from '../_lib/handler';
import { listAutomationSummaries } from '~/server/queries';
import {
  automationInputSchema,
  saveKeywordsAndTemplates,
  validateMessageSizes,
  validateProviderRequirements,
} from '~/server/automation-input';
import { ZernioApiError } from '~/infra/zernio/client';
import { ZernioAutomationService, ZernioAutomationValidationError } from '~/server/zernio-automation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async ({ user, container }) => {
  const items = await listAutomationSummaries(container.repos, user.sub);
  return json({ items });
});

export const POST = withAuth(
  async ({ user, container, request }) => {
    const input = await readJson(request, automationInputSchema);

    // حساب باید متعلق به همین tenant باشد
    const account = await container.repos.accounts.findById(user.sub, input.instagramAccountId);
    if (!account) return error('حساب اینستاگرام یافت نشد', 404);

    const sizeError = validateMessageSizes(input);
    if (sizeError) return error(sizeError, 422);
    const providerError = validateProviderRequirements(input, account.provider);
    if (providerError) return error(providerError, 422);

    const automation = await container.repos.automations.create(user.sub, {
      instagram_account_id: input.instagramAccountId,
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

    await saveKeywordsAndTemplates(container.repos, user.sub, automation.id, input);

    if (account.provider === 'zernio') {
      try {
        await new ZernioAutomationService(container.repos, container.zernioClient)
          .sync(user.sub, automation.id, account, input);
      } catch (err) {
        if (err instanceof ZernioAutomationValidationError) return error(err.message, err.status, { id: automation.id });
        if (err instanceof ZernioApiError) return error(`همگام‌سازی Zernio ناموفق بود: ${err.message}`, err.status || 502, { id: automation.id, code: err.code });
        throw err;
      }
    }

    await container.repos.audit.log({
      userId: user.sub, action: 'automation.create', entityType: 'automation', entityId: automation.id,
    });

    return json({ id: automation.id, provider: account.provider }, 201);
  },
  { mutation: true },
);
