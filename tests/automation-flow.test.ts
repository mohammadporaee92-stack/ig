import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentWebhook, createAutomation, createWorld, messageWebhook, type TestWorld } from './helpers';
import { createRepositories } from '~/infra/db/repositories';
import { buildContinuePayload } from '~/domain/automation/webhook-parser';

/**
 * تست‌های end-to-end مسیر اصلی:
 *   Comment → Keyword → Public Reply → Private Reply (+ دکمه)
 *   → تعامل کاربر (consent) → Follow Check رسمی → Main Message / Follow Gate
 */

let world: TestWorld;

beforeEach(async () => { world = await createWorld(); });
afterEach(async () => { await world.close(); });

const ingest = async (body: unknown) => {
  await world.container.processor.ingest(body as never, true);
  await world.queue.drain();
};

function mockFollow(following: boolean) {
  world.ig.handlers.push({
    match: (url, method) => method === 'GET' && url.includes('/igsid_') && url.includes('is_user_follow_business'),
    respond: () => ({
      body: { name: 'علی', username: 'ali_test', follower_count: 120, is_user_follow_business: following },
    }),
  });
}

function mockSend() {
  world.ig.handlers.push({
    match: (url, method) => method === 'POST' && url.includes('/messages'),
    respond: () => ({ body: { recipient_id: 'igsid_user_1', message_id: `mid_${Date.now()}` } }),
  });
  world.ig.handlers.push({
    match: (url, method) => method === 'POST' && url.includes('/replies'),
    respond: () => ({ body: { id: 'reply_1' } }),
  });
}

