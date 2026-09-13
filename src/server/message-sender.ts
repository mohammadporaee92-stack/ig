import type { Repositories } from '~/infra/db/repositories';
import type { Attachment, InstagramClient, QuickReply } from '~/infra/instagram/client';
import { InstagramApiError } from '~/infra/instagram/errors';
import { truncateToBytes } from '~/domain/messaging/renderer';
import { createLogger } from '~/lib/logger';
import type { RateLimiter } from './rate-limiter';
import type { TokenService } from './token-service';

const log = createLogger('message-sender');

export interface SendRequest {
  userId: string;
  instagramAccountId: string;
  igUserId: string; // IG_ID حساب Professional
  runId: string | null;
  kind: 'public_reply' | 'private_reply' | 'follow_gate' | 'main' | 'fallback';
  text: string;
  quickReplies?: QuickReply[];
  attachments?: Attachment[];
  /** برای public_reply */
  commentId?: string;
  /** برای private_reply */
  privateReplyCommentId?: string;
  /** برای DM معمولی */
  igsid?: string;
  /** پسوند اختیاری کلید idempotency (مثلاً شمارهٔ بررسی مجدد فالو) */
  idempotencySuffix?: string;
}

export type SendOutcome =
  | { status: 'sent'; messageId?: string; logId: string }
  | { status: 'skipped'; reason: string; logId: string }
  | { status: 'rate_limited'; retryAfterMs: number; logId: string }
  | { status: 'failed'; error: string; code?: string; retryable: boolean; logId: string };

/**
 * DM Engine.
 *
 * تضمین‌ها:
 *  - Idempotency: کلید منطقی (run + kind) در message_logs → retry پیام تکراری نمی‌فرستد
 *  - Rate limiting قبل از هر تماس + احترام به Retry-After
 *  - هیچ access token ای در لاگ یا خروجی ظاهر نمی‌شود
 *  - محدودیت ۱۰۰۰ بایت متن رعایت می‌شود
 */
