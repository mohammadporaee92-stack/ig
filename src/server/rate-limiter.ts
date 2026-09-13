import type { Db } from '~/infra/db/client';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

const log = createLogger('rate-limiter');

/**
 * Token-bucket پایدار (در DB) به‌ازای هر حساب اینستاگرام و هر نوع عملیات.
 *
 * محدودیت‌های رسمی که رعایت می‌شوند:
 *  - Messaging: تا ۱۰۰ ارسال/ثانیه (ما بسیار محافظه‌کارانه‌تر: RL_MESSAGES_PER_MINUTE)
 *  - Private replies: ~۷۵۰/ساعت → پیش‌فرض ما ۷۰۰
 *  - هدر Retry-After در پاسخ خطا محترم شمرده می‌شود (setRetryAfter)
 */
export type RateBucketKind = 'messages' | 'private_replies' | 'comments';

export interface RateDecision {
  allowed: boolean;
  /** چند میلی‌ثانیه بعد دوباره تلاش شود */
  retryAfterMs: number;
  remaining: number;
}

interface BucketConfig {
  capacity: number;
  refillPerMs: number;
}

export class RateLimiter {
  constructor(private readonly db: Db) {}

  private config(kind: RateBucketKind): BucketConfig {
    const e = env();
    switch (kind) {
      case 'messages':
        return { capacity: e.RL_BURST, refillPerMs: e.RL_MESSAGES_PER_MINUTE / 60_000 };
      case 'private_replies':
        return { capacity: e.RL_BURST, refillPerMs: e.RL_PRIVATE_REPLIES_PER_HOUR / 3_600_000 };
      case 'comments':
        return { capacity: e.RL_BURST, refillPerMs: 30 / 60_000 };
    }
  }

  private key(kind: RateBucketKind, accountId: string): string {
    return `${kind}:${accountId}`;
  }

  /** مصرف یک توکن؛ اگر موجود نبود، زمان انتظار برمی‌گرداند */
  async consume(kind: RateBucketKind, accountId: string, cost = 1): Promise<RateDecision> {
    const cfg = this.config(kind);
    const key = this.key(kind, accountId);
    const nowMs = Date.now();

    return this.db.transaction(async (tx) => {
      const res = await tx.query<{ tokens: number; updated_at: Date; retry_after: Date | null }>(
        `SELECT tokens, updated_at, retry_after FROM rate_limit_buckets WHERE bucket_key = $1`,
        [key],
      );
      const row = res.rows[0];

      // اگر Instagram صریحاً Retry-After داده، تا آن لحظه هیچ ارسالی نکن
      if (row?.retry_after) {
        const until = new Date(row.retry_after).getTime();
        if (until > nowMs) {
          return { allowed: false, retryAfterMs: until - nowMs, remaining: 0 };
        }
      }

      let tokens: number;
      if (!row) {
        tokens = cfg.capacity;
      } else {
        const elapsed = nowMs - new Date(row.updated_at).getTime();
        tokens = Math.min(cfg.capacity, Number(row.tokens) + elapsed * cfg.refillPerMs);
      }

      if (tokens < cost) {
        const deficit = cost - tokens;
        const waitMs = Math.ceil(deficit / cfg.refillPerMs);
        await tx.query(
          `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at) VALUES ($1,$2,to_timestamp($3/1000.0))
           ON CONFLICT (bucket_key) DO UPDATE SET tokens = $2, updated_at = to_timestamp($3/1000.0)`,
          [key, tokens, nowMs],
        );
        log.debug('محدودیت نرخ اعمال شد', { kind, waitMs });
        return { allowed: false, retryAfterMs: waitMs, remaining: 0 };
      }

      const left = tokens - cost;
      await tx.query(
        `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at, retry_after) VALUES ($1,$2,to_timestamp($3/1000.0), NULL)
         ON CONFLICT (bucket_key) DO UPDATE SET tokens = $2, updated_at = to_timestamp($3/1000.0), retry_after = NULL`,
        [key, left, nowMs],
      );
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(left) };
    });
  }

  /** وقتی Instagram هدر Retry-After یا خطای rate_limit داد */
  async setRetryAfter(kind: RateBucketKind, accountId: string, ms: number): Promise<void> {
    const until = new Date(Date.now() + Math.max(ms, 1000));
    await this.db.query(
      `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at, retry_after) VALUES ($1, 0, now(), $2)
       ON CONFLICT (bucket_key) DO UPDATE SET tokens = 0, retry_after = $2, updated_at = now()`,
      [this.key(kind, accountId), until],
    );
    log.warn('Retry-After از Instagram ثبت شد', { kind, accountId, untilMs: ms });
  }
}
