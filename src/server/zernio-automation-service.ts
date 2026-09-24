import type { InstagramAccountRow, Repositories } from '~/infra/db/repositories';
import type {
  ZernioClient,
  ZernioCommentAutomationInput,
  ZernioCommentAutomationPatch,
} from '~/infra/zernio/client';
import { MAX_MESSAGE_BYTES, byteLength } from '~/domain/messaging/renderer';
import { automationInputSchema, type AutomationInput } from './automation-input';

export class ZernioAutomationValidationError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = 'ZernioAutomationValidationError';
  }
}

export interface ZernioSyncResult {
  remoteId: string | null;
  state: 'local' | 'synced';
}

/**
 * اتوماسیون native خود Zernio تنها اجراکنندهٔ حساب‌های Zernio است.
 * Webhookهای Zernio عمداً وارد AutomationEngine محلی نمی‌شوند تا یک کامنت
 * دو پاسخ خصوصی دریافت نکند.
 */
export class ZernioAutomationService {
  constructor(
    private readonly repos: Repositories,
    private readonly client: ZernioClient,
  ) {}

  async sync(
    userId: string,
    localId: string,
    account: InstagramAccountRow,
    input: AutomationInput,
  ): Promise<ZernioSyncResult> {
    if (account.provider !== 'zernio') return { remoteId: null, state: 'local' };

    const existing = await this.repos.automations.findById(userId, localId);
    if (!existing) throw new Error('اتوماسیون محلی یافت نشد');

    try {
      if (!account.provider_account_id || !account.provider_profile_id) {
        throw new ZernioAutomationValidationError('شناسه‌های حساب Zernio ناقص است؛ حساب را دوباره Import کنید');
      }

      // پیش‌نویس محلی تا زمان فعال‌سازی چیزی در Zernio ایجاد نمی‌کند.
      if (input.status !== 'active' && !existing.provider_automation_id) {
        await this.repos.automations.setProviderSync(userId, localId, { status: 'local' });
        return { remoteId: null, state: 'local' };
      }

      const payload = buildZernioAutomationInput(localId, account, input);
      let remoteId = existing.provider_automation_id;

      // بازیابی بعد از timeout مبهم: پیش از create، اتوماسیون markerدار را پیدا می‌کنیم.
      if (!remoteId) {
        const marker = automationMarker(localId);
        const remote = (await this.client.listCommentAutomations(account.provider_profile_id))
          .find((item) => item.accountId === account.provider_account_id && item.name.startsWith(marker));
        remoteId = remote?.id ?? null;
      }

      if (input.status !== 'active') {
        if (remoteId) await this.client.updateCommentAutomation(remoteId, { isActive: false });
        await this.repos.automations.setProviderSync(userId, localId, {
          remoteId,
          status: remoteId ? 'synced' : 'local',
        });
        return { remoteId, state: remoteId ? 'synced' : 'local' };
      }

      if (remoteId) {
        await this.client.updateCommentAutomation(remoteId, { ...toPatch(payload), isActive: true });
      } else {
        remoteId = (await this.client.createCommentAutomation(payload)).id;
      }

      await this.repos.automations.setProviderSync(userId, localId, {
        remoteId,
        status: 'synced',
      });
      return { remoteId, state: 'synced' };
    } catch (error) {
      await this.repos.automations.setProviderSync(userId, localId, {
        status: 'error',
        error: (error as Error).message.slice(0, 1000),
      });
      throw error;
    }
  }

  async remove(userId: string, localId: string): Promise<void> {
    const automation = await this.repos.automations.findById(userId, localId);
    if (!automation?.provider_automation_id) return;
    await this.client.deleteCommentAutomation(automation.provider_automation_id);
  }
}

