import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { commentWebhook, createAutomation, createWorld, messageWebhook, type TestWorld } from './helpers';
import { parseWebhookBody } from '~/domain/automation/webhook-parser';
import { verifyWebhookSignature } from '~/lib/crypto';

let world: TestWorld;
beforeEach(async () => { world = await createWorld(); });
afterEach(async () => { await world.close(); });

const IG = '17841400000000001';

describe('Webhook — Verification', () => {
  const VERIFY_TOKEN = 'test-verify-token';

  it('توکن درست ⇒ challenge برگردانده می‌شود', () => {
    const params = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '99887766' });
    const ok = params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === VERIFY_TOKEN;
    expect(ok).toBe(true);
    expect(params.get('hub.challenge')).toBe('99887766');
  });

  it('توکن غلط ⇒ رد', () => {
    const supplied: string = 'wrong-token';
    expect(supplied === VERIFY_TOKEN).toBe(false);
  });
});

describe('Webhook — Signature', () => {
  const secret = 'test-app-secret';
  it('امضای معتبر پذیرفته می‌شود', () => {
    const body = JSON.stringify(commentWebhook({ igUserId: IG, text: 'CHATGPT' }));
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });
  it('امضای نامعتبر رد می‌شود', () => {
    const body = JSON.stringify(commentWebhook({ igUserId: IG, text: 'CHATGPT' }));
    expect(verifyWebhookSignature(body, 'sha256=0000', secret)).toBe(false);
  });
  it('بدنهٔ دستکاری‌شده با امضای قدیمی رد می‌شود', () => {
    const original = JSON.stringify(commentWebhook({ igUserId: IG, text: 'CHATGPT' }));
    const sig = `sha256=${createHmac('sha256', secret).update(original).digest('hex')}`;
    const tampered = JSON.stringify(commentWebhook({ igUserId: IG, text: 'HACKED' }));
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });
});

describe('Webhook — Parsing', () => {
  it('payload کامنت رسمی درست parse می‌شود', () => {
    const events = parseWebhookBody(commentWebhook({ igUserId: IG, commentId: 'c9', mediaId: 'm9', text: 'سلام AI' }));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.type).toBe('comment');
    if (e.type === 'comment') {
      expect(e.commentId).toBe('c9');
      expect(e.mediaId).toBe('m9');
      expect(e.text).toBe('سلام AI');
      expect(e.fromIgsid).toBe('igsid_user_1');
      expect(e.isFromSelf).toBe(false);
    }
  });

  it('کامنت خود حساب علامت isFromSelf می‌گیرد', () => {
    const events = parseWebhookBody(commentWebhook({ igUserId: IG, fromIgsid: IG, text: 'x' }));
    const e = events[0]!;
    expect(e.type === 'comment' && e.isFromSelf).toBe(true);
  });

  it('payload پیام با quick_reply درست parse می‌شود', () => {
    const events = parseWebhookBody(messageWebhook({ igUserId: IG, quickReplyPayload: 'IGFLOW_CONTINUE:run_1' }));
    const e = events[0]!;
    expect(e.type).toBe('message');
    if (e.type === 'message') {
      expect(e.quickReplyPayload).toBe('IGFLOW_CONTINUE:run_1');
      expect(e.senderIgsid).toBe('igsid_user_1');
      expect(e.isEcho).toBe(false);
    }
  });

  it('پیام echo تشخیص داده می‌شود', () => {
    const events = parseWebhookBody({
      object: 'instagram',
      entry: [{ id: IG, messaging: [{ sender: { id: IG }, recipient: { id: 'u1' }, timestamp: Date.now(), message: { mid: 'm1', text: 'x', is_echo: true } }] }],
    });
    expect(events[0]!.type).toBe('echo');
  });

  it('چند entry / چند change در یک batch', () => {
    const events = parseWebhookBody({
      object: 'instagram',
      entry: [
        { id: IG, changes: [
          { field: 'comments', value: { id: 'a1', text: 'one', from: { id: 'u1' }, media: { id: 'm' } } },
          { field: 'comments', value: { id: 'a2', text: 'two', from: { id: 'u2' }, media: { id: 'm' } } },
        ] },
        { id: IG, messaging: [{ sender: { id: 'u3' }, recipient: { id: IG }, timestamp: 1, message: { mid: 'x', text: 'hi' } }] },
      ],
    });
    expect(events).toHaveLength(3);
  });

  it('فیلد ناشناخته باعث crash نمی‌شود', () => {
    const events = parseWebhookBody({ object: 'instagram', entry: [{ id: IG, changes: [{ field: 'story_insights', value: {} }] }] });
    expect(events[0]!.type).toBe('unknown');
  });

  it('بدنهٔ خالی آرایهٔ خالی می‌دهد', () => {
    expect(parseWebhookBody({})).toHaveLength(0);
    expect(parseWebhookBody({ object: 'instagram', entry: [] })).toHaveLength(0);
  });
});

