/**
 * Doctor — بررسی و تعمیر خودکار محیط توسعه.
 *   npm run doctor
 *
 * چه چیزهایی را بررسی می‌کند:
 *   ۱. آیا فایل .env.local وجود دارد؟ اگر نه، از .env.example با کلیدهای تصادفی می‌سازد.
 *   ۲. آیا دیتابیس سالم باز می‌شود؟ PGlite بعد از بسته‌شدن ناگهانی فرایند
 *      خراب می‌شود و WASM آن قابلیت بازیابی WAL ندارد ⇒ در این حالت بازسازی می‌کند.
 *   ۳. آیا جدول‌ها و کاربر نمونه موجودند؟ اگر نه، migrate + seed اجرا می‌کند.
 *
 * ایدمپوتنت است: اجرای چندباره بی‌خطر است و اگر همه‌چیز سالم باشد کاری نمی‌کند.
 */
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, '.env.local');

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function step(msg: string): void {
  console.log(`\n${dim('▸')} ${msg}`);
}
function ok(msg: string): void {
  console.log(`  ${green('✓')} ${msg}`);
}
function fix(msg: string): void {
  console.log(`  ${yellow('⟳')} ${msg}`);
}

/**
 * اجرای یک اسکریپت TypeScript با همان مفسر Node جاری.
 *
 * ⚠️ عمداً از `npx` استفاده نمی‌کنیم: روی ویندوز `npx` یک فایل `.cmd` است و
 *    از زمان CVE-2024-27980، Node بدون `shell: true` اجرای `.cmd` را رد می‌کند
 *    (خطای EINVAL/ENOENT). به‌جایش مستقیم باینری tsx داخل node_modules را
 *    با `process.execPath` صدا می‌زنیم که روی هر سه سیستم‌عامل یکسان کار می‌کند.
 */
function runTsx(scriptPath: string, opts: { capture?: boolean } = {}): string {
  const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) {
    console.error(
      `\n  ${red('✗')} پوشهٔ node_modules کامل نیست.\n` +
        `    ابتدا این را اجرا کنید:  ${dim('npm install')}\n`,
    );
    process.exit(1);
  }
  return execFileSync(process.execPath, [tsxCli, scriptPath], {
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 120_000,
    cwd: ROOT,
  }) as unknown as string;
}

/* ─────────────── ۱. فایل محیط ─────────────── */
step('بررسی فایل .env.local');

if (!existsSync(ENV_FILE)) {
  fix('وجود نداشت — ساخته شد با کلیدهای تصادفی');
  writeFileSync(
    ENV_FILE,
    [
      'NODE_ENV=development',
      'APP_URL=http://localhost:3000',
      `AUTH_JWT_SECRET=${randomBytes(48).toString('base64')}`,
      `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      '# فقط اگر داشبورد داخل iframe از دامنهٔ دیگری سرو می‌شود true کنید.',
      '# برای اجرای معمولی روی localhost باید false بماند (کوکی SameSite=Lax، امن‌تر).',
      'AUTH_COOKIE_CROSS_SITE=false',
      'IG_WEBHOOK_VERIFY_TOKEN=dev-verify-token',
      'WEBHOOK_SIGNATURE_REQUIRED=false',
      'PGLITE_DIR=.data/pglite',
      'LOG_LEVEL=info',
      '',
    ].join('\n'),
  );
} else {
  ok('موجود است');
  const content = readFileSync(ENV_FILE, 'utf8');
  if (!content.includes('AUTH_COOKIE_CROSS_SITE')) {
    fix('کلید AUTH_COOKIE_CROSS_SITE=false اضافه شد');
    writeFileSync(ENV_FILE, `${content.trimEnd()}\nAUTH_COOKIE_CROSS_SITE=false\n`);
  } else if (/^AUTH_COOKIE_CROSS_SITE=true/m.test(content) && !process.env.IGFLOW_EMBEDDED) {
    // ⚠️ روی localhost این تنظیم کوکی را Secure+SameSite=None می‌کند که در
    // ناوبری معمولی لازم نیست و در برخی مرورگرها روی http ذخیره نمی‌شود.
    fix('AUTH_COOKIE_CROSS_SITE از true به false تغییر کرد (اجرای محلی، خارج از iframe)');
    writeFileSync(ENV_FILE, content.replace(/^AUTH_COOKIE_CROSS_SITE=true/m, 'AUTH_COOKIE_CROSS_SITE=false'));
  }
}

/* ─────────────── ۲. سلامت دیتابیس ─────────────── */
step('بررسی سلامت دیتابیس');

const dbDir = join(ROOT, '.data', 'pglite');
let needsRebuild = false;

if (!existsSync(join(dbDir, 'PG_VERSION'))) {
  fix('دیتابیس وجود ندارد');
  needsRebuild = true;
} else {
  // تلاش برای باز کردن واقعی دیتابیس در یک فرایند جدا.
  // اگر PGlite خراب باشد، با RuntimeError: Aborted() می‌میرد.
  const probe = `
    import { PGlite } from '@electric-sql/pglite';
    const pg = new PGlite(${JSON.stringify(dbDir)});
    await pg.waitReady;
    const r = await pg.query("SELECT count(*)::int AS c FROM users");
    console.log('PROBE_OK:' + r.rows[0].c);
    await pg.close();
  `;
  const probeFile = join(ROOT, 'scripts', '_probe.mts');
  try {
    writeFileSync(probeFile, probe);
    const out = runTsx(probeFile, { capture: true });
    const m = /PROBE_OK:(\d+)/.exec(out);
    if (m && Number(m[1]) > 0) {
      ok(`سالم است — ${m[1]} کاربر ثبت‌شده`);
    } else {
      fix('باز می‌شود ولی خالی است');
      needsRebuild = true;
    }
  } catch {
    fix('خراب است (بسته‌شدن ناگهانی فرایند) — بازسازی می‌شود');
    needsRebuild = true;
  } finally {
    rmSync(probeFile, { force: true });
  }
}

if (needsRebuild) {
  rmSync(join(ROOT, '.data'), { recursive: true, force: true });
  runTsx(join(ROOT, 'scripts', 'migrate.ts'));
  runTsx(join(ROOT, 'scripts', 'seed.ts'));
  ok('دیتابیس بازسازی و seed شد');
}

/* ─────────────── پایان ─────────────── */
console.log(`\n${green('✅ محیط آماده است.')}`);
console.log(`\n   اجرای سرور:  ${dim('npm run dev')}`);
console.log('   ورود به داشبورد:');
console.log(`     ایمیل: ${green('demo@igflow.app')}`);
console.log(`     رمز:   ${green('demo12345')}\n`);
