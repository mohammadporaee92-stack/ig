-- ════════════════════════════════════════════════════════════════════
-- IGFlow — Database Schema (PostgreSQL)
-- Multi-tenant: shared schema، هر جدول دامنه‌ای دارای user_id (tenant key)
-- سازگار با Postgres 14+ و PGlite
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1. Tenants / Users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL UNIQUE,        -- lower(email) برای یکتایی case-insensitive
  password_hash  TEXT NOT NULL,               -- scrypt: salt:hash (hex)
  full_name      TEXT,
  locale         TEXT NOT NULL DEFAULT 'fa',
  onboarded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── 2. Instagram accounts (متصل‌شده از طریق Business Login) ──────────
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_user_id          TEXT NOT NULL,           -- Instagram professional account ID (IG_ID)
  username            TEXT NOT NULL,
  name                TEXT,
  account_type        TEXT NOT NULL DEFAULT 'BUSINESS',  -- BUSINESS | MEDIA_CREATOR | ...
  profile_picture_url TEXT,
  followers_count     INTEGER NOT NULL DEFAULT 0,
  media_count         INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'connected', -- connected | disconnected | needs_reauth | error
  scopes              TEXT NOT NULL DEFAULT '',
  webhook_subscribed  BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_fields      TEXT NOT NULL DEFAULT '',
  provider            TEXT NOT NULL DEFAULT 'meta',     -- meta | zernio
  provider_account_id TEXT,                             -- Zernio account id (server-side only)
  provider_profile_id TEXT,                             -- Zernio profile id
  last_error          TEXT,
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- یک حساب اینستاگرام فقط یک‌بار برای هر tenant
  UNIQUE (user_id, ig_user_id)
);
-- جست‌وجوی سریع هنگام دریافت webhook (که فقط ig_user_id دارد)
CREATE INDEX IF NOT EXISTS idx_ig_accounts_igid ON instagram_accounts(ig_user_id);
-- ستون‌های provider برای دیتابیس‌هایی که قبل از اتصال Zernio ساخته شده‌اند.
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS provider_profile_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_accounts_provider
  ON instagram_accounts(user_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- ── 3. OAuth tokens (رمزنگاری‌شده at rest) ───────────────────────────
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id   TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL DEFAULT 'instagram',
  token_type             TEXT NOT NULL DEFAULT 'long_lived',  -- short_lived | long_lived
  -- AES-256-GCM؛ فرمت: v1.<iv_b64>.<tag_b64>.<ciphertext_b64>. هرگز plaintext.
  access_token_enc       TEXT NOT NULL,
  scopes                 TEXT NOT NULL DEFAULT '',
  expires_at             TIMESTAMPTZ,
  last_refreshed_at      TIMESTAMPTZ,
  refresh_failure_count  INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiry ON oauth_tokens(expires_at);

-- ── 4. Automations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id  TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft',   -- draft | active | disabled
  trigger_type          TEXT NOT NULL DEFAULT 'instagram_comment',
  -- دامنهٔ تریگر: همهٔ پست‌ها یا پست‌های انتخابی
  target_scope          TEXT NOT NULL DEFAULT 'all_posts', -- all_posts | specific_posts
  target_media_ids      TEXT NOT NULL DEFAULT '[]',        -- JSON array
  match_mode            TEXT NOT NULL DEFAULT 'contains',  -- contains | exact
  case_sensitive        BOOLEAN NOT NULL DEFAULT FALSE,
  -- اجرای یک‌بار برای هر کاربر در هر پست (جلوگیری از سوءاستفاده)
  once_per_user_per_post BOOLEAN NOT NULL DEFAULT TRUE,
  -- پیام عمومی زیر کامنت (اختیاری)
  public_reply_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  -- پیام خصوصی اول (private reply) — اختیاری ولی عملاً نقطهٔ شروع DM
  private_reply_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Follow Gate
  follow_gate_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  follow_checker        TEXT NOT NULL DEFAULT 'messaging_profile', -- messaging_profile | unsupported
  -- وقتی وضعیت فالو 'unknown' است چه کنیم
  follow_unknown_policy TEXT NOT NULL DEFAULT 'deliver',  -- deliver | gate | fail
  follow_recheck_limit  INTEGER NOT NULL DEFAULT 3,
  -- افشای ربات‌بودن (الزام قانونی CA/DE طبق Developer Policies متا)
  bot_disclosure_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bot_disclosure_text   TEXT NOT NULL DEFAULT 'این یک پاسخ خودکار است 🤖',
  -- لینکی که با متغیر {{link}} در پیام‌ها جایگزین می‌شود (مثلاً لینک فایل/دوره)
  link_url              TEXT NOT NULL DEFAULT '',
  total_runs            INTEGER NOT NULL DEFAULT 0,
  last_run_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automations_user      ON automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_acct_stat ON automations(instagram_account_id, status);

-- ── 5. Keywords ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_keywords (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,
  keyword_norm   TEXT NOT NULL,            -- نرمال‌شده (lower + folding عربی/فارسی + اعداد)
  match_mode     TEXT,                     -- NULL ⇒ ارث از automation
  is_negative    BOOLEAN NOT NULL DEFAULT FALSE, -- کلیدواژهٔ استثنا (اگر باشد، اجرا نشود)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, keyword_norm)
);
CREATE INDEX IF NOT EXISTS idx_keywords_automation ON automation_keywords(automation_id);

