import { error, json, withAuth } from '../../_lib/handler';
import { ZernioApiError } from '~/infra/zernio/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async ({ user, container, request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId')?.trim() ?? '';
  if (!accountId) return error('شناسهٔ حساب الزامی است', 400);

  const account = await container.repos.accounts.findById(user.sub, accountId);
  if (!account) return error('حساب اینستاگرام یافت نشد', 404);
  if (account.provider !== 'zernio' || !account.provider_account_id) {
    return error('دریافت فهرست پست‌ها برای این حساب در دسترس نیست', 422);
  }

  try {
    const result = await container.zernioClient.listInstagramPosts(account.provider_account_id);
    return json(result);
  } catch (err) {
    if (err instanceof ZernioApiError) {
      return error(`دریافت پست‌ها از Zernio ناموفق بود: ${err.message}`, err.status || 502, { code: err.code });
    }
    throw err;
  }
});
