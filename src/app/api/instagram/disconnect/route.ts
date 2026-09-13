import { z } from 'zod';
import { error, json, withAuth } from '../../_lib/handler';
import { createLogger } from '~/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('ig-disconnect');
const schema = z.object({ accountId: z.string().min(1) });

export const POST = withAuth(
  async ({ user, container, request }) => {
    const { accountId } = schema.parse(await request.json());
    const account = await container.repos.accounts.findById(user.sub, accountId);
    if (!account) return error('حساب یافت نشد', 404);

    // تلاش برای لغو اشتراک webhook (اگر شکست خورد مانع قطع اتصال نمی‌شود)
    try {
      const token = await container.tokens.getAccessToken(accountId);
      await container.igClient.unsubscribeWebhooks(token, account.ig_user_id);
    } catch (e) {
      log.warn('لغو اشتراک webhook ناموفق بود', { error: (e as Error).message });
    }

    await container.tokens.revoke(accountId);
    await container.repos.accounts.setStatus(user.sub, accountId, 'disconnected');
    await container.repos.accounts.setWebhookState(accountId, false, []);

    // اتوماسیون‌های این حساب غیرفعال می‌شوند تا اجرای بی‌اثر نداشته باشیم
    await container.repos.db.query(
      `UPDATE automations SET status='disabled', updated_at=now() WHERE user_id=$1 AND instagram_account_id=$2 AND status='active'`,
      [user.sub, accountId],
    );

    await container.repos.audit.log({
      userId: user.sub, action: 'instagram.disconnect', entityType: 'instagram_account', entityId: accountId,
    });
    return json({ ok: true });
  },
  { mutation: true },
);
