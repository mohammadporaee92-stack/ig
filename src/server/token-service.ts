import type { TokenProvider } from '~/infra/instagram/messaging-profile-follow-checker';
import type { InstagramClient } from '~/infra/instagram/client';
import type { Repositories } from '~/infra/db/repositories';
import { decryptSecret, encryptSecret } from '~/lib/crypto';
import { createLogger } from '~/lib/logger';

const log = createLogger('token-service');

/**
 * تنها نقطه‌ای در کل سیستم که access token رمزگشایی می‌شود.
 * توکن‌ها:
 *   - AES-256-GCM رمزنگاری‌شده at rest
 *   - هرگز در API response برنمی‌گردند
 *   - هرگز در لاگ چاپ نمی‌شوند (logger هم redaction دارد)
 */
export class TokenService implements TokenProvider {
  constructor(
    private readonly repos: Repositories,
    private readonly client: InstagramClient,
  ) {}

  async store(data: {
    userId: string;
    instagramAccountId: string;
    accessToken: string;
    scopes: string[];
    expiresInSeconds?: number;
    tokenType?: 'short_lived' | 'long_lived';
  }): Promise<void> {
    const expiresAt = data.expiresInSeconds
      ? new Date(Date.now() + data.expiresInSeconds * 1000)
      : null;
    await this.repos.tokens.upsert({
      userId: data.userId,
      instagramAccountId: data.instagramAccountId,
      accessTokenEnc: encryptSecret(data.accessToken),
      scopes: data.scopes,
      expiresAt,
      tokenType: data.tokenType ?? 'long_lived',
    });
  }

  async getAccessToken(instagramAccountId: string): Promise<string> {
    const row = await this.repos.tokens.findByAccount(instagramAccountId);
    if (!row) throw new Error(`توکنی برای حساب ${instagramAccountId} یافت نشد — حساب باید دوباره متصل شود`);
    return decryptSecret(row.access_token_enc);
  }

  /** آیا توکن نزدیک انقضاست؟ (پیش‌فرض: کمتر از ۷ روز) */
  async needsRefresh(instagramAccountId: string, thresholdDays = 7): Promise<boolean> {
    const row = await this.repos.tokens.findByAccount(instagramAccountId);
    if (!row?.expires_at) return false;
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    return remaining < thresholdDays * 24 * 3600 * 1000;
  }

  /**
   * تمدید long-lived token.
   * محدودیت رسمی: توکن باید معتبر و حداقل ۲۴ ساعت عمر داشته باشد.
   */
  async refresh(instagramAccountId: string): Promise<{ ok: boolean; error?: string }> {
    const row = await this.repos.tokens.findByAccount(instagramAccountId);
    if (!row) return { ok: false, error: 'token_not_found' };

    try {
      const current = decryptSecret(row.access_token_enc);
      const refreshed = await this.client.refreshLongLivedToken(current);
      await this.repos.tokens.upsert({
        userId: row.user_id,
        instagramAccountId,
        accessTokenEnc: encryptSecret(refreshed.accessToken),
        scopes: row.scopes.split(',').filter(Boolean),
        expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
        tokenType: 'long_lived',
      });
      log.info('توکن تمدید شد', { instagramAccountId, expiresInDays: Math.round(refreshed.expiresInSeconds / 86400) });
      return { ok: true };
    } catch (e) {
      await this.repos.tokens.recordRefreshFailure(row.id);
      const account = await this.repos.accounts.findByIdUnscoped(instagramAccountId);
      if (account) {
        await this.repos.accounts.setStatus(account.user_id, instagramAccountId, 'needs_reauth', 'تمدید توکن ناموفق بود');
      }
      log.error('تمدید توکن ناموفق', { instagramAccountId, error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  }

  /** تمدید خودکار همهٔ توکن‌های نزدیک انقضا (کرون روزانه) */
  async refreshExpiring(thresholdDays = 7): Promise<{ refreshed: number; failed: number }> {
    const cutoff = new Date(Date.now() + thresholdDays * 24 * 3600 * 1000);
    const rows = await this.repos.tokens.listExpiringBefore(cutoff);
    let refreshed = 0;
    let failed = 0;
    for (const r of rows) {
      const res = await this.refresh(r.instagram_account_id);
      if (res.ok) refreshed++;
      else failed++;
    }
    return { refreshed, failed };
  }

  async revoke(instagramAccountId: string): Promise<void> {
    await this.repos.tokens.deleteByAccount(instagramAccountId);
  }
}
