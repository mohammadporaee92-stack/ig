<div dir="rtl">

# IGFlow

**اتوماسیون اینستاگرام بر پایهٔ APIهای رسمی Meta**

جریان اصلی:

</div>

```
کامنت اینستاگرام → تشخیص کلیدواژه → پاسخ خصوصی (DM) → بررسی فالو → ارسال محتوای اصلی
```

<div dir="rtl">

IGFlow یک SaaS چند-مستأجری (multi-tenant) است که با **Instagram Login رسمی** کار می‌کند. کاربر فقط یک دکمهٔ «اتصال اینستاگرام» می‌زند — بدون Facebook Page، بدون Meta Business Suite، بدون وارد کردن رمز اینستاگرام، بدون کپی دستی توکن.

> ⚠️ **بدون هیچ روش غیررسمی.** این پروژه از scraping، Selenium/Playwright، Instagram Private API، کوکی سشن یا رمز عبور کاربر استفاده **نمی‌کند**. هر قابلیتی که API رسمی پشتیبانی نکند، صریحاً به‌عنوان محدودیت مستند شده است — نه شبیه‌سازی، نه جعل.

---

## فهرست

1. [قابلیت‌ها](#قابلیتها)
2. [محدودیت‌های رسمی که باید بدانید](#محدودیتهای-رسمی-که-باید-بدانید)
3. [معماری](#معماری)
4. [پیش‌نیازها](#پیشنیازها)
5. [نصب سریع](#نصب-سریع)
6. [متغیرهای محیطی](#متغیرهای-محیطی)
7. [دیتابیس](#دیتابیس)
8. [راه‌اندازی اپ Meta و OAuth](#راهاندازی-اپ-meta-و-oauth)
9. [راه‌اندازی Webhook](#راهاندازی-webhook)
10. [توسعهٔ محلی](#توسعهٔ-محلی)
11. [تست](#تست)
12. [استقرار](#استقرار)
13. [امنیت](#امنیت)
14. [عیب‌یابی](#عیبیابی)
15. [ساختار پروژه](#ساختار-پروژه)

---

## قابلیت‌ها

| قابلیت | وضعیت | توضیح |
|---|---|---|
| اتصال با Instagram Login رسمی | ✅ | یک دکمه، OAuth استاندارد، بدون Facebook Page |
| شناسایی حساب متصل در Zernio | ✅ مرحلهٔ ۱ | واردکردن حساب + health check؛ Webhook و ارسال در مرحلهٔ بعد |
| تشخیص کلیدواژه | ✅ | چند کلیدواژه، حساس/غیرحساس به حروف، `exact` یا `contains` |
| پاسخ عمومی به کامنت | ✅ | اختیاری، قابل تنظیم در هر اتوماسیون |
| پاسخ خصوصی (Private Reply) | ✅ | یک بار به‌ازای هر کامنت، تا ۷ روز پس از کامنت |
| بررسی فالو (Follow Gate) | ⚠️ مشروط | فقط **پس از** تعامل کاربر در دایرکت — [توضیح](#محدودیتهای-رسمی-که-باید-بدانید) |
| متغیرهای پیام | ✅ | `{{username}} {{first_name}} {{comment}} {{keyword}} {{link}}` |
| Quick Reply / دکمه | ✅ | حداکثر ۱۳ دکمه، عنوان تا ۲۰ کاراکتر |
| پیوست رسانه | ✅ | تصویر، ویدیو، صوت، فایل (از طریق URL عمومی) |
| جلوگیری از ارسال تکراری | ✅ | یکتا بر اساس `(automation_id, comment_id)` |
| صف + Worker + تلاش مجدد | ✅ | BullMQ/Redis یا صف حافظه‌ای؛ backoff نمایی ۵ث → ۳۰ث → ۲د |
| محدودسازی نرخ | ✅ | Token bucket تراکنشی + رعایت `Retry-After` |
| چند-مستأجری | ✅ | هر کوئری با `user_id` محدود می‌شود |
| رمزنگاری توکن‌ها | ✅ | AES-256-GCM، هرگز در پاسخ API یا لاگ ظاهر نمی‌شود |
| داشبورد و تحلیل‌ها | ✅ | ۱۱ صفحه، Wizard هفت‌مرحله‌ای، پیش‌نمایش بصری جریان |
| تست خودکار | ✅ | **۱۳۲ تست** — OAuth، Webhook، Zernio، کلیدواژه، اتوماسیون، امنیت، انطباق |

---

## محدودیت‌های رسمی که باید بدانید

این بخش مهم‌ترین قسمت مستندات است. **این محدودیت‌ها از خود Meta هستند، نه از این پروژه.**

### ۱. بررسی فالو در لحظهٔ کامنت ممکن نیست

فیلد `is_user_follow_business` در [Instagram User Profile API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile) وجود دارد، اما فقط وقتی قابل خواندن است که کاربر **رضایت پیام‌رسانی** داده باشد.

طبق مستندات رسمی، رضایت فقط با یکی از این‌ها ایجاد می‌شود:

- کاربر به شما پیام بدهد
- روی **Icebreaker** بزند
- روی **Persistent Menu** بزند
- روی **Quick Reply** بزند

> نقل مستقیم از مستندات Meta:
> *"If an Instagram user comments on a post or comment but has not sent a message … your app will receive an error, User consent is required to access user profile."*

**یعنی کامنت کردن به‌تنهایی رضایت ایجاد نمی‌کند.**

#### راه‌حل طراحی‌شده

به‌جای جعل قابلیت، **ترتیب مراحل** تغییر کرده است:

```
کامنت → کلیدواژه → پاسخ عمومی (اختیاری)
      → پاسخ خصوصی حاوی یک دکمهٔ Quick Reply
      → کاربر دکمه را می‌زند  ⇒ رضایت + پنجرهٔ ۲۴ ساعته فعال می‌شود
      → حالا is_user_follow_business خوانده می‌شود
      → فالو کرده؟  ارسال محتوای اصلی
      → فالو نکرده؟ پیام Follow Gate + دکمهٔ «بررسی مجدد» (حداکثر ۳ بار)
```

اگر کاربر هیچ دکمه‌ای نزند، اجرا در وضعیت `awaiting_user_interaction` می‌ماند — بدون خطا، بدون حدس.

این منطق پشت اینترفیس `FollowChecker` قرار دارد و قابل تعویض است:

```ts
interface FollowChecker {
  check(input: {
    igsid: string;
    instagramAccountId: string;
    hasMessagingConsent: boolean;
  }): Promise<FollowCheckResult>;
}
```

پیاده‌سازی‌ها: `MessagingProfileFollowChecker` (پیش‌فرض)، `UnsupportedFollowChecker`، `InstagramOfficialFollowChecker`.

### ۲. سایر محدودیت‌های رسمی

| محدودیت | مقدار | منبع |
|---|---|---|
| پاسخ خصوصی به هر کامنت | فقط **۱ بار** | Private Replies |
| مهلت پاسخ خصوصی | تا **۷ روز** پس از کامنت | Private Replies |
| پنجرهٔ پیام‌رسانی | **۲۴ ساعت** پس از آخرین تعامل کاربر | Messaging |
| طول متن پیام | حداکثر **۱۰۰۰ بایت** | Send API |
| تعداد Quick Reply | حداکثر **۱۳** | Quick Replies |
| طول عنوان Quick Reply | حداکثر **۲۰ کاراکتر** | Quick Replies |
| Quick Reply در دسکتاپ | ❌ پشتیبانی نمی‌شود | Quick Replies |
| حجم تصویر | ۸MB | Send API |
| حجم ویدیو/صوت/PDF | ۲۵MB | Send API |
| پاسخ به Webhook | باید زیر **۵ ثانیه** باشد | Webhooks |
| تلاش مجدد Meta | تا حدود **۳۶ ساعت** | Webhooks |
| کاربران بلاک‌کرده | قابل مشاهده نیستند | User Profile API |

**آنچه اصلاً وجود ندارد:** webhook برای رویداد فالو، و endpoint برای گرفتن لیست فالوورها.

📄 گزارش کامل: [`docs/01-capability-audit.md`](docs/01-capability-audit.md)

---

## معماری

```
┌─────────────┐   کامنت    ┌──────────────────┐
│  Instagram  │───────────▶│ /api/webhooks/   │  امضای X-Hub-Signature-256
└─────────────┘            │    instagram     │  ذخیره + idempotency
       ▲                   └────────┬─────────┘  پاسخ < ۵ ثانیه
       │                            │
       │                            ▼
       │                   ┌──────────────────┐
       │                   │  Queue (BullMQ)  │  backoff: ۵ث → ۳۰ث → ۲د
       │                   └────────┬─────────┘
       │                            ▼
       │                   ┌──────────────────┐
       │                   │  Worker          │
       │                   │  ├ keyword match │
       │                   │  ├ follow check  │
       │                   │  └ send message  │
       │                   └────────┬─────────┘
       │       Graph API            │
       └────────────────────────────┘
```

**لایه‌ها:**

| لایه | مسیر | مسئولیت |
|---|---|---|
| `domain/` | منطق خالص | کلیدواژه، parser وبهوک، رندر پیام، اینترفیس FollowChecker |
| `infra/` | I/O | دیتابیس، کلاینت Instagram، صف |
| `server/` | سرویس‌ها | موتور اتوماسیون، ارسال پیام، توکن، rate limit، auth |
| `app/` | Next.js | صفحات و API routes |
| `worker/` | پردازش پس‌زمینه | مصرف صف |

**ماشین وضعیت اجرا:**

```
received → keyword_matched → public_reply_sent? → private_reply_sent
  → awaiting_user_interaction → follow_checked
      ├ following     → main_message_sent → completed
      └ not_following → follow_gate_sent  → awaiting_user_interaction
  (+ failed، skipped)
```

📄 جزئیات: [`docs/02-architecture.md`](docs/02-architecture.md)

---

## پیش‌نیازها

**برای توسعهٔ محلی:**

- Node.js **۲۰** یا بالاتر
- npm

همین. دیتابیس و صف در حالت پیش‌فرض محلی‌اند (PGlite + صف حافظه‌ای).

**برای production:**

- PostgreSQL 14+
- Redis 6+
- دامنه با HTTPS معتبر
- یک حساب اینستاگرام **Professional** (Business یا Creator) که **عمومی** باشد
- اپ Meta با **Advanced Access** و **Business Verification**

---

## نصب سریع

```bash
cd igflow

npm install       # نصب وابستگی‌ها
npm run setup     # ساخت .env.local با کلیدهای تصادفی + migrate + seed
npm run dev
```

`npm run setup` همه‌چیز را خودش انجام می‌دهد: فایل `.env.local` را با کلیدهای امنِ تصادفی می‌سازد، دیتابیس را مهاجرت می‌دهد و دادهٔ نمونه را وارد می‌کند. اجرای چندبارهٔ آن بی‌خطر است.

> **ترتیب مهم است:** اول `npm install`، بعد `npm run setup`. اسکریپت `setup` عمداً خودش `npm install` را صدا نمی‌زند — دلیلش در بخش [ویندوز](#ویندوز) آمده.

### ویندوز

روی ویندوز (PowerShell) همین دستورها کار می‌کنند. دو نکته:

**۱. خطای `'next' is not recognized` یا `'tsx' is not recognized`**

یعنی `npm install` کامل اجرا نشده و پوشهٔ `node_modules` ساخته نشده است. اول آن را اجرا کنید.

**۲. خطای `npm error code EALLOWSCRIPTS`**

این خطا مربوط به پروژه نیست؛ از تنظیمات سراسری npm روی سیستم شما می‌آید. اگر قبلاً `allow-scripts` را در `.npmrc` کاربری یا سراسری ذخیره کرده باشید (npm خودش هنگام نصب بسته‌های global این را پیشنهاد می‌دهد)، آن مقدار به هر `npm install` داخلی منتقل می‌شود و npm آن را رد می‌کند.

بررسی و پاک کردن:

```powershell
npm config get allow-scripts                        # اگر چیزی جز undefined بود:
npm config delete allow-scripts --location=user
npm config delete allow-scripts --location=global
Remove-Item Env:npm_config_allow_scripts -ErrorAction SilentlyContinue
```

سپس دوباره `npm install`.

**۳. خطای `RuntimeError: Aborted()` هنگام ورود (کد ۵۰۰)**

اگر پروژه را به‌صورت **کپی پوشه** دریافت کرده‌اید (نه از طریق `git clone` یا فایل zip ساخته‌شده با `npm run package`)، احتمالاً پوشهٔ `.data/` هم همراهش آمده است. این پوشه دیتابیس *زندهٔ* ماشین مبدأ است.

PGlite نسخهٔ Postgres روی WebAssembly است و برخلاف Postgres معمولی **بازیابی WAL ندارد**. بنابراین یک datadir که بدون خاموشی تمیز رها شده (یا از سیستم‌عامل دیگری کپی شده) قابل باز شدن نیست و دقیقاً همین خطا را می‌دهد.

از نسخهٔ فعلی این مشکل **خودکار برطرف می‌شود**: هنگام اجرا، دیتابیس معیوب کنار گذاشته می‌شود (با نام `.data/pglite.corrupt-<timestamp>`)، دیتابیس نو ساخته و دادهٔ نمونه دوباره وارد می‌شود. اگر خواستید دستی انجامش دهید:

```powershell
Remove-Item -Recurse -Force .data
npm run setup
```

> **هنگام تحویل پروژه به دیگران** از `npm run package` استفاده کنید. این دستور یک `igflow.zip` تمیز می‌سازد و `.data/`، `.env.local` و `node_modules` را حذف می‌کند — و در پایان بررسی و گزارش می‌کند که واقعاً حذف شده‌اند.

روی <http://localhost:3000> باز کنید.

**حساب نمونه:**

```
ایمیل: demo@igflow.app
رمز:   demo12345
```

برای اجرای worker در ترمینال دوم:

```bash
npm run worker
```

---

## متغیرهای محیطی

همهٔ متغیرها در [`.env.example`](.env.example) با توضیح فارسی آمده‌اند. مهم‌ترین‌ها:

### ضروری

| متغیر | توضیح |
|---|---|
| `AUTH_JWT_SECRET` | کلید امضای سشن. حداقل ۳۲ کاراکتر — `openssl rand -base64 48` |
| `TOKEN_ENCRYPTION_KEY` | کلید AES-256-GCM، دقیقاً ۳۲ بایت base64 — `openssl rand -base64 32` |
| `APP_URL` | آدرس عمومی اپ. در production باید HTTPS باشد |

### Instagram

| متغیر | توضیح |
|---|---|
| `IG_APP_ID` / `IG_APP_SECRET` | از App Dashboard → Instagram → API setup |
| `IG_REDIRECT_URI` | باید **دقیقاً** با مقدار ثبت‌شده در داشبورد Meta یکی باشد |
| `IG_SCOPES` | پیش‌فرض: `instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments` |
| `IG_GRAPH_VERSION` | پیش‌فرض `v25.0` |

### Zernio — اتصال مرحلهٔ اول

| متغیر | توضیح |
|---|---|
| `ZERNIO_API_KEY` | کلید اختصاصی IGFlow؛ فقط در Secretهای سرور ذخیره شود |
| `ZERNIO_BASE_URL` | پیش‌فرض `https://zernio.com/api/v1` |

راه‌اندازی روی Vercel:

1. در Zernio یک API Key با دسترسی حساب Instagram موردنظر بسازید.
2. در Vercel → Settings → Environment Variables مقدار `ZERNIO_API_KEY` را برای Production و Preview اضافه و Sensitive کنید.
3. پروژه را Redeploy کنید، وارد IGFlow شوید و در صفحهٔ `/instagram` دکمهٔ «اتصال حساب موجود در Zernio» را بزنید.
4. IGFlow حساب را از `GET /accounts` پیدا می‌کند، با endpoint سلامت بررسی می‌کند و فقط شناسه‌های غیرمحرمانه را در دیتابیس ذخیره می‌کند.

> در این مرحله Webhook و ارسال خودکار Zernio عمداً غیرفعال است. تا تکمیل آداپتور مرحلهٔ بعد، API نیز اجازهٔ ساخت اتوماسیون برای حساب Zernio را نمی‌دهد؛ بنابراین اتصال ناقص باعث ارسال تکراری یا بی‌اثر نمی‌شود.

### Webhook

| متغیر | توضیح |
|---|---|
| `IG_WEBHOOK_VERIFY_TOKEN` | همان رشته‌ای که در داشبورد Meta وارد می‌کنید |
| `WEBHOOK_SIGNATURE_REQUIRED` | در production حتماً `true` |
| `CRON_SECRET` | کلید حداقل ۳۲ کاراکتری برای محافظت از مسیر نگهداری و Retry |

### زیرساخت

| متغیر | خالی بماند یعنی |
|---|---|
| `DATABASE_URL` | استفاده از PGlite (فقط dev/test) |
| `REDIS_URL` | استفاده از صف حافظه‌ای (فقط dev/test) |

### گزینه‌های خاص

| متغیر | توضیح |
|---|---|
| `AUTH_COOKIE_CROSS_SITE` | فقط اگر داشبورد داخل iframe از دامنهٔ دیگری سرو می‌شود. کوکی را `SameSite=None; Secure; Partitioned` می‌کند. در استقرار معمولی `false` بماند — امن‌تر است |

> 🔒 هیچ مقدار محرمانه‌ای در کد hardcode نشده است. `.env.local` در `.gitignore` قرار دارد.

---

## دیتابیس

**۱۸ جدول**، تعریف کامل در [`src/infra/db/schema.sql`](src/infra/db/schema.sql):

```
users · sessions · audit_logs · schema_migrations
instagram_accounts · oauth_tokens · instagram_users · instagram_posts · instagram_comments
automations · automation_keywords · automation_steps · automation_runs · run_events
message_templates · message_logs · webhook_events · rate_limit_buckets
```

**کلیدهای یکتا (تضمین‌کنندهٔ idempotency):**

| جدول | کلید |
|---|---|
| `users` | `email_norm` |
| `instagram_accounts` | `(user_id, ig_user_id)` |
| `automation_keywords` | `(automation_id, keyword_norm)` |
| `webhook_events` | `(platform, provider_event_id)` |
| `automation_runs` | `(automation_id, comment_id)` |
| `message_logs` | `idempotency_key` |

دستورات:

```bash
npm run db:migrate   # اجرای مهاجرت‌ها
npm run db:seed      # داده نمونه
npm run doctor       # بررسی سلامت + بازسازی خودکار در صورت خرابی
npm run package      # ساخت zip تمیز برای تحویل (بدون .data و .env.local)
```

> `npm run dev` و `npm run start` پیش از اجرا به‌صورت خودکار یک بررسی کوتاه (`scripts/preflight.mts`) انجام می‌دهند: نصب‌بودن وابستگی‌ها، وجود `.env.local` و سالم‌بودن دیتابیس. اگر دیتابیس خالی باشد، دادهٔ نمونه خودکار وارد می‌شود.

### گذار از PGlite به PostgreSQL

PGlite فقط برای توسعه است. برای production:

```bash
docker run -d --name igflow-pg \
  -e POSTGRES_USER=igflow -e POSTGRES_PASSWORD=igflow -e POSTGRES_DB=igflow \
  -p 5432:5432 postgres:16

# در .env.local
DATABASE_URL=postgres://igflow:igflow@localhost:5432/igflow

npm run db:migrate
```

کد اپ تغییری نمی‌کند — درایور بر اساس وجود `DATABASE_URL` انتخاب می‌شود.

---

## راه‌اندازی اپ Meta و OAuth

### ۱. ساخت اپ

1. به <https://developers.facebook.com/apps> بروید
2. **Create App** → نوع **Business**
3. در پنل اپ: **Add Product → Instagram**
4. گزینهٔ **API setup with Instagram business login** را انتخاب کنید

> ⚠️ گزینهٔ *«API setup with Facebook login»* را انتخاب **نکنید** — آن مسیر به Facebook Page نیاز دارد و با طراحی این پروژه سازگار نیست.

### ۲. تنظیم OAuth

در بخش **Business login settings**:

| فیلد | مقدار |
|---|---|
| OAuth redirect URI | `https://YOUR_DOMAIN/api/instagram/callback` |
| Deauthorize callback | `https://YOUR_DOMAIN/api/instagram/deauthorize` |
| Data deletion request | `https://YOUR_DOMAIN/api/instagram/data-deletion` |

> ⚠️ **هر سه آدرس الزامی‌اند.** نبودِ دو مورد آخر یکی از رایج‌ترین دلایل رد شدن App Review است — و در اتحادیهٔ اروپا به‌دلیل GDPR اجباری است. هر دو در این پروژه پیاده‌سازی شده‌اند: امضای `signed_request` را با App Secret به‌روش timing-safe بررسی می‌کنند و درخواست جعلی را با ۴۰۳ رد می‌کنند.
>
> پاسخ `data-deletion` دقیقاً قالب مورد انتظار Meta را دارد:
> ```json
> { "url": "https://…/data-deletion?code=…", "confirmation_code": "…" }
> ```

سپس `IG_APP_ID`، `IG_APP_SECRET` و `IG_REDIRECT_URI` را در `.env.local` بگذارید.

> 🚀 **می‌خواهید کاربرانتان واقعاً با یک کلیک وصل شوند؟** [`docs/استقرار-رایگان.md`](docs/استقرار-رایگان.md) — استقرار روی GitHub + Vercel + Supabase با دامنهٔ دائمی. تونل و کامپیوتر روشن لازم نیست.
>
> 📗 **راهنمای گام‌به‌گام اتصال روی سیستم محلی:** [`docs/اتصال-اینستاگرام.md`](docs/اتصال-اینستاگرام.md)
>
> شامل راه‌اندازی تونل HTTPS (چون اینستاگرام `localhost` را نمی‌پذیرد)، تفاوت Instagram App ID با App ID فیسبوک، افزودن حساب تستر و عیب‌یابی خطاهای رایج.

> مقدار `IG_REDIRECT_URI` باید **کاراکتر به کاراکتر** با داشبورد یکی باشد؛ حتی یک `/` اضافه باعث خطای `redirect_uri_mismatch` می‌شود.

### ۳. مجوزها

| مجوز | کاربرد |
|---|---|
| `instagram_business_basic` | اطلاعات پایهٔ حساب |
| `instagram_business_manage_messages` | ارسال DM، پاسخ خصوصی، خواندن پروفایل |
| `instagram_business_manage_comments` | خواندن و پاسخ به کامنت |

### ۴. چرخهٔ توکن

```
authorization code (۱ ساعت)
   → short-lived token (۱ ساعت)
      → long-lived token (۶۰ روز، قابل تمدید)
```

IGFlow این چرخه را خودکار مدیریت می‌کند: توکن‌ها رمزنگاری‌شده ذخیره می‌شوند و یک job زمان‌بندی‌شده (`refresh-tokens`) آن‌ها را تمدید می‌کند. اگر تمدید شکست بخورد، وضعیت حساب `needs_reauth` می‌شود و در UI پیام اتصال مجدد نمایش داده می‌شود.

### ۵. سطح دسترسی

- **Standard Access** — فقط حساب‌هایی که خودتان مالک یا نقش‌دارشان هستید. برای توسعه کافی است.
- **Advanced Access** — برای سرویس‌دهی به کاربران دیگر. نیازمند **App Review** و **Business Verification**.

---

## راه‌اندازی Webhook

### ۱. آدرس عمومی در توسعهٔ محلی

Meta به یک آدرس HTTPS عمومی نیاز دارد:

```bash
npx cloudflared tunnel --url http://localhost:3000
# یا
ngrok http 3000
```

آدرس تولیدشده را در `APP_URL` بگذارید.

### ۲. ثبت در داشبورد Meta

**App Dashboard → Instagram → Webhooks**:

| فیلد | مقدار |
|---|---|
| Callback URL | `https://YOUR_DOMAIN/api/webhooks/instagram` |
| Verify Token | همان مقدار `IG_WEBHOOK_VERIFY_TOKEN` |

فیلدهایی که باید subscribe شوند:

```
comments
messages
messaging_postbacks
messaging_optins
```

> `messages` و `messaging_postbacks` برای Follow Gate **الزامی** هستند — رضایت کاربر از همین رویدادها تشخیص داده می‌شود.

### ۳. تست دستی

```bash
# تأیید (GET) — باید echo challenge برگردد
curl "http://localhost:3000/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
# → test123

# توکن اشتباه → 403
curl "http://localhost:3000/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x"
```

### ۴. امنیت

هر درخواست POST با هدر `X-Hub-Signature-256` امضا می‌شود. IGFlow امضا را با `IG_APP_SECRET` به‌روش timing-safe بررسی می‌کند. در production حتماً:

```bash
WEBHOOK_SIGNATURE_REQUIRED=true
```

---

## توسعهٔ محلی

```bash
npm run dev          # سرور توسعه (پورت ۳۰۰۰)
npm run worker       # worker صف — ترمینال جداگانه
npm run typecheck    # بررسی نوع‌ها
npm run lint         # ESLint
npm run test         # مجموعهٔ کامل تست‌های خودکار
npm run doctor       # بررسی سلامت محیط
npm run build        # بیلد تولیدی
```

**نکته:** اگر بدون Redis کار کنید، صف حافظه‌ای داخل همان پروسهٔ Next.js اجرا می‌شود و نیازی به `npm run worker` نیست. با تنظیم `REDIS_URL` باید worker را جداگانه اجرا کنید.

---

## تست

```bash
npm run test
```

**تست‌های خودکار در ۷ فایل:**

| فایل | پوشش |
|---|---|
| `tests/oauth.test.ts` | جریان OAuth، امضای state، رمزنگاری توکن، تمدید، خطاها |
| `tests/webhook.test.ts` | تأیید، اعتبارسنجی امضا، parsing، idempotency، backoff |
| `tests/keyword-engine.test.ts` | حالت‌های exact/contains، حساسیت به حروف، یونیکد فارسی |
| `tests/automation-flow.test.ts` | ماشین وضعیت کامل، Follow Gate، حلقهٔ بررسی مجدد |
| `tests/security.test.ts` | جداسازی مستأجرها، CSRF، XSS، SQL injection، افشای توکن |
| `tests/dashboard-api.test.ts` | اعتبارسنجی ورودی، احراز هویت، کدهای خطا |
| `tests/compliance.test.ts` | امضای `signed_request`، لغو دسترسی، حذف کامل داده (cascade) |

تست‌ها روی PGlite جدا اجرا می‌شوند و به سرویس خارجی نیاز ندارند.

---

## استقرار

### گزینهٔ ۱ — Docker Compose (توصیه‌شده)

فایل `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: igflow
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: igflow
    volumes: [pgdata:/var/lib/postgresql/data]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  app:
    build: .
    env_file: .env.production
    depends_on: [db, redis]
    ports: ["3000:3000"]
    restart: unless-stopped

  worker:
    build: .
    command: npm run worker
    env_file: .env.production
    depends_on: [db, redis]
    restart: unless-stopped

volumes:
  pgdata:
```

`Dockerfile`:

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
```

اجرا:

```bash
docker compose up -d
docker compose exec app npm run db:migrate
```

### گزینهٔ ۲ — Vercel + سرویس‌های مدیریت‌شده

| مؤلفه | سرویس |
|---|---|
| اپ | Vercel |
| دیتابیس | Neon / Supabase / RDS |
| صف | Upstash Redis |
| worker | Railway / Fly.io / ECS |

> ⚠️ worker را نمی‌توان روی Vercel اجرا کرد (پروسهٔ دائمی است). آن را جداگانه مستقر کنید.

### چک‌لیست پیش از استقرار

- [ ] `NODE_ENV=production`
- [ ] `AUTH_JWT_SECRET` و `TOKEN_ENCRYPTION_KEY` تازه تولید شده‌اند (نه مقادیر نمونه)
- [ ] `DATABASE_URL` به PostgreSQL واقعی اشاره می‌کند
- [ ] `REDIS_URL` تنظیم شده و worker جداگانه اجرا می‌شود
- [ ] `WEBHOOK_SIGNATURE_REQUIRED=true`
- [ ] `AUTH_COOKIE_CROSS_SITE=false`
- [ ] `APP_URL` با HTTPS
- [ ] `IG_REDIRECT_URI` در داشبورد Meta به‌روز شده
- [ ] Advanced Access و Business Verification تأیید شده
- [ ] `npm run db:migrate` روی دیتابیس production اجرا شده
- [ ] پشتیبان‌گیری خودکار دیتابیس فعال است
- [ ] `npm run build` و `npm run test` سبز

---

## امنیت

| موضوع | پیاده‌سازی |
|---|---|
| رمز عبور | هش با salt، مقایسهٔ timing-safe |
| سشن | JWT امضاشده، کوکی `httpOnly` + `SameSite=Lax` + `Secure` |
| توکن اینستاگرام | AES-256-GCM، با پیشوند نسخه `v1.` |
| افشای توکن | هرگز در پاسخ API یا لاگ — تنها مصرف‌کننده `TokenService` است |
| جداسازی مستأجر | هر کوئری دامنه‌ای `user_id` در `WHERE` دارد |
| SQL injection | تمام کوئری‌ها پارامتری |
| XSS | React escaping + اعتبارسنجی Zod روی هر ورودی |
| CSRF | بررسی هدر `x-requested-with` روی تمام mutationها |
| امضای Webhook | `X-Hub-Signature-256` با مقایسهٔ timing-safe |
| Header های امنیتی | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| افشای هویت ربات | پیش‌فرض روشن (`bot_disclosure`) |

**گزارش آسیب‌پذیری:** مسائل امنیتی را به‌صورت خصوصی گزارش دهید، نه در issue عمومی.

---

## عیب‌یابی

<details dir="rtl">
<summary><b>پس از ورود دوباره به صفحهٔ login برمی‌گردم</b></summary>

مرورگر کوکی سشن را ذخیره نکرده است. معمول‌ترین علت: اپ داخل **iframe از دامنهٔ دیگری** باز شده و مرورگر کوکی شخص‌ثالث را مسدود می‌کند.

- **راه‌حل:** اپ را در تب مستقل باز کنید.
- برای تشخیص دقیق، آدرس `/api/debug/cookie-test` را باز کنید (فقط در حالت غیر-production). جدولی نشان می‌دهد مرورگر شما کدام نوع کوکی را می‌پذیرد.
- اگر واقعاً به حالت embed نیاز دارید: `AUTH_COOKIE_CROSS_SITE=true`. توجه کنید که برخی مرورگرها (مثلاً Firefox با Total Cookie Protection) حتی با `Partitioned` هم مسدود می‌کنند — این سیاست مرورگر است و با تنظیم سمت سرور قابل دور زدن نیست.
</details>

<details dir="rtl">
<summary><b>خطای <code>redirect_uri_mismatch</code></b></summary>

مقدار `IG_REDIRECT_URI` با آنچه در داشبورد Meta ثبت شده یکی نیست. باید **کاراکتر به کاراکتر** برابر باشد — پروتکل، دامنه، مسیر و حتی وجود یا نبود `/` انتهایی.
</details>

<details dir="rtl">
<summary><b>وبهوک تأیید نمی‌شود</b></summary>

- `IG_WEBHOOK_VERIFY_TOKEN` باید دقیقاً با مقدار داشبورد یکی باشد
- آدرس باید **عمومی و HTTPS** باشد (localhost کار نمی‌کند)
- سرور باید در کمتر از ۵ ثانیه پاسخ دهد
- تست: `curl "https://YOUR_DOMAIN/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test"`
</details>

<details dir="rtl">
<summary><b>خطای <code>User consent is required to access user profile</code></b></summary>

این خطا **مورد انتظار** است، نه باگ. کاربر هنوز در دایرکت تعاملی نداشته.

مطمئن شوید پیام خصوصی شما حداقل یک **Quick Reply** دارد و فیلدهای `messages` و `messaging_postbacks` در وبهوک subscribe شده‌اند. [توضیح کامل](#محدودیتهای-رسمی-که-باید-بدانید)
</details>

<details dir="rtl">
<summary><b>خطای <code>outside of allowed window</code></b></summary>

پنجرهٔ ۲۴ ساعتهٔ پیام‌رسانی بسته شده. تنها راه رسمی، تعامل مجدد کاربر است. IGFlow این حالت را تشخیص می‌دهد و اجرا را `failed` با دلیل `outside_window` علامت می‌زند.
</details>

<details dir="rtl">
<summary><b>پایگاه دادهٔ محلی خراب شده (<code>RuntimeError: Aborted()</code>)</b></summary>

PGlite در صورت خاموش شدن ناگهانی فرایند خراب می‌شود:

```bash
npm run doctor    # تشخیص و بازسازی خودکار
```
</details>

<details dir="rtl">
<summary><b>پیام‌ها ارسال نمی‌شوند</b></summary>

1. آیا worker اجراست؟ (`npm run worker` — در صورت تنظیم `REDIS_URL`)
2. وضعیت اتوماسیون `active` است یا `draft`؟
3. صفحهٔ `/automations/:id/logs` را ببینید — دلیل دقیق آنجاست
4. توکن منقضی شده؟ صفحهٔ `/settings/instagram` را بررسی کنید
</details>

<details dir="rtl">
<summary><b><code>next: not found</code></b></summary>

```bash
npm install
```
</details>

---

## ساختار پروژه

```
igflow/
├── src/
│   ├── app/
│   │   ├── (dashboard)/        ۱۱ صفحهٔ داشبورد
│   │   ├── api/
│   │   │   ├── auth/           ورود، خروج
│   │   │   ├── instagram/      اتصال، callback، قطع اتصال
│   │   │   ├── automations/    CRUD
│   │   │   └── webhooks/       دریافت رویدادهای Instagram
│   │   └── login/
│   ├── components/             UI kit + سازندهٔ اتوماسیون
│   ├── domain/                 منطق خالص (بدون I/O)
│   │   ├── automation/         parser وبهوک
│   │   ├── keyword/            موتور تطبیق
│   │   ├── follow/             اینترفیس FollowChecker
│   │   └── messaging/          رندر متغیرها
│   ├── infra/
│   │   ├── db/                 schema، کلاینت، repositoryها
│   │   ├── instagram/          کلاینت Graph API + taxonomy خطا
│   │   └── queue/              BullMQ یا حافظه‌ای
│   ├── server/                 سرویس‌های لایهٔ کاربرد
│   ├── worker/                 پردازش پس‌زمینه
│   └── lib/                    env، crypto، logger، utils
├── tests/                      تست‌های خودکار
├── scripts/                    migrate، seed، doctor
└── docs/
    ├── 01-capability-audit.md  ممیزی قابلیت‌های رسمی
    ├── 02-architecture.md      معماری
    ├── 11-dashboard.md         مستندات داشبورد
    ├── 13-deployment.md        استقرار (مرحلهٔ ۱۳)
    └── presentation.html       ارائهٔ فارسی
```

---

## مجوز

MIT

</div>
