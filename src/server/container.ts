import { FollowCheckerRegistry, InstagramOfficialFollowChecker, UnsupportedFollowChecker } from '~/domain/follow/follow-checker';
import { getDb, type Db } from '~/infra/db/client';
import { createRepositories, type Repositories } from '~/infra/db/repositories';
import { InstagramClient } from '~/infra/instagram/client';
import { MessagingProfileFollowChecker } from '~/infra/instagram/messaging-profile-follow-checker';
import { getQueue, type Queue } from '~/infra/queue/queue';
import { AutomationEngine } from './automation-engine';
import { MessageSender } from './message-sender';
import { RateLimiter } from './rate-limiter';
import { TokenService } from './token-service';
import { WebhookProcessor } from './webhook-processor';

export interface Container {
  db: Db;
  repos: Repositories;
  igClient: InstagramClient;
  tokens: TokenService;
  rateLimiter: RateLimiter;
  sender: MessageSender;
  followCheckers: FollowCheckerRegistry;
  engine: AutomationEngine;
  processor: WebhookProcessor;
  queue: Queue;
}

/** singleton روی globalThis — رجوع کنید به توضیح مشابه در infra/db/client.ts */
interface ContainerGlobal {
  __igflowContainer?: Container | null;
  __igflowContainerInit?: Promise<Container> | null;
}
const g = globalThis as unknown as ContainerGlobal;

export function buildContainer(db: Db, queue: Queue, igClient = new InstagramClient()): Container {
  const repos = createRepositories(db);
  const tokens = new TokenService(repos, igClient);
  const rateLimiter = new RateLimiter(db);
  const sender = new MessageSender(repos, igClient, tokens, rateLimiter);

  const followCheckers = new FollowCheckerRegistry()
    // ✅ پیاده‌سازی رسمی و فعال
    .register(new MessagingProfileFollowChecker(igClient, tokens))
    // 🚫 fallback صادقانه
    .register(new UnsupportedFollowChecker())
    // 🔮 نقطهٔ توسعهٔ آینده
    .register(new InstagramOfficialFollowChecker());

  const engine = new AutomationEngine({ repos, sender, followCheckers, queue });
  const processor = new WebhookProcessor({ repos, engine, queue });

  return { db, repos, igClient, tokens, rateLimiter, sender, followCheckers, engine, processor, queue };
}

export async function getContainer(): Promise<Container> {
  if (g.__igflowContainer) return g.__igflowContainer;
  if (g.__igflowContainerInit) return g.__igflowContainerInit;
  g.__igflowContainerInit = (async () => {
    const db = await getDb();
    const queue = getQueue();
    const c = buildContainer(db, queue);
    g.__igflowContainer = c;
    return c;
  })();
  return g.__igflowContainerInit;
}

export function __setContainerForTests(c: Container | null): void {
  g.__igflowContainer = c;
  g.__igflowContainerInit = null;
}
