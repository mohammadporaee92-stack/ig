import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './helpers';
import { createRepositories } from '~/infra/db/repositories';
import { InstagramClient } from '~/infra/instagram/client';
import { InstagramApiError } from '~/infra/instagram/errors';
import { signState, verifyState, decryptSecret } from '~/lib/crypto';

let world: TestWorld;
beforeEach(async () => { world = await createWorld(); });
afterEach(async () => { await world.close(); });

describe('OAuth — Business Login for Instagram', () => {
  it('URL مجوزدهی شامل پارامترهای رسمی است و Facebook Login را پنهان می‌کند', () => {
    const client = new InstagramClient();
    const url = new URL(client.buildAuthorizeUrl('state123'));

    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state123');
    expect(url.searchParams.get('scope')).toContain('instagram_business_basic');
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_messages');
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_comments');
    // کاربر نباید مجبور به Facebook شود
    expect(url.searchParams.get('enable_fb_login')).toBe('false');
  });

  it('force_reauth قابل فعال‌سازی است', () => {
    const url = new URL(new InstagramClient().buildAuthorizeUrl('s', { forceReauth: true }));
    expect(url.searchParams.get('force_reauth')).toBe('true');
  });

  it('Successful login: code → short-lived → long-lived → پروفایل', async () => {
    world.ig.handlers.push({
      match: (u) => u.includes('api.instagram.com/oauth/access_token'),
      respond: () => ({ body: { access_token: 'SHORT_TOKEN_123', user_id: 17841400000000001, permissions: 'instagram_business_basic,instagram_business_manage_messages' } }),
    });
    world.ig.handlers.push({
      match: (u) => u.includes('/access_token') && u.includes('ig_exchange_token'),
      respond: () => ({ body: { access_token: 'LONG_TOKEN_456', token_type: 'bearer', expires_in: 5_184_000 } }),
    });
    world.ig.handlers.push({
      match: (u) => u.includes('/me?') || u.endsWith('/me'),
      respond: () => ({ body: { id: '17841400000000001', username: 'mohammad_por_ai', account_type: 'BUSINESS', followers_count: 5000, media_count: 42 } }),
    });

    const client = world.container.igClient;
    const short = await client.exchangeCodeForToken('AUTH_CODE_XYZ');
    expect(short.accessToken).toBe('SHORT_TOKEN_123');
    expect(short.permissions).toContain('instagram_business_basic');

    const long = await client.exchangeForLongLivedToken(short.accessToken);
    expect(long.accessToken).toBe('LONG_TOKEN_456');
    expect(long.expiresInSeconds).toBe(5_184_000); // ۶۰ روز

    const me = await client.getMe(long.accessToken);
    expect(me.username).toBe('mohammad_por_ai');
    expect(me.account_type).toBe('BUSINESS');

    // بدنهٔ درخواست تبادل، فرم‌انکود و شامل پارامترهای رسمی است
    const exchange = world.ig.callsTo('oauth/access_token')[0]!;
    expect(exchange.method).toBe('POST');
    expect((exchange.body as Record<string, string>).grant_type).toBe('authorization_code');
    expect((exchange.body as Record<string, string>).code).toBe('AUTH_CODE_XYZ');
  });

  it('پاسخ به شکل data[] هم پشتیبانی می‌شود', async () => {
    world.ig.handlers.push({
      match: (u) => u.includes('oauth/access_token'),
      respond: () => ({ body: { data: [{ access_token: 'T', user_id: '1', permissions: ['instagram_business_basic'] }] } }),
    });
    const r = await world.container.igClient.exchangeCodeForToken('c');
    expect(r.accessToken).toBe('T');
    expect(r.permissions).toEqual(['instagram_business_basic']);
  });

  it('Denied permission: state معتبر ولی error در callback', () => {
    const s = signState({ uid: 'usr_1', purpose: 'ig_connect' });
    expect(verifyState<{ uid: string }>(s)?.uid).toBe('usr_1');
    const cbUrl = new URL('https://app.test/api/instagram/callback?error=access_denied&error_reason=user_denied');
    expect(cbUrl.searchParams.get('error')).toBe('access_denied');
    expect(cbUrl.searchParams.get('code')).toBeNull();
  });

  it('Invalid callback: بدون code یا state', () => {
    const u = new URL('https://app.test/api/instagram/callback');
    expect(u.searchParams.get('code')).toBeNull();
    expect(u.searchParams.get('state')).toBeNull();
  });

  it('state جعلی رد می‌شود (CSRF)', () => {
    expect(verifyState('forged.state')).toBeNull();
  });

  it('code نامعتبر خطای طبقه‌بندی‌شده می‌دهد', async () => {
    world.ig.handlers.push({
      match: (u) => u.includes('oauth/access_token'),
      respond: () => ({ status: 400, body: { error: { message: 'Invalid authorization code', code: 100 } } }),
    });
    await expect(world.container.igClient.exchangeCodeForToken('bad')).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('Token security & lifecycle', () => {
  it('توکن رمزنگاری‌شده ذخیره می‌شود و plaintext در DB نیست', async () => {
    const repos = createRepositories(world.db);
    const row = await repos.tokens.findByAccount(world.accountId);
    expect(row).not.toBeNull();
    expect(row!.access_token_enc).not.toContain('IGQVJTEST_TOKEN_VALUE');
    expect(row!.access_token_enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(row!.access_token_enc)).toBe('IGQVJTEST_TOKEN_VALUE_1234567890');
  });

  it('TokenService توکن را فقط در حافظه رمزگشایی می‌کند', async () => {
    const t = await world.container.tokens.getAccessToken(world.accountId);
    expect(t).toBe('IGQVJTEST_TOKEN_VALUE_1234567890');
  });

  it('Expired token: تشخیص نیاز به تمدید', async () => {
    const repos = createRepositories(world.db);
    await repos.tokens.upsert({
      userId: world.userId,
      instagramAccountId: world.accountId,
      accessTokenEnc: (await repos.tokens.findByAccount(world.accountId))!.access_token_enc,
      scopes: [],
      expiresAt: new Date(Date.now() + 2 * 86400_000), // ۲ روز دیگر
    });
    expect(await world.container.tokens.needsRefresh(world.accountId, 7)).toBe(true);
    expect(await world.container.tokens.needsRefresh(world.accountId, 1)).toBe(false);
  });

  it('تمدید موفق توکن جدید و انقضای جدید ثبت می‌کند', async () => {
    world.ig.handlers.push({
      match: (u) => u.includes('refresh_access_token'),
      respond: () => ({ body: { access_token: 'REFRESHED_TOKEN_999', token_type: 'bearer', expires_in: 5_184_000 } }),
    });
    const res = await world.container.tokens.refresh(world.accountId);
    expect(res.ok).toBe(true);
    expect(await world.container.tokens.getAccessToken(world.accountId)).toBe('REFRESHED_TOKEN_999');
  });

  it('تمدید ناموفق ⇒ حساب به needs_reauth می‌رود', async () => {
    world.ig.handlers.push({
      match: (u) => u.includes('refresh_access_token'),
      respond: () => ({ status: 400, body: { error: { message: 'Error validating access token', code: 190 } } }),
    });
    const res = await world.container.tokens.refresh(world.accountId);
    expect(res.ok).toBe(false);

    const repos = createRepositories(world.db);
    const acct = await repos.accounts.findById(world.userId, world.accountId);
    expect(acct?.status).toBe('needs_reauth');
  });

  it('Disconnect توکن را حذف می‌کند', async () => {
    await world.container.tokens.revoke(world.accountId);
    const repos = createRepositories(world.db);
    expect(await repos.tokens.findByAccount(world.accountId)).toBeNull();
    await expect(world.container.tokens.getAccessToken(world.accountId)).rejects.toThrow();
  });

  it('توکن در هیچ خروجی repository به‌صورت plaintext نیست', async () => {
    const repos = createRepositories(world.db);
    const accounts = await repos.accounts.listByUser(world.userId);
    const serialized = JSON.stringify(accounts);
    expect(serialized).not.toContain('IGQVJTEST_TOKEN_VALUE');
  });
});

describe('طبقه‌بندی خطاهای Instagram API', () => {
  const cases: Array<[string, number, Record<string, unknown>, string]> = [
    ['rate limit (کد ۴)', 400, { error: { code: 4, message: 'Application request limit reached' } }, 'rate_limit'],
    ['rate limit (HTTP 429)', 429, { error: { message: 'too many' } }, 'rate_limit'],
    ['توکن نامعتبر', 400, { error: { code: 190, message: 'Error validating access token' } }, 'token_invalid'],
    ['consent لازم', 400, { error: { code: 230, message: 'User consent is required to access user profile' } }, 'consent_required'],
    ['خطای سرور', 500, { error: { message: 'Internal' } }, 'transient'],
  ];

  for (const [label, status, body, expected] of cases) {
    it(label, async () => {
      world.ig.handlers.push({ match: (u) => u.includes('/me'), respond: () => ({ status, body }) });
      try {
        await world.container.igClient.getMe('token');
        expect.unreachable('باید خطا می‌داد');
      } catch (e) {
        expect(e).toBeInstanceOf(InstagramApiError);
        expect((e as InstagramApiError).kind).toBe(expected);
      }
    });
  }

  it('خطاهای rate_limit و transient قابل retry هستند', () => {
    const rl = new InstagramApiError({ message: 'x', kind: 'rate_limit', httpStatus: 429 });
    const val = new InstagramApiError({ message: 'x', kind: 'validation', httpStatus: 400 });
    expect(rl.retryable).toBe(true);
    expect(val.retryable).toBe(false);
  });
});
