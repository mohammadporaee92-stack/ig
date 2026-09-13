import { createTestDb, type Db } from '~/infra/db/client';
import { buildContainer, type Container } from '~/server/container';
import { InMemoryQueue } from '~/infra/queue/queue';
import { InstagramClient, type FetchLike } from '~/infra/instagram/client';
import { createRepositories } from '~/infra/db/repositories';
import { hashPassword, encryptSecret } from '~/lib/crypto';

export interface ApiCall {
  url: string;
  method: string;
  body: unknown;
}

export interface MockIg {
  calls: ApiCall[];
  /** مسیر (بخشی از URL) → پاسخ */
  handlers: Array<{ match: (url: string, method: string, body: unknown) => boolean; respond: () => { status?: number; body: unknown } }>;
  fetch: FetchLike;
  callsTo(fragment: string): ApiCall[];
  reset(): void;
}

export function createMockIg(): MockIg {
  const mock: MockIg = {
    calls: [],
    handlers: [],
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET';
      let body: unknown = undefined;
      if (typeof init?.body === 'string') {
        try { body = JSON.parse(init.body); } catch { body = init.body; }
      } else if (init?.body instanceof URLSearchParams) {
        body = Object.fromEntries(init.body.entries());
      }
      mock.calls.push({ url, method, body });

      for (const h of mock.handlers) {
        if (h.match(url, method, body)) {
          const r = h.respond();
          return new Response(JSON.stringify(r.body), {
            status: r.status ?? 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    callsTo(fragment) {
      return mock.calls.filter((c) => c.url.includes(fragment));
    },
    reset() {
      mock.calls.length = 0;
      mock.handlers.length = 0;
    },
  };
  return mock;
}

export interface TestWorld {
  db: Db;
  queue: InMemoryQueue;
  ig: MockIg;
  container: Container;
  userId: string;
  accountId: string;
  igUserId: string;
  close(): Promise<void>;
}

export async function createWorld(): Promise<TestWorld> {
  const db = await createTestDb();
  const queue = new InMemoryQueue();
  const ig = createMockIg();
  const client = new InstagramClient(ig.fetch);
  const container = buildContainer(db, queue, client);
  const repos = createRepositories(db);

  const user = await repos.users.create({ email: 'owner@example.com', passwordHash: hashPassword('Passw0rd!123') });
  const igUserId = '17841400000000001';
  const account = await repos.accounts.upsert({
    userId: user.id,
    igUserId,
    username: 'mohammad_por_ai',
    accountType: 'BUSINESS',
    scopes: ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'],
  });
  await repos.tokens.upsert({
    userId: user.id,
    instagramAccountId: account.id,
    accessTokenEnc: encryptSecret('IGQVJTEST_TOKEN_VALUE_1234567890'),
    scopes: ['instagram_business_basic'],
    expiresAt: new Date(Date.now() + 60 * 86400_000),
  });

  // worker درون‌فرایندی
  await queue.process(async (job) => {
    if (job.name === 'process-webhook-event') {
      await container.processor.process((job.data as { webhookEventId: string }).webhookEventId);
    } else if (job.name === 'continue-run') {
      await container.engine.continueRun((job.data as { runId: string }).runId);
    } else if (job.name === 'retry-run') {
      await container.engine.retryRun((job.data as { runId: string }).runId);
    }
  });

  return {
    db, queue, ig, container,
    userId: user.id,
    accountId: account.id,
    igUserId,
    async close() { await db.close(); },
  };
}

export async function createAutomation(
  world: TestWorld,
  opts: {
    name?: string;
    keywords?: string[];
    matchMode?: 'contains' | 'exact';
    followGate?: boolean;
    followUnknownPolicy?: 'deliver' | 'gate' | 'fail';
    status?: 'active' | 'disabled';
    publicReply?: string | null;
    privateReply?: string | null;
    followGateMsg?: string | null;
    main?: string | null;
    oncePerUserPerPost?: boolean;
    linkUrl?: string;
  } = {},
) {
  const repos = createRepositories(world.db);
  const a = await repos.automations.create(world.userId, {
    instagram_account_id: world.accountId,
    name: opts.name ?? 'Free ChatGPT Course',
    status: opts.status ?? 'active',
    match_mode: opts.matchMode ?? 'contains',
    follow_gate_enabled: opts.followGate ?? false,
    follow_unknown_policy: opts.followUnknownPolicy ?? 'deliver',
    once_per_user_per_post: opts.oncePerUserPerPost ?? true,
    public_reply_enabled: opts.publicReply !== null,
    private_reply_enabled: opts.privateReply !== null,
    bot_disclosure_enabled: false,
    link_url: opts.linkUrl ?? '',
  });
  const kws = opts.keywords ?? ['CHATGPT'];
  await repos.automations.replaceKeywords(
    world.userId,
    a.id,
    kws.map((k) => ({ keyword: k, keywordNorm: k.toLowerCase() })),
  );
  if (opts.publicReply !== null) {
    await repos.automations.upsertTemplate(world.userId, a.id, 'public_reply', {
      body: opts.publicReply ?? 'پیام داخل دایرکت برات ارسال شد 📩',
    });
  }
  if (opts.privateReply !== null) {
    await repos.automations.upsertTemplate(world.userId, a.id, 'private_reply', {
      body: opts.privateReply ?? 'سلام 👋 برای دریافت فایل، چند لحظه همراه من باش.',
    });
  }
  await repos.automations.upsertTemplate(world.userId, a.id, 'follow_gate', {
    body: opts.followGateMsg ?? 'برای دریافت فایل رایگان ابتدا پیج را فالو کن ❤️',
  });
  await repos.automations.upsertTemplate(world.userId, a.id, 'main', {
    body: opts.main ?? 'سلام {{username}} 👋 این هم فایل: {{link}}',
  });
  return a;
}

export function commentWebhook(opts: {
  igUserId: string;
  commentId?: string;
  mediaId?: string;
  fromIgsid?: string;
  username?: string;
  text: string;
}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: opts.igUserId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'comments',
            value: {
              id: opts.commentId ?? 'comment_1',
              text: opts.text,
              media: { id: opts.mediaId ?? 'media_1' },
              from: { id: opts.fromIgsid ?? 'igsid_user_1', username: opts.username ?? 'ali_test' },
              timestamp: new Date().toISOString(),
            },
          },
        ],
      },
    ],
  };
}

export function messageWebhook(opts: {
  igUserId: string;
  senderIgsid?: string;
  text?: string;
  quickReplyPayload?: string;
  mid?: string;
}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: opts.igUserId,
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: opts.senderIgsid ?? 'igsid_user_1' },
            recipient: { id: opts.igUserId },
            timestamp: Date.now(),
            message: {
              mid: opts.mid ?? `mid_${Math.random().toString(36).slice(2)}`,
              text: opts.text ?? 'انجام شد',
              ...(opts.quickReplyPayload ? { quick_reply: { payload: opts.quickReplyPayload } } : {}),
            },
          },
        ],
      },
    ],
  };
}
