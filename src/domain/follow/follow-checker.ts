/**
 * ════════════════════════════════════════════════════════════════════
 *  Follow Gate — Abstraction
 * ════════════════════════════════════════════════════════════════════
 *
 * وضعیت رسمی (به تاریخ ۲۰۲۶/۰۹/۱۲ — بخش ۱.۳ سند Capability Audit):
 *
 *   ✅ API رسمی برای «آیا این کاربر ما را فالو کرده؟» وجود دارد:
 *        GET https://graph.instagram.com/<VER>/<IGSID>
 *            ?fields=is_user_follow_business,is_business_follow_user,username,name
 *
 *   ⚠️ اما مشروط به USER CONSENT است. مستند رسمی User Profile API:
 *        «User consent is set only when an Instagram user sends a message to your
 *         app user, or clicks an icebreaker or persistent menu. If an Instagram user
 *         comments on a post ... your app will receive an error:
 *         User consent is required to access user profile.»
 *
 *   ❌ هیچ webhook رسمی برای رویداد follow/unfollow وجود ندارد.
 *   ❌ هیچ endpoint رسمی برای گرفتن لیست فالوورها وجود ندارد.
 *
 * نتیجهٔ معماری: Follow Check «بعد از» اولین تعامل کاربر در دایرکت انجام می‌شود
 * (Quick Reply روی Private Reply). هیچ scraping/automation/private API استفاده نشده.
 */

export type FollowStatus = 'following' | 'not_following' | 'unknown';

export type FollowCheckReason =
  /** پاسخ قطعی از API رسمی */
  | 'ok'
  /** کاربر هنوز پیام/تعاملی نفرستاده ⇒ طبق مستندات رسمی consent وجود ندارد */
  | 'consent_required'
  /** این checker در شرایط فعلی قابلیت را پشتیبانی نمی‌کند */
  | 'unsupported'
  /** کاربر بیزنس را بلاک کرده */
  | 'blocked'
  /** خطای شبکه/دسترسی/توکن */
  | 'api_error';

export interface FollowCheckInput {
  /** Instagram-scoped ID کاربر تعامل‌کننده */
  igsid: string;
  /** شناسهٔ حساب Professional متصل (IG_ID) */
  instagramAccountId: string;
  /** آیا طبق دادهٔ ما کاربر قبلاً پیام داده / دکمه زده است؟ */
  hasMessagingConsent: boolean;
}

export interface FollowCheckResult {
  status: FollowStatus;
  reason: FollowCheckReason;
  /** توضیح خوانا برای UI/لاگ */
  detail?: string;
  /** دادهٔ جانبی رسمی که همراه چک برگشته */
  profile?: {
    username?: string;
    name?: string;
    followerCount?: number;
    isBusinessFollowUser?: boolean;
  };
  checkedAt: Date;
}

export interface FollowChecker {
  /** شناسهٔ یکتا برای ذخیره در DB و انتخاب در UI */
  readonly id: string;
  /** نام قابل نمایش */
  readonly label: string;
  /** آیا این پیاده‌سازی در شرایط فعلی کار می‌کند؟ */
  readonly supported: boolean;
  /** شرایطی که باید برقرار باشد تا چک قطعی باشد (برای نمایش در UI) */
  readonly requirements: readonly string[];
  check(input: FollowCheckInput): Promise<FollowCheckResult>;
}

/**
 * پیاده‌سازی Fallback:
 * وقتی هیچ راه رسمی‌ای در دسترس نیست، صادقانه 'unknown/unsupported' برمی‌گرداند.
 * هرگز حدس نمی‌زند، هرگز جعل نمی‌کند.
 */
export class UnsupportedFollowChecker implements FollowChecker {
  readonly id = 'unsupported';
  readonly label = 'غیرفعال (بدون بررسی فالو)';
  readonly supported = false;
  readonly requirements = [
    'در این حالت هیچ بررسی فالویی انجام نمی‌شود و وضعیت همیشه unknown است.',
  ];

  async check(_input: FollowCheckInput): Promise<FollowCheckResult> {
    return {
      status: 'unknown',
      reason: 'unsupported',
      detail:
        'بررسی فالو در این Automation غیرفعال است یا API رسمی در شرایط فعلی این قابلیت را ارائه نمی‌دهد.',
      checkedAt: new Date(),
    };
  }
}

/**
 * 🔮 رزرو برای آینده.
 * اگر Meta روزی یک endpoint رسمیِ بدون نیاز به consent برای بررسی رابطهٔ فالو ارائه کرد،
 * فقط همین کلاس پیاده‌سازی و در Registry ثبت می‌شود — Automation Engine دست نمی‌خورد.
 */
export class InstagramOfficialFollowChecker implements FollowChecker {
  readonly id = 'instagram_official';
  readonly label = 'Instagram Official Follow API (هنوز منتشر نشده)';
  readonly supported = false;
  readonly requirements = [
    'در حال حاضر Meta هیچ endpoint رسمی consent-free برای بررسی رابطهٔ فالو ارائه نمی‌دهد.',
    'این کلاس صرفاً نقطهٔ توسعهٔ آینده است.',
  ];

  async check(_input: FollowCheckInput): Promise<FollowCheckResult> {
    return {
      status: 'unknown',
      reason: 'unsupported',
      detail: 'endpoint رسمی برای این قابلیت هنوز توسط Meta ارائه نشده است.',
      checkedAt: new Date(),
    };
  }
}

/**
 * منبع رویداد فالو (webhook) — رسماً وجود ندارد.
 */
export interface FollowEventSource {
  readonly id: string;
  readonly supported: boolean;
  readonly reason: string;
}

export const UnsupportedFollowEventSource: FollowEventSource = {
  id: 'unsupported',
  supported: false,
  reason:
    'Instagram Platform هیچ فیلد webhook رسمی برای رویداد follow/unfollow ندارد. ' +
    'فیلدهای موجود: comments, live_comments, mentions, messages, message_echoes, ' +
    'message_reactions, messaging_handover, messaging_optins, messaging_postbacks, ' +
    'messaging_referral, messaging_seen, story_insights.',
};

/** رجیستری قابل توسعه */
export class FollowCheckerRegistry {
  private readonly map = new Map<string, FollowChecker>();

  register(checker: FollowChecker): this {
    this.map.set(checker.id, checker);
    return this;
  }

  get(id: string): FollowChecker {
    return this.map.get(id) ?? new UnsupportedFollowChecker();
  }

  list(): FollowChecker[] {
    return [...this.map.values()];
  }
}
