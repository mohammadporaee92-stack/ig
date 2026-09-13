import { z } from 'zod';
import { error, json, withAuth } from '../../_lib/handler';
import { env } from '~/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ accountId: z.string().min(1) });

/** تلاش دوباره برای فعال‌سازی اشتراک Webhook روی حساب (بعد از گرفتن Advanced Access) */
export const POST = withAuth(
  async ({ user, container, request }) => {
    const { accountId } = schema.parse(await request.json());
    const account = await container.repos.accounts.findById(user.sub, accountId);
    if (!account) return error('حساب یافت نشد', 404);

    const fields = env().igWebhookFields;
    try {
      const token = await container.tokens.getAccessToken(accountId);
      const res = await container.igClient.subscribeWebhooks(token, account.ig_user_id, fields);
      await container.repos.accounts.setWebhookState(accountId, Boolean(res.success), fields);
      return json({ ok: true, subscribed: Boolean(res.success), fields });
    } catch (e) {
      const message = (e as Error).message;
      await container.repos.accounts.setWebhookState(accountId, false, fields, message);
      return error(`فعال‌سازی Webhook ناموفق بود: ${message}`, 502);
    }
  },
  { mutation: true },
);
