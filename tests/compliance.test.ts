import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorld, createAutomation, type TestWorld } from './helpers';
import { parseSignedRequest } from '~/lib/crypto';

const APP_SECRET = 'test-app-secret'; // مطابق vitest.config.ts

let world: TestWorld;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.close();
});

/** ساخت signed_request معتبر، دقیقاً به روشی که Meta تولید می‌کند. */
function makeSignedRequest(payload: Record<string, unknown>, secret = APP_SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

describe('انطباق — parseSignedRequest', () => {
  it('امضای معتبر پذیرفته و payload برگردانده می‌شود', () => {
    const sr = makeSignedRequest({ user_id: '17841400000000000', algorithm: 'HMAC-SHA256', issued_at: 1700000000 });
    const parsed = parseSignedRequest(sr, APP_SECRET);
    expect(parsed).not.toBeNull();
    expect(parsed?.user_id).toBe('17841400000000000');
  });

  it('امضای جعلی رد می‌شود', () => {
    const sr = makeSignedRequest({ user_id: '123' }, 'wrong-secret');
    expect(parseSignedRequest(sr, APP_SECRET)).toBeNull();
  });

  it('دستکاری payload با امضای قدیمی رد می‌شود', () => {
    const sr = makeSignedRequest({ user_id: '111' });
    const parts = sr.split('.');
    const tampered = Buffer.from(JSON.stringify({ user_id: '999' }), 'utf8').toString('base64url');
    expect(parseSignedRequest(`${parts[0]}.${tampered}`, APP_SECRET)).toBeNull();
  });

  it('قالب نامعتبر رد می‌شود', () => {
    expect(parseSignedRequest('', APP_SECRET)).toBeNull();
    expect(parseSignedRequest('no-dot', APP_SECRET)).toBeNull();
    expect(parseSignedRequest('a.b.c', APP_SECRET)).toBeNull();
  });

  it('الگوریتم غیر از HMAC-SHA256 رد می‌شود', () => {
    const sr = makeSignedRequest({ user_id: '123', algorithm: 'NONE' });
    expect(parseSignedRequest(sr, APP_SECRET)).toBeNull();
  });

  it('بدون app secret رد می‌شود', () => {
    const sr = makeSignedRequest({ user_id: '123' });
    expect(parseSignedRequest(sr, '')).toBeNull();
  });
});

describe('انطباق — حذف داده (cascade)', () => {
  it('حذف حساب تمام رکوردهای وابسته را پاک می‌کند', async () => {
    const { repos } = world.container;
    const accountId = world.accountId;

    await createAutomation(world, { keywords: ['test'] });

    // پیش از حذف: داده وجود دارد
    const before = await repos.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM automations WHERE instagram_account_id=$1`,
      [accountId],
    );
    expect(Number(before.rows[0]?.c)).toBeGreaterThan(0);

    const tokensBefore = await repos.tokens.findByAccount(accountId);
    expect(tokensBefore).not.toBeNull();

    // همان کاری که endpoint حذف داده انجام می‌دهد
    await repos.db.query(`DELETE FROM instagram_accounts WHERE id=$1`, [accountId]);

    // پس از حذف: هیچ رکورد یتیمی نمانده باشد
    for (const table of ['automations', 'automation_runs', 'instagram_users', 'oauth_tokens']) {
      const res = await repos.db.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM ${table} WHERE instagram_account_id=$1`,
        [accountId],
      );
      expect(Number(res.rows[0]?.c), `${table} باید خالی باشد`).toBe(0);
    }

    expect(await repos.tokens.findByAccount(accountId)).toBeNull();
  });

  it('حذف یک مستأجر روی مستأجر دیگر اثر ندارد', async () => {
    const { repos } = world.container;

    const other = await repos.users.create({
      email: 'other@igflow.app',
      passwordHash: 'x'.repeat(60),
    });
    const otherAccount = await repos.accounts.upsert({
      userId: other.id,
      igUserId: '17999999999999999',
      username: 'other_biz',
      accountType: 'BUSINESS',
      scopes: ['instagram_business_basic'],
    });

    await repos.db.query(`DELETE FROM instagram_accounts WHERE id=$1`, [world.accountId]);

    // حساب مستأجر دیگر باید دست‌نخورده بماند
    const survivor = await repos.accounts.findById(other.id, otherAccount.id);
    expect(survivor).not.toBeNull();
    expect(survivor?.username).toBe('other_biz');
  });
});
