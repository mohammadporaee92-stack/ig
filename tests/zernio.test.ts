import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositories } from '~/infra/db/repositories';
import { ZernioClient } from '~/infra/zernio/client';
import { __resetEnv } from '~/lib/env';
import { createWorld, type TestWorld } from './helpers';
import { automationInputSchema, saveKeywordsAndTemplates } from '~/server/automation-input';
import { ZernioAutomationService } from '~/server/zernio-automation-service';

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

  it('عملیات Comment Automation را با JSON انجام می‌دهد', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const client = new ZernioClient(async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if ((init?.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ automation: {
          id: 'remote_1', name: 'Test', profileId: 'profile_1', accountId: 'account_1', isActive: true,
        } }), { status: 201 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const created = await client.createCommentAutomation({
      profileId: 'profile_1', accountId: 'account_1', name: 'Test', dmMessage: 'Hello',
      keywords: ['PDF'], matchMode: 'contains',
    });
    await client.updateCommentAutomation(created.id, { isActive: false });
    await client.deleteCommentAutomation(created.id);

    expect(created.id).toBe('remote_1');
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'https://zernio.test/api/v1/comment-automations'],
      ['PATCH', 'https://zernio.test/api/v1/comment-automations/remote_1'],
      ['DELETE', 'https://zernio.test/api/v1/comment-automations/remote_1'],
    ]);
    expect(calls[0]?.body).toMatchObject({ accountId: 'account_1', dmMessage: 'Hello' });
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

  it('اتوماسیون فعال را فقط یک‌بار در Zernio می‌سازد و remote id را نگه می‌دارد', async () => {
    const repos = createRepositories(world.db);
    const account = await repos.accounts.upsertZernio({
      userId: world.userId,
      providerAccountId: 'z_account_sync',
      providerProfileId: 'z_profile_sync',
      username: 'mohammad_por_ai',
      active: true,
    });
    const automation = await repos.automations.create(world.userId, {
      instagram_account_id: account.id,
      name: 'ارسال PDF',
      status: 'active',
    });
    const input = automationInputSchema.parse({
      name: 'ارسال PDF',
      instagramAccountId: account.id,
      status: 'active',
      keywords: ['PDF'],
      negativeKeywords: ['لغو'],
      matchMode: 'contains',
      messages: {
        publicReply: { body: 'دایرکت را ببین 📩', attachments: [], quickReplies: [] },
        privateReply: { body: 'سلام {{first_name}}', attachments: [], quickReplies: [] },
        followGate: { body: 'ابتدا پیج را فالو کن', attachments: [], quickReplies: [] },
        main: { body: 'فایل: {{link}}', attachments: [], quickReplies: [] },
      },
      linkUrl: 'https://example.com/file.pdf',
      botDisclosureEnabled: true,
      botDisclosureText: 'پاسخ خودکار',
    });
    await saveKeywordsAndTemplates(repos, world.userId, automation.id, input);

    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const client = new ZernioClient(async (_url, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (method === 'GET') return new Response(JSON.stringify({ automations: [] }), { status: 200 });
      return new Response(JSON.stringify({ automation: {
        id: 'remote_sync_1', name: 'remote', profileId: 'z_profile_sync', accountId: 'z_account_sync', isActive: true,
      } }), { status: 201 });
    });

    await new ZernioAutomationService(repos, client).sync(world.userId, automation.id, account, input);
    const stored = await repos.automations.findById(world.userId, automation.id);

    expect(stored?.provider_automation_id).toBe('remote_sync_1');
    expect(stored?.provider_sync_status).toBe('synced');
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(calls[1]?.body).toMatchObject({
      profileId: 'z_profile_sync',
      accountId: 'z_account_sync',
      keywords: ['PDF'],
      excludeKeywords: ['لغو'],
      dmMessage: expect.stringContaining('https://example.com/file.pdf'),
    });
    expect(String(calls[1]?.body?.dmMessage)).toContain('دوست عزیز');
  });
});
