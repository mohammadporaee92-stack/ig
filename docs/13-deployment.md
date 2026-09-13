<div dir="rtl">

# مرحلهٔ ۱۳ — استقرار

این سند مسیر رفتن از محیط توسعه به production را توضیح می‌دهد، همراه با دلیل هر تصمیم.

---

## ۱. تفاوت dev و production

IGFlow در توسعه بدون هیچ سرویس خارجی کار می‌کند. این عمدی است — اما هیچ‌کدام از آن پیش‌فرض‌ها برای production مناسب نیستند.

| مؤلفه | توسعه | Production | چرا باید عوض شود |
|---|---|---|---|
| دیتابیس | PGlite (فایل محلی) | PostgreSQL | PGlite تک‌پروسه است، همزمانی ندارد و با kill ناگهانی خراب می‌شود |
| صف | حافظه‌ای | Redis + BullMQ | صف حافظه‌ای با ری‌استارت پاک می‌شود و بین چند نمونه مشترک نیست |
| Worker | داخل همان پروسه | پروسهٔ جداگانه | جدا کردن، مقیاس‌پذیری مستقل و جلوگیری از بلاک شدن درخواست‌ها |
| کوکی | `SameSite=Lax` | `SameSite=Lax` + `Secure` | HTTPS اجباری |
| امضای وبهوک | اختیاری | **اجباری** | بدون آن هر کسی می‌تواند رویداد جعلی بفرستد |

انتخاب درایور خودکار است: اگر `DATABASE_URL` تنظیم باشد PostgreSQL، وگرنه PGlite. برای `REDIS_URL` هم همین‌طور. **کد اپ تغییر نمی‌کند.**

---

## ۲. آماده‌سازی متغیرها

```bash
cp .env.example .env.production
```

کلیدها را تازه تولید کنید — هرگز از مقادیر نمونه استفاده نکنید:

```bash
echo "AUTH_JWT_SECRET=$(openssl rand -base64 48)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "IG_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 24)"
```

> ⚠️ `TOKEN_ENCRYPTION_KEY` باید **دقیقاً ۳۲ بایت** باشد. اگر بعداً عوضش کنید، تمام توکن‌های ذخیره‌شده غیرقابل رمزگشایی می‌شوند و همهٔ کاربران باید حساب اینستاگرام را دوباره وصل کنند. این کلید را مثل کلید دیتابیس نگه دارید.

مقادیر production:

```bash
NODE_ENV=production
APP_URL=https://igflow.example.com
DATABASE_URL=postgres://user:pass@host:5432/igflow
REDIS_URL=redis://host:6379
WEBHOOK_SIGNATURE_REQUIRED=true
AUTH_COOKIE_CROSS_SITE=false
IG_REDIRECT_URI=https://igflow.example.com/api/instagram/callback
```

---

## ۳. استقرار با Docker Compose

ساده‌ترین مسیر. همه‌چیز در `docker-compose.yml` و `Dockerfile` آماده است.

```bash
export DB_PASSWORD="$(openssl rand -base64 24)"

docker compose up -d --build
docker compose exec app npm run db:migrate

docker compose ps
curl -f http://localhost:3000/api/health
```

خروجی سالم:

```json
{"status":"ok","checks":{"database":"ok"},"timestamp":"..."}
```

**نکات طراحی:**

- پورت PostgreSQL منتشر **نمی‌شود** — فقط از شبکهٔ داخلی Docker در دسترس است
- اپ با کاربر غیر-root (`nextjs`) اجرا می‌شود
- `depends_on` با `condition: service_healthy` جلوی استارت زودهنگام را می‌گیرد
- worker سرویس جداگانه‌ای است و مستقل مقیاس می‌گیرد:

```bash
docker compose up -d --scale worker=3
```

---

## ۴. استقرار روی Vercel

| مؤلفه | سرویس پیشنهادی |
|---|---|
| اپ Next.js | Vercel |
| PostgreSQL | Neon، Supabase یا RDS |
| Redis | Upstash |
| Worker | Railway، Fly.io یا ECS |

