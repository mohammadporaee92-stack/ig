import type {
  FollowCheckInput,
  FollowChecker,
  FollowCheckResult,
} from '~/domain/follow/follow-checker';
import { createLogger } from '~/lib/logger';
import type { InstagramClient } from './client';
import { InstagramApiError } from './errors';

const log = createLogger('follow-checker');

export interface TokenProvider {
  /** توکن رمزگشایی‌شده برای حساب Professional مشخص */
  getAccessToken(instagramAccountId: string): Promise<string>;
}

/**
 * ✅ پیاده‌سازی رسمی و فعال Follow Check.
 *
 * Endpoint:  GET https://graph.instagram.com/<VER>/<IGSID>
 *              ?fields=is_user_follow_business,is_business_follow_user,username,name,follower_count
 * Permissions: instagram_business_basic + instagram_business_manage_messages
 *
 * ⚠️ محدودیت رسمی (نقل مستقیم از مستندات User Profile API):
 *    «User consent is set only when an Instagram user sends a message to your app user,
 *      or clicks an icebreaker or persistent menu.»
 *    یعنی صرفِ کامنت‌گذاشتن کافی نیست. به همین دلیل Automation Engine این چک را
 *    فقط بعد از تعامل کاربر در دایرکت (Quick Reply) صدا می‌زند.
 */
export class MessagingProfileFollowChecker implements FollowChecker {
  readonly id = 'messaging_profile';
  readonly label = 'بررسی رسمی فالو (Instagram User Profile API)';
  readonly supported = true;
  readonly requirements = [
    'کاربر باید ابتدا در دایرکت تعاملی انجام دهد (پاسخ دادن یا زدن دکمهٔ Quick Reply) تا consent ایجاد شود.',
    'مجوزهای instagram_business_basic و instagram_business_manage_messages لازم است.',
    'اگر کاربر حساب شما را بلاک کرده باشد، اطلاعات در دسترس نیست.',
  ];

  constructor(
    private readonly client: InstagramClient,
    private readonly tokens: TokenProvider,
  ) {}

  async check(input: FollowCheckInput): Promise<FollowCheckResult> {
    const checkedAt = new Date();

    // طبق مستندات رسمی، بدون consent قطعاً خطا می‌گیریم — پس درخواست بی‌مورد نمی‌زنیم.
    if (!input.hasMessagingConsent) {
      return {
        status: 'unknown',
        reason: 'consent_required',
        detail:
          'کاربر هنوز در دایرکت تعاملی انجام نداده است. طبق مستندات رسمی Instagram، ' +
          'بررسی وضعیت فالو تنها پس از ارسال پیام یا زدن دکمه توسط کاربر ممکن است.',
        checkedAt,
      };
    }

    try {
      const token = await this.tokens.getAccessToken(input.instagramAccountId);
      const profile = await this.client.getUserProfile(token, input.igsid);

      if (typeof profile.is_user_follow_business !== 'boolean') {
        return {
          status: 'unknown',
          reason: 'api_error',
          detail: 'پاسخ API فاقد فیلد is_user_follow_business بود.',
          checkedAt,
        };
      }

      return {
        status: profile.is_user_follow_business ? 'following' : 'not_following',
        reason: 'ok',
        profile: {
          username: profile.username,
          name: profile.name,
          followerCount: profile.follower_count,
          isBusinessFollowUser: profile.is_business_follow_user,
        },
        checkedAt,
      };
    } catch (e) {
      if (e instanceof InstagramApiError) {
        if (e.kind === 'consent_required') {
          return {
            status: 'unknown',
            reason: 'consent_required',
            detail: 'Instagram پاسخ داد: User consent is required to access user profile.',
            checkedAt,
          };
        }
        if (e.kind === 'not_found' || e.kind === 'permission') {
          return {
            status: 'unknown',
            reason: 'blocked',
            detail: 'دسترسی به پروفایل کاربر ممکن نیست (احتمال بلاک‌شدن یا نبود مجوز).',
            checkedAt,
          };
        }
        log.warn('خطای Follow Check', { kind: e.kind, code: e.code });
        return { status: 'unknown', reason: 'api_error', detail: e.message, checkedAt };
      }
      return { status: 'unknown', reason: 'api_error', detail: (e as Error).message, checkedAt };
    }
  }
}
