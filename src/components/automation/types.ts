export interface QuickReplyDraft {
  title: string;
  payload?: string;
}

export interface AttachmentDraft {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
}

export interface MessageDraft {
  body: string;
  attachments: AttachmentDraft[];
  quickReplies: QuickReplyDraft[];
}

export interface AutomationDraft {
  name: string;
  instagramAccountId: string;
  status: 'draft' | 'active' | 'disabled';
  keywords: string[];
  negativeKeywords: string[];
  matchMode: 'contains' | 'exact';
  caseSensitive: boolean;
  oncePerUserPerPost: boolean;
  targetScope: 'all_posts' | 'specific_posts';
  targetMediaIds: string[];
  publicReplyEnabled: boolean;
  privateReplyEnabled: boolean;
  followGateEnabled: boolean;
  followChecker: 'messaging_profile' | 'unsupported';
  followUnknownPolicy: 'deliver' | 'gate' | 'fail';
  followRecheckLimit: number;
  botDisclosureEnabled: boolean;
  botDisclosureText: string;
  linkUrl: string;
  messages: {
    publicReply: MessageDraft;
    privateReply: MessageDraft;
    followGate: MessageDraft;
    main: MessageDraft;
  };
}

export const emptyMessage = (body = ''): MessageDraft => ({ body, attachments: [], quickReplies: [] });

export function defaultDraft(instagramAccountId: string): AutomationDraft {
  return {
    name: '',
    instagramAccountId,
    status: 'draft',
    keywords: [],
    negativeKeywords: [],
    matchMode: 'contains',
    caseSensitive: false,
    oncePerUserPerPost: true,
    targetScope: 'all_posts',
    targetMediaIds: [],
    publicReplyEnabled: true,
    privateReplyEnabled: true,
    followGateEnabled: false,
    followChecker: 'messaging_profile',
    followUnknownPolicy: 'deliver',
    followRecheckLimit: 3,
    botDisclosureEnabled: true,
    botDisclosureText: 'این یک پاسخ خودکار است 🤖',
    linkUrl: '',
    messages: {
      publicReply: emptyMessage('پیام برات فرستادم، دایرکتو چک کن 📩'),
      privateReply: emptyMessage(
        'سلام {{first_name}} 👋\nدیدم زیر پست کامنت «{{keyword}}» گذاشتی.\nبرای دریافت فایل، دکمهٔ زیر رو بزن 👇',
      ),
      followGate: emptyMessage(
        'برای دریافت محتوا لازمه اول پیج رو فالو کنی 🙏\nبعد از فالو، دکمهٔ «بررسی مجدد» رو بزن.',
      ),
      main: emptyMessage('بفرما {{first_name}} 🎁\nاین هم لینک شما:\n{{link}}'),
    },
  };
}

export const VARIABLES = [
  { token: '{{username}}', label: 'نام کاربری' },
  { token: '{{first_name}}', label: 'نام کوچک' },
  { token: '{{comment}}', label: 'متن کامنت' },
  { token: '{{keyword}}', label: 'کلیدواژهٔ مطابقت‌یافته' },
  { token: '{{link}}', label: 'لینک شما' },
] as const;

export const WIZARD_STEPS = [
  { id: 1, title: 'نام', subtitle: 'شناسایی اتوماسیون' },
  { id: 2, title: 'تریگر', subtitle: 'چه چیزی آن را فعال می‌کند' },
  { id: 3, title: 'کلیدواژه‌ها', subtitle: 'چه کلماتی را رصد کنیم' },
  { id: 4, title: 'Follow Gate', subtitle: 'شرط فالو بودن' },
  { id: 5, title: 'پیام‌ها', subtitle: 'چه چیزی ارسال شود' },
  { id: 6, title: 'بازبینی', subtitle: 'بررسی نهایی' },
  { id: 7, title: 'فعال‌سازی', subtitle: 'شروع به کار' },
] as const;