> ⚠️ **worker روی Vercel اجرا نمی‌شود.** پروسهٔ دائمی است و مدل serverless آن را پشتیبانی نمی‌کند. اگر فقط اپ را روی Vercel بگذارید و worker را فراموش کنید، وبهوک‌ها دریافت و ذخیره می‌شوند اما **هرگز پردازش نمی‌شوند** — و هیچ خطایی هم نمی‌بینید. این سکوت خطرناک است.

```bash
vercel --prod
# متغیرها را در Project Settings → Environment Variables وارد کنید
```

worker روی Railway:

```bash
railway up
railway run npm run worker
```

---

## ۵. مهاجرت دیتابیس

```bash
npm run db:migrate
```

اسکریپت idempotent است — جدول `schema_migrations` مهاجرت‌های اجراشده را ثبت می‌کند و اجرای دوباره بی‌ضرر است.

**پیش از هر مهاجرت روی production پشتیبان بگیرید:**

```bash
pg_dump "$DATABASE_URL" | gzip > backup-$(date +%F-%H%M).sql.gz
```

بازیابی:

```bash
gunzip -c backup-2026-09-12-1430.sql.gz | psql "$DATABASE_URL"
```

---

## ۶. تنظیمات Meta برای production

پس از بالا آمدن دامنه:

1. **App Dashboard → Instagram → Business login settings**
   OAuth redirect URI را به دامنهٔ واقعی به‌روز کنید
2. **App Dashboard → Instagram → Webhooks**
   Callback URL: `https://YOUR_DOMAIN/api/webhooks/instagram`
   فیلدها: `comments`, `messages`, `messaging_postbacks`, `messaging_optins`
3. **App Review** — برای سرویس‌دهی به کاربران دیگر، Advanced Access بگیرید
4. **Business Verification** — پیش‌نیاز Advanced Access

مجوزهای مورد نیاز در App Review:

| مجوز | دلیلی که باید توضیح دهید |
|---|---|
| `instagram_business_basic` | شناسایی حساب متصل‌شده |
| `instagram_business_manage_comments` | خواندن کامنت و پاسخ عمومی |
| `instagram_business_manage_messages` | ارسال پاسخ خصوصی و DM |

> در ویدیوی App Review، **جریان کامل** را نشان دهید: کامنت گذاشتن، دریافت DM، زدن دکمه، دریافت محتوا. Meta درخواست‌هایی را که فقط اسکرین‌شات دارند رد می‌کند.

---

## ۷. چک‌لیست پیش از راه‌اندازی

**امنیت**

- [ ] `AUTH_JWT_SECRET` و `TOKEN_ENCRYPTION_KEY` تازه تولید شده
- [ ] `WEBHOOK_SIGNATURE_REQUIRED=true`
- [ ] `AUTH_COOKIE_CROSS_SITE=false`
- [ ] `.env.production` در git نیست
- [ ] پورت دیتابیس به اینترنت باز نیست
- [ ] HTTPS با گواهی معتبر

**زیرساخت**

- [ ] `DATABASE_URL` به PostgreSQL واقعی اشاره می‌کند
- [ ] `REDIS_URL` تنظیم شده
- [ ] worker در حال اجراست (این را جداگانه تأیید کنید)
- [ ] مهاجرت‌ها اجرا شده‌اند
- [ ] پشتیبان‌گیری خودکار فعال است
- [ ] `/api/health` پاسخ ۲۰۰ می‌دهد

**Meta**

- [ ] redirect URI با دامنهٔ production یکی است
- [ ] وبهوک تأیید شده و فیلدها subscribe شده‌اند
- [ ] Advanced Access تأیید شده
- [ ] Business Verification کامل است

**کیفیت**

- [ ] `npm run build` موفق
- [ ] `npm run test` — ۱۱۸ تست سبز
- [ ] `npm run lint` بدون خطا
- [ ] `npm run typecheck` بدون خطا