describe('Automation Flow — مسیر کامل', () => {
  it('کامنت با کلیدواژه → پاسخ عمومی + پیام خصوصی با دکمه', async () => {
    mockSend();
    await createAutomation(world, { keywords: ['CHATGPT'] });

    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'لطفاً CHATGPT رو بفرست' }));

    const replies = world.ig.callsTo('/replies');
    expect(replies.length).toBe(1);
    expect((replies[0]!.body as { message: string }).message).toContain('دایرکت');

    const dms = world.ig.calls.filter((c) => c.url.includes('/messages'));
    expect(dms.length).toBe(1);
    const dmBody = dms[0]!.body as { recipient: { comment_id: string }; message: { text: string; quick_replies?: unknown[] } };
    // private reply روی comment_id — طبق مستندات رسمی
    expect(dmBody.recipient.comment_id).toBe('comment_1');
    expect(dmBody.message.text).toContain('سلام');
    // دکمهٔ ادامه برای ایجاد consent
    expect(dmBody.message.quick_replies).toHaveLength(1);

    const repos = createRepositories(world.db);
    const runs = await repos.runs.listByUser(world.userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('awaiting_user_interaction');
    expect(runs[0]!.matched_keyword).toBe('CHATGPT');
  });

  it('کامنت بدون کلیدواژه هیچ اجرایی نمی‌سازد', async () => {
    mockSend();
    await createAutomation(world, { keywords: ['CHATGPT'] });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'چه پست خوبی!' }));

    const repos = createRepositories(world.db);
    expect(await repos.runs.listByUser(world.userId)).toHaveLength(0);
    expect(world.ig.calls.filter((c) => c.url.includes('/messages'))).toHaveLength(0);
  });

  it('اتوماسیون غیرفعال اجرا نمی‌شود', async () => {
    mockSend();
    await createAutomation(world, { status: 'disabled' });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    expect(await repos.runs.listByUser(world.userId)).toHaveLength(0);
  });

  it('رویداد تکراری دوباره DM نمی‌فرستد (Idempotency)', async () => {
    mockSend();
    await createAutomation(world);
    const payload = commentWebhook({ igUserId: world.igUserId, commentId: 'dup_1', text: 'CHATGPT' });

    await ingest(payload);
    const after1 = world.ig.calls.filter((c) => c.url.includes('/messages')).length;

    // همان رویداد دقیقاً دوباره (retry متا)
    await ingest(payload);
    const after2 = world.ig.calls.filter((c) => c.url.includes('/messages')).length;

    expect(after1).toBe(1);
    expect(after2).toBe(1); // هیچ ارسال اضافه‌ای

    const repos = createRepositories(world.db);
    expect(await repos.runs.listByUser(world.userId)).toHaveLength(1);
  });

  it('once_per_user_per_post: کامنت دوم همان کاربر روی همان پست اجرا نمی‌شود', async () => {
    mockSend();
    await createAutomation(world, { oncePerUserPerPost: true });
    await ingest(commentWebhook({ igUserId: world.igUserId, commentId: 'c1', mediaId: 'm1', text: 'CHATGPT' }));
    await ingest(commentWebhook({ igUserId: world.igUserId, commentId: 'c2', mediaId: 'm1', text: 'CHATGPT دوباره' }));

    const repos = createRepositories(world.db);
    expect(await repos.runs.listByUser(world.userId)).toHaveLength(1);
  });

  it('کامنت خودِ صاحب پیج تریگر نمی‌شود (جلوگیری از حلقه)', async () => {
    mockSend();
    await createAutomation(world);
    await ingest(commentWebhook({ igUserId: world.igUserId, fromIgsid: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    expect(await repos.runs.listByUser(world.userId)).toHaveLength(0);
  });
});

describe('Follow Gate', () => {
  it('کاربر فالو کرده → پیام اصلی ارسال می‌شود', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, { followGate: true, main: 'عالیه {{username}} ❤️ این هم فایل' });

    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;
    expect(run.status).toBe('awaiting_user_interaction');

    // کاربر دکمه را می‌زند ⇒ consent ایجاد می‌شود
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const updated = await repos.runs.findById(run.id);
    expect(updated?.follow_status).toBe('following');
    expect(updated?.follow_reason).toBe('ok');
    expect(updated?.status).toBe('completed');
    expect(updated?.delivered).toBe(true);

    const mainDm = world.ig.calls.filter(
      (c) => c.url.includes('/messages') && (c.body as { message?: { text?: string } })?.message?.text?.includes('عالیه'),
    );
    expect(mainDm).toHaveLength(1);
  });

  it('کاربر فالو نکرده → پیام Follow Gate با دکمهٔ بررسی مجدد', async () => {
    mockSend();
    mockFollow(false);
    await createAutomation(world, {
      followGate: true,
      followGateMsg: 'برای دریافت فایل رایگان ابتدا پیج را فالو کن ❤️',
      main: 'این هم فایل',
    });

    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const updated = await repos.runs.findById(run.id);
    expect(updated?.follow_status).toBe('not_following');
    expect(updated?.status).toBe('follow_gate_sent');
    expect(updated?.delivered).toBe(false);

    const gateMsg = world.ig.calls.filter(
      (c) => (c.body as { message?: { text?: string } })?.message?.text?.includes('فالو کن'),
    );
    expect(gateMsg).toHaveLength(1);
    // دکمهٔ بررسی مجدد
    expect((gateMsg[0]!.body as { message: { quick_replies: unknown[] } }).message.quick_replies).toHaveLength(1);
    // پیام اصلی هرگز نرفته
    expect(world.ig.calls.filter((c) => (c.body as { message?: { text?: string } })?.message?.text === 'این هم فایل')).toHaveLength(0);
  });

  it('فالو کرد → بررسی مجدد → پیام اصلی ارسال می‌شود', async () => {
    mockSend();
    let following = false;
    world.ig.handlers.push({
      match: (url, method) => method === 'GET' && url.includes('is_user_follow_business'),
      respond: () => ({ body: { username: 'ali_test', is_user_follow_business: following } }),
    });
    await createAutomation(world, { followGate: true, main: 'محتوای اصلی 🎁' });

    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    // بار اول: فالو نکرده
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));
    expect((await repos.runs.findById(run.id))?.status).toBe('follow_gate_sent');

    // کاربر فالو می‌کند و دکمهٔ بررسی مجدد را می‌زند
    following = true;
    await ingest(messageWebhook({ igUserId: world.igUserId, mid: 'mid_recheck', text: 'بررسی مجدد' }));

    const done = await repos.runs.findById(run.id);
    expect(done?.follow_status).toBe('following');
    expect(done?.status).toBe('completed');
    expect(done?.delivered).toBe(true);
    expect(world.ig.calls.filter((c) => (c.body as { message?: { text?: string } })?.message?.text === 'محتوای اصلی 🎁')).toHaveLength(1);
  });

  it('consent نبود → وضعیت unknown و سیاست deliver پیام اصلی را می‌فرستد', async () => {
    mockSend();
    await createAutomation(world, { followGate: true, followUnknownPolicy: 'deliver', main: 'فایل' });

    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    // مستقیماً continue بدون تعامل کاربر ⇒ consent وجود ندارد
    await world.container.engine.continueRun(run.id);

    const updated = await repos.runs.findById(run.id);
    expect(updated?.follow_status).toBe('unknown');
    expect(updated?.follow_reason).toBe('consent_required');
    expect(updated?.status).toBe('completed');
    // مهم: هیچ درخواستی به API پروفایل زده نشده (چون می‌دانیم شکست می‌خورد)
    expect(world.ig.calls.filter((c) => c.url.includes('is_user_follow_business'))).toHaveLength(0);
  });

  it('سیاست gate در حالت unknown پیام اصلی را نمی‌فرستد', async () => {
    mockSend();
    await createAutomation(world, { followGate: true, followUnknownPolicy: 'gate', main: 'فایل-محرمانه' });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    await world.container.engine.continueRun(run.id);
    const updated = await repos.runs.findById(run.id);
    expect(updated?.status).toBe('follow_gate_sent');
    expect(world.ig.calls.filter((c) => (c.body as { message?: { text?: string } })?.message?.text === 'فایل-محرمانه')).toHaveLength(0);
  });

  it('سیاست fail در حالت unknown اجرا را failed می‌کند', async () => {
    mockSend();
    await createAutomation(world, { followGate: true, followUnknownPolicy: 'fail' });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    await world.container.engine.continueRun(run.id);
    const updated = await repos.runs.findById(run.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error_code).toBe('consent_required');
  });

  it('بدون Follow Gate مستقیماً پیام اصلی می‌رود', async () => {
    mockSend();
    await createAutomation(world, { followGate: false, main: 'مستقیم' });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));
    const updated = await repos.runs.findById(run.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.delivered).toBe(true);
    expect(world.ig.calls.filter((c) => c.url.includes('is_user_follow_business'))).toHaveLength(0);
  });
});

