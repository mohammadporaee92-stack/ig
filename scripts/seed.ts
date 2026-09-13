/**
 * Seed — داده‌های نمونه برای توسعه و دمو.
 *   npm run db:seed
 *
 * ⚠️ هرگز روی production اجرا نکنید. حساب اینستاگرام ساخته‌شده «ساختگی» است
 *    و توکن آن واقعی نیست؛ فقط برای دیدن UI و تست جریان استفاده می‌شود.
 */
import { getDb } from '~/infra/db/client';
import { createRepositories } from '~/infra/db/repositories';

import { encryptSecret, hashPassword, newId } from '~/lib/crypto';
import { normalizeText } from '~/domain/keyword/engine';
import { createLogger } from '~/lib/logger';

const log = createLogger('seed');

const DEMO_EMAIL = 'demo@igflow.app';
const DEMO_PASSWORD = 'demo12345';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    throw new Error('اجرای seed روی production مجاز نیست (ALLOW_SEED=true برای اجبار).');
  }

  const db = await getDb();
  const repos = createRepositories(db);

  let user = await repos.users.findByEmail(DEMO_EMAIL);
  if (!user) {
    user = await repos.users.create({
      email: DEMO_EMAIL,
      passwordHash: hashPassword(DEMO_PASSWORD),
      fullName: 'کاربر نمونه',
    });
    log.info('کاربر نمونه ساخته شد');
  }

  const account = await repos.accounts.upsert({
    userId: user.id,
    igUserId: '17841400000000001',
    username: 'demo_business',
    name: 'Demo Business',
    accountType: 'BUSINESS',
    profilePictureUrl: null,
    followersCount: 12480,
    mediaCount: 96,
    scopes: ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'],
  });
  await repos.tokens.upsert({
    userId: user.id,
    instagramAccountId: account.id,
    accessTokenEnc: encryptSecret('SEED_FAKE_TOKEN_NOT_REAL'),
    tokenType: 'long_lived',
    expiresAt: new Date(Date.now() + 60 * 24 * 3600_000),
    scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
  });
  await repos.accounts.setWebhookState(account.id, true, ['comments', 'messages', 'messaging_postbacks']);

  const existing = await repos.automations.listByUser(user.id);
  if (existing.length === 0) {
    const automation = await repos.automations.create(user.id, {
      instagram_account_id: account.id,
      name: 'ارسال فایل PDF دورهٔ رایگان',
      status: 'active',
      follow_gate_enabled: true,
      public_reply_enabled: true,
      private_reply_enabled: true,
    });

    await repos.automations.replaceKeywords(user.id, automation.id, [
      { keyword: 'لینک', keywordNorm: normalizeText('لینک'), isNegative: false },
      { keyword: 'link', keywordNorm: normalizeText('link'), isNegative: false },
      { keyword: 'PDF', keywordNorm: normalizeText('PDF'), isNegative: false },
    ]);

    await repos.automations.upsertTemplate(user.id, automation.id, 'public_reply', {
      body: 'برات دایرکت کردم 📩',
    });
    await repos.automations.upsertTemplate(user.id, automation.id, 'private_reply', {
      body: 'سلام {{first_name}} 👋\nدیدم «{{keyword}}» رو کامنت کردی.\nبرای دریافت فایل دکمهٔ زیر رو بزن 👇',
      quickReplies: [{ title: '✅ انجام شد' }],
    });
    await repos.automations.upsertTemplate(user.id, automation.id, 'follow_gate', {
      body: 'برای دریافت فایل لازمه اول پیج رو فالو کنی 🙏\nبعدش «بررسی مجدد» رو بزن.',
      quickReplies: [{ title: '🔄 بررسی مجدد' }],
    });
    await repos.automations.upsertTemplate(user.id, automation.id, 'main', {
      body: 'بفرما {{first_name}} 🎁\nاین هم لینک دانلود:\nhttps://example.com/free-course.pdf',
    });

    log.info('اتوماسیون نمونه ساخته شد', { id: automation.id });
  }

  // چند اجرای نمونه برای اینکه داشبورد و تحلیل‌ها خالی نباشند
  const [automation] = await repos.automations.listByUser(user.id);
  if (automation) {
    const runCount = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM automation_runs WHERE automation_id = $1`,
      [automation.id],
    );
    if (Number(runCount.rows[0]?.c ?? 0) === 0) {
      const samples = [
        { username: 'ali_dev', kw: 'لینک', status: 'completed', follow: 'following', delivered: true },
        { username: 'sara.design', kw: 'link', status: 'completed', follow: 'following', delivered: true },
        { username: 'mehdi_88', kw: 'PDF', status: 'follow_gate_sent', follow: 'not_following', delivered: false },
        { username: 'neda_k', kw: 'لینک', status: 'awaiting_user_interaction', follow: null, delivered: false },
        { username: 'reza.m', kw: 'link', status: 'completed', follow: 'following', delivered: true },
        { username: 'hamed_t', kw: 'PDF', status: 'failed', follow: null, delivered: false },
      ];
      for (const [i, s] of samples.entries()) {
        await db.query(
          `INSERT INTO automation_runs
             (id,user_id,instagram_account_id,automation_id,comment_id,media_id,igsid,username,
              comment_text,matched_keyword,status,follow_status,delivered,started_at,error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - ($14 || ' hours')::interval, $15)`,
          [
            newId('run'), user.id, account.id, automation.id,
            `seed_comment_${i}`, 'seed_media_1', `seed_igsid_${i}`, s.username,
            `سلام ${s.kw} رو برام بفرست`, s.kw, s.status, s.follow, s.delivered,
            String(i * 7 + 2), s.status === 'failed' ? 'outside_window: پنجرهٔ ۲۴ ساعته بسته شده بود' : null,
          ],
        );
      }
      await db.query(`UPDATE automations SET total_runs = $2, last_run_at = now() WHERE id = $1`, [
        automation.id, samples.length,
      ]);
      log.info('اجراهای نمونه ساخته شدند', { count: samples.length });
    }
  }

  log.info('✅ Seed کامل شد', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  // eslint-disable-next-line no-console
  console.log(`\n  ورود به داشبورد:\n    ایمیل: ${DEMO_EMAIL}\n    رمز:   ${DEMO_PASSWORD}\n`);
  await db.close();
}

void main().catch((e: Error) => {
  log.error('Seed ناموفق بود', { error: e.message });
  process.exitCode = 1;
});
