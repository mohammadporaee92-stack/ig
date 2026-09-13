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

/* ۲. فایل محیط */
if (!existsSync(join(ROOT, '.env.local'))) {
  die('فایل .env.local وجود ندارد.', `اجرا کنید:  ${dim('npm run setup')}`);
}

/* ۳. دیتابیس */
const envText = readFileSync(join(ROOT, '.env.local'), 'utf8');
const usesExternalDb = /^DATABASE_URL=.+/m.test(envText);

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
