# مرحله ۱ — Capability Audit رسمی Instagram Platform

> تاریخ بررسی: **۲۰۲۶/۰۹/۱۲**
> منبع: صرفاً مستندات رسمی `developers.facebook.com` (بدون اتکا به ادعای سایت‌های ثالث).
> هر ردیف با لینک مستقیم به صفحهٔ رسمی مستند شده است.

---

## 1.1 خلاصهٔ اجرایی (TL;DR)

| # | نتیجه |
|---|-------|
| ۱ | **Instagram Login بدون Facebook Page ممکن است.** مسیر رسمی: *Business Login for Instagram* روی `graph.instagram.com`. کاربر فقط با credential اینستاگرام خودش لاگین می‌کند. ✅ دقیقاً همان چیزی که خواستی. |
| ۲ | **Comment Webhook + Keyword + Private Reply (DM) کاملاً رسمی است.** ✅ |
| ۳ | **Follow Check رسمی وجود دارد** (`is_user_follow_business`) اما **مشروط به User Consent**؛ و کامنت‌کردن، consent ایجاد نمی‌کند. فقط *پیام‌دادن کاربر* (یا زدن Quick Reply / Icebreaker / Persistent Menu) consent می‌سازد. ⚠️ **این مهم‌ترین یافتهٔ این Audit است و کل طراحی Follow Gate را تعیین می‌کند.** |
| ۴ | **Follow Event / Webhook «کاربر فالو کرد» وجود ندارد.** ❌ هیچ فیلد webhook رسمی برای follow/unfollow در Instagram Platform نیست. |
| ۵ | هیچ‌جا نیاز به scraping / Private API / session cookie / رمز کاربر نیست. کل Workflow خواسته‌شدهٔ تو با API رسمی **قابل ساخت است**، فقط ترتیب مراحل Follow Gate باید عوض شود (توضیح در بخش ۱.۴). |

---

## 1.2 جدول اصلی Capability Audit

