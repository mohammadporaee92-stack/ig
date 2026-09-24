import { z } from 'zod';
import { error, json, readJson, withAuth } from '../../_lib/handler';
import { env } from '~/lib/env';
import { ZernioApiError } from '~/infra/zernio/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const importSchema = z.object({
  accountId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
});

export const GET = withAuth(async ({ container }) => {
  if (!env().zernioConfigured) return error('ZERNIO_API_KEY تنظیم نشده است', 503);

  try {
    const accounts = await container.zernioClient.listInstagramAccounts();
    return json({
      accounts: accounts.map((account) => ({
        id: account.id,
        profileId: account.profileId,
        platform: account.platform,
        username: account.username,
        displayName: account.displayName,
        profileUrl: account.profileUrl,
        isActive: account.isActive,
      })),
    });
  } catch (e) {
    if (e instanceof ZernioApiError) return error(e.message, e.status || 502, { code: e.code });
    throw e;
  }
});

export const POST = withAuth(
  async ({ user, container, request }) => {
    if (!env().zernioConfigured) return error('ZERNIO_API_KEY تنظیم نشده است', 503);
    const { accountId, username } = await readJson(request, importSchema);

    try {
      const available = await container.zernioClient.listInstagramAccounts();
      const candidates = available.filter(
        (account) =>
          account.isActive &&
          (!accountId || account.id === accountId) &&
          (!username || account.username.toLowerCase() === username.toLowerCase()),
      );

      if (!candidates.length) {
        return error('هیچ حساب Instagram فعال و قابل‌دسترسی در Zernio پیدا نشد', 404);
      }
      if (candidates.length > 1 && !accountId && !username) {
        return error('بیش از یک حساب Instagram پیدا شد؛ حساب موردنظر را مشخص کنید', 409, {
          accounts: candidates.map((account) => ({ username: account.username, id: account.id })),
        });
      }

      const remote = candidates[0];
      if (!remote) return error('حساب Zernio انتخاب نشد', 404);
      const health = await container.zernioClient.getAccountHealth(remote.id);
      const healthy = health.status !== 'error' && health.tokenStatus?.valid !== false;
      if (!healthy) {
        return error('حساب Zernio نیاز به اتصال مجدد دارد', 409, {
          code: 'zernio_account_unhealthy',
          issues: health.issues ?? [],
          recommendations: health.recommendations ?? [],
        });
      }

      const account = await container.repos.accounts.upsertZernio({
        userId: user.sub,
        providerAccountId: remote.id,
        providerProfileId: remote.profileId,
        username: remote.username,
        displayName: remote.displayName ?? health.displayName ?? null,
        profilePictureUrl: remote.profilePictureUrl ?? null,
        active: true,
      });

      await container.repos.audit.log({
        userId: user.sub,
        action: 'zernio.account.import',
        entityType: 'instagram_account',
        entityId: account.id,
        metadata: { provider: 'zernio', username: account.username },
      });

      return json({
        ok: true,
        account: {
          id: account.id,
          username: account.username,
          provider: account.provider,
          status: account.status,
          health: health.status,
        },
      });
    } catch (e) {
      if (e instanceof ZernioApiError) return error(e.message, e.status || 502, { code: e.code });
      throw e;
    }
  },
  { mutation: true },
);
