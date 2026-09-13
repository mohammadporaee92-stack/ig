/**
 * Preflight — قبل از `npm run dev` اجرا می‌شود.
 *
 * فقط یک کار می‌کند: مطمئن می‌شود محیط قابل اجراست. اگر نباشد، به‌جای اینکه
 * کاربر با یک استک‌تریس داخلی روبه‌رو شود، پیام فارسی و راه‌حل می‌بیند.
 *
 * دلیل وجودش: نسخه‌های قبلی پروژه با دیتابیس نیمه‌ساخته یا node_modules ناقص
 * اجرا می‌شدند و اولین خطا در لحظهٔ ورود ظاهر می‌شد — جایی که ربطش به علت اصلی
 * برای کاربر قابل حدس نبود.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function die(title: string, ...lines: string[]): never {
  console.error(`\n  ${red('✗')} ${title}\n`);
  for (const l of lines) console.error(`    ${l}`);
  console.error('');
  process.exit(1);
}

/* ۱. وابستگی‌ها */
if (!existsSync(join(ROOT, 'node_modules', 'next'))) {
  die('وابستگی‌ها نصب نشده‌اند.', `اجرا کنید:  ${dim('npm install')}`);
}

const isProduction = process.env.NODE_ENV === 'production';

/* ۲. تنظیمات محیط */
if (isProduction) {
  // در Docker/Vercel متغیرها مستقیماً تزریق می‌شوند و .env.local عمداً وجود ندارد.
  const required = [
    'APP_URL',
    'AUTH_JWT_SECRET',
    'TOKEN_ENCRYPTION_KEY',
    'DATABASE_URL',
    'IG_APP_ID',
    'IG_APP_SECRET',
    'IG_REDIRECT_URI',
    'IG_WEBHOOK_VERIFY_TOKEN',
    'CRON_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    die('متغیرهای الزامی production تنظیم نشده‌اند.', `موارد ناقص: ${missing.join(', ')}`);
  }
  if (process.env.WEBHOOK_SIGNATURE_REQUIRED === 'false') {
    die('امضای Webhook در production نباید غیرفعال باشد.', 'WEBHOOK_SIGNATURE_REQUIRED=true');
  }
  if (!process.env.APP_URL?.startsWith('https://') || !process.env.IG_REDIRECT_URI?.startsWith('https://')) {
    die('آدرس‌های production باید HTTPS باشند.', 'APP_URL و IG_REDIRECT_URI را با https:// تنظیم کنید');
  }
  if ((process.env.AUTH_JWT_SECRET?.length ?? 0) < 32 || (process.env.CRON_SECRET?.length ?? 0) < 32) {
    die('کلیدهای production بیش از حد کوتاه‌اند.', 'AUTH_JWT_SECRET و CRON_SECRET باید حداقل ۳۲ کاراکتر باشند');
  }
  if (Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'base64').length !== 32) {
    die('TOKEN_ENCRYPTION_KEY نامعتبر است.', 'یک کلید دقیقاً ۳۲ بایتی بسازید: openssl rand -base64 32');
  }
} else if (!existsSync(join(ROOT, '.env.local'))) {
  die('فایل .env.local وجود ندارد.', `اجرا کنید:  ${dim('npm run setup')}`);
}

/* ۳. دیتابیس */
const envText = isProduction ? '' : readFileSync(join(ROOT, '.env.local'), 'utf8');
const usesExternalDb = isProduction || /^DATABASE_URL=.+/m.test(envText);

if (!usesExternalDb) {
  const dbDir = join(ROOT, '.data', 'pglite');
  if (!existsSync(join(dbDir, 'PG_VERSION'))) {
    die(
      'دیتابیس محلی ساخته نشده است.',
      `اجرا کنید:  ${dim('npm run setup')}`,
      '',
      dim('(این دستور دیتابیس را می‌سازد و دادهٔ نمونه را وارد می‌کند)'),
    );
  }

  // قفل باقی‌مانده از بسته‌شدن ناگهانی — درایور خودش پاک می‌کند، فقط هشدار می‌دهیم
  if (existsSync(join(dbDir, 'postmaster.pid'))) {
    console.warn(
      `\n  ${yellow('⚠')} قفل باقی‌مانده از اجرای قبلی پیدا شد — هنگام باز شدن پاک می‌شود.\n`,
    );
  }

  // اگر دیتابیس باز می‌شود ولی خالی است (مثلاً پس از بازسازی خودکارِ یک datadir
  // معیوب)، بدون کاربر نمونه امکان ورود نیست. پس همین‌جا seed می‌کنیم.
  try {
    const { getDb } = await import('../src/infra/db/client');
    const db = await getDb();
    const r = await db.query<{ c: string }>('SELECT count(*)::text AS c FROM users');
    const isEmpty = Number(r.rows[0]?.c ?? '0') === 0;

    // ⚠️ PGlite تک‌نویسنده است: تا وقتی این پروسه datadir را باز نگه داشته،
    //    هر پروسهٔ دیگری که بخواهد بنویسد تا ابد منتظر می‌ماند. پس قبل از
    //    اجرای seed حتماً باید اتصال را ببندیم.
    await db.close();

    if (isEmpty) {
      console.warn(`\n  ${yellow('⟳')} دیتابیس خالی بود — دادهٔ نمونه وارد می‌شود…`);
      const { execFileSync } = await import('node:child_process');
      execFileSync(
        process.execPath,
        [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'seed.ts')],
        { stdio: 'inherit', cwd: ROOT, timeout: 120_000 },
      );
    }
  } catch (err) {
    die(
      'اتصال به دیتابیس محلی ممکن نشد.',
      `اجرا کنید:  ${dim('npm run setup')}`,
      '',
      dim(String((err as Error).message).slice(0, 200)),
    );
  }
}
