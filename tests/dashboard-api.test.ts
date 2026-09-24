import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createWorld, type TestWorld } from './helpers';
import { automationInputSchema, validateMessageSizes, validateProviderRequirements } from '~/server/automation-input';
import { getDashboardStats, getAnalytics, listAutomationSummaries, getRecentRuns } from '~/server/queries';
import { newId } from '~/lib/crypto';

/**
 * تست‌های لایهٔ داشبورد (مرحلهٔ ۱۱):
 *  - اعتبارسنجی ورودی فرم اتوماسیون مطابق محدودیت‌های رسمی Instagram
 *  - کوئری‌های آماری و ایزولاسیون بین مستأجرها
 */

let world: TestWorld;
let repos: TestWorld['container']['repos'];
let db: TestWorld['db'];
let userId: string;
let accountId: string;

beforeEach(async () => {
  world = await createWorld();
  repos = world.container.repos;
  db = world.db;
  userId = world.userId;
  accountId = world.accountId;
});
afterEach(async () => {
  await world.close();
});

describe('اعتبارسنجی ورودی اتوماسیون', () => {
  const base = {
    name: 'تست',
    instagramAccountId: 'iga_1',
    keywords: ['لینک'],
    messages: {
      publicReply: { body: 'ok' },
      privateReply: { body: 'سلام', quickReplies: [{ title: 'باشه' }] },
      followGate: { body: '' },
      main: { body: 'محتوا' },
    },
  };

  it('ورودی معتبر با مقادیر پیش‌فرض پر می‌شود', () => {
    const parsed = automationInputSchema.parse(base);
    expect(parsed.status).toBe('draft');
    expect(parsed.matchMode).toBe('contains');
    expect(parsed.caseSensitive).toBe(false);
    expect(parsed.oncePerUserPerPost).toBe(true);
    expect(parsed.followUnknownPolicy).toBe('deliver');
    expect(parsed.botDisclosureEnabled).toBe(true);
  });

  it('نام خالی رد می‌شود', () => {
    expect(() => automationInputSchema.parse({ ...base, name: '' })).toThrow();
  });

  it('بدون کلیدواژه رد می‌شود', () => {
    expect(() => automationInputSchema.parse({ ...base, keywords: [] })).toThrow();
  });

  it('بیش از ۱۳ دکمهٔ سریع رد می‌شود (محدودیت رسمی)', () => {
    const quickReplies = Array.from({ length: 14 }, (_, i) => ({ title: `b${i}` }));
    expect(() =>
      automationInputSchema.parse({
        ...base,
        messages: { ...base.messages, privateReply: { body: 'x', quickReplies } },
      }),
    ).toThrow();
  });

  it('دقیقاً ۱۳ دکمه پذیرفته می‌شود', () => {
    const quickReplies = Array.from({ length: 13 }, (_, i) => ({ title: `b${i}` }));
    const parsed = automationInputSchema.parse({
      ...base,
      messages: { ...base.messages, privateReply: { body: 'x', quickReplies } },
    });
    expect(parsed.messages.privateReply.quickReplies).toHaveLength(13);
  });

  it('عنوان دکمهٔ بلندتر از ۲۰ کاراکتر رد می‌شود (محدودیت رسمی)', () => {
    expect(() =>
      automationInputSchema.parse({
        ...base,
        messages: { ...base.messages, privateReply: { body: 'x', quickReplies: [{ title: 'x'.repeat(21) }] } },
      }),
    ).toThrow();
  });

  it('URL نامعتبر برای پیوست رد می‌شود', () => {
    expect(() =>
      automationInputSchema.parse({
        ...base,
        messages: { ...base.messages, main: { body: 'x', attachments: [{ type: 'image', url: 'not-a-url' }] } },
      }),
    ).toThrow();
  });

  it('پیام بلندتر از ۱۰۰۰ بایت رد می‌شود', () => {
    const input = automationInputSchema.parse({
      ...base,
      messages: { ...base.messages, main: { body: 'ب'.repeat(600) } }, // هر حرف فارسی ۲ بایت
    });
    expect(validateMessageSizes(input)).toMatch(/۱۰۰۰|1000/);
  });

  it('پیام دقیقاً زیر مرز ۱۰۰۰ بایت قبول می‌شود', () => {
    const input = automationInputSchema.parse({
      ...base,
      messages: { ...base.messages, main: { body: 'ب'.repeat(400) } }, // ۸۰۰ بایت
    });
    expect(validateMessageSizes(input)).toBeNull();
  });

  it('سیاست نامعتبر برای وضعیت فالو رد می‌شود', () => {
    expect(() => automationInputSchema.parse({ ...base, followUnknownPolicy: 'ban_user' })).toThrow();
  });

  it('پیش‌نویس ناقص ذخیره می‌شود ولی همان Flow در حالت active رد می‌شود', () => {
    const incomplete = {
      ...base,
      messages: { ...base.messages, main: { body: '' } },
    };
    expect(automationInputSchema.parse(incomplete).status).toBe('draft');
    expect(() => automationInputSchema.parse({ ...incomplete, status: 'active' })).toThrow(/اصلی/);
  });

  it('اتوماسیون فعال با پست‌های مشخص بدون Media ID رد می‌شود', () => {
    expect(() => automationInputSchema.parse({
      ...base,
      status: 'active',
      targetScope: 'specific_posts',
      targetMediaIds: [],
    })).toThrow(/Media ID/);
  });

  it('اتوماسیون فعال بدون Private Reply رد و Quick Reply فقط برای Meta الزامی است', () => {
    expect(() => automationInputSchema.parse({
      ...base,
      status: 'active',
      privateReplyEnabled: false,
    })).toThrow(/Private Reply/);

    const withoutQuickReply = automationInputSchema.parse({
      ...base,
      status: 'active',
      messages: {
        ...base.messages,
        privateReply: { body: 'سلام', quickReplies: [] },
      },
    });
    expect(validateProviderRequirements(withoutQuickReply, 'meta')).toMatch(/Quick Reply/);
    expect(validateProviderRequirements(withoutQuickReply, 'zernio')).toBeNull();
  });

  it('اتوماسیون فعال با Follow Gate خالی رد می‌شود', () => {
    expect(() => automationInputSchema.parse({
      ...base,
      status: 'active',
      followGateEnabled: true,
    })).toThrow(/Follow Gate/);
  });
});

