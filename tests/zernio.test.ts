import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositories } from '~/infra/db/repositories';
import { ZernioClient } from '~/infra/zernio/client';
import { __resetEnv } from '~/lib/env';
import { createWorld, type TestWorld } from './helpers';

const originalKey = process.env.ZERNIO_API_KEY;
const originalBaseUrl = process.env.ZERNIO_BASE_URL;

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'sk_test_key_never_log_this';
  process.env.ZERNIO_BASE_URL = 'https://zernio.test/api/v1';
  __resetEnv();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ZERNIO_API_KEY;
  else process.env.ZERNIO_API_KEY = originalKey;
  if (originalBaseUrl === undefined) delete process.env.ZERNIO_BASE_URL;
  else process.env.ZERNIO_BASE_URL = originalBaseUrl;
  __resetEnv();
  vi.restoreAllMocks();
});

describe('Zernio API client', () => {
  it('فقط حساب Instagram را برمی‌گرداند و Bearer key را server-side می‌فرستد', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk_test_key_never_log_this');
      expect(headers.get('accept')).toBe('application/json');
      return new Response(JSON.stringify({
        accounts: [
          {
            _id: 'acc_instagram_1',
            profileId: { _id: 'profile_1' },
            platform: 'instagram',
            username: 'mohammad_por_ai',
            displayName: 'Mohammad',
            isActive: true,
          },
          { _id: 'acc_linkedin_1', platform: 'linkedin', username: 'ignored', isActive: true },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const accounts = await new ZernioClient(fetchMock).listInstagramAccounts();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://zernio.test/api/v1/accounts');
    expect(accounts).toEqual([
      expect.objectContaining({
        id: 'acc_instagram_1',
        profileId: 'profile_1',
        platform: 'instagram',
        username: 'mohammad_por_ai',
        isActive: true,
      }),
    ]);
  });

  it('health endpoint را با account id امن فراخوانی می‌کند', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toBe('https://zernio.test/api/v1/accounts/acc%2F1/health');
      return new Response(JSON.stringify({
        accountId: 'acc/1',
        platform: 'instagram',
        username: 'mohammad_por_ai',
        status: 'healthy',
        tokenStatus: { valid: true },
        permissions: { canPost: true, canFetchAnalytics: true, missingRequired: [] },
      }), { status: 200 });
    });

    const health = await new ZernioClient(fetchMock).getAccountHealth('acc/1');
    expect(health.status).toBe('healthy');
    expect(health.tokenStatus?.valid).toBe(true);
  });

  it('خطای Zernio را بدون افشای کلید طبقه‌بندی می‌کند', async () => {
    const client = new ZernioClient(async () => new Response(
      JSON.stringify({ error: 'Invalid API key', code: 'UNAUTHORIZED' }),
      { status: 401 },
    ));

    await expect(client.listInstagramAccounts()).rejects.toMatchObject({
      name: 'ZernioApiError',
      message: 'Invalid API key',
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});

describe('Zernio account persistence', () => {
  let world: TestWorld;

  beforeEach(async () => {
    world = await createWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  it('فقط شناسه‌های غیرمحرمانه را ذخیره و همان حساب را idempotent به‌روزرسانی می‌کند', async () => {
    const repos = createRepositories(world.db);
    const first = await repos.accounts.upsertZernio({
      userId: world.userId,
      providerAccountId: 'z_account_1',
      providerProfileId: 'z_profile_1',
      username: 'mohammad_por_ai',
      displayName: 'Mohammad',
      active: true,
    });
    const second = await repos.accounts.upsertZernio({
      userId: world.userId,
      providerAccountId: 'z_account_1',
      providerProfileId: 'z_profile_1',
      username: 'mohammad_por_ai_updated',
      displayName: 'Mohammad Updated',
      active: true,
    });

    expect(second.id).toBe(first.id);
    expect(second.provider).toBe('zernio');
    expect(second.provider_account_id).toBe('z_account_1');
    expect(second.provider_profile_id).toBe('z_profile_1');
    expect(second.username).toBe('mohammad_por_ai_updated');
    expect(JSON.stringify(second)).not.toContain('sk_test_key_never_log_this');
  });
});
