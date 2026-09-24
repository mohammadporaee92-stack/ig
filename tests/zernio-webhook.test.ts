import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '~/app/api/webhooks/zernio/route';
import { createRepositories } from '~/infra/db/repositories';
import { __resetEnv } from '~/lib/env';
import { __setContainerForTests } from '~/server/container';
import { createWorld, type TestWorld } from './helpers';

const originalSecret = process.env.ZERNIO_WEBHOOK_SECRET;

describe('Zernio signed webhook', () => {
  let world: TestWorld;
  const secret = 'zernio_test_webhook_secret_at_least_32_chars';

  beforeEach(async () => {
    process.env.ZERNIO_WEBHOOK_SECRET = secret;
    __resetEnv();
    world = await createWorld();
    __setContainerForTests(world.container);
  });

  afterEach(async () => {
    __setContainerForTests(null);
    await world.close();
    if (originalSecret === undefined) delete process.env.ZERNIO_WEBHOOK_SECRET;
    else process.env.ZERNIO_WEBHOOK_SECRET = originalSecret;
    __resetEnv();
  });

  it('امضا را روی raw body بررسی و retry را idempotent ذخیره می‌کند', async () => {
    const repos = createRepositories(world.db);
    const account = await repos.accounts.upsertZernio({
      userId: world.userId,
      providerAccountId: 'z_account_webhook',
      providerProfileId: 'z_profile_webhook',
      username: 'mohammad_por_ai',
      active: true,
    });
    const raw = JSON.stringify({
      id: 'evt_z_1',
      event: 'comment.received',
      account: { id: 'z_account_webhook' },
      comment: { id: 'comment_1', text: 'PDF' },
    });
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    const makeRequest = () => new Request('https://ig.example/api/webhooks/zernio', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zernio-signature': signature,
        'x-zernio-event-id': 'evt_z_1',
        'x-zernio-event': 'comment.received',
      },
      body: raw,
    });

    expect((await POST(makeRequest())).status).toBe(200);
    expect((await POST(makeRequest())).status).toBe(200);

    const events = await world.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM webhook_events WHERE platform='zernio' AND provider_event_id='evt_z_1'`,
    );
    const updated = await repos.accounts.findById(world.userId, account.id);
    expect(events.rows[0]?.count).toBe(1);
    expect(updated?.webhook_subscribed).toBe(true);
    expect(updated?.webhook_fields).toBe('zernio-signed-events');
  });

  it('درخواست با امضای نامعتبر را قبل از دیتابیس رد می‌کند', async () => {
    const response = await POST(new Request('https://ig.example/api/webhooks/zernio', {
      method: 'POST',
      headers: { 'x-zernio-signature': '0'.repeat(64) },
      body: JSON.stringify({ id: 'bad_evt', event: 'comment.received' }),
    }));
    const events = await world.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM webhook_events WHERE platform='zernio'`);
    expect(response.status).toBe(401);
    expect(events.rows[0]?.count).toBe(0);
  });
});
