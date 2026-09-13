import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

const log = createLogger('queue');

export interface JobPayload {
  'process-webhook-event': { webhookEventId: string };
  'continue-run': { runId: string; trigger: 'quick_reply' | 'message' | 'retry' };
  'refresh-tokens': Record<string, never>;
}

export type JobName = keyof JobPayload;

export interface EnqueueOptions {
  delayMs?: number;
  /** برای idempotency در سطح صف */
  jobId?: string;
  attempts?: number;
}

export interface Job<N extends JobName = JobName> {
  name: N;
  data: JobPayload[N];
  attemptsMade: number;
}

export type JobHandler = <N extends JobName>(job: Job<N>) => Promise<void>;

export interface Queue {
  readonly kind: 'bullmq' | 'memory';
  enqueue<N extends JobName>(name: N, data: JobPayload[N], opts?: EnqueueOptions): Promise<void>;
  process(handler: JobHandler): Promise<void>;
  /** فقط تست: صبر تا تخلیهٔ صف */
  drain?(): Promise<void>;
  close(): Promise<void>;
}

/* ─────────────── In-memory (dev/test/CI بدون Redis) ─────────────── */

export class InMemoryQueue implements Queue {
  readonly kind = 'memory' as const;
  private handler: JobHandler | null = null;
  private readonly pending: Array<{ name: JobName; data: unknown; attemptsMade: number }> = [];
  private readonly seenJobIds = new Set<string>();
  private running = false;
  private inflight = 0;

  async enqueue<N extends JobName>(name: N, data: JobPayload[N], opts?: EnqueueOptions): Promise<void> {
    if (opts?.jobId) {
      if (this.seenJobIds.has(opts.jobId)) {
        log.debug('job تکراری نادیده گرفته شد', { jobId: opts.jobId });
        return;
      }
      this.seenJobIds.add(opts.jobId);
    }
    const push = () => {
      this.pending.push({ name, data, attemptsMade: 0 });
      void this.tick();
    };
    if (opts?.delayMs && opts.delayMs > 0) {
      setTimeout(push, opts.delayMs).unref?.();
    } else {
      push();
    }
  }

  async process(handler: JobHandler): Promise<void> {
    this.handler = handler;
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running || !this.handler) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const job = this.pending.shift();
        if (!job) break;
        this.inflight++;
        try {
          await this.handler({ name: job.name, data: job.data as never, attemptsMade: job.attemptsMade });
        } catch (e) {
          log.error('job شکست خورد', { name: job.name, error: (e as Error).message });
        } finally {
          this.inflight--;
        }
      }
    } finally {
      this.running = false;
    }
  }

  async drain(): Promise<void> {
    // اجازه بده timeout های تاخیردار هم اجرا شوند
    for (let i = 0; i < 200; i++) {
      if (!this.pending.length && !this.running && this.inflight === 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async close(): Promise<void> {
    this.pending.length = 0;
  }
}

/* ─────────────── BullMQ + Redis (production) ─────────────── */

class BullQueue implements Queue {
  readonly kind = 'bullmq' as const;
  private q: import('bullmq').Queue | null = null;
  private worker: import('bullmq').Worker | null = null;
  private connection: import('ioredis').Redis | null = null;

  constructor(private readonly redisUrl: string, private readonly prefix: string) {}

  private async getConnection() {
    if (!this.connection) {
      const { default: IORedis } = await import('ioredis');
      this.connection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }

  private async getQueue() {
    if (!this.q) {
      const { Queue: BQ } = await import('bullmq');
      this.q = new BQ(`${this.prefix}:jobs`, { connection: await this.getConnection() });
    }
    return this.q;
  }

  async enqueue<N extends JobName>(name: N, data: JobPayload[N], opts?: EnqueueOptions): Promise<void> {
    const q = await this.getQueue();
    await q.add(name, data, {
      delay: opts?.delayMs,
      jobId: opts?.jobId,
      attempts: opts?.attempts ?? 1, // retry سطح دامنه خودمان مدیریت می‌کنیم
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    });
  }

  async process(handler: JobHandler): Promise<void> {
    const { Worker } = await import('bullmq');
    this.worker = new Worker(
      `${this.prefix}:jobs`,
      async (job) => {
        await handler({ name: job.name as JobName, data: job.data as never, attemptsMade: job.attemptsMade });
      },
      { connection: await this.getConnection(), concurrency: env().QUEUE_CONCURRENCY },
    );
    this.worker.on('failed', (job, err) => log.error('job شکست خورد', { name: job?.name, error: err.message }));
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.q?.close();
    this.connection?.disconnect();
  }
}

/** singleton روی globalThis — رجوع کنید به توضیح مشابه در infra/db/client.ts */
interface QueueGlobal { __igflowQueue?: Queue | null }
const g = globalThis as unknown as QueueGlobal;

export function getQueue(): Queue {
  if (g.__igflowQueue) return g.__igflowQueue;
  const e = env();
  const q = e.REDIS_URL ? new BullQueue(e.REDIS_URL, e.QUEUE_PREFIX) : new InMemoryQueue();
  g.__igflowQueue = q;
  log.info('صف مقداردهی شد', { kind: q.kind });
  return q;
}

export function __setQueueForTests(q: Queue | null): void {
  g.__igflowQueue = q;
}