describe('متغیرهای پویا و لاگ', () => {
  it('{{username}} و {{keyword}} در پیام جایگزین می‌شوند', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, {
      followGate: true,
      main: 'سلام {{username}} 👋 کلیدواژه: {{keyword}} | کامنت: {{comment}}',
    });
    await ingest(commentWebhook({ igUserId: world.igUserId, username: 'ali_test', text: 'CHATGPT لطفا' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const main = world.ig.calls.find((c) => (c.body as { message?: { text?: string } })?.message?.text?.includes('سلام ali_test'));
    expect(main).toBeDefined();
    const text = (main!.body as { message: { text: string } }).message.text;
    expect(text).toContain('کلیدواژه: CHATGPT');
    expect(text).toContain('کامنت: CHATGPT لطفا');
  });

  it('{{link}} با لینک تعریف‌شدهٔ اتوماسیون جایگزین می‌شود', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, {
      followGate: true,
      linkUrl: 'https://example.com/course',
      main: 'بفرما {{username}} 🎁 {{link}}',
    });
    await ingest(commentWebhook({ igUserId: world.igUserId, username: 'ali_test', text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const main = world.ig.calls.find(
      (c) => (c.body as { message?: { text?: string } })?.message?.text?.includes('بفرما ali_test'),
    );
    expect(main).toBeDefined();
    const text = (main!.body as { message: { text: string } }).message.text;
    expect(text).toContain('https://example.com/course');
    expect(text).not.toContain('{{link}}');
  });

  it('لینک خالی باعث متن {{link}} در پیام نمی‌شود', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, { followGate: true, main: 'لینک: {{link}}|پایان' });
    await ingest(commentWebhook({ igUserId: world.igUserId, username: 'b', text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const main = world.ig.calls.find(
      (c) => (c.body as { message?: { text?: string } })?.message?.text?.includes('لینک:'),
    );
    const text = (main!.body as { message: { text: string } }).message.text;
    expect(text).toBe('لینک: |پایان');
  });

  it('تایم‌لاین لاگ هر مرحله را ثبت می‌کند', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, { followGate: true });
    await ingest(commentWebhook({ igUserId: world.igUserId, text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;
    await ingest(messageWebhook({ igUserId: world.igUserId, quickReplyPayload: buildContinuePayload(run.id) }));

    const codes = (await repos.runEvents.listByRun(world.userId, run.id)).map((e) => e.code);
    expect(codes).toContain('comment_received');
    expect(codes).toContain('keyword_matched');
    expect(codes).toContain('private_reply_sent');
    expect(codes).toContain('user_identified');
    expect(codes).toContain('follow_check');
    expect(codes).toContain('main_message_sent');
  });
});

describe('امنیت Flow', () => {
  it('payload جعلی دکمه با runId کاربر دیگر رد می‌شود', async () => {
    mockSend();
    mockFollow(true);
    await createAutomation(world, { followGate: true, main: 'محتوای-خصوصی' });
    await ingest(commentWebhook({ igUserId: world.igUserId, fromIgsid: 'igsid_victim', text: 'CHATGPT' }));
    const repos = createRepositories(world.db);
    const run = (await repos.runs.listByUser(world.userId))[0]!;

    // مهاجم با IGSID دیگری runId قربانی را می‌فرستد
    await ingest(messageWebhook({
      igUserId: world.igUserId,
      senderIgsid: 'igsid_attacker',
      quickReplyPayload: buildContinuePayload(run.id),
    }));

    const victimRun = await repos.runs.findById(run.id);
    expect(victimRun?.status).toBe('awaiting_user_interaction'); // دست‌نخورده
    expect(world.ig.calls.filter((c) => (c.body as { message?: { text?: string } })?.message?.text === 'محتوای-خصوصی')).toHaveLength(0);
  });
});
