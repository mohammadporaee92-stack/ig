import type { FollowCheckerRegistry } from '~/domain/follow/follow-checker';
import { matchKeywords, normalizeText, type MatchMode } from '~/domain/keyword/engine';
import { renderTemplate, type RenderContext } from '~/domain/messaging/renderer';
import {
  buildContinuePayload,
  buildRecheckPayload,
  parseFlowPayload,
  type ParsedCommentEvent,
  type ParsedMessageEvent,
} from '~/domain/automation/webhook-parser';
import type { AutomationRow, Repositories, RunRow, TemplateRow } from '~/infra/db/repositories';
import type { Attachment, QuickReply } from '~/infra/instagram/client';
import type { Queue } from '~/infra/queue/queue';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';
import type { MessageSender } from './message-sender';

const log = createLogger('automation-engine');

/* ─────────── وضعیت‌های Run ─────────── */
export const RunStatus = {
  Received: 'received',
  KeywordMatched: 'keyword_matched',
  PublicReplySent: 'public_reply_sent',
  PrivateReplySent: 'private_reply_sent',
  AwaitingUserInteraction: 'awaiting_user_interaction',
  FollowChecked: 'follow_checked',
  FollowGateSent: 'follow_gate_sent',
  MainMessageSent: 'main_message_sent',
  Completed: 'completed',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;

export interface EngineDeps {
  repos: Repositories;
  sender: MessageSender;
  followCheckers: FollowCheckerRegistry;
  queue: Queue;
}

interface TemplateBundle {
  publicReply?: TemplateRow;
  privateReply?: TemplateRow;
  followGate?: TemplateRow;
  main?: TemplateRow;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function bundleTemplates(rows: TemplateRow[]): TemplateBundle {
  const out: TemplateBundle = {};
  for (const r of rows) {
    if (r.kind === 'public_reply') out.publicReply = r;
    else if (r.kind === 'private_reply') out.privateReply = r;
    else if (r.kind === 'follow_gate') out.followGate = r;
    else if (r.kind === 'main') out.main = r;
  }
  return out;
}

/** دکمهٔ «✅ انجام شد» — عنوان طبق محدودیت رسمی حداکثر ۲۰ کاراکتر */
function continueButton(runId: string, title = '✅ انجام شد'): QuickReply {
  return { content_type: 'text', title: title.slice(0, 20), payload: buildContinuePayload(runId) };
}
function recheckButton(runId: string, title = '🔄 بررسی مجدد'): QuickReply {
  return { content_type: 'text', title: title.slice(0, 20), payload: buildRecheckPayload(runId) };
}

export class AutomationEngine {
  constructor(private readonly deps: EngineDeps) {}

  /**
   * تلاش مجدد پایدار برای Runهایی که به‌خاطر rate limit یا خطای موقت متوقف شدند.
   * وضعیت Run تعیین می‌کند باید تماس اول تکرار شود یا ادامهٔ Follow/Main Message.
   */
  async retryRun(runId: string): Promise<void> {
    const run = await this.deps.repos.runs.findById(runId);
    if (!run || ['completed', 'failed', 'skipped'].includes(run.status)) return;
    if (run.next_retry_at && new Date(run.next_retry_at).getTime() > Date.now()) return;

    await this.deps.repos.runs.patch(run.id, { next_retry_at: null, error: null });
    const automation = await this.deps.repos.automations.findById(run.user_id, run.automation_id);
    if (!automation) return;

    if (run.status === RunStatus.KeywordMatched || run.status === RunStatus.PublicReplySent) {
      if (!run.comment_id || !run.igsid) return;
      const account = await this.deps.repos.accounts.findByIdUnscoped(run.instagram_account_id);
      if (!account) return;
      await this.executeFirstContact(automation, run, {
        type: 'comment',
        igUserId: account.ig_user_id,
        commentId: run.comment_id,
        mediaId: run.media_id ?? undefined,
        fromIgsid: run.igsid,
        fromUsername: run.username ?? undefined,
        text: run.comment_text ?? '',
        isFromSelf: false,
        providerEventId: run.comment_id,
      });
      return;
    }

    await this.continueRun(run.id);
  }

  private async scheduleRetry(
    run: RunRow,
    resumeStatus: string,
    error: string,
    delayMs: number,
  ): Promise<boolean> {
    const attempt = (run.retry_count ?? 0) + 1;
    const maxAttempts = env().RETRY_MAX_ATTEMPTS;
    if (attempt > maxAttempts) {
      await this.deps.repos.runs.patch(run.id, {
        status: RunStatus.Failed,
        error,
        error_code: 'retry_exhausted',
        retry_count: attempt - 1,
        next_retry_at: null,
        finished_at: new Date(),
      });
      await this.deps.repos.runEvents.log({
        userId: run.user_id,
        runId: run.id,
        level: 'error',
        code: 'retry_exhausted',
        message: `پس از ${maxAttempts} تلاش، عملیات ناموفق ماند: ${error}`,
      });
      return false;
    }

    const safeDelay = Math.max(1_000, delayMs);
    await this.deps.repos.runs.patch(run.id, {
      status: resumeStatus,
      error,
      error_code: 'retry_scheduled',
      retry_count: attempt,
      next_retry_at: new Date(Date.now() + safeDelay),
      finished_at: null,
    });
    await this.deps.repos.runEvents.log({
      userId: run.user_id,
      runId: run.id,
      level: 'warn',
      code: 'retry_scheduled',
      message: `تلاش مجدد ${attempt}/${maxAttempts} در ${Math.ceil(safeDelay / 1000)} ثانیه`,
    });
    await this.deps.queue.enqueue(
      'retry-run',
      { runId: run.id },
      { delayMs: safeDelay, jobId: `run:${run.id}:retry:${attempt}` },
    );
    return true;
  }

  /* ════════════════════════════════════════════════════════
   *  مسیر ۱ — کامنت جدید
   * ════════════════════════════════════════════════════════ */
  async handleCommentEvent(event: ParsedCommentEvent, webhookEventId: string | null): Promise<void> {
    const { repos } = this.deps;

    // ۱) resolve کردن tenant از IG_ID (تنها نقطه‌ای که بدون user_id کوئری می‌زنیم)
    const accounts = await repos.accounts.findByIgUserId(event.igUserId);
    if (!accounts.length) {
      log.warn('کامنت برای حسابی که در سیستم متصل نیست', { igUserId: event.igUserId });
      return;
    }

    for (const account of accounts) {
      // ۲) کامنت خودِ صاحب پیج → هرگز تریگر نشود (جلوگیری از حلقه)
      if (event.isFromSelf) {
        log.debug('کامنت خود حساب — نادیده گرفته شد', { commentId: event.commentId });
        continue;
      }
      if (!event.fromIgsid) {
        log.warn('کامنت بدون IGSID فرستنده — قابل پردازش نیست', { commentId: event.commentId });
        continue;
      }

      await repos.comments.record({
        userId: account.user_id,
        instagramAccountId: account.id,
        commentId: event.commentId,
        parentCommentId: event.parentCommentId ?? null,
        mediaId: event.mediaId ?? null,
        igsid: event.fromIgsid,
        username: event.fromUsername ?? null,
        text: event.text,
        commentedAt: event.timestamp ?? null,
      });

      await repos.igUsers.upsert({
        userId: account.user_id,
        instagramAccountId: account.id,
        igsid: event.fromIgsid,
        username: event.fromUsername ?? null,
      });

      // ۳) اتوماسیون‌های فعال این حساب
      const automations = await repos.automations.listActiveForAccount(account.id);
      for (const automation of automations) {
        await this.tryAutomation(automation, account.user_id, event, webhookEventId);
      }
    }
  }

  private async tryAutomation(
    automation: AutomationRow,
    userId: string,
    event: ParsedCommentEvent,
    webhookEventId: string | null,
  ): Promise<void> {
    const { repos } = this.deps;

    // فیلتر پست‌های هدف
    if (automation.target_scope === 'specific_posts') {
      const ids = parseJson<string[]>(automation.target_media_ids, []);
      if (!event.mediaId || !ids.includes(event.mediaId)) return;
    }

    // Keyword matching
    const keywordRows = await repos.automations.listKeywords(automation.id);
    if (!keywordRows.length) return;
    const result = matchKeywords(
      event.text,
      keywordRows.map((k) => ({
        id: k.id,
        keyword: k.keyword,
        matchMode: (k.match_mode as MatchMode | null) ?? null,
        isNegative: k.is_negative,
      })),
      {
        defaultMatchMode: (automation.match_mode as MatchMode) ?? 'contains',
        caseSensitive: automation.case_sensitive,
      },
    );
    if (!result.matched) return;

    // یک‌بار برای هر کاربر در هر پست
    if (automation.once_per_user_per_post && event.mediaId && event.fromIgsid) {
      const already = await repos.runs.existsForUserAndMedia(automation.id, event.fromIgsid, event.mediaId);
      if (already) {
        log.info('اجرای تکراری برای همین کاربر و پست — رد شد', { automationId: automation.id });
        return;
      }
    }

    // IDEMPOTENCY: (automation_id, comment_id)
    const { run, created } = await repos.runs.createIfAbsent({
      userId,
      instagramAccountId: automation.instagram_account_id,
      automationId: automation.id,
      webhookEventId,
      commentId: event.commentId,
      mediaId: event.mediaId ?? null,
      igsid: event.fromIgsid ?? null,
      username: event.fromUsername ?? null,
      commentText: event.text,
      matchedKeyword: result.keyword ?? null,
    });

    if (!created) {
      log.info('Already Processed — این کامنت قبلاً پردازش شده است', {
        automationId: automation.id,
        commentId: event.commentId,
      });
      return;
    }

    await repos.automations.incrementRun(automation.id);
    await repos.runEvents.log({
      userId, runId: run.id, level: 'success', code: 'comment_received',
      message: 'کامنت دریافت شد', data: { commentId: event.commentId, mediaId: event.mediaId },
    });
    await repos.runEvents.log({
      userId, runId: run.id, level: 'success', code: 'keyword_matched',
      message: `کلیدواژه تطبیق یافت: ${result.keyword}`, data: { matchMode: result.matchMode },
    });

    await this.executeFirstContact(automation, run, event);
  }

  /** مرحلهٔ اول: Public Reply + Private Reply (با دکمهٔ ادامه) */
  private async executeFirstContact(
    automation: AutomationRow,
    run: RunRow,
    event: ParsedCommentEvent,
  ): Promise<void> {
    const { repos, sender } = this.deps;
    const templates = bundleTemplates(await repos.automations.listTemplates(automation.id));
    const account = await repos.accounts.findByIdUnscoped(automation.instagram_account_id);
    if (!account) return;

    const ctx: RenderContext = {
      username: event.fromUsername ?? run.username,
      comment: event.text,
      keyword: run.matched_keyword,
      link: automation.link_url || null,
      account: account.username,
    };

    // ── Public Reply (اختیاری) ──
    if (automation.public_reply_enabled && templates.publicReply?.body) {
      const out = await sender.send({
        userId: run.user_id,
        instagramAccountId: automation.instagram_account_id,
        igUserId: account.ig_user_id,
        runId: run.id,
        kind: 'public_reply',
        text: renderTemplate(templates.publicReply.body, ctx),
        commentId: event.commentId,
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id,
        level: out.status === 'sent' ? 'success' : out.status === 'failed' ? 'error' : 'warn',
        code: 'public_reply', message: `پاسخ عمومی: ${out.status}`,
        data: { status: out.status },
      });
      if (out.status === 'sent') await repos.runs.patch(run.id, { status: RunStatus.PublicReplySent });
      if (out.status === 'rate_limited' || (out.status === 'failed' && out.retryable)) {
        await this.scheduleRetry(
          run,
          RunStatus.KeywordMatched,
          out.status === 'rate_limited' ? 'API Rate Limit هنگام پاسخ عمومی' : out.error,
          out.status === 'rate_limited' ? out.retryAfterMs : env().retryBackoffMs[run.retry_count] ?? 5_000,
        );
        return;
      }
    }

    // ── Private Reply (نقطهٔ شروع DM) ──
    if (!automation.private_reply_enabled || !templates.privateReply?.body) {
      // بدون private reply، ادامهٔ Flow ممکن نیست (چون consent و پنجرهٔ ۲۴ ساعته باز نمی‌شود)
      await repos.runs.patch(run.id, { status: RunStatus.Completed, delivered: true, finished_at: new Date() });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'info', code: 'completed',
        message: 'اتوماسیون بدون پیام خصوصی تمام شد',
      });
      return;
    }

    const needsInteraction = automation.follow_gate_enabled || Boolean(templates.main?.body);
    let body = renderTemplate(templates.privateReply.body, ctx);
    if (automation.bot_disclosure_enabled && automation.bot_disclosure_text) {
      // افشای ربات‌بودن طبق Developer Policies متا (الزام قانونی در برخی حوزه‌ها)
      body = `${automation.bot_disclosure_text}\n\n${body}`;
    }

    const customQr = parseJson<Array<{ title?: string; payload?: string }>>(templates.privateReply.quick_replies, []);
    const quickReplies: QuickReply[] = needsInteraction
      ? [continueButton(run.id, customQr[0]?.title ?? '✅ انجام شد')]
      : [];

    const out = await sender.send({
      userId: run.user_id,
      instagramAccountId: automation.instagram_account_id,
      igUserId: account.ig_user_id,
      runId: run.id,
      kind: 'private_reply',
      text: body,
      quickReplies,
      privateReplyCommentId: event.commentId,
    });

    if (out.status === 'sent' || (out.status === 'skipped' && out.reason === 'already_sent')) {
      await repos.runs.patch(run.id, {
        status: needsInteraction ? RunStatus.AwaitingUserInteraction : RunStatus.Completed,
        delivered: !needsInteraction,
        finished_at: needsInteraction ? null : new Date(),
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'success', code: 'private_reply_sent',
        message: 'پیام خصوصی ارسال شد',
      });
      if (needsInteraction) {
        await repos.runEvents.log({
          userId: run.user_id, runId: run.id, level: 'info', code: 'awaiting_user_interaction',
          message:
            'در انتظار تعامل کاربر در دایرکت. طبق محدودیت رسمی Instagram، ادامهٔ Flow (بررسی فالو و ارسال پیام اصلی) ' +
            'تنها پس از پاسخ یا زدن دکمه توسط کاربر ممکن است.',
        });
      }
    } else if (out.status === 'rate_limited' || (out.status === 'failed' && out.retryable)) {
      await this.scheduleRetry(
        run,
        RunStatus.KeywordMatched,
        out.status === 'rate_limited' ? 'API Rate Limit هنگام پیام خصوصی' : out.error,
        out.status === 'rate_limited' ? out.retryAfterMs : env().retryBackoffMs[run.retry_count] ?? 5_000,
      );
    } else if (out.status === 'failed') {
      await repos.runs.patch(run.id, {
        status: RunStatus.Failed, error: out.error, error_code: out.code ?? null, finished_at: new Date(),
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'error', code: 'private_reply_failed',
        message: `ارسال پیام خصوصی ناموفق: ${out.error}`, data: { code: out.code },
      });
    } else {
      await repos.runs.patch(run.id, { status: RunStatus.Skipped, error: out.reason, finished_at: new Date() });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'warn', code: 'private_reply_skipped',
        message: `ارسال رد شد: ${out.reason}`,
      });
    }
  }

  /* ════════════════════════════════════════════════════════
   *  مسیر ۲ — پیام/دکمهٔ کاربر در دایرکت
   *  اینجا CONSENT ایجاد می‌شود ⇒ Follow Check رسمی ممکن می‌شود
   * ════════════════════════════════════════════════════════ */
  async handleMessagingEvent(event: ParsedMessageEvent): Promise<void> {
    const { repos } = this.deps;
    if (event.isEcho || event.type === 'read' || event.type === 'echo') return;

    const accounts = await repos.accounts.findByIgUserId(event.igUserId);
    if (!accounts.length) return;

    for (const account of accounts) {
      await repos.igUsers.upsert({
        userId: account.user_id,
        instagramAccountId: account.id,
        igsid: event.senderIgsid,
      });
      // ✅ consent طبق مستندات رسمی: کاربر پیام داد / دکمه زد
      await repos.igUsers.grantConsent(account.id, event.senderIgsid, event.timestamp ?? new Date());
      // پس از ثبت consent، مقدار تازهٔ رکورد لازم است

      const flow = parseFlowPayload(event.quickReplyPayload ?? event.postbackPayload);
      let run: RunRow | null = null;

      if (flow) {
        run = await repos.runs.findById(flow.runId);
        // دفاع در برابر payload جعلی: run باید متعلق به همین حساب و همین کاربر باشد
        if (run && (run.instagram_account_id !== account.id || run.igsid !== event.senderIgsid)) {
          log.warn('payload دکمه با run مطابقت ندارد — رد شد', { runId: flow.runId });
          run = null;
        }
      }
      if (!run) {
        run = await repos.runs.findOpenRunForUser(account.id, event.senderIgsid);
      }
      if (!run) {
        log.debug('پیام بدون run باز — نادیده گرفته شد', { igsid: event.senderIgsid });
        continue;
      }

      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'success', code: 'user_identified',
        message: 'کاربر شناسایی شد و رضایت دسترسی به پروفایل ایجاد شد',
      });

      await this.continueRun(run.id);
    }
  }

  /* ════════════════════════════════════════════════════════
   *  مرحلهٔ Follow Gate + پیام اصلی
   * ════════════════════════════════════════════════════════ */
  async continueRun(runId: string): Promise<void> {
    const { repos, sender, followCheckers } = this.deps;
    const run = await repos.runs.findById(runId);
    if (!run) return;
    if (run.status === RunStatus.Completed || run.status === RunStatus.Failed) return;

    const automation = await repos.automations.findById(run.user_id, run.automation_id);
    if (!automation) return;
    const account = await repos.accounts.findByIdUnscoped(run.instagram_account_id);
    if (!account || !run.igsid) return;

    const templates = bundleTemplates(await repos.automations.listTemplates(automation.id));
    const igUser = await repos.igUsers.find(account.id, run.igsid);

    const ctx: RenderContext = {
      username: igUser?.username ?? run.username,
      name: igUser?.name,
      comment: run.comment_text,
      keyword: run.matched_keyword,
      link: automation.link_url || null,
      account: account.username,
    };

    /* ── Follow Gate ── */
    let deliverMain = true;

    if (automation.follow_gate_enabled) {
      const checker = followCheckers.get(automation.follow_checker);
      const check = await checker.check({
        igsid: run.igsid,
        instagramAccountId: account.id,
        hasMessagingConsent: igUser?.has_messaging_consent ?? false,
      });

      await repos.igUsers.recordFollowStatus(
        account.id, run.igsid,
        check.status === 'following' ? true : check.status === 'not_following' ? false : null,
        check.profile,
      );
      await repos.runs.patch(run.id, {
        status: RunStatus.FollowChecked,
        follow_status: check.status,
        follow_reason: check.reason,
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id,
        level: check.status === 'following' ? 'success' : check.reason === 'ok' ? 'info' : 'warn',
        code: 'follow_check',
        message:
          check.status === 'following' ? 'کاربر پیج را فالو کرده است ✅'
          : check.status === 'not_following' ? 'کاربر هنوز فالو نکرده است'
          : `وضعیت فالو نامشخص (${check.reason})`,
        data: { status: check.status, reason: check.reason, detail: check.detail, checker: checker.id },
      });

      if (check.status === 'not_following') {
        deliverMain = false;
      } else if (check.status === 'unknown') {
        // سیاست صریح کاربر برای حالت نامشخص — هرگز حدس نمی‌زنیم
        if (automation.follow_unknown_policy === 'gate') deliverMain = false;
        else if (automation.follow_unknown_policy === 'fail') {
          await repos.runs.patch(run.id, {
            status: RunStatus.Failed,
            error: `وضعیت فالو قابل تعیین نبود: ${check.reason}`,
            error_code: check.reason,
            finished_at: new Date(),
          });
          return;
        }
        // 'deliver' ⇒ ادامه بده
      }
    }

    /* ── مسیر «فالو نکرده» → پیام Follow Gate ── */
    if (!deliverMain) {
      const recheckCount = run.follow_recheck_count ?? 0;
      if (recheckCount >= automation.follow_recheck_limit) {
        await repos.runs.patch(run.id, {
          status: RunStatus.FollowGateSent,
          error: 'سقف بررسی مجدد فالو پر شد',
          finished_at: new Date(),
        });
        await repos.runEvents.log({
          userId: run.user_id, runId: run.id, level: 'warn', code: 'follow_gate_limit',
          message: 'کاربر پس از چند بار بررسی هنوز فالو نکرده است',
        });
        return;
      }

      const gateBody = templates.followGate?.body
        || 'برای دریافت فایل رایگان ابتدا پیج را فالو کن ❤️\n\nبعد از فالو روی دکمهٔ «انجام شد» بزن.';
      const out = await sender.send({
        userId: run.user_id,
        instagramAccountId: account.id,
        igUserId: account.ig_user_id,
        runId: run.id,
        // کلید idempotency متفاوت برای هر دور بررسی تا پیام دوباره قابل ارسال باشد
        idempotencySuffix: `gate${recheckCount}`,
        kind: 'follow_gate',
        text: renderTemplate(gateBody, ctx),
        quickReplies: [recheckButton(run.id)],
        igsid: run.igsid,
      });

      if (out.status === 'rate_limited' || (out.status === 'failed' && out.retryable)) {
        await this.scheduleRetry(
          run,
          RunStatus.FollowChecked,
          out.status === 'rate_limited' ? 'API Rate Limit هنگام پیام Follow Gate' : out.error,
          out.status === 'rate_limited' ? out.retryAfterMs : env().retryBackoffMs[run.retry_count] ?? 5_000,
        );
        return;
      }
      if (out.status === 'failed') {
        await repos.runs.patch(run.id, {
          status: RunStatus.Failed,
          error: out.error,
          error_code: out.code ?? null,
          finished_at: new Date(),
        });
        return;
      }
      await repos.runs.patch(run.id, {
        status: RunStatus.FollowGateSent,
        follow_recheck_count: recheckCount + 1,
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id,
        level: out.status === 'sent' ? 'info' : 'warn',
        code: 'follow_gate_sent',
        message: `پیام درخواست فالو ارسال شد (${out.status})`,
      });
      return;
    }

    /* ── پیام اصلی ── */
    const mainBody = templates.main?.body ?? '';
    if (!mainBody && !parseJson<Attachment[]>(templates.main?.attachments, []).length) {
      await repos.runs.patch(run.id, { status: RunStatus.Completed, delivered: true, finished_at: new Date() });
      return;
    }

    const attachments = parseJson<Array<{ type: string; url?: string; attachment_id?: string }>>(
      templates.main?.attachments, [],
    )
      .filter((a) => ['image', 'video', 'audio', 'file'].includes(a.type))
      .map((a) =>
        a.attachment_id
          ? ({ type: a.type as 'image', payload: { attachment_id: a.attachment_id } } as Attachment)
          : ({ type: a.type as 'image', payload: { url: a.url ?? '' } } as Attachment),
      )
      .filter((a) => 'attachment_id' in a.payload || Boolean((a.payload as { url: string }).url));

    const customMainQr = parseJson<Array<{ title?: string; payload?: string }>>(
      templates.main?.quick_replies,
      [],
    )
      .filter((q) => q.title?.trim())
      .slice(0, 13)
      .map((q, index): QuickReply => ({
        content_type: 'text',
        title: (q.title ?? '').slice(0, 20),
        payload: q.payload?.trim() || `IGFLOW_MAIN_${run.id}_${index}`,
      }));

    const outcomes: Awaited<ReturnType<MessageSender['send']>>[] = [];
    const renderedMain = renderTemplate(mainBody, ctx);
    if (renderedMain || customMainQr.length) {
      outcomes.push(await sender.send({
        userId: run.user_id,
        instagramAccountId: account.id,
        igUserId: account.ig_user_id,
        runId: run.id,
        idempotencySuffix: 'text',
        kind: 'main',
        text: renderedMain,
        quickReplies: customMainQr,
        igsid: run.igsid,
      }));
    }
    for (const [index, attachment] of attachments.entries()) {
      const previous = outcomes[outcomes.length - 1];
      if (previous?.status === 'rate_limited' || previous?.status === 'failed') break;
      outcomes.push(await sender.send({
        userId: run.user_id,
        instagramAccountId: account.id,
        igUserId: account.ig_user_id,
        runId: run.id,
        idempotencySuffix: `attachment:${index}`,
        kind: 'main',
        text: '',
        attachments: [attachment],
        igsid: run.igsid,
      }));
      const latest = outcomes[outcomes.length - 1];
      if (latest?.status === 'rate_limited' || latest?.status === 'failed') break;
    }

    const out = outcomes.find((item) => item.status === 'rate_limited')
      ?? outcomes.find((item) => item.status === 'failed')
      ?? outcomes.find((item) => item.status === 'sent')
      ?? outcomes[0];

    if (!out) {
      await repos.runs.patch(run.id, { status: RunStatus.Completed, delivered: true, finished_at: new Date() });
      return;
    }

    if (out.status === 'sent' || out.status === 'skipped') {
      await repos.runs.patch(run.id, {
        status: RunStatus.Completed,
        delivered: true,
        finished_at: new Date(),
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'success', code: 'main_message_sent',
        message: out.status === 'sent' ? 'پیام اصلی با موفقیت ارسال شد 🎉' : 'پیام اصلی قبلاً ارسال شده بود',
      });
    } else if (out.status === 'rate_limited' || (out.status === 'failed' && out.retryable)) {
      await this.scheduleRetry(
        run,
        RunStatus.FollowChecked,
        out.status === 'rate_limited' ? 'API Rate Limit هنگام پیام اصلی' : out.error,
        out.status === 'rate_limited' ? out.retryAfterMs : env().retryBackoffMs[run.retry_count] ?? 5_000,
      );
    } else {
      await repos.runs.patch(run.id, {
        status: RunStatus.Failed, error: out.error, error_code: out.code ?? null, finished_at: new Date(),
      });
      await repos.runEvents.log({
        userId: run.user_id, runId: run.id, level: 'error', code: 'main_message_failed',
        message: `Message Failed ❌ — Reason: ${out.error}`, data: { code: out.code },
      });
    }
  }
}

export { normalizeText };