-- ── 6. Automation steps (گراف قابل توسعه برای Nodeهای آینده) ─────────
CREATE TABLE IF NOT EXISTS automation_steps (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_key       TEXT NOT NULL,   -- public_reply | private_reply | follow_check | main_message | follow_gate_message
  step_type      TEXT NOT NULL,   -- action | condition
  position       INTEGER NOT NULL DEFAULT 0,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  config         TEXT NOT NULL DEFAULT '{}',  -- JSON، قابل توسعه بدون migration
  next_on_true   TEXT,            -- step_key بعدی وقتی شرط true
  next_on_false  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, step_key)
);

-- ── 7. Message templates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,   -- public_reply | private_reply | follow_gate | main | fallback
  body           TEXT NOT NULL DEFAULT '',
  -- JSON: [{type:'image'|'video'|'audio'|'file', url:'...'}]  (file = PDF فقط، طبق مستندات رسمی)
  attachments    TEXT NOT NULL DEFAULT '[]',
  -- JSON: [{title:'✅ انجام شد', payload:'IGFLOW_CONTINUE'}] — حداکثر ۱۳، عنوان ≤ ۲۰ کاراکتر
  quick_replies  TEXT NOT NULL DEFAULT '[]',
  -- JSON: [{title, url}] برای Generic Template
  buttons        TEXT NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, kind)
);

-- ── 8. Instagram posts (کش سبک) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS instagram_posts (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id  TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  media_id              TEXT NOT NULL,
  media_type            TEXT,
  permalink             TEXT,
  caption               TEXT,
  thumbnail_url         TEXT,
  posted_at             TIMESTAMPTZ,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, media_id)
);

-- ── 9. Instagram users (IGSID ها — کاربران تعامل‌کننده) ──────────────
CREATE TABLE IF NOT EXISTS instagram_users (
  id                          TEXT PRIMARY KEY,
  user_id                     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id        TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  igsid                       TEXT NOT NULL,    -- Instagram-scoped ID
  username                    TEXT,
  name                        TEXT,
  profile_pic                 TEXT,
  follower_count              INTEGER,
  -- نتیجهٔ آخرین Follow Check رسمی (is_user_follow_business)
  is_user_follow_business     BOOLEAN,
  follow_checked_at           TIMESTAMPTZ,
  -- consent فقط با پیام‌دادن کاربر ست می‌شود (محدودیت رسمی User Profile API)
  has_messaging_consent       BOOLEAN NOT NULL DEFAULT FALSE,
  consent_granted_at          TIMESTAMPTZ,
  -- پنجرهٔ ۲۴ ساعتهٔ پیام‌رسانی
  messaging_window_expires_at TIMESTAMPTZ,
  last_interaction_at         TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, igsid)
);
CREATE INDEX IF NOT EXISTS idx_ig_users_igsid ON instagram_users(igsid);

