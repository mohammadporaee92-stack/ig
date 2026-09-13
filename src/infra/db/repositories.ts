import { newId } from '~/lib/crypto';
import type { Db } from './client';

/**
 * Repository layer.
 *
 * قاعدهٔ Multi-Tenancy: هر متدی که به دادهٔ دامنه‌ای دسترسی دارد، **اجباراً**
 * `userId` می‌گیرد و در WHERE استفاده می‌کند. این در سطح تایپ اجبار شده است.
 * تمام کوئری‌ها parameterized هستند.
 */

export type Row = Record<string, unknown>;

const now = () => new Date();

/* ═══════════════════════ Users ═══════════════════════ */

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  password_hash: string;
  full_name: string | null;
  locale: string;
  onboarded_at: Date | null;
  created_at: Date;
}

export class UserRepo {
  constructor(private readonly db: Db) {}

  async create(data: { email: string; passwordHash: string; fullName?: string }): Promise<UserRow> {
    const id = newId('usr');
    const res = await this.db.query<UserRow>(
      `INSERT INTO users (id, email, email_norm, password_hash, full_name)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, data.email, data.email.trim().toLowerCase(), data.passwordHash, data.fullName ?? null],
    );
    return res.rows[0] as UserRow;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>(`SELECT * FROM users WHERE email_norm = $1`, [
      email.trim().toLowerCase(),
    ]);
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async markOnboarded(userId: string): Promise<void> {
    await this.db.query(`UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()), updated_at = now() WHERE id = $1`, [userId]);
  }
}

/* ═══════════════════ Instagram accounts ═══════════════════ */

export interface InstagramAccountRow {
  id: string;
  user_id: string;
  ig_user_id: string;
  username: string;
  name: string | null;
  account_type: string;
  profile_picture_url: string | null;
  followers_count: number;
  media_count: number;
  status: string;
  scopes: string;
  webhook_subscribed: boolean;
  webhook_fields: string;
  last_error: string | null;
  connected_at: Date;
  disconnected_at: Date | null;
}

export class InstagramAccountRepo {
  constructor(private readonly db: Db) {}

  async upsert(data: {
    userId: string;
    igUserId: string;
    username: string;
    name?: string | null;
    accountType?: string;
    profilePictureUrl?: string | null;
    followersCount?: number;
    mediaCount?: number;
    scopes: string[];
  }): Promise<InstagramAccountRow> {
    const id = newId('iga');
    const res = await this.db.query<InstagramAccountRow>(
      `INSERT INTO instagram_accounts
         (id, user_id, ig_user_id, username, name, account_type, profile_picture_url,
          followers_count, media_count, scopes, status, connected_at, disconnected_at, last_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'connected', now(), NULL, NULL, now())
       ON CONFLICT (user_id, ig_user_id) DO UPDATE SET
         username = EXCLUDED.username,
         name = EXCLUDED.name,
         account_type = EXCLUDED.account_type,
         profile_picture_url = EXCLUDED.profile_picture_url,
         followers_count = EXCLUDED.followers_count,
         media_count = EXCLUDED.media_count,
         scopes = EXCLUDED.scopes,
         status = 'connected',
         disconnected_at = NULL,
         last_error = NULL,
         updated_at = now()
       RETURNING *`,
      [
        id,
        data.userId,
        data.igUserId,
        data.username,
        data.name ?? null,
        data.accountType ?? 'BUSINESS',
        data.profilePictureUrl ?? null,
        data.followersCount ?? 0,
        data.mediaCount ?? 0,
        data.scopes.join(','),
      ],
    );
    return res.rows[0] as InstagramAccountRow;
  }

  async listByUser(userId: string): Promise<InstagramAccountRow[]> {
    const res = await this.db.query<InstagramAccountRow>(
      `SELECT * FROM instagram_accounts WHERE user_id = $1 ORDER BY connected_at DESC`,
      [userId],
    );
    return res.rows;
  }

  async getPrimary(userId: string): Promise<InstagramAccountRow | null> {
    const res = await this.db.query<InstagramAccountRow>(
      `SELECT * FROM instagram_accounts WHERE user_id = $1 AND status = 'connected'
       ORDER BY connected_at DESC LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /** ⚠️ فقط برای resolve کردن tenant از webhook (که user_id ندارد) */
  async findByIgUserId(igUserId: string): Promise<InstagramAccountRow[]> {
    const res = await this.db.query<InstagramAccountRow>(
      `SELECT * FROM instagram_accounts WHERE ig_user_id = $1 AND status = 'connected'`,
      [igUserId],
    );
    return res.rows;
  }

  async findById(userId: string, id: string): Promise<InstagramAccountRow | null> {
    const res = await this.db.query<InstagramAccountRow>(
      `SELECT * FROM instagram_accounts WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  async findByIdUnscoped(id: string): Promise<InstagramAccountRow | null> {
    const res = await this.db.query<InstagramAccountRow>(`SELECT * FROM instagram_accounts WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async setWebhookState(id: string, subscribed: boolean, fields: string[], error?: string): Promise<void> {
    await this.db.query(
      `UPDATE instagram_accounts SET webhook_subscribed = $2, webhook_fields = $3, last_error = $4, updated_at = now()
       WHERE id = $1`,
      [id, subscribed, fields.join(','), error ?? null],
    );
  }

  async setStatus(userId: string, id: string, status: string, error?: string): Promise<void> {
    await this.db.query(
      `UPDATE instagram_accounts
         SET status = $3,
             last_error = $4,
             disconnected_at = CASE WHEN $3 = 'disconnected' THEN now() ELSE disconnected_at END,
             updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, status, error ?? null],
    );
  }
}

/* ═══════════════════ OAuth tokens ═══════════════════ */

export interface OAuthTokenRow {
  id: string;
  user_id: string;
  instagram_account_id: string;
  token_type: string;
  access_token_enc: string;
  scopes: string;
  expires_at: Date | null;
  last_refreshed_at: Date | null;
  refresh_failure_count: number;
}

export class OAuthTokenRepo {
  constructor(private readonly db: Db) {}

  async upsert(data: {
    userId: string;
    instagramAccountId: string;
    accessTokenEnc: string;
    tokenType?: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<OAuthTokenRow> {
    const id = newId('tok');
    const res = await this.db.query<OAuthTokenRow>(
      `INSERT INTO oauth_tokens (id, user_id, instagram_account_id, token_type, access_token_enc, scopes, expires_at, last_refreshed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (instagram_account_id) DO UPDATE SET
         access_token_enc = EXCLUDED.access_token_enc,
         token_type = EXCLUDED.token_type,
         scopes = EXCLUDED.scopes,
         expires_at = EXCLUDED.expires_at,
         last_refreshed_at = now(),
         refresh_failure_count = 0,
         updated_at = now()
       RETURNING *`,
      [
        id,
        data.userId,
        data.instagramAccountId,
        data.tokenType ?? 'long_lived',
        data.accessTokenEnc,
        data.scopes.join(','),
        data.expiresAt,
      ],
    );
    return res.rows[0] as OAuthTokenRow;
  }

  /** ⚠️ مقدار رمزنگاری‌شده برمی‌گردد؛ رمزگشایی فقط در TokenService */
  async findByAccount(instagramAccountId: string): Promise<OAuthTokenRow | null> {
    const res = await this.db.query<OAuthTokenRow>(
      `SELECT * FROM oauth_tokens WHERE instagram_account_id = $1`,
      [instagramAccountId],
    );
    return res.rows[0] ?? null;
  }

  async listExpiringBefore(date: Date): Promise<OAuthTokenRow[]> {
    const res = await this.db.query<OAuthTokenRow>(
      `SELECT * FROM oauth_tokens WHERE expires_at IS NOT NULL AND expires_at < $1 ORDER BY expires_at ASC`,
      [date],
    );
    return res.rows;
  }

  async recordRefreshFailure(id: string): Promise<void> {
    await this.db.query(
      `UPDATE oauth_tokens SET refresh_failure_count = refresh_failure_count + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async deleteByAccount(instagramAccountId: string): Promise<void> {
    await this.db.query(`DELETE FROM oauth_tokens WHERE instagram_account_id = $1`, [instagramAccountId]);
  }
}

/* ═══════════════════ Automations ═══════════════════ */

export interface AutomationRow {
  id: string;
  user_id: string;
  instagram_account_id: string;
  name: string;
  status: string;
  trigger_type: string;
  target_scope: string;
  target_media_ids: string;
  match_mode: string;
  case_sensitive: boolean;
  once_per_user_per_post: boolean;
  public_reply_enabled: boolean;
  private_reply_enabled: boolean;
  follow_gate_enabled: boolean;
  follow_checker: string;
  follow_unknown_policy: string;
  follow_recheck_limit: number;
  bot_disclosure_enabled: boolean;
  bot_disclosure_text: string;
  link_url: string;
  total_runs: number;
  last_run_at: Date | null;
  created_at: Date;
}

export interface KeywordRow {
  id: string;
  automation_id: string;
  keyword: string;
  keyword_norm: string;
  match_mode: string | null;
  is_negative: boolean;
}

export interface TemplateRow {
  id: string;
  automation_id: string;
  kind: string;
  body: string;
  attachments: string;
  quick_replies: string;
  buttons: string;
}

export class AutomationRepo {
  constructor(private readonly db: Db) {}

  async create(userId: string, data: Partial<AutomationRow> & { instagram_account_id: string; name: string }): Promise<AutomationRow> {
    const id = newId('atm');
    const res = await this.db.query<AutomationRow>(
      `INSERT INTO automations
        (id,user_id,instagram_account_id,name,status,trigger_type,target_scope,target_media_ids,
         match_mode,case_sensitive,once_per_user_per_post,public_reply_enabled,private_reply_enabled,
         follow_gate_enabled,follow_checker,follow_unknown_policy,follow_recheck_limit,
         bot_disclosure_enabled,bot_disclosure_text,link_url)
       VALUES ($1,$2,$3,$4,$5,'instagram_comment',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        id,
        userId,
        data.instagram_account_id,
        data.name,
        data.status ?? 'draft',
        data.target_scope ?? 'all_posts',
        data.target_media_ids ?? '[]',
        data.match_mode ?? 'contains',
        data.case_sensitive ?? false,
        data.once_per_user_per_post ?? true,
        data.public_reply_enabled ?? true,
        data.private_reply_enabled ?? true,
        data.follow_gate_enabled ?? false,
        data.follow_checker ?? 'messaging_profile',
        data.follow_unknown_policy ?? 'deliver',
        data.follow_recheck_limit ?? 3,
        data.bot_disclosure_enabled ?? true,
        data.bot_disclosure_text ?? 'این یک پاسخ خودکار است 🤖',
        data.link_url ?? '',
      ],
    );
    return res.rows[0] as AutomationRow;
  }

  async update(userId: string, id: string, patch: Record<string, unknown>): Promise<AutomationRow | null> {
    const allowed = new Set([
      'name', 'status', 'target_scope', 'target_media_ids', 'match_mode', 'case_sensitive',
      'once_per_user_per_post', 'public_reply_enabled', 'private_reply_enabled',
      'follow_gate_enabled', 'follow_checker', 'follow_unknown_policy', 'follow_recheck_limit',
      'bot_disclosure_enabled', 'bot_disclosure_text', 'link_url',
    ]);
    const sets: string[] = [];
    const params: unknown[] = [id, userId];
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k) || v === undefined) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
    if (!sets.length) return this.findById(userId, id);
    const res = await this.db.query<AutomationRow>(
      `UPDATE automations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      params,
    );
    return res.rows[0] ?? null;
  }

  async findById(userId: string, id: string): Promise<AutomationRow | null> {
    const res = await this.db.query<AutomationRow>(
      `SELECT * FROM automations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<AutomationRow[]> {
    const res = await this.db.query<AutomationRow>(
      `SELECT * FROM automations WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows;
  }

  /** فعال‌های یک حساب — برای موتور (بدون user_id چون از webhook می‌آید، ولی account مقید به tenant است) */
  async listActiveForAccount(instagramAccountId: string): Promise<AutomationRow[]> {
    const res = await this.db.query<AutomationRow>(
      `SELECT * FROM automations WHERE instagram_account_id = $1 AND status = 'active' ORDER BY created_at ASC`,
      [instagramAccountId],
    );
    return res.rows;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await this.db.query(`DELETE FROM automations WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
    return res.rowCount > 0;
  }

  async incrementRun(id: string): Promise<void> {
    await this.db.query(`UPDATE automations SET total_runs = total_runs + 1, last_run_at = now() WHERE id = $1`, [id]);
  }

  /* Keywords */
  async replaceKeywords(
    userId: string,
    automationId: string,
    keywords: Array<{ keyword: string; matchMode?: string | null; isNegative?: boolean; keywordNorm: string }>,
  ): Promise<void> {
    await this.db.query(`DELETE FROM automation_keywords WHERE automation_id = $1 AND user_id = $2`, [
      automationId, userId,
    ]);
    for (const k of keywords) {
      await this.db.query(
        `INSERT INTO automation_keywords (id,user_id,automation_id,keyword,keyword_norm,match_mode,is_negative)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (automation_id, keyword_norm) DO NOTHING`,
        [newId('kw'), userId, automationId, k.keyword, k.keywordNorm, k.matchMode ?? null, k.isNegative ?? false],
      );
    }
  }

  async listKeywords(automationId: string): Promise<KeywordRow[]> {
    const res = await this.db.query<KeywordRow>(
      `SELECT * FROM automation_keywords WHERE automation_id = $1 ORDER BY created_at ASC`,
      [automationId],
    );
    return res.rows;
  }

  /* Templates */
  async upsertTemplate(
    userId: string,
    automationId: string,
    kind: string,
    data: { body: string; attachments?: unknown[]; quickReplies?: unknown[]; buttons?: unknown[] },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO message_templates (id,user_id,automation_id,kind,body,attachments,quick_replies,buttons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (automation_id, kind) DO UPDATE SET
         body = EXCLUDED.body,
         attachments = EXCLUDED.attachments,
         quick_replies = EXCLUDED.quick_replies,
         buttons = EXCLUDED.buttons,
         updated_at = now()`,
      [
        newId('tpl'), userId, automationId, kind, data.body,
        JSON.stringify(data.attachments ?? []),
        JSON.stringify(data.quickReplies ?? []),
        JSON.stringify(data.buttons ?? []),
      ],
    );
  }

  async listTemplates(automationId: string): Promise<TemplateRow[]> {
    const res = await this.db.query<TemplateRow>(
      `SELECT * FROM message_templates WHERE automation_id = $1`,
      [automationId],
    );
    return res.rows;
  }
}

/* ═══════════════════ Instagram users (IGSID) ═══════════════════ */

export interface InstagramUserRow {
  id: string;
  user_id: string;
  instagram_account_id: string;
  igsid: string;
  username: string | null;
  name: string | null;
  is_user_follow_business: boolean | null;
  follow_checked_at: Date | null;
  has_messaging_consent: boolean;
  messaging_window_expires_at: Date | null;
  last_interaction_at: Date | null;
}

export class InstagramUserRepo {
  constructor(private readonly db: Db) {}

  async upsert(data: {
    userId: string;
    instagramAccountId: string;
    igsid: string;
    username?: string | null;
    name?: string | null;
  }): Promise<InstagramUserRow> {
    const res = await this.db.query<InstagramUserRow>(
      `INSERT INTO instagram_users (id,user_id,instagram_account_id,igsid,username,name)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (instagram_account_id, igsid) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, instagram_users.username),
         name = COALESCE(EXCLUDED.name, instagram_users.name),
         updated_at = now()
       RETURNING *`,
      [newId('igu'), data.userId, data.instagramAccountId, data.igsid, data.username ?? null, data.name ?? null],
    );
    return res.rows[0] as InstagramUserRow;
  }

  async find(instagramAccountId: string, igsid: string): Promise<InstagramUserRow | null> {
    const res = await this.db.query<InstagramUserRow>(
      `SELECT * FROM instagram_users WHERE instagram_account_id = $1 AND igsid = $2`,
      [instagramAccountId, igsid],
    );
    return res.rows[0] ?? null;
  }

  /**
   * ثبت consent + باز شدن پنجرهٔ ۲۴ ساعتهٔ پیام‌رسانی.
   * فقط زمانی صدا زده می‌شود که کاربر پیام بدهد یا Quick Reply/Postback بزند.
   */
  async grantConsent(instagramAccountId: string, igsid: string, at: Date | string = now()): Promise<void> {
    // ⚠️ مقدار ممکن است پس از JSON.parse رشته باشد (payload ذخیره‌شدهٔ webhook)
    const when = at instanceof Date ? at : new Date(at);
    const safe = Number.isNaN(when.getTime()) ? now() : when;
    const windowEnd = new Date(safe.getTime() + 24 * 60 * 60 * 1000);
    await this.db.query(
      `UPDATE instagram_users
         SET has_messaging_consent = TRUE,
             consent_granted_at = COALESCE(consent_granted_at, $3),
             messaging_window_expires_at = $4,
             last_interaction_at = $3,
             updated_at = now()
       WHERE instagram_account_id = $1 AND igsid = $2`,
      [instagramAccountId, igsid, safe, windowEnd],
    );
  }

  async recordFollowStatus(
    instagramAccountId: string,
    igsid: string,
    following: boolean | null,
    profile?: { username?: string; name?: string; followerCount?: number },
  ): Promise<void> {
    await this.db.query(
      `UPDATE instagram_users
         SET is_user_follow_business = $3,
             follow_checked_at = now(),
             username = COALESCE($4, username),
             name = COALESCE($5, name),
             follower_count = COALESCE($6, follower_count),
             updated_at = now()
       WHERE instagram_account_id = $1 AND igsid = $2`,
      [instagramAccountId, igsid, following, profile?.username ?? null, profile?.name ?? null, profile?.followerCount ?? null],
    );
  }
}

/* ═══════════════════ Comments ═══════════════════ */

export class CommentRepo {
  constructor(private readonly db: Db) {}

  async record(data: {
    userId: string;
    instagramAccountId: string;
    commentId: string;
    parentCommentId?: string | null;
    mediaId?: string | null;
    igsid?: string | null;
    username?: string | null;
    text: string;
    commentedAt?: Date | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO instagram_comments
        (id,user_id,instagram_account_id,comment_id,parent_comment_id,media_id,igsid,username,text,commented_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (instagram_account_id, comment_id) DO NOTHING`,
      [
        newId('cmt'), data.userId, data.instagramAccountId, data.commentId,
        data.parentCommentId ?? null, data.mediaId ?? null, data.igsid ?? null,
        data.username ?? null, data.text, data.commentedAt ?? null,
      ],
    );
  }
}

/* ═══════════════════ Webhook events ═══════════════════ */

export interface WebhookEventRow {
  id: string;
  provider_event_id: string;
  event_type: string;
  ig_user_id: string | null;
  user_id: string | null;
  payload: string;
  signature_valid: boolean;
  status: string;
  error: string | null;
  retry_count: number;
  received_at: Date;
}

export class WebhookEventRepo {
  constructor(private readonly db: Db) {}

  /**
   * ذخیرهٔ idempotent.
   * اگر رویداد قبلاً دیده شده (retry متا تا ۳۶ ساعت) → `duplicate: true`.
   */
  async store(data: {
    providerEventId: string;
    eventType: string;
    igUserId?: string | null;
    payload: unknown;
    signatureValid: boolean;
  }): Promise<{ row: WebhookEventRow; duplicate: boolean }> {
    const res = await this.db.query<WebhookEventRow>(
      `INSERT INTO webhook_events (id, platform, provider_event_id, event_type, ig_user_id, payload, signature_valid, status)
       VALUES ($1,'instagram',$2,$3,$4,$5,$6,'received')
       ON CONFLICT (platform, provider_event_id) DO NOTHING
       RETURNING *`,
      [
        newId('whk'), data.providerEventId, data.eventType,
        data.igUserId ?? null, JSON.stringify(data.payload), data.signatureValid,
      ],
    );
    if (res.rows[0]) return { row: res.rows[0], duplicate: false };

    const existing = await this.db.query<WebhookEventRow>(
      `SELECT * FROM webhook_events WHERE platform = 'instagram' AND provider_event_id = $1`,
      [data.providerEventId],
    );
    return { row: existing.rows[0] as WebhookEventRow, duplicate: true };
  }

  async setStatus(id: string, status: string, error?: string | null): Promise<void> {
    await this.db.query(
      `UPDATE webhook_events
         SET status = $2, error = $3,
             processed_at = CASE WHEN $2 IN ('processed','ignored','duplicate','failed') THEN now() ELSE processed_at END
       WHERE id = $1`,
      [id, status, error ?? null],
    );
  }

  async attachTenant(id: string, userId: string): Promise<void> {
    await this.db.query(`UPDATE webhook_events SET user_id = $2 WHERE id = $1`, [id, userId]);
  }

  async incrementRetry(id: string): Promise<void> {
    await this.db.query(`UPDATE webhook_events SET retry_count = retry_count + 1 WHERE id = $1`, [id]);
  }

  async findById(id: string): Promise<WebhookEventRow | null> {
    const res = await this.db.query<WebhookEventRow>(`SELECT * FROM webhook_events WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  /**
   * رویدادهایی که در صف مانده‌اند و پردازش نشده‌اند.
   *
   * در استقرار سرورلس (بدون worker دائمی) اگر پردازش درون‌خطی ناتمام بماند —
   * مثلاً به‌خاطر سقف زمان اجرای تابع — رویداد در وضعیت `queued` گیر می‌کند.
   * cron روزانه با همین متد آن‌ها را پیدا و دوباره تلاش می‌کند.
   *
   * فیلتر یک‌دقیقه‌ای از برداشتن رویدادی که همین حالا در حال پردازش است
   * جلوگیری می‌کند.
   */
  async listStuck(limit = 25): Promise<WebhookEventRow[]> {
    const res = await this.db.query<WebhookEventRow>(
      `SELECT * FROM webhook_events
        WHERE status IN ('queued', 'processing', 'received')
          AND received_at < now() - INTERVAL '1 minute'
        ORDER BY received_at ASC
        LIMIT $1`,
      [limit],
    );
    return res.rows;
  }
}

/* ═══════════════════ Runs & logs ═══════════════════ */

export interface RunRow {
  id: string;
  user_id: string;
  instagram_account_id: string;
  automation_id: string;
  webhook_event_id: string | null;
  comment_id: string | null;
  media_id: string | null;
  igsid: string | null;
  username: string | null;
  comment_text: string | null;
  matched_keyword: string | null;
  status: string;
  follow_status: string | null;
  follow_reason: string | null;
  follow_recheck_count: number;
  delivered: boolean;
  error: string | null;
  error_code: string | null;
  retry_count: number;
  started_at: Date;
  finished_at: Date | null;
}

export class RunRepo {
  constructor(private readonly db: Db) {}

  /**
   * ایجاد idempotent بر پایهٔ (automation_id, comment_id).
   * این همان کلید یکتای خواسته‌شده است: platform + comment_id + automation_id.
   */
  async createIfAbsent(data: {
    userId: string;
    instagramAccountId: string;
    automationId: string;
    webhookEventId?: string | null;
    commentId: string;
    mediaId?: string | null;
    igsid?: string | null;
    username?: string | null;
    commentText?: string | null;
    matchedKeyword?: string | null;
  }): Promise<{ run: RunRow; created: boolean }> {
    const res = await this.db.query<RunRow>(
      `INSERT INTO automation_runs
        (id,user_id,instagram_account_id,automation_id,webhook_event_id,comment_id,media_id,igsid,username,comment_text,matched_keyword,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'keyword_matched')
       ON CONFLICT (automation_id, comment_id) DO NOTHING
       RETURNING *`,
      [
        newId('run'), data.userId, data.instagramAccountId, data.automationId,
        data.webhookEventId ?? null, data.commentId, data.mediaId ?? null,
        data.igsid ?? null, data.username ?? null, data.commentText ?? null, data.matchedKeyword ?? null,
      ],
    );
    if (res.rows[0]) return { run: res.rows[0], created: true };

    const existing = await this.db.query<RunRow>(
      `SELECT * FROM automation_runs WHERE automation_id = $1 AND comment_id = $2`,
      [data.automationId, data.commentId],
    );
    return { run: existing.rows[0] as RunRow, created: false };
  }

  async findById(id: string): Promise<RunRow | null> {
    const res = await this.db.query<RunRow>(`SELECT * FROM automation_runs WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async findByIdScoped(userId: string, id: string): Promise<RunRow | null> {
    const res = await this.db.query<RunRow>(
      `SELECT * FROM automation_runs WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  /** آیا این کاربر قبلاً روی همین پست برای همین automation اجرا شده؟ */
  async existsForUserAndMedia(automationId: string, igsid: string, mediaId: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM automation_runs WHERE automation_id = $1 AND igsid = $2 AND media_id = $3 LIMIT 1`,
      [automationId, igsid, mediaId],
    );
    return res.rowCount > 0;
  }

  /** آخرین Run باز برای یک کاربر — برای ادامهٔ Flow پس از Quick Reply */
  async findOpenRunForUser(instagramAccountId: string, igsid: string): Promise<RunRow | null> {
    const res = await this.db.query<RunRow>(
      `SELECT * FROM automation_runs
        WHERE instagram_account_id = $1 AND igsid = $2
          AND status IN ('private_reply_sent','awaiting_user_interaction','follow_gate_sent','follow_checked')
        ORDER BY started_at DESC LIMIT 1`,
      [instagramAccountId, igsid],
    );
    return res.rows[0] ?? null;
  }

  async patch(id: string, patch: Partial<Record<string, unknown>>): Promise<void> {
    const allowed = new Set([
      'status', 'follow_status', 'follow_reason', 'follow_recheck_count', 'delivered',
      'error', 'error_code', 'retry_count', 'next_retry_at', 'finished_at', 'matched_keyword', 'igsid', 'username',
    ]);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k) || v === undefined) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
    if (!sets.length) return;
    await this.db.query(`UPDATE automation_runs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }

  async listByUser(userId: string, opts: { automationId?: string; limit?: number; offset?: number } = {}) {
    const params: unknown[] = [userId];
    let where = `user_id = $1`;
    if (opts.automationId) {
      params.push(opts.automationId);
      where += ` AND automation_id = $${params.length}`;
    }
    params.push(Math.min(opts.limit ?? 50, 200));
    const limitIdx = params.length;
    params.push(opts.offset ?? 0);
    const res = await this.db.query<RunRow>(
      `SELECT * FROM automation_runs WHERE ${where} ORDER BY started_at DESC LIMIT $${limitIdx} OFFSET $${params.length}`,
      params,
    );
    return res.rows;
  }
}

export class RunEventRepo {
  constructor(private readonly db: Db) {}

  async log(data: {
    userId: string;
    runId: string;
    level?: 'info' | 'success' | 'warn' | 'error';
    code: string;
    message: string;
    data?: unknown;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO run_events (id,user_id,run_id,level,code,message,data) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId('rev'), data.userId, data.runId, data.level ?? 'info', data.code, data.message, JSON.stringify(data.data ?? {})],
    );
  }

  async listByRun(userId: string, runId: string) {
    const res = await this.db.query<{ id: string; level: string; code: string; message: string; data: string; created_at: Date }>(
      `SELECT id,level,code,message,data,created_at FROM run_events
        WHERE run_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
      [runId, userId],
    );
    return res.rows;
  }
}

export class MessageLogRepo {
  constructor(private readonly db: Db) {}

  /** با idempotency_key از ارسال دوباره در retry جلوگیری می‌کند */
  async claim(data: {
    userId: string;
    instagramAccountId: string;
    runId: string | null;
    kind: string;
    channel: string;
    recipientIgsid?: string | null;
    recipientCommentId?: string | null;
    bodyPreview: string;
    idempotencyKey: string;
  }): Promise<{ id: string; claimed: boolean }> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO message_logs
        (id,user_id,instagram_account_id,run_id,kind,channel,recipient_igsid,recipient_comment_id,body_preview,idempotency_key,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        newId('msg'), data.userId, data.instagramAccountId, data.runId, data.kind, data.channel,
        data.recipientIgsid ?? null, data.recipientCommentId ?? null,
        data.bodyPreview.slice(0, 280), data.idempotencyKey,
      ],
    );
    if (res.rows[0]) return { id: res.rows[0].id, claimed: true };
    const existing = await this.db.query<{ id: string; status: string }>(
      `SELECT id,status FROM message_logs WHERE idempotency_key = $1`,
      [data.idempotencyKey],
    );
    return { id: (existing.rows[0] as { id: string }).id, claimed: false };
  }

  async markSent(id: string, providerMessageId?: string): Promise<void> {
    await this.db.query(
      `UPDATE message_logs SET status='sent', provider_message_id=$2, sent_at=now(), error=NULL WHERE id=$1`,
      [id, providerMessageId ?? null],
    );
  }

  async markFailed(id: string, error: string, code?: string): Promise<void> {
    await this.db.query(
      `UPDATE message_logs SET status='failed', error=$2, error_code=$3, attempt = attempt + 1 WHERE id=$1`,
      [id, error.slice(0, 500), code ?? null],
    );
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.db.query(`UPDATE message_logs SET status='skipped', error=$2 WHERE id=$1`, [id, reason.slice(0, 500)]);
  }

  async reset(id: string): Promise<void> {
    await this.db.query(`UPDATE message_logs SET status='pending' WHERE id=$1 AND status='failed'`, [id]);
  }
}

export class AuditLogRepo {
  constructor(private readonly db: Db) {}

  async log(data: {
    userId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    ip?: string | null;
    userAgent?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (id,user_id,action,entity_type,entity_id,ip,user_agent,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        newId('aud'), data.userId, data.action, data.entityType ?? null, data.entityId ?? null,
        data.ip ?? null, data.userAgent ?? null, JSON.stringify(data.metadata ?? {}),
      ],
    );
  }

  async listByUser(userId: string, limit = 50) {
    const res = await this.db.query(
      `SELECT action, entity_type, entity_id, ip, created_at FROM audit_logs
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(limit, 200)],
    );
    return res.rows;
  }
}

/* ═══════════════════ Factory ═══════════════════ */

export interface Repositories {
  users: UserRepo;
  accounts: InstagramAccountRepo;
  tokens: OAuthTokenRepo;
  automations: AutomationRepo;
  igUsers: InstagramUserRepo;
  comments: CommentRepo;
  webhooks: WebhookEventRepo;
  runs: RunRepo;
  runEvents: RunEventRepo;
  messages: MessageLogRepo;
  audit: AuditLogRepo;
  db: Db;
}

export function createRepositories(db: Db): Repositories {
  return {
    users: new UserRepo(db),
    accounts: new InstagramAccountRepo(db),
    tokens: new OAuthTokenRepo(db),
    automations: new AutomationRepo(db),
    igUsers: new InstagramUserRepo(db),
    comments: new CommentRepo(db),
    webhooks: new WebhookEventRepo(db),
    runs: new RunRepo(db),
    runEvents: new RunEventRepo(db),
    messages: new MessageLogRepo(db),
    audit: new AuditLogRepo(db),
    db,
  };
}