| قابلیت | API رسمی دارد؟ | Endpoint رسمی | مجوز (Scope) لازم | محدودیت‌های رسمی | قابل پیاده‌سازی؟ |
|---|---|---|---|---|---|
| **Instagram Login** (بدون Facebook Page) | ✅ بله | `GET https://www.instagram.com/oauth/authorize` → `POST https://api.instagram.com/oauth/access_token` → `GET https://graph.instagram.com/access_token` | `instagram_business_basic` + بقیه scopeها | فقط حساب **Professional** (Business/Creator). حساب Personal اصلاً API ندارد. Access token کوتاه‌مدت ۱ ساعت، بلندمدت ۶۰ روز | ✅ **بله** |
| **Refresh Token** | ✅ بله | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` | — | توکن باید حداقل ۲۴ ساعت عمر داشته و منقضی نشده باشد؛ تمدید ۶۰ روزه | ✅ بله |
| **خواندن پروفایل حساب متصل** | ✅ بله | `GET /me?fields=id,username,account_type,profile_picture_url,followers_count,media_count` | `instagram_business_basic` | — | ✅ بله |
| **Read comments** | ✅ بله | `GET /<IG_MEDIA_ID>/comments` ، `GET /<IG_COMMENT_ID>` | `instagram_business_basic` + `instagram_business_manage_comments` | حداکثر ۵۰ در هر صفحه | ✅ بله |
| **Comment Webhook (Trigger)** | ✅ بله | فیلد webhook: `comments` (و `live_comments`) | `instagram_business_basic` + `instagram_business_manage_comments` | **Advanced Access الزامی** + Business Verification + اپ باید Live باشد + حساب باید Public باشد. پاسخ ۲۰۰ در کمتر از ۵ ثانیه. Album ID در payload نیست | ✅ بله |
| **Keyword detection** | Local (سمت ما) | — | — | — | ✅ بله |
| **Public Reply به کامنت** | ✅ بله | `POST /<IG_COMMENT_ID>/replies` | `instagram_business_manage_comments` | — | ✅ بله |
| **Private Reply (DM در پاسخ به کامنت)** | ✅ بله | `POST /<IG_ID>/messages` با `recipient:{comment_id}` | `instagram_business_basic` + `instagram_business_manage_comments` | **فقط ۱ پیام به ازای هر کامنت**؛ تا **۷ روز** بعد از کامنت؛ برای Live فقط حین پخش زنده. ادامهٔ گفتگو فقط اگر کاربر جواب دهد (پنجرهٔ ۲۴ ساعته) | ✅ بله |
| **Send DM (پیام آزاد)** | ✅ بله | `POST /<IG_ID>/messages` با `recipient:{id: IGSID}` | `instagram_business_basic` + `instagram_business_manage_messages` | فقط داخل **پنجرهٔ ۲۴ ساعته** بعد از آخرین پیام کاربر. متن ≤ ۱۰۰۰ بایت | ✅ بله |
| **Button در DM (Quick Reply)** | ✅ بله | همان `/messages` با `message.quick_replies[]` | `instagram_business_manage_messages` | حداکثر ۱۳ دکمه، عنوان ≤ ۲۰ کاراکتر، روی دسکتاپ نمایش داده نمی‌شود | ✅ بله |
| **Button لینک‌دار (Generic Template / CTA)** | ✅ بله | `message.attachment.type=template` | `instagram_business_manage_messages` | فقط داخل پنجرهٔ ۲۴ ساعته | ✅ بله |
| **ارسال تصویر / ویدیو / فایل PDF در DM** | ✅ بله | `message.attachment.type = image\|video\|audio\|file` | `instagram_business_manage_messages` | Image ≤ 8MB (png/jpeg)، Video ≤ 25MB، **File فقط PDF ≤ 25MB**. داخل پنجرهٔ ۲۴ ساعته | ✅ بله |
| **Check Follow** (آیا کاربر ما را فالو کرده؟) | ⚠️ **بله، اما مشروط** | `GET /<IGSID>?fields=is_user_follow_business,is_business_follow_user,username,name,follower_count` | `instagram_business_basic` + `instagram_business_manage_messages` | ⛔ **User Consent الزامی**: consent فقط وقتی ست می‌شود که کاربر **پیامی بفرستد** یا Icebreaker/Persistent Menu/Quick Reply بزند. صرفِ کامنت‌گذاشتن consent نمی‌سازد و خطای «User consent is required to access the user profile» می‌گیری. اگر کاربر بیزنس را بلاک کرده باشد هم در دسترس نیست | ⚠️ **بله — ولی فقط بعد از تعامل DM کاربر** (طراحی ما در ۱.۴) |
| **Follow event / Webhook فالو** | ❌ **خیر** | — | — | در جدول رسمی فیلدهای webhook اینستاگرام هیچ فیلد `follows` وجود ندارد. فیلدهای موجود: `comments`, `live_comments`, `mentions`, `messages`, `message_echoes`, `message_reactions`, `messaging_handover`, `messaging_optins`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `story_insights` | ❌ **خیر** → `UnsupportedFollowEventSource` |
| **لیست فالوورها** (`/followers`) | ❌ **خیر** | — | — | چنین edge‌ای برای IG User در مرجع رسمی وجود ندارد | ❌ خیر |
| **Webhook** | ✅ بله | `GET`(verify) + `POST` روی endpoint ما؛ فعال‌سازی: `POST /me/subscribed_apps?subscribed_fields=comments,messages,...` | بسته به فیلد | امضای `X-Hub-Signature-256` (SHA256 HMAC با App Secret). Retry تا ۳۶ ساعت → **dedup سمت ما الزامی**. Batch تا ۱۰۰۰ رویداد. TLS معتبر (self-signed ممنوع) | ✅ بله |
| **Business Discovery** (دیدن دادهٔ حساب دیگران) | ❌ در مسیر Instagram Login | `?fields=business_discovery.username(...)` | فقط با **Facebook Login** | در مسیر بدون Facebook Page در دسترس نیست. ضمناً `followers_count` عمومی است نه رابطهٔ فالو | ❌ (و برای Follow Gate هم بی‌فایده است) |
| **Hashtag search** | ❌ در مسیر Instagram Login | — | فقط Facebook Login | — | ❌ (خارج از نیاز ما) |

---

## 1.3 چرا Follow Check «مستقیماً سر کامنت» ممکن نیست — دلیل فنی

مستند رسمی *Instagram User Profile API* صریح می‌گوید:

> **User consent is required to access an Instagram user's profile.**
> User consent is set only when an Instagram user **sends a message** to your app user, or **clicks an icebreaker or persistent menu**. If an Instagram user **comments on a post** or comment but has not sent a message to your app user … your app will receive an error, **User consent is required to access user profile.**

یعنی زنجیرهٔ علت‌ومعلولی رسمی این است:

```
کامنت  ─► IGSID داریم، ولی consent نداریم ─► /<IGSID>?fields=is_user_follow_business  ➜  ERROR
تعامل کاربر در DM (reply یا Quick Reply) ─► consent ست می‌شود ─► همان کوئری  ➜  true/false ✅
```

**نتیجه:** Follow Check رسمی «جعلی» نیست و واقعاً وجود دارد — اما **جای آن در Flow جابه‌جا می‌شود**: بعد از اولین تعامل کاربر در دایرکت، نه بلافاصله بعد از کامنت.

همچنین Private Reply هم خودش محدودیت «فقط یک پیام» دارد؛ پس پیام دوم (فایل اصلی) به‌هرحال نیازمند پاسخ کاربر است. این دو محدودیت با هم، دقیقاً یک طراحی را ایجاب می‌کنند (بخش بعد).

---

## 1.4 نزدیک‌ترین Workflow رسمی جایگزین (طراحی نهایی Follow Gate)

این همان چیزی است که ابزارهای معتبر بازار هم با API رسمی انجام می‌دهند:

```
① Instagram Comment ──(webhook: comments)──────────────────────────────────┐
                                                                            │