-- ── 10. Comments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instagram_comments (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id  TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  comment_id            TEXT NOT NULL,
  parent_comment_id     TEXT,
  media_id              TEXT,
  igsid                 TEXT,
  username              TEXT,
  text                  TEXT NOT NULL DEFAULT '',
  commented_at          TIMESTAMPTZ,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_comments_media ON instagram_comments(media_id);

-- ── 11. Webhook events (منبع حقیقت خام + idempotency) ────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL DEFAULT 'instagram',
  -- کلید یکتای رویداد از سمت پلتفرم (comment_id / message mid / hash)
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,   -- comment | message | postback | optin | unknown
  ig_user_id        TEXT,            -- حساب مقصد (برای resolve کردن tenant)
  user_id           TEXT,            -- بعد از resolve پر می‌شود
  payload           TEXT NOT NULL,   -- JSON خام
  signature_valid   BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'received', -- received | queued | processing | processed | duplicate | ignored | failed
  error             TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  -- IDEMPOTENCY: متا تا ۳۶ ساعت retry می‌کند ⇒ رویداد تکراری اینجا بلاک می‌شود
  UNIQUE (platform, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status, received_at);

-- ── 12. Automation runs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id   TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  automation_id          TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  webhook_event_id       TEXT,
  trigger_type           TEXT NOT NULL DEFAULT 'instagram_comment',
  comment_id             TEXT,
  media_id               TEXT,
  igsid                  TEXT,
  username               TEXT,
  comment_text           TEXT,
  matched_keyword        TEXT,
  status                 TEXT NOT NULL DEFAULT 'received',
  -- received | keyword_matched | public_reply_sent | private_reply_sent
  -- | awaiting_user_interaction | follow_checked | follow_gate_sent
  -- | main_message_sent | completed | failed | skipped
  follow_status          TEXT,      -- following | not_following | unknown | not_checked
  follow_reason          TEXT,      -- ok | consent_required | unsupported | blocked | api_error
  follow_recheck_count   INTEGER NOT NULL DEFAULT 0,
  delivered              BOOLEAN NOT NULL DEFAULT FALSE,
  error                  TEXT,
  error_code             TEXT,
  retry_count            INTEGER NOT NULL DEFAULT 0,
  next_retry_at          TIMESTAMPTZ,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at            TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- IDEMPOTENCY اصلی خواسته‌شده: platform + comment_id + automation_id
  UNIQUE (automation_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_user_time  ON automation_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_automation ON automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_igsid_open ON automation_runs(instagram_account_id, igsid, status);
CREATE INDEX IF NOT EXISTS idx_runs_retry      ON automation_runs(status, next_retry_at);

-- ── 13. Run events (تایم‌لاین لاگ هر Run) ────────────────────────────
CREATE TABLE IF NOT EXISTS run_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id      TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  level       TEXT NOT NULL DEFAULT 'info',  -- info | success | warn | error
  code        TEXT NOT NULL,                 -- comment_received | keyword_matched | ...
  message     TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);

-- ── 14. Message logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_logs (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_account_id  TEXT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  run_id                TEXT REFERENCES automation_runs(id) ON DELETE SET NULL,
  kind                  TEXT NOT NULL,   -- public_reply | private_reply | follow_gate | main | fallback
  channel               TEXT NOT NULL,   -- comment_reply | direct_message
  recipient_igsid       TEXT,
  recipient_comment_id  TEXT,
  body_preview          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
  provider_message_id   TEXT,
  error                 TEXT,
  error_code            TEXT,
  attempt               INTEGER NOT NULL DEFAULT 1,
  -- جلوگیری از ارسال دوباره در retry: کلید یکتای منطقی
  idempotency_key       TEXT,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_msglogs_user_time ON message_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msglogs_run       ON message_logs(run_id);

-- ── 15. Audit logs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, created_at DESC);

-- ── 16. Rate limit buckets (پایدار بین ری‌استارت‌ها) ─────────────────
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key  TEXT PRIMARY KEY,
  tokens      DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_after TIMESTAMPTZ
);