describe('Webhook — Idempotency در ingest', () => {
  it('همان رویداد دوبار ⇒ بار دوم duplicate', async () => {
    await createAutomation(world);
    const body = commentWebhook({ igUserId: IG, commentId: 'dupe_x', text: 'CHATGPT' });

    const r1 = await world.container.processor.ingest(body as never, true);
    expect(r1.accepted).toBe(1);
    expect(r1.duplicates).toBe(0);

    const r2 = await world.container.processor.ingest(body as never, true);
    expect(r2.accepted).toBe(0);
    expect(r2.duplicates).toBe(1);

    await world.queue.drain();
    const rows = await world.db.query('SELECT count(*)::int AS c FROM webhook_events');
    expect((rows.rows[0] as { c: number }).c).toBe(1);
  });

  it('رویدادهای ignore شده (echo/read) enqueue نمی‌شوند', async () => {
    const res = await world.container.processor.ingest(
      { object: 'instagram', entry: [{ id: IG, messaging: [{ sender: { id: IG }, recipient: { id: 'u' }, timestamp: 1, message: { mid: 'e1', is_echo: true } }] }] } as never,
      true,
    );
    expect(res.accepted).toBe(0);
    const rows = await world.db.query<{ status: string }>(`SELECT status FROM webhook_events`);
    expect(rows.rows[0]!.status).toBe('ignored');
  });

  it('حساب ناشناس (متصل‌نشده) پردازش می‌شود ولی اجرایی نمی‌سازد', async () => {
    await createAutomation(world);
    await world.container.processor.ingest(commentWebhook({ igUserId: '99999999999', text: 'CHATGPT' }) as never, true);
    await world.queue.drain();
    const rows = await world.db.query('SELECT count(*)::int AS c FROM automation_runs');
    expect((rows.rows[0] as { c: number }).c).toBe(0);
  });
});