---

## ۸. پایش

### سلامت

```bash
curl -f https://YOUR_DOMAIN/api/health
```

این را به uptime monitor وصل کنید. کد ۵۰۳ یعنی دیتابیس در دسترس نیست.

### لاگ‌ها

لاگ‌ها JSON ساختاریافته‌اند و مستقیم به stdout می‌روند:

```json
{"t":"...","level":"info","scope":"webhook","msg":"...","data":{}}
```

> توکن‌ها و مقادیر حساس پیش از نوشتن در لاگ حذف می‌شوند.

### معیارهایی که باید زیر نظر باشند

| معیار | هشدار وقتی |
|---|---|
| عمق صف | مدام رشد می‌کند ⇒ worker از پس بار برنمی‌آید |
| اجراهای `failed` | جهش ناگهانی ⇒ احتمالاً توکن منقضی یا تغییر API |
| خطاهای `rate_limit` | زیاد شد ⇒ مقادیر `RL_*` را کاهش دهید |
| حساب‌های `needs_reauth` | رشد کرد ⇒ تمدید توکن کار نمی‌کند |
| زمان پاسخ وبهوک | نزدیک ۵ ثانیه ⇒ خطر timeout و تلاش مجدد Meta |

پرس‌وجوی سریع:

```sql
SELECT status, COUNT(*) FROM automation_runs
WHERE created_at > now() - interval '24 hours'
GROUP BY status;
```

---

## ۹. مقیاس‌پذیری

**اپ** بدون حالت است؛ هر تعداد نمونه پشت load balancer قابل اجراست.

**worker** را افقی زیاد کنید. BullMQ توزیع کار را تضمین می‌کند و idempotency در لایهٔ دیتابیس (کلید یکتای `message_logs.idempotency_key`) از ارسال تکراری جلوگیری می‌کند:

```bash
docker compose up -d --scale worker=5
```

**دیتابیس** — از connection pooler استفاده کنید (PgBouncer یا Neon pooling). ایندکس‌های لازم در `schema.sql` تعریف شده‌اند.

**نکتهٔ مهم:** گلوگاه واقعی معمولاً دیتابیس یا worker نیست، بلکه **محدودیت نرخ خود Instagram** است. بیشتر کردن workerها از آن سقف عبور نمی‌کند و فقط باعث خطای بیشتر می‌شود. `RL_MESSAGES_PER_MINUTE` و `RL_PRIVATE_REPLIES_PER_HOUR` را مطابق سهمیهٔ واقعی اپ خود تنظیم کنید.

---

## ۱۰. بازگشت به عقب (Rollback)

```bash
docker compose down
git checkout <previous-tag>
docker compose up -d --build
```

اگر مهاجرت دیتابیس اجرا شده بود، ابتدا از پشتیبان بازیابی کنید. مهاجرت‌ها به‌صورت خودکار برگشت‌پذیر نیستند — این یک تصمیم آگاهانه است، چون rollback خودکار اسکیما ریسک از دست رفتن داده دارد.

---

## ۱۱. اشتباهات رایج

| اشتباه | نتیجه |
|---|---|
| فراموش کردن اجرای worker | وبهوک‌ها ذخیره می‌شوند اما هرگز پردازش نمی‌شوند — **بدون هیچ خطایی** |
| عوض کردن `TOKEN_ENCRYPTION_KEY` | تمام توکن‌ها غیرقابل استفاده، همهٔ کاربران باید دوباره وصل شوند |
| `WEBHOOK_SIGNATURE_REQUIRED=false` در production | هر کسی می‌تواند رویداد جعلی بفرستد |
| استفاده از PGlite در production | خرابی داده هنگام ری‌استارت |
| عدم به‌روزرسانی redirect URI | خطای `redirect_uri_mismatch` در اتصال |
| باز گذاشتن پورت دیتابیس | دسترسی مستقیم از اینترنت |

</div>
