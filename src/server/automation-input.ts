import { z } from 'zod';
import type { Repositories } from '~/infra/db/repositories';
import { normalizeText } from '~/domain/keyword/engine';
import { MAX_MESSAGE_BYTES, byteLength } from '~/domain/messaging/renderer';

/** اعتبارسنجی مطابق محدودیت‌های رسمی Instagram */
const quickReplySchema = z.object({
  title: z.string().min(1).max(20, 'عنوان دکمه حداکثر ۲۰ کاراکتر (محدودیت رسمی)'),
  payload: z.string().max(1000).optional(),
});

const attachmentSchema = z.object({
  // طبق مستندات رسمی: image(png/jpeg ≤8MB), video(≤25MB), audio(≤25MB), file = PDF فقط (≤25MB)
  type: z.enum(['image', 'video', 'audio', 'file']),
  url: z.string().url('آدرس فایل باید URL معتبر باشد'),
});

const messageSchema = z.object({
  body: z.string().max(4000).default(''),
  attachments: z.array(attachmentSchema).max(10).default([]),
  quickReplies: z.array(quickReplySchema).max(13, 'حداکثر ۱۳ دکمه (محدودیت رسمی)').default([]),
});

export const automationInputSchema = z.object({
  name: z.string().min(1, 'نام اتوماسیون الزامی است').max(120),
  instagramAccountId: z.string().min(1, 'حساب اینستاگرام را انتخاب کنید'),
  status: z.enum(['draft', 'active', 'disabled']).default('draft'),
  keywords: z.array(z.string().min(1).max(80)).min(1, 'حداقل یک کلیدواژه لازم است').max(50),
  negativeKeywords: z.array(z.string().min(1).max(80)).max(50).default([]),
  matchMode: z.enum(['contains', 'exact']).default('contains'),
  caseSensitive: z.boolean().default(false),
  oncePerUserPerPost: z.boolean().default(true),
  targetScope: z.enum(['all_posts', 'specific_posts']).default('all_posts'),
  targetMediaIds: z.array(z.string()).default([]),
  publicReplyEnabled: z.boolean().default(true),
  privateReplyEnabled: z.boolean().default(true),
  followGateEnabled: z.boolean().default(false),
  followChecker: z.enum(['messaging_profile', 'unsupported']).default('messaging_profile'),
  followUnknownPolicy: z.enum(['deliver', 'gate', 'fail']).default('deliver'),
  followRecheckLimit: z.number().int().min(1).max(10).default(3),
  botDisclosureEnabled: z.boolean().default(true),
  botDisclosureText: z.string().max(200).default('این یک پاسخ خودکار است 🤖'),
  // لینکی که متغیر {{link}} با آن جایگزین می‌شود
  linkUrl: z.union([z.string().url('لینک باید آدرس معتبر باشد'), z.literal('')]).default(''),
  messages: z.object({
    publicReply: messageSchema.default({ body: '', attachments: [], quickReplies: [] }),
    privateReply: messageSchema.default({ body: '', attachments: [], quickReplies: [] }),
    followGate: messageSchema.default({ body: '', attachments: [], quickReplies: [] }),
    main: messageSchema.default({ body: '', attachments: [], quickReplies: [] }),
  }),
}).superRefine((input, ctx) => {
  // پیش‌نویس می‌تواند ناقص باشد؛ Automation فعال باید حتماً یک Flow قابل اجرا بسازد.
  if (input.status !== 'active') return;

  const issue = (path: Array<string | number>, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  if (input.targetScope === 'specific_posts' && input.targetMediaIds.length === 0) {
    issue(['targetMediaIds'], 'برای محدودهٔ پست مشخص، حداقل یک Media ID لازم است');
  }
  if (input.publicReplyEnabled && !input.messages.publicReply.body.trim()) {
    issue(['messages', 'publicReply', 'body'], 'متن پاسخ عمومی نمی‌تواند خالی باشد');
  }

  const mainHasContent = Boolean(
    input.messages.main.body.trim() || input.messages.main.attachments.length,
  );
  if (!mainHasContent) {
    issue(['messages', 'main'], 'محتوای اصلی نمی‌تواند خالی باشد');
  }
  if (!input.privateReplyEnabled) {
    issue(
      ['privateReplyEnabled'],
      'برای ارسال محتوای اصلی، Private Reply باید فعال باشد تا کاربر بتواند تعامل کند',
    );
  } else {
    if (!input.messages.privateReply.body.trim()) {
      issue(['messages', 'privateReply', 'body'], 'متن Private Reply نمی‌تواند خالی باشد');
    }
  }
  if (input.followGateEnabled && !input.messages.followGate.body.trim()) {
    issue(['messages', 'followGate', 'body'], 'متن Follow Gate نمی‌تواند خالی باشد');
  }
});

export type AutomationInput = z.infer<typeof automationInputSchema>;

/** قواعدی که فقط به اجرای مستقیم Meta مربوط‌اند، نه اتوماسیون native زرنيو. */
export function validateProviderRequirements(input: AutomationInput, provider: string): string | null {
  if (
    provider !== 'zernio' &&
    input.status === 'active' &&
    input.privateReplyEnabled &&
    input.messages.privateReply.quickReplies.length === 0
  ) {
    return 'حداقل یک Quick Reply برای بازشدن پنجرهٔ ادامهٔ گفتگو لازم است';
  }
  return null;
}

/** بررسی محدودیت ۱۰۰۰ بایتی متن پیام‌های دایرکت */
export function validateMessageSizes(input: AutomationInput): string | null {
  const checks: Array<[string, string]> = [
    ['پیام خصوصی', input.messages.privateReply.body],
    ['پیام Follow Gate', input.messages.followGate.body],
    ['پیام اصلی', input.messages.main.body],
  ];
  for (const [label, body] of checks) {
    if (byteLength(body) > MAX_MESSAGE_BYTES) {
      return `${label} از حد مجاز ${MAX_MESSAGE_BYTES} بایت طولانی‌تر است (محدودیت رسمی Instagram)`;
    }
  }
  return null;
}

export async function saveKeywordsAndTemplates(
  repos: Repositories,
  userId: string,
  automationId: string,
  input: AutomationInput,
): Promise<void> {
  const all = [
    ...input.keywords.map((k) => ({ keyword: k, keywordNorm: normalizeText(k, input.caseSensitive), isNegative: false })),
    ...input.negativeKeywords.map((k) => ({ keyword: k, keywordNorm: normalizeText(k, input.caseSensitive), isNegative: true })),
  ].filter((k) => k.keywordNorm.length > 0);

  await repos.automations.replaceKeywords(userId, automationId, all);

  const kinds: Array<['public_reply' | 'private_reply' | 'follow_gate' | 'main', typeof input.messages.main]> = [
    ['public_reply', input.messages.publicReply],
    ['private_reply', input.messages.privateReply],
    ['follow_gate', input.messages.followGate],
    ['main', input.messages.main],
  ];
  for (const [kind, msg] of kinds) {
    await repos.automations.upsertTemplate(userId, automationId, kind, {
      body: msg.body,
      attachments: msg.attachments,
      quickReplies: msg.quickReplies,
    });
  }
}