export function buildZernioAutomationInput(
  localId: string,
  account: InstagramAccountRow,
  input: AutomationInput,
): ZernioCommentAutomationInput {
  if (!account.provider_account_id || !account.provider_profile_id) {
    throw new ZernioAutomationValidationError('شناسه‌های Zernio ناقص است');
  }
  if (input.targetScope === 'specific_posts' && input.targetMediaIds.length > 1) {
    throw new ZernioAutomationValidationError('در Zernio هر اتوماسیون می‌تواند فقط به یک پست مشخص محدود شود');
  }

  const attachments = Object.values(input.messages).flatMap((message) => message.attachments);
  if (attachments.length) {
    throw new ZernioAutomationValidationError('پیوست فایل در Comment Automation زرنیو پشتیبانی نمی‌شود؛ لینک عمومی فایل را در متن قرار دهید');
  }

  const values: Record<string, string> = {
    '{{first_name}}': 'دوست عزیز',
    '{{username}}': 'دوست عزیز',
    '{{comment}}': 'کامنت شما',
    '{{keyword}}': input.keywords[0] ?? 'کلیدواژه',
    '{{link}}': input.linkUrl,
  };
  const render = (text: string) => Object.entries(values)
    .reduce((result, [token, value]) => result.split(token).join(value), text)
    .trim();

  const parts = [render(input.messages.privateReply.body), render(input.messages.main.body)];
  if (input.botDisclosureEnabled && input.botDisclosureText.trim()) parts.push(input.botDisclosureText.trim());
  const dmMessage = parts.filter(Boolean).join('\n\n');
  if (byteLength(dmMessage) > MAX_MESSAGE_BYTES) {
    throw new ZernioAutomationValidationError(`مجموع پیام خصوصی و محتوای اصلی از ${MAX_MESSAGE_BYTES} بایت بیشتر است`);
  }

  const payload: ZernioCommentAutomationInput = {
    profileId: account.provider_profile_id,
    accountId: account.provider_account_id,
    name: `${automationMarker(localId)} ${input.name}`.slice(0, 120),
    dmMessage,
    keywords: input.keywords,
    excludeKeywords: input.negativeKeywords,
    matchMode: input.matchMode,
    commentReply: input.publicReplyEnabled ? render(input.messages.publicReply.body) : undefined,
  };

  if (input.targetScope === 'specific_posts') payload.platformPostId = input.targetMediaIds[0];
  if (input.followGateEnabled) {
    const gate = render(input.messages.followGate.body);
    payload.audience = {
      followerStatus: 'follower',
      whenUnknown: input.followUnknownPolicy === 'fail' ? 'skip' : 'verify',
    };
    payload.followGate = {
      message: gate,
      buttonLabel: 'بررسی فالو',
      notFollowingMessage: gate,
    };
  } else {
    payload.audience = { followerStatus: 'any', whenUnknown: 'send' };
  }
  return payload;
}

function automationMarker(localId: string): string {
  return `[IGFlow:${localId}]`;
}

function toPatch(input: ZernioCommentAutomationInput): ZernioCommentAutomationPatch {
  const { profileId: _profileId, accountId: _accountId, ...patch } = input;
  return patch;
}

export async function readAutomationInput(
  repos: Repositories,
  userId: string,
  localId: string,
  statusOverride?: AutomationInput['status'],
): Promise<AutomationInput> {
  const automation = await repos.automations.findById(userId, localId);
  if (!automation) throw new Error('اتوماسیون یافت نشد');
  const [keywords, templates] = await Promise.all([
    repos.automations.listKeywords(localId),
    repos.automations.listTemplates(localId),
  ]);
  const message = (kind: string) => {
    const template = templates.find((item) => item.kind === kind);
    return {
      body: template?.body ?? '',
      attachments: JSON.parse(template?.attachments || '[]') as unknown[],
      quickReplies: JSON.parse(template?.quick_replies || '[]') as unknown[],
    };
  };

  return automationInputSchema.parse({
    name: automation.name,
    instagramAccountId: automation.instagram_account_id,
    status: statusOverride ?? automation.status,
    keywords: keywords.filter((item) => !item.is_negative).map((item) => item.keyword),
    negativeKeywords: keywords.filter((item) => item.is_negative).map((item) => item.keyword),
    matchMode: automation.match_mode,
    caseSensitive: automation.case_sensitive,
    oncePerUserPerPost: automation.once_per_user_per_post,
    targetScope: automation.target_scope,
    targetMediaIds: JSON.parse(automation.target_media_ids || '[]'),
    publicReplyEnabled: automation.public_reply_enabled,
    privateReplyEnabled: automation.private_reply_enabled,
    followGateEnabled: automation.follow_gate_enabled,
    followChecker: automation.follow_checker,
    followUnknownPolicy: automation.follow_unknown_policy,
    followRecheckLimit: automation.follow_recheck_limit,
    botDisclosureEnabled: automation.bot_disclosure_enabled,
    botDisclosureText: automation.bot_disclosure_text,
    linkUrl: automation.link_url,
    messages: {
      publicReply: message('public_reply'),
      privateReply: message('private_reply'),
      followGate: message('follow_gate'),
      main: message('main'),
    },
  });
}