② Keyword Engine → Automation پیدا شد                                       │
                                                                            │
③ (اختیاری) Public Reply روی کامنت: «برات دایرکت فرستادم 📩»                 │
                                                                            │
④ Private Reply  ← تنها ۱ پیام مجاز، تا ۷ روز                               │
   متن: «سلام 👋 برای دریافت فایل روی دکمهٔ زیر بزن»                          │
   + Quick Reply:  [ ✅ انجام شد / دریافت فایل ]   ← کلید ماجرا              │
                                                                            │
⑤ کاربر دکمه را می‌زند  ──(webhook: messages + quick_reply.payload)──────────┘
   ⇒ CONSENT ست شد  ⇒  پنجرهٔ ۲۴ ساعتهٔ پیام باز شد
                                                                
⑥ GET /<IGSID>?fields=username,name,is_user_follow_business   ← Follow Check رسمی ✅
                                                                
     ┌────────────── true ──────────────┐        ┌───────── false ─────────┐
     │ ⑦ Main Message                    │        │ ⑦' Follow Gate Message  │
     │  متن + لینک + عکس/PDF/دکمه        │        │  «اول پیج رو فالو کن ❤️»│
     │  → SUCCESS                        │        │  + Quick Reply [بررسی  │
     └───────────────────────────────────┘        │    مجدد] → برگرد به ⑥  │
                                                   └─────────────────────────┘
