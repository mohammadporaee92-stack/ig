import { parseWebhookBody, type ParsedEvent, type RawWebhookBody } from '~/domain/automation/webhook-parser';
import type { Repositories } from '~/infra/db/repositories';
import type { Queue } from '~/infra/queue/queue';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';
import type { AutomationEngine } from './automation-engine';

const log = createLogger('webhook-processor');

export interface ProcessorDeps {
  repos: Repositories;
  engine: AutomationEngine;
  queue: Queue;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  eventIds: string[];
}

/**
 * WebhookProcessor
 *
 * دو مسئولیت مجزا:
 *  1) ingest()  → مسیر سریع. فقط ذخیره + enqueue. (باید در < ۵ ثانیه پاسخ دهد)
 *  2) process() → مسیر سنگین. در Worker اجرا می‌شود.
 */
export class WebhookProcessor {
  constructor(private readonly deps: ProcessorDeps) {}

  /** FAST PATH — هیچ تماس شبکه‌ای با Instagram انجام نمی‌دهد */
  async ingest(body: RawWebhookBody, signatureValid: boolean): Promise<IngestResult> {
    const events = parseWebhookBody(body);
    const result: IngestResult = { accepted: 0, duplicates: 0, eventIds: [] };

    for (const ev of events) {
      const igUserId = 'igUserId' in ev ? ev.igUserId : undefined;
      const stored = await this.deps.repos.webhooks.store({
        providerEventId: ev.providerEventId,
        eventType: ev.type,
        igUserId: igUserId ?? null,
        payload: ev,
        signatureValid,
      });

      if (stored.duplicate) {
        result.duplicates++;
        log.info('Already Processed — رویداد تکراری', { providerEventId: ev.providerEventId, type: ev.type });
        continue;
      }

      if (ev.type === 'unknown' || ev.type === 'echo' || ev.type === 'read') {
        await this.deps.repos.webhooks.setStatus(stored.row.id, 'ignored');
        continue;
      }

      await this.deps.repos.webhooks.setStatus(stored.row.id, 'queued');
      await this.deps.queue.enqueue(
        'process-webhook-event',
        { webhookEventId: stored.row.id },
        { jobId: `whk:${stored.row.id}` },
      );
      result.accepted++;
      result.eventIds.push(stored.row.id);
    }

    return result;
  }

  /** SLOW PATH — در Worker؛ با Retry و Exponential Backoff */
  async process(webhookEventId: string): Promise<void> {
    const { repos, engine, queue } = this.deps;
    const row = await repos.webhooks.findById(webhookEventId);
    if (!row) return;
    if (row.status === 'processed') return;

    await repos.webhooks.setStatus(row.id, 'processing');

    let ev: ParsedEvent;
    try {
      ev = JSON.parse(row.payload) as ParsedEvent;
    } catch {
      await repos.webhooks.setStatus(row.id, 'failed', 'payload نامعتبر است');
      return;
    }

    try {
      if (ev.type === 'comment') {
        await engine.handleCommentEvent(ev, row.id);
      } else if (ev.type === 'message' || ev.type === 'postback' || ev.type === 'optin') {
        await engine.handleMessagingEvent(ev);
      }
      await repos.webhooks.setStatus(row.id, 'processed');
    } catch (e) {
      const message = (e as Error).message;
      const attempt = row.retry_count;
      const backoffs = env().retryBackoffMs;
      const maxAttempts = env().RETRY_MAX_ATTEMPTS;

      if (attempt < maxAttempts) {
        const delay = backoffs[Math.min(attempt, backoffs.length - 1)] ?? 60_000;
        await repos.webhooks.incrementRetry(row.id);
        await repos.webhooks.setStatus(row.id, 'queued', message);
        await queue.enqueue(
          'process-webhook-event',
          { webhookEventId: row.id },
          { delayMs: delay, jobId: `whk:${row.id}:r${attempt + 1}` },
        );
        log.warn('پردازش ناموفق — تلاش مجدد زمان‌بندی شد', {
          webhookEventId: row.id, attempt: attempt + 1, delayMs: delay, error: message,
        });
      } else {
        await repos.webhooks.setStatus(row.id, 'failed', message);
        log.error('پردازش پس از حداکثر تلاش‌ها شکست خورد', { webhookEventId: row.id, error: message });
      }
    }
  }
}
