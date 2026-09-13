# مرحله ۲ — Architecture

## 2.1 نمای کلان

```
                 ┌─────────────────────────── Meta / Instagram ───────────────────────────┐
                 │  www.instagram.com/oauth/authorize   api.instagram.com/oauth/...        │
                 │  graph.instagram.com  (comments, messages, user profile, subscriptions) │
                 └───────▲──────────────────────────────┬──────────────────────────────────┘
                         │ OAuth + REST                 │ Webhook POST (X-Hub-Signature-256)
                         │                              ▼
   ┌─────────────┐   ┌───┴──────────────────────────────────────────────┐
   │  Browser    │──▶│  Next.js 15 (App Router, TS, Tailwind)           │
   │  Dashboard  │   │  ├─ /app/(dashboard)/*      UI صفحات             │
   └─────────────┘   │  ├─ /api/*                  REST داخلی (JWT)     │
                     │  ├─ /api/instagram/connect  شروع OAuth           │
                     │  ├─ /api/instagram/callback بازگشت OAuth         │
                     │  └─ /api/webhooks/instagram  ← FAST PATH (<5s)   │
                     └───────────┬──────────────────────────────────────┘
                                 │ (فقط validate → persist → enqueue)
                     ┌───────────▼───────────┐        ┌────────────────────┐
                     │  PostgreSQL (RLS-ready)│◀──────▶│  Queue             │
                     │  multi-tenant by user_id│        │  BullMQ + Redis    │
                     └───────────▲───────────┘        │  (dev: InMemory)   │
                                 │                    └─────────┬──────────┘
                     ┌───────────┴────────────────────────────▼─────────┐
                     │  Worker  (npm run worker)                        │
                     │   ├─ WebhookEventProcessor   (dedup / parse)     │
                     │   ├─ AutomationEngine        (node graph runner) │
                     │   ├─ KeywordEngine                               │
                     │   ├─ FollowCheckerRegistry                       │
                     │   ├─ MessageRenderer  ({{vars}})                 │
                     │   ├─ RateLimiter (token bucket / IG account)     │
                     │   └─ RetryPolicy (5s → 30s → 2m → failed)        │
                     └──────────────────────────────────────────────────┘
```

**قانون طلایی:** Webhook handler هرگز به Instagram API درخواست نمی‌زند و هرگز Automation اجرا نمی‌کند. فقط سه کار: `verify signature` → `INSERT webhook_events` → `enqueue`. چون Meta پاسخ زیر ۵ ثانیه می‌خواهد.

---

## 2.2 لایه‌بندی (Clean Architecture)

```
src/
  domain/        ← موجودیت‌ها، interfaceها، قواعد کسب‌وکار خالص (بدون I/O)
      automation/   keyword/   follow/   messaging/
  infra/         ← پیاده‌سازی‌ها: db، instagram api client، queue، crypto، logger
  app/           ← Next.js (UI + API routes) — نازک، فقط ورودی/خروجی
  worker/        ← مصرف‌کنندهٔ صف
  server/        ← use-caseها و سرویس‌های مشترک بین app و worker
```

وابستگی فقط به سمت داخل است: `app/worker → server → domain` و `infra` پشت interfaceهای `domain` پنهان است.

---

## 2.3 ماشین حالت یک Run

```
 received → keyword_matched → public_reply_sent? → private_reply_sent
        → awaiting_user_interaction ⏳  (کاربر باید Quick Reply بزند — الزام پلتفرم)
        → follow_checked
            ├─ following      → main_message_sent → completed ✅
            └─ not_following  → follow_gate_sent → awaiting_user_interaction ⏳ (recheck)
 هر مرحله می‌تواند برود به:  retrying → failed ❌   یا   skipped (duplicate/disabled)
```

حالت `awaiting_user_interaction` یک حالت **معتبر و پایدار** است، نه خطا. مستقیماً از محدودیت consent در بخش ۱.۳ می‌آید.

---

## 2.4 مدل داده (خلاصه — جزئیات در مرحله ۴)

Multi-tenant به سبک **shared schema + `user_id` روی هر جدول**؛ هر repository اجباراً `user_id` می‌گیرد (در TS سطح تایپ اجبار شده) و SQL هم `WHERE user_id = $1` دارد. برای Postgres واقعی، اسکریپت اختیاری RLS هم تولید می‌شود.

جداول: `users`, `sessions`, `instagram_accounts`, `oauth_tokens`, `automations`, `automation_keywords`, `automation_steps`, `message_templates`, `instagram_posts`, `instagram_comments`, `instagram_users`, `automation_runs`, `run_events`(logs), `message_logs`, `webhook_events`, `audit_logs`.

---

## 2.5 امنیت

| موضوع | تصمیم |
|---|---|
| احراز هویت SaaS | JWT امضاشده (HS256, `jose`) داخل کوکی `httpOnly + SameSite=Lax + Secure` — نه localStorage |
| رمز عبور | `scrypt` با salt تصادفی ۱۶ بایتی، مقایسهٔ timing-safe |
| Token اینستاگرام | **AES-256-GCM** at rest؛ کلید از `TOKEN_ENCRYPTION_KEY` (۳۲ بایت base64) در env. هرگز در response/log |
| CSRF | OAuth state امضاشده + کوکی `SameSite=Lax` + هدر `x-requested-with` روی mutationها |
| XSS | React escaping پیش‌فرض، هیچ `dangerouslySetInnerHTML`، CSP در `next.config` |
| SQL Injection | فقط parameterized query؛ هیچ string concat |
| Webhook | HMAC-SHA256 با App Secret، مقایسهٔ `timingSafeEqual` روی **raw body** |
| Tenant isolation | تست اختصاصی + تایپ `TenantScope` |

---

## 2.6 تصمیم‌های فنی و دلیل انحراف‌ها

| موضوع | انتخاب | دلیل |
|---|---|---|
| Frontend | Next.js 15 + TS + Tailwind | طبق درخواست |
| shadcn/ui | **کامپوننت‌های هم‌سبک، محلی و بدون وابستگی خارجی** در `src/components/ui` | CLI شادcn نیاز به دانلود در build دارد؛ همان الگوی Radix-less + `cn()` + توکن‌های Tailwind پیاده شد تا پروژه offline هم build شود. مهاجرت به shadcn واقعی بدون تغییر API کامپوننت‌ها ممکن است |
| DB | PostgreSQL | طبق درخواست. درایور `pg` |
| DB در محیط dev/تست | **PGlite** (Postgres کامپایل‌شده به WASM) | تا پروژه بدون نصب Postgres «واقعاً اجرا و تست» شود؛ همان SQL، همان مهاجرت‌ها. با `DATABASE_URL` به Postgres واقعی سوییچ می‌کند |
| Queue | BullMQ + Redis؛ fallback: `InMemoryQueue` | Production طبق درخواست؛ fallback فقط برای dev/CI بدون Redis |
| ORM | SQL خام + repository تایپ‌دار | کنترل کامل روی ایندکس/یکتایی و idempotency؛ کمترین جادو |
| API نسخهٔ Graph | `v25.0` روی `graph.instagram.com` | نسخه‌ای که در نمونه‌های رسمی فعلی آمده؛ از `IG_GRAPH_VERSION` قابل تغییر |