```

مزایای این طراحی:
* ۱۰۰٪ رسمی، بدون scraping، بدون رمز، بدون browser automation.
* Follow Check واقعی و لحظه‌ای است (نه حدس، نه follower-count delta).
* اگر کاربر نهایی Follow Gate را خاموش کند، مرحلهٔ ⑥ حذف و مستقیم ⑦ اجرا می‌شود.
* اگر روزی Meta فیلد consent-free یا webhook فالو بدهد، فقط یک کلاس جدید `FollowChecker` اضافه می‌شود (بخش ۱.۶).

### حالت لبه‌ای که باید در UI صادق باشیم
اگر کاربرِ کامنت‌گذار **هرگز** روی Quick Reply نزند، سیستم نمی‌تواند نه Follow را چک کند و نه پیام دوم بفرستد. این یک محدودیت **پلتفرمی**، نه نقص محصول. در UI به‌صورت وضعیت `awaiting_user_interaction` نمایش داده می‌شود و در Analytics به‌عنوان قیف (funnel) شمرده می‌شود.

---

## 1.5 محدودیت‌های عملیاتی که باید در کد رعایت شوند

| محدودیت رسمی | پیاده‌سازی ما |
|---|---|
| پاسخ webhook در < ۵ ثانیه | handler فقط امضا را چک، رویداد را ذخیره و enqueue می‌کند؛ هیچ I/O سنگینی ندارد |
| Retry مِتا تا ۳۶ ساعت | Idempotency روی `(platform, provider_event_id)` + یکتایی `(comment_id, automation_id)` |
| Private Reply: ۱ پیام / ۷ روز | ثبت `private_reply_sent_at` و بررسی پنجرهٔ ۷ روزه قبل از ارسال |
| Messaging: پنجرهٔ ۲۴ ساعته | ثبت `messaging_window_expires_at` روی رکورد `instagram_users`؛ قبل از هر ارسال چک می‌شود |
| متن پیام ≤ ۱۰۰۰ بایت | اعتبارسنجی با Zod در سطح Template + برش امن در زمان ارسال |
| Quick reply: ≤ ۱۳ دکمه، عنوان ≤ ۲۰ کاراکتر | اعتبارسنجی Zod |
| Rate limit (`4800 × impressions / 24h`، private replies ~750/hr، messaging 100/s) | Token-bucket به‌ازای هر حساب + احترام به `Retry-After` و کد خطای ۴ و ۱۷ و ۳۲ و ۶۱۳ |
| خطاهای موقتی | Retry با backoff نمایی: ۵s → ۳۰s → ۱۲۰s سپس `failed` |
| افشای Token | AES-256-GCM at rest + redaction در logger + هرگز در API response |
| افشای اطلاعات بین Tenantها | هر کوئری به `user_id` مقید است + تست‌های Tenant Isolation |
| الزام افشای ربات‌بودن (قوانین CA/DE) | فیلد `bot_disclosure` در تنظیمات Automation، پیش‌فرض روشن |

---

## 1.6 Abstraction آینده‌نگر

```ts
interface FollowChecker {
  readonly id: string;
  readonly supported: boolean;
  check(input: FollowCheckInput): Promise<FollowCheckResult>;
  // FollowCheckResult.status: 'following' | 'not_following' | 'unknown'
  // reason: 'ok' | 'consent_required' | 'unsupported' | 'blocked' | 'api_error'
}
```

پیاده‌سازی‌های موجود در این پروژه:

| کلاس | وضعیت امروز | توضیح |
|---|---|---|
| `MessagingProfileFollowChecker` | ✅ **فعال (پیش‌فرض)** | رسمی: `GET /<IGSID>?fields=is_user_follow_business`، نیازمند consent |
| `UnsupportedFollowChecker` | 🚫 fallback | وقتی consent نداریم یا اپ هنوز Advanced Access ندارد → `unknown / unsupported` و Flow طبق سیاست `on_unknown` ادامه یا متوقف می‌شود |
| `InstagramOfficialFollowChecker` | 🔮 رزرو شده | اگر Meta روزی چک بدون consent بدهد، فقط همین کلاس نوشته و در `FollowCheckerRegistry` ثبت می‌شود — بدون تغییر در Engine |

همین الگو برای `FollowEventSource` هم وجود دارد که امروز `UnsupportedFollowEventSource` است.

---

## 1.7 چیزهایی که **عمداً** نساخته‌ایم

| خواسته | چرا نه |
|---|---|
| گرفتن username/password اینستاگرام | نقض ToS + خطر بن. مسیر رسمی OAuth جایگزین شد |
| لیست فالوورها / بررسی فالو با scraping | خارج از API رسمی |
| Selenium / Playwright روی وب اینستاگرام | خارج از API رسمی |
| Instagram Private API / session cookie | خارج از API رسمی |
| Webhook فالو | رسماً وجود ندارد → جایگزین: بررسی لحظه‌ای هنگام تعامل کاربر |
| ارسال DM به هر کاربر دلخواه | فقط پنجرهٔ ۲۴ ساعته / Private Reply مجاز است |

---

## منابع رسمی

1. Instagram Platform — Overview: https://developers.facebook.com/documentation/instagram-platform/overview
2. Business Login for Instagram: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
3. Setup Webhooks Subscriptions (جدول فیلدها + امضای SHA256): https://developers.facebook.com/documentation/instagram-platform/webhooks
4. Send a Private Reply to a Commenter: https://developers.facebook.com/documentation/instagram-platform/private-replies
5. Send Messages (انواع پیام، محدودیت مدیا): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api
6. Quick Replies: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies
7. **Instagram User Profile API (منبع `is_user_follow_business` و شرط consent)**: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
8. Get Conversations: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api
9. IG User reference: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