export class MessageSender {
  constructor(
    private readonly repos: Repositories,
    private readonly client: InstagramClient,
    private readonly tokens: TokenService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  private idempotencyKey(req: SendRequest): string {
    const target = req.commentId ?? req.privateReplyCommentId ?? req.igsid ?? 'unknown';
    const suffix = req.idempotencySuffix ? `:${req.idempotencySuffix}` : '';
    return `${req.runId ?? 'norun'}:${req.kind}:${target}${suffix}`;
  }

  async send(req: SendRequest): Promise<SendOutcome> {
    const text = truncateToBytes(req.text ?? '');
    const idempotencyKey = this.idempotencyKey(req);

    const claim = await this.repos.messages.claim({
      userId: req.userId,
      instagramAccountId: req.instagramAccountId,
      runId: req.runId,
      kind: req.kind,
      channel: req.kind === 'public_reply' ? 'comment_reply' : 'direct_message',
      recipientIgsid: req.igsid ?? null,
      recipientCommentId: req.commentId ?? req.privateReplyCommentId ?? null,
      bodyPreview: text,
      idempotencyKey,
    });

    if (!claim.claimed) {
      // قبلاً برای همین run/kind رکورد وجود دارد. اگر sent بوده → تکرار نکن.
      const existing = await this.repos.db.query<{ status: string; provider_message_id: string | null }>(
        `SELECT status, provider_message_id FROM message_logs WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const st = existing.rows[0]?.status;
      if (st === 'sent') {
        log.info('ارسال تکراری جلوگیری شد (idempotency)', { kind: req.kind, runId: req.runId });
        return { status: 'skipped', reason: 'already_sent', logId: claim.id };
      }
      // failed/pending ⇒ اجازهٔ تلاش مجدد
      await this.repos.messages.reset(claim.id);
    }

    const bucket = req.kind === 'public_reply' ? 'comments' : req.kind === 'private_reply' ? 'private_replies' : 'messages';
    const decision = await this.rateLimiter.consume(bucket, req.instagramAccountId);
    if (!decision.allowed) {
      log.warn('ارسال به‌دلیل rate limit به تعویق افتاد', { kind: req.kind, retryAfterMs: decision.retryAfterMs });
      return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs, logId: claim.id };
    }

    try {
      const token = await this.tokens.getAccessToken(req.instagramAccountId);
      let messageId: string | undefined;

      if (req.kind === 'public_reply') {
        if (!req.commentId) throw new Error('commentId برای public_reply الزامی است');
        const res = await this.client.replyToComment(token, req.commentId, text);
        messageId = res.id;
      } else if (req.privateReplyCommentId) {
        // Private Reply — محدودیت رسمی: فقط ۱ پیام به ازای هر کامنت، تا ۷ روز
        const res = await this.client.sendPrivateReply(token, req.igUserId, req.privateReplyCommentId, {
          text,
          ...(req.quickReplies?.length ? { quick_replies: req.quickReplies.slice(0, 13) } : {}),
        });
        messageId = res.message_id;
      } else {
        if (!req.igsid) throw new Error('igsid برای ارسال پیام مستقیم الزامی است');
        // متن و هر پیوست یک پیام مستقل Instagram هستند. فراخواننده برای هر بخش
        // idempotencySuffix جدا می‌دهد تا شکست پیوست باعث ارسال دوبارهٔ متن نشود.
        const hasTextPart = Boolean(text || req.quickReplies?.length);
        if (hasTextPart) {
          const res = await this.client.sendMessage(token, req.igUserId, req.igsid, {
            ...(text ? { text } : {}),
            ...(req.quickReplies?.length ? { quick_replies: req.quickReplies.slice(0, 13) } : {}),
          });
          messageId = res.message_id;
        }
        for (const [index, att] of (req.attachments ?? []).entries()) {
          // اولین بخش قبلاً یک سهمیه مصرف کرده است. اگر پیام فقط پیوست دارد،
          // همان سهم اولیه برای پیوست اول استفاده می‌شود.
          if (hasTextPart || index > 0) {
            const attachmentDecision = await this.rateLimiter.consume('messages', req.instagramAccountId);
            if (!attachmentDecision.allowed) {
              return {
                status: 'rate_limited',
                retryAfterMs: attachmentDecision.retryAfterMs,
                logId: claim.id,
              };
            }
          }
          const attachmentResult = await this.client.sendMessage(token, req.igUserId, req.igsid, { attachment: att });
          messageId ??= attachmentResult.message_id;
        }
      }

      await this.repos.messages.markSent(claim.id, messageId);
      log.info('پیام ارسال شد', { kind: req.kind, runId: req.runId, hasMessageId: Boolean(messageId) });
      return { status: 'sent', messageId, logId: claim.id };
    } catch (e) {
      if (e instanceof InstagramApiError) {
        if (e.kind === 'rate_limit') {
          await this.rateLimiter.setRetryAfter(bucket, req.instagramAccountId, e.retryAfterMs ?? 60_000);
          await this.repos.messages.markFailed(claim.id, e.message, String(e.code ?? 'rate_limit'));
          return { status: 'rate_limited', retryAfterMs: e.retryAfterMs ?? 60_000, logId: claim.id };
        }
        if (e.kind === 'already_replied') {
          await this.repos.messages.markSkipped(claim.id, 'قبلاً برای این کامنت پاسخ خصوصی ارسال شده است');
          return { status: 'skipped', reason: 'already_replied', logId: claim.id };
        }
        if (e.kind === 'outside_window') {
          await this.repos.messages.markSkipped(claim.id, 'خارج از پنجرهٔ مجاز پیام‌رسانی ۲۴ ساعته');
          return { status: 'skipped', reason: 'outside_messaging_window', logId: claim.id };
        }
        await this.repos.messages.markFailed(claim.id, e.message, String(e.code ?? e.kind));
        return { status: 'failed', error: e.message, code: e.kind, retryable: e.retryable, logId: claim.id };
      }
      const msg = (e as Error).message;
      await this.repos.messages.markFailed(claim.id, msg);
      return { status: 'failed', error: msg, retryable: false, logId: claim.id };
    }
  }
}
