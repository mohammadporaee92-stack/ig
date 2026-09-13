import { z } from 'zod';

/**
 * اعتبارسنجی متمرکز Environment Variables.
 * هیچ secret ای در کد hardcode نمی‌شود؛ همه از اینجا خوانده می‌شوند.
 */
const csv = (v: string | undefined, fallback: string[] = []): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET باید حداقل ۳۲ کاراکتر باشد'),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  /**
   * اگر داشبورد داخل iframe از یک دامنهٔ دیگر سرو می‌شود (مثلاً محیط پیش‌نمایش)،
   * کوکی با SameSite=Lax اصلاً ارسال نمی‌شود و کاربر بعد از ورود باز به /login برمی‌گردد.
   * این گزینه کوکی را به SameSite=None; Secure تغییر می‌دهد.
   * ⚠️ محافظت CSRF در این حالت به بررسی هدر `x-requested-with` در لایهٔ API متکی است.
   */
  AUTH_COOKIE_CROSS_SITE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  TOKEN_ENCRYPTION_KEY: z.string().min(1),

  IG_APP_ID: z.string().default(''),
  IG_APP_SECRET: z.string().default(''),
  IG_REDIRECT_URI: z.string().default('http://localhost:3000/api/instagram/callback'),
  IG_GRAPH_VERSION: z.string().default('v25.0'),
  IG_GRAPH_HOST: z.string().default('https://graph.instagram.com'),
  IG_OAUTH_AUTHORIZE_URL: z.string().default('https://www.instagram.com/oauth/authorize'),
  IG_OAUTH_TOKEN_URL: z.string().default('https://api.instagram.com/oauth/access_token'),
  IG_SCOPES: z.string().default(
    'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
  ),
  IG_WEBHOOK_FIELDS: z.string().default('comments,messages,messaging_postbacks,messaging_optins'),

  IG_WEBHOOK_VERIFY_TOKEN: z.string().default('dev-verify-token'),
  WEBHOOK_SIGNATURE_REQUIRED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  DATABASE_URL: z.string().default(''),
  PGLITE_DIR: z.string().default('.data/pglite'),

  /**
   * پردازش webhook در همان درخواست، بعد از ارسال پاسخ ۲۰۰.
   * خالی = تشخیص خودکار (روی Vercel روشن، جای دیگر خاموش).
   */
  INLINE_WEBHOOK_PROCESSING: z.string().default(''),
  CRON_SECRET: z.string().default(''),

  REDIS_URL: z.string().default(''),
  QUEUE_PREFIX: z.string().default('igflow'),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),

  RL_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(60),
  RL_PRIVATE_REPLIES_PER_HOUR: z.coerce.number().int().positive().default(700),
  RL_BURST: z.coerce.number().int().positive().default(10),

  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(3),
  RETRY_BACKOFF_MS: z.string().default('5000,30000,120000'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const DEV_DEFAULTS: Record<string, string> = {
  AUTH_JWT_SECRET: 'dev-only-insecure-secret-change-me-0123456789abcdef',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function load() {
  const raw: Record<string, string | undefined> = { ...process.env };
  // در dev/test اگر secret ست نشده بود، مقدار توسعه‌ای می‌گذاریم تا اپ بالا بیاید.
  // در production هرگز — Zod خطا می‌دهد و اپ بالا نمی‌آید.
  if (raw.NODE_ENV !== 'production') {
    for (const [k, v] of Object.entries(DEV_DEFAULTS)) if (!raw[k]) raw[k] = v;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`❌ پیکربندی محیط نامعتبر است:\n${issues}\nفایل .env.example را ببینید.`);
  }
  const e = parsed.data;
  return {
    ...e,
    igScopes: csv(e.IG_SCOPES),
    igWebhookFields: csv(e.IG_WEBHOOK_FIELDS),
    retryBackoffMs: csv(e.RETRY_BACKOFF_MS).map(Number).filter((n) => Number.isFinite(n)),
    isProd: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    instagramConfigured: Boolean(e.IG_APP_ID && e.IG_APP_SECRET),
    /**
     * حالت سرورلس (Vercel و مشابه آن).
     *
     * در این حالت هیچ پروسهٔ دائمی‌ای وجود ندارد که Worker را نگه دارد، پس
     * رویدادهای webhook باید در همان درخواست — ولی *بعد از* ارسال پاسخ ۲۰۰ —
     * پردازش شوند. بدون این، رویدادها در دیتابیس ذخیره می‌شوند و تا ابد
     * دست‌نخورده می‌مانند؛ بدون هیچ خطایی. (`INLINE_WEBHOOK_PROCESSING=false`
     * این رفتار را حتی روی Vercel هم خاموش می‌کند — مثلاً وقتی Worker جدا
     * روی سرویس دیگری اجرا می‌شود.)
     */
    serverless:
      e.INLINE_WEBHOOK_PROCESSING === 'false'
        ? false
        : e.INLINE_WEBHOOK_PROCESSING === 'true' || Boolean(process.env.VERCEL),
  };
}

export type Env = ReturnType<typeof load>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = load();
  return cached;
}
/** فقط برای تست‌ها */
export function __resetEnv(): void {
  cached = null;
}