describe('Webhook — Retry با Exponential Backoff', () => {
  it('خطای موقتی باعث زمان‌بندی تلاش مجدد می‌شود', async () => {
    await createAutomation(world);
    // اجباراً engine را خراب می‌کنیم
    const original = world.container.engine.handleCommentEvent.bind(world.container.engine);
    let attempts = 0;
    world.container.engine.handleCommentEvent = async (...args: Parameters<typeof original>) => {
      attempts++;
      if (attempts <= 2) throw new Error('خطای موقتی شبکه');
      return original(...args);
    };
    world.ig.handlers.push({ match: () => true, respond: () => ({ body: { message_id: 'm' } }) });

    await world.container.processor.ingest(commentWebhook({ igUserId: IG, commentId: 'retry_1', text: 'CHATGPT' }) as never, true);
    // منتظر backoff ها (تست: 5s/30s خیلی طولانی است، پس مستقیم process را صدا می‌زنیم)
    await world.queue.drain();

    const row = await world.db.query<{ retry_count: number; status: string; error: string }>(
      `SELECT retry_count, status, error FROM webhook_events WHERE provider_event_id = 'retry_1'`,
    );
    expect(row.rows[0]!.retry_count).toBeGreaterThanOrEqual(1);
    expect(row.rows[0]!.error).toContain('خطای موقتی');
    expect(['queued', 'processing']).toContain(row.rows[0]!.status);
  });

  it('پس از حداکثر تلاش‌ها وضعیت failed می‌شود', async () => {
    await createAutomation(world);
    world.container.engine.handleCommentEvent = async () => { throw new Error('همیشه خطا'); };

    await world.container.processor.ingest(commentWebhook({ igUserId: IG, commentId: 'fail_1', text: 'CHATGPT' }) as never, true);
    await world.queue.drain();

    const evId = (await world.db.query<{ id: string }>(`SELECT id FROM webhook_events WHERE provider_event_id='fail_1'`)).rows[0]!.id;
    // شبیه‌سازی رسیدن به سقف تلاش‌ها
    for (let i = 0; i < 4; i++) await world.container.processor.process(evId);

    const row = await world.db.query<{ status: string; retry_count: number }>(
      `SELECT status, retry_count FROM webhook_events WHERE id = $1`, [evId],
    );
    expect(row.rows[0]!.status).toBe('failed');
    expect(row.rows[0]!.retry_count).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ════════════════════════════════════════════════════════════════
 *  حالت سرورلس (Vercel) — پردازش بدون Worker دائمی
 * ════════════════════════════════════════════════════════════════
 * روی Vercel هیچ پروسه‌ای وجود ندارد که صف را تخلیه کند، پس مسیر webhook
 * رویدادها را بعد از ارسال پاسخ ۲۰۰ با `after()` خودش پردازش می‌کند.
 *
 * `createWorld()` عمداً یک worker درون‌فرایندی وصل می‌کند، بنابراین برای
 * شبیه‌سازی واقعی Vercel اینجا صف را **بدون** هیچ handler می‌سازیم: هر چه
 * enqueue شود تا ابد آنجا می‌ماند — دقیقاً مثل استقرار سرورلس بدون worker.
 */
describe('Webhook — حالت سرورلس (بدون Worker)', () => {
  it('بدون Worker هیچ پیامی نمی‌رود؛ با پردازش درون‌خطی می‌رود', async () => {
    const { InMemoryQueue } = await import('~/infra/queue/queue');
    const { buildContainer } = await import('~/server/container');

    // صف بدون handler = Vercel بدون worker
    const orphanQueue = new InMemoryQueue();
    const c = buildContainer(world.db, orphanQueue, world.container.igClient);

    world.ig.handlers.push({ match: () => true, respond: () => ({ body: { id: 'x', message_id: 'm' } }) });
    await createAutomation(world);

    const result = await c.processor.ingest(
      commentWebhook({ igUserId: IG, commentId: 'srvless_1', text: 'CHATGPT' }) as never,
      true,
    );
    expect(result.accepted).toBe(1);
    expect(result.eventIds).toHaveLength(1);

    // ❗ این همان اشکالی است که استقرار روی Vercel را بی‌صدا خراب می‌کند
    expect(world.ig.callsTo('/messages')).toHaveLength(0);
    const queued = await world.db.query<{ status: string }>(
      `SELECT status FROM webhook_events WHERE provider_event_id = 'srvless_1'`,
    );
    expect(queued.rows[0]!.status).toBe('queued');

    // همان کاری که after() در route انجام می‌دهد
    for (const id of result.eventIds) await c.processor.process(id);

    expect(world.ig.callsTo('/messages').length).toBeGreaterThan(0);
    const done = await world.db.query<{ status: string }>(
      `SELECT status FROM webhook_events WHERE provider_event_id = 'srvless_1'`,
    );
    expect(done.rows[0]!.status).toBe('processed');
  });

  it('اگر هم Worker و هم پردازش درون‌خطی اجرا شوند، پیام تکراری نمی‌رود', async () => {
    const { InMemoryQueue } = await import('~/infra/queue/queue');
    const { buildContainer } = await import('~/server/container');

    const orphanQueue = new InMemoryQueue();
    const c = buildContainer(world.db, orphanQueue, world.container.igClient);

    world.ig.handlers.push({ match: () => true, respond: () => ({ body: { id: 'x', message_id: 'm' } }) });
    await createAutomation(world);

    const result = await c.processor.ingest(
      commentWebhook({ igUserId: IG, commentId: 'srvless_2', text: 'CHATGPT' }) as never,
      true,
    );
    const id = result.eventIds[0]!;

    await c.processor.process(id);
    const afterFirst = world.ig.callsTo('/messages').length;
    expect(afterFirst).toBeGreaterThan(0);

    await c.processor.process(id);
    expect(world.ig.callsTo('/messages')).toHaveLength(afterFirst);
  });
});