describe('کوئری‌های داشبورد', () => {
  it('آمار خالی برای کاربر تازه صفر است', async () => {
    const stats = await getDashboardStats(repos, userId);
    expect(stats.totalAutomations).toBe(0);
    expect(stats.commentsProcessed).toBe(0);
    expect(stats.conversionRate).toBe(0);
  });

  it('آمار اتوماسیون فعال درست شمرده می‌شود', async () => {
    await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'A', status: 'active',
    });
    await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'B', status: 'draft',
    });
    const stats = await getDashboardStats(repos, userId);
    expect(stats.totalAutomations).toBe(2);
    expect(stats.activeAutomations).toBe(1);
  });

  it('خلاصهٔ اتوماسیون کلیدواژه‌ها را برمی‌گرداند', async () => {
    const a = await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'با کلیدواژه', status: 'active',
    });
    await repos.automations.replaceKeywords(userId, a.id, [
      { keyword: 'لینک', keywordNorm: 'لینک', isNegative: false },
      { keyword: 'link', keywordNorm: 'link', isNegative: false },
    ]);
    const [summary] = await listAutomationSummaries(repos, userId);
    expect(summary?.keywords).toEqual(expect.arrayContaining(['لینک', 'link']));
  });

  it('نرخ تبدیل از روی اجراهای تحویل‌شده محاسبه می‌شود', async () => {
    const a = await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'C', status: 'active',
    });
    for (const [i, delivered] of [true, true, false, false].entries()) {
      await db.query(
        `INSERT INTO automation_runs (id,user_id,instagram_account_id,automation_id,comment_id,status,delivered)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId('run'), userId, accountId, a.id, `c${i}`, delivered ? 'completed' : 'failed', delivered],
      );
    }
    const stats = await getDashboardStats(repos, userId);
    expect(stats.commentsProcessed).toBe(4);
    expect(stats.successfulDeliveries).toBe(2);
    expect(stats.conversionRate).toBe(0.5);

    const [analytics] = await getAnalytics(repos, userId);
    expect(analytics?.success).toBe(2);
    expect(analytics?.failed).toBe(2);
  });

  it('🔒 آمار یک مستأجر هرگز شامل دادهٔ مستأجر دیگر نیست', async () => {
    const other = await repos.users.create({
      email: 'other@example.com', passwordHash: 'x', fullName: 'دیگری',
    });
    const otherAccount = await repos.accounts.upsert({
      userId: other.id, igUserId: '17841499999999999', username: 'other_biz', scopes: [],
    });
    const otherAutomation = await repos.automations.create(other.id, {
      instagram_account_id: otherAccount.id, name: 'مال دیگری', status: 'active',
    });
    await db.query(
      `INSERT INTO automation_runs (id,user_id,instagram_account_id,automation_id,comment_id,status,delivered)
       VALUES ($1,$2,$3,$4,$5,'completed',TRUE)`,
      [newId('run'), other.id, otherAccount.id, otherAutomation.id, 'foreign_comment'],
    );

    const stats = await getDashboardStats(repos, userId);
    expect(stats.totalAutomations).toBe(0);
    expect(stats.commentsProcessed).toBe(0);

    const summaries = await listAutomationSummaries(repos, userId);
    expect(summaries).toHaveLength(0);

    const runs = await getRecentRuns(repos, userId);
    expect(runs).toHaveLength(0);

    // و برعکس: مستأجر دیگر دادهٔ خودش را می‌بیند
    const otherStats = await getDashboardStats(repos, other.id);
    expect(otherStats.totalAutomations).toBe(1);
    expect(otherStats.successfulDeliveries).toBe(1);
  });

  it('🔒 findById با userId اشتباه چیزی برنمی‌گرداند', async () => {
    const a = await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'خصوصی', status: 'active',
    });
    const other = await repos.users.create({ email: 'x@y.z', passwordHash: 'x' });
    expect(await repos.automations.findById(other.id, a.id)).toBeNull();
    expect(await repos.automations.findById(userId, a.id)).not.toBeNull();
  });

  it('🔒 حذف اتوماسیون توسط مستأجر غیرمالک ناموفق است', async () => {
    const a = await repos.automations.create(userId, {
      instagram_account_id: accountId, name: 'حذف‌نشدنی', status: 'active',
    });
    const other = await repos.users.create({ email: 'z@y.z', passwordHash: 'x' });
    expect(await repos.automations.delete(other.id, a.id)).toBe(false);
    expect(await repos.automations.findById(userId, a.id)).not.toBeNull();
  });
});
